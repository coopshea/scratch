import { describe, expect, it } from 'vitest';
import { toMarkdown } from '../shared/export.ts';
import { canHoldUnit, isRoot, pickVisible, settle } from '../shared/clusters.ts';
import { replay, type LogEvent } from '../shared/replay.ts';
import { emptyBoard, outlineToStructure, reslot, STRUCTURES, support } from '../shared/structures.ts';
import { unit } from './helpers.ts';

describe('export: clean markdown for a reader', () => {
  const claim = unit({ id: 'c1', type: 'claim', label: 'certification is the moat' });
  const ev = unit({ id: 'e1', type: 'evidence', text: 'The GE9X ran 5,000 hours\nof testing.' });
  const fig = unit({ id: 'f1', type: 'artifact', label: 'cost curve' });
  const sourced = unit({
    id: 's1', type: 'evidence', origin: 'source', text: 'Margins are 3.9%.',
    source: { kind: 'readwise', id: '9', title: 'Jet Engines', author: 'A. Japi', url: 'https://x.test/jet' },
  });
  const units = [claim, ev, fig, sourced];

  it('drops section markers and claim chips, leaving only prose', () => {
    const md = toMarkdown('T', '<!--s:hook-->\nOpening line.<!--u:c1-->\n<!--s:thesis-->\nThesis.', units);
    expect(md).toBe('# T\n\nOpening line.\nThesis.\n');
  });

  it('turns placed evidence into numbered footnotes, reusing the number on a callback', () => {
    const md = toMarkdown('T', 'A<!--u:e1--> and B<!--u:e1-->.', units);
    expect(md).toContain('A[^1] and B[^1].');
    expect(md).toContain('[^1]: The GE9X ran 5,000 hours of testing.');
    expect(md).not.toContain('[^2]');
  });

  it('cites the source of evidence from reading', () => {
    const md = toMarkdown('T', 'Thin margins.<!--u:s1-->', units);
    expect(md).toContain('[^1]: Margins are 3.9%. (A. Japi, *Jet Engines*, https://x.test/jet)');
  });

  it('shows figures still to make, and drops chips for cut or unknown units', () => {
    expect(toMarkdown('T', 'See<!--u:f1-->', units)).toContain('See *[Figure: cost curve]*');
    expect(toMarkdown('T', 'Gone<!--u:nope-->.', units)).toContain('Gone.');
  });
});

describe('replay: history rebuilds any moment, read-only', () => {
  const c = unit({ id: 'c1', type: 'claim' });
  const e = unit({ id: 'e1', type: 'evidence', home: 'c1' });
  const events: LogEvent[] = [
    { t: '1', author: 'human', type: 'blurt.create', data: { id: 'b1', text: 'hi' } },
    { t: '2', author: 'model', type: 'parse', data: { units: [c, e] } },
    { t: '3', author: 'human', type: 'unit.update', data: { id: 'c1', patch: { label: 'renamed claim here' } } },
    { t: '4', author: 'human', type: 'unit.update', data: { id: 'c1', patch: { type: 'concept' } } },
    { t: '5', author: 'human', type: 'source.adopt', data: { unit: unit({ id: 's1', origin: 'source' }) } },
    { t: '6', author: 'human', type: 'draft.snapshot', data: { text: 'draft' } },
  ];

  it('stops at the chosen event', () => {
    const at2 = replay(events, 2);
    expect(at2.blurts).toHaveLength(1);
    expect(at2.units.map((u) => u.id)).toEqual(['c1', 'e1']);
    expect(at2.draft).toBe('');
  });

  it('applies edits in order, and a claim that stops being one releases its children', () => {
    const at4 = replay(events, 4);
    const c1 = at4.units.find((u) => u.id === 'c1')!;
    expect(c1.label).toBe('renamed claim here');
    expect(c1.type).toBe('concept');
    expect(at4.units.find((u) => u.id === 'e1')!.home).toBeNull();
  });

  it('includes units adopted from reading, and the draft', () => {
    const all = replay(events, events.length);
    expect(all.units.map((u) => u.id)).toContain('s1');
    expect(all.draft).toBe('draft');
  });

  it('does not mutate the logged units', () => {
    replay(events, events.length);
    expect(c.type).toBe('claim');
    expect(e.home).toBe('c1');
  });
});

describe('support marks: mechanical, never a model’s opinion', () => {
  const claim = unit({ id: 'c', type: 'claim' });
  it('reads what is attached', () => {
    expect(support(claim, [claim])).toBe('none');
    expect(support(claim, [claim, unit({ type: 'evidence', home: 'c' })])).toBe('unchecked');
    expect(support(claim, [claim, unit({ type: 'evidence', home: 'c', verified: true }), unit({ type: 'objection', home: 'c' })])).toBe('checked');
  });

  it('ignores cut units', () => {
    expect(support(claim, [claim, unit({ type: 'evidence', home: 'c', status: 'cut' })])).toBe('none');
  });

  it('never counts model-written evidence as checked; sourced evidence counts once a human checks it', () => {
    const objection = unit({ type: 'objection', home: 'c' });
    expect(support(claim, [claim, objection, unit({ type: 'evidence', home: 'c', origin: 'model', verified: true })])).toBe('unchecked');
    expect(support(claim, [claim, objection, unit({ type: 'evidence', home: 'c', origin: 'source', verified: true })])).toBe('checked');
  });
});

describe('outlines', () => {
  it('builds levels from a typed outline, ignoring bullets and numbering', () => {
    const s = outlineToStructure('My Paper', '1. Hook\n- Background\n* Argument 1\n\n2) Argument 1\nConclusion', 'c-my-paper');
    expect(s.name).toBe('my paper');
    expect(s.lanes.map((l) => l.id)).toEqual(['hook', 'background', 'argument-1', 'argument-1-2', 'conclusion']);
    expect(s.lanes.map((l) => l.role)).toEqual(['hook', 'context', 'point', 'point', 'close']);
  });

  it('never marks anything off-type in a custom level', () => {
    const s = outlineToStructure('x', 'anything', 'c-x');
    expect(s.lanes[0].accepts).toHaveLength(8);
  });

  it('carries an arrangement to another outline by role', () => {
    const units = [unit({ id: 'h' }), unit({ id: 't' }), unit({ id: 'p' })];
    const board = { ...emptyBoard(), structure: 'persuasive', lanes: { persuasive: { hook: ['h'], thesis: ['t'], p1: ['p', 'missing'] } } };
    const out = reslot(board, STRUCTURES.persuasive, STRUCTURES.paper, units);
    expect(out).toEqual({ hook: ['h'], thesis: ['t'], p1: ['p'] });
  });
});

describe('clusters: root plus four, one level deep', () => {
  it('claims and questions that belong to nothing are roots', () => {
    expect(isRoot(unit({ type: 'claim' }))).toBe(true);
    expect(isRoot(unit({ type: 'question' }))).toBe(true);
    expect(isRoot(unit({ type: 'claim', home: 'x' }))).toBe(false);
    expect(isRoot(unit({ type: 'evidence' }))).toBe(false);
  });

  it('shows everything when a cluster has four pieces or fewer', () => {
    const kids = ['evidence', 'evidence', 'story', 'concept'].map((type) => unit({ type: type as never }));
    expect(pickVisible(kids)).toEqual({ shown: kids, hidden: [] });
  });

  it('shows one of each type first, in blurt order, and collapses the rest', () => {
    const kids = [
      unit({ id: 'e1', type: 'evidence' }), unit({ id: 'e2', type: 'evidence' }), unit({ id: 'e3', type: 'evidence' }),
      unit({ id: 'c1', type: 'concept' }), unit({ id: 's1', type: 'story' }), unit({ id: 'o1', type: 'objection' }),
    ];
    const { shown, hidden } = pickVisible(kids);
    expect(shown.map((k) => k.id)).toEqual(['e1', 'c1', 's1', 'o1']);
    expect(hidden.map((k) => k.id)).toEqual(['e2', 'e3']);
  });

  it('fills remaining slots in blurt order when types repeat', () => {
    const kids = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => unit({ id, type: 'evidence' }));
    expect(pickVisible(kids).shown.map((k) => k.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('only a root can hold, and never itself', () => {
    const root = unit({ id: 'r', type: 'question' });
    expect(canHoldUnit(root, { id: 'x' })).toBe(true);
    expect(canHoldUnit(root, root)).toBe(false);
    expect(canHoldUnit(unit({ type: 'claim', home: 'r' }), { id: 'x' })).toBe(false);
    expect(canHoldUnit(undefined, { id: 'x' })).toBe(false);
  });

  it('settle: a unit that stops being a root lets its pieces go loose', () => {
    const r = unit({ id: 'r', type: 'claim' });
    const kids = [unit({ id: 'k1', home: 'r', type: 'evidence' }), unit({ id: 'k2', home: 'r', type: 'story' })];
    settle([r, ...kids], r);
    expect(kids.map((k) => k.home)).toEqual(['r', 'r']);
    r.home = 'other';
    settle([r, ...kids], r);
    expect(kids.map((k) => k.home)).toEqual([null, null]);
  });
});
