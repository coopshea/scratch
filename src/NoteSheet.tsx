import { useEffect, useRef } from 'react';
import { filterSuggestionItems } from '@blocknote/core';
import { getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { en } from '@blocknote/core/locales';
import type { Blurt, Unit } from '../shared/types.ts';
import { isRoot } from '../shared/clusters.ts';
import { api } from './api.ts';
import { Icon } from './icons.tsx';
import { LabelInput } from './LabelInput.tsx';
import { HomeSelect, TypeSelect } from './TypeSelect.tsx';

// An empty note says it can be written in; an empty line in a longer note only mentions the slash commands.
const dictionary = {
  ...en,
  placeholders: { ...en.placeholders, default: 'Use / for key commands.', emptyDocument: 'Type additional context here, and use / for key commands.' },
};

function NoteEditor({ unit, onSave, readOnly, takeFocus }: { unit: Unit; onSave: (doc: unknown[]) => void; readOnly: boolean; takeFocus: boolean }) {
  const editor = useCreateBlockNote({
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
  return (
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
      <SuggestionMenuController triggerCharacter="/"
        getItems={async (query) => filterSuggestionItems([...getDefaultReactSlashMenuItems(editor), gapItem(editor)], query)} />
    </BlockNoteView>
  );
}

/** Scratch's own slash item: a gap, `[ ]`, for something to find out later, with the cursor inside it. */
function gapItem(editor: ReturnType<typeof useCreateBlockNote>) {
  return {
    title: 'Gap',
    subtext: 'Something to find out later',
    aliases: ['gap', 'todo', 'later', 'bracket'],
    group: 'Scratch',
    icon: <span className="slash-glyph">[ ]</span>,
    onItemClick: () => {
      editor.insertInlineContent(['[]']);
      const tt = editor._tiptapEditor;
      tt.commands.setTextSelection(tt.state.selection.from - 1);
    },
  };
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

  return (
    <aside className={`sheet ${readOnly ? 'read-only' : ''}`} onKeyDown={(e) => { if (e.key === 'Escape' && (e.target as HTMLElement).tagName !== 'INPUT') onClose(); }}>
      <header className="sheet-head">
        <TypeSelect value={unit.type} onChange={(type) => onPatch(unit.id, { type })} />
        <span className="spacer" />
        {!readOnly && <button className="link muted" onClick={() => onPatch(unit.id, { status: 'cut' })}>cut</button>}
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
    </aside>
  );
}
