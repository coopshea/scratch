import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { UNIT_TYPES } from '../shared/types.ts';
import { posthogLog } from './posthog-logs.ts';
import { posthogClient } from './posthog.ts';

// Created on first real parse, so importing this file never needs an Anthropic key (offline mode, tests).
let client: Anthropic | null = null;
type AiContext = { projectId: string; distinctId?: string };

const ParsedUnit = z.object({
  key: z.string().describe('Short unique key within this response, e.g. r1, r2 for roots, u1, u2 for others'),
  type: z.enum(UNIT_TYPES),
  text: z.string().describe("The writer's exact words, copied character for character from the blurt"),
  label: z.string().describe('3 to 6 word concept label, at most 40 characters'),
  home: z.string().describe('Key of the root claim or question in this response, or id of an existing root, that this unit belongs to. Empty string for a root, or if nothing fits'),
});
const ParseResult = z.object({ units: z.array(ParsedUnit) });
export type ParsedUnit = z.infer<typeof ParsedUnit>;

const SYSTEM = `You cut a writer's brain dump ("blurt") into units for a drafting tool. You never write, reword, summarize, or improve their prose.

For each unit:
- text: an exact contiguous substring of the blurt, copied character for character. You may trim filler words from the start or end of a span, but never change, reorder, or drop words inside it. If an idea is spread across non-adjacent sentences, make separate units.
- type, exactly one of:
  claim: an assertion the writer makes that could be wrong.
  evidence: a data point, result, citation, or source.
  story: an anecdote or concrete example; a specific case.
  question: something the writer does not know or wants answered.
  objection: a case against a claim, including the writer's own doubts.
  concept: a term or idea that needs defining.
  coinage: a pithy phrase, analogy, acronym, or name the writer is inventing or wants to stick.
  artifact: a figure, chart, table, code, or demo the writer describes wanting to make.
- label: a 3 to 6 word concept name, at most 40 characters, heavily abstracted to the underlying idea, not a summary of the sentence. Talk about "the scarcest nutrient limits plant growth" becomes "law of the minimum". Prefer the established name of an idea when one exists.
- home: claims and questions are the guiding primitives. A claim or question with an empty home is a root: one thread of the writer's thinking. Every other unit belongs to the single root it most directly supports, illustrates, answers, or challenges. That includes a claim that mainly supports a broader claim, and a question that mainly probes one. Use the key of a root in this response, or the id of an existing root listed below. A unit that belongs to a root never has units of its own. Use an empty string if nothing fits.

Prefer fewer, broader roots. A root gathers the pieces of one thread, the way a heading gathers a pile of sticky notes. A page of notes usually has about 3 to 7 threads; use more only when the blurt truly covers more. Do not make every assertion a root.

The writer's existing ideas are listed below, nested as they stand: each root with its pieces indented beneath it, then loose ones. Some were cut by hand: the writer highlighted those words and pulled them out before you saw the blurt, and their words are quoted. Never cut those words again, even inside a longer span; cut only what is not already there. Make new units fit around the existing ideas: put a piece under the existing root it belongs to rather than starting a duplicate root.

Reuse labels: if a unit expresses the same concept as a label in the existing vocabulary, use that label exactly. Only coin a new label when none fits.

Cover every substantive idea. Skip pure filler ("um, anyway, where was I"). Do not merge separate mentions of the same idea; give each its own unit with the same label.`;

export class ParseFailure extends Error {}

/** Tokens one parse used, and what they cost in US dollars at the model's list price. */
export type Usage = { model: string; input: number; output: number; usd: number };

// Dollars per million tokens (input, output), from Anthropic's price list.
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20], 'claude-opus-5': [5, 25], 'claude-fable-5-1': [10, 50],
  'claude-sonnet-5': [2, 10], 'claude-haiku-4-5': [1, 5],
};
export function usageOf(model: string, input: number, output: number): Usage {
  const [i, o] = PRICES[model] ?? PRICES['claude-fable-5-1']; // an unknown model is priced high, never free
  return { model, input, output, usd: (input * i + output * o) / 1e6 };
}

/** Turn SDK errors into one readable sentence for the UI. */
export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check the key in .env, or on your account page.';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Wait a moment and retry.';
  if (e instanceof Anthropic.APIError) {
    const inner = (e.error as { error?: { message?: string } } | undefined)?.error?.message;
    return `API error ${e.status ?? ''}: ${inner ?? e.message}`.trim();
  }
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the API. Check the network.';
  return (e as Error).message;
}

/** Errors whose message is written for the writer: the API's own, and the parser's. Anything else may carry server details. */
export const isWriterFacing = (e: unknown) => e instanceof Anthropic.APIError || e instanceof ParseFailure;

/**
 * Offline mode (PARSER=offline): splits by sentence so the UI can be exercised without API calls.
 * Every question becomes a question; the first statement becomes the claim. Not a real parser.
 */
function offlineParse(blurt: string): ParsedUnit[] {
  const sentences = blurt.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((x) => x.trim()).filter(Boolean) ?? [];
  let claimKey = '';
  return sentences.map((text, i) => {
    const isQ = text.endsWith('?');
    const type = isQ ? 'question' : claimKey ? 'evidence' : 'claim';
    const key = `u${i}`;
    if (type === 'claim') claimKey = key;
    const label = text.replace(/[^\w\s-]/g, '').split(/\s+/).slice(0, 4).join(' ').toLowerCase();
    return { key, type, text, label, home: type === 'claim' ? '' : claimKey } as ParsedUnit;
  });
}

/** An idea already in the document, as the parser sees it. `text` is set only for ideas the writer cut by hand. */
export type ExistingNode = { id: string; type: string; label: string; home: string | null; text?: string };
/** Hand-cut words shown to the parser are capped, so one long highlight can't swell every later parse. */
const HAND_QUOTE_MAX = 400;

/**
 * The parser's user message: the vocabulary, the existing ideas nested as they stand (roots by id, so new pieces
 * can join them; the writer's hand cuts quoted, so they aren't cut twice), then the blurt.
 */
export function buildContext(blurt: string, vocab: string[], roots: { id: string; type: string; label: string }[], nodes: ExistingNode[] = []): string {
  const rootIds = new Set(roots.map((r) => r.id));
  const line = (n: ExistingNode, indent: string, withId: boolean) => {
    const quote = n.text !== undefined ? ` [cut by hand: "${n.text.length > HAND_QUOTE_MAX ? `${n.text.slice(0, HAND_QUOTE_MAX)}…` : n.text}"]` : '';
    return `${indent}- ${withId ? `${n.id}, ` : ''}${n.type}: ${n.label}${quote}`;
  };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const tree: string[] = [];
  for (const r of roots) {
    const n = byId.get(r.id) ?? { ...r, home: null };
    tree.push(line(n, '', true));
    for (const k of nodes.filter((x) => x.home === r.id)) tree.push(line(k, '  ', false));
  }
  const loose = nodes.filter((n) => !rootIds.has(n.id) && !(n.home && rootIds.has(n.home)));
  if (loose.length) tree.push('Loose (under no root):', ...loose.map((n) => line(n, '', false)));
  return [
    vocab.length ? `Existing vocabulary:\n${vocab.map((v) => `- ${v}`).join('\n')}` : 'Existing vocabulary: none yet.',
    tree.length ? `Existing ideas (roots as id, type: label; their pieces indented beneath):\n${tree.join('\n')}` : 'Existing ideas: none yet.',
    `<blurt>\n${blurt}\n</blurt>`,
  ].join('\n\n');
}

export async function parseBlurt(
  blurt: string,
  vocab: string[],
  roots: { id: string; type: string; label: string }[],
  apiKey?: string, // the writer's own key on the hosted site; otherwise the server's
  onUsage?: (u: Usage) => void, // what the parse cost, for metering the hosted site
  ai?: AiContext,
  nodes: ExistingNode[] = [], // every idea already in the document, nested, with hand cuts quoted
): Promise<ParsedUnit[]> {
  if (process.env.PARSER === 'offline') {
    // No API call, but a stand-in cost so metering can be tested: roughly a real parse of this length.
    onUsage?.(usageOf('claude-opus-5-5', 1500 + Math.ceil(blurt.length / 4), Math.ceil(blurt.length / 2)));
    return offlineParse(blurt);
  }
  const context = buildContext(blurt, vocab, roots, nodes);

  const api = apiKey ? new Anthropic({ apiKey }) : (client ??= new Anthropic()); // ANTHROPIC_API_KEY from .env
  // Tuning knobs for comparing models (npm run compare:parse); defaults are the shipped settings.
  const model = process.env.PARSER_MODEL ?? 'claude-opus-5-5';
  // Low effort: measured on the CAD talk, Claude Opus 5.5 at low matched or beat higher settings in half the time.
  const effort = process.env.PARSER_EFFORT ?? 'low'; // 'none' runs without thinking (Haiku 4.5 has no effort levels)
  const request = {
    model,
    max_tokens: 16000,
    // Refusal fallbacks: a false-positive safety decline retries on another model instead of failing the parse.
    ...(model.startsWith('claude-opus-5') ? { betas: ['server-side-fallback-2026-07-01' as const], fallbacks: 'default' as const } : {}),
    ...(effort === 'none' ? {} : { thinking: { type: 'adaptive' as const } }),
    output_config: {
      ...(effort === 'none' ? {} : { effort: effort as 'low' | 'medium' | 'high' }),
      format: betaZodOutputFormat(ParseResult),
    },
    system: SYSTEM,
    messages: [{ role: 'user' as const, content: context }],
  };
  const started = Date.now();
  posthogLog('ai_parse_started', { model, effort });
  let response;
  try { response = await api.beta.messages.parse(request); }
  catch (e) { trackGeneration(ai, model, started, { error: e }); throw e; }
  // Thinking is billed as output. The JSON itself is roughly its characters / 4, so the rest is reasoning.
  onUsage?.(usageOf(model, response.usage.input_tokens, response.usage.output_tokens));
  const json = Math.round(JSON.stringify(response.parsed_output ?? '').length / 4);
  console.log(`parse: ${((Date.now() - started) / 1000).toFixed(1)}s, ${model} effort ${effort}, `
    + `in ${response.usage.input_tokens}, out ${response.usage.output_tokens} (~${json} answer, ~${Math.max(0, response.usage.output_tokens - json)} thinking)`);
  posthogLog('ai_parse_completed', {
    model,
    effort,
    duration_ms: Date.now() - started,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  });
  trackGeneration(ai, model, started, { input: response.usage.input_tokens, output: response.usage.output_tokens });

  if (response.stop_reason === 'refusal') throw new ParseFailure('The model declined to parse this blurt.');
  if (response.stop_reason === 'max_tokens') throw new ParseFailure('The blurt was too long to parse in one pass. Split it and try again.');
  if (!response.parsed_output) throw new ParseFailure('The parser returned output that did not match the schema.');
  return response.parsed_output.units;
}

/**
 * One parse, for PostHog LLM analytics: model, tokens, cost and time, never the blurt or what was cut from it.
 * Sent by hand because PostHog's Anthropic wrapper covers messages.create, not beta.messages.parse.
 */
function trackGeneration(ai: AiContext | undefined, model: string, started: number, r: { input?: number; output?: number; error?: unknown }) {
  const posthog = posthogClient();
  if (!posthog) return;
  const usage = r.input !== undefined && r.output !== undefined ? usageOf(model, r.input, r.output) : undefined;
  posthog.capture({
    distinctId: ai?.distinctId ?? 'local',
    event: '$ai_generation',
    properties: {
      $ai_provider: 'anthropic', $ai_model: model, $ai_trace_id: randomUUID(), $ai_latency: (Date.now() - started) / 1000,
      $ai_session_id: createHash('sha256').update(`${ai?.distinctId ?? 'local'}:${ai?.projectId ?? 'parser'}`).digest('hex'),
      ...(usage ? { $ai_input_tokens: r.input, $ai_output_tokens: r.output, $ai_total_cost_usd: usage.usd } : {}),
      ...(r.error ? { $ai_is_error: true, $ai_error: r.error instanceof Error ? r.error.message : String(r.error) } : {}),
      ...(ai?.distinctId ? {} : { $process_person_profile: false }),
    },
  });
}
