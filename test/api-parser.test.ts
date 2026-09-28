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

  it('never gives a claim a home', () => {
    expect(units[3].home).toBeNull();
  });

  it('reuses the first spelling of a label, within a parse and across parses (controlled vocabulary)', async () => {
    expect(units[3].label).toBe('cad ai follows coding'); // same batch: first spelling wins
    const again: Unit[] = (await request(app).post(`/api/p/${slug}/blurts`).send({ text: BLURT })).body.units;
    expect(again[3].label).toBe('cad ai follows coding');
  });
});
