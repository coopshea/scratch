import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Unit } from '../shared/types.ts';

/** A fresh folder for one test file's projects, so tests never touch real writing. */
export function tempDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-test-'));
}

export type LoggedEvent = { t: string; author: 'human' | 'model' | 'system'; type: string; data: any };

export function readEvents(dataDir: string, slug: string): LoggedEvent[] {
  const file = path.join(dataDir, slug, 'events.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

let n = 0;
export function unit(over: Partial<Unit> = {}): Unit {
  n++;
  return {
    id: `u${n}`, type: 'claim', label: `label ${n}`, text: `text ${n}`,
    blurtId: null, start: -1, end: -1, home: null, status: 'accepted',
    origin: 'human', labeledBy: 'model', verified: false, note: null,
    createdAt: '2026-09-28T00:00:00.000Z',
    ...over,
  };
}
