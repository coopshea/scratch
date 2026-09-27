#!/usr/bin/env node
// Compiles content/**/*.md into site/data.json. Zero dependencies.
// Frontmatter is a YAML subset: scalars, nested maps, lists of scalars, lists of maps.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CONTENT = join(ROOT, 'content');
const OUT = join(ROOT, 'site', 'data.json');

const NODE_TYPES = new Set(['problem', 'subproblem', 'concept']);
const EDGE_TYPES = new Set(['decomposes-into', 'requires', 'analogous-to', 'instance-of', 'blocks']);

let warnings = 0;
const warn = (msg) => { warnings++; console.warn('  warn: ' + msg); };
const fail = (msg) => { console.error('  error: ' + msg); process.exit(1); };

function scalar(v) {
  v = v.trim();
  if (v === '' || v === 'null' || v === '~') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function parseYaml(text) {
  const lines = text.split('\n');
  let i = 0;
  const indentOf = (s) => s.search(/\S/);
  const skippable = (s) => !s.trim() || s.trim().startsWith('#');
  function nextIndent() {
    let j = i;
    while (j < lines.length && skippable(lines[j])) j++;
    return j < lines.length ? indentOf(lines[j]) : -1;
  }
  function parseBlock(indent) {
    let result = null;
    while (i < lines.length) {
      const raw = lines[i];
      if (skippable(raw)) { i++; continue; }
      const ind = indentOf(raw);
      if (ind < indent) break;
      if (ind > indent) throw new Error(`unexpected indent at line ${i + 1}: ${raw}`);
      const t = raw.trim();
      if (t.startsWith('- ')) {
        if (result === null) result = [];
        if (!Array.isArray(result)) throw new Error(`mixed list and map at line ${i + 1}`);
        const rest = t.slice(2);
        i++;
        if (/^[\w.-]+:(\s|$)/.test(rest)) {
          lines.splice(i, 0, ' '.repeat(indent + 2) + rest);
          result.push(parseBlock(indent + 2));
        } else {
          result.push(scalar(rest));
        }
      } else {
        if (result === null) result = {};
        if (Array.isArray(result)) throw new Error(`mixed list and map at line ${i + 1}`);
        const m = t.match(/^([\w.-]+):(?:\s+(.*))?$/);
        if (!m) throw new Error(`cannot parse line ${i + 1}: ${raw}`);
        const key = m[1];
        const val = m[2];
        i++;
        if (val === undefined || val.trim() === '') {
          const ni = nextIndent();
          result[key] = ni > indent ? parseBlock(ni) : null;
        } else {
          result[key] = scalar(val);
        }
      }
    }
    return result ?? {};
  }
  return parseBlock(0);
}

function splitFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: src.trim() };
  return { meta: parseYaml(m[1]), body: m[2].trim() };
}

function loadDir(dir) {
  const p = join(CONTENT, dir);
  if (!existsSync(p)) return [];
  return readdirSync(p).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const src = readFileSync(join(p, f), 'utf8');
    try {
      const { meta, body } = splitFrontmatter(src);
      return { file: `${dir}/${f}`, meta, body };
    } catch (e) {
      fail(`${dir}/${f}: ${e.message}`);
    }
  });
}

const REF = /\[\[([\w-]+)(?:\|([^\]]+))?\]\]/g;
const refsIn = (text) => {
  const out = [];
  for (const m of text.matchAll(REF)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
};
const convertRefs = (text, titles, where) =>
  text.replace(REF, (_, id, label) => {
    if (!titles[id]) warn(`${where}: reference to unknown node [[${id}]]`);
    return `[${label ?? titles[id] ?? id}](#node/${id})`;
  });

// ---- lenses
const lenses = loadDir('lenses').map(({ file, meta, body }) => {
  if (!meta.id || !meta.name) fail(`${file}: lens needs id and name`);
  return { id: meta.id, name: meta.name, color: meta.color || '#888', order: meta.order ?? 99, question: meta.question || '', body };
});
const lensIds = new Set(lenses.map((l) => l.id));

// ---- nodes
const rawNodes = loadDir('problems');
const titles = {};
for (const { file, meta } of rawNodes) {
  if (!meta.id) fail(`${file}: node needs an id`);
  if (titles[meta.id]) fail(`${file}: duplicate id ${meta.id}`);
  titles[meta.id] = meta.title || meta.id;
}

const edges = [];
const nodes = rawNodes.map(({ file, meta, body }) => {
  if (!NODE_TYPES.has(meta.type)) warn(`${file}: type "${meta.type}" not in ${[...NODE_TYPES].join('/')}`);
  const lensW = meta.lenses || {};
  for (const k of Object.keys(lensW)) if (!lensIds.has(k)) warn(`${file}: unknown lens "${k}"`);
  const restate = meta.restate || {};
  for (const k of Object.keys(restate)) if (!lensIds.has(k)) warn(`${file}: restate for unknown lens "${k}"`);
  for (const e of meta.edges || []) {
    if (!e || !e.to) { warn(`${file}: edge without "to"`); continue; }
    if (!titles[e.to]) { warn(`${file}: edge to unknown node "${e.to}" dropped`); continue; }
    if (!EDGE_TYPES.has(e.type)) warn(`${file}: edge type "${e.type}" not in ${[...EDGE_TYPES].join('/')}`);
    edges.push({ source: meta.id, target: e.to, type: e.type || 'decomposes-into' });
  }
  return {
    id: meta.id,
    title: titles[meta.id],
    type: NODE_TYPES.has(meta.type) ? meta.type : 'subproblem',
    statement: meta.statement || '',
    value: meta.value ?? null,
    uncertainty: meta.uncertainty ?? null,
    lenses: lensW,
    restate,
    source: meta.source || '',
    body: convertRefs(body, titles, file),
    refs: refsIn(body),
    file,
  };
});

// ---- essays
const essays = loadDir('essays').map(({ file, meta, body }) => {
  if (!meta.id) fail(`${file}: essay needs an id`);
  const path = refsIn(body).filter((id) => titles[id]);
  if (meta.lens && !lensIds.has(meta.lens)) warn(`${file}: unknown lens "${meta.lens}"`);
  return {
    id: meta.id,
    title: meta.title || meta.id,
    author: meta.author || '',
    date: meta.date || '',
    lens: meta.lens || null,
    summary: meta.summary || '',
    path,
    body: convertRefs(body, titles, file),
    file,
  };
});

const out = { generatedAt: new Date().toISOString(), lenses, nodes, edges, essays };
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`built site/data.json: ${nodes.length} nodes, ${edges.length} edges, ${lenses.length} lenses, ${essays.length} essays${warnings ? `, ${warnings} warning(s)` : ''}`);
