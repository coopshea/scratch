import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { Project } from '../shared/types.ts';
import { labelProblem, LABEL_MAX_CHARS } from '../shared/types.ts';
import { replay } from '../shared/replay.ts';
import { readEvents, tempDataDir } from './helpers.ts';

const DATA = tempDataDir();
process.env.SCRATCH_DATA = DATA;
process.env.PARSER = 'offline';
delete process.env.READWISE_TOKEN;

let app: Express;
beforeAll(async () => { app = (await import('../server/app.ts')).createApp(); });

const FIXTURE = new URL('../examples/gas-turbines/', import.meta.url);
const read = (f: string) => fs.readFileSync(new URL(f, FIXTURE), 'utf8');

describe('the gas turbines example obeys the same rules as real writing', () => {
  const units = JSON.parse(read('units.json')) as Project['units'];
  const blurtFile = fs.readdirSync(new URL('blurts/', FIXTURE))[0];
  const blurt = read(`blurts/${blurtFile}`);

  it('is marked as an example in its title', () => {
    expect(JSON.parse(read('meta.json')).title).toMatch(/^Example:/);
  });

  it('cuts every idea verbatim from the spill, at the offsets recorded', () => {
    for (const u of units) {
      expect(u.blurtId).toBe(blurtFile.replace(/\.md$/, ''));
      expect(blurt.slice(u.start, u.end)).toBe(u.text);
    }
  });

  it('labels every idea in 3 to 6 words, 40 characters at most', () => {
    for (const u of units) {
      expect(labelProblem(u.label)).toBeNull();
      expect(u.label.length).toBeLessThanOrEqual(LABEL_MAX_CHARS);
      expect(u.label.split(/\s+/).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('has a history that replays to exactly what is stored', () => {
    const events = read('events.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const end = replay(events, events.length);
    expect(end.draft).toBe(read('draft.md'));
    expect(end.board).toEqual(JSON.parse(read('board.json')));
    expect(end.units.map(({ labeledBy: _, ...u }) => u)).toEqual(units.map(({ labeledBy: _, ...u }) => u));
    expect(events.find((e) => e.type === 'parse').author).toBe('model');
  });

  it('places at least one piece of evidence in the draft, so export has a footnote', () => {
    const anchored = [...read('draft.md').matchAll(/<!--u:([a-z0-9]+)-->/g)].map((m) => m[1]);
    expect(units.some((u) => u.type === 'evidence' && anchored.includes(u.id))).toBe(true);
  });
});

describe('opening the example', () => {
  it('copies it as a new document, logged as the system, and each open is a fresh copy', async () => {
    const a = await request(app).post('/api/projects/example').send({});
    const b = await request(app).post('/api/projects/example').send({ name: 'gas-turbines' });
    expect(a.status).toBe(200);
    expect([a.body.slug, b.body.slug]).toEqual(['example-gas-turbines', 'example-gas-turbines-2']);
    expect(a.body.title).toMatch(/^Example:/);

    const events = readEvents(DATA, a.body.slug);
    expect(events.at(-1)).toMatchObject({ author: 'system', type: 'project.fromExample', data: { example: 'gas-turbines' } });
    expect(events.filter((e) => e.type === 'project.fromExample')).toHaveLength(1);

    const p = (await request(app).get(`/api/p/${a.body.slug}`)).body as Project;
    expect(p.units.length).toBeGreaterThan(10);
    expect(p.blurts).toHaveLength(1);
    expect(p.draft).toContain('<!--s:hook-->');
  });

  it('exports with the evidence as footnotes', async () => {
    const { body } = await request(app).post('/api/projects/example').send({});
    const md = (await request(app).get(`/api/p/${body.slug}/export.md`)).text;
    expect(md).toMatch(/^# Example:/);
    expect(md).toMatch(/\[\^1\]: /);
    expect(md).not.toContain('<!--');
  });

  it('leaves the shipped example untouched when the copy is edited', async () => {
    const { body } = await request(app).post('/api/projects/example').send({});
    await request(app).put(`/api/p/${body.slug}/draft`).send({ text: 'changed' });
    expect(fs.readFileSync(path.join(DATA, body.slug, 'draft.md'), 'utf8')).toBe('changed');
    expect(read('draft.md')).not.toBe('changed');
  });

  it('refuses names that are not shipped examples', async () => {
    for (const name of ['nope', '../gas-turbines', 'Gas']) {
      expect((await request(app).post('/api/projects/example').send({ name })).status).toBe(404);
    }
  });
});
