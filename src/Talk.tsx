import { useEffect, useRef, useState } from 'react';
import type { Blurt, Unit } from '../shared/types.ts';
import { LabelInput } from './LabelInput.tsx';
import { HomeSelect, TypeSelect } from './TypeSelect.tsx';

type Props = {
  units: Unit[];
  blurts: Blurt[];
  busy: boolean;
  error: string | null;
  failedBlurtId: string | null;
  onBlurt: (text: string) => Promise<boolean>;
  onReparse: (id: string) => void;
  onPatch: (id: string, patch: Partial<Unit>) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  sheetOpen: boolean;
};

export function Talk({ units, blurts, busy, error, failedBlurtId, onBlurt, onReparse, onPatch, onSelect, selectedId, sheetOpen }: Props) {
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  // The blurt page always holds the cursor unless a note is open.
  useEffect(() => { if (!busy && !sheetOpen) box.current?.focus(); }, [busy, sheetOpen]);
  const toReview = units.filter((u) => u.status === 'proposed');
  const claims = units.filter((u) => u.type === 'claim' && u.status !== 'cut');
  const parsedIds = new Set(units.map((u) => u.blurtId));
  const unparsed = blurts.filter((b) => !parsedIds.has(b.id) && b.id !== failedBlurtId);

  const submit = async () => {
    if (!text.trim() || busy) return;
    if (await onBlurt(text)) setText('');
  };

  return (
    <div className="talk">
      <textarea
        ref={box}
        className="blurt"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
        disabled={busy}
        autoFocus
        spellCheck
      />
      <div className="blurt-bar">
        <button className="link" onClick={submit} disabled={busy || !text.trim()}>{busy ? 'parsing…' : 'parse ⌘↵'}</button>
      </div>

      {error && (
        <p className="error">
          {error}
          {failedBlurtId && <button className="link" onClick={() => onReparse(failedBlurtId)} disabled={busy}>retry</button>}
        </p>
      )}

      {unparsed.map((b) => (
        <div key={b.id} className="unparsed">
          <span>{b.text.slice(0, 80)}{b.text.length > 80 ? '…' : ''}</span>
          <button className="link" onClick={() => onReparse(b.id)} disabled={busy}>parse</button>
        </div>
      ))}

      {toReview.length > 0 && (
        <section className="review">
          <div className="rule"><span>{toReview.length} new</span><button className="link" onClick={() => toReview.forEach((u) => onPatch(u.id, { status: 'accepted' }))}>accept all</button></div>
          {toReview.map((u) => (
            <article key={u.id} className={`entry ${u.id === selectedId ? 'on' : ''}`} onClick={() => onSelect(u.id)}>
              <div className="entry-head" onClick={(e) => e.stopPropagation()}>
                <TypeSelect value={u.type} onChange={(type) => onPatch(u.id, { type })} />
                <LabelInput value={u.label} onSave={(label) => onPatch(u.id, { label })} />
              </div>
              <p className={`entry-text ${u.flags?.notVerbatim ? 'reworded' : ''}`}>{u.text}</p>
              <div className="entry-foot" onClick={(e) => e.stopPropagation()}>
                {u.type !== 'claim' && <HomeSelect value={u.home} claims={claims.filter((c) => c.id !== u.id)} onChange={(home) => onPatch(u.id, { home })} />}
                <span className="spacer" />
                <button className="link muted" onClick={() => onPatch(u.id, { status: 'cut' })}>cut</button>
                <button className="link" onClick={() => onPatch(u.id, { status: 'accepted' })}>keep</button>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
