import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { Unit } from '../shared/types.ts';
import { replay } from '../shared/replay.ts';
import { readEvents, tempDataDir } from './helpers.ts';

// Issue #39: words highlighted in the spill and dragged onto the board. Offline parser, no API calls.
const DATA = tempDataDir();
process.env.SCRATCH_DATA = DATA;
process.env.PARSER = 'offline';

let app: Express;
beforeAll(async () => { app = (await import('../server/app.ts')).createApp(); });

const SPILL = 'Certification is the real moat in jet engines. The GE9X ran thousands of test hours. Who pays for the testing?';

async function setup() {
  const slug = (await request(app).post('/api/projects').send({ title: 'hand cuts' })).body.slug as string;
  const cut = async (text: string, home: string | null = null) => {
    const res = await request(app).post(`/api/p/${slug}/units`).send({ text, home });
    return res;
  };
  const patch = (id: string, body: object) => request(app).patch(`/api/p/${slug}/units/${id}`).send(body);
  const units = async () => (await request(app).get(`/api/p/${slug}`)).body.units as Unit[];
  return { slug, cut, patch, units };
}

describe('cutting an idea by hand', () => {
  it('keeps the highlighted words exactly, marks them the writer’s, and logs it as human', async () => {
    const { slug, cut } = await setup();
    const res = await cut('Certification is the real moat in jet engines.');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      text: 'Certification is the real moat in jet engines.', type: 'claim', home: null, status: 'accepted',
      origin: 'human', cutBy: 'human', labeledBy: 'system', verified: false,
    });
    expect(readEvents(DATA, slug).at(-1)).toMatchObject({ author: 'human', type: 'unit.create', data: { unit: { id: res.body.id } } });
  });

  it('cuts the label from the words themselves, within the label limits', async () => {
    const { cut } = await setup();
    const u = (await cut('Certification is the real moat in jet engines, and has been since the 1950s.')).body as Unit;
    expect(u.label).toBe('Certification is the real moat in');
    expect(u.label.split(' ').length).toBeLessThanOrEqual(6);
    expect(u.label.length).toBeLessThanOrEqual(40);
  });

  it('makes a question of words ending in a question mark', async () => {
    const { cut } = await setup();
    expect((await cut('Who pays for the testing?')).body.type).toBe('question');
  });

  it('nests under the idea it was dropped on, or beside a piece, under that piece’s root', async () => {
    const { cut } = await setup();
    const root = (await cut('Certification is the real moat.')).body as Unit;
    const piece = (await cut('The GE9X ran thousands of test hours.', root.id)).body as Unit;
    expect(piece.home).toBe(root.id);
    const beside = (await cut('Who pays for the testing?', piece.id)).body as Unit;
    expect(beside.home).toBe(root.id);
  });

  it('lands alone when dropped on something that can’t hold it, or nowhere', async () => {
    const { cut, patch } = await setup();
    const loose = (await cut('The GE9X ran thousands of test hours.')).body as Unit;
    await patch(loose.id, { type: 'evidence' });
    expect((await cut('More words.', loose.id)).body.home).toBeNull();
    expect((await cut('Other words.', 'no-such-id')).body.home).toBeNull();
  });

  it('refuses an empty highlight', async () => {
    const { cut } = await setup();
    expect((await cut('   ')).status).toBe(400);
  });

  it('replays in history', async () => {
    const { slug, cut } = await setup();
    const root = (await cut('Certification is the real moat.')).body as Unit;
    await cut('The GE9X ran thousands of test hours.', root.id);
    const past = replay(readEvents(DATA, slug), Infinity);
    expect(past.units.map((u) => u.home)).toEqual([null, root.id]);
  });
});

describe('dragging one idea onto another', () => {
  it('nests it through the logged edit', async () => {
    const { slug, cut, patch, units } = await setup();
    const a = (await cut('Certification is the real moat.')).body as Unit;
    const b = (await cut('Testing costs a fortune.')).body as Unit;
    expect((await patch(b.id, { home: a.id })).body.home).toBe(a.id);
    expect((await units()).find((u) => u.id === b.id)!.home).toBe(a.id);
    expect(readEvents(DATA, slug).at(-1)).toMatchObject({ author: 'human', type: 'unit.update', data: { id: b.id, patch: { home: a.id } } });
  });
});

describe('a later parse builds around hand cuts', () => {
  it('ties each hand cut to the blurt it came from, and does not cut the same words again', async () => {
    const { slug, cut } = await setup();
    const hand = (await cut('The GE9X ran thousands of test hours.')).body as Unit;
    const res = await request(app).post(`/api/p/${slug}/blurts`).send({ text: SPILL });
    const parsed: Unit[] = res.body.units;
    expect(parsed.map((u) => u.text)).not.toContain(hand.text);
    expect(parsed.map((u) => u.text)).toContain('Certification is the real moat in jet engines.');
    const after = ((await request(app).get(`/api/p/${slug}`)).body.units as Unit[]).find((u) => u.id === hand.id)!;
    expect(after.blurtId).toBe(res.body.blurt.id);
    expect(SPILL.slice(after.start, after.end)).toBe(hand.text);
    const events = readEvents(DATA, slug);
    expect(events.find((e) => e.type === 'unit.update' && e.data.id === hand.id)).toMatchObject({ author: 'system' });
    expect(events.at(-1)).toMatchObject({ type: 'parse', author: 'model', data: { skipped: [hand.id] } });
  });

  it('hangs pieces the model put under a repeated hand cut on that hand cut instead', async () => {
    const { slug, cut } = await setup();
    // Offline, the first sentence is the claim and the rest hang under it; here the writer already cut that claim.
    const hand = (await cut('Certification is the real moat in jet engines.')).body as Unit;
    const parsed: Unit[] = (await request(app).post(`/api/p/${slug}/blurts`).send({ text: SPILL })).body.units;
    expect(parsed.map((u) => u.text)).not.toContain(hand.text);
    const piece = parsed.find((u) => u.text.startsWith('The GE9X'))!;
    expect(piece.home).toBe(hand.id);
  });
});
