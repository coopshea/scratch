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

  const [verb, setVerb] = useState(pick);
  const cutting = useCutting(busy);
  const dictation = useDictation((heard) => setText((t) => (t && !/\s$/.test(t) ? `${t} ` : t) + heard.trim()));

  const submit = async () => {
    dictation.stop();
    if (!text.trim() || busy) return;
    if (await onBlurt(text)) { setText(''); setVerb(pick); }
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
        <button className="btn btn-primary" onClick={submit} disabled={busy || !text.trim()} aria-label="Cut into ideas">
          <Icon name="scissors" />{busy ? cutting : verb}{!busy && <kbd className="kbd">⌘↵</kbd>}
        </button>
      </div>

      {dictation.problem && (
        <p className="dictation-problem" role="status">
          {dictation.problem === 'blocked'
            ? 'Allow the microphone for this site to dictate.'
            : <>Dictation doesn't work in this browser. Try <a href="https://wisprflow.ai" target="_blank" rel="noreferrer">Wispr Flow</a>, or Chrome.</>}
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

/** The cut button's words, picked at random each time; the -ing forms turn over while the parser works. */
const VERBS = [
  'cut into ideas', 'chop concepts', 'segment insights', 'polish the turd', 'kick the anthill', 'slice and dice',
  'untangle the yarn', 'herd the cats', 'pan for gold', 'shake the tree', 'sort the junk drawer', 'separate wheat from chaff',
];
const GERUNDS = [
  'cutting…', 'chopping…', 'segmenting…', 'polishing…', 'kicking the anthill…', 'slicing and dicing…',
  'untangling…', 'herding cats…', 'panning for gold…', 'shaking the tree…', 'rummaging…', 'threshing…',
];
const pick = () => VERBS[Math.floor(Math.random() * VERBS.length)];

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
