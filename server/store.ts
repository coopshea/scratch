import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Blurt, Project, ProjectMeta, ProjectSummary, Unit } from '../shared/types.ts';
import { emptyBoard, type Board, type StructureDef } from '../shared/structures.ts';

const ROOT = path.resolve('projects');

export function assertSlug(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) throw new HttpError(400, 'Invalid project slug');
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function projectDir(slug: string) {
  assertSlug(slug);
  const dir = path.join(ROOT, slug);
  fs.mkdirSync(path.join(dir, 'blurts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  return dir;
}

export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

function writeAtomic(file: string, content: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

// One write at a time per project, so rapid edits never interleave.
const locks = new Map<string, Promise<unknown>>();
export function withLock<T>(slug: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = locks.get(slug) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(slug, next.catch(() => undefined));
  return next;
}

export function readUnits(slug: string): Unit[] {
  const file = path.join(projectDir(slug), 'units.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

export function writeUnits(slug: string, units: Unit[]) {
  writeAtomic(path.join(projectDir(slug), 'units.json'), JSON.stringify(units, null, 2) + '\n');
}

export function listBlurts(slug: string): Blurt[] {
  const dir = path.join(projectDir(slug), 'blurts');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const id = f.slice(0, -3);
    return { id, text: fs.readFileSync(path.join(dir, f), 'utf8'), createdAt: idToIso(id) };
  });
}

export function getBlurt(slug: string, id: string): Blurt {
  if (!/^[\w-]+$/.test(id)) throw new HttpError(400, 'Invalid blurt id');
  const file = path.join(projectDir(slug), 'blurts', `${id}.md`);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Blurt not found');
  return { id, text: fs.readFileSync(file, 'utf8'), createdAt: idToIso(id) };
}

/** Raw blurts are immutable: written once, never edited. */
export function saveBlurt(slug: string, text: string): Blurt {
  const now = new Date();
  const id = now.toISOString().replace(/[:.]/g, '-') + '_' + newId().slice(0, 4);
  const file = path.join(projectDir(slug), 'blurts', `${id}.md`);
  fs.writeFileSync(file, text, { flag: 'wx' });
  return { id, text, createdAt: now.toISOString() };
}

function idToIso(id: string) {
  const m = id.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : id;
}

export type Author = 'human' | 'model' | 'system';

/** Append-only event log. The source of truth for replay. */
export function appendEvent(slug: string, author: Author, type: string, data: unknown) {
  const line = JSON.stringify({ t: new Date().toISOString(), author, type, data }) + '\n';
  fs.appendFileSync(path.join(projectDir(slug), 'events.jsonl'), line);
}

function readJson<T>(file: string, fallback: T): T {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}

export function readMeta(slug: string): ProjectMeta {
  return readJson(path.join(projectDir(slug), 'meta.json'), { title: slug });
}
export function writeMeta(slug: string, meta: ProjectMeta) {
  writeAtomic(path.join(projectDir(slug), 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
}

export function readBoard(slug: string): Board {
  return { ...emptyBoard(), ...readJson(path.join(projectDir(slug), 'board.json'), {}) };
}
export function writeBoard(slug: string, board: Board) {
  writeAtomic(path.join(projectDir(slug), 'board.json'), JSON.stringify(board, null, 2) + '\n');
}

export function readDraft(slug: string): string {
  const file = path.join(projectDir(slug), 'draft.md');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}
export function writeDraft(slug: string, text: string) {
  writeAtomic(path.join(projectDir(slug), 'draft.md'), text);
}

export function loadProject(slug: string): Project {
  return { slug, meta: readMeta(slug), blurts: listBlurts(slug), units: readUnits(slug), board: readBoard(slug), draft: readDraft(slug) };
}

export function listProjects(): ProjectSummary[] {
  if (!fs.existsSync(ROOT)) return [];
  return fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[a-z0-9][a-z0-9-]{0,63}$/.test(d.name))
    .map((d) => {
      const dir = path.join(ROOT, d.name);
      const units = readJson<Unit[]>(path.join(dir, 'units.json'), []).filter((u) => u.status !== 'cut');
      const board = readJson<Partial<Board>>(path.join(dir, 'board.json'), {});
      const thesisId = board.structure ? board.lanes?.[board.structure]?.thesis?.[0] : undefined;
      const claims = units.filter((u) => u.type === 'claim');
      const ordered = thesisId ? [...claims.filter((c) => c.id === thesisId), ...claims.filter((c) => c.id !== thesisId)] : claims;
      const events = path.join(dir, 'events.jsonl');
      const updated = fs.existsSync(events) ? fs.statSync(events).mtime : fs.statSync(dir).mtime;
      return {
        slug: d.name,
        title: readJson<ProjectMeta>(path.join(dir, 'meta.json'), { title: d.name }).title,
        summary: ordered.slice(0, 3).map((c) => c.label).join(' · '),
        updatedAt: updated.toISOString(),
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveAsset(slug: string, filename: string, body: Buffer) {
  const ext = path.extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
  const name = `${Date.now()}_${newId().slice(0, 6)}${ext}`;
  fs.writeFileSync(path.join(projectDir(slug), 'assets', name), body);
  return `/projects/${slug}/assets/${name}`;
}

/** The writer's own outlines. Shared across all documents, so stored beside them rather than inside one. */
const ARCHETYPES = path.join(ROOT, '_archetypes.json');
export function readArchetypes(): StructureDef[] {
  return fs.existsSync(ARCHETYPES) ? JSON.parse(fs.readFileSync(ARCHETYPES, 'utf8')) : [];
}
export function writeArchetypes(list: StructureDef[]) {
  fs.mkdirSync(ROOT, { recursive: true });
  writeAtomic(ARCHETYPES, JSON.stringify(list, null, 2) + '\n');
}
