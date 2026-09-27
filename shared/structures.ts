import type { Unit, UnitType } from './types.ts';

export type StructureId = string;
export type Role = 'hook' | 'context' | 'thesis' | 'point' | 'example' | 'objection' | 'close' | 'footnote';

export interface Lane {
  id: string;
  role: Role;
  name: string;
  /** What the level usually holds. Guidance only: anything can be placed anywhere, off-type items are marked. */
  accepts: UnitType[];
  single: boolean;
  required: boolean;
}

export interface StructureDef {
  id: StructureId;
  name: string;
  lanes: Lane[];
  custom?: boolean;
}

const ALL: UnitType[] = ['claim', 'evidence', 'story', 'question', 'objection', 'concept', 'coinage', 'artifact'];
/** An argument level holds its claim plus whatever supports or challenges it. */
const SUPPORT: UnitType[] = ['claim', 'evidence', 'story', 'artifact', 'objection', 'question', 'concept'];
const lane = (id: string, role: Role, name: string, accepts: UnitType[], single = false, required = false): Lane =>
  ({ id, role, name, accepts, single, required });

export const BUILTIN: StructureDef[] = [
  {
    id: 'paper', name: 'paper', lanes: [
      lane('hook', 'hook', 'question', ['question', 'story', 'coinage']),
      lane('context', 'context', 'prior work', ['evidence', 'concept', 'story', 'claim']),
      lane('thesis', 'thesis', 'thesis', ['claim', 'concept', 'coinage', 'evidence'], true, true),
      lane('p1', 'point', 'argument 1', SUPPORT, true, true),
      lane('p2', 'point', 'argument 2', SUPPORT, true, true),
      lane('p3', 'point', 'argument 3', SUPPORT, true),
      lane('example', 'example', 'worked example', ['artifact', 'story', 'evidence', 'concept']),
      lane('objection', 'objection', 'limitations', ['objection', 'question', 'evidence'], false, true),
      lane('close', 'close', 'open questions', ['question', 'claim']),
      lane('footnote', 'footnote', 'footnotes', ALL),
    ],
  },
  {
    id: 'persuasive', name: 'persuasive', lanes: [
      lane('hook', 'hook', 'hook', ['story', 'coinage', 'question'], false, true),
      lane('context', 'context', 'stakes', ['evidence', 'story', 'concept', 'claim']),
      lane('thesis', 'thesis', 'thesis', ['claim', 'concept', 'coinage', 'evidence'], true, true),
      lane('p1', 'point', 'reason 1', SUPPORT, true, true),
      lane('p2', 'point', 'reason 2', SUPPORT, true, true),
      lane('p3', 'point', 'reason 3', SUPPORT, true),
      lane('objection', 'objection', 'strongest objection', ['objection', 'evidence', 'story'], false, true),
      lane('close', 'close', 'call to action', ['claim', 'coinage', 'question']),
      lane('footnote', 'footnote', 'footnotes', ALL),
    ],
  },
  {
    id: 'teaching', name: 'teaching', lanes: [
      lane('hook', 'hook', 'puzzle', ['question', 'story'], false, true),
      lane('context', 'context', 'what you already believe', ['concept', 'claim', 'story']),
      lane('thesis', 'thesis', 'the idea', ['claim', 'concept', 'coinage'], true, true),
      lane('example', 'example', 'worked example', ['artifact', 'story', 'evidence', 'concept'], false, true),
      lane('objection', 'objection', 'common misconception', ['objection', 'claim']),
      lane('p1', 'point', 'check question', ['question', 'claim']),
      lane('close', 'close', 'where next', ['question', 'claim']),
      lane('footnote', 'footnote', 'footnotes', ALL),
    ],
  },
];

/** Built-in structures by id. */
export const STRUCTURES: Record<string, StructureDef> = Object.fromEntries(BUILTIN.map((d) => [d.id, d]));

/** Built-ins plus the writer's own outlines. */
export function structureMap(custom: StructureDef[]): Record<string, StructureDef> {
  return { ...STRUCTURES, ...Object.fromEntries(custom.map((d) => [d.id, d])) };
}

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** Guess a level's role from its name, so arrangements carry over between outlines. */
function guessRole(name: string): Role {
  const n = name.toLowerCase();
  if (/hook|intro|open|puzzle|lede/.test(n)) return 'hook';
  if (/thesis|claim|idea|main|argument\b(?!\s*\d)|position/.test(n)) return 'thesis';
  if (/background|context|prior|stake|setup|history/.test(n)) return 'context';
  if (/example|demo|case|worked|figure/.test(n)) return 'example';
  if (/objection|counter|limit|misconception|risk|caveat/.test(n)) return 'objection';
  if (/conclu|close|next|call to action|summary|open question|ending/.test(n)) return 'close';
  if (/footnote|appendix|note/.test(n)) return 'footnote';
  return 'point';
}

/**
 * Build a structure from a typed outline: one level per line. Bullets and numbering are ignored.
 * Custom levels expect nothing in particular, so nothing placed in them is ever marked off-type.
 */
export function outlineToStructure(name: string, outline: string, id: string): StructureDef {
  const seen = new Set<string>();
  const lanes = outline.split('\n')
    .map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .map((levelName) => {
      let lid = slugify(levelName) || 'level';
      for (let i = 2; seen.has(lid); i++) lid = `${slugify(levelName) || 'level'}-${i}`;
      seen.add(lid);
      return lane(lid, guessRole(levelName), levelName.toLowerCase(), ALL);
    });
  return { id, name: name.trim().toLowerCase(), lanes, custom: true };
}

export interface Board {
  structure: StructureId;
  /** Per structure, lane id -> ordered unit ids. Each structure keeps its own arrangement. */
  lanes: Record<StructureId, Record<string, string[]>>;
}

export const emptyBoard = (): Board => ({ structure: 'persuasive', lanes: { paper: {}, persuasive: {}, teaching: {} } });

/**
 * Carry an arrangement into a structure that has none yet, matching levels by role in order.
 * Whatever has no matching level goes back to loose.
 */
export function reslot(board: Board, fromDef: StructureDef | undefined, toDef: StructureDef, units: Unit[]): Record<string, string[]> {
  const from = fromDef?.lanes ?? [], target = toDef.lanes;
  const src = board.lanes[board.structure] ?? {};
  const byId = new Map(units.map((u) => [u.id, u]));
  const out: Record<string, string[]> = {};
  const used = new Set<string>();
  for (const t of target) {
    const sameRole = from.filter((f) => f.role === t.role);
    const nth = target.filter((x) => x.role === t.role).indexOf(t);
    const f = sameRole[nth] ?? (t.single ? undefined : sameRole[0]);
    if (!f) continue;
    const ids = (src[f.id] ?? []).filter((id) => !used.has(id) && byId.has(id));
    ids.forEach((id) => used.add(id));
    if (ids.length) out[t.id] = ids;
  }
  return out;
}

export type Support = 'none' | 'unchecked' | 'checked';

/** Mechanical, readable claim strength: what is attached, not a model's opinion. */
export function support(claim: Unit, units: Unit[]): Support {
  const kids = units.filter((u) => u.home === claim.id && u.status !== 'cut');
  const ev = kids.filter((k) => k.type === 'evidence' || k.type === 'artifact');
  if (!ev.length) return 'none';
  const checked = ev.some((e) => e.verified && e.origin === 'human');
  const answered = kids.some((k) => k.type === 'objection');
  return checked && answered ? 'checked' : 'unchecked';
}

export const SUPPORT_TITLE: Record<Support, string> = {
  none: 'no evidence attached',
  unchecked: 'evidence not yet checked, or no objection addressed',
  checked: 'evidence checked and an objection addressed',
};
