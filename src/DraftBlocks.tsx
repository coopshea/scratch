import { useEffect, useMemo, useRef, useState } from 'react';
import { SideMenuController, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import type { Unit } from '../shared/types.ts';
import { isRoot } from '../shared/clusters.ts';
import { ensureSections, normalizeMarkers } from '../shared/markers.ts';
import { STRUCTURES, type Board, type StructureDef } from '../shared/structures.ts';
import { api } from './api.ts';
import { ChipLabels, noSpellcheckInCode, schema, ScratchSideMenu, slashItems } from './blocks.tsx';
import { blocksToMarkdown, markdownToBlocks } from './draftBlocks.ts';
import { TYPE_INK } from './typeStyle.ts';

/**
 * Proof of concept: the Draft page on BlockNote, the editor the idea sheet uses, opened with ?editor=blocks. It keeps
 * the outline beside the page, aligned section by section, and stores the same markdown as the CodeMirror draft.
 * Not here yet: ideas moving to the section their chip lands in, suggestions, drag within the outline.
 */

type Props = {
  units: Unit[];
  board: Board;
  draft: string;
  onDraft: (t: string) => void;
  onSelect: (id: string) => void;
  onBoard: (b: Board) => void;
  structures: Record<string, StructureDef>;
};

export function DraftBlocks({ units, board, draft, onDraft, onSelect, onBoard, structures }: Props) {
  const editor = useCreateBlockNote({ schema, uploadFile: (file: File) => api.upload(file) });
  const colRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const sectionEls = useRef(new Map<string, HTMLElement>());
  const [rows, setRows] = useState<{ lane: string; y: number }[]>([]);
  const [spacers, setSpacers] = useState<Record<string, number>>({});
  const [colH, setColH] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const saved = useRef(draft);
  const saveTimer = useRef<number | undefined>(undefined);

  const lanes = (structures[board.structure] ?? STRUCTURES.persuasive).lanes;
  const laneIds = useMemo(() => lanes.map((l) => l.id), [lanes]);
  const laneById = useMemo(() => new Map(lanes.map((l) => [l.id, l])), [lanes]);
  const live = useMemo(() => units.filter((u) => u.status !== 'cut'), [units]);
  const byId = useMemo(() => new Map(live.map((u) => [u.id, u])), [live]);
  const labels = useMemo(() => new Map(units.map((u) => [u.id, u.label])), [units]);
  const assign = board.lanes[board.structure] ?? {};
  const placed = new Set(Object.values(assign).flat());
  const rowsFor = (lane: string) => (assign[lane] ?? []).map((id) => byId.get(id)).filter((u): u is Unit => !!u)
    .flatMap((u) => [{ unit: u, depth: 0 }, ...(isRoot(u) ? live.filter((k) => k.home === u.id && !placed.has(k.id)).map((k) => ({ unit: k, depth: 1 })) : [])]);

  useEffect(() => { editor._tiptapEditor.registerPlugin(noSpellcheckInCode()); }, [editor]);

  // Load the stored markdown, with a section for every level of the outline; re-lay it when the outline changes.
  // A new editor (first open, or one recreated) always loads from the stored draft, never from its own empty page.
  const loadedInto = useRef<typeof editor | null>(null);
  const loading = useRef(false);
  useEffect(() => {
    const fresh = loadedInto.current !== editor;
    loadedInto.current = editor;
    const stored = normalizeMarkers(saved.current);
    const current = fresh ? stored : blocksToMarkdown(editor, editor.document);
    const next = ensureSections(current, laneIds);
    if (!fresh && next === current) return;
    loading.current = true;
    editor.replaceBlocks(editor.document, markdownToBlocks(editor, next));
    loading.current = false;
    // Opening the draft is not an edit: its markdown comes back in BlockNote's spelling (`*` bullets), and that alone
    // is not saved. New sections for the outline are.
    if (fresh && next === stored) saved.current = blocksToMarkdown(editor, editor.document);
    else onChange();
    if (fresh) {
      // Start writing in the first section.
      const doc = editor.document, first = doc.findIndex((b) => b.type === 'section');
      const at = doc[first + 1] ?? doc[doc.length - 1];
      if (at) { editor.setTextCursorPosition(at, 'end'); editor.focus(); }
    }
  }, [editor, laneIds]);

  const flush = () => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    api.saveDraft(saved.current);
  };
  useEffect(() => () => { if (saveTimer.current !== undefined) flush(); }, []);
  function onChange() {
    if (loading.current) return;
    const md = blocksToMarkdown(editor, editor.document);
    if (md === saved.current) return;
    saved.current = md;
    onDraft(md);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flush, 1500);
  }

  /* Align the columns: each outline section sits level with its divider; the shorter side of a section gets a spacer. */
  const measure = () => {
    const col = colRef.current, page = pageRef.current; if (!col || !page) return;
    const colTop = col.getBoundingClientRect().top;
    const els = [...page.querySelectorAll<HTMLElement>('.draft-section[data-lane]')];
    const m = els.map((el) => {
      const lane = el.dataset.lane!;
      const top = el.getBoundingClientRect().top - colTop;
      return { lane, top, y: top + (spacers[lane] ?? 0), outH: sectionEls.current.get(lane)?.scrollHeight ?? 0 };
    });
    const end = (page.querySelector('.bn-editor')?.getBoundingClientRect().bottom ?? colTop) - colTop;
    const next: Record<string, number> = {};
    for (let i = 1; i < m.length; i++) next[m[i].lane] = Math.max(0, Math.ceil(m[i - 1].outH + 16 - (m[i].top - m[i - 1].y)));
    if (m.some((r) => Math.abs((next[r.lane] ?? 0) - (spacers[r.lane] ?? 0)) > 1)) setSpacers(next);
    setRows((old) => (old.length === m.length && old.every((r, i) => r.lane === m[i].lane && Math.abs(r.y - m[i].y) < 1) ? old : m.map(({ lane, y }) => ({ lane, y }))));
    const last = m[m.length - 1];
    setColH(Math.max(end, last ? last.y + last.outH + 40 : 0));
  };
  useEffect(() => { const t = window.setTimeout(measure, 0); return () => window.clearTimeout(t); });
  useEffect(() => {
    const ro = new ResizeObserver(() => measure());
    if (pageRef.current) ro.observe(pageRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spacers]);

  const insertChip = (id: string) => {
    editor.insertInlineContent([{ type: 'idea', props: { id } }, ' ']);
    editor.focus();
  };
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });


  /* Ideas in the outline drag, as on the CodeMirror page: within or between sections to reorder, or into the text. */
  const laneOf = (u: Unit): string | null => {
    for (const [lane, ids] of Object.entries(assign)) if (ids.includes(u.id)) return lane;
    return u.home && byId.has(u.home) ? laneOf(byId.get(u.home)!) : null;
  };
  /** Move an idea into a section, before `beforeId` (or at the end). Within its own section this reorders it. */
  const move = (id: string, to: string, beforeId: string | null) => {
    const u = byId.get(id);
    if (!u || !laneById.has(to) || beforeId === id) return;
    if (laneOf(u) === to && beforeId === null && (assign[to] ?? []).at(-1) === id) return;
    const next: Record<string, string[]> = Object.fromEntries(Object.entries(assign).map(([k, v]) => [k, v.filter((x) => x !== id)]));
    const list = next[to] ?? [];
    const at = beforeId ? list.indexOf(beforeId) : -1;
    next[to] = at < 0 ? [...list, id] : [...list.slice(0, at), id, ...list.slice(at)];
    onBoard({ ...board, lanes: { ...board.lanes, [board.structure]: next } });
  };
  const [dropAt, setDropAt] = useState<{ lane: string; before: string | null; y: number } | null>(null);
  useEffect(() => {
    const clear = () => setDropAt(null);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);
  /** Where in a section a drop lands: before the first top-level idea below the pointer, shown by a line. */
  const dropTarget = (lane: string, clientY: number) => {
    const el = sectionEls.current.get(lane); if (!el) return null;
    const top = el.getBoundingClientRect().top;
    const heads = [...el.querySelectorAll<HTMLElement>(':scope > .cue.depth-0')];
    const hit = heads.find((h) => { const r = h.getBoundingClientRect(); return clientY < r.top + r.height / 2; });
    const y = hit ? hit.getBoundingClientRect().top - top - 2
      : heads.length ? heads[heads.length - 1].getBoundingClientRect().bottom - top + 2 : (el.querySelector('h3')?.getBoundingClientRect().bottom ?? top) - top + 4;
    return { lane, before: hit?.dataset.id ?? null, y };
  };
  const dragOver = (lane: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-unit')) return;
    e.preventDefault();
    const t = dropTarget(lane, e.clientY);
    setDropAt((d) => (t && (d?.lane !== t.lane || d.before !== t.before || Math.abs(d.y - t.y) > 1) ? t : d));
  };
  const drop = (lane: string) => (e: React.DragEvent) => {
    const id = e.dataTransfer.getData('application/x-unit');
    const t = dropTarget(lane, e.clientY);
    setDropAt(null);
    if (id) { e.preventDefault(); move(id, lane, t?.before ?? null); }
  };
  // Dropped on the page, an idea goes in as a chip where it lands.
  useEffect(() => {
    const el = pageRef.current; if (!el) return;
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('application/x-unit')) e.preventDefault(); };
    const dropped = (e: DragEvent) => {
      const id = e.dataTransfer?.getData('application/x-unit'); if (!id) return;
      e.preventDefault(); e.stopPropagation();
      const view = editor._tiptapEditor.view;
      const pos = view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos;
      if (pos === undefined) return;
      editor._tiptapEditor.chain().focus().insertContentAt(pos, [{ type: 'idea', attrs: { id } }, { type: 'text', text: ' ' }]).run();
    };
    el.addEventListener('dragover', over, true);
    el.addEventListener('drop', dropped, true);
    return () => { el.removeEventListener('dragover', over, true); el.removeEventListener('drop', dropped, true); };
  }, [editor]);
  /** A click opens or closes an idea; only a press held for a moment and then moved drags it. */
  const pressedAt = useRef(0);
  const HOLD_MS = 180;

  return (
    <div className="draft-rows">
      <style>{Object.entries(spacers).map(([lane, px]) => `.draft-blocks .draft-section[data-lane="${lane}"] { padding-top: ${px}px; }`).join('\n')}</style>
      <div className="draft-grid">
        <div className="cue-col" ref={colRef} style={{ height: colH || undefined }}>
          {rows.map((r) => (
            <section key={r.lane} className="cue-block" style={{ top: r.y }} onDragOver={dragOver(r.lane)} onDrop={drop(r.lane)}
              ref={(el) => { if (el) sectionEls.current.set(r.lane, el); else sectionEls.current.delete(r.lane); }}>
              {dropAt?.lane === r.lane && <div className="cue-drop-line" style={{ top: dropAt.y }} />}
              <h3>{laneById.get(r.lane)?.name ?? r.lane}</h3>
              {rowsFor(r.lane).map(({ unit: u, depth }) => (
                <div key={u.id} data-id={u.id} className={`cue depth-${depth}`} draggable
                  onPointerDown={() => { pressedAt.current = Date.now(); }}
                  onDragStart={(e) => {
                    if (Date.now() - pressedAt.current < HOLD_MS) { e.preventDefault(); return; }
                    e.dataTransfer.setData('application/x-unit', u.id);
                    e.dataTransfer.effectAllowed = 'copyMove';
                  }}>
                  <div className="cue-line" onClick={() => { if (!open.has(u.id)) onSelect(u.id); toggle(u.id); }}>
                    <button className="disclose" aria-label="Show original">{open.has(u.id) ? '▾' : '▸'}</button>
                    {!(u.type === 'claim' && isRoot(u)) && <em style={{ color: TYPE_INK[u.type] }}>{u.type}</em>}
                    <span className={`cue-label ${isRoot(u) ? 'is-claim' : ''}`} onDoubleClick={() => insertChip(u.id)}>{u.label}</span>
                  </div>
                  {open.has(u.id) && <p className="cue-text">{u.text}</p>}
                </div>
              ))}
            </section>
          ))}
        </div>
        <div className="page draft-blocks" ref={pageRef}>
          <ChipLabels.Provider value={labels}>
            <BlockNoteView editor={editor} slashMenu={false} sideMenu={false} theme="light" onChange={onChange}>
              <SideMenuController sideMenu={ScratchSideMenu} />
              <SuggestionMenuController triggerCharacter="/" getItems={(query) => slashItems(editor, query)} />
            </BlockNoteView>
          </ChipLabels.Provider>
        </div>
      </div>
    </div>
  );
}
