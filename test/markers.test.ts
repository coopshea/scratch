import { describe, expect, it } from 'vitest';
import { ensureSections, normalizeMarkers } from '../shared/markers.ts';

describe('section markers are repaired on load', () => {
  it('puts a marker joined to text back on its own line', () => {
    expect(normalizeMarkers('lk chip n<!--s:p3-->\nmore')).toBe('lk chip n\n<!--s:p3-->\nmore');
    expect(normalizeMarkers('<!--s:p2-->asldmkas')).toBe('<!--s:p2-->\nasldmkas');
  });

  it('keeps one marker per section and never drops text', () => {
    const doc = '<!--s:p1-->\none\n<!--s:p2-->\ntwo\n<!--s:p2-->\nthree';
    expect(normalizeMarkers(doc)).toBe('<!--s:p1-->\none\n<!--s:p2-->\ntwo\nthree');
  });

  it('leaves a healthy draft untouched', () => {
    const doc = '<!--s:hook-->\nOpening.\n\n<!--s:thesis-->\nClaim.<!--u:abc123-->';
    expect(normalizeMarkers(doc)).toBe(doc);
  });
});

describe('the draft follows the outline chosen in Shape', () => {
  const persuasive = ['hook', 'context', 'thesis', 'p1', 'objection'];
  const branch = ['prior-work', 'thesis', 'question', 'argument-1'];

  it('lays out a blank draft for the new outline alone, in its order', () => {
    const blank = ensureSections('', persuasive);
    expect(ensureSections(blank, branch)).toBe(ensureSections('', branch));
    expect(ensureSections(ensureSections('', branch), branch)).toBe(ensureSections('', branch));
  });

  it('drops empty levels from the old outline but keeps any with writing', () => {
    const doc = '<!--s:hook-->\n\n<!--s:context-->\nSome words.\n\n<!--s:thesis-->\n\n<!--s:p1-->\n';
    const out = ensureSections(doc, branch);
    expect(out).not.toContain('<!--s:hook-->');
    expect(out).not.toContain('<!--s:p1-->');
    expect(out).toContain('<!--s:context-->\nSome words.');
    for (const id of branch) expect(out).toContain(`<!--s:${id}-->`);
  });

  it('never drops text', () => {
    const doc = 'Before any level.\n<!--s:hook-->\nOpening.<!--u:abc123-->\n<!--s:p1-->\n';
    const out = ensureSections(doc, branch);
    expect(out).toContain('Before any level.');
    expect(out).toContain('Opening.<!--u:abc123-->');
  });
});
