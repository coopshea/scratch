import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import type { Unit } from '../shared/types.ts';
import { readEvents, tempDataDir } from './helpers.ts';

// Recorded shapes of real Readwise responses (2026-09-27). Tests never call Readwise.
const SEARCH_HITS = [
  {
    id: 1035843920, score: 0.031,
    attributes: {
      document_title: 'Why Jet Engines Aren’t “Made in China”', document_author: 'Aakash Japi',
      highlight_plaintext: 'On top of this, the certification regime for jet engines is one of the most complex regulatory processes in any industry.',
      highlight_note: 'So if your planes are gonna fly around to other places, they have to meet the standards of those places.\n\nObviously.  ',
      document_category: 'articles', document_tags: [], highlight_tags: [],
    },
    url: 'https://readwise.io/open/1035843920',
  },
  {
    id: 994900237, score: 0.016,
    attributes: { document_title: 'Are AI Datacenters Increasing Electric Bills?', document_author: null, highlight_plaintext: 'Texas had learned its lesson.', highlight_note: null },
  },
];
const HIGHLIGHT = { id: 1035843920, text: SEARCH_HITS[0].attributes.highlight_plaintext, note: SEARCH_HITS[0].attributes.highlight_note, book_id: 77 };
const BOOK = { title: 'Why Jet Engines Aren’t “Made in China”', author: 'Aakash Japi', source_url: 'https://aakash.substack.com/p/why-jet-engines' };

const mcp = vi.hoisted(() => ({
  tools: [{ name: 'readwise_search_highlights' }],
  callTool: vi.fn(),
  connect: vi.fn(async () => undefined),
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = mcp.connect;
    listTools = async () => ({ tools: mcp.tools });
    callTool = mcp.callTool;
  },
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: class {} }));

function mockRest(overrides: Record<string, Response> = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    for (const [k, r] of Object.entries(overrides)) if (url.includes(k)) return r;
    if (url.endsWith('/auth/')) return new Response(null, { status: 204 });
    if (url.includes('/highlights/1035843920/')) return Response.json(HIGHLIGHT);
    if (url.includes('/books/77/')) return Response.json(BOOK);
    return new Response('not found', { status: 404 });
  }));
}

const DATA = tempDataDir();
process.env.SCRATCH_DATA = DATA;
process.env.READWISE_TOKEN = 'test-token';

let app: Express;
let readwise: typeof import('../server/readwise.ts');
beforeAll(async () => {
  readwise = await import('../server/readwise.ts');
  app = (await import('../server/app.ts')).createApp();
});
beforeEach(() => {
  mcp.tools = [{ name: 'readwise_search_highlights' }];
  mcp.callTool.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(SEARCH_HITS) }] });
  mockRest();
});
afterEach(() => vi.unstubAllGlobals());

describe('readwise module', () => {
  it('turns search hits into source-neutral passages', async () => {
    const [p] = await readwise.search('gas turbines');
    expect(p).toEqual({
      source: 'readwise', id: '1035843920', quote: HIGHLIGHT.text,
      note: 'So if your planes are gonna fly around to other places, they have to meet the standards of those places.\n\nObviously.',
      title: BOOK.title, author: 'Aakash Japi', url: null,
    });
  });

  it('trims results itself, since Readwise treats the limit as a hint', async () => {
    expect(await readwise.search('x', 1)).toHaveLength(1);
  });

  it('sends the token as "Token", not "Bearer"', async () => {
    await readwise.getPassage('1035843920');
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Token test-token');
  });

  it('fetches a passage’s words and source from the REST API', async () => {
    expect(await readwise.getPassage('1035843920')).toMatchObject({ quote: HIGHLIGHT.text, title: BOOK.title, url: BOOK.source_url });
  });

  it('rejects ids that are not Readwise highlight ids', async () => {
    await expect(readwise.getPassage('../books')).rejects.toThrow(/Invalid/);
  });

  it('explains a rejected token in plain words', async () => {
    mockRest({ '/highlights/': new Response(null, { status: 401 }) });
    await expect(readwise.getPassage('1035843920')).rejects.toThrow(/READWISE_TOKEN/);
  });

  it('fails loudly if Readwise changes the shape of search results', async () => {
    mcp.callTool.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify([{ id: 1, attributes: {} }]) }] });
    await expect(readwise.search('x')).rejects.toThrow();
  });
});

describe('adopting a passage as evidence', () => {
  let slug: string;
  beforeAll(async () => { slug = (await request(app).post('/api/projects').send({ title: 'reading' })).body.slug; });

  it('searches, then creates a sourced, unverified evidence unit with the writer’s note', async () => {
    const found = (await request(app).post(`/api/p/${slug}/readwise/search`).send({ query: 'certification' })).body;
    expect(found.passages).toHaveLength(2);
    const u: Unit = (await request(app).post(`/api/p/${slug}/readwise/adopt`).send({ id: '1035843920' })).body;
    expect(u).toMatchObject({
      type: 'evidence', origin: 'source', labeledBy: 'system', verified: false, status: 'accepted', text: HIGHLIGHT.text,
      source: { kind: 'readwise', id: '1035843920', title: BOOK.title, author: 'Aakash Japi', url: BOOK.source_url },
    });
    expect((u.note as { content: { text: string }[] }[]).map((b) => b.content[0].text))
      .toEqual(['So if your planes are gonna fly around to other places, they have to meet the standards of those places.', 'Obviously.']);
    expect(readEvents(DATA, slug).at(-1)).toMatchObject({ type: 'source.adopt', author: 'human', data: { unit: { id: u.id } } });
  });

  it('takes the words from Readwise, never from the request', async () => {
    const other = (await request(app).post('/api/projects').send({ title: 'tamper' })).body.slug;
    const u: Unit = (await request(app).post(`/api/p/${other}/readwise/adopt`).send({ id: '1035843920', text: 'fake quote' })).body;
    expect(u.text).toBe(HIGHLIGHT.text);
  });

  it('adopting twice returns the same unit, and search stops offering it', async () => {
    const a = (await request(app).post(`/api/p/${slug}/readwise/adopt`).send({ id: '1035843920' })).body;
    const b = (await request(app).post(`/api/p/${slug}/readwise/adopt`).send({ id: '1035843920' })).body;
    expect(a.id).toBe(b.id);
    const project = (await request(app).get(`/api/p/${slug}`)).body;
    expect(project.units.filter((u: Unit) => u.source?.id === '1035843920')).toHaveLength(1);
    const found = (await request(app).post(`/api/p/${slug}/readwise/search`).send({ query: 'certification' })).body;
    expect(found.passages.map((p: { id: string }) => p.id)).toEqual(['994900237']);
  });

  it('only files a passage under a claim', async () => {
    const res = await request(app).post(`/api/p/${slug}/readwise/adopt`).send({ id: '1035843920', home: 'not-a-claim' });
    expect(res.status).toBe(200); // already adopted: the existing unit comes back unchanged
    const fresh = (await request(app).post('/api/projects').send({ title: 'homes' })).body.slug;
    expect((await request(app).post(`/api/p/${fresh}/readwise/adopt`).send({ id: '1035843920', home: 'not-a-claim' })).status).toBe(400);
  });
});
