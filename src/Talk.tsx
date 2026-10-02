import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Blurt, Unit } from '../shared/types.ts';
import { isRoot } from '../shared/clusters.ts';
import { api, type Suggestion } from './api.ts';
import { PassageRow } from './Passage.tsx';
import type { Billing } from './App.tsx';
import { Icon } from './icons.tsx';
import { CUT, SPILL } from './spillDrag.ts';
import { Spills } from './Spills.tsx';
import { NeedsReadwise, type ReadwiseOff } from './ReadwiseOff.tsx';

type Props = {
  units: Unit[];
  blurts: Blurt[];
  /** The open spill: the box's saved text, restored on load. */
  open: Blurt | null;
  /** Save the box's text as the open spill. Called after a pause in typing, and when leaving the page. */
  onSaveSpill: (text: string) => void;
  busy: boolean;
  error: string | null;
  failedBlurtId: string | null;
  /** Hosted: the last cut ran out of credits. */
  outOfCredits: boolean;
  billing?: Billing;
  onBlurt: (text: string) => Promise<boolean>;
  onReparse: (id: string) => void;
  sheetOpen: boolean;
  /** Open an idea in the note sheet: clicking words already cut from an earlier spill. */
  onSelect: (id: string) => void;
  /** Readwise connected and something spilled: offer related reading; picking a passage adds it under its thread. */
  onAdopt?: (id: string, home: string | null) => Promise<void>;
  readwiseOff?: ReadwiseOff;
};

export function Talk({ units, blurts, open, onSaveSpill, busy, error, failedBlurtId, outOfCredits, billing, onBlurt, onReparse, sheetOpen, onSelect, onAdopt, readwiseOff }: Props) {
  const [text, setText] = useState(open?.text ?? '');
  const box = useRef<HTMLTextAreaElement>(null);
  // The box is always saved: about a second after typing stops, and on the way out. One save per pause, not per key.
  const saved = useRef(open?.text ?? '');
  const pending = useRef<number | undefined>(undefined);
  const flush = useRef(() => {});
  flush.current = () => {
    window.clearTimeout(pending.current); pending.current = undefined;
    if (text !== saved.current) { saved.current = text; onSaveSpill(text); }
  };
  useEffect(() => {
    if (text === saved.current) return;
    window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => flush.current(), 1000);
  }, [text]);
  useEffect(() => () => { if (pending.current !== undefined) flush.current(); }, []);
  // The spill page always holds the cursor unless a note is open.
  useEffect(() => { if (!busy && !sheetOpen) box.current?.focus(); }, [busy, sheetOpen]);
  // A closed spill no parse has run over (one that failed): hand cuts from it don't count.
  const parsedIds = new Set(units.filter((u) => u.cutBy !== 'human').map((u) => u.blurtId));
  const unparsed = blurts.filter((b) => !b.parsed && !parsedIds.has(b.id) && b.id !== failedBlurtId);

  const cutting = useCutting(busy);
  const dictation = useDictation((heard) => setText((t) => (t && !/\s$/.test(t) ? `${t} ` : t) + heard.trim()));

  // Suggestions from Readwise wait here until the writer picks; nothing is added unasked.
  const [pulling, setPulling] = useState(false);
  const [offered, setOffered] = useState<Suggestion[] | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const review = useRef<HTMLDivElement>(null);
  const pull = async () => {
    if (!onAdopt || pulling) return;
    setPulling(true); setPullError(null);
    try { setOffered((await api.readwise.related()).suggestions); }
    catch (e) { setPullError((e as Error).message); }
    finally { setPulling(false); }
  };
  useEffect(() => { if (offered?.length) review.current?.focus(); }, [offered]);
  const pick = (s: Suggestion) => {
    setOffered((o) => (o ? o.filter((x) => x.passage.id !== s.passage.id) : o));
    onAdopt?.(s.passage.id, s.home);
  };
  const closeReview = () => { setOffered(null); box.current?.focus(); };
  const threadName = (home: string | null) => (home ? units.find((u) => u.id === home && isRoot(u))?.label : null) ?? 'loose';

  const submit = async () => {
    dictation.stop();
    if (!text.trim() || busy) return;
    // Parse sends the box's text itself and closes the open spill, so nothing pending is saved after it.
    window.clearTimeout(pending.current); pending.current = undefined;
    if (await onBlurt(text)) { saved.current = ''; setText(''); }
  };

  // The page opens at the box, under everything already spilled.
  const page = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (page.current) page.current.scrollTop = page.current.scrollHeight; }, [blurts.length]);

  return (
    <div className="talk" ref={page}>
      <Spills blurts={blurts} units={units} onSelect={onSelect} />
      <div className="spill-box">
        <textarea
          ref={box}
          className="blurt"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
          // Highlighted words dragged out to the board become an idea, in these exact words (spillDrag.ts).
          onDragStart={(e) => {
            const t = e.currentTarget, words = t.value.slice(t.selectionStart, t.selectionEnd);
            if (words.trim()) { e.dataTransfer.setData(CUT, words); e.dataTransfer.setData(SPILL, t.value); e.dataTransfer.effectAllowed = 'copy'; }
          }}
          disabled={busy}
          autoFocus
          spellCheck
          aria-label="Braindump here. Type, speak, or paste anything. Fragments are fine."
        />
        {!text && (
          <div className="spill-hint" aria-hidden>
            <p className="big">Braindump here.</p>
            <p className="hint">
              Type, <button className="link speak" onClick={dictation.toggle} tabIndex={-1}>speak</button>, or paste anything. Fragments are fine.
            </p>
          </div>
        )}
      </div>
      <div className="blurt-bar">
        <button className={`btn btn-quiet ${dictation.listening ? 'listening' : ''}`} onClick={dictation.toggle} disabled={busy}
          aria-pressed={dictation.listening}>
          <Icon name="mic" />{dictation.listening ? 'listening… stop' : 'speak'}
        </button>
        <button className="btn btn-primary" onClick={submit} disabled={busy || !text.trim()} aria-label="Parse writing">
          <Icon name="scissors" />{busy ? cutting : 'Parse writing'}{!busy && <kbd className="kbd">⌘↵</kbd>}
        </button>
      </div>
      {/* Secondary to parsing: a quiet line under the bar, never a button beside it. */}
      {onAdopt && (
        <div className="pull-row">
          {readwiseOff
            ? <NeedsReadwise off={readwiseOff}><span className="link muted pull"><Icon name="book" small />pull relevant from Readwise</span></NeedsReadwise>
            : <button className="link muted pull" onClick={pull} disabled={busy || pulling} title="Your notes and highlights from Readwise that match your threads, for you to pick from">
                <Icon name="book" small />{pulling ? 'reading…' : 'pull relevant from Readwise'}
              </button>}
        </div>
      )}

      {pullError && <p className="error">{pullError}</p>}
      {offered && (
        <div className="pull-review" ref={review} tabIndex={-1} aria-label="From your reading"
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); closeReview(); return; }
            const n = Number(e.key);
            if (n >= 1 && n <= Math.min(9, offered.length)) { e.preventDefault(); pick(offered[n - 1]); }
          }}>
          {!offered.length && <p className="hint">Nothing close in your reading.</p>}
          {offered.map((s, i) => (
            <Fragment key={s.passage.id}>
              {(i === 0 || offered[i - 1].home !== s.home) && <p className="pull-thread">{threadName(s.home)}</p>}
              <PassageRow p={s.passage} n={i + 1} onPick={() => pick(s)} />
            </Fragment>
          ))}
          <button className="link muted" onClick={closeReview}>done</button>
        </div>
      )}
      {dictation.problem && (
        <p className="dictation-problem" role="status">
          {dictation.problem === 'blocked'
            ? 'Allow the microphone for this site to dictate.'
            : <>Dictation doesn't work in this browser. Try Chrome, or <a href="https://wisprflow.ai/r/COOPER4" target="_blank" rel="noreferrer">Wispr Flow</a>, via my referral link.</>}
        </p>
      )}
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

/** While the parser works, the button's words turn over at random; at rest it says plainly what it does. */
const GERUNDS = [
  'cutting…', 'chopping…', 'segmenting…', 'polishing…', 'kicking the anthill…', 'slicing and dicing…',
  'untangling…', 'herding cats…', 'panning for gold…', 'shaking the tree…', 'rummaging…', 'threshing…',
];

function useCutting(busy: boolean) {
  const [word, setWord] = useState(GERUNDS[0]);
  useEffect(() => {
    if (!busy) return;
    const next = () => setWord((w) => { let n = w; while (n === w) n = GERUNDS[Math.floor(Math.random() * GERUNDS.length)]; return n; });
    next();
    const t = window.setInterval(next, 2500);
    return () => window.clearInterval(t);
  }, [busy]);
  return word;
}

type Recognition = {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void;
};
const speech = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
const Recognizer = speech.SpeechRecognition ?? speech.webkitSpeechRecognition;

/**
 * The browser's own speech recognition, adding what it hears to the page. Some browsers have none (Firefox), and some
 * have it but cannot reach a speech service (Brave fails with 'network'); both say so and point to Wispr Flow.
 */
function useDictation(onHeard: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<'unavailable' | 'blocked' | null>(null);
  const rec = useRef<Recognition | null>(null);
  const heard = useRef(onHeard);
  heard.current = onHeard;
  useEffect(() => () => rec.current?.stop(), []);

  const stop = () => rec.current?.stop();
  const toggle = () => {
    if (rec.current) { stop(); return; }
    setProblem(null);
    if (!Recognizer) { setProblem('unavailable'); return; }
    const r = new Recognizer();
    r.continuous = true;
    r.interimResults = false;
    r.lang = navigator.language;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) heard.current(e.results[i][0].transcript);
    };
    // 'no-speech' and 'aborted' are ordinary endings; the rest mean dictation cannot work here.
    r.onerror = (e) => {
      if (e.error === 'not-allowed') setProblem('blocked');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') setProblem('unavailable');
    };
    r.onend = () => { rec.current = null; setListening(false); };
    rec.current = r;
    try { r.start(); setListening(true); } catch { rec.current = null; setProblem('unavailable'); }
  };
  return { listening, problem, toggle, stop };
}
