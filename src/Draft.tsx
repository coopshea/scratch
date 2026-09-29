import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  Decoration, EditorView, ViewPlugin, WidgetType, drawSelection, keymap, type DecorationSet, type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { Unit } from '../shared/types.ts';
import { isRoot } from '../shared/clusters.ts';
import { normalizeMarkers } from '../shared/markers.ts';
import { STRUCTURES, type Board, type Lane, type StructureDef } from '../shared/structures.ts';
import { api } from './api.ts';
import { TYPE_INK } from './typeStyle.ts';

/* ---------- markers in the draft: both are HTML comments, so exported markdown stays clean ---------- */

const ANCHOR = /<!--u:([a-z0-9]+)-->/g;
const SECTION = /^<!--s:([a-z0-9-]+)-->$/;
const anchorFor = (id: string) => `<!--u:${id}-->`;
const sectionFor = (lane: string) => `<!--s:${lane}-->`;

const MARKER = /<!--s:[a-z0-9-]+-->/g;

/** After any edit, a marker joined to text (a deleted line break, typing against a divider) gets its line breaks back. */
const keepMarkersAlone = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  const s = tr.newDoc.toString(), fix: { from: number; insert: string }[] = [];
  for (const m of s.matchAll(MARKER)) {
    const from = m.index!, to = from + m[0].length;
    if (from > 0 && s[from - 1] !== '\n') fix.push({ from, insert: '\n' });
    if (to < s.length && s[to] !== '\n') fix.push({ from: to, insert: '\n' });
  }
  return fix.length ? [tr, { changes: fix, sequential: true }] : tr;
});

/**
 * The cursor never rests on a divider's line: that line draws as a tall block, and the cursor would stretch to its
 * height. Moving down lands at the start of the next section; moving up, at the end of the previous one.
 */
const keepCursorOffMarkers = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection && !tr.docChanged) return tr;
  const doc = tr.newDoc, sel = tr.newSelection.main;
  if (!sel.empty) return tr;
  const line = doc.lineAt(sel.head);
  if (!SECTION.test(line.text)) return tr;
  const down = sel.head >= tr.startState.selection.main.head;
  const next = line.number < doc.lines ? doc.line(line.number + 1).from : null;
  const prev = line.number > 1 ? doc.line(line.number - 1).to : null;
  const pos = down ? (next ?? prev) : (prev ?? next);
  return pos === null ? tr : [tr, { selection: { anchor: pos }, sequential: true }];
});

/** Every lane of the structure gets a section marker, inserted in outline order before the next lane that has one. */
function ensureSections(doc: string, laneIds: string[]): string {
  const lines = doc.split('\n');
  const markerLine = (id: string) => lines.findIndex((l) => l.trim() === sectionFor(id));
  if (!lines.some((l) => SECTION.test(l.trim()))) {
    const body = doc.trim();
    return `${laneIds.map((id, i) => `${sectionFor(id)}\n${i === 0 && body ? body + '\n' : ''}`).join('\n')}`;
  }
  let changed = false;
  laneIds.forEach((id, i) => {
    if (markerLine(id) >= 0) return;
    const nextId = laneIds.slice(i + 1).find((n) => markerLine(n) >= 0);
    const at = nextId ? markerLine(nextId) : lines.length;
    lines.splice(at, 0, sectionFor(id), '');
    changed = true;
  });
  return changed ? lines.join('\n') : doc;
}

type Marker = { lane: string; from: number; to: number };

function findMarkers(state: EditorState): Marker[] {
  const out: Marker[] = [];
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    const m = line.text.match(SECTION);
    if (m) out.push({ lane: m[1], from: line.from, to: line.to });
  }
  return out;
}

/* ---------- section rules: block widgets with a spacer that keeps text level with its outline ---------- */

const setSpacers = StateEffect.define<Record<string, number>>();
const laneNames = new Map<string, string>();

class SectionWidget extends WidgetType {
  constructor(readonly lane: string, readonly spacer: number) { super(); }
  eq(o: SectionWidget) { return o.lane === this.lane && o.spacer === this.spacer; }
  toDOM() {
    const d = document.createElement('div');
    d.className = 'cm-section';
    d.style.paddingTop = `${this.spacer}px`;
    const rule = document.createElement('div');
    rule.className = 'cm-section-rule';
    d.appendChild(rule);
    return d;
  }
  get estimatedHeight() { return this.spacer + 18; }
  ignoreEvent() { return true; }
}

type SectionState = { markers: Marker[]; spacers: Record<string, number>; deco: DecorationSet };

function buildSections(state: EditorState, spacers: Record<string, number>): SectionState {
  const markers = findMarkers(state);
  const b = new RangeSetBuilder<Decoration>();
  for (const m of markers) b.add(m.from, m.to, Decoration.replace({ widget: new SectionWidget(m.lane, spacers[m.lane] ?? 0), block: true }));
  return { markers, spacers, deco: b.finish() };
}

const sections = StateField.define<SectionState>({
  create: (s) => buildSections(s, {}),
  update(v, tr) {
    let spacers = v.spacers;
    for (const e of tr.effects) if (e.is(setSpacers)) spacers = e.value;
    return tr.docChanged || spacers !== v.spacers ? buildSections(tr.state, spacers) : v;
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.deco),
    EditorView.atomicRanges.of((view) => view.state.field(f).deco),
  ],
});

/* ---------- idea anchors: inline chips ---------- */

const labels = new Map<string, string>();
const refresh = StateEffect.define<null>();

class AnchorWidget extends WidgetType {
  constructor(readonly id: string, readonly nth: number) { super(); }
  eq(o: AnchorWidget) { return o.id === this.id && o.nth === this.nth; }
  toDOM() {
    const s = document.createElement('span');
    s.className = `cm-anchor${this.nth > 0 ? ' callback' : ''}`;
    s.dataset.id = this.id;
    s.textContent = labels.get(this.id) ?? 'cut idea';
    return s;
  }
  ignoreEvent() { return false; }
}

function buildAnchors(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const seen = new Map<string, number>();
  for (const m of view.state.doc.toString().matchAll(ANCHOR)) {
    const n = seen.get(m[1]) ?? 0;
    seen.set(m[1], n + 1);
    b.add(m.index!, m.index! + m[0].length, Decoration.replace({ widget: new AnchorWidget(m[1], n) }));
  }
  return b.finish();
}

const anchorPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(v: EditorView) { this.decorations = buildAnchors(v); }
  update(u: ViewUpdate) {
    if (u.docChanged || u.transactions.some((t) => t.effects.some((e) => e.is(refresh)))) this.decorations = buildAnchors(u.view);
  }
}, {
  decorations: (v) => v.decorations,
  provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations ?? Decoration.none),
});

/* ---------- the blank-draft hint: a placeholder on the first writing line, gone with the first word ---------- */

const setHint = StateEffect.define<string>();

class HintWidget extends WidgetType {
  constructor(readonly text: string) { super(); }
  eq(o: HintWidget) { return o.text === this.text; }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-draft-hint';
    s.setAttribute('aria-hidden', 'true');
    s.textContent = this.text;
    return s;
  }
  ignoreEvent() { return true; }
}

/** Only while nothing but dividers is written: on the empty line under the first divider, where the cursor starts. */
function buildHint(state: EditorState, text: string): DecorationSet {
  if (!text || state.doc.toString().replace(MARKER, '').trim()) return Decoration.none;
  const first = findMarkers(state)[0];
  if (!first) return Decoration.none;
  const n = state.doc.lineAt(first.to).number;
  if (n >= state.doc.lines || SECTION.test(state.doc.line(n + 1).text)) return Decoration.none;
  return Decoration.set([Decoration.widget({ widget: new HintWidget(text), side: 1 }).range(state.doc.line(n + 1).from)]);
}

const hintField = StateField.define<{ text: string; deco: DecorationSet }>({
  create: () => ({ text: '', deco: Decoration.none }),
  update(v, tr) {
    let text = v.text;
    for (const e of tr.effects) if (e.is(setHint)) text = e.value;
    return text === v.text && !tr.docChanged ? v : { text, deco: buildHint(tr.state, text) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

const ink = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '600' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: [tags.processingInstruction, tags.meta, tags.url], color: 'var(--ink-3)' },
]);

/* ---------- local keyword match: flags ideas mentioned by name but not yet placed ---------- */

const STOP = new Set('the a an and or of to in on for with as by at from is are was were be been this that these those it its into than then there their our your my we you they he she not but if so do does did can could would should may might will just also more most very about over under between through'.split(' '));
const words = (s: string) => s.toLowerCase().replace(/<!--.*?-->/g, ' ').match(/[a-z][a-z-]{2,}/g)?.filter((w) => !STOP.has(w)) ?? [];
const stem = (w: string) => w.replace(/(ing|ed|es|s|ly)$/, '');

function mentions(paragraph: string, u: Unit): boolean {
  const para = new Set(words(paragraph).map(stem));
  const key = [...new Set(words(u.label).map(stem))];
  if (!key.length) return false;
  const hit = key.filter((k) => para.has(k)).length;
  return key.length === 1 ? hit === 1 && key[0].length >= 6 : hit / key.length >= 0.67;
}

/* ---------- component ---------- */

type Props = {
  units: Unit[];
  board: Board;
  draft: string;
  onDraft: (t: string) => void;
  onSelect: (id: string) => void;
  onBoard: (b: Board, auto?: boolean) => void;
  structures: Record<string, StructureDef>;
};

type Row = { unit: Unit; depth: number };

export function Draft({ units, board, draft, onDraft, onSelect, onBoard, structures }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const colRef = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const sectionEls = useRef(new Map<string, HTMLElement>());
  const saveTimer = useRef<number | undefined>(undefined);
  const moveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<string | null>(null);
  const [text, setText] = useState(draft);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const [rows, setRows] = useState<{ lane: string; y: number }[]>([]);
  const [colH, setColH] = useState(0);
  const [active, setActive] = useState<{ lane: string | null; paragraph: string }>({ lane: null, paragraph: '' });
  const [dropLane, setDropLane] = useState<string | null>(null);

  const lanes = (structures[board.structure] ?? STRUCTURES.persuasive).lanes;
  const laneById = useMemo(() => new Map(lanes.map((l) => [l.id, l])), [lanes]);
  const live = useMemo(() => units.filter((u) => u.status !== 'cut'), [units]);
  const byId = useMemo(() => new Map(live.map((u) => [u.id, u])), [live]);
  const assign = board.lanes[board.structure] ?? {};
  const placedLane = useMemo(() => {
    const m = new Map<string, string>();
    for (const [lane, ids] of Object.entries(assign)) for (const id of ids) if (byId.has(id)) m.set(id, lane);
    return m;
  }, [assign, byId]);
  /** Lane a unit effectively sits in: its own placement, or its claim's. */
  const laneOf = (u: Unit): string | null => placedLane.get(u.id) ?? (u.home && byId.has(u.home) ? laneOf(byId.get(u.home)!) : null);

  const rowsFor = (laneId: string): Row[] => (assign[laneId] ?? []).map((id) => byId.get(id)).filter((u): u is Unit => !!u)
    .flatMap((u) => [
      { unit: u, depth: 0 },
      ...(isRoot(u) ? live.filter((k) => k.home === u.id && !placedLane.has(k.id)).map((k) => ({ unit: k, depth: 1 })) : []),
    ]);

  const uses = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of text.matchAll(ANCHOR)) m.set(x[1], (m.get(x[1]) ?? 0) + 1);
    return m;
  }, [text]);

  // Keep chip labels current.
  useEffect(() => {
    labels.clear();
    for (const u of units) labels.set(u.id, u.label);
    for (const l of lanes) laneNames.set(l.id, l.name);
    view.current?.dispatch({ effects: refresh.of(null) });
  }, [units, lanes]);

  /* Measure both columns and align them: outline sections sit level with their text; the shorter side gets a spacer. */
  const measure = () => {
    const v = view.current; if (!v) return;
    v.requestMeasure({
      key: 'align',
      read: (v) => {
        const st = v.state.field(sections);
        const colTop = colRef.current?.getBoundingClientRect().top ?? 0;
        const offset = v.documentTop - colTop;
        const tops = st.markers.map((m) => v.lineBlockAt(m.from).top);
        const docH = v.contentHeight;
        return st.markers.map((m, i) => {
          const spacer = st.spacers[m.lane] ?? 0;
          const y = offset + tops[i] + spacer;
          const textH = (i + 1 < tops.length ? tops[i + 1] : docH) - (tops[i] + spacer);
          const outH = sectionEls.current.get(m.lane)?.scrollHeight ?? 0;
          return { lane: m.lane, y, textH, outH };
        });
      },
      write: (m, v) => {
        const st = v.state.field(sections);
        const next: Record<string, number> = {};
        for (let i = 1; i < m.length; i++) {
          const prev = m[i - 1];
          next[m[i].lane] = Math.max(0, Math.ceil(prev.outH + 16 - prev.textH));
        }
        const changed = m.some((r) => Math.abs((next[r.lane] ?? 0) - (st.spacers[r.lane] ?? 0)) > 1);
        if (changed) queueMicrotask(() => { if (view.current === v) v.dispatch({ effects: setSpacers.of(next) }); });
        setRows((old) => (old.length === m.length && old.every((r, i) => r.lane === m[i].lane && Math.abs(r.y - m[i].y) < 1) ? old : m.map((r) => ({ lane: r.lane, y: r.y }))));
        const last = m[m.length - 1];
        setColH(Math.max(v.contentHeight + (v.documentTop - (colRef.current?.getBoundingClientRect().top ?? 0)), last ? last.y + last.outH + 40 : 0));
      },
    });
  };

  const updateActive = (state: EditorState) => {
    const head = state.selection.main.head;
    const st = state.field(sections);
    const lane = [...st.markers].reverse().find((m) => m.from <= head)?.lane ?? null;
    const line = state.doc.lineAt(head);
    let a = line.number, b = line.number;
    while (a > 1 && state.doc.line(a - 1).text.trim() && !SECTION.test(state.doc.line(a - 1).text)) a--;
    while (b < state.doc.lines && state.doc.line(b + 1).text.trim() && !SECTION.test(state.doc.line(b + 1).text)) b++;
    const paragraph = state.sliceDoc(state.doc.line(a).from, state.doc.line(b).to);
    setActive((old) => (old.lane === lane && old.paragraph === paragraph ? old : { lane, paragraph }));
  };

  // Placing an idea in a section moves it there (explicit anchors only; logged as a system move).
  const autoMove = (doc: string) => {
    const firstLane = new Map<string, string>();
    let lane: string | null = null;
    for (const line of doc.split('\n')) {
      const s = line.match(SECTION); if (s) { lane = s[1]; continue; }
      if (!lane) continue;
      for (const m of line.matchAll(ANCHOR)) if (!firstLane.has(m[1])) firstLane.set(m[1], lane);
    }
    const next: Record<string, string[]> = Object.fromEntries(Object.entries(assign).map(([k, v]) => [k, [...v]]));
    let changed = false;
    for (const [id, to] of firstLane) {
      const u = byId.get(id), l = laneById.get(to);
      // The writer's placement wins: no type or slot rules in the draft.
      if (!u || !l || laneOf(u) === to) continue;
      for (const k of Object.keys(next)) next[k] = next[k].filter((x) => x !== id);
      next[to] = [...(next[to] ?? []), id];
      changed = true;
    }
    if (changed) onBoard({ ...board, lanes: { ...board.lanes, [board.structure]: next } }, true);
  };
  const autoMoveRef = useRef(autoMove);
  autoMoveRef.current = autoMove;

  useEffect(() => {
    const flush = () => {
      window.clearTimeout(saveTimer.current);
      if (pending.current !== null) { api.saveDraft(pending.current); pending.current = null; }
    };
    const initial = ensureSections(normalizeMarkers(draft), lanes.map((l) => l.id));
    const extensions: Extension[] = [
      history(), drawSelection(), keymap.of([...defaultKeymap, ...historyKeymap]), keepMarkersAlone, keepCursorOffMarkers,
      markdown(), syntaxHighlighting(ink), sections, anchorPlugin, hintField, EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged || u.geometryChanged || u.viewportChanged) measure();
        if (u.docChanged || u.selectionSet) updateActive(u.state);
        if (!u.docChanged) return;
        const t = u.state.doc.toString();
        setText(t); onDraft(t);
        pending.current = t;
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(flush, 1500);
        window.clearTimeout(moveTimer.current);
        moveTimer.current = window.setTimeout(() => autoMoveRef.current(t), 900);
      }),
    ];
    const v = new EditorView({ parent: host.current!, state: EditorState.create({ doc: initial, extensions }) });
    view.current = v;
    if (initial !== draft) { pending.current = initial; setText(initial); onDraft(initial); flush(); }
    // Start typing in the first section.
    const first = findMarkers(v.state)[0];
    const at = first ? Math.min(v.state.doc.length, v.state.doc.lineAt(first.to).to + 1) : v.state.doc.length;
    v.dispatch({ selection: { anchor: at } });
    v.focus();
    updateActive(v.state);
    measure();
    window.addEventListener('beforeunload', flush);
    return () => { flush(); window.clearTimeout(moveTimer.current); window.removeEventListener('beforeunload', flush); v.destroy(); view.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Structure switched: add markers for its lanes.
  useEffect(() => {
    const v = view.current; if (!v) return;
    const doc = v.state.doc.toString();
    const next = ensureSections(doc, lanes.map((l) => l.id));
    if (next !== doc) v.dispatch({ changes: { from: 0, to: doc.length, insert: next } });
  }, [lanes]);

  // Outline content changed (open/close, units, board): re-align.
  useEffect(() => { measure(); });

  // Hovering an outline item finds its chip in the text (unless the hover came from the chip itself).
  const hoverFromChip = useRef(false);
  useEffect(() => {
    if (!hover || !host.current || hoverFromChip.current) return;
    host.current.querySelector(`.cm-anchor[data-id="${hover}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [hover]);

  /**
   * Chips work both ways. Hovering a chip highlights its idea in the outline. Clicking a chip opens that idea in the
   * outline (its full text shows), brings it into view and marks it current; the cursor stays in the text, so the
   * writer keeps writing with the idea open beside them.
   */
  const [current, setCurrent] = useState<string | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  useEffect(() => {
    const el = host.current; if (!el) return;
    const chipOf = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>('.cm-anchor')?.dataset.id ?? null;
    const over = (e: MouseEvent) => { const id = chipOf(e); if (id) { hoverFromChip.current = true; setHover(id); } };
    const out = (e: MouseEvent) => { if (chipOf(e)) { hoverFromChip.current = false; setHover(null); } };
    const click = (e: MouseEvent) => {
      const id = chipOf(e); if (!id) return;
      setCurrent(id);
      setOpen((s) => new Set(s).add(id));
      onSelectRef.current(id); // the note panel opens on the right, without taking the cursor from the page
      requestAnimationFrame(() => colRef.current?.querySelector(`.cue[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    };
    el.addEventListener('mouseover', over); el.addEventListener('mouseout', out); el.addEventListener('click', click);
    return () => { el.removeEventListener('mouseover', over); el.removeEventListener('mouseout', out); el.removeEventListener('click', click); };
  }, []);

  const insert = (id: string) => {
    const v = view.current; if (!v) return;
    const at = v.state.selection.main.head;
    v.dispatch({ changes: { from: at, insert: anchorFor(id) }, selection: { anchor: at + anchorFor(id).length } });
    v.focus();
  };

  /** Move an idea into a section, before `beforeId` (or at the end). Within its own section this reorders it. */
  const move = (id: string, to: string, beforeId: string | null = null) => {
    const u = byId.get(id), l = laneById.get(to);
    if (!u || !l || beforeId === id) return;
    if (laneOf(u) === to && beforeId === null && (assign[to] ?? []).at(-1) === id) return;
    const next: Record<string, string[]> = Object.fromEntries(Object.entries(assign).map(([k, v]) => [k, v.filter((x) => x !== id)]));
    const list = next[to] ?? [];
    const at = beforeId ? list.indexOf(beforeId) : -1;
    next[to] = at < 0 ? [...list, id] : [...list.slice(0, at), id, ...list.slice(at)];
    onBoard({ ...board, lanes: { ...board.lanes, [board.structure]: next } });
  };

  /**
   * Dropping: a section accepts a drop anywhere down its band (to the next divider), not just over its items.
   * Where the pointer is decides the order: the idea lands before the first top-level item below it, and a line
   * shows the spot. Holding near the top or bottom edge scrolls the page, as in Structure.
   */
  const [dropAt, setDropAt] = useState<{ lane: string; before: string | null; y: number } | null>(null);
  useEffect(() => {
    const clear = () => { setDropAt(null); setDropLane(null); };
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);
  const dropTarget = (laneId: string, clientY: number) => {
    const el = sectionEls.current.get(laneId); if (!el) return null;
    const top = el.getBoundingClientRect().top;
    const heads = [...el.querySelectorAll<HTMLElement>(':scope > .cue.depth-0')];
    const hit = heads.find((h) => { const r = h.getBoundingClientRect(); return clientY < r.top + r.height / 2; });
    const y = hit ? hit.getBoundingClientRect().top - top - 2
      : heads.length ? heads[heads.length - 1].getBoundingClientRect().bottom - top + 2 : (el.querySelector('h3')?.getBoundingClientRect().bottom ?? top) - top + 4;
    return { lane: laneId, before: hit?.dataset.id ?? null, y };
  };
  const dragOver = (laneId: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-unit')) return;
    e.preventDefault();
    setDropLane(laneId);
    const t = dropTarget(laneId, e.clientY);
    setDropAt((d) => (t && (d?.lane !== t.lane || d.before !== t.before || Math.abs(d.y - t.y) > 1) ? t : d));
  };
  const drop = (laneId: string) => (e: React.DragEvent) => {
    const id = e.dataTransfer.getData('application/x-unit');
    const t = dropTarget(laneId, e.clientY);
    setDropLane(null); setDropAt(null);
    if (id) { e.preventDefault(); move(id, laneId, t?.before ?? null); }
  };
  const edgeScroll = (e: React.DragEvent) => {
    const box = scrollRef.current; if (!box) return;
    const r = box.getBoundingClientRect(), EDGE = 70, MAX = 18;
    const near = e.clientY < r.top + EDGE ? -(1 - (e.clientY - r.top) / EDGE) : e.clientY > r.bottom - EDGE ? 1 - (r.bottom - e.clientY) / EDGE : 0;
    if (near) box.scrollTop += Math.sign(near) * Math.ceil(MAX * Math.min(1, Math.abs(near)) ** 2);
  };

  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const suggestions = useMemo(() => {
    if (!active.lane || !active.paragraph.trim()) return [];
    const lane = laneById.get(active.lane);
    if (!lane) return [];
    return live.filter((u) => !uses.has(u.id) && laneOf(u) !== active.lane && mentions(active.paragraph, u));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, live, uses, placedLane, laneById]);

  /** A click opens or closes an idea; only a press held for a moment and then moved drags it. */
  const pressedAt = useRef(0);
  const HOLD_MS = 180;

  const cue = ({ unit: u, depth }: Row) => {
    const n = uses.get(u.id) ?? 0;
    return (
      <div key={u.id} data-id={u.id} className={`cue depth-${depth} ${n ? 'used' : ''} ${hover === u.id ? 'hl' : ''} ${current === u.id ? 'current' : ''}`} draggable
        onPointerDown={() => { pressedAt.current = Date.now(); }}
        onDragStart={(e) => {
          if (Date.now() - pressedAt.current < HOLD_MS) { e.preventDefault(); return; }
          e.dataTransfer.setData('text/plain', anchorFor(u.id));
          e.dataTransfer.setData('application/x-unit', u.id);
          e.dataTransfer.effectAllowed = 'copyMove';
        }}
        onMouseEnter={() => { hoverFromChip.current = false; setHover(u.id); }} onMouseLeave={() => setHover(null)}>
        <div className="cue-line" onClick={() => toggle(u.id)}>
          <button className="disclose" aria-label="Show original">{open.has(u.id) ? '▾' : '▸'}</button>
          {!(u.type === 'claim' && isRoot(u)) && <em style={{ color: TYPE_INK[u.type] }}>{u.type}</em>}
          <span className={`cue-label ${isRoot(u) ? 'is-claim' : ''}`} onDoubleClick={() => insert(u.id)}>{u.label}</span>
          {n > 1 && <span className="uses">×{n}</span>}
        </div>
        {open.has(u.id) && <p className="cue-text" onClick={() => onSelect(u.id)}>{u.text}</p>}
      </div>
    );
  };

  const section = (laneId: string, y: number, h: number) => {
    const lane: Lane | undefined = laneById.get(laneId);
    const items = rowsFor(laneId);
    return [
      // The section's whole band accepts a drop; this zone is not measured, so it never changes the alignment.
      <div key={`z-${laneId}`} className={`cue-zone ${dropLane === laneId ? 'drop' : ''}`} style={{ top: y, height: h }}
        onDragOver={dragOver(laneId)} onDrop={drop(laneId)} />,
      <section key={laneId} className={`cue-block ${active.lane === laneId ? 'active' : ''}`}
        style={{ top: y }}
        ref={(el) => { if (el) sectionEls.current.set(laneId, el); else sectionEls.current.delete(laneId); }}
        onDragOver={dragOver(laneId)} onDrop={drop(laneId)}>
        {dropAt?.lane === laneId && <div className="cue-drop-line" style={{ top: dropAt.y }} />}
        <h3 className={lane?.required && !items.length && anyPlaced ? 'gap' : ''}>{lane?.name ?? laneId}</h3>
        {items.map(cue)}
        {active.lane === laneId && suggestions.map((u) => (
          <div key={`s-${u.id}`} className="cue suggestion">
            <div className="cue-line">
              <em style={{ color: TYPE_INK[u.type] }}>{u.type === 'claim' ? 'claim' : u.type}</em>
              <span className="cue-label">{u.label}</span>
              <button className="link" onClick={() => move(u.id, laneId)}>move here</button>
            </div>
          </div>
        ))}
      </section>,
    ];
  };

  const anyPlaced = Object.values(assign).some((ids) => ids.some((id) => byId.has(id)));
  // A draft with nothing written yet gets one line of guidance where the cursor starts; it goes with the first word.
  const hint = anyPlaced ? 'Open an idea on the left to see your words, then start writing here.' : 'Write here. Ideas you put in order in Shape appear on the left.';
  useEffect(() => { view.current?.dispatch({ effects: setHint.of(hint) }); }, [hint]);

  return (
    <div className="draft-rows" ref={scrollRef} onDragOver={edgeScroll}>
      {hover && <style>{`.cm-anchor[data-id="${hover}"] { background: var(--marker); }`}</style>}
      <div className="draft-grid">
        <div className="cue-col" ref={colRef} style={{ height: colH || undefined }}>
          {rows.map((r, i) => section(r.lane, r.y, (i + 1 < rows.length ? rows[i + 1].y : colH || r.y + 200) - r.y))}
        </div>
        <div className="page" ref={host} />
      </div>
    </div>
  );
}
