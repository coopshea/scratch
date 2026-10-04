import crypto from 'node:crypto';
import request from 'supertest';
import Stripe from 'stripe';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { tempDataDir } from './helpers.ts';

// The hosted site with a stand-in for Clerk: the signed-in writer is whoever the x-test-user header names.
process.env.SCRATCH_DATA = tempDataDir();
process.env.PARSER = 'offline';
process.env.MAX_ACCOUNTS = '5';
process.env.ADMIN_EMAILS = 'Owner@example.com';
process.env.KEY_ENCRYPTION_SECRET = crypto.randomBytes(32).toString('base64');
delete process.env.READWISE_TOKEN;

// Stripe without the network: checkout and portal pages are stand-ins; the webhook runs the real signature check.
const WHSEC = 'whsec_test_' + crypto.randomBytes(16).toString('hex');
const signer = new Stripe('sk_test_not_used');
const signed = (event: object) => {
  const payload = JSON.stringify(event);
  return { payload, header: signer.webhooks.generateTestHeaderString({ payload, secret: WHSEC }) };
};

let app: Express;
let accounts: import('../server/accounts.ts').MemoryAccounts;
beforeAll(async () => {
  const { createApp } = await import('../server/app.ts');
  const { MemoryAccounts } = await import('../server/accounts.ts');
  const { StripeBilling } = await import('../server/billing.ts');
  accounts = new MemoryAccounts();
  const stripe = new StripeBilling(accounts, 'sk_test_not_used', WHSEC);
  app = createApp({
    userId: (req) => req.header('x-test-user') ?? null,
    email: async (id) => `${id}@example.com`,
    accounts,
    billing: {
      checkoutUrl: async (a, _origin, what, cents, back) => `https://checkout.stripe.test/${what}/${cents}/${a.id}${back ? `?back=${back.slug}/${back.blurt}` : ''}`,
      portalUrl: async (a) => `https://billing.stripe.test/${a.id}`,
      webhook: (raw, sig) => stripe.webhook(raw, sig),
    },
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

  it("copies an example into the writer's own space, without using a parse", async () => {
    const before = (await as('alice').get('/api/me')).body.account.freeParsesUsed;
    const made = await as('alice').post('/api/projects/example').send({});
    expect(made.status).toBe(200);
    expect((await as('alice').get(`/api/p/${made.body.slug}`)).body.units.length).toBeGreaterThan(10);
    expect((await as('bob').get('/api/projects')).body.map((p: { slug: string }) => p.slug)).not.toContain(made.body.slug);
    expect((await as('alice').get('/api/me')).body.account.freeParsesUsed).toBe(before);
  });

  it('keeps outlines per writer', async () => {
    await as('alice').put('/api/archetypes').send({ name: 'my essay', outline: 'hook\npoint' });
    expect((await as('bob').get('/api/archetypes')).body).toEqual([]);
  });

  it('admits only MAX_ACCOUNTS writers', async () => {
    expect((await as('carol').get('/api/me')).status).toBe(200);
    expect((await as('owner').get('/api/me')).status).toBe(200);
    expect((await as('erin').get('/api/me')).status).toBe(200); // alice, bob, carol, owner, erin
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
    expect(third.body.buy).toBe(true);
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

  it('caps a blurt at what one parse can take, and keeps it', async () => {
    const res = await as('carol').post('/api/p/scratch/blurts').send({ text: 'x'.repeat(14_001) });
    expect(res.status).toBe(413);
    expect(res.body.blurt.text.length).toBe(14_001);
  });

  it('rate limits parses per writer', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await as('carol').post('/api/p/scratch/blurts').send({ text: `Quick ${i}.` })).status);
    expect(codes).toContain(429);
  });

  it("uses only a writer's own Readwise token, checked with Readwise, stored and never returned", async () => {
    process.env.READWISE_TOKEN = 'serverwidetokenthatmustneverbeused000';
    expect((await as('alice').post('/api/p/scratch/readwise/search').send({ query: 'turbines' })).body.enabled).toBe(false);
    expect((await as('alice').put('/api/me/readwise').send({ token: 'not a token!' })).status).toBe(400);

    const TOKEN = 'a'.repeat(40) + 'READWISE';
    const real = globalThis.fetch;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) =>
      String(url).endsWith('/auth/')
        ? new Response(null, { status: (init?.headers as Record<string, string>).Authorization === `Token ${TOKEN}` ? 204 : 401 })
        : real(url, init));
    try {
      expect((await as('alice').put('/api/me/readwise').send({ token: 'b'.repeat(40) })).status).toBe(400); // Readwise says no
      const saved = await as('alice').put('/api/me/readwise').send({ token: TOKEN });
      expect(saved.status).toBe(200);
      expect(saved.body.hasReadwise).toBe(true);
      expect(JSON.stringify(saved.body)).not.toContain(TOKEN);
      expect(await accounts.readwiseOf('alice')).toBe(TOKEN);
      expect((await as('bob').post('/api/p/scratch/readwise/search').send({ query: 'turbines' })).body.enabled).toBe(false);
    } finally {
      fetch.mockRestore();
      delete process.env.READWISE_TOKEN;
    }
  });
});

describe('hosted: owners', () => {
  it('exempts ADMIN_EMAILS from rate limits, the free-parse quota and the blurt cap', async () => {
    expect((await as('owner').get('/api/me')).body.unlimited).toBe(true);
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) codes.push((await as('owner').post('/api/p/scratch/blurts').send({ text: `Owner idea ${i}.` })).status);
    expect(codes.every((c) => c === 200)).toBe(true);
    expect((await as('owner').get('/api/me')).body.account.freeParsesUsed).toBe(0);
    expect((await as('owner').post('/api/p/scratch/blurts').send({ text: 'y. '.repeat(8_000) })).status).toBe(200);
    expect((await as('carol').get('/api/me')).body.unlimited).toBe(false);
  });
});

describe('hosted: paying in through Stripe', () => {
  const event = (id: string, type: string, object: object) => ({ id, object: 'event', type, data: { object } });
  const post = (e: object, header?: string) => {
    const { payload, header: good } = signed(e);
    return request(app).post('/stripe/webhook').set('stripe-signature', header ?? good).set('content-type', 'application/json').send(payload);
  };
  const me = async () => (await as('erin').get('/api/me')).body;
  const parse = (text = 'An idea.') => as('erin').post('/api/p/scratch/blurts').send({ text });
  const topUp = (id: string, cents: number) => event(id, 'checkout.session.completed',
    { mode: 'payment', payment_status: 'paid', amount_total: cents, metadata: { account: 'erin', kind: 'topup' }, customer: 'cus_erin', status: 'complete' });
  // $5 less Stripe's 2.9% + 30¢, in micro-dollars.
  const FIVE_NET = Math.round((500 * 0.971 - 30) * 10_000);

  it('opens checkout for an amount the writer picks, from $1', async () => {
    const ok = await as('erin').post('/api/billing/checkout').send({ what: 'topup', cents: 500 });
    expect(ok.body.url).toBe('https://checkout.stripe.test/topup/500/erin');
    expect((await as('erin').post('/api/billing/checkout').send({ what: 'subscription', cents: 100 })).body.url).toBe('https://checkout.stripe.test/subscription/100/erin');
    expect((await as('erin').post('/api/billing/checkout').send({ what: 'topup', cents: 99 })).status).toBe(400);
  });

  it('comes back to the document after buying from the out-of-credits notice, and only to an address it made', async () => {
    const buy = (back: unknown, what = 'topup') => as('erin').post('/api/billing/checkout').send({ what, cents: 500, back });
    expect((await buy({ slug: 'gas-turbines', blurt: '2026-09-28T23-56-49-123Z_ab12' })).body.url)
      .toBe('https://checkout.stripe.test/topup/500/erin?back=gas-turbines/2026-09-28T23-56-49-123Z_ab12');
    for (const bad of [{ slug: '../evil', blurt: 'x' }, { slug: 'ok', blurt: 'a&b=c' }, { slug: 'https://evil.test', blurt: 'x' }, 'gas-turbines']) {
      expect((await buy(bad)).body.url).toBe('https://checkout.stripe.test/topup/500/erin');
    }
    expect((await buy({ slug: 'gas-turbines', blurt: 'x' }, 'subscription')).body.url).toBe('https://checkout.stripe.test/subscription/500/erin');
  });

  it('ignores webhooks without a valid Stripe signature', async () => {
    expect((await post(topUp('evt_forged', 500), 't=1,v1=forged')).status).toBe(400);
    expect((await me()).account.balanceMicros).toBe(0);
  });

  it('refuses a parse once free parses are used and the balance is empty', async () => {
    for (let i = 0; i < 2; i++) expect((await parse()).status).toBe(200);
    const out = await parse();
    expect(out.status).toBe(402);
    expect(out.body.buy).toBe(true);
  });

  it('credits a top-up once, less Stripe\'s fee, even when Stripe delivers it twice', async () => {
    expect((await post(topUp('evt_topup', 500))).status).toBe(200);
    expect((await post(topUp('evt_topup', 500))).status).toBe(200); // retried delivery
    expect((await me()).account.balanceMicros).toBe(FIVE_NET);
  });

  it('takes a ream-of-paper donation without adding it to the balance', async () => {
    expect((await as('erin').post('/api/billing/checkout').send({ what: 'donation', cents: 1 })).body.url).toBe('https://checkout.stripe.test/donation/700/erin');
    const gift = event('evt_gift', 'checkout.session.completed',
      { mode: 'payment', payment_status: 'paid', amount_total: 700, metadata: { account: 'erin', kind: 'donation' }, customer: 'cus_erin', status: 'complete' });
    expect((await post(gift)).status).toBe(200);
    expect((await me()).account.balanceMicros).toBe(FIVE_NET);
  });

  it('charges each parse at cost', async () => {
    const { usageOf } = await import('../server/parser.ts');
    const { USAGE_MARKUP } = await import('../server/app.ts');
    expect(USAGE_MARKUP).toBe(1);
    const text = 'Charged by length.';
    expect((await parse(text)).status).toBe(200);
    // The offline parser reports a stand-in cost for this length.
    const cost = Math.ceil(usageOf('claude-opus-5-5', 1500 + Math.ceil(text.length / 4), Math.ceil(text.length / 2)).usd * USAGE_MARKUP * 1e6);
    expect((await me()).account.balanceMicros).toBe(FIVE_NET - cost);
  });

  it('credits each paid month of a subscription, and ends it when cancelled', async () => {
    const before = (await me()).account.balanceMicros;
    await post(event('evt_sub', 'checkout.session.completed', { mode: 'subscription', status: 'complete', metadata: { account: 'erin' }, customer: 'cus_erin' }));
    expect((await me()).account.subscribed).toBe(true);
    const month = (id: string) => event(id, 'invoice.paid',
      { amount_paid: 100, customer: 'cus_erin', parent: { type: 'subscription_details', subscription_details: { metadata: { account: 'erin' }, subscription: 'sub_1' } } });
    await post(month('evt_m1'));
    await post(month('evt_m2'));
    const oneNet = Math.round((100 * 0.971 - 30) * 10_000);
    expect((await me()).account.balanceMicros).toBe(before + 2 * oneNet);
    expect((await as('erin').post('/api/billing/checkout').send({ what: 'subscription', cents: 100 })).body.url).toBe('https://billing.stripe.test/erin'); // manage, not a second one
    await post(event('evt_end', 'customer.subscription.deleted', { status: 'canceled', metadata: { account: 'erin' }, customer: 'cus_erin' }));
    expect((await me()).account.subscribed).toBe(false);
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
