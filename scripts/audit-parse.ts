/**
 * Parser audit: `npm run audit:parse [file ...]`. Runs one or more blurts, in order, into one document through
 * the real parser and the real server path, in a temporary folder, and reports the shape of what comes back.
 * With several blurts it also reports how each later blurt lands on the clusters already there.
 * Default: the CAD talk. Costs one API call per blurt. A measurement, not a pass/fail test.
 */
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SCRATCH_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-audit-'));
const files = process.argv.length > 2 ? process.argv.slice(2) : [new URL('../test/fixtures/cad-talk.md', import.meta.url).pathname];

const { createApp } = await import('../server/app.ts');
const { isRoot, pickVisible } = await import('../shared/clusters.ts');
const app = createApp();
const server = app.listen(0);
const port = (server.address() as { port: number }).port;
const call = async (p: string, body: unknown) =>
  (await fetch(`http://localhost:${port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();

type U = { id: string; type: string; label: string; text: string; home: string | null; start: number; flags?: { notVerbatim?: boolean; labelTooLong?: boolean } };
const root = (u: U) => isRoot(u as never);

const { slug } = await call('/api/projects', { title: 'audit' });
const started = Date.now();
const blurtOf = new Map<string, number>(); // unit id -> which blurt it came from, 1-based
let units: U[] = [];
let chars = 0;
for (const [i, file] of files.entries()) {
  const text = fs.readFileSync(file, 'utf8');
  chars += text.length;
  const res = await call(`/api/p/${slug}/blurts`, { text });
  if (res.error) { console.error(`${path.basename(file)}: ${res.error}`); server.close(); process.exit(1); }
  const fresh: U[] = res.units;
  for (const u of fresh) blurtOf.set(u.id, i + 1);
  units = [...units, ...fresh];
  if (i > 0) {
    const earlier = (id: string | null) => !!id && blurtOf.get(id)! <= i;
    console.log(`blurt ${i + 1} (${path.basename(file)}): ${fresh.length} units -> `
      + `${fresh.filter((u) => earlier(u.home)).length} joined earlier roots, ${fresh.filter(root).length} new roots, `
      + `${fresh.filter((u) => u.home && !earlier(u.home)).length} under new roots, ${fresh.filter((u) => !u.home && !root(u)).length} loose`);
  }
}
server.close();

const roots = units.filter(root);
const kidsOf = (r: U) => units.filter((u) => u.home === r.id);
const loose = units.filter((u) => !root(u) && !u.home);
const sizes = roots.map((r) => kidsOf(r).length);
const collapsed = roots.reduce((n, r) => n + pickVisible(kidsOf(r) as never[]).hidden.length, 0);

// Does a piece sit under the root nearest to it in its own blurt, or one further away (association by meaning)?
let nearest = 0, farther = 0;
for (const u of units) {
  const located = roots.filter((r) => r.start >= 0 && blurtOf.get(r.id) === blurtOf.get(u.id));
  if (!u.home || u.start < 0 || !located.length) continue;
  const near = located.reduce((a, b) => (Math.abs(b.start - u.start) < Math.abs(a.start - u.start) ? b : a));
  if (near.id === u.home) nearest++; else farther++;
}

const reworded = units.filter((u) => u.flags?.notVerbatim).length;
console.log(`\nblurts: ${files.map((f) => path.basename(f)).join(' then ')}, ${chars} chars, parsed in ${((Date.now() - started) / 1000).toFixed(0)}s\n`);
console.log(`units            ${units.length}`);
console.log(`roots            ${roots.length}  (${roots.filter((r) => r.type === 'claim').length} claims, ${roots.filter((r) => r.type === 'question').length} questions)`);
console.log(`pieces per root  ${[...sizes].sort((a, b) => b - a).join(' ')}`);
console.log(`lone roots       ${sizes.filter((s) => s === 0).length}`);
console.log(`loose pieces     ${loose.length}`);
console.log(`collapsed (>4)   ${collapsed}`);
console.log(`under nearest    ${nearest} / ${nearest + farther}  (the rest joined a root further away)`);
console.log(`not verbatim     ${reworded}  (${Math.round((100 * reworded) / Math.max(1, units.length))}%)`);
console.log(`label too long   ${units.filter((u) => u.flags?.labelTooLong).length}`);
console.log(`\nclusters:${files.length > 1 ? '  ([n] = which blurt a piece came from)' : ''}`);
const mark = (u: U) => (files.length > 1 ? `[${blurtOf.get(u.id)}] ` : '');
for (const r of roots) {
  const { shown, hidden } = pickVisible(kidsOf(r) as never[]) as { shown: U[]; hidden: U[] };
  console.log(`\n  ${r.type === 'question' ? '?' : '■'} ${mark(r)}${r.label}`);
  for (const k of shown) console.log(`      ${mark(k)}${k.type.padEnd(9)} ${k.label}`);
  if (hidden.length) console.log(`      + ${hidden.length} more: ${hidden.map((k) => mark(k) + k.label).join(' · ')}`);
}
if (loose.length) console.log(`\nloose: ${loose.map((u) => `${mark(u)}${u.type}: ${u.label}`).join(' · ')}`);
