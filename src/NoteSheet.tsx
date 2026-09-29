import { useEffect, useRef, useState } from 'react';
import { SideMenuController, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { en } from '@blocknote/core/locales';
import type { Blurt, Unit } from '../shared/types.ts';
import { isRoot } from '../shared/clusters.ts';
import { api } from './api.ts';
import { noBlockHints, noSpellcheckInCode, schema, ScratchSideMenu, slashItems } from './blocks.tsx';
import { Icon } from './icons.tsx';
import { LabelInput } from './LabelInput.tsx';
import { HomeSelect, TypeSelect } from './TypeSelect.tsx';

// An empty note says it can be written in; an empty line in a longer note only mentions the slash commands.
const dictionary = {
  ...en,
  placeholders: { ...en.placeholders, ...noBlockHints, default: 'Use / for key commands.', emptyDocument: 'Type additional context here, and use / for key commands.' },
};

function NoteEditor({ unit, onSave, readOnly, takeFocus }: { unit: Unit; onSave: (doc: unknown[]) => void; readOnly: boolean; takeFocus: boolean }) {
  const editor = useCreateBlockNote({
    schema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialContent: unit.note && unit.note.length ? (unit.note as any) : undefined,
    uploadFile: (file: File) => api.upload(file),
    dictionary,
  });
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // Open with a blinking cursor at the end, so dictation lands in the note immediately (not while drafting: the
  // writer keeps writing in the page with the note open beside it).
  useEffect(() => {
    if (readOnly || !takeFocus) return;
    const id = window.setTimeout(() => {
      const doc = editor.document;
      editor.setTextCursorPosition(doc[doc.length - 1], 'end');
      editor.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [editor, readOnly]);
  // Code is not prose: no spelling underlines in code blocks.
  useEffect(() => { editor._tiptapEditor.registerPlugin(noSpellcheckInCode()); }, [editor]);
  return (
    <div className="note-box" onMouseDown={(e) => {
      // Below the last line is still the note: a click there puts the cursor at the end.
      if (readOnly || e.target !== e.currentTarget) return; // only the empty space below: the drag handle and menus sit outside the text
      e.preventDefault();
      const doc = editor.document;
      editor.setTextCursorPosition(doc[doc.length - 1], 'end');
      editor.focus();
    }}>
    <BlockNoteView
      editor={editor}
      editable={!readOnly}
      slashMenu={false}
      sideMenu={false}
      theme="light"
      onChange={() => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => onSave(editor.document as unknown[]), 700);
      }}
    >
      <SideMenuController sideMenu={ScratchSideMenu} />
      <SuggestionMenuController triggerCharacter="/"
        getItems={(query) => slashItems(editor, query)} />
    </BlockNoteView>
    </div>
  );
}

type Props = {
  unit: Unit;
  units: Unit[];
  blurts: Blurt[];
  onPatch: (id: string, patch: Partial<Unit>) => void;
  onClose: () => void;
  onFocus: (id: string) => void;
  readOnly?: boolean;
  version?: string;
  /** Put the cursor in the note on open. Off in Draft, where the writer keeps writing in the page. */
  takeFocus?: boolean;
};

export function NoteSheet({ unit, units, blurts, onPatch, onClose, onFocus, readOnly = false, version = '', takeFocus = true }: Props) {
  const roots = units.filter((u) => isRoot(u) && u.status !== 'cut' && u.id !== unit.id);
  const blurt = blurts.find((b) => b.id === unit.blurtId);
  const children = units.filter((u) => u.home === unit.id && u.status !== 'cut');
  const sameLabel = units.filter((u) => u.id !== unit.id && u.status !== 'cut' && u.label === unit.label);

  // Cutting asks twice, like deleting a document: "cut" turns into "cut?" for a few seconds. It sits beside close.
  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef<number | undefined>(undefined);
  useEffect(() => { setConfirming(false); window.clearTimeout(confirmTimer.current); }, [unit.id]);
  useEffect(() => () => window.clearTimeout(confirmTimer.current), []);
  const askCut = () => {
    window.clearTimeout(confirmTimer.current);
    if (!confirming) { setConfirming(true); confirmTimer.current = window.setTimeout(() => setConfirming(false), 3000); return; }
    setConfirming(false);
    onPatch(unit.id, { status: 'cut' });
  };

  return (
    <aside className={`sheet ${readOnly ? 'read-only' : ''}`} onKeyDown={(e) => { if (e.key === 'Escape' && (e.target as HTMLElement).tagName !== 'INPUT') onClose(); }}>
      <ResizeEdge />
      <div className="sheet-scroll">
      <header className="sheet-head">
        <TypeSelect value={unit.type} onChange={(type) => onPatch(unit.id, { type })} />
        <span className="spacer" />
        {!readOnly && (
          <button className={`link ${confirming ? 'confirm' : 'muted'}`} onClick={askCut} aria-label={confirming ? 'Confirm cut' : 'Cut this idea'}>
            {confirming ? 'cut?' : 'cut'}
          </button>
        )}
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </header>

      <LabelInput value={unit.label} onSave={(label) => onPatch(unit.id, { label })} />

      {!children.length && (
        <label className="field">
          <span>under</span>
          <HomeSelect value={unit.home} claims={roots} onChange={(home) => onPatch(unit.id, { home })} />
        </label>
      )}

      {(unit.type === 'evidence' || unit.type === 'artifact') && (
        <label className="field">
          <span>source</span>
          <button className={`link ${unit.verified ? '' : 'muted'}`} onClick={() => onPatch(unit.id, { verified: !unit.verified })}>
            {unit.verified ? '✓ checked' : 'not checked'}
          </button>
        </label>
      )}

      {unit.type === 'coinage' && (
        <label className="field">
          <span>prior art</span>
          <input defaultValue={unit.priorArt ?? ''} placeholder="Who else has used this term?"
            onBlur={(e) => { if (e.target.value !== (unit.priorArt ?? '')) onPatch(unit.id, { priorArt: e.target.value }); }} />
        </label>
      )}

      <blockquote className={`original ${unit.flags?.notVerbatim ? 'reworded' : ''}`}
        title={blurt ? new Date(blurt.createdAt).toLocaleString() : undefined}>{unit.text}</blockquote>

      {children.length > 0 && (
        <nav className="links">
          {children.map((c) => <button key={c.id} className="link" onClick={() => onFocus(c.id)}><em>{c.type}</em> {c.label}</button>)}
        </nav>
      )}
      {sameLabel.length > 0 && (
        <nav className="links">
          {sameLabel.map((c) => <button key={c.id} className="link" onClick={() => onFocus(c.id)}>↔ {c.text.slice(0, 48)}…</button>)}
        </nav>
      )}

      <div className="note">
        <NoteEditor key={unit.id + version} unit={unit} readOnly={readOnly} takeFocus={takeFocus} onSave={(note) => onPatch(unit.id, { note })} />
      </div>
      </div>
    </aside>
  );
}

const SHEET_KEY = 'sheet-width';
const clampWidth = (w: number) => Math.round(Math.min(Math.max(w, 320), Math.max(320, window.innerWidth * 0.6)));
const setWidth = (w: number) => document.documentElement.style.setProperty('--sheet-w', `${w}px`);
try { const saved = Number(localStorage.getItem(SHEET_KEY)); if (saved) setWidth(clampWidth(saved)); } catch { /* storage unavailable */ }

/** The sheet's left edge: drag it to make the sheet wider or narrower (320px to 60% of the window). */
function ResizeEdge() {
  const [dragging, setDragging] = useState(false);
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget, right = handle.parentElement!.getBoundingClientRect().right;
    handle.setPointerCapture(e.pointerId);
    setDragging(true);
    let w = right - e.clientX;
    const move = (ev: PointerEvent) => { w = clampWidth(right - ev.clientX); setWidth(w); };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      setDragging(false);
      try { localStorage.setItem(SHEET_KEY, String(w)); } catch { /* storage unavailable */ }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end, { once: true });
    handle.addEventListener('pointercancel', end, { once: true });
  };
  return <div className={`sheet-resize ${dragging ? 'dragging' : ''}`} onPointerDown={start} role="separator" aria-orientation="vertical" aria-label="Resize" />;
}
