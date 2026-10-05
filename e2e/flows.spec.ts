import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Unit } from '../shared/types.ts';
import { BLURT, CLAIM, EVIDENCE, QUESTION, newProject, open, place, spill } from './helpers.ts';

test('Spill: a blurt is cut into ideas on cards', async ({ page, request }) => {
  const slug = await newProject(request, 'spill');
  await open(page, slug, 'Spill');

  await page.getByRole('textbox', { name: /Braindump here/ }).fill(BLURT);
  await page.getByRole('button', { name: 'Parse writing' }).click();

  const graph = page.locator('.graph');
  for (const label of [CLAIM, EVIDENCE, QUESTION]) await expect(graph.getByText(label, { exact: true })).toBeVisible();
  // The claim heads a card with its evidence beneath; the spill box is cleared for the next one.
  await expect(graph.locator('.card').first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: /Braindump here/ })).toHaveValue('');
});

test('Shape: a dragged card lands in a level as one line', async ({ page, request }) => {
  const slug = await newProject(request, 'shape');
  const { claim } = await spill(request, slug);
  await open(page, slug, 'Shape');

  const canvas = page.locator('.levels');
  const thesis = canvas.locator('.level').filter({ has: page.locator('.level-label', { hasText: /^thesis/ }) });
  // A claim's label carries its support mark (○ ◐ ●) in front, so match the label by its text, not exactly.
  const unitIn = (scope: typeof canvas, label: string) => scope.filter({ has: page.locator('.lbl', { hasText: label }) });
  const card = unitIn(canvas.locator('.unit'), CLAIM);
  await expect(card).toBeVisible();

  // Drag the claim (its cluster travels with it) onto the left half of the thesis level.
  const from = (await card.boundingBox())!;
  const band = (await thesis.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(band.x + band.width * 0.6, band.y + band.height / 2, { steps: 15 });
  await page.mouse.up();

  // Saved through the server, in the thesis level.
  await expect.poll(async () => (await (await request.get(`/api/p/${slug}`)).json()).board.lanes.persuasive.thesis ?? [])
    .toEqual([claim.id]);

  // On the page, the cluster is one line in the thesis level: the claim at the left, its pieces running to its right
  // from the same top (wrapping under the first piece when the row runs out of width).
  const placed = [CLAIM, EVIDENCE, QUESTION].map((l) => unitIn(canvas.locator('.unit.is-placed'), l));
  for (const p of placed) await expect(p).toBeVisible();
  await expect.poll(async () => {
    const b = (await thesis.boundingBox())!;
    const [root, ...pieces] = await Promise.all(placed.map(async (p) => (await p.boundingBox())!));
    return {
      inBand: [root, ...pieces].every((r) => r.y >= b.y && r.y + r.height <= b.y + b.height),
      sameLine: Math.abs(pieces[0].y - root.y) < 2,
      toTheRight: pieces.every((r) => r.x >= root.x + root.width),
    };
  }).toEqual({ inBand: true, sameLine: true, toTheRight: true });
});

test('Draft: ideas sit in their section, toggle open, and a chip opens its note', async ({ page, request }) => {
  const slug = await newProject(request, 'draft');
  const { claim, evidence } = await spill(request, slug);
  await place(request, slug, { thesis: [claim.id] });
  await request.put(`/api/p/${slug}/draft`, { data: { text: `<!--s:thesis-->\nTurbines move air.<!--u:${evidence.id}-->\n` } });
  await open(page, slug, 'Draft');

  // The claim and its evidence are listed under the thesis section of the outline.
  const section = page.locator('.cue-cell').filter({ has: page.getByRole('heading', { name: 'thesis', exact: true }) });
  await expect(section.locator('.cue.depth-0').getByText(CLAIM, { exact: true })).toBeVisible();
  const cue = section.locator('.cue.depth-1').filter({ has: page.getByText(EVIDENCE, { exact: true }) });
  await expect(cue).toBeVisible();

  // A click opens the idea to its original words; another closes it.
  const original = cue.getByText(evidence.text, { exact: true });
  await expect(original).toBeHidden();
  await cue.getByText(EVIDENCE, { exact: true }).click();
  await expect(original).toBeVisible();
  await cue.getByText(EVIDENCE, { exact: true }).click();
  await expect(original).toBeHidden();
  await page.getByRole('button', { name: 'Close' }).click(); // the first click also opened its note

  // The chip in the text opens the idea's note on the right.
  const sheet = page.locator('aside.sheet');
  await expect(sheet).toBeHidden();
  await page.locator(`.draft-chip[data-id="${evidence.id}"]`).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('textbox').first()).toHaveValue(EVIDENCE);
});

test('Export: clean markdown, evidence as numbered footnotes', async ({ page, request }) => {
  const slug = await newProject(request, 'export');
  const { claim, evidence, question } = await spill(request, slug);
  await place(request, slug, { thesis: [claim.id] });
  await request.patch(`/api/p/${slug}/meta`, { data: { title: 'Air pumps' } });
  await request.put(`/api/p/${slug}/draft`, {
    data: { text: `<!--s:hook-->\nWhy care?<!--u:${question.id}-->\n\n<!--s:thesis-->\nTurbines are pumps.<!--u:${claim.id}--> Half goes to the compressor.<!--u:${evidence.id}-->\n` },
  });
  await open(page, slug, 'Draft');

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export' }).click();
  const md = fs.readFileSync((await (await download).path())!, 'utf8');

  expect(md).not.toContain('<!--');
  expect(md).toBe([
    '# Air pumps',
    '',
    'Why care?',
    '',
    'Turbines are pumps. Half goes to the compressor.[^1]',
    '',
    `[^1]: ${evidence.text}`,
    '',
  ].join('\n'));
});

test('Help: the ? menu opens a copy of the example, and its waiting spill parses from the stored result', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Help' }).click();
  await page.getByRole('menuitem', { name: 'Open an example' }).click();
  await expect(page).toHaveURL(/\?p=example-gas-turbines/);

  // The extra spill sits in the box; the first is already cut into ideas.
  const box = page.getByRole('textbox', { name: /Braindump here/ });
  await expect(box).toHaveValue(/^another thing\. the land turbines/);
  await expect(page.locator('.graph').getByText('firing temperature drives everything', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Parse writing' }).click();
  await expect(box).toHaveValue('');
  // Cards show a few pieces each, so check the result itself: the stored parse, applied by the system.
  const slug = new URL(page.url()).searchParams.get('p')!;
  await expect.poll(async () => {
    const events = await (await page.request.get(`/api/p/${slug}/events`)).json() as { type: string; author: string; data: { fromExample?: string; units: Unit[] } }[];
    const parse = events.filter((e) => e.type === 'parse').at(-1)!;
    return { author: parse.author, from: parse.data.fromExample, labels: parse.data.units.map((u) => u.label).includes('hotter firing eats blade life') };
  }).toEqual({ author: 'system', from: 'gas-turbines', labels: true });
});

test('Stages: the bar is the navigation, lights the next stage when ready, and hints once', async ({ page, request }) => {
  const slug = await newProject(request, 'stages');
  const { claim } = await spill(request, slug);
  await open(page, slug, 'Spill');

  // Ideas exist, so Shape is next: lit, and a click goes there.
  const nav = page.getByRole('navigation', { name: 'Stages' });
  const shape = nav.getByRole('button', { name: 'Shape' });
  const draft = nav.getByRole('button', { name: 'Draft' });
  await expect(shape).toHaveClass(/\bnext\b/);
  await expect(draft).not.toHaveClass(/\bnext\b/);
  await shape.click();
  await expect(shape).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('.levels')).toBeVisible();

  // First visit to Shape: one line under the bar, gone on the first action and not back after a reload.
  const hint = page.locator('.stage-hint');
  await expect(hint).toHaveText('Drag ideas onto the outline.');
  await page.locator('.levels').click({ position: { x: 5, y: 5 } });
  await expect(hint).toBeHidden();
  await page.reload();
  await expect(shape).toHaveAttribute('aria-current', 'step');
  await expect(hint).toBeHidden();

  // Nothing placed yet, so Draft waits; once an idea sits on a level, Draft lights up.
  await expect(draft).not.toHaveClass(/\bnext\b/);
  await place(request, slug, { thesis: [claim.id] });
  await page.reload();
  await expect(draft).toHaveClass(/\bnext\b/);
});
