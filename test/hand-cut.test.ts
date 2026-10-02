import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { Blurt, Project, Unit } from '../shared/types.ts';
import { replay } from '../shared/replay.ts';
import { readEvents, tempDataDir } from './helpers.ts';

// Issue #39 and Cooper's review: the open spill, hand cuts, and parse closing the spill. Offline parser, no API calls.
const DATA = tempDataDir();
process.env.SCRATCH_DATA = DATA;
process.env.PARSER = 'offline';

let app: Express;
beforeAll(async () => { app = (await import('../server/app.ts')).createApp(); });

const SPILL = 'Certification is the real moat in jet engines. The GE9X ran thousands of test hours. Who pays for the testing?';

async function setup() {
  const slug = (await request(app).post('/api/projects').send({ title: 'hand cuts' })).body.slug as string;
  const save = (text: string) => request(app).put(`/api/p/${slug}/spill`).send({ text });
  /** A drag from the spill box: the highlighted words, and the box's whole text with them. */
  const cut = (text: string, home: string | null = null, spill = SPILL) => request(app).post(`/api/p/${slug}/units`).send({ text, home, spill });
  const parse = (text?: string) => request(app).post(`/api/p/${slug}/blurts`).send(text === undefined ? {} : { text });
  const patch = (id: string, body: object) => request(app).patch(`/api/p/${slug}/units/${id}`).send(body);
  const load = async () => (await request(app).get(`/api/p/${slug}`)).body as Project;
  const events = () => readEvents(DATA, slug);
  return { slug, save, cut, parse, patch, load, events };
}

describe('1. the box is always saved', () => {
  it('saves the box as the one open spill, one logged event per save, none when nothing changed', async () => {
    const { save, load, events } = await setup();
    const first = (await save('Certification is')).body.open as Blurt;
    const second = (await save('Certification is the real moat.')).body.open as Blurt;
    await save('Certification is the real moat.');
    expect(second.id).toBe(first.id);
    expect((await load()).open).toMatchObject({ id: first.id, text: 'Certification is the real moat.' });
    expect((await load()).blurts).toEqual([]);
    expect(events().filter((e) => e.type === 'blurt.update').map((e) => [e.author, e.data.text]))
      .toEqual([['human', 'Certification is'], ['human', 'Certification is the real moat.']]);
  });

  it('a drag saves the box first, and the cut points to the open spill with no position yet', async () => {
    const { cut, load, events } = await setup();
    const u = (await cut('The GE9X ran thousands of test hours.')).body as Unit;
    const { open } = await load();
    expect(open?.text).toBe(SPILL);
    expect(u).toMatchObject({ blurtId: open!.id, start: -1, end: -1, text: 'The GE9X ran thousands of test hours.' });
    expect(events().map((e) => e.type).slice(-2)).toEqual(['blurt.update', 'unit.create']);
  });

  it('reload before parsing keeps the box text and the cuts', async () => {
    const { save, cut, load } = await setup();
    await save(SPILL);
    const u = (await cut('Who pays for the testing?')).body as Unit;
    const p = await load(); // what a reload fetches
    expect(p.open?.text).toBe(SPILL);
    expect(p.units.map((x) => x.id)).toEqual([u.id]);
  });
});

describe('a hand cut', () => {
  it('keeps the words exactly, is the writer’s, untyped, and logged as human', async () => {
    const { cut, events } = await setup();
    const res = await cut('Certification is the real moat in jet engines.');
    expect(res.body).toMatchObject({
      text: 'Certification is the real moat in jet engines.', type: null, home: null, status: 'accepted',
      origin: 'human', cutBy: 'human', labeledBy: 'system', verified: false,
    });
    expect(events().at(-1)).toMatchObject({ author: 'human', type: 'unit.create', data: { unit: { id: res.body.id } } });
  });

  it('is untyped even when it ends in a question mark', async () => {
    const { cut } = await setup();
    expect((await cut('Who pays for the testing?')).body.type).toBeNull();
  });

  it('takes its label from its own first words, within the limits', async () => {
    const { cut } = await setup();
    expect((await cut('Certification is the real moat in jet engines.')).body.label).toBe('Certification is the real moat in');
  });

  it('nests under the idea it was dropped on (an untyped one too), or beside a piece; the writer chose that home', async () => {
    const { cut } = await setup();
    const root = (await cut('Certification is the real moat in jet engines.')).body as Unit;
    const piece = (await cut('The GE9X ran thousands of test hours.', root.id)).body as Unit;
    expect(piece).toMatchObject({ home: root.id, homedBy: 'human' });
    expect((await cut('Who pays for the testing?', piece.id)).body.home).toBe(root.id);
    expect(root.homedBy).toBeUndefined(); // dropped on open board: not a choice of home
  });

  it('lands alone on something that can’t hold it', async () => {
    const { cut, patch } = await setup();
    const loose = (await cut('The GE9X ran thousands of test hours.')).body as Unit;
    await patch(loose.id, { type: 'evidence' });
    expect((await cut('Who pays for the testing?', loose.id)).body.home).toBeNull();
  });

  it('takes a type from the writer, never an unset one', async () => {
    const { cut, patch } = await setup();
    const u = (await cut('Who pays for the testing?')).body as Unit;
    expect((await patch(u.id, { type: null })).status).toBe(400);
    expect((await patch(u.id, { type: 'question' })).body).toMatchObject({ type: 'question', labeledBy: 'human' });
  });

  it('replays in history, untyped', async () => {
    const { slug, cut } = await setup();
    const root = (await cut('Certification is the real moat in jet engines.')).body as Unit;
    await cut('The GE9X ran thousands of test hours.', root.id);
    const past = replay(readEvents(DATA, slug), Infinity);
    expect(past.units.map((u) => [u.type, u.home])).toEqual([[null, null], [null, root.id]]);
  });
});

describe('2. parse is the only thing that closes a spill', () => {
  it('closes exactly the open spill, under the same id, and the box is empty after', async () => {
    const { save, parse, load } = await setup();
    const open = (await save(SPILL)).body.open as Blurt;
    const res = await parse(SPILL);
    expect(res.status).toBe(200);
    expect(res.body.blurt).toMatchObject({ id: open.id, text: SPILL });
    const p = await load();
    expect(p.open).toBeNull();
    expect(p.blurts).toMatchObject([{ id: open.id, text: SPILL, parsed: true }]);
  });

  it('saves the latest box text before closing', async () => {
    const { save, parse, load } = await setup();
    await save('Certification is');
    await parse(SPILL);
    expect((await load()).blurts.map((b) => b.text)).toEqual([SPILL]);
  });

  it('refuses an empty spill, and never parses a closed spill again', async () => {
    const { slug, parse } = await setup();
    expect((await parse('   ')).status).toBe(400);
    const id = (await parse(SPILL)).body.blurt.id;
    expect((await request(app).post(`/api/p/${slug}/blurts/${id}/parse`)).status).toBe(409);
  });
});

describe('3. on close, every hand cut is located', () => {
  it('sets each hand cut’s position in the final words, logged as system', async () => {
    const { cut, parse, load, events } = await setup();
    const u = (await cut('The GE9X ran thousands of test hours.')).body as Unit;
    await parse(SPILL);
    const after = (await load()).units.find((x) => x.id === u.id)!;
    expect(SPILL.slice(after.start, after.end)).toBe(u.text);
    expect(after.flags?.notVerbatim).toBeUndefined();
    expect(events().find((e) => e.type === 'unit.update' && e.data.id === u.id)).toMatchObject({ author: 'system', data: { patch: { start: after.start, end: after.end } } });
  });

  it('drag, then delete those words, then parse: the idea is flagged, like a cut that isn’t verbatim', async () => {
    const { cut, parse, load } = await setup();
    const u = (await cut('The GE9X ran thousands of test hours.')).body as Unit;
    const edited = SPILL.replace(' The GE9X ran thousands of test hours.', '');
    await parse(edited);
    const after = (await load()).units.find((x) => x.id === u.id)!;
    expect(after).toMatchObject({ start: -1, end: -1, flags: { notVerbatim: true }, text: u.text });
  });
});

describe('4. words already cut aren’t cut again', () => {
  it('drops a parsed unit whose span overlaps a hand cut, and logs it as skipped', async () => {
    const { cut, parse, events } = await setup();
    // Part of a sentence: the offline parser cuts whole sentences, so its first sentence overlaps this.
    const hand = (await cut('the real moat')).body as Unit;
    const parsed: Unit[] = (await parse(SPILL)).body.units;
    expect(parsed.map((u) => u.text)).not.toContain('Certification is the real moat in jet engines.');
    expect(parsed.map((u) => u.text)).toContain('The GE9X ran thousands of test hours.');
    expect(events().at(-1)!.type).not.toBe('parse'); // the untyped hand cut was typed after
    const parseEvent = events().find((e) => e.type === 'parse')!;
    expect(parseEvent.data.skipped).toEqual([{ text: 'Certification is the real moat in jet engines.', start: 0, end: 46, handCut: hand.id }]);
  });

  it('keeps parsed units that only share words with a hand cut, not position', async () => {
    const { cut, parse } = await setup();
    // The same words, but in an earlier spill: no overlap in this one.
    await cut('Who pays for the testing?', null, 'Who pays for the testing?');
    await parse();
    const parsed: Unit[] = (await parse(SPILL)).body.units;
    expect(parsed.map((u) => u.text)).toContain('Who pays for the testing?');
  });
});

describe('cutting by hand from a closed spill', () => {
  it('knows the position at once, and leaves the open spill alone', async () => {
    const { slug, parse, load } = await setup();
    const id = (await parse(SPILL)).body.blurt.id;
    const start = SPILL.indexOf('The GE9X');
    // As highlighted on the page, a stray space included: the idea takes the words, the position follows them.
    const res = await request(app).post(`/api/p/${slug}/units`)
      .send({ text: ' The GE9X ran thousands', home: null, from: { blurtId: id, start: start - 1, end: start + 22 } });
    expect(res.body).toMatchObject({ text: 'The GE9X ran thousands', blurtId: id, start, end: start + 22, type: null, cutBy: 'human' });
    expect(res.body.flags).toBeUndefined();
    expect((await load()).open).toBeNull();
  });

  it('flags words that aren’t in that spill', async () => {
    const { slug, parse } = await setup();
    const id = (await parse(SPILL)).body.blurt.id;
    const res = await request(app).post(`/api/p/${slug}/units`).send({ text: 'never said this', from: { blurtId: id, start: 0, end: 15 } });
    expect(res.body).toMatchObject({ start: -1, flags: { notVerbatim: true } });
  });
});

describe('5. a parse types and groups untyped ideas', () => {
  it('types an untyped hand cut in the same call, logged as model', async () => {
    const { cut, parse, load, events } = await setup();
    const q = (await cut('Who pays for the testing?')).body as Unit;
    await parse(SPILL);
    expect((await load()).units.find((u) => u.id === q.id)!.type).toBe('question');
    expect(events().at(-1)).toMatchObject({ author: 'model', type: 'unit.update', data: { id: q.id, patch: { type: 'question' } } });
  });

  it('never overrides a type the writer picked', async () => {
    const { cut, patch, parse, load, events } = await setup();
    const u = (await cut('Who pays for the testing?')).body as Unit;
    await patch(u.id, { type: 'objection' });
    await parse(SPILL);
    expect((await load()).units.find((x) => x.id === u.id)!.type).toBe('objection');
    expect(events().filter((e) => e.author === 'model' && e.type === 'unit.update')).toEqual([]);
  });
});
