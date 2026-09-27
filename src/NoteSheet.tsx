import { useEffect, useRef } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { en } from '@blocknote/core/locales';
import type { Blurt, Unit } from '../shared/types.ts';
import { api } from './api.ts';
import { LabelInput } from './LabelInput.tsx';
import { HomeSelect, TypeSelect } from './TypeSelect.tsx';

const dictionary = { ...en, placeholders: { ...en.placeholders, default: '', emptyDocument: '' } };

function NoteEditor({ unit, onSave, readOnly }: { unit: Unit; onSave: (doc: unknown[]) => void; readOnly: boolean }) {
  const editor = useCreateBlockNote({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialContent: unit.note && unit.note.length ? (unit.note as any) : undefined,
    uploadFile: (file: File) => api.upload(file),
    dictionary,
  });
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // Open with a blinking cursor at the end, so dictation lands in the note immediately.
  useEffect(() => {
    if (readOnly) return;
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
      theme="light"
      onChange={() => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => onSave(editor.document as unknown[]), 700);
      }}
    />
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
};

export function NoteSheet({ unit, units, blurts, onPatch, onClose, onFocus, readOnly = false, version = '' }: Props) {
  const claims = units.filter((u) => u.type === 'claim' && u.status !== 'cut' && u.id !== unit.id);
  const blurt = blurts.find((b) => b.id === unit.blurtId);
  const children = units.filter((u) => u.home === unit.id && u.status !== 'cut');
  const sameLabel = units.filter((u) => u.id !== unit.id && u.status !== 'cut' && u.label === unit.label);

  return (
    <aside className={`sheet ${readOnly ? 'read-only' : ''}`} onKeyDown={(e) => { if (e.key === 'Escape' && (e.target as HTMLElement).tagName !== 'INPUT') onClose(); }}>
      <header className="sheet-head">
        <TypeSelect value={unit.type} onChange={(type) => onPatch(unit.id, { type })} />
        <span className="spacer" />
        {!readOnly && unit.status === 'proposed' && <button className="link" onClick={() => onPatch(unit.id, { status: 'accepted' })}>keep</button>}
        {!readOnly && <button className="link muted" onClick={() => onPatch(unit.id, { status: 'cut' })}>cut</button>}
        <button className="link muted" onClick={onClose} aria-label="Close">✕</button>
      </header>

      <LabelInput value={unit.label} onSave={(label) => onPatch(unit.id, { label })} />

      {unit.type !== 'claim' && (
        <label className="field">
          <span>under</span>
          <HomeSelect value={unit.home} claims={claims} onChange={(home) => onPatch(unit.id, { home })} />
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
          <input defaultValue={unit.priorArt ?? ''}
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
        <NoteEditor key={unit.id + version} unit={unit} readOnly={readOnly} onSave={(note) => onPatch(unit.id, { note })} />
      </div>
    </aside>
  );
}
