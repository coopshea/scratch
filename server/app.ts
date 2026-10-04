import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { checkKeyShape, checkReadwiseShape, FREE_PARSES, MAX_ACCOUNTS, type Account, type Accounts, type Paid } from './accounts.ts';
import { CREDIT_MICROS, DONATION_CENTS, MAX_CENTS, MIN_CENTS, STRIPE_FEE, type Back, type Billing } from './billing.ts';
import type { Usage } from './parser.ts';
import { captureServerError } from './posthog.ts';
import { describeError, isWriterFacing, parseBlurt, ParseFailure, type ExistingNode, type ParsedUnit } from './parser.ts';
import {
  appendEvent, assertSlug, copyExample, inSpace, root, userRoot, trashProject, getBlurt, HttpError, listProjects, readArchetypes, writeArchetypes, loadProject, newId, projectDir, readDraft, readMeta, readUnits, saveAsset,
  closeOpenSpill, listBlurts, markParsed, readOpenSpill, saveOpenSpill, withLock, writeBoard, writeDraft, writeMeta, writeUnits,
} from './store.ts';
import { outlineToStructure, slugify, structureMap, STRUCTURES, type Board, type Lane } from '../shared/structures.ts';
import { UNIT_TYPES as TYPES } from '../shared/types.ts';
import { toMarkdown } from '../shared/export.ts';
import * as readwise from './readwise.ts';
import { cutLabel, locate } from './text.ts';
import { canHold, canHoldUnit, isRoot, nestTarget, settle } from '../shared/clusters.ts';
import { labelProblem, UNIT_TYPES, type Blurt, type Unit, type UnitType } from '../shared/types.ts';

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
  /** Buying parses through Stripe. Without it, writers bring their own key after the free parses. */
  billing?: Billing;
};

// About 5 pages, hosted only. The parser copies every word back, so a longer blurt would outrun one response's
// output ceiling and fail anyway; it also bounds what one parse costs (roughly 2 to 20 cents).
export const BLURT_MAX = 14_000;
const SAVE_MAX = 200_000; // not even saved beyond this
const HAND_CUT_MAX = 5_000; // one highlighted idea, not a whole spill
/** Spill suggestions: threads searched, passages offered per thread, the most offered, and how close a match must be. */
const PULL_THREADS = 7, PULL_PER_THREAD = 3, PULL_MAX = 10, PULL_MIN_SCORE = 0.02;

/**
 * A passage from the writer's reading as one idea: their note leads (their words, so origin human), with the
 * highlight and where it's from kept beside it. A highlight with no note is the source's words alone (origin source).
 */
function fromPassage(p: readwise.Passage, home: string | null): Unit {
  const text = p.note || p.quote;
  return {
    id: newId(), type: 'evidence', label: cutLabel(text), text,
    blurtId: null, start: -1, end: -1, home, status: 'accepted',
    // Verified: the passage and its source came straight from Readwise, so the citation is real.
    origin: p.note ? 'human' : 'source', labeledBy: 'system', verified: true, note: null,
    source: { kind: 'readwise', id: p.id, quote: p.quote, title: p.title, author: p.author, url: p.url },
    createdAt: new Date().toISOString(),
  };
}

/** Parses on the site's key are charged at Anthropic's price times this. 1: the site runs at cost. */
export const USAGE_MARKUP = Number(process.env.USAGE_MARKUP || 1);

/** Out of parses. The response carries `buy` so the page can point to the account page. */
class OutOfParses extends HttpError {
  constructor(message: string, public buy: boolean) { super(402, message); }
}

/** The site's owners (ADMIN_EMAILS, comma-separated): no per-writer rate limits, no free-parse quota, no blurt cap. */
const admins = () => new Set((process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
const isAdmin = (a?: Account) => !!a?.email && admins().has(a.email.toLowerCase());

/** The whole API, without the dev server, so tests can call it directly. */
export function createApp(hosted?: Hosted): Express {
  const app = express();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) =>
    (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);
  const slugOf = (req: Request) => String(req.params.slug);
  const accountOf = (res: Response) => res.locals.account as Account | undefined;
  const origin = (req: Request) => process.env.PUBLIC_URL?.replace(/\/$/, '') ?? `${req.protocol}://${req.get('host')}`;

  if (hosted?.billing) {
    // Before the JSON parser and outside sign-in: Stripe calls this, and its signature is checked on the raw body.
    const billing = hosted.billing;
    app.post('/stripe/webhook', express.raw({ type: () => true, limit: '1mb' }), wrap(async (req, res) => {
      await billing.webhook(req.body as Buffer, String(req.header('stripe-signature') ?? ''));
      res.json({ received: true });
    }));
  }

  if (hosted) {
    app.set('trust proxy', 1); // one proxy in front (Railway), so rate limits see the real client address
    // CSP is off for now: Clerk, BlockNote and Mantine each need their own allowances. The other headers are on.
    app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
    const limit = (windowMs: number, limit: number, message: string, byUser = true) => rateLimit({
      windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: message },
      ...(byUser ? { keyGenerator: (_req: Request, res: Response) => accountOf(res)!.id, skip: (_req: Request, res: Response) => isAdmin(accountOf(res)) } : {}),
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
    res.json(account ? {
      hosted: true, account, unlimited: isAdmin(account),
      billing: !!hosted?.billing,
      pricing: { freeParses: FREE_PARSES, markup: USAGE_MARKUP, creditMicros: CREDIT_MICROS * USAGE_MARKUP, minCents: MIN_CENTS, maxCents: MAX_CENTS, fee: STRIPE_FEE, donationCents: DONATION_CENTS },
    } : { hosted: false });
  }));

  /** Stripe Checkout for a top-up or a monthly subscription for an amount the writer picks, or the fixed donation. */
  app.post('/api/billing/checkout', wrap(async (req, res) => {
    const account = accountOf(res);
    if (!account || !hosted?.billing) throw new HttpError(404, 'Billing is not set up');
    if (req.body?.what === 'donation') return res.json({ url: await hosted.billing.checkoutUrl(account, origin(req), 'donation', DONATION_CENTS) });
    const what = req.body?.what === 'subscription' ? 'subscription' : 'topup';
    const cents = Math.round(Number(req.body?.cents));
    if (!Number.isFinite(cents) || cents < MIN_CENTS || cents > MAX_CENTS) {
      throw new HttpError(400, `Pick an amount from $${MIN_CENTS / 100} to $${MAX_CENTS / 100}`);
    }
    // Already subscribed: change or cancel on Stripe's billing page, not a second subscription.
    if (what === 'subscription' && account.subscribed) return res.json({ url: await hosted.billing.portalUrl(account, origin(req)) });
    // From the out-of-credits notice: come back to the document and cut the spill. Only ids of the shapes we issue,
    // so the return address can't be pointed anywhere else.
    const b = req.body?.back;
    const back: Back | undefined = what === 'topup' && typeof b?.slug === 'string' && typeof b?.blurt === 'string'
      && /^[a-z0-9][a-z0-9-]{0,63}$/.test(b.slug) && /^[A-Za-z0-9_-]{1,64}$/.test(b.blurt) ? { slug: b.slug, blurt: b.blurt } : undefined;
    res.json({ url: await hosted.billing.checkoutUrl(account, origin(req), what, cents, back) });
  }));

  app.post('/api/billing/portal', wrap(async (req, res) => {
    const account = accountOf(res);
    if (!account || !hosted?.billing) throw new HttpError(404, 'Billing is not set up');
    res.json({ url: await hosted.billing.portalUrl(account, origin(req)) });
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

  /** A slug for a new document: `base`, or `base-2`, `base-3`… when taken. */
  const freeSlug = (base: string) => {
    const taken = new Set(listProjects().map((p) => p.slug));
    let slug = base, i = 2;
    while (taken.has(slug)) slug = `${base}-${i++}`;
    return slug;
  };

  app.post('/api/projects', wrap((req, res) => {
    const title = String(req.body?.title ?? '').trim() || 'untitled';
    const slug = freeSlug(title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'untitled');
    projectDir(slug);
    writeMeta(slug, { title });
    appendEvent(slug, 'human', 'project.create', { title });
    res.json({ slug, title });
  }));

  /**
   * A sample document, copied into the writer's own space (store.ts). No parse runs, so it costs nothing. Each open
   * is a fresh copy: nothing to track, and a writer who has edited theirs can always get a clean one.
   */
  app.post('/api/projects/example', wrap((req, res) => {
    const name = String(req.body?.name ?? 'gas-turbines');
    const slug = freeSlug(`example-${name}`.slice(0, 64));
    const { title } = copyExample(name, slug);
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

  /**
   * Hosted, a parse is paid for by a free parse, the prepaid balance or the writer's own key (accounts.ts).
   * The balance is charged what the parse cost, after it succeeds; a failed parse gives back a free parse.
   */
  async function runParse(slug: string, blurt: Blurt, account?: Account) {
    let paid: Paid | undefined;
    if (account && hosted && !isAdmin(account)) {
      if (blurt.text.length > BLURT_MAX) throw new HttpError(413, "That's longer than one parse can take. It's saved; split it and paste the parts.");
      const got = await hosted.accounts.takeParse(account.id);
      if ('denied' in got) {
        throw new OutOfParses(hosted.billing
          ? 'Out of parses. Add money or your own Anthropic key on your account page. Your blurt is saved.'
          : 'Out of parses. Add your own Anthropic key on your account page. Your blurt is saved.', true);
      }
      paid = got;
    }
    // Tokens the model used are paid for whether or not the parse succeeded; a free parse is given back only when
    // the model was never reached, so a failing parse can't be repeated for free at the site's expense.
    let usage: Usage | undefined;
    const settle = async () => {
      if (paid?.kind === 'balance' && usage) await hosted!.accounts.charge(account!.id, usage.usd * USAGE_MARKUP * 1e6);
      if (paid?.kind === 'free' && !usage) await hosted!.accounts.refundParse(account!.id, 'free');
    };
    try {
      const units = await parseInto(slug, blurt, paid?.apiKey, (u) => { usage = u; }, account?.id);
      await settle();
      return units;
    } catch (e) {
      await settle();
      throw e;
    }
  }

  async function parseInto(slug: string, blurt: Blurt, apiKey?: string, onUsage?: (u: Usage) => void, distinctId?: string) {
    const before = readUnits(slug);
    const live = before.filter((u) => u.status !== 'cut');
    const vocab = [...new Set(live.map((u) => u.label))];
    const roots = live.filter(isRoot).map((u) => ({ id: u.id, type: u.type, label: u.label }));
    // Every idea already here, as it stands, so the parser builds around it; the writer's own cuts are marked so they aren't cut twice.
    const nodes: ExistingNode[] = live.map((u) => ({
      id: u.id, type: u.type, label: u.label, home: u.home, text: u.text, ...(u.cutBy === 'human' ? { hand: true } : {}),
    }));

    const out = await parseBlurt(blurt.text, vocab, roots, apiKey, onUsage, { projectId: slug, distinctId }, nodes);
    const parsed = out.units;

    return withLock(slug, () => {
      const units = readUnits(slug);
      // The writer's own cuts from this spill, by position: located when the spill closed.
      const handSpans = units.filter((u) => u.cutBy === 'human' && u.status !== 'cut' && u.blurtId === blurt.id && u.start >= 0);
      // Controlled vocabulary: the first spelling of a label wins, including within this parse.
      const byLabel = new Map<string, string>();
      for (const u of units) if (!byLabel.has(u.label.toLowerCase())) byLabel.set(u.label.toLowerCase(), u.label);
      const rootIds = new Set(units.filter((u) => u.status !== 'cut' && isRoot(u)).map((u) => u.id));
      const keyToId = new Map<string, string>();
      parsed.forEach((p) => keyToId.set(p.key, newId()));
      const byKey = new Map(parsed.map((p) => [p.key, p]));
      const locOf = new Map(parsed.map((p) => [p.key, locate(blurt.text, p.text)]));
      // Words already cut aren't cut again: a parsed unit whose span overlaps a hand cut's is dropped, and pieces the
      // model hung under it go to the hand cut's cluster.
      const repeats = new Map<string, Unit>();
      for (const p of parsed) {
        const loc = locOf.get(p.key);
        const hand = loc && handSpans.find((h) => loc[0] < h.end && h.start < loc[1]);
        if (hand) repeats.set(p.key, hand);
      }
      // One level deep: a piece belongs to a root. If the model nests deeper, the piece moves up to that root.
      const parentOf = (p: Pick<ParsedUnit, 'key' | 'home'>, seen = new Set<string>()): string | null => {
        if (!p.home || seen.has(p.key)) return null;
        seen.add(p.key);
        const local = byKey.get(p.home);
        const hand = local && repeats.get(local.key);
        if (hand) return rootIds.has(hand.id) ? hand.id : hand.home && rootIds.has(hand.home) ? hand.home : null;
        if (local && local.key !== p.key && canHold(local.type)) return parentOf(local, seen) ?? keyToId.get(local.key)!;
        return rootIds.has(p.home) ? p.home : null;
      };

      const created: Unit[] = parsed.filter((p) => !repeats.has(p.key)).map((p: ParsedUnit) => {
        const loc = locOf.get(p.key);
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

      // The same call types and groups untyped ideas. Only what the writer hasn't set: a type where there is none
      // (an idea already holding pieces only becomes something that can hold them), and a home where there is none
      // and the writer didn't choose that by dragging.
      const all = [...units, ...created];
      const typed: { id: string; patch: Partial<Unit> }[] = [];
      for (const t of out.untyped) {
        const u = units.find((x) => x.id === t.id && x.status !== 'cut' && x.type === null);
        if (!u || !UNIT_TYPES.includes(t.type)) continue;
        const holds = all.some((x) => x.home === u.id && x.status !== 'cut');
        const patch: Partial<Unit> = {};
        if (!holds || canHold(t.type)) patch.type = t.type;
        const home = !u.home && u.homedBy !== 'human' && !holds ? parentOf({ key: `untyped:${u.id}`, home: t.home }) : null;
        if (home && home !== u.id) patch.home = home;
        if (!Object.keys(patch).length) continue;
        Object.assign(u, patch);
        typed.push({ id: u.id, patch });
      }

      writeUnits(slug, all);
      markParsed(slug, blurt.id);
      const skipped = [...repeats].map(([key, h]) => ({ text: byKey.get(key)!.text, start: locOf.get(key)![0], end: locOf.get(key)![1], handCut: h.id }));
      appendEvent(slug, 'model', 'parse', { blurtId: blurt.id, units: created, ...(skipped.length ? { skipped } : {}) });
      for (const t of typed) appendEvent(slug, 'model', 'unit.update', t);
      return created;
    });
  }

  /**
   * Close the open spill (parse is the only caller): its text becomes an immutable blurt, and each idea the writer cut
   * by hand from it is found in the final words. Found: its position is set. Not found (the words were edited away
   * after the drag): flagged, as a parsed cut that isn't verbatim is. Runs inside the project's lock.
   */
  function closeSpill(slug: string): Blurt | null {
    const blurt = closeOpenSpill(slug);
    if (!blurt) return null;
    appendEvent(slug, 'human', 'blurt.create', { id: blurt.id, text: blurt.text });
    const units = readUnits(slug);
    for (const u of units) {
      if (u.cutBy !== 'human' || u.blurtId !== blurt.id || u.start >= 0) continue;
      const loc = locate(blurt.text, u.text);
      const patch: Partial<Unit> = loc
        ? { start: loc[0], end: loc[1], ...(blurt.text.slice(loc[0], loc[1]) !== u.text ? { text: blurt.text.slice(loc[0], loc[1]) } : {}) }
        : { flags: { ...u.flags, notVerbatim: true } };
      Object.assign(u, patch);
      appendEvent(slug, 'system', 'unit.update', { id: u.id, patch });
    }
    writeUnits(slug, units);
    return blurt;
  }

  /** Save the spill box as the open spill: one logged event per save, and none when nothing changed. Inside the lock. */
  function saveSpill(slug: string, text: string, res: Response) {
    if (hosted && !isAdmin(accountOf(res)) && text.length > SAVE_MAX) throw new HttpError(413, 'That is too long to save as one blurt. Split it and try again.');
    const saved = saveOpenSpill(slug, text);
    if (saved) appendEvent(slug, 'human', 'blurt.update', { id: saved.id, text });
    return readOpenSpill(slug);
  }

  const parseStatus = (e: unknown) => e instanceof HttpError ? e.status : e instanceof ParseFailure ? 422 : 502;
  // Hosted, only messages written for the writer reach the browser; others can carry server paths.
  const parseError = (e: unknown) => {
    if (!hosted || e instanceof HttpError || isWriterFacing(e)) return describeError(e);
    console.error(e);
    captureServerError(e);
    return 'The parse failed. Your blurt is saved; try again.';
  };

  /** The spill box, saved as the writer goes (the page sends it after a pause in typing). */
  app.put('/api/p/:slug/spill', wrap(async (req, res) => {
    const slug = slugOf(req);
    const text = String(req.body?.text ?? '');
    res.json({ open: await withLock(slug, () => saveSpill(slug, text, res)) });
  }));

  /** Parse: takes the open spill (saving the box's latest text first, when sent), closes it, and cuts it into ideas. */
  app.post('/api/p/:slug/blurts', wrap(async (req, res) => {
    const slug = slugOf(req);
    const blurt = await withLock(slug, () => {
      // Sent text is saved first. With no open spill yet, the close below records the text in full, so no separate save is logged.
      const sent = req.body?.text;
      if (typeof sent === 'string') {
        if (readOpenSpill(slug)) saveSpill(slug, sent, res);
        else if (sent.trim()) saveOpenSpill(slug, sent);
      }
      const open = readOpenSpill(slug);
      if (!open?.text.trim()) throw new HttpError(400, 'Blurt is empty');
      if (hosted && !isAdmin(accountOf(res)) && open.text.length > SAVE_MAX) throw new HttpError(413, 'That is too long to save as one blurt. Split it and try again.');
      return closeSpill(slug)!;
    });
    try {
      const units = await runParse(slug, blurt, accountOf(res));
      res.json({ blurt, units });
    } catch (e) {
      res.status(parseStatus(e)).json({ blurt, units: [], error: parseError(e), ...(e instanceof OutOfParses ? { buy: true } : {}) });
    }
  }));

  /** Try again, after a failed parse. A closed spill that was parsed is never parsed again. */
  app.post('/api/p/:slug/blurts/:id/parse', wrap(async (req, res) => {
    const slug = slugOf(req);
    const blurt = getBlurt(slug, String(req.params.id));
    if (blurt.parsed || readUnits(slug).some((u) => u.blurtId === blurt.id && u.cutBy !== 'human')) throw new HttpError(409, 'That spill is already cut into ideas');
    try {
      res.json({ blurt, units: await runParse(slug, blurt, accountOf(res)) });
    } catch (e) {
      res.status(parseStatus(e)).json({ blurt, units: [], error: parseError(e), ...(e instanceof OutOfParses ? { buy: true } : {}) });
    }
  }));

  const EDITABLE = ['type', 'label', 'home', 'status', 'note', 'priorArt', 'verified'] as const;

  app.patch('/api/p/:slug/units/:id', wrap(async (req, res) => {
    const slug = slugOf(req);
    const id = String(req.params.id);
    const patch: Partial<Unit> = {};
    for (const k of EDITABLE) if (k in (req.body ?? {})) (patch as Record<string, unknown>)[k] = req.body[k];
    // The writer can set a type, not unset one: untyped is only where a hand cut starts.
    if ('type' in patch && !UNIT_TYPES.includes(patch.type as UnitType)) throw new HttpError(400, 'Unknown type');
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
      // Where the writer put it, a parse leaves it, loose included.
      if (patch.home !== undefined) u.homedBy = 'human';
      // One level deep: a piece that can no longer hold others lets its pieces go loose.
      settle(units, u);
      writeUnits(slug, units);
      appendEvent(slug, 'human', 'unit.update', { id, patch });
      return u;
    });
    res.json(unit);
  }));

  /**
   * An idea the writer cut by hand: words highlighted in the spill and dragged onto the board. The words are theirs,
   * kept exactly; the label is cut from them (its first words), never written; it has no type until the writer picks
   * one or a parse assigns one. From the spill box, the request carries the box's text, saved first as the open
   * spill, and the idea points to that spill; its position is found when the spill closes. From a closed spill
   * (`from`), the position is known now. Dropped on an idea, it goes under that idea's root; elsewhere, it stands alone.
   */
  app.post('/api/p/:slug/units', wrap(async (req, res) => {
    const slug = slugOf(req);
    const text = String(req.body?.text ?? '');
    if (!text.trim()) throw new HttpError(400, 'Nothing was highlighted');
    if (text.length > HAND_CUT_MAX) throw new HttpError(413, 'That is too long for one idea. Highlight less.');
    const words = text.trim(), lead = text.length - text.trimStart().length;
    const unit = await withLock(slug, () => {
      let blurtId: string | null = null, start = -1, end = -1, notVerbatim = false;
      const from = req.body?.from;
      if (from) {
        const b = getBlurt(slug, String(from.blurtId));
        const s = Number(from.start), e = Number(from.end);
        const loc: [number, number] | null = Number.isInteger(s) && b.text.slice(s, e) === text ? [s + lead, s + lead + words.length] : locate(b.text, words);
        if (loc) [start, end] = loc; else notVerbatim = true;
        blurtId = b.id;
      } else if (typeof req.body?.spill === 'string') {
        blurtId = saveSpill(slug, req.body.spill, res)?.id ?? null;
      }
      const units = readUnits(slug);
      const home = nestTarget(units, req.body?.home ? String(req.body.home) : null) ?? null;
      const u: Unit = {
        id: newId(), type: null, label: cutLabel(words), text: words,
        blurtId, start, end, home, ...(home ? { homedBy: 'human' as const } : {}), status: 'accepted',
        origin: 'human', labeledBy: 'system', cutBy: 'human', verified: false, note: null,
        ...(notVerbatim ? { flags: { notVerbatim: true } } : {}),
        createdAt: new Date().toISOString(),
      };
      writeUnits(slug, [...units, u]);
      appendEvent(slug, 'human', 'unit.create', { unit: u });
      return u;
    });
    res.json(unit);
  }));

  // Locally, READWISE_TOKEN from .env. Hosted, only the signed-in writer's own token; never a shared one.
  const readwiseToken = async (res: Response) => {
    if (!hosted) return readwise.enabled() ? undefined : null; // undefined: the module reads .env itself
    const account = accountOf(res);
    return account ? await hosted.accounts.readwiseOf(account.id) : null;
  };
  app.get('/api/readwise/status', wrap(async (_req, res) => {
    const tok = await readwiseToken(res);
    res.json(tok === null ? { token: false, search: false, error: hosted ? 'Add your Readwise token on your account page' : 'READWISE_TOKEN is not set in .env' } : await readwise.check(tok));
  }));

  /** The writer's own Readwise token. Checked with Readwise, then stored encrypted; it never comes back. */
  app.put('/api/me/readwise', wrap(async (req, res) => {
    const account = accountOf(res);
    if (!account || !hosted) throw new HttpError(404, 'Not available locally; the token lives in .env');
    const tok = String(req.body?.token ?? '').trim();
    checkReadwiseShape(tok);
    if (!(await readwise.accepts(tok))) throw new HttpError(400, 'Readwise did not accept that token');
    await hosted.accounts.setReadwise(account.id, tok);
    res.json(await hosted.accounts.get(account.id));
  }));

  app.delete('/api/me/readwise', wrap(async (_req, res) => {
    const account = accountOf(res);
    if (!account || !hosted) throw new HttpError(404, 'Not available locally; the token lives in .env');
    await hosted.accounts.setReadwise(account.id, null);
    res.json(await hosted.accounts.get(account.id));
  }));

  /**
   * Whether a passage is already in the document: adopted, or its note (or highlight) already spilled here, as when
   * the writer pasted their Readwise notes in. Those come back as the closest match and are no news.
   */
  const alreadyHere = (slug: string) => {
    const units = readUnits(slug);
    const ids = new Set(units.flatMap((u) => (u.source ? [u.source.id] : [])));
    const flat = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
    const spilled = flat([...listBlurts(slug).map((b) => b.text), ...units.map((u) => u.text)].join('\n'));
    // A long enough opening is as good as the whole: notes get light edits after they are pasted.
    const seen = (t: string) => { const f = flat(t).slice(0, 80); return f.length >= 20 && spilled.includes(f); };
    return (p: readwise.Passage) => ids.has(p.id) || (!!p.note && seen(p.note)) || seen(p.quote);
  };

  /** Passages from the writer's own reading that relate to a query. Ones already in the document are left out. */
  app.post('/api/p/:slug/readwise/search', wrap(async (req, res) => {
    const slug = slugOf(req);
    const tok = await readwiseToken(res);
    if (tok === null) return res.json({ enabled: false, passages: [] });
    const query = String(req.body?.query ?? '').trim().slice(0, 1000);
    if (!query) throw new HttpError(400, 'Query is empty');
    const here = alreadyHere(slug);
    const passages = (await readwise.search(query, 12, tok)).filter((p) => !here(p));
    res.json({ enabled: true, passages });
  }));

  /** Bring one passage into the document as evidence. The words are fetched from Readwise here, not taken from the client. */
  app.post('/api/p/:slug/readwise/adopt', wrap(async (req, res) => {
    const slug = slugOf(req);
    const tok = await readwiseToken(res);
    if (tok === null) throw new HttpError(400, hosted ? 'Add your Readwise token on your account page' : 'READWISE_TOKEN is not set in .env');
    const id = String(req.body?.id ?? '');
    const existing = readUnits(slug).find((u) => u.source?.id === id);
    if (existing) return res.json(existing);
    const p = await readwise.getPassage(id, tok);
    const unit = await withLock(slug, () => {
      const units = readUnits(slug);
      const home = req.body?.home ? String(req.body.home) : null;
      if (home && !units.some((u) => u.id === home && isRoot(u))) throw new HttpError(400, 'A piece can only go under a claim or question that belongs to nothing');
      const u = fromPassage(p, home);
      writeUnits(slug, [...units, u]);
      appendEvent(slug, 'human', 'source.adopt', { unit: u });
      return u;
    });
    res.json(unit);
  }));

  /**
   * Spill: suggestions from the writer's own reading, one list per thread. Each thread (root) is searched on its own,
   * and only passages Readwise matches both by meaning and by words are offered. Nothing is added here: the writer
   * picks, and each pick goes through adopt, under the thread that found it.
   */
  app.post('/api/p/:slug/readwise/related', wrap(async (req, res) => {
    const slug = slugOf(req);
    const tok = await readwiseToken(res);
    if (tok === null) throw new HttpError(400, hosted ? 'Add your Readwise token on your account page' : 'READWISE_TOKEN is not set in .env');
    const live = readUnits(slug).filter((u) => u.status !== 'cut');
    const roots = live.filter(isRoot).slice(0, PULL_THREADS);
    const queries = roots.length
      ? roots.map((r) => ({ home: r.id as string | null, q: `${r.label}. ${r.text.slice(0, 300)}` }))
      : [{ home: null, q: readMeta(slug).title }];
    const here = alreadyHere(slug);
    const have = new Set<string>();
    const lists = await Promise.all(queries.map(({ q }) => readwise.search(q, 8, tok).catch(() => [])));
    // Readwise fuses a meaning search and a word search; a passage near the top of both scores about 1/30,
    // one found by only one of them about 1/60. Only the first kind is worth offering.
    const suggestions: { home: string | null; passage: readwise.Passage }[] = [];
    lists.forEach((l, i) => {
      for (const p of l.filter((x) => (x.score ?? 0) >= PULL_MIN_SCORE && !here(x)).slice(0, PULL_PER_THREAD)) {
        if (have.has(p.id)) continue;
        have.add(p.id);
        suggestions.push({ home: queries[i].home, passage: p });
      }
    });
    res.json({ suggestions: suggestions.slice(0, PULL_MAX) });
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

  app.use(['/api', '/projects', '/stripe'], (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Our own errors, and library ones that carry a client status (a missing file, a body too large).
    const own = (err as { status?: unknown }).status;
    const status = err instanceof HttpError ? err.status : typeof own === 'number' && own >= 400 && own < 500 ? own : 500;
    if (status === 500) { console.error(err); captureServerError(err); }
    // Hosted, only our own messages reach the browser; others can carry server paths.
    const message = err instanceof HttpError || !hosted ? (err as Error).message : status === 404 ? 'Not found' : 'Server error';
    res.status(status).json({ error: message ?? 'Server error' });
  });

  return app;
}
