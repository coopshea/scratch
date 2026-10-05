import fixture from '../examples/gas-turbines/units.json';
import meta from '../examples/gas-turbines/meta.json';
import type { Blurt, Unit } from '../shared/types.ts';
import type { Board } from '../shared/structures.ts';
import { toMarkdown } from '../shared/export.ts';

/**
 * What the demo (Demo.tsx) shows, taken from the gas turbines example: three messy lines of its spill, the ideas the
 * parser cut from them, one cluster placed on the thesis, one sentence written and the export. Scripted state only:
 * nothing here is sent to the server.
 */
export const DEMO_TITLE = meta.title;

/** Typed into the spill box: three messy lines, each word for word from the example's spill. */
export const DEMO_SPILL = [
  'so where did the other 45 points come from?',
  "my hunch is it's mostly one number: firing temperature.",
  "single crystal blades, no grain boundaries so they don't creep. ceramic thermal barrier coatings.",
].join('\n');

export const DEMO_QUESTION = '4d2a58d322';
/** The cluster the cursor drags onto the thesis. */
export const DEMO_CLAIM = 'c10cb41c4b';
/** Its evidence, placed in the sentence as a chip; it becomes the export's footnote. */
export const DEMO_EVIDENCE = 'f8e1b5ad08';
const IDS = [DEMO_QUESTION, DEMO_CLAIM, DEMO_EVIDENCE, '9e0e69f812'];

export const DEMO_BLURT: Blurt = { id: 'demo', text: DEMO_SPILL, createdAt: '2026-09-26T19:04:37.512Z', parsed: true };

/** The example's own ideas, cut from the two lines (offsets into them, so the earlier-spills view underlines them). */
export const DEMO_UNITS: Unit[] = IDS.map((id) => {
  const u = (fixture as unknown as Unit[]).find((x) => x.id === id)!;
  const start = DEMO_SPILL.indexOf(u.text);
  return { ...u, blurtId: DEMO_BLURT.id, start, end: start + u.text.length, note: null };
});

export const DEMO_BOARD: Board = { structure: 'persuasive', lanes: { persuasive: {} } };
export const DEMO_PLACED: Board = { structure: 'persuasive', lanes: { persuasive: { thesis: [DEMO_CLAIM] } } };
/** The lane the cluster is dropped on, and the section the sentence is written in. */
export const DEMO_LANE = 'thesis';

/** The writer's sentence in the draft. */
export const DEMO_SENTENCE = 'Most of the gain is one number: how hot the gas runs.';

/** The export, from the real exporter: the sentence, and the evidence chip as a numbered footnote. */
export const DEMO_EXPORT = toMarkdown(DEMO_TITLE, `<!--s:${DEMO_LANE}-->\n${DEMO_SENTENCE} <!--u:${DEMO_EVIDENCE}--> `, DEMO_UNITS);

// Seen once per browser, like the stage hints: accounts have no place for interface flags.
const SEEN = 'demo-seen';
export const demoSeen = () => { try { return localStorage.getItem(SEEN) === '1'; } catch { return true; } };
export const markDemoSeen = () => { try { localStorage.setItem(SEEN, '1'); } catch { /* storage unavailable */ } };
