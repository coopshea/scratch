import crypto from 'node:crypto';
import pg from 'pg';
import { HttpError } from './store.ts';

/**
 * Accounts on the hosted site: who may use it, how many free parses they have left, and their own API key.
 * Postgres in production; an in-memory stand-in for tests. The writing itself stays in files (store.ts).
 */
export type Account = { id: string; email: string | null; freeParsesUsed: number; hasOwnKey: boolean; keyHint: string | null };

export interface Accounts {
  /** The account, created on first sign-in while there is room. Null when the site is full. */
  admit(id: string, email: () => Promise<string | null>): Promise<Account | null>;
  get(id: string): Promise<Account | null>;
  /** Claims one parse: the writer's own key if they set one, else one free try. Null when neither is left. */
  takeParse(id: string): Promise<{ apiKey?: string; free: boolean } | null>;
  /** Gives a free try back when the parse it paid for failed. */
  refundParse(id: string): Promise<void>;
  setKey(id: string, key: string | null): Promise<void>;
}

export const MAX_ACCOUNTS = Number(process.env.MAX_ACCOUNTS || 50);
export const FREE_PARSES = Number(process.env.FREE_PARSES || 2);

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

type Row = { id: string; email: string | null; free_parses_used: number; api_key: string | null; key_hint: string | null };
const toAccount = (r: Row): Account => ({ id: r.id, email: r.email, freeParsesUsed: r.free_parses_used, hasOwnKey: !!r.api_key, keyHint: r.key_hint });

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

  async takeParse(id: string) {
    const { rows: [own] } = await this.pool.query<Row>('select api_key from accounts where id = $1 and api_key is not null', [id]);
    if (own?.api_key) return { apiKey: openKey(own.api_key), free: false };
    // Check and spend in one statement, so parallel parses cannot overdraw the free tries.
    const { rowCount } = await this.pool.query(
      'update accounts set free_parses_used = free_parses_used + 1 where id = $1 and free_parses_used < $2', [id, FREE_PARSES]);
    return rowCount ? { free: true } : null;
  }

  async refundParse(id: string) {
    await this.pool.query('update accounts set free_parses_used = greatest(free_parses_used - 1, 0) where id = $1', [id]);
  }

  async setKey(id: string, key: string | null) {
    await this.pool.query('update accounts set api_key = $2, key_hint = $3 where id = $1',
      [id, key ? sealKey(key) : null, key ? key.slice(-4) : null]);
  }
}

/** Same rules, no database. Tests and local tries of the hosted mode. */
export class MemoryAccounts implements Accounts {
  rows = new Map<string, { email: string | null; used: number; key: string | null }>();
  async get(id: string) {
    const r = this.rows.get(id);
    return r ? { id, email: r.email, freeParsesUsed: r.used, hasOwnKey: !!r.key, keyHint: r.key ? r.key.slice(-4) : null } : null;
  }
  async admit(id: string, email: () => Promise<string | null>) {
    if (!this.rows.has(id)) {
      if (this.rows.size >= MAX_ACCOUNTS) return null;
      this.rows.set(id, { email: await email(), used: 0, key: null });
    }
    return this.get(id);
  }
  async takeParse(id: string) {
    const r = this.rows.get(id);
    if (!r) return null;
    if (r.key) return { apiKey: r.key, free: false };
    if (r.used >= FREE_PARSES) return null;
    r.used++;
    return { free: true };
  }
  async refundParse(id: string) {
    const r = this.rows.get(id);
    if (r) r.used = Math.max(0, r.used - 1);
  }
  async setKey(id: string, key: string | null) {
    const r = this.rows.get(id);
    if (r) r.key = key;
  }
}
