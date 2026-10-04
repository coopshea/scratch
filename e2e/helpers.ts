import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Unit } from '../shared/types.ts';

/**
 * A blurt the offline parser cuts predictably: one sentence per idea, the first statement is the claim, later
 * statements are its evidence, questions are questions. Labels are each sentence's first four words, lowercased.
 */
export const BLURT = 'Gas turbines are mostly air pumps. The compressor eats half the power. Why do blades crack?';
export const CLAIM = 'gas turbines are mostly';
export const EVIDENCE = 'the compressor eats half';
export const QUESTION = 'why do blades crack';

/** A fresh document for one test, so tests can run in parallel without sharing state. */
export async function newProject(request: APIRequestContext, title: string): Promise<string> {
  const res = await request.post('/api/projects', { data: { title: `${title} ${Date.now()} ${Math.random().toString(36).slice(2, 6)}` } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).slug;
}

/** Spill through the API (the Talk test covers doing it in the page). Returns the units by label. */
export async function spill(request: APIRequestContext, slug: string, text = BLURT) {
  const res = await request.post(`/api/p/${slug}/blurts`, { data: { text } });
  expect(res.ok()).toBeTruthy();
  const { units } = (await res.json()) as { units: Unit[] };
  const by = (label: string) => {
    const u = units.find((x) => x.label === label);
    if (!u) throw new Error(`No unit labelled "${label}" in ${units.map((x) => x.label).join(', ')}`);
    return u;
  };
  return { units, claim: by(CLAIM), evidence: by(EVIDENCE), question: by(QUESTION) };
}

/** Place ideas on levels of the default outline (persuasive), as the Shape stage would. */
export async function place(request: APIRequestContext, slug: string, lanes: Record<string, string[]>) {
  const res = await request.put(`/api/p/${slug}/board`, { data: { structure: 'persuasive', lanes: { persuasive: lanes } } });
  expect(res.ok()).toBeTruthy();
}

export async function open(page: Page, slug: string, stage: 'Spill' | 'Shape' | 'Draft' = 'Spill') {
  await page.goto(`/?p=${slug}`);
  const nav = page.getByRole('navigation', { name: 'Stages' });
  await nav.getByRole('button', { name: stage }).click();
  await expect(nav.getByRole('button', { name: stage })).toHaveAttribute('aria-current', 'step');
}
