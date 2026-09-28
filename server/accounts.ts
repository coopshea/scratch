import crypto from 'node:crypto';
import pg from 'pg';
import { HttpError } from './store.ts';

/**
 * Accounts on the hosted site: who may use it, their plan, how many parses they have used, and their own API key.
 * Postgres in production; an in-memory stand-in for tests. The writing itself stays in files (store.ts).
 */
export type Account = {
  id: string; email: string | null; freeParsesUsed: number; hasOwnKey: boolean; keyHint: string | null;
  pro: boolean; proParsesThisMonth: number; credits: number; hasBilling: boolean;
};

/**
 * How a parse is paid for, in the order they are spent: a free try, the subscription's month, a bought parse
 * (all on the site's key), then the writer's own key.
 */
export type Paid = { kind: 'free' | 'pro' | 'credit' | 'own'; apiKey?: string };
/** Nothing left to pay with. */
export type Denied = { denied: true };

export interface Accounts {
  /** The account, created on first sign-in while there is room. Null when the site is full. */
  admit(id: string, email: () => Promise<string | null>): Promise<Account | null>;
  get(id: string): Promise<Account | null>;
  /** Claims one parse, spending in the order of Paid. */
  takeParse(id: string): Promise<Paid | Denied>;
  /** Gives a parse back when the parse it paid for failed. */
  refundParse(id: string, kind: Paid['kind']): Promise<void>;
  setKey(id: string, key: string | null): Promise<void>;
  /** From Stripe: checkout linked this account to a customer. */
  linkCustomer(id: string, customerId: string): Promise<void>;
  customerOf(id: string): Promise<string | null>;
  /** From Stripe: the customer's subscription started, renewed, lapsed or ended. */
  setProByCustomer(customerId: string, pro: boolean): Promise<void>;
  /** From Stripe: a block of parses was paid for. */
  addCredits(id: string, n: number): Promise<void>;
  /** Records a Stripe event; false if it was already applied, since Stripe retries deliveries. */
  firstTime(eventId: string): Promise<boolean>;
  forgetEvent(eventId: string): Promise<void>;
}

export const MAX_ACCOUNTS = Number(process.env.MAX_ACCOUNTS || 50);
export const FREE_PARSES = Number(process.env.FREE_PARSES || 2);
export const PRO_MONTHLY_PARSES = Number(process.env.PRO_MONTHLY_PARSES || 100);
export const PACK_PARSES = Number(process.env.PACK_PARSES || 50);
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
  pro: boolean; stripe_customer_id: string | null; month: string | null; month_parses: number; credits: number;
};
const toAccount = (r: Row): Account => ({
  id: r.id, email: r.email, freeParsesUsed: r.free_parses_used, hasOwnKey: !!r.api_key, keyHint: r.key_hint,
  pro: r.pro, proParsesThisMonth: r.month === month() ? r.month_parses : 0, credits: r.credits, hasBilling: !!r.stripe_customer_id,
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
        add column if not exists month_parses integer not null default 0,
        add column if not exists credits integer not null default 0`);
    await this.pool.query('create table if not exists stripe_events (id text primary key, at timestamptz not null default now())');
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
    const spend = async (sql: string, args: unknown[]) => !!(await this.pool.query(sql, [id, ...args])).rowCount;
    if (await spend('update accounts set free_parses_used = free_parses_used + 1 where id = $1 and free_parses_used < $2', [FREE_PARSES])) return { kind: 'free' };
    if (await spend(`update accounts set month_parses = case when month = $2 then month_parses + 1 else 1 end, month = $2
         where id = $1 and pro and (month is distinct from $2 or month_parses < $3)`, [month(), PRO_MONTHLY_PARSES])) return { kind: 'pro' };
    if (await spend('update accounts set credits = credits - 1 where id = $1 and credits > 0', [])) return { kind: 'credit' };
    const { rows: [r] } = await this.pool.query<Row>('select api_key from accounts where id = $1', [id]);
    return r?.api_key ? { kind: 'own', apiKey: openKey(r.api_key) } : { denied: true };
  }

  async refundParse(id: string, kind: Paid['kind']) {
    if (kind === 'free') await this.pool.query('update accounts set free_parses_used = greatest(free_parses_used - 1, 0) where id = $1', [id]);
    if (kind === 'pro') await this.pool.query('update accounts set month_parses = greatest(month_parses - 1, 0) where id = $1 and month = $2', [id, month()]);
    if (kind === 'credit') await this.pool.query('update accounts set credits = credits + 1 where id = $1', [id]);
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

  async addCredits(id: string, n: number) {
    await this.pool.query('update accounts set credits = credits + $2 where id = $1', [id, n]);
  }

  async firstTime(eventId: string) {
    return !!(await this.pool.query('insert into stripe_events (id) values ($1) on conflict do nothing', [eventId])).rowCount;
  }

  async forgetEvent(eventId: string) {
    await this.pool.query('delete from stripe_events where id = $1', [eventId]);
  }
}

/** Same rules, no database. Tests and local tries of the hosted mode. */
export class MemoryAccounts implements Accounts {
  rows = new Map<string, { email: string | null; used: number; key: string | null; pro: boolean; customer: string | null; month: string | null; monthUsed: number; credits: number }>();
  events = new Set<string>();
  async get(id: string) {
    const r = this.rows.get(id);
    return r ? {
      id, email: r.email, freeParsesUsed: r.used, hasOwnKey: !!r.key, keyHint: r.key ? r.key.slice(-4) : null,
      pro: r.pro, proParsesThisMonth: r.month === month() ? r.monthUsed : 0, credits: r.credits, hasBilling: !!r.customer,
    } : null;
  }
  async admit(id: string, email: () => Promise<string | null>) {
    if (!this.rows.has(id)) {
      if (this.rows.size >= MAX_ACCOUNTS) return null;
      this.rows.set(id, { email: await email(), used: 0, key: null, pro: false, customer: null, month: null, monthUsed: 0, credits: 0 });
    }
    return this.get(id);
  }
  async takeParse(id: string): Promise<Paid | Denied> {
    const r = this.rows.get(id);
    if (!r) return { denied: true };
    if (r.used < FREE_PARSES) { r.used++; return { kind: 'free' }; }
    if (r.pro) {
      if (r.month !== month()) { r.month = month(); r.monthUsed = 0; }
      if (r.monthUsed < PRO_MONTHLY_PARSES) { r.monthUsed++; return { kind: 'pro' }; }
    }
    if (r.credits > 0) { r.credits--; return { kind: 'credit' }; }
    return r.key ? { kind: 'own', apiKey: r.key } : { denied: true };
  }
  async refundParse(id: string, kind: Paid['kind']) {
    const r = this.rows.get(id);
    if (r && kind === 'free') r.used = Math.max(0, r.used - 1);
    if (r && kind === 'pro') r.monthUsed = Math.max(0, r.monthUsed - 1);
    if (r && kind === 'credit') r.credits++;
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
  async addCredits(id: string, n: number) {
    const r = this.rows.get(id);
    if (r) r.credits += n;
  }
  async firstTime(eventId: string) {
    if (this.events.has(eventId)) return false;
    this.events.add(eventId);
    return true;
  }
  async forgetEvent(eventId: string) {
    this.events.delete(eventId);
  }
}
