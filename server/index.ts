import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { describeError, parseBlurt, ParseFailure, type ParsedUnit } from './parser.ts';
import {
  appendEvent, getBlurt, HttpError, listProjects, readArchetypes, writeArchetypes, loadProject, newId, projectDir, readDraft, readMeta, readUnits, saveAsset, saveBlurt,
  withLock, writeBoard, writeDraft, writeMeta, writeUnits,
} from './store.ts';
import { outlineToStructure, slugify, structureMap, STRUCTURES, type Board, type Lane } from '../shared/structures.ts';
import { UNIT_TYPES as TYPES } from '../shared/types.ts';
import { toMarkdown } from '../shared/export.ts';
import { labelProblem, UNIT_TYPES, type Blurt, type Unit } from '../shared/types.ts';

const PORT = Number(process.env.PORT ?? 5178);
const app = express();
app.use(express.json({ limit: '5mb' }));

const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) =>
  (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);
const slugOf = (req: Request) => String(req.params.slug);

app.get('/api/p/:slug', wrap((req, res) => res.json(loadProject(slugOf(req)))));

app.get('/api/projects', wrap((_req, res) => res.json(listProjects())));

const ROLES = ['hook', 'context', 'thesis', 'point', 'example', 'objection', 'close', 'footnote'];
function sanitizeLanes(raw: unknown[]): Lane[] {
  const seen = new Set<string>();
  return raw.flatMap((r) => {
    const l = r as Partial<Lane>;
    const id = slugify(String(l.id ?? l.name ?? ''));
    const name = String(l.name ?? '').trim().toLowerCase().slice(0, 60);
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    return [{
      id, name,
      role: (ROLES.includes(String(l.role)) ? l.role : 'point') as Lane['role'],
      accepts: Array.isArray(l.accepts) ? l.accepts.filter((a) => (TYPES as readonly string[]).includes(a)) : [...TYPES],
      single: !!l.single, required: !!l.required,
    }];
  });
}

app.get('/api/archetypes', wrap((_req, res) => res.json(readArchetypes())));

/** Create or replace one of the writer's own outlines. Level ids come from level names, so renaming nothing keeps placements. */
app.put('/api/archetypes', wrap((req, res) => {
  const name = String(req.body?.name ?? '').trim().slice(0, 60);
  const outline = String(req.body?.outline ?? '');
  if (!name) throw new HttpError(400, 'Name the outline');
  const list = readArchetypes();
  const id = req.body?.id && list.some((a) => a.id === req.body.id) ? String(req.body.id) : (() => {
    const base = `c-${slugify(name) || 'outline'}`;
    let x = base;
    for (let i = 2; list.some((a) => a.id === x) || STRUCTURES[x]; i++) x = `${base}-${i}`;
    return x;
  })();
  // Either a typed outline, or explicit levels (used when adding a level in place, so existing level ids survive).
  const def = Array.isArray(req.body?.lanes)
    ? { id, name: name.toLowerCase(), custom: true, lanes: sanitizeLanes(req.body.lanes) }
    : outlineToStructure(name, outline, id);
  if (!def.lanes.length) throw new HttpError(400, 'Add at least one level');
  writeArchetypes([...list.filter((a) => a.id !== id), def]);
  res.json(def);
}));

app.delete('/api/archetypes/:id', wrap((req, res) => {
  writeArchetypes(readArchetypes().filter((a) => a.id !== String(req.params.id)));
  res.json({ ok: true });
}));

app.get('/api/p/:slug/export.md', wrap((req, res) => {
  const slug = slugOf(req);
  const p = loadProject(slug);
  const md = toMarkdown(p.meta.title, p.draft, p.units);
  appendEvent(slug, 'human', 'export', { format: 'markdown', via: req.query.copy ? 'copy' : 'download', bytes: md.length });
  const file = (p.meta.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || slug) + '.md';
  res.type('text/markdown; charset=utf-8');
  if (!req.query.copy) res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
  res.send(md);
}));

app.post('/api/projects', wrap((req, res) => {
  const title = String(req.body?.title ?? '').trim() || 'untitled';
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'untitled';
  const taken = new Set(listProjects().map((p) => p.slug));
  let slug = base, i = 2;
  while (taken.has(slug)) slug = `${base}-${i++}`;
  projectDir(slug);
  writeMeta(slug, { title });
  appendEvent(slug, 'human', 'project.create', { title });
  res.json({ slug, title });
}));

app.patch('/api/p/:slug/meta', wrap((req, res) => {
  const slug = slugOf(req);
  const title = String(req.body?.title ?? '').trim().slice(0, 120);
  if (!title) throw new HttpError(400, 'Title is empty');
  const meta = { ...readMeta(slug), title };
  writeMeta(slug, meta);
  appendEvent(slug, 'human', 'project.rename', { title });
  res.json(meta);
}));

app.put('/api/p/:slug/board', wrap(async (req, res) => {
  const slug = slugOf(req);
  const b = req.body as Board;
  const known = structureMap(readArchetypes());
  if (!b || !known[b.structure] || typeof b.lanes !== 'object') throw new HttpError(400, 'Invalid board');
  const clean: Board = { structure: b.structure, lanes: { paper: {}, persuasive: {}, teaching: {} } };
  for (const sid of Object.keys(b.lanes)) {
    if (!known[sid]) continue;
    clean.lanes[sid] = {};
    const valid = new Set(known[sid].lanes.map((l) => l.id));
    for (const [laneId, ids] of Object.entries(b.lanes[sid] ?? {})) {
      if (valid.has(laneId) && Array.isArray(ids)) clean.lanes[sid][laneId] = ids.map(String);
    }
  }
  const author = req.query.auto ? 'system' : 'human';
  await withLock(slug, () => { writeBoard(slug, clean); appendEvent(slug, author, 'board.update', clean); });
  res.json(clean);
}));

app.put('/api/p/:slug/draft', wrap(async (req, res) => {
  const slug = slugOf(req);
  const text = String(req.body?.text ?? '');
  await withLock(slug, () => {
    if (readDraft(slug) === text) return;
    writeDraft(slug, text);
    appendEvent(slug, 'human', 'draft.snapshot', { text });
  });
  res.json({ ok: true });
}));

app.get('/api/p/:slug/events', wrap((req, res) => {
  const file = path.join(projectDir(slugOf(req)), 'events.jsonl');
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  res.json(lines.map((l) => JSON.parse(l)).filter((e) => e.type !== 'layout.move' && e.type !== 'layout.auto'));
}));

/** Find the parser's text in the blurt. Returns the true verbatim slice, tolerating whitespace and quote-style drift. */
function locate(hay: string, needle: string): [number, number] | null {
  const exact = hay.indexOf(needle);
  if (exact >= 0) return [exact, exact + needle.length];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['‘’]/g, "['‘’]").replace(/["“”]/g, '["“”]');
  const words = needle.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const m = new RegExp(words.map(esc).join('\\s+')).exec(hay);
  return m ? [m.index, m.index + m[0].length] : null;
}

async function runParse(slug: string, blurt: Blurt) {
  const before = readUnits(slug);
  const live = before.filter((u) => u.status !== 'cut');
  const vocab = [...new Set(live.map((u) => u.label))];
  const claims = live.filter((u) => u.type === 'claim').map((u) => ({ id: u.id, label: u.label }));

  const parsed = await parseBlurt(blurt.text, vocab, claims);

  return withLock(slug, () => {
    const units = readUnits(slug);
    const byLabel = new Map(units.map((u) => [u.label.toLowerCase(), u.label]));
    const claimIds = new Set(units.filter((u) => u.type === 'claim').map((u) => u.id));
    const keyToId = new Map<string, string>();
    parsed.forEach((p) => keyToId.set(p.key, newId()));

    const created: Unit[] = parsed.map((p: ParsedUnit) => {
      const loc = locate(blurt.text, p.text);
      const label = byLabel.get(p.label.trim().toLowerCase()) ?? p.label.trim();
      let home: string | null = null;
      if (p.type !== 'claim' && p.home) {
        const local = parsed.find((q) => q.key === p.home && q.type === 'claim');
        if (local) home = keyToId.get(local.key)!;
        else if (claimIds.has(p.home)) home = p.home;
      }
      return {
        id: keyToId.get(p.key)!,
        type: p.type,
        label,
        text: loc ? blurt.text.slice(loc[0], loc[1]) : p.text,
        blurtId: blurt.id,
        start: loc ? loc[0] : -1,
        end: loc ? loc[1] : -1,
        home,
        status: 'proposed',
        origin: 'human',
        labeledBy: 'model',
        verified: false,
        note: null,
        flags: { notVerbatim: !loc || undefined, labelTooLong: labelProblem(label) ? true : undefined },
        createdAt: new Date().toISOString(),
      };
    });

    writeUnits(slug, [...units, ...created]);
    appendEvent(slug, 'model', 'parse', { blurtId: blurt.id, units: created });
    return created;
  });
}

app.post('/api/p/:slug/blurts', wrap(async (req, res) => {
  const slug = slugOf(req);
  const text = String(req.body?.text ?? '');
  if (!text.trim()) throw new HttpError(400, 'Blurt is empty');
  const blurt = saveBlurt(slug, text);
  appendEvent(slug, 'human', 'blurt.create', { id: blurt.id, text });
  try {
    const units = await runParse(slug, blurt);
    res.json({ blurt, units });
  } catch (e) {
    res.status(e instanceof ParseFailure ? 422 : 502).json({ blurt, units: [], error: describeError(e) });
  }
}));

app.post('/api/p/:slug/blurts/:id/parse', wrap(async (req, res) => {
  const slug = slugOf(req);
  const blurt = getBlurt(slug, String(req.params.id));
  try {
    res.json({ blurt, units: await runParse(slug, blurt) });
  } catch (e) {
    res.status(e instanceof ParseFailure ? 422 : 502).json({ blurt, units: [], error: describeError(e) });
  }
}));

const EDITABLE = ['type', 'label', 'home', 'status', 'note', 'priorArt', 'verified'] as const;

app.patch('/api/p/:slug/units/:id', wrap(async (req, res) => {
  const slug = slugOf(req);
  const id = String(req.params.id);
  const patch: Partial<Unit> = {};
  for (const k of EDITABLE) if (k in (req.body ?? {})) (patch as Record<string, unknown>)[k] = req.body[k];
  if (patch.type && !UNIT_TYPES.includes(patch.type)) throw new HttpError(400, 'Unknown type');
  if (patch.status && !['proposed', 'accepted', 'cut'].includes(patch.status)) throw new HttpError(400, 'Unknown status');
  if (patch.label !== undefined) {
    patch.label = String(patch.label).trim();
    const problem = labelProblem(patch.label);
    if (problem) throw new HttpError(400, problem);
  }
  const unit = await withLock(slug, () => {
    const units = readUnits(slug);
    const u = units.find((x) => x.id === id);
    if (!u) throw new HttpError(404, 'Unit not found');
    if (patch.home !== undefined && patch.home !== null) {
      const target = units.find((x) => x.id === patch.home);
      if (!target || target.type !== 'claim' || target.id === u.id) throw new HttpError(400, 'Home must be another claim');
    }
    Object.assign(u, patch);
    if (patch.label !== undefined) { u.labeledBy = 'human'; if (u.flags) delete u.flags.labelTooLong; }
    if (patch.type !== undefined) u.labeledBy = 'human';
    if (u.type === 'claim') u.home = null;
    // A claim that stops being a claim releases its children to the unassigned tray.
    if (patch.type !== undefined && patch.type !== 'claim') units.forEach((x) => { if (x.home === u.id) x.home = null; });
    writeUnits(slug, units);
    appendEvent(slug, 'human', 'unit.update', { id, patch });
    return u;
  });
  res.json(unit);
}));

app.post('/api/p/:slug/positions', wrap(async (req, res) => {
  const slug = slugOf(req);
  const moves = Array.isArray(req.body) ? req.body as { id: string; x: number; y: number }[] : [];
  await withLock(slug, () => {
    const units = readUnits(slug);
    const byId = new Map(units.map((u) => [u.id, u]));
    const applied = moves.filter((m) => byId.has(m.id) && Number.isFinite(m.x) && Number.isFinite(m.y))
      .map((m) => { const u = byId.get(m.id)!; u.x = Math.round(m.x); u.y = Math.round(m.y); return { id: m.id, x: u.x, y: u.y }; });
    if (!applied.length) return;
    writeUnits(slug, units);
    appendEvent(slug, req.query.auto ? 'system' : 'human', req.query.auto ? 'layout.auto' : 'layout.move', applied);
  });
  res.json({ ok: true });
}));

app.post('/api/p/:slug/assets', express.raw({ type: () => true, limit: '25mb' }), wrap((req, res) => {
  const slug = slugOf(req);
  const name = String(req.header('x-filename') ?? 'upload.bin');
  const url = saveAsset(slug, name, req.body as Buffer);
  appendEvent(slug, 'human', 'asset.upload', { url, name });
  res.json({ url });
}));

app.use('/projects', express.static(path.resolve('projects')));

app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: (err as Error).message ?? 'Server error' });
});

const vite = await createViteServer({ server: { middlewareMode: true, hmr: { port: PORT + 20000 } }, appType: 'spa' });
app.use(vite.middlewares);

projectDir('scratch');
app.listen(PORT, () => console.log(`drafting tool on http://localhost:${PORT}`));
