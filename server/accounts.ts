import crypto from 'node:crypto';
import pg from 'pg';
import { HttpError } from './store.ts';

/**
 * Accounts on the hosted site: who may use it, their plan, how many parses they have used, and their own API key.
 * Postgres in production; an in-memory stand-in for tests. The writing itself stays in files (store.ts).
 */
export type Account = {
  id: string; email: string | null; freeParsesUsed: number; hasOwnKey: boolean; keyHint: string | null;
  pro: boolean; proParsesThisMonth: number; hasBilling: boolean;
};

/** How a parse is paid for: a free try, the Pro allowance (both on the site's key), or the writer's own key. */
export type Paid = { kind: 'free' | 'pro' | 'own'; apiKey?: string };
/** Why a parse was refused: free tries used up, or the Pro month's allowance used up. */
export type Denied = { denied: 'free' | 'pro' };

export interface Accounts {
  /** The account, created on first sign-in while there is room. Null when the site is full. */
  admit(id: string, email: () => Promise<string | null>): Promise<Account | null>;
  get(id: string): Promise<Account | null>;
  /** Claims one parse: Pro allowance first, then the writer's own key, then a free try. */
  takeParse(id: string): Promise<Paid | Denied>;
  /** Gives a parse back when the parse it paid for failed. */
  refundParse(id: string, kind: Paid['kind']): Promise<void>;
  setKey(id: string, key: string | null): Promise<void>;
  /** From Stripe: checkout linked this account to a customer. */
  linkCustomer(id: string, customerId: string): Promise<void>;
  customerOf(id: string): Promise<string | null>;
  /** From Stripe: the customer's subscription started, renewed, lapsed or ended. */
  setProByCustomer(customerId: string, pro: boolean): Promise<void>;
}

export const MAX_ACCOUNTS = Number(process.env.MAX_ACCOUNTS || 50);
export const FREE_PARSES = Number(process.env.FREE_PARSES || 2);
export const PRO_MONTHLY_PARSES = Number(process.env.PRO_MONTHLY_PARSES || 200);
const month = () => new Date().toISOString().slice(0, 7); // 2026-09

// API keys are stored encrypted (AES-256-GCM) with KEY_ENCRYPTION_SECRET, never returned to the browser.
function secret() {
  const s = process.env.KEY_ENCRYPTION_SECRET;
  if (!s || Buffer.from(s, 'base64').length !== 32) throw new Error('KEY_ENCRYPTION_SECRET must be 32 random bytes, base64 (openssl rand -base64 32)');
  return Buffer.from(s, 'base64');
}
export function sealKey(key: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secret(), iv);
  const body = Buffer.concat([c.update(key, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}
export function openKey(sealed: string): string {
  const raw = Buffer.from(sealed, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', secret(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

export function checkKeyShape(key: string) {
  if (!/^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(key)) throw new HttpError(400, 'That does not look like an Anthropic API key (sk-ant-…)');
}

type Row = {
  id: string; email: string | null; free_parses_used: number; api_key: string | null; key_hint: string | null;
  pro: boolean; stripe_customer_id: string | null; month: string | null; month_parses: number;
};
const toAccount = (r: Row): Account => ({
  id: r.id, email: r.email, freeParsesUsed: r.free_parses_used, hasOwnKey: !!r.api_key, keyHint: r.key_hint,
  pro: r.pro, proParsesThisMonth: r.month === month() ? r.month_parses : 0, hasBilling: !!r.stripe_customer_id,
});

export class PgAccounts implements Accounts {
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 5 });
  }

  async migrate() {
    await this.pool.query(`
      create table if not exists accounts (
        id text primary key,
        email text,
        free_parses_used integer not null default 0,
        api_key text,
        key_hint text,
        created_at timestamptz not null default now()
      )`);
    await this.pool.query(`
      alter table accounts
        add column if not exists pro boolean not null default false,
        add column if not exists stripe_customer_id text unique,
        add column if not exists month text,
        add column if not exists month_parses integer not null default 0`);
  }

  async get(id: string) {
    const { rows } = await this.pool.query<Row>('select * from accounts where id = $1', [id]);
    return rows[0] ? toAccount(rows[0]) : null;
  }

  async admit(id: string, email: () => Promise<string | null>) {
    const existing = await this.get(id);
    if (existing) return existing;
    const mail = await email();
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      // One admission at a time, so two sign-ups at once cannot both take the last place.
      await client.query('select pg_advisory_xact_lock(4242)');
      const { rows: [{ n }] } = await client.query<{ n: string }>('select count(*) as n from accounts');
      if (Number(n) >= MAX_ACCOUNTS) { await client.query('rollback'); return (await this.get(id)); }
      const { rows } = await client.query<Row>(
        'insert into accounts (id, email) values ($1, $2) on conflict (id) do update set id = excluded.id returning *', [id, mail]);
      await client.query('commit');
      return toAccount(rows[0]);
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  // Each check-and-spend is one statement, so parallel parses cannot overdraw an allowance.
  async takeParse(id: string): Promise<Paid | Denied> {
    const { rows: [r] } = await this.pool.query<Row>('select pro, api_key from accounts where id = $1', [id]);
    if (!r) return { denied: 'free' };
    if (r.pro) {
      const { rowCount } = await this.pool.query(
        `update accounts set month_parses = case when month = $2 then month_parses + 1 else 1 end, month = $2
         where id = $1 and (month is distinct from $2 or month_parses < $3)`, [id, month(), PRO_MONTHLY_PARSES]);
      if (rowCount) return { kind: 'pro' };
    }
    if (r.api_key) return { kind: 'own', apiKey: openKey(r.api_key) };
    if (r.pro) return { denied: 'pro' };
    const { rowCount } = await this.pool.query(
      'update accounts set free_parses_used = free_parses_used + 1 where id = $1 and free_parses_used < $2', [id, FREE_PARSES]);
    return rowCount ? { kind: 'free' } : { denied: 'free' };
  }

  async refundParse(id: string, kind: Paid['kind']) {
    if (kind === 'free') await this.pool.query('update accounts set free_parses_used = greatest(free_parses_used - 1, 0) where id = $1', [id]);
    if (kind === 'pro') await this.pool.query('update accounts set month_parses = greatest(month_parses - 1, 0) where id = $1 and month = $2', [id, month()]);
  }

  async setKey(id: string, key: string | null) {
    await this.pool.query('update accounts set api_key = $2, key_hint = $3 where id = $1',
      [id, key ? sealKey(key) : null, key ? key.slice(-4) : null]);
  }

  async linkCustomer(id: string, customerId: string) {
    await this.pool.query('update accounts set stripe_customer_id = $2 where id = $1', [id, customerId]);
  }

  async customerOf(id: string) {
    const { rows: [r] } = await this.pool.query<Row>('select stripe_customer_id from accounts where id = $1', [id]);
    return r?.stripe_customer_id ?? null;
  }

  async setProByCustomer(customerId: string, pro: boolean) {
    await this.pool.query('update accounts set pro = $2 where stripe_customer_id = $1', [customerId, pro]);
  }
}

/** Same rules, no database. Tests and local tries of the hosted mode. */
export class MemoryAccounts implements Accounts {
  rows = new Map<string, { email: string | null; used: number; key: string | null; pro: boolean; customer: string | null; month: string | null; monthUsed: number }>();
  async get(id: string) {
    const r = this.rows.get(id);
    return r ? {
      id, email: r.email, freeParsesUsed: r.used, hasOwnKey: !!r.key, keyHint: r.key ? r.key.slice(-4) : null,
      pro: r.pro, proParsesThisMonth: r.month === month() ? r.monthUsed : 0, hasBilling: !!r.customer,
    } : null;
  }
  async admit(id: string, email: () => Promise<string | null>) {
    if (!this.rows.has(id)) {
      if (this.rows.size >= MAX_ACCOUNTS) return null;
      this.rows.set(id, { email: await email(), used: 0, key: null, pro: false, customer: null, month: null, monthUsed: 0 });
    }
    return this.get(id);
  }
  async takeParse(id: string): Promise<Paid | Denied> {
    const r = this.rows.get(id);
    if (!r) return { denied: 'free' };
    if (r.pro) {
      if (r.month !== month()) { r.month = month(); r.monthUsed = 0; }
      if (r.monthUsed < PRO_MONTHLY_PARSES) { r.monthUsed++; return { kind: 'pro' }; }
    }
    if (r.key) return { kind: 'own', apiKey: r.key };
    if (r.pro) return { denied: 'pro' };
    if (r.used >= FREE_PARSES) return { denied: 'free' };
    r.used++;
    return { kind: 'free' };
  }
  async refundParse(id: string, kind: Paid['kind']) {
    const r = this.rows.get(id);
    if (r && kind === 'free') r.used = Math.max(0, r.used - 1);
    if (r && kind === 'pro') r.monthUsed = Math.max(0, r.monthUsed - 1);
  }
  async setKey(id: string, key: string | null) {
    const r = this.rows.get(id);
    if (r) r.key = key;
  }
  async linkCustomer(id: string, customerId: string) {
    const r = this.rows.get(id);
    if (r) r.customer = customerId;
  }
  async customerOf(id: string) {
    return this.rows.get(id)?.customer ?? null;
  }
  async setProByCustomer(customerId: string, pro: boolean) {
    for (const r of this.rows.values()) if (r.customer === customerId) r.pro = pro;
  }
}
