export const UNIT_TYPES = [
  'claim', 'evidence', 'story', 'question', 'objection', 'concept', 'coinage', 'artifact',
] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export const LABEL_MAX_CHARS = 40;
export const LABEL_MAX_WORDS = 6;

export type UnitStatus = 'proposed' | 'accepted' | 'cut';

export interface Unit {
  id: string;
  type: UnitType;
  /** 3-6 word concept label. The join key for clustering. */
  label: string;
  /** The user's own words, cut verbatim from the blurt. Never reworded. */
  text: string;
  blurtId: string | null;
  /** Character offsets into the raw blurt; -1 when the parser output could not be found verbatim. */
  start: number;
  end: number;
  /** Id of the claim this unit belongs to. Claims and unassigned units have null. */
  home: string | null;
  status: UnitStatus;
  /** Who produced the unit's words. Parsed units are human words, typed and labeled by the model.
   *  'source' is a passage quoted verbatim from something the writer read. */
  origin: 'human' | 'model' | 'source';
  labeledBy: 'human' | 'model' | 'system';
  verified: boolean;
  /** Rich-text note (BlockNote document JSON). */
  note: unknown[] | null;
  priorArt?: string;
  /** Where a 'source' unit's words came from. Sourced is not verified: checking stays a human act. */
  source?: SourceRef;
  flags?: { notVerbatim?: boolean; labelTooLong?: boolean };
  createdAt: string;
}

export interface SourceRef {
  kind: 'readwise';
  id: string;
  title: string;
  author: string;
  url: string | null;
}

export interface Blurt {
  id: string;
  text: string;
  createdAt: string;
}

export interface ProjectMeta {
  title: string;
}

export interface Project {
  slug: string;
  meta: ProjectMeta;
  blurts: Blurt[];
  units: Unit[];
  board: import('./structures.ts').Board;
  draft: string;
}

export interface ProjectSummary {
  slug: string;
  title: string;
  /** The user's own claim labels, not model prose. */
  summary: string;
  updatedAt: string;
}

export function labelProblem(label: string): string | null {
  const t = label.trim();
  if (!t) return 'Label is empty';
  if (t.length > LABEL_MAX_CHARS) return `Label is ${t.length} characters; max ${LABEL_MAX_CHARS}`;
  const words = t.split(/\s+/).length;
  if (words > LABEL_MAX_WORDS) return `Label is ${words} words; max ${LABEL_MAX_WORDS}`;
  return null;
}
