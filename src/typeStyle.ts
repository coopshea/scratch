import type { UnitType } from '../shared/types.ts';

/** Inks, not a rainbow: a type's tag takes this colour. Only questions and objections get their own. */
/** An untyped idea's ink: neutral, like the quiet types. */
export const inkOf = (t: UnitType | null) => (t ? TYPE_INK[t] : 'var(--ink-3)');

export const TYPE_INK: Record<UnitType, string> = {
  claim: 'var(--ink)',
  evidence: 'var(--ink-3)',
  story: 'var(--ink-3)',
  question: 'var(--question)',
  objection: 'var(--objection)',
  concept: 'var(--ink-3)',
  coinage: 'var(--ink-3)',
  artifact: 'var(--ink-3)',
};
