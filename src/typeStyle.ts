import type { UnitType } from '../shared/types.ts';

/** Inks, not a rainbow: most types share the brown ink; only objections and questions get their own. */
export const TYPE_INK: Record<UnitType, string> = {
  claim: 'var(--ink)',
  evidence: 'var(--ink-soft)',
  story: 'var(--ink-soft)',
  question: 'var(--blue-ink)',
  objection: 'var(--red-ink)',
  concept: 'var(--ink-soft)',
  coinage: 'var(--ink-soft)',
  artifact: 'var(--ink-soft)',
};
