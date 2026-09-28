/**
 * Compare models and effort levels on the parser: `npm run compare:parse [runs]`.
 * `npm run compare:parse 2 opus-5-5` runs only matching models. Runs `audit:parse` once per configuration per run, in parallel, and prints one row each.
 * Full cluster listings go to scratch/compare/ (gitignored) so the groupings can be read, not just counted.
 * Costs one API call per row.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';

const CONFIGS = [
  { model: 'claude-haiku-4-5', effort: 'none' },
  { model: 'claude-sonnet-5', effort: 'low' },
  { model: 'claude-sonnet-5', effort: 'medium' },
  { model: 'claude-opus-5', effort: 'low' },
  { model: 'claude-opus-5', effort: 'medium' },
  { model: 'claude-opus-5', effort: 'high' },
  { model: 'claude-opus-5-5', effort: 'low' },
  { model: 'claude-opus-5-5', effort: 'medium' },
];
const runs = Number(process.argv[2] ?? 2);
const only = process.argv[3]; // optional: run only configs whose model contains this, e.g. opus-5-5
const OUT = 'scratch/compare';
fs.mkdirSync(OUT, { recursive: true });

const run = promisify(execFile);
const jobs = CONFIGS.filter((c) => !only || c.model.includes(only)).flatMap((c) => Array.from({ length: runs }, (_, i) => ({ ...c, i })));

const rows = await Promise.all(jobs.map(async (j) => {
  const env = { ...process.env, PARSER_MODEL: j.model, PARSER_EFFORT: j.effort };
  let out = '';
  try { out = (await run('npx', ['tsx', 'scripts/audit-parse.ts'], { env, maxBuffer: 1 << 24 })).stdout; }
  catch (e) { out = String((e as { stdout?: string; stderr?: string }).stderr || (e as Error).message); }
  fs.writeFileSync(`${OUT}/${j.model}-${j.effort}-${j.i + 1}.txt`, out);
  const grab = (re: RegExp) => out.match(re)?.[1] ?? '';
  return {
    config: `${j.model.replace('claude-', '')} ${j.effort}`,
    secs: grab(/^parse: ([\d.]+)s/m),
    out: grab(/out (\d+)/),
    thinking: grab(/~(\d+) thinking/),
    units: grab(/^units\s+(\d+)/m),
    roots: grab(/^roots\s+(\d+)/m),
    perRoot: grab(/^pieces per root\s+(.*)$/m),
    loose: grab(/^loose pieces\s+(\d+)/m),
    reworded: grab(/^not verbatim\s+(\d+)/m),
    error: out.includes('parse:') ? '' : out.trim().split('\n').at(-1)!.slice(0, 80),
  };
}));

console.log('config             secs  out   think  units roots loose reworded  pieces per root');
for (const r of rows) {
  if (r.error) { console.log(`${r.config.padEnd(18)} ERROR ${r.error}`); continue; }
  console.log(`${r.config.padEnd(18)} ${r.secs.padStart(4)}  ${r.out.padStart(4)}  ${r.thinking.padStart(5)}  ${r.units.padStart(5)} ${r.roots.padStart(5)} ${r.loose.padStart(5)} ${r.reworded.padStart(8)}  ${r.perRoot}`);
}
console.log(`\nfull listings: ${OUT}/`);
