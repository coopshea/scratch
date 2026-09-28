import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { checkKeyShape, FREE_PARSES, MAX_ACCOUNTS, type Account, type Accounts } from './accounts.ts';
import { describeError, parseBlurt, ParseFailure, type ParsedUnit } from './parser.ts';
import {
  appendEvent, assertSlug, inSpace, root, userRoot, trashProject, getBlurt, HttpError, listProjects, readArchetypes, writeArchetypes, loadProject, newId, projectDir, readDraft, readMeta, readUnits, saveAsset, saveBlurt,
  withLock, writeBoard, writeDraft, writeMeta, writeUnits,
} from './store.ts';
import { outlineToStructure, slugify, structureMap, STRUCTURES, type Board, type Lane } from '../shared/structures.ts';
import { UNIT_TYPES as TYPES } from '../shared/types.ts';
import { toMarkdown } from '../shared/export.ts';
import * as readwise from './readwise.ts';
import { cutLabel, locate, noteBlocks } from './text.ts';
import { canHold, canHoldUnit, isRoot, settle } from '../shared/clusters.ts';
import { labelProblem, UNIT_TYPES, type Blurt, type Unit } from '../shared/types.ts';

/**
 * The hosted site: who is signed in (Clerk in production, a stand-in in tests) and their account.
 * Without it the app runs as before: one local writer, the server's own key, no limits.
 */
export type Hosted = {
  userId: (req: Request) => string | null;
  email: (userId: string) => Promise<string | null>;
  accounts: Accounts;
  /** Middleware that reads the session before userId is asked, e.g. clerkMiddleware(). */
  session?: express.RequestHandler;
};

const BLURT_MAX = 20_000; // characters; hosted only, to bound what one parse can cost

/** The whole API, without the dev server, so tests can call it directly. */
export function createApp(hosted?: Hosted): Express {
  const app = express();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) =>
    (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);
  const slugOf = (req: Request) => String(req.params.slug);
  const accountOf = (res: Response) => res.locals.account as Account | undefined;

  if (hosted) {
    app.set('trust proxy', 1); // one proxy in front (Railway), so rate limits see the real client address
    // CSP is off for now: Clerk, BlockNote and Mantine each need their own allowances. The other headers are on.
    app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
    const limit = (windowMs: number, limit: number, message: string, byUser = true) => rateLimit({
      windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: message },
      ...(byUser ? { keyGenerator: (_req: Request, res: Response) => accountOf(res)!.id } : {}),
    });
    // Before sign-in is checked: bounds how hard any one address can hit the server at all.
    app.use(['/api', '/projects'], limit(60_000, 600, 'Too many requests. Wait a minute.', false));
    if (hosted.session) app.use(['/api', '/projects'], hosted.session);
    app.use(['/api', '/projects'], (req: Request, res: Response, next: NextFunction) => {
      (async () => {
        const id = hosted.userId(req);
        if (!id) throw new HttpError(401, 'Sign in to use Scratch');
        const account = await hosted.accounts.admit(id, () => hosted.email(id));
        if (!account) throw new HttpError(403, `Scratch is full for now (${MAX_ACCOUNTS} writers). Check back soon.`);
        res.locals.account = account;
        return userRoot(id);
      })().then(
        (dir) => inSpace(dir, next), // everything after this runs inside the writer's own folder
        next,
      );
    });
    // Per writer, after sign-in. Parses cost money, so they get the tightest limits.
    app.use(['/api', '/projects'], limit(60_000, 300, 'Too many requests. Wait a minute.'));
    app.use(['/api/p/:slug/blurts'], limit(60_000, 6, 'Too many parses in a minute. Wait a moment.'));
    app.use(['/api/p/:slug/blurts'], limit(24 * 3600_000, 100, 'Daily parse limit reached. Try again tomorrow.'));
    app.use(['/api/p/:slug/assets'], limit(3600_000, 60, 'Too many uploads this hour.'));
    app.use(['/api/projects'], limit(3600_000, 60, 'Too many new documents this hour.'));
  }

  app.use(express.json({ limit: '5mb' }));

  app.get('/api/me', wrap((_req, res) => {
    const account = accountOf(res);
    res.json(account ? { hosted: true, account, freeParses: FREE_PARSES } : { hosted: false });
  }));

  /** The writer's own Anthropic key, for parses after the free ones. Stored encrypted; only the last 4 characters come back. */
  app.put('/api/me/key', wrap(async (req, res) => {
    const account = accountOf(res);
    if (!account || !hosted) throw new HttpError(404, 'Not available locally; the key lives in .env');
    const key = String(req.body?.key ?? '').trim();
    checkKeyShape(key);
    await hosted.accounts.setKey(account.id, key);
    res.json(await hosted.accounts.get(account.id));
  }));

  app.delete('/api/me/key', wrap(async (_req, res) => {
    const account = accountOf(res);
    if (!account || !hosted) throw new HttpError(404, 'Not available locally; the key lives in .env');
    await hosted.accounts.setKey(account.id, null);
    res.json(await hosted.accounts.get(account.id));
  }));

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

  app.delete('/api/p/:slug', wrap((req, res) => {
    trashProject(slugOf(req));
    res.json({ ok: true });
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

  /** Hosted, a parse spends one free try or uses the writer's own key. A failed parse gives the free try back. */
  async function runParse(slug: string, blurt: Blurt, account?: Account) {
    let apiKey: string | undefined;
    let free = false;
    if (account && hosted) {
      const paid = await hosted.accounts.takeParse(account.id);
      if (!paid) throw new HttpError(402, `You've used your ${FREE_PARSES} free parses. Add your own Anthropic API key on your account page to keep going.`);
      ({ apiKey, free } = paid);
    }
    try {
      return await parseInto(slug, blurt, apiKey);
    } catch (e) {
      if (free) await hosted!.accounts.refundParse(account!.id);
      throw e;
    }
  }

  async function parseInto(slug: string, blurt: Blurt, apiKey?: string) {
    const before = readUnits(slug);
    const live = before.filter((u) => u.status !== 'cut');
    const vocab = [...new Set(live.map((u) => u.label))];
    const roots = live.filter(isRoot).map((u) => ({ id: u.id, type: u.type, label: u.label }));

    const parsed = await parseBlurt(blurt.text, vocab, roots, apiKey);

    return withLock(slug, () => {
      const units = readUnits(slug);
      // Controlled vocabulary: the first spelling of a label wins, including within this parse.
      const byLabel = new Map<string, string>();
      for (const u of units) if (!byLabel.has(u.label.toLowerCase())) byLabel.set(u.label.toLowerCase(), u.label);
      const rootIds = new Set(units.filter((u) => u.status !== 'cut' && isRoot(u)).map((u) => u.id));
      const keyToId = new Map<string, string>();
      parsed.forEach((p) => keyToId.set(p.key, newId()));
      const byKey = new Map(parsed.map((p) => [p.key, p]));
      // One level deep: a piece belongs to a root. If the model nests deeper, the piece moves up to that root.
      const parentOf = (p: ParsedUnit, seen = new Set<string>()): string | null => {
        if (!p.home || seen.has(p.key)) return null;
        seen.add(p.key);
        const local = byKey.get(p.home);
        if (local && local.key !== p.key && canHold(local.type)) return parentOf(local, seen) ?? keyToId.get(local.key)!;
        return rootIds.has(p.home) ? p.home : null;
      };

      const created: Unit[] = parsed.map((p: ParsedUnit) => {
        const loc = locate(blurt.text, p.text);
        const key = p.label.trim().toLowerCase();
        if (!byLabel.has(key)) byLabel.set(key, p.label.trim());
        const label = byLabel.get(key)!;
        const home = parentOf(p);
        return {
          id: keyToId.get(p.key)!,
          type: p.type,
          label,
          text: loc ? blurt.text.slice(loc[0], loc[1]) : p.text,
          blurtId: blurt.id,
          start: loc ? loc[0] : -1,
          end: loc ? loc[1] : -1,
          home,
          status: 'accepted',
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

  const parseStatus = (e: unknown) => e instanceof HttpError ? e.status : e instanceof ParseFailure ? 422 : 502;

  app.post('/api/p/:slug/blurts', wrap(async (req, res) => {
    const slug = slugOf(req);
    const text = String(req.body?.text ?? '');
    if (!text.trim()) throw new HttpError(400, 'Blurt is empty');
    if (hosted && text.length > BLURT_MAX) throw new HttpError(413, `Blurts are limited to ${BLURT_MAX.toLocaleString()} characters. Split it and try again.`);
    const blurt = saveBlurt(slug, text);
    appendEvent(slug, 'human', 'blurt.create', { id: blurt.id, text });
    try {
      const units = await runParse(slug, blurt, accountOf(res));
      res.json({ blurt, units });
    } catch (e) {
      res.status(parseStatus(e)).json({ blurt, units: [], error: describeError(e) });
    }
  }));

  app.post('/api/p/:slug/blurts/:id/parse', wrap(async (req, res) => {
    const slug = slugOf(req);
    const blurt = getBlurt(slug, String(req.params.id));
    try {
      res.json({ blurt, units: await runParse(slug, blurt, accountOf(res)) });
    } catch (e) {
      res.status(parseStatus(e)).json({ blurt, units: [], error: describeError(e) });
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
      if (patch.home !== undefined && patch.home !== null && !canHoldUnit(units.find((x) => x.id === patch.home), u)) {
        throw new HttpError(400, 'A piece can only go under a claim or question that belongs to nothing');
      }
      Object.assign(u, patch);
      if (patch.label !== undefined) { u.labeledBy = 'human'; if (u.flags) delete u.flags.labelTooLong; }
      if (patch.type !== undefined) u.labeledBy = 'human';
      // One level deep: a piece that can no longer hold others lets its pieces go loose.
      settle(units, u);
      writeUnits(slug, units);
      appendEvent(slug, 'human', 'unit.update', { id, patch });
      return u;
    });
    res.json(unit);
  }));

  // Readwise uses one server-wide token, so it stays off on the hosted site until tokens are per writer.
  const readwiseOn = () => !hosted && readwise.enabled();
  app.get('/api/readwise/status', wrap(async (_req, res) =>
    res.json(hosted ? { token: false, search: false, error: 'Readwise is not available on the hosted site yet' } : await readwise.check())));

  /** Passages from the writer's own reading that relate to a query. Ones already in the document are left out. */
  app.post('/api/p/:slug/readwise/search', wrap(async (req, res) => {
    const slug = slugOf(req);
    if (!readwiseOn()) return res.json({ enabled: false, passages: [] });
    const query = String(req.body?.query ?? '').trim().slice(0, 1000);
    if (!query) throw new HttpError(400, 'Query is empty');
    const have = new Set(readUnits(slug).flatMap((u) => (u.source ? [u.source.id] : [])));
    const passages = (await readwise.search(query, 12)).filter((p) => !have.has(p.id));
    res.json({ enabled: true, passages });
  }));

  /** Bring one passage into the document as evidence. The words are fetched from Readwise here, not taken from the client. */
  app.post('/api/p/:slug/readwise/adopt', wrap(async (req, res) => {
    const slug = slugOf(req);
    if (!readwiseOn()) throw new HttpError(400, 'READWISE_TOKEN is not set in .env');
    const id = String(req.body?.id ?? '');
    const existing = readUnits(slug).find((u) => u.source?.id === id);
    if (existing) return res.json(existing);
    const p = await readwise.getPassage(id);
    const unit = await withLock(slug, () => {
      const units = readUnits(slug);
      const home = req.body?.home ? String(req.body.home) : null;
      if (home && !units.some((u) => u.id === home && isRoot(u))) throw new HttpError(400, 'A piece can only go under a claim or question that belongs to nothing');
      const u: Unit = {
        id: newId(), type: 'evidence', label: cutLabel(p.quote), text: p.quote,
        blurtId: null, start: -1, end: -1, home, status: 'accepted',
        origin: 'source', labeledBy: 'system', verified: false,
        note: p.note ? noteBlocks(p.note) : null,
        source: { kind: 'readwise', id: p.id, title: p.title, author: p.author, url: p.url },
        createdAt: new Date().toISOString(),
      };
      writeUnits(slug, [...units, u]);
      appendEvent(slug, 'human', 'source.adopt', { unit: u });
      return u;
    });
    res.json(unit);
  }));

  app.post('/api/p/:slug/assets', express.raw({ type: () => true, limit: '25mb' }), wrap((req, res) => {
    const slug = slugOf(req);
    const name = String(req.header('x-filename') ?? 'upload.bin');
    const url = saveAsset(slug, name, req.body as Buffer);
    appendEvent(slug, 'human', 'asset.upload', { url, name });
    res.json({ url });
  }));

  // Only pasted images are served, and only the signed-in writer's own.
  app.get('/projects/:slug/assets/:file', wrap((req, res) => {
    const file = String(req.params.file);
    if (!/^[\w.-]+$/.test(file) || file.startsWith('.')) throw new HttpError(400, 'Invalid file');
    assertSlug(slugOf(req));
    res.sendFile(path.join(slugOf(req), 'assets', file), {
      root: root(), dotfiles: 'deny',
      // An uploaded SVG or HTML file opened directly cannot run script.
      headers: { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" },
    });
  }));

  app.use(['/api', '/projects'], (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Our own errors, and library ones that carry a client status (a missing file, a body too large).
    const own = (err as { status?: unknown }).status;
    const status = err instanceof HttpError ? err.status : typeof own === 'number' && own >= 400 && own < 500 ? own : 500;
    if (status === 500) console.error(err);
    // Hosted, only our own messages reach the browser; others can carry server paths.
    const message = err instanceof HttpError || !hosted ? (err as Error).message : status === 404 ? 'Not found' : 'Server error';
    res.status(status).json({ error: message ?? 'Server error' });
  });

  return app;
}
