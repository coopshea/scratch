import type { Unit, UnitType } from './types.ts';

/**
 * Clusters are one level deep. Claims and questions are the guiding primitives: one that belongs to nothing
 * is a root, and anything else may sit under it, including a supporting claim or a sub-question.
 * Something that belongs to a root never holds pieces itself.
 */
export const HOLDER_TYPES: readonly UnitType[] = ['claim', 'question'];
export const canHold = (t: UnitType) => HOLDER_TYPES.includes(t);

/** A root: a claim or question that belongs to nothing. */
export const isRoot = (u: Pick<Unit, 'type' | 'home'>) => canHold(u.type) && !u.home;

/** Working memory holds about four chunks (Cowan 2001): a root shows at most four pieces; the rest collapse. */
export const MAX_VISIBLE = 4;

/** Which types lead when choosing what a cluster shows: one of each, so its shape reads at a glance. */
const LEAD: UnitType[] = ['evidence', 'story', 'objection', 'claim', 'question', 'artifact', 'concept', 'coinage'];

/**
 * Split a root's pieces into what shows and what collapses. A rule, not a judgment of quality:
 * first one piece of each type, in LEAD order, then the rest in blurt order. Shown pieces keep blurt order.
 */
export function pickVisible<T extends Pick<Unit, 'id' | 'type'>>(kids: T[], max = MAX_VISIBLE): { shown: T[]; hidden: T[] } {
  if (kids.length <= max) return { shown: kids, hidden: [] };
  const chosen = new Set<string>();
  for (const t of LEAD) {
    if (chosen.size >= max) break;
    const k = kids.find((x) => x.type === t);
    if (k) chosen.add(k.id);
  }
  for (const k of kids) { if (chosen.size >= max) break; chosen.add(k.id); }
  return { shown: kids.filter((k) => chosen.has(k.id)), hidden: kids.filter((k) => !chosen.has(k.id)) };
}

/** Whether `target` can hold `u`: a root claim or question, and not `u` itself. */
export function canHoldUnit(target: Pick<Unit, 'id' | 'type' | 'home'> | undefined, u: Pick<Unit, 'id'>): boolean {
  return !!target && target.id !== u.id && isRoot(target);
}

/**
 * Keep clusters one level deep after `u` changes: if it can no longer hold pieces (its type changed,
 * or it now belongs to a root), its pieces go loose. Mutates `units`. Shared by the server and history replay.
 */
export function settle(units: Pick<Unit, 'id' | 'home'>[], u: Pick<Unit, 'id' | 'type' | 'home'>) {
  if (canHold(u.type) && !u.home) return;
  for (const x of units) if (x.home === u.id) x.home = null;
}
