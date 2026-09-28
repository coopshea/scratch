import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const ignored = (file: string) => {
  try { execFileSync('git', ['check-ignore', '-q', file]); return true; } catch { return false; }
};

describe('rule: keys and writing never reach the repo', () => {
  it('ignores .env and the writing folder, but not the template', () => {
    expect(ignored('.env')).toBe(true);
    expect(ignored('.env.local')).toBe(true);
    expect(ignored('projects/anything/draft.md')).toBe(true);
    expect(ignored('.env.example')).toBe(false);
  });

  it('keeps the template free of real values', () => {
    for (const line of fs.readFileSync('.env.example', 'utf8').split('\n')) {
      if (line.trim() && !line.startsWith('#')) expect(line).toMatch(/^[A-Z_]+=$/);
    }
  });
});
