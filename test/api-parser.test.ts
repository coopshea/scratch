import fs from 'node:fs';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import type { Unit } from '../shared/types.ts';
import { CAD_TALK, tempDataDir } from './helpers.ts';

// A stand-in parser that misbehaves on purpose, to prove the server checks what the model returns.
vi.mock('../server/parser.ts', async (orig) => ({
  ...(await orig<typeof import('../server/parser.ts')>()),
  parseBlurt: vi.fn(async () => [
    { key: 'c1', type: 'claim', text: 'CAD AI is following the path of coding.', label: 'cad ai follows coding', home: '' },
    // Reworded: the blurt says "In the last couple weeks, models that can natively do computer use have gotten much better."
    { key: 'u1', type: 'evidence', text: 'Computer-use models got much better in recent weeks.', label: 'computer use improving', home: 'c1' },
    { key: 'u2', type: 'story', text: 'Oddly enough, a lot of the reaction I’ve found sounds very familiar', label: 'a label that is far too long to ever be allowed here', home: 'nope' },
    { key: 'u3', type: 'claim', text: 'Physical engineering is beginning to see similar loops be spun up.', label: 'CAD AI Follows Coding', home: 'c1' },
    // Whitespace drift: the blurt has two spaces after "etc?"; the model returned one
    { key: 'u4', type: 'objection', text: "how much does that matter now, in a month, in a year, etc? There used to be draftsmen.", label: 'bottleneck timing question', home: 'c1' },
    // Nested two deep (under u3, which is under c1): moves up to the root
    { key: 'u5', type: 'evidence', text: 'This simple process is the root of all the advances in coding harnesses today', label: 'loops drive coding advances', home: 'u3' },
    // A question as a root, holding a piece
    { key: 'r2', type: 'question', text: 'So how do we think about this problem?', label: 'how to frame the problem', home: '' },
    { key: 'u6', type: 'concept', text: 'Let’s talk about the law of bottlenecks.', label: 'law of the minimum', home: 'r2' },
  ]),
}));

process.env.SCRATCH_DATA = tempDataDir();

let app: Express;
beforeAll(async () => { app = (await import('../server/app.ts')).createApp(); });

const BLURT = CAD_TALK;

describe('the server checks the parser’s output', () => {
  let slug: string;
  let units: Unit[];
  beforeAll(async () => {
    slug = (await request(app).post('/api/projects').send({ title: 'checks' })).body.slug;
    units = (await request(app).post(`/api/p/${slug}/blurts`).send({ text: BLURT })).body.units;
  });

  it('flags text the model reworded instead of cutting, and records no offsets for it', () => {
    const reworded = units[1];
    expect(reworded.flags?.notVerbatim).toBe(true);
    expect([reworded.start, reworded.end]).toEqual([-1, -1]);
    expect(units[0].flags?.notVerbatim).toBeUndefined();
  });

  it('keeps the blurt’s own characters when the model drifts on whitespace', () => {
    const drifted = units[4];
    expect(drifted.flags?.notVerbatim).toBeUndefined();
    expect(drifted.text).toBe('how much does that matter now, in a month, in a year, etc?  There used to be draftsmen.');
    expect(BLURT.slice(drifted.start, drifted.end)).toBe(drifted.text);
  });

  it('flags labels over the limit', () => {
    expect(units[2].flags?.labelTooLong).toBe(true);
    expect(units[0].flags?.labelTooLong).toBeUndefined();
  });

  it('resolves homes to real claim ids, and drops homes that point nowhere', () => {
    expect(units[1].home).toBe(units[0].id);
    expect(units[2].home).toBeNull();
  });

  it('lets a claim sit under a broader claim', () => {
    expect(units[3].home).toBe(units[0].id);
  });

  it('keeps clusters one level deep: a piece nested under a piece moves up to the root', () => {
    expect(units[5].home).toBe(units[0].id);
  });

  it('treats questions as roots that hold pieces', () => {
    expect(units[6].home).toBeNull();
    expect(units[7].home).toBe(units[6].id);
  });

  it('tells the parser about existing roots, questions included', async () => {
    const { parseBlurt } = await import('../server/parser.ts');
    await request(app).post(`/api/p/${slug}/blurts`).send({ text: BLURT });
    const roots = vi.mocked(parseBlurt).mock.calls.at(-1)![2];
    expect(roots.map((r) => r.type).sort()).toContain('question');
    expect(roots.every((r) => r.type === 'claim' || r.type === 'question')).toBe(true);
  });

  it('reuses the first spelling of a label, within a parse and across parses (controlled vocabulary)', async () => {
    expect(units[3].label).toBe('cad ai follows coding'); // same batch: first spelling wins
    const again: Unit[] = (await request(app).post(`/api/p/${slug}/blurts`).send({ text: BLURT })).body.units;
    expect(again[3].label).toBe('cad ai follows coding');
  });
});

describe('a second blurt lands on the clusters already there', () => {
  const SECOND = fs.readFileSync(new URL('./fixtures/benchmarks.md', import.meta.url), 'utf8');

  it('attaches new pieces to existing roots, starts new roots, and keeps both blurts verbatim', async () => {
    const { parseBlurt } = await import('../server/parser.ts');
    const slug = (await request(app).post('/api/projects').send({ title: 'two blurts' })).body.slug;
    const first: Unit[] = (await request(app).post(`/api/p/${slug}/blurts`).send({ text: BLURT })).body.units;
    const cadRoot = first.find((u) => u.label === 'cad ai follows coding')!;

    // The stand-in answers the second blurt using the roots the server passed it, as the real parser would.
    vi.mocked(parseBlurt).mockImplementationOnce(async (_blurt, _vocab, roots) => {
      const existing = roots.find((r) => r.label === 'cad ai follows coding')!;
      return [
        { key: 'a', type: 'evidence', text: 'Fable 5.1 and Astra 6 are both very capable at designing in CAD and routing PCBs.', label: 'models design CAD and PCBs', home: existing.id },
        { key: 'r', type: 'claim', text: 'Best in class AI models are being trained on a dataset at this level of abstraction', label: 'AI inherits design limits', home: '' },
        { key: 'b', type: 'story', text: 'Mechanical engineers today are often derided by manufacturing engineers', label: 'engineers derided by machinists', home: 'r' },
        { key: 'c', type: 'objection', text: 'as soon as the metric is defined, it doesn’t take long to saturate it', label: 'benchmarks saturate fast', home: 'not-an-id' },
      ];
    });
    const second: Unit[] = (await request(app).post(`/api/p/${slug}/blurts`).send({ text: SECOND })).body.units;

    const roots = vi.mocked(parseBlurt).mock.calls.at(-1)![2];
    expect(roots.map((r) => r.id)).toContain(cadRoot.id);
    expect(second[0].home).toBe(cadRoot.id); // joined an existing root
    expect(second[1].home).toBeNull(); // a new root
    expect(second[2].home).toBe(second[1].id); // under the new root
    expect(second[3].home).toBeNull(); // pointed nowhere: loose
    for (const u of second) {
      expect(u.flags?.notVerbatim).toBeUndefined();
      expect(SECOND.slice(u.start, u.end)).toBe(u.text);
    }
    const all: Unit[] = (await request(app).get(`/api/p/${slug}`)).body.units;
    expect(all.filter((u) => u.home === cadRoot.id).map((u) => u.id)).toContain(second[0].id);
    expect(new Set(all.map((u) => u.blurtId)).size).toBe(2);
  });
});

describe('the parser is told what the writer already pulled out (issue #39)', () => {
  it('passes every existing idea, nested, with hand cuts quoted, and the prompt carries them', async () => {
    const { parseBlurt, buildContext } = await import('../server/parser.ts');
    const slug = (await request(app).post('/api/projects').send({ title: 'hand then parse' })).body.slug;
    const root = (await request(app).post(`/api/p/${slug}/units`).send({ text: 'CAD AI is following the path of coding.' })).body as Unit;
    const piece = (await request(app).post(`/api/p/${slug}/units`).send({ text: 'There used to be draftsmen.', home: root.id })).body as Unit;
    await request(app).post(`/api/p/${slug}/blurts`).send({ text: BLURT });

    const [blurt, vocab, roots, , , , nodes] = vi.mocked(parseBlurt).mock.calls.at(-1)!;
    expect(nodes).toEqual([
      { id: root.id, type: 'claim', label: root.label, home: null, text: root.text },
      { id: piece.id, type: 'claim', label: piece.label, home: root.id, text: piece.text },
    ]);
    // The real prompt, built from what the server passed: the hand cut is quoted, indented under its root.
    const prompt = buildContext(blurt, vocab, roots, nodes);
    expect(prompt).toContain(`- ${root.id}, claim: ${root.label} [cut by hand: "CAD AI is following the path of coding."]`);
    expect(prompt).toContain(`  - claim: ${piece.label} [cut by hand: "There used to be draftsmen."]`);
  });

  it('drops a parsed unit that repeats a hand cut, and ties the hand cut to the blurt', async () => {
    const slug = (await request(app).post('/api/projects').send({ title: 'no double cut' })).body.slug;
    // The stand-in parser always returns this claim first; the writer already cut it by hand.
    const hand = (await request(app).post(`/api/p/${slug}/units`).send({ text: 'CAD AI is following the path of coding.' })).body as Unit;
    const parsed: Unit[] = (await request(app).post(`/api/p/${slug}/blurts`).send({ text: BLURT })).body.units;
    expect(parsed.map((u) => u.text)).not.toContain(hand.text);
    // The model's pieces under that claim now sit under the hand cut.
    expect(parsed.find((u) => u.text.startsWith('In the last couple weeks') || u.label === 'computer use improving')!.home).toBe(hand.id);
    const after = ((await request(app).get(`/api/p/${slug}`)).body.units as Unit[]).find((u) => u.id === hand.id)!;
    expect(BLURT.slice(after.start, after.end)).toBe(hand.text);
  });

  it('quotes only hand cuts; parsed ideas go by label, loose ones listed apart', async () => {
    const { buildContext } = await import('../server/parser.ts');
    const prompt = buildContext('blurt', ['law of the minimum'], [{ id: 'r1', type: 'question', label: 'what limits growth' }], [
      { id: 'r1', type: 'question', label: 'what limits growth', home: null },
      { id: 'p1', type: 'concept', label: 'law of the minimum', home: 'r1' },
      { id: 'l1', type: 'evidence', label: 'nitrogen trial', home: null, text: 'Plots with nitrogen grew twice as fast.' },
    ]);
    expect(prompt).toContain('- r1, question: what limits growth\n  - concept: law of the minimum\nLoose (under no root):\n- evidence: nitrogen trial [cut by hand: "Plots with nitrogen grew twice as fast."]');
    expect(prompt).not.toContain('p1');
    expect(prompt.endsWith('<blurt>\nblurt\n</blurt>')).toBe(true);
  });
});
