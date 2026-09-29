import { describe, expect, it } from 'vitest';
import { joinSections, splitSections } from '../src/draftBlocks.ts';
import { ensureSections } from '../shared/markers.ts';

describe('the draft splits into one section per outline level, and back', () => {
  const doc = '<!--s:hook-->\nOpening.<!--u:abc123-->\n\n- a\n- b\n\n<!--s:context-->\n\n<!--s:thesis-->\nThe claim.\n';

  it('gives each section its own text, in order', () => {
    expect(splitSections(doc)).toEqual([
      { lane: 'hook', md: 'Opening.<!--u:abc123-->\n\n- a\n- b' },
      { lane: 'context', md: '' },
      { lane: 'thesis', md: 'The claim.' },
    ]);
  });

  it('joins back to the stored form, and a joined draft splits the same way again', () => {
    const joined = joinSections(splitSections(doc));
    expect(joined).toBe('<!--s:hook-->\nOpening.<!--u:abc123-->\n\n- a\n- b\n\n<!--s:context-->\n\n<!--s:thesis-->\nThe claim.\n');
    expect(splitSections(joined)).toEqual(splitSections(doc));
  });

  it('keeps text written before the first marker, in the first section', () => {
    expect(splitSections('Stray start.\n<!--s:hook-->\nOpening.')[0]).toEqual({ lane: 'hook', md: 'Stray start.\nOpening.' });
  });

  it('never drops writing when the outline changes', () => {
    const next = splitSections(ensureSections(doc, ['intro', 'thesis']));
    expect(next.map((p) => p.lane)).toEqual(['hook', 'intro', 'thesis']);
    expect(next.find((p) => p.lane === 'hook')?.md).toContain('Opening.');
    expect(next.find((p) => p.lane === 'thesis')?.md).toBe('The claim.');
  });
});
