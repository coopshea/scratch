import { describe, expect, it } from 'vitest';
import { normalizeMarkers } from '../shared/markers.ts';

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
