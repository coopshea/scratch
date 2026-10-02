import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import type { Unit } from '../shared/types.ts';
import { readEvents, tempDataDir } from './helpers.ts';

// A stand-in parser, so each test says exactly what the model answers. No API calls.
vi.mock('../server/parser.ts', async (orig) => ({
  ...(await orig<typeof import('../server/parser.ts')>()),
  parseBlurt: vi.fn(async () => ({ units: [], untyped: [] })),
}));

const DATA = tempDataDir();
process.env.SCRATCH_DATA = DATA;

let app: Express;
beforeAll(async () => { app = (await import('../server/app.ts')).createApp(); });

const SPILL = 'Certification is the real moat in jet engines. The GE9X ran thousands of test hours. Who pays for the testing?';

async function setup() {
  const slug = (await request(app).post('/api/projects').send({ title: 'mocked' })).body.slug as string;
  const cut = async (text: string, home: string | null = null, spill = SPILL) =>
    (await request(app).post(`/api/p/${slug}/units`).send({ text, home, spill })).body as Unit;
  const parse = (text = SPILL) => request(app).post(`/api/p/${slug}/blurts`).send({ text });
  const units = async () => (await request(app).get(`/api/p/${slug}`)).body.units as Unit[];
  return { slug, cut, parse, units };
}

describe('4. the prompt carries every existing idea', () => {
  it('lists each idea with id, type or untyped, label, its words and grouping; hand cuts marked', async () => {
    const { parseBlurt, buildContext, SYSTEM } = await import('../server/parser.ts');
    const { cut, parse } = await setup();
    const root = await cut('Certification is the real moat in jet engines.');
    const piece = await cut('The GE9X ran thousands of test hours.', root.id);
    await parse();

    const [blurt, vocab, roots, , , , nodes] = vi.mocked(parseBlurt).mock.calls.at(-1)!;
    expect(nodes).toEqual([
      { id: root.id, type: null, label: root.label, home: null, text: root.text, hand: true },
      { id: piece.id, type: null, label: piece.label, home: root.id, text: piece.text, hand: true },
    ]);
    const prompt = buildContext(blurt, vocab, roots, nodes);
    expect(prompt).toContain(`- ${root.id}, untyped: ${root.label} — "Certification is the real moat in jet engines." [already cut, do not cut again]`);
    expect(prompt).toContain(`\n  - ${piece.id}, untyped: ${piece.label} — "The GE9X ran thousands of test hours." [already cut, do not cut again]`);
    expect(SYSTEM).toMatch(/variation on an existing idea/);
    expect(SYSTEM).toMatch(/Never merge text into existing ideas/);
  });

  it('shows parsed ideas with their words too, unmarked, and loose ones apart', async () => {
    const { buildContext } = await import('../server/parser.ts');
    const prompt = buildContext('blurt', [], [{ id: 'r1' }], [
      { id: 'r1', type: 'question', label: 'what limits growth', home: null, text: 'What limits growth?' },
      { id: 'l1', type: 'evidence', label: 'nitrogen trial', home: null, text: 'Plots with nitrogen grew twice as fast.' },
    ]);
    expect(prompt).toContain('- r1, question: what limits growth — "What limits growth?"\nLoose (under no root):\n- l1, evidence: nitrogen trial — "Plots with nitrogen grew twice as fast."');
    expect(prompt).not.toContain('already cut');
  });
});

describe('4. overlap is by position', () => {
  it('drops an overlapping parsed unit and hangs its pieces on the hand cut', async () => {
    const { parseBlurt } = await import('../server/parser.ts');
    const { cut, parse } = await setup();
    const hand = await cut('Certification is the real moat in jet engines.');
    vi.mocked(parseBlurt).mockResolvedValueOnce({
      untyped: [],
      units: [
        { key: 'r1', type: 'claim', text: 'Certification is the real moat', label: 'certification as moat', home: '' },
        { key: 'u1', type: 'evidence', text: 'The GE9X ran thousands of test hours.', label: 'ge9x test hours', home: 'r1' },
      ],
    });
    const parsed: Unit[] = (await parse()).body.units;
    expect(parsed.map((u) => u.text)).toEqual(['The GE9X ran thousands of test hours.']);
    expect(parsed[0].home).toBe(hand.id);
  });
});

describe('5. typing and grouping untyped ideas', () => {
  it('applies the model’s type and home, logged as model', async () => {
    const { parseBlurt } = await import('../server/parser.ts');
    const { slug, cut, parse, units } = await setup();
    const q = await cut('Who pays for the testing?');
    vi.mocked(parseBlurt).mockResolvedValueOnce({
      units: [{ key: 'r1', type: 'claim', text: 'Certification is the real moat in jet engines.', label: 'certification as moat', home: '' }],
      untyped: [{ id: q.id, type: 'question', home: 'r1' }],
    });
    const [root] = (await parse()).body.units as Unit[];
    expect((await units()).find((u) => u.id === q.id)).toMatchObject({ type: 'question', home: root.id });
    expect(readEvents(DATA, slug).at(-1)).toMatchObject({ author: 'model', type: 'unit.update', data: { id: q.id, patch: { type: 'question', home: root.id } } });
  });

  it('never moves an idea the writer placed, loose included', async () => {
    const { parseBlurt } = await import('../server/parser.ts');
    const { slug, cut, parse, units } = await setup();
    const q = await cut('Who pays for the testing?');
    await request(app).patch(`/api/p/${slug}/units/${q.id}`).send({ home: null }); // dragged out to open board
    vi.mocked(parseBlurt).mockResolvedValueOnce({
      units: [{ key: 'r1', type: 'claim', text: 'Certification is the real moat in jet engines.', label: 'certification as moat', home: '' }],
      untyped: [{ id: q.id, type: 'question', home: 'r1' }],
    });
    await parse();
    expect((await units()).find((u) => u.id === q.id)).toMatchObject({ type: 'question', home: null });
  });

  it('keeps the writer’s grouping: an untyped idea holding pieces isn’t typed as something that can’t hold them', async () => {
    const { parseBlurt } = await import('../server/parser.ts');
    const { cut, parse, units } = await setup();
    const root = await cut('Certification is the real moat in jet engines.');
    const piece = await cut('The GE9X ran thousands of test hours.', root.id);
    vi.mocked(parseBlurt).mockResolvedValueOnce({ units: [], untyped: [{ id: root.id, type: 'evidence', home: '' }, { id: piece.id, type: 'evidence', home: '' }] });
    await parse();
    const after = await units();
    expect(after.find((u) => u.id === root.id)!.type).toBeNull();
    expect(after.find((u) => u.id === piece.id)).toMatchObject({ type: 'evidence', home: root.id });
  });
});
