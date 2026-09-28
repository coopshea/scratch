import crypto from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { tempDataDir } from './helpers.ts';

// The hosted site with a stand-in for Clerk: the signed-in writer is whoever the x-test-user header names.
process.env.SCRATCH_DATA = tempDataDir();
process.env.PARSER = 'offline';
process.env.MAX_ACCOUNTS = '3';
process.env.KEY_ENCRYPTION_SECRET = crypto.randomBytes(32).toString('base64');
delete process.env.READWISE_TOKEN;

let app: Express;
let accounts: import('../server/accounts.ts').MemoryAccounts;
beforeAll(async () => {
  const { createApp } = await import('../server/app.ts');
  const { MemoryAccounts } = await import('../server/accounts.ts');
  accounts = new MemoryAccounts();
  app = createApp({
    userId: (req) => req.header('x-test-user') ?? null,
    email: async (id) => `${id}@example.com`,
    accounts,
  });
});

const as = (user: string) => ({
  get: (url: string) => request(app).get(url).set('x-test-user', user),
  post: (url: string) => request(app).post(url).set('x-test-user', user),
  put: (url: string) => request(app).put(url).set('x-test-user', user),
});
const FAKE_KEY = 'sk-ant-api03-' + 'x'.repeat(40) + 'WXYZ';

describe('hosted: sign-in and accounts', () => {
  it('refuses anyone not signed in, including pasted images', async () => {
    expect((await request(app).get('/api/projects')).status).toBe(401);
    expect((await request(app).get('/projects/scratch/assets/a.png')).status).toBe(401);
  });

  it("keeps each writer's documents to themselves", async () => {
    const made = await as('alice').post('/api/projects').send({ title: 'Secret plans' });
    expect(made.status).toBe(200);
    const upload = await as('alice').post(`/api/p/${made.body.slug}/assets`).set('x-filename', 'fig.png').send(Buffer.from('png'));
    expect((await as('alice').get(upload.body.url)).status).toBe(200);

    const bob = await as('bob').get('/api/projects');
    expect(bob.body.map((p: { slug: string }) => p.slug)).not.toContain(made.body.slug);
    expect((await as('bob').get(upload.body.url)).status).toBe(404);
    expect((await as('bob').get(`/api/p/${made.body.slug}`)).body.meta.title).not.toBe('Secret plans');
  });

  it('keeps outlines per writer', async () => {
    await as('alice').put('/api/archetypes').send({ name: 'my essay', outline: 'hook\npoint' });
    expect((await as('bob').get('/api/archetypes')).body).toEqual([]);
  });

  it('admits only MAX_ACCOUNTS writers', async () => {
    expect((await as('carol').get('/api/me')).status).toBe(200); // alice, bob, carol
    const dave = await as('dave').get('/api/me');
    expect(dave.status).toBe(403);
    expect(dave.body.error).toMatch(/full/);
    expect((await as('alice').get('/api/me')).status).toBe(200); // existing writers still get in
  });
});

describe('hosted: free parses and own keys', () => {
  it('gives two free parses, then asks for a key without losing the blurt', async () => {
    const slug = (await as('carol').post('/api/projects').send({ title: 'Parses' })).body.slug;
    for (let i = 0; i < 2; i++) expect((await as('carol').post(`/api/p/${slug}/blurts`).send({ text: `Idea ${i}.` })).status).toBe(200);
    const third = await as('carol').post(`/api/p/${slug}/blurts`).send({ text: 'Third idea.' });
    expect(third.status).toBe(402);
    expect(third.body.blurt.text).toBe('Third idea.'); // saved, so it can be parsed once a key is added
    expect((await as('carol').get('/api/me')).body.account.freeParsesUsed).toBe(2);
  });

  it('stores an own key, never returns it, and parses with it', async () => {
    const bad = await as('carol').put('/api/me/key').send({ key: 'not a key' });
    expect(bad.status).toBe(400);
    const saved = await as('carol').put('/api/me/key').send({ key: FAKE_KEY });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(FAKE_KEY.slice(0, 20));
    expect(saved.body.keyHint).toBe('WXYZ');
    const slug = (await as('carol').get('/api/projects')).body[0].slug;
    expect((await as('carol').post(`/api/p/${slug}/blurts`).send({ text: 'With my own key.' })).status).toBe(200);
  });

  it('caps blurt length', async () => {
    const res = await as('carol').post('/api/p/scratch/blurts').send({ text: 'x'.repeat(20_001) });
    expect(res.status).toBe(413);
  });

  it('rate limits parses per writer', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await as('carol').post('/api/p/scratch/blurts').send({ text: `Quick ${i}.` })).status);
    expect(codes).toContain(429);
  });

  it('keeps Readwise off, since its token is shared', async () => {
    const res = await as('alice').post('/api/p/scratch/readwise/search').send({ query: 'turbines' });
    expect(res.body.enabled).toBe(false);
  });
});

describe('hosted: key encryption', () => {
  it('round-trips and is not plain text', async () => {
    const { sealKey, openKey } = await import('../server/accounts.ts');
    const sealed = sealKey(FAKE_KEY);
    expect(sealed).not.toContain('sk-ant');
    expect(openKey(sealed)).toBe(FAKE_KEY);
  });
});
