import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { labelProblem } from '../shared/types.ts';
import { STRUCTURES } from '../shared/structures.ts';
import {
  DEMO_CLAIM, DEMO_EVIDENCE, DEMO_EXPORT, DEMO_LANE, DEMO_PLACED, DEMO_SENTENCE, DEMO_SPILL, DEMO_UNITS,
} from '../src/demoScript.ts';

// The demo is a script over the gas turbines example: if the example changes under it, these say so.
const FIXTURE = new URL('../examples/gas-turbines/', import.meta.url);
const blurt = fs.readFileSync(new URL(`blurts/${fs.readdirSync(new URL('blurts/', FIXTURE)).find((f) => f.endsWith('.md'))}`, FIXTURE), 'utf8');

describe('the demo script', () => {
  it('types lines from the example spill, word for word', () => {
    for (const line of DEMO_SPILL.split('\n')) expect(blurt).toContain(line);
  });

  it("shows the example's own ideas, each cut verbatim from what it typed", () => {
    expect(DEMO_UNITS.map((u) => u.id)).toContain(DEMO_CLAIM);
    for (const u of DEMO_UNITS) {
      expect(u.start).toBeGreaterThanOrEqual(0);
      expect(DEMO_SPILL.slice(u.start, u.end)).toBe(u.text);
      expect(labelProblem(u.label)).toBeNull();
    }
    const evidence = DEMO_UNITS.find((u) => u.id === DEMO_EVIDENCE)!;
    expect(evidence.type).toBe('evidence');
    expect(evidence.home).toBe(DEMO_CLAIM);
  });

  it('drops the cluster on a level of the outline it shows', () => {
    expect(STRUCTURES[DEMO_PLACED.structure].lanes.map((l) => l.id)).toContain(DEMO_LANE);
  });

  it('exports clean markdown with the evidence as a footnote', () => {
    expect(DEMO_EXPORT).toContain(`${DEMO_SENTENCE}[^1]`);
    expect(DEMO_EXPORT).toMatch(/^\[\^1\]: single crystal blades/m);
    expect(DEMO_EXPORT).not.toContain('<!--');
  });
});
