import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { UNIT_TYPES } from '../shared/types.ts';

// Created on first real parse, so importing this file never needs a key (offline mode, tests).
let client: Anthropic | null = null;

const ParsedUnit = z.object({
  key: z.string().describe('Short unique key within this response, e.g. c1, c2 for claims, u1, u2 for others'),
  type: z.enum(UNIT_TYPES),
  text: z.string().describe("The writer's exact words, copied character for character from the blurt"),
  label: z.string().describe('3 to 6 word concept label, at most 40 characters'),
  home: z.string().describe('For non-claims: key of a claim in this response, or id of an existing claim, or empty string. Claims: empty string'),
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
- home: every non-claim unit belongs to the single claim it most directly supports, illustrates, questions, or challenges. Use the key of a claim in this response, or the id of an existing claim listed below. Use an empty string if nothing fits. Claims always have an empty home.

Reuse labels: if a unit expresses the same concept as a label in the existing vocabulary, use that label exactly. Only coin a new label when none fits.

Cover every substantive idea. Skip pure filler ("um, anyway, where was I"). Do not merge separate mentions of the same idea; give each its own unit with the same label.`;

export class ParseFailure extends Error {}

/** Turn SDK errors into one readable sentence for the UI. */
export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check ANTHROPIC_API_KEY in .env.';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Wait a moment and retry.';
  if (e instanceof Anthropic.APIError) {
    const inner = (e.error as { error?: { message?: string } } | undefined)?.error?.message;
    return `API error ${e.status ?? ''}: ${inner ?? e.message}`.trim();
  }
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the API. Check the network.';
  return (e as Error).message;
}

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

export async function parseBlurt(
  blurt: string,
  vocab: string[],
  claims: { id: string; label: string }[],
): Promise<ParsedUnit[]> {
  if (process.env.PARSER === 'offline') return offlineParse(blurt);
  const context = [
    vocab.length ? `Existing vocabulary:\n${vocab.map((v) => `- ${v}`).join('\n')}` : 'Existing vocabulary: none yet.',
    claims.length ? `Existing claims (id: label):\n${claims.map((c) => `- ${c.id}: ${c.label}`).join('\n')}` : 'Existing claims: none yet.',
    `<blurt>\n${blurt}\n</blurt>`,
  ].join('\n\n');

  client ??= new Anthropic(); // ANTHROPIC_API_KEY from .env
  const response = await client.beta.messages.parse({
    model: 'claude-opus-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: betaZodOutputFormat(ParseResult) },
    system: SYSTEM,
    messages: [{ role: 'user', content: context }],
  });

  if (response.stop_reason === 'refusal') throw new ParseFailure('The model declined to parse this blurt.');
  if (response.stop_reason === 'max_tokens') throw new ParseFailure('The blurt was too long to parse in one pass. Split it and try again.');
  if (!response.parsed_output) throw new ParseFailure('The parser returned output that did not match the schema.');
  return response.parsed_output.units;
}
