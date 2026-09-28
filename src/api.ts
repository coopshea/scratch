import type { Blurt, Project, ProjectMeta, ProjectSummary, Unit } from '../shared/types.ts';
import type { Board, Lane, StructureDef } from '../shared/structures.ts';
import type { LogEvent } from '../shared/replay.ts';

export const slug = new URLSearchParams(location.search).get('p') ?? 'scratch';
const base = `/api/p/${slug}`;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && !('blurt' in body)) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export type ParseResponse = { blurt: Blurt; units: Unit[]; error?: string; upgrade?: boolean };

export const api = {
  load: () => call<Project>(''),
  events: () => call<LogEvent[]>('/events'),
  rename: (title: string) => call<ProjectMeta>('/meta', { method: 'PATCH', body: JSON.stringify({ title }) }),
  saveBoard: (board: Board, auto = false) => call<Board>(`/board${auto ? '?auto=1' : ''}`, { method: 'PUT', body: JSON.stringify(board) }),
  saveDraft: (text: string) => call<{ ok: true }>('/draft', { method: 'PUT', body: JSON.stringify({ text }) }),
  blurt: (text: string) => call<ParseResponse>('/blurts', { method: 'POST', body: JSON.stringify({ text }) }),
  reparse: (id: string) => call<ParseResponse>(`/blurts/${id}/parse`, { method: 'POST' }),
  patch: (id: string, patch: Partial<Unit>) => call<Unit>(`/units/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
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

/** Hosted only: Stripe's own pages for subscribing to Pro and for managing it. */
export const billing = {
  checkout: () => goTo('/api/billing/checkout'),
  portal: () => goTo('/api/billing/portal'),
};
async function goTo(path: string) {
  const res = await fetch(path, { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.url) throw new Error(body.error ?? 'Could not open billing');
  location.href = body.url;
}
