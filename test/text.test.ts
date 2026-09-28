import { describe, expect, it } from 'vitest';
import { cutLabel, locate, noteBlocks } from '../server/text.ts';
import { labelProblem } from '../shared/types.ts';

describe('rule: the parser cuts, never rewords (locate)', () => {
  const blurt = 'Certification is the moat.  The GE9X ran 5,000 hours of testing.\nWhy do airlines exist?';

  it('finds an exact cut', () => {
    const [a, b] = locate(blurt, 'The GE9X ran 5,000 hours of testing.')!;
    expect(blurt.slice(a, b)).toBe('The GE9X ran 5,000 hours of testing.');
  });

  it('tolerates whitespace drift and returns the true slice from the blurt', () => {
    const [a, b] = locate(blurt, 'moat. The GE9X')!;
    expect(blurt.slice(a, b)).toBe('moat.  The GE9X');
  });

  it('tolerates curly versus straight quotes', () => {
    const text = 'He said “ship it” and left.';
    const [a, b] = locate(text, 'said "ship it" and')!;
    expect(text.slice(a, b)).toBe('said “ship it” and');
  });

  it('returns null for reworded text, so the server can flag it', () => {
    expect(locate(blurt, 'Certification is a moat.')).toBeNull();
    expect(locate(blurt, 'Testing took 5,000 hours.')).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(locate(blurt, '   ')).toBeNull();
  });
});

describe('rule: labels are 3 to 6 words, 40 characters max', () => {
  it('accepts a normal label', () => {
    expect(labelProblem('law of the minimum')).toBeNull();
  });

  it('rejects empty, too long, and too many words', () => {
    expect(labelProblem('   ')).toMatch(/empty/);
    expect(labelProblem('x'.repeat(41))).toMatch(/41 characters/);
    expect(labelProblem('one two three four five six seven')).toMatch(/7 words/);
  });
});

describe('cutLabel: a label cut from a passage, never written', () => {
  it('uses the passage’s own first words', () => {
    expect(cutLabel('Certification regimes squeeze margins even further.')).toBe('Certification regimes squeeze margins'); // adding "even" would pass 40 characters
  });

  it('always fits the label rules', () => {
    for (const q of [
      'On top of this, the certification regime for jet engines is one of the most complex regulatory processes',
      'Supercalifragilisticexpialidociousness-and-then-some-more-and-more-text',
      'short',
    ]) expect(labelProblem(cutLabel(q))).toBeNull();
  });

  it('drops markdown link syntax and trailing punctuation', () => {
    expect(cutLabel('It [had 5,000 hours](https://example.com) of testing')).toBe('It had 5,000 hours of testing');
    expect(cutLabel('Engines, turbines, and')).toBe('Engines, turbines, and');
    expect(cutLabel('Engines, turbines,')).toBe('Engines, turbines');
  });
});

describe('noteBlocks: the writer’s note, unparsed', () => {
  it('keeps every word and splits on blank lines', () => {
    const blocks = noteBlocks('First thought.\n\nSecond thought.\n  \n');
    expect(blocks.map((b) => b.content[0].text)).toEqual(['First thought.', 'Second thought.']);
  });
});
