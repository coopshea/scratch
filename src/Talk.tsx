import { useEffect, useRef, useState } from 'react';
import type { Blurt, Unit } from '../shared/types.ts';
import type { Billing } from './App.tsx';
import { Icon } from './icons.tsx';

type Props = {
  units: Unit[];
  blurts: Blurt[];
  busy: boolean;
  error: string | null;
  failedBlurtId: string | null;
  /** Hosted: the last cut ran out of credits. */
  outOfCredits: boolean;
  billing?: Billing;
  onBlurt: (text: string) => Promise<boolean>;
  onReparse: (id: string) => void;
  sheetOpen: boolean;
};

export function Talk({ units, blurts, busy, error, failedBlurtId, outOfCredits, billing, onBlurt, onReparse, sheetOpen }: Props) {
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  // The spill page always holds the cursor unless a note is open.
  useEffect(() => { if (!busy && !sheetOpen) box.current?.focus(); }, [busy, sheetOpen]);
  const parsedIds = new Set(units.map((u) => u.blurtId));
  const unparsed = blurts.filter((b) => !parsedIds.has(b.id) && b.id !== failedBlurtId);

  const submit = async () => {
    if (!text.trim() || busy) return;
    if (await onBlurt(text)) setText('');
  };

  return (
    <div className="talk">
      <div className="spill-box">
        <textarea
          ref={box}
          className="blurt"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
          disabled={busy}
          autoFocus
          spellCheck
          aria-label="Braindump here. Type, speak or paste everything you're thinking."
        />
        {!text && (
          <div className="spill-hint" aria-hidden>
            <p className="big">Braindump here.</p>
            <p className="hint">Type, speak or paste everything you're thinking. Fragments are fine.</p>
          </div>
        )}
      </div>
      <div className="blurt-bar">
        <button className="btn btn-primary" onClick={submit} disabled={busy || !text.trim()}>
          <Icon name="scissors" />{busy ? 'cutting…' : 'cut into ideas'}{!busy && <span className="kbd">⌘↵</span>}
        </button>
      </div>

      {error && outOfCredits && failedBlurtId && (
        <div className="notice" role="alert">
          <p className="notice-title">Out of credits. Your spill is saved.</p>
          <div className="notice-actions">
            {billing?.packs.map((p) => (
              <button key={p.cents} className="btn btn-secondary btn-sm" onClick={() => billing.buy(p.cents, failedBlurtId)}>
                ${p.cents / 100} · {p.credits} credits
              </button>
            ))}
            <span className="spacer" />
            <a className="btn btn-quiet btn-sm" href={billing?.keyHref ?? '?account'}><Icon name="key" small />Use my key</a>
          </div>
        </div>
      )}
      {error && !outOfCredits && (
        <p className="error">
          {error}
          {failedBlurtId && <button className="link" onClick={() => onReparse(failedBlurtId)} disabled={busy}>Try again</button>}
        </p>
      )}

      {unparsed.map((b) => (
        <div key={b.id} className="unparsed">
          <span>{b.text.slice(0, 80)}{b.text.length > 80 ? '…' : ''}</span>
          <button className="link" onClick={() => onReparse(b.id)} disabled={busy}>cut into ideas</button>
        </div>
      ))}
    </div>
  );
}
