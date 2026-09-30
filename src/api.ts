import type { Blurt, Project, ProjectMeta, ProjectSummary, Unit } from '../shared/types.ts';
import type { Board, Lane, StructureDef } from '../shared/structures.ts';
import type { LogEvent } from '../shared/replay.ts';

export const slug = new URLSearchParams(location.search).get('p') ?? 'scratch';
const base = `/api/p/${slug}`;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  // The browser's own words for an unreachable server ("Failed to fetch") read like the source failed.
  const res = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  }).catch(() => { throw new Error("Can't reach Scratch's server. Check your connection, then try again."); });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && !('blurt' in body)) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export type ParseResponse = { blurt: Blurt; units: Unit[]; error?: string; buy?: boolean };
/** A passage from the writer's reading: the source's words, and the writer's note on them. */
export type Passage = { id: string; quote: string; note: string; title: string; author: string; url: string | null };
/** A passage offered for a thread (root id), or for the document when it has no threads yet. */
export type Suggestion = { home: string | null; passage: Passage };

export const api = {
  load: () => call<Project>(''),
  events: () => call<LogEvent[]>('/events'),
  rename: (title: string) => call<ProjectMeta>('/meta', { method: 'PATCH', body: JSON.stringify({ title }) }),
  saveBoard: (board: Board, auto = false) => call<Board>(`/board${auto ? '?auto=1' : ''}`, { method: 'PUT', body: JSON.stringify(board) }),
  saveDraft: (text: string) => call<{ ok: true }>('/draft', { method: 'PUT', body: JSON.stringify({ text }) }),
  blurt: (text: string) => call<ParseResponse>('/blurts', { method: 'POST', body: JSON.stringify({ text }) }),
  reparse: (id: string) => call<ParseResponse>(`/blurts/${id}/parse`, { method: 'POST' }),
  patch: (id: string, patch: Partial<Unit>) => call<Unit>(`/units/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  readwise: {
    status: async () => (await fetch('/api/readwise/status')).json() as Promise<{ token: boolean; search: boolean }>,
    search: (query: string) => call<{ enabled: boolean; passages: Passage[] }>('/readwise/search', { method: 'POST', body: JSON.stringify({ query }) }),
    adopt: (id: string, home: string | null) => call<Unit>('/readwise/adopt', { method: 'POST', body: JSON.stringify({ id, home }) }),
    related: () => call<{ suggestions: Suggestion[] }>('/readwise/related', { method: 'POST' }),
  },
  upload: async (file: File) => {
    const res = await fetch(`${base}/assets`, { method: 'POST', headers: { 'x-filename': file.name }, body: file });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? 'Upload failed');
    return body.url as string;
  },
};

export const projects = {
  list: async () => (await fetch('/api/projects')).json() as Promise<ProjectSummary[]>,
  /** Moves the document to projects/.trash on the server; recoverable by hand. */
  remove: async (slug: string) => { await fetch(`/api/p/${encodeURIComponent(slug)}`, { method: 'DELETE' }); },
  create: async (title: string) => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
    return res.json() as Promise<{ slug: string; title: string }>;
  },
};

export const archetypes = {
  list: async () => (await fetch('/api/archetypes')).json() as Promise<StructureDef[]>,
  save: async (a: { id?: string; name: string; outline?: string; lanes?: Lane[] }) => {
    const res = await fetch('/api/archetypes', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? 'Could not save');
    return body as StructureDef;
  },
  remove: async (id: string) => { await fetch(`/api/archetypes/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
};

/** Hosted only: Stripe's own pages for paying in and for managing a subscription. */
export const billing = {
  checkout: (what: 'topup' | 'subscription' | 'donation', cents = 0, back?: { slug: string; blurt: string }) => goTo('/api/billing/checkout', { what, cents, back }),
  portal: () => goTo('/api/billing/portal'),
};
async function goTo(path: string, payload: object = {}) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.url) throw new Error(body.error ?? 'Could not open billing');
  location.href = body.url;
}
