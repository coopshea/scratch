/**
 * Readwise, the writer's own reading. The only file that knows Readwise exists.
 *
 * Search goes through Readwise's MCP server, which runs its own hybrid (vector + full-text) search,
 * so we keep no embeddings. Fetching a passage goes through the versioned REST API, so the words
 * that become evidence come straight from Readwise, never from the client.
 * Both take the same token, sent as `Token <token>` (not Bearer): READWISE_TOKEN locally, or the writer's own on
 * the hosted site, passed in as `tok`.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';

const MCP_URL = 'https://mcp2.readwise.io/mcp';
const REST = 'https://readwise.io/api/v2';
const SEARCH_TOOL = 'readwise_search_highlights';

/** A source-neutral passage: the source's words, and the writer's note on them. */
export interface Passage {
  source: 'readwise';
  id: string;
  quote: string;
  note: string;
  title: string;
  author: string;
  url: string | null;
  /** The source's own relevance score for a search hit; higher is closer. */
  score?: number;
}

const envToken = () => process.env.READWISE_TOKEN?.trim() || '';
export const enabled = () => !!envToken();

// One search session per token, so writers never share a connection.
const clients = new Map<string, Promise<Client>>();

function connect(tok: string): Promise<Client> {
  let client = clients.get(tok);
  if (!client) {
    client = (async () => {
      const c = new Client({ name: 'scratch', version: '0.1.0' });
      await c.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), {
        requestInit: { headers: { Authorization: `Token ${tok}` } },
      }));
      const { tools } = await c.listTools();
      if (!tools.some((t) => t.name === SEARCH_TOOL)) throw new Error(`Readwise no longer offers ${SEARCH_TOOL}`);
      return c;
    })();
    clients.set(tok, client);
    // A failed connection is not cached; the next call tries again.
    client.catch(() => { clients.delete(tok); });
  }
  return client;
}

const Hit = z.object({
  id: z.union([z.number(), z.string()]),
  score: z.number().nullish(),
  attributes: z.object({
    document_title: z.string().nullish(),
    document_author: z.string().nullish(),
    highlight_plaintext: z.string(),
    highlight_note: z.string().nullish(),
  }),
});

/** Readwise's own hybrid search over highlights and the writer's notes on them. */
export async function search(query: string, limit = 10, tok = envToken()): Promise<Passage[]> {
  const call = async () => (await connect(tok)).callTool({ name: SEARCH_TOOL, arguments: { vector_search_term: query, limit } });
  let res;
  try { res = await call(); } catch { clients.delete(tok); res = await call(); } // one retry on a dropped session
  const content = (res.content as { type: string; text?: string }[])?.[0];
  if (res.isError || content?.type !== 'text') throw new Error(`Readwise search failed: ${content?.text ?? 'no result'}`);
  // Readwise treats limit as a hint, so trim here.
  return z.array(Hit).parse(JSON.parse(content.text!)).slice(0, limit).map((h) => ({
    source: 'readwise',
    id: String(h.id),
    quote: h.attributes.highlight_plaintext,
    note: h.attributes.highlight_note?.trim() ?? '',
    title: h.attributes.document_title ?? '',
    author: h.attributes.document_author ?? '',
    url: null,
    ...(h.score != null ? { score: h.score } : {}),
  }));
}

async function rest<T>(path: string, schema: z.ZodType<T>, tok: string): Promise<T> {
  const r = await fetch(`${REST}${path}`, { headers: { Authorization: `Token ${tok}` } });
  if (r.status === 401) throw new Error('Readwise rejected the token. Check READWISE_TOKEN in .env, or the token on your account page.');
  if (!r.ok) throw new Error(`Readwise returned ${r.status} for ${path}`);
  return schema.parse(await r.json());
}

const Highlight = z.object({ id: z.number(), text: z.string(), note: z.string().nullish(), book_id: z.number() });
const Book = z.object({ title: z.string().nullish(), author: z.string().nullish(), source_url: z.string().nullish() });

/** One passage, fetched fresh from Readwise so its words are the source's own. */
export async function getPassage(id: string, tok = envToken()): Promise<Passage> {
  if (!/^\d+$/.test(id)) throw new Error('Invalid Readwise highlight id');
  const h = await rest(`/highlights/${id}/`, Highlight, tok);
  const b = await rest(`/books/${h.book_id}/`, Book, tok);
  return {
    source: 'readwise', id: String(h.id), quote: h.text, note: h.note?.trim() ?? '',
    title: b.title ?? '', author: b.author ?? '', url: b.source_url ?? null,
  };
}

/** For setup checks: is the token accepted, and is search reachable? */
export async function check(tok = envToken()): Promise<{ token: boolean; search: boolean; error?: string }> {
  if (!tok) return { token: false, search: false, error: 'READWISE_TOKEN is not set in .env' };
  if (!(await accepts(tok))) return { token: false, search: false, error: 'Token rejected' };
  try { await connect(tok); return { token: true, search: true }; }
  catch (e) { return { token: true, search: false, error: (e as Error).message }; }
}

/** Whether Readwise accepts a token. Used before storing a writer's own. */
export async function accepts(tok: string): Promise<boolean> {
  const auth = await fetch(`${REST}/auth/`, { headers: { Authorization: `Token ${tok}` } });
  return auth.status === 204;
}
