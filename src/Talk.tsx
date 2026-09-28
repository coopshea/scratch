import { useEffect, useRef, useState } from 'react';
import type { Blurt, Unit } from '../shared/types.ts';

type Props = {
  units: Unit[];
  blurts: Blurt[];
  busy: boolean;
  error: string | null;
  failedBlurtId: string | null;
  onBlurt: (text: string) => Promise<boolean>;
  onReparse: (id: string) => void;
  sheetOpen: boolean;
};

export function Talk({ units, blurts, busy, error, failedBlurtId, onBlurt, onReparse, sheetOpen }: Props) {
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  // The blurt page always holds the cursor unless a note is open.
  useEffect(() => { if (!busy && !sheetOpen) box.current?.focus(); }, [busy, sheetOpen]);
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
    </div>
  );
}
