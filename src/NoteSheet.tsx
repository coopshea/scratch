import { useEffect, useRef, useState } from 'react';
import { SideMenuController, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { en } from '@blocknote/core/locales';
import { UNTYPED, type Blurt, type SourceRef, type Unit } from '../shared/types.ts';
import { isRoot } from '../shared/clusters.ts';
import { api, type Passage } from './api.ts';
import { noBlockHints, noSpellcheckInCode, schema, ScratchSideMenu, slashItems } from './blocks.tsx';
import { Icon } from './icons.tsx';
import { NeedsReadwise, type ReadwiseOff } from './ReadwiseOff.tsx';
import { PassageRow, plain } from './Passage.tsx';
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
  /** Readwise connected: ⌘⇧E looks up related passages, and picking one files it under this idea's thread. */
  reading?: boolean;
  /** Readwise not connected: the lookup shows greyed, pointing to where to connect. */
  readwiseOff?: ReadwiseOff;
  onAdopt?: (id: string, home: string | null) => Promise<void>;
};

export function NoteSheet({ unit, units, blurts, onPatch, onClose, onFocus, readOnly = false, version = '', takeFocus = true, reading = false, readwiseOff = null, onAdopt }: Props) {
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

      {/* A Readwise idea's citation is its highlight below, linked; the check is only for the writer's own evidence. */}
      {!unit.source && (unit.type === 'evidence' || unit.type === 'artifact') && (
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

      {unit.origin !== 'source' && (
        <blockquote className={`original ${unit.flags?.notVerbatim ? 'reworded' : ''}`}
          title={blurt ? new Date(blurt.createdAt).toLocaleString() : undefined}>{unit.text}</blockquote>
      )}
      {unit.source && <Cited quote={unit.source.quote ?? unit.text} source={unit.source} />}

      {children.length > 0 && (
        <nav className="links">
          {children.map((c) => <button key={c.id} className="link" onClick={() => onFocus(c.id)}><em>{c.type ?? UNTYPED}</em> {c.label}</button>)}
        </nav>
      )}
      {sameLabel.length > 0 && (
        <nav className="links">
          {sameLabel.map((c) => <button key={c.id} className="link" onClick={() => onFocus(c.id)}>↔ {c.text.slice(0, 48)}…</button>)}
        </nav>
      )}

      {reading && onAdopt && !unit.source && (readwiseOff
        ? <div className="reading"><NeedsReadwise off={readwiseOff}><span className="link muted"><Icon name="book" small />from your reading</span></NeedsReadwise></div>
        : <Reading unit={unit} onAdopt={onAdopt} />)}

      <div className="note">
        <NoteEditor key={unit.id + version} unit={unit} readOnly={readOnly} takeFocus={takeFocus} onSave={(note) => onPatch(unit.id, { note })} />
      </div>
      </div>
    </aside>
  );
}

/** Where a passage lives: the article when Readwise knows it, else the highlight in Readwise. */
const sourceHref = (s: SourceRef) => s.url || `https://readwise.io/open/${s.id}`;

/** Someone else's words: set apart as a highlight, with where they're from. Never styled like the writer's own. */
function Cited({ quote, source }: { quote: string; source: SourceRef }) {
  return (
    <figure className="cited">
      <blockquote><mark>{plain(quote)}</mark></blockquote>
      <figcaption>
        <a href={sourceHref(source)} target="_blank" rel="noreferrer">{source.title || 'Readwise'}</a>
        {source.author && <> · {source.author}</>}
      </figcaption>
    </figure>
  );
}

// Search sparingly: one lookup per idea per visit, kept while the page is open.
const found = new Map<string, Passage[]>();
const SHOWN = 5;

/**
 * Related passages from the writer's own reading, looked up on ⌘⇧E (or the link). Keys 1–5 file one as evidence
 * under this idea's thread; Escape closes the list and returns to the note. Nothing is looked up until asked.
 */
function Reading({ unit, onAdopt }: { unit: Unit; onAdopt: (id: string, home: string | null) => Promise<void> }) {
  const [passages, setPassages] = useState<Passage[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const back = useRef<Element | null>(null);
  useEffect(() => { setPassages(null); setError(null); }, [unit.id]);

  const look = async () => {
    back.current = document.activeElement;
    const cached = found.get(unit.id);
    if (cached) { setPassages(cached); return; }
    setLooking(true); setError(null);
    try {
      const res = await api.readwise.search(`${unit.label}. ${unit.text.slice(0, 300)}`);
      found.set(unit.id, res.passages);
      setPassages(res.passages);
    } catch (e) { setError((e as Error).message); }
    finally { setLooking(false); }
  };
  useEffect(() => { if (passages) list.current?.focus(); }, [passages]);
  const close = () => { setPassages(null); (back.current as HTMLElement | null)?.focus?.(); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); look(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const adopt = (p: Passage) => {
    const left = (found.get(unit.id) ?? []).filter((x) => x.id !== p.id);
    found.set(unit.id, left);
    setPassages(left);
    // Filed under the thread: the idea itself when it is a root, else the root it belongs to.
    onAdopt(p.id, isRoot(unit) ? unit.id : unit.home);
  };

  const shown = passages?.slice(0, SHOWN) ?? [];
  return (
    <div className="reading">
      {!passages && (
        <button className="link muted" onClick={look} disabled={looking}>
          <Icon name="book" small />{looking ? 'looking…' : 'from your reading'}<kbd className="kbd">⌘⇧E</kbd>
        </button>
      )}
      {error && <p className="error">{error}</p>}
      {passages && (
        <div className="reading-list" ref={list} tabIndex={-1} aria-label="From your reading"
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
            const n = Number(e.key);
            if (n >= 1 && n <= shown.length) { e.preventDefault(); adopt(shown[n - 1]); }
          }}>
          {!shown.length && <p className="hint">Nothing new in your reading.</p>}
          {shown.map((p, i) => <PassageRow key={p.id} p={p} n={i + 1} onPick={() => adopt(p)} />)}
          <button className="link muted" onClick={close}>done</button>
        </div>
      )}
    </div>
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
