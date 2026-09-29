import { useEffect, useMemo, useRef, useState } from 'react';
import { SideMenuController, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { en } from '@blocknote/core/locales';
import { Plugin } from '@tiptap/pm/state';
import { undoDepth } from '@tiptap/pm/history';
import type { EditorView } from '@tiptap/pm/view';
import type { Unit } from '../shared/types.ts';
import { isRoot } from '../shared/clusters.ts';
import { toMarkdown } from '../shared/export.ts';
import { ensureSections, normalizeMarkers } from '../shared/markers.ts';
import { STRUCTURES, type Board, type StructureDef } from '../shared/structures.ts';
import { api } from './api.ts';
import { ChipLabels, noSpellcheckInCode, schema, ScratchSideMenu, slashItems, type ScratchEditor } from './blocks.tsx';
import { blocksToMarkdown, joinSections, markdownToBlocks, splitSections, type Part } from './draftBlocks.ts';
import { TYPE_INK } from './typeStyle.ts';

/**
 * Proof of concept: the Draft page on BlockNote, the editor the idea sheet uses, opened with ?editor=blocks.
 *
 * Each section of the outline is its own small editor, in a row beside that section of the outline. Sections are
 * page layout, not content: nothing typed can delete or merge them, and each row is as tall as its taller side, so
 * the two columns line up without measuring. What one editor would give for free is added across the sections:
 * the arrow keys cross from one to the next, undo and redo run through one shared history, and a second Cmd+A
 * selects the whole draft (to copy it or clear it).
 *
 * Drafts are stored as the same markdown as the CodeMirror page, so the server, history and export are unchanged.
 * Not here yet: ideas moving to the section their chip lands in, and suggestions.
 */

// No hint on every empty line: a blank draft gets one, on its first line (see .draft-sections.blank).
const dictionary = { ...en, placeholders: { ...en.placeholders, default: '' } };

/* ---------- one section ---------- */

/** Where a section's text starts and ends: its first and last text blocks. */
function textBounds(view: EditorView) {
  const blocks: { from: number; to: number }[] = [];
  view.state.doc.descendants((n, pos) => {
    if (n.isTextblock) blocks.push({ from: pos + 1, to: pos + 1 + n.content.size });
    return true;
  });
  return { first: blocks[0] ?? { from: 0, to: 0 }, last: blocks[blocks.length - 1] ?? { from: 0, to: 0 } };
}

/** Arrow keys at a section's first or last line carry on into the neighbouring section. */
const crossSections = (leave: (dir: -1 | 1) => void) => new Plugin({
  props: {
    handleKeyDown(view, e) {
      if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || !view.state.selection.empty) return false;
      // An open menu (the / menu, emoji) takes the arrow keys.
      if (document.querySelector('.bn-suggestion-menu, .bn-grid-suggestion-menu')) return false;
      const { first, last } = textBounds(view);
      const head = view.state.selection.head;
      const down = (e.key === 'ArrowDown' && head >= last.from && view.endOfTextblock('down')) || (e.key === 'ArrowRight' && head === last.to);
      const up = (e.key === 'ArrowUp' && head <= first.to && view.endOfTextblock('up')) || (e.key === 'ArrowLeft' && head === first.from);
      if (!down && !up) return false;
      e.preventDefault();
      leave(down ? 1 : -1);
      return true;
    },
  },
});

type SectionProps = {
  lane: string;
  initial: string;
  register: (lane: string, editor: ScratchEditor | null) => void;
  onEdit: (lane: string) => void;
  onFocus: (lane: string) => void;
  onLeave: (lane: string, dir: -1 | 1) => void;
};

function SectionEditor({ lane, initial, register, onEdit, onFocus, onLeave }: SectionProps) {
  const editor = useCreateBlockNote({ schema, uploadFile: (file: File) => api.upload(file), dictionary });
  const loading = useRef(true);
  const leave = useRef((dir: -1 | 1) => onLeave(lane, dir));
  leave.current = (dir) => onLeave(lane, dir);

  useEffect(() => {
    const tt = editor._tiptapEditor;
    tt.registerPlugin(noSpellcheckInCode());
    // First in line: BlockNote's own key handlers would otherwise take the arrow keys at a section's edge.
    tt.registerPlugin(crossSections((dir) => leave.current(dir)), (plugin, plugins) => [plugin, ...plugins]);
    // Loading is not an edit: it stays out of undo, so Cmd+Z never empties a section back to blank.
    loading.current = true;
    editor.transact((tr) => {
      tr.setMeta('addToHistory', false);
      editor.replaceBlocks(editor.document, markdownToBlocks(editor, initial));
    });
    loading.current = false;
    register(lane, editor);
    return () => register(lane, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // An idea dragged from the outline goes in as a chip where it is dropped.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('application/x-unit')) e.preventDefault(); };
    const dropped = (e: DragEvent) => {
      const id = e.dataTransfer?.getData('application/x-unit'); if (!id) return;
      e.preventDefault(); e.stopPropagation();
      const tt = editor._tiptapEditor;
      const pos = tt.view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos ?? textBounds(tt.view).last.to;
      tt.chain().focus().insertContentAt(pos, [{ type: 'idea', attrs: { id } }, { type: 'text', text: ' ' }]).run();
    };
    el.addEventListener('dragover', over, true);
    el.addEventListener('drop', dropped, true);
    return () => { el.removeEventListener('dragover', over, true); el.removeEventListener('drop', dropped, true); };
  }, [editor]);

  return (
    <div className="section-editor" ref={box} onFocus={() => onFocus(lane)}
      onMouseDown={(e) => {
        // The empty space under a section's text is still that section: a click there puts the cursor at the end.
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        editor.setTextCursorPosition(editor.document[editor.document.length - 1], 'end');
        editor.focus();
      }}>
      <BlockNoteView editor={editor} slashMenu={false} sideMenu={false} theme="light"
        onChange={() => { if (!loading.current) onEdit(lane); }}>
        <SideMenuController sideMenu={ScratchSideMenu} />
        <SuggestionMenuController triggerCharacter="/" getItems={(query) => slashItems(editor, query)} />
      </BlockNoteView>
    </div>
  );
}

/* ---------- the page ---------- */

type Props = {
  units: Unit[];
  board: Board;
  draft: string;
  onDraft: (t: string) => void;
  onSelect: (id: string) => void;
  onBoard: (b: Board) => void;
  structures: Record<string, StructureDef>;
};

/** One undo step: the sections it changed (a block dragged between sections changes two at once). */
type Step = { lanes: string[]; at: number };

export function DraftBlocks({ units, board, draft, onDraft, onSelect, onBoard, structures }: Props) {
  const lanes = (structures[board.structure] ?? STRUCTURES.persuasive).lanes;
  const laneIds = useMemo(() => lanes.map((l) => l.id), [lanes]);
  const laneById = useMemo(() => new Map(lanes.map((l) => [l.id, l])), [lanes]);
  /** A section left from another outline, with writing in it, keeps its name from that outline. */
  const laneName = (id: string) => laneById.get(id)?.name
    ?? Object.values(structures).flatMap((s) => s.lanes).find((l) => l.id === id)?.name ?? id;

  const editors = useRef(new Map<string, ScratchEditor>());
  const saved = useRef(normalizeMarkers(draft));
  const saveTimer = useRef<number | undefined>(undefined);
  const [parts, setParts] = useState<Part[]>(() => splitSections(ensureSections(saved.current, laneIds)));
  const [active, setActive] = useState<string | null>(null);
  const [blank, setBlank] = useState(true);
  const [allSelected, setAllSelected] = useState(false);

  /** The whole draft as stored markdown, from each section's editor. */
  const current = () => joinSections(parts.map((p) => {
    const ed = editors.current.get(p.lane);
    return { lane: p.lane, md: ed ? blocksToMarkdown(ed, ed.document) : p.md };
  }));
  const currentRef = useRef(current);
  currentRef.current = current;

  const flush = () => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    api.saveDraft(saved.current);
  };
  useEffect(() => () => { if (saveTimer.current !== undefined) flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => {
    const md = currentRef.current();
    setBlank(!md.replace(/<!--s:[a-z0-9-]+-->/g, '').trim());
    if (md === saved.current) return;
    saved.current = md;
    onDraft(md);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flush, 1500);
  };

  // Opening the draft is not an edit: its markdown comes back in BlockNote's spelling (`*` bullets), and that alone
  // is not saved. New sections for the outline are. Then the cursor starts in the first section.
  useEffect(() => {
    const stored = saved.current;
    if (ensureSections(stored, laneIds) === stored) saved.current = currentRef.current();
    save();
    const first = editors.current.get(parts[0]?.lane);
    if (first) { first.setTextCursorPosition(first.document[0], 'end'); first.focus(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The outline changed: its sections, in its order; a section from the old outline stays only if it has writing.
  const shownLanes = useRef(laneIds);
  useEffect(() => {
    if (shownLanes.current === laneIds) return;
    shownLanes.current = laneIds;
    setParts(splitSections(ensureSections(currentRef.current(), laneIds)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laneIds]);
  const shownParts = useRef(parts);
  useEffect(() => { if (shownParts.current !== parts) { shownParts.current = parts; save(); } }); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- one history across the sections ---------- */

  const depths = useRef(new Map<string, number>());
  const undone = useRef<Step[]>([]);
  const redoable = useRef<Step[]>([]);
  const replaying = useRef(false);
  const depthOf = (lane: string) => { const ed = editors.current.get(lane); return ed ? undoDepth(ed._tiptapEditor.state) : 0; };
  const register = (lane: string, ed: ScratchEditor | null) => {
    if (ed) { editors.current.set(lane, ed); depths.current.set(lane, depthOf(lane)); } else editors.current.delete(lane);
  };
  /** Add a step for `lane`, joining the last step if it was in another section within `within` ms. */
  const record = (lane: string, at: number, within: number) => {
    const last = undone.current[undone.current.length - 1];
    if (last && at - last.at <= within && !last.lanes.includes(lane)) last.lanes.push(lane);
    else undone.current.push({ lanes: [lane], at });
    redoable.current = [];
  };
  const onEdit = (lane: string) => {
    const depth = depthOf(lane), was = depths.current.get(lane) ?? 0;
    depths.current.set(lane, depth);
    // A section's own history groups a run of typing into one step; a new step there is a new step here. Steps in
    // two sections at the same moment (a block dragged from one to the other) are one step.
    if (!replaying.current && depth > was) record(lane, Date.now(), 80);
    save();
  };
  const replay = (from: { current: Step[] }, to: { current: Step[] }, act: (ed: ScratchEditor) => void) => {
    const step = from.current.pop(); if (!step) return;
    replaying.current = true;
    for (const lane of step.lanes) { const ed = editors.current.get(lane); if (ed) act(ed); depths.current.set(lane, depthOf(lane)); }
    replaying.current = false;
    to.current.push(step);
    editors.current.get(step.lanes[step.lanes.length - 1])?.focus();
    save();
  };

  /* ---------- moving between sections ---------- */

  const onLeave = (lane: string, dir: -1 | 1) => {
    const i = parts.findIndex((p) => p.lane === lane);
    const next = parts[i + dir]; if (!next) return;
    const ed = editors.current.get(next.lane); if (!ed) return;
    ed.setTextCursorPosition(ed.document[dir === 1 ? 0 : ed.document.length - 1], dir === 1 ? 'start' : 'end');
    ed.focus();
  };

  /* ---------- keys for the whole draft: undo, redo, select all ---------- */

  /** Empty every section (the dividers stay), as one undo step. */
  const clearAll = () => {
    const at = Date.now();
    replaying.current = true;
    for (const p of parts) {
      const ed = editors.current.get(p.lane);
      if (!ed || !blocksToMarkdown(ed, ed.document)) continue;
      ed.replaceBlocks(ed.document, [{ type: 'paragraph' }]);
      record(p.lane, at, 0);
      depths.current.set(p.lane, depthOf(p.lane));
    }
    replaying.current = false;
    save();
  };
  const pageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = pageRef.current; if (!el) return;
    const key = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
      if (mod && (k === 'z' || k === 'y')) {
        e.preventDefault(); e.stopPropagation();
        setAllSelected(false);
        if (k === 'y' || e.shiftKey) replay(redoable, undone, (ed) => ed.redo()); else replay(undone, redoable, (ed) => ed.undo());
        return;
      }
      if (mod && k === 'a') {
        // The first Cmd+A selects this section (the editor does that); the next selects the whole draft.
        const view = [...editors.current.values()].map((ed) => ed._tiptapEditor.view).find((v) => v.dom.contains(e.target as Node));
        const b = view && textBounds(view);
        if (allSelected || (view && b && view.state.selection.from <= b.first.from && view.state.selection.to >= b.last.to)) {
          e.preventDefault(); e.stopPropagation();
          setAllSelected(true);
        }
        return;
      }
      if (!allSelected) return;
      if (k === 'backspace' || k === 'delete') { e.preventDefault(); e.stopPropagation(); setAllSelected(false); clearAll(); return; }
      if (mod && (k === 'c' || k === 'x')) return; // the copy and cut events below take these
      if (['shift', 'meta', 'control', 'alt'].includes(k)) return;
      setAllSelected(false);
    };
    const copy = (e: ClipboardEvent) => {
      if (!allSelected) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', toMarkdown('', currentRef.current(), units).replace(/^# \n\n/, ''));
      if (e.type === 'cut') { setAllSelected(false); clearAll(); }
    };
    const click = () => setAllSelected(false);
    el.addEventListener('keydown', key, true);
    document.addEventListener('copy', copy, true);
    document.addEventListener('cut', copy, true);
    el.addEventListener('mousedown', click, true);
    return () => {
      el.removeEventListener('keydown', key, true);
      document.removeEventListener('copy', copy, true);
      document.removeEventListener('cut', copy, true);
      el.removeEventListener('mousedown', click, true);
    };
  });

  /* ---------- the outline beside each section ---------- */

  const live = useMemo(() => units.filter((u) => u.status !== 'cut'), [units]);
  const byId = useMemo(() => new Map(live.map((u) => [u.id, u])), [live]);
  const labels = useMemo(() => new Map(units.map((u) => [u.id, u.label])), [units]);
  const assign = board.lanes[board.structure] ?? {};
  const placed = new Set(Object.values(assign).flat());
  const rowsFor = (lane: string) => (assign[lane] ?? []).map((id) => byId.get(id)).filter((u): u is Unit => !!u)
    .flatMap((u) => [{ unit: u, depth: 0 }, ...(isRoot(u) ? live.filter((k) => k.home === u.id && !placed.has(k.id)).map((k) => ({ unit: k, depth: 1 })) : [])]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

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

  const cellEls = useRef(new Map<string, HTMLElement>());
  const [dropAt, setDropAt] = useState<{ lane: string; before: string | null; y: number } | null>(null);
  useEffect(() => {
    const clear = () => setDropAt(null);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);
  /** Where in a section a drop lands: before the first top-level idea below the pointer, shown by a line. */
  const dropTarget = (lane: string, clientY: number) => {
    const el = cellEls.current.get(lane); if (!el) return null;
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
  /** A click opens or closes an idea; only a press held for a moment and then moved drags it. */
  const pressedAt = useRef(0);
  const HOLD_MS = 180;

  const insertChip = (id: string) => {
    const ed = editors.current.get(active ?? parts[0]?.lane); if (!ed) return;
    ed.insertInlineContent([{ type: 'idea', props: { id } }, ' ']);
    ed.focus();
  };

  return (
    <div className="draft-rows">
      <div ref={pageRef} className={`draft-sections ${blank ? 'blank' : ''} ${allSelected ? 'all-selected' : ''}`}>
        <ChipLabels.Provider value={labels}>
          {parts.map((p) => (
            <div key={p.lane} className={`draft-row ${active === p.lane ? 'active' : ''}`}>
              <section className="cue-cell" onDragOver={dragOver(p.lane)} onDrop={drop(p.lane)}
                ref={(el) => { if (el) cellEls.current.set(p.lane, el); else cellEls.current.delete(p.lane); }}>
                {dropAt?.lane === p.lane && <div className="cue-drop-line" style={{ top: dropAt.y }} />}
                <h3 className={laneById.has(p.lane) ? '' : 'stray'}>{laneName(p.lane)}</h3>
                {rowsFor(p.lane).map(({ unit: u, depth }) => (
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
              <div className="page draft-blocks">
                <SectionEditor lane={p.lane} initial={p.md} register={register} onEdit={onEdit} onFocus={setActive} onLeave={onLeave} />
              </div>
            </div>
          ))}
          {/* The outline's column runs on to the bottom of the page. */}
          <div className="draft-row filler"><div className="cue-cell" /><div className="page" /></div>
        </ChipLabels.Provider>
      </div>
    </div>
  );
}
