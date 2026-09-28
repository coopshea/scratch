import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { Unit } from '../shared/types.ts';
import { readEvents, tempDataDir } from './helpers.ts';

// Real server, real files, in a temporary folder. The offline parser splits by sentence, with no API calls.
const DATA = tempDataDir();
process.env.SCRATCH_DATA = DATA;
process.env.PARSER = 'offline';
delete process.env.READWISE_TOKEN;

let app: Express;
beforeAll(async () => { app = (await import('../server/app.ts')).createApp(); });

const BLURT = 'Certification is the real moat. The GE9X ran 5,000 hours of testing. Why do airlines exist?';

async function newProject(title = 'Gas turbines') {
  const res = await request(app).post('/api/projects').send({ title });
  return res.body.slug as string;
}

async function blurt(slug: string, text = BLURT) {
  const res = await request(app).post(`/api/p/${slug}/blurts`).send({ text });
  expect(res.status).toBe(200);
  return res.body as { blurt: { id: string; text: string }; units: Unit[] };
}

describe('projects', () => {
  it('creates a project from a title, with a unique slug', async () => {
    expect(await newProject('Gas Turbines!')).toBe('gas-turbines');
    expect(await newProject('Gas Turbines!')).toBe('gas-turbines-2');
  });

  it('rejects slugs that could escape the data folder', async () => {
    for (const bad of ['..', 'Bad_Slug', '-x']) {
      expect((await request(app).get(`/api/p/${encodeURIComponent(bad)}`)).status).toBe(400);
    }
  });

  it('writes only inside the data folder', async () => {
    const slug = await newProject('Contained');
    expect(fs.existsSync(path.join(DATA, slug, 'meta.json'))).toBe(true);
  });
});

describe('talk: blurt and parse', () => {
  it('keeps the raw blurt exactly as written', async () => {
    const slug = await newProject();
    const { blurt: b } = await blurt(slug);
    expect(fs.readFileSync(path.join(DATA, slug, 'blurts', `${b.id}.md`), 'utf8')).toBe(BLURT);
  });

  it('cuts units verbatim from the blurt, at the offsets recorded', async () => {
    const slug = await newProject();
    const { units } = await blurt(slug);
    expect(units.map((u) => u.type)).toEqual(['claim', 'evidence', 'question']);
    for (const u of units) {
      expect(u.start).toBeGreaterThanOrEqual(0);
      expect(BLURT.slice(u.start, u.end)).toBe(u.text);
    }
  });

  it('lands parsed units straight in the map: accepted, human words, model labels, unverified', async () => {
    const slug = await newProject();
    const { units } = await blurt(slug);
    for (const u of units) {
      expect(u).toMatchObject({ status: 'accepted', origin: 'human', labeledBy: 'model', verified: false });
    }
    const [claim, ...rest] = units;
    for (const u of rest) expect(u.home).toBe(claim.id);
  });

  it('rejects an empty blurt', async () => {
    const slug = await newProject();
    expect((await request(app).post(`/api/p/${slug}/blurts`).send({ text: '  ' })).status).toBe(400);
  });
});

describe('rule: every mutation is logged with its author', () => {
  it('logs the blurt as human and the parse as model', async () => {
    const slug = await newProject();
    await blurt(slug);
    const events = readEvents(DATA, slug).map((e) => [e.type, e.author]);
    expect(events).toEqual([['project.create', 'human'], ['blurt.create', 'human'], ['parse', 'model']]);
  });

  it('logs a human edit, and marks the label as the writer’s', async () => {
    const slug = await newProject();
    const { units } = await blurt(slug);
    const res = await request(app).patch(`/api/p/${slug}/units/${units[0].id}`).send({ label: 'certification as the moat' });
    expect(res.body.labeledBy).toBe('human');
    const last = readEvents(DATA, slug).at(-1)!;
    expect(last).toMatchObject({ author: 'human', type: 'unit.update', data: { id: units[0].id, patch: { label: 'certification as the moat' } } });
  });

  it('logs automatic board moves as system, not as the writer', async () => {
    const slug = await newProject();
    const board = { structure: 'persuasive', lanes: { persuasive: { thesis: ['x'] } } };
    await request(app).put(`/api/p/${slug}/board?auto=1`).send(board);
    await request(app).put(`/api/p/${slug}/board`).send(board);
    const authors = readEvents(DATA, slug).filter((e) => e.type === 'board.update').map((e) => e.author);
    expect(authors).toEqual(['system', 'human']);
  });

  it('logs a draft snapshot only when the text changes', async () => {
    const slug = await newProject();
    await request(app).put(`/api/p/${slug}/draft`).send({ text: 'one' });
    await request(app).put(`/api/p/${slug}/draft`).send({ text: 'one' });
    await request(app).put(`/api/p/${slug}/draft`).send({ text: 'two' });
    expect(readEvents(DATA, slug).filter((e) => e.type === 'draft.snapshot').map((e) => e.data.text)).toEqual(['one', 'two']);
  });
});

describe('unit edits', () => {
  it('enforces label limits on the server', async () => {
    const slug = await newProject();
    const { units } = await blurt(slug);
    const res = await request(app).patch(`/api/p/${slug}/units/${units[0].id}`).send({ label: 'one two three four five six seven' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/7 words/);
  });

  it('only lets a unit belong to another claim', async () => {
    const slug = await newProject();
    const { units } = await blurt(slug);
    const [claim, evidence, question] = units;
    expect((await request(app).patch(`/api/p/${slug}/units/${evidence.id}`).send({ home: question.id })).status).toBe(400);
    expect((await request(app).patch(`/api/p/${slug}/units/${claim.id}`).send({ home: claim.id })).status).toBe(400);
  });

  it('releases children when a claim becomes something else', async () => {
    const slug = await newProject();
    const { units } = await blurt(slug);
    await request(app).patch(`/api/p/${slug}/units/${units[0].id}`).send({ type: 'concept' });
    const project = (await request(app).get(`/api/p/${slug}`)).body;
    expect(project.units.filter((u: Unit) => u.home !== null)).toEqual([]);
  });

  it('ignores fields the writer cannot edit', async () => {
    const slug = await newProject();
    const { units } = await blurt(slug);
    const res = await request(app).patch(`/api/p/${slug}/units/${units[0].id}`).send({ text: 'rewritten', origin: 'model' });
    expect(res.body.text).toBe(units[0].text);
    expect(res.body.origin).toBe('human');
  });

  it('rejects unknown types and statuses', async () => {
    const slug = await newProject();
    const { units } = await blurt(slug);
    expect((await request(app).patch(`/api/p/${slug}/units/${units[0].id}`).send({ type: 'essay' })).status).toBe(400);
    expect((await request(app).patch(`/api/p/${slug}/units/${units[0].id}`).send({ status: 'deleted' })).status).toBe(400);
  });
});

describe('board', () => {
  it('drops unknown structures and levels', async () => {
    const slug = await newProject();
    expect((await request(app).put(`/api/p/${slug}/board`).send({ structure: 'nope', lanes: {} })).status).toBe(400);
    const res = await request(app).put(`/api/p/${slug}/board`)
      .send({ structure: 'persuasive', lanes: { persuasive: { thesis: ['a'], bogus: ['b'] }, nope: { x: ['c'] } } });
    expect(res.body.lanes.persuasive).toEqual({ thesis: ['a'] });
    expect(res.body.lanes.nope).toBeUndefined();
  });
});

describe('export', () => {
  it('produces clean markdown with evidence as a footnote, and logs the export', async () => {
    const slug = await newProject('Export Me');
    const { units } = await blurt(slug);
    const [claim, evidence] = units;
    await request(app).put(`/api/p/${slug}/draft`).send({ text: `<!--s:thesis-->\nThe moat.<!--u:${claim.id}--> Hours.<!--u:${evidence.id}-->` });
    const res = await request(app).get(`/api/p/${slug}/export.md`);
    expect(res.headers['content-disposition']).toContain('export-me.md');
    expect(res.text).toBe('# Export Me\n\nThe moat. Hours.[^1]\n\n[^1]: The GE9X ran 5,000 hours of testing.\n');
    expect(readEvents(DATA, slug).at(-1)).toMatchObject({ type: 'export', author: 'human' });
  });
});

describe('readwise without a token', () => {
  it('reports itself off, and search returns nothing', async () => {
    const slug = await newProject();
    expect((await request(app).get('/api/readwise/status')).body).toMatchObject({ token: false, search: false });
    expect((await request(app).post(`/api/p/${slug}/readwise/search`).send({ query: 'x' })).body).toEqual({ enabled: false, passages: [] });
    expect((await request(app).post(`/api/p/${slug}/readwise/adopt`).send({ id: '1' })).status).toBe(400);
  });
});
