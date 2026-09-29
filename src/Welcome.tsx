import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons.tsx';
import { FRAME, STROKE, welcomeRope } from './knot.ts';

/**
 * The signed-out front page. A knotted rope hangs in the middle. Scrolling pulls the paper up under a pencil point
 * that rises more slowly, so the knot leaves and a line trails down; then the paper stops and the point deflects round
 * the headline, uncovering it. Then what Scratch does, sign-in, and who made it.
 */
export function Welcome({ signIn }: { signIn: React.ReactNode }) {
  const rope = useMemo(welcomeRope, []);
  const track = useRef<HTMLDivElement>(null);
  const paper = useRef<SVGGElement>(null);
  const line = useRef<SVGLineElement>(null);
  const pen = useRef<SVGPathElement>(null);
  const reveal = useRef<SVGRectElement>(null);
  const cue = useRef<HTMLDivElement>(null);
  const stub = useRef<HTMLDivElement>(null);
  const h = rope.headline;
  const textTop = h.top, textBottom = h.top + h.size * 0.8 + h.lineGap + h.size * 0.25;

  useEffect(() => {
    const clamp = (x: number) => Math.max(0, Math.min(1, x));
    // The drawn path's own length, measured, so no sliver of the hidden part shows at its end.
    const total = pen.current?.getTotalLength() ?? rope.penLength;
    pen.current?.style.setProperty('stroke-dasharray', `${total} ${total}`);
    // A pencil point and the paper pulled up under it: first the paper moves (the knot leaves the top, a line trails down
    // to the point, which rises to where the headline starts); then the paper stops and the point moves on, round the
    // headline, uncovering it.
    // Straight from the scroll event, which browsers already pace to the frame rate.
    const update = () => {
      const el = track.current;
      const s = Math.min(window.innerWidth / FRAME.w, window.innerHeight / FRAME.h);
      if (!el || !s) return; // a hidden window has no size to scale to
      // In a tall window the frame sits mid-screen; the paper travels that much further so the knot clears the top.
      const band = (window.innerHeight - FRAME.h * s) / 2 / s;
      const travel = rope.paperTravel + band;
      // The point draws on to the bottom of the screen, not just of the frame, where the section below takes the line on.
      const reach = rope.beforeDown + (FRAME.h + band - rope.downFrom) + 40;
      const paperScroll = travel * s, penScroll = reach * s * 1.05;
      const height = Math.round(window.innerHeight + paperScroll + penScroll + window.innerHeight * 0.25);
      if (el.offsetHeight !== height) el.style.height = `${height}px`;
      const y = Math.max(0, window.scrollY - el.offsetTop);
      const p = clamp(y / paperScroll), o = p * travel;
      // Easing in and out, so the point settles before it moves on round the headline.
      const tip = rope.exit[1] + (rope.rest - rope.exit[1]) * p * p * (3 - 2 * p);
      paper.current?.setAttribute('transform', `translate(0 ${-o})`);
      line.current?.setAttribute('y2', String(Math.max(rope.exit[1], tip + o)));
      const drawn = clamp((y - paperScroll) / penScroll) * reach;
      pen.current?.style.setProperty('stroke-dashoffset', String(total - drawn));
      const penY = drawn > rope.beforeDown ? rope.downFrom + (drawn - rope.beforeDown) : 0;
      reveal.current?.setAttribute('height', String(Math.round(clamp((penY - textTop) / (textBottom - textTop)) * (textBottom - textTop + 24))));
      if (cue.current) cue.current.style.opacity = String(1 - clamp(y / (paperScroll * 0.2)));
      // The section below carries the thread on at the same x, then turns it off the right edge, so match how the stage
      // scales the frame: the same stroke, and the same turn as the point's first.
      if (stub.current) {
        stub.current.style.left = `${(window.innerWidth - FRAME.w * s) / 2 + (rope.threadX - STROKE / 2) * s}px`;
        stub.current.style.borderWidth = `0 0 ${STROKE * s}px ${STROKE * s}px`;
        stub.current.style.borderBottomLeftRadius = `${(rope.bend + STROKE / 2) * s}px`;
      }
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [rope, textTop, textBottom]);

  return (
    <div className="welcome">
      <div className="welcome-track" ref={track}>
        <div className="welcome-stage">
          <svg viewBox={`0 0 ${FRAME.w} ${FRAME.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
            <defs><clipPath id="headline-reveal"><rect ref={reveal} x="0" y={textTop} width={FRAME.w} height="0" /></clipPath></defs>
            <g ref={paper}>
              <path className="rope" d={rope.knot} />
              <line className="rope" ref={line} x1={rope.exit[0]} y1={rope.exit[1]} x2={rope.exit[0]} y2={rope.exit[1]} />
            </g>
            <path className="rope" ref={pen} d={rope.pen} style={{ strokeDasharray: `${rope.penLength} ${rope.penLength}`, strokeDashoffset: rope.penLength }} />
            <g className="headline" clipPath="url(#headline-reveal)" style={{ fontSize: h.size }}>
              <text x={h.x} y={h.top + h.size * 0.8}>Detangle</text>
              <text x={h.x} y={h.top + h.size * 0.8 + h.lineGap}>Your Brain</text>
            </g>
          </svg>
          <h1 className="sr-only">Detangle your brain</h1>
          <header className="welcome-top">
            <span className="wordmark">Scratch</span>
            <span className="spacer" />
            {/* Straight to the form, not the top of the section: the stage demos sit between them. */}
            <a className="btn btn-quiet btn-sm" href="#sign-in" onClick={(e) => { e.preventDefault(); document.getElementById('sign-in')?.scrollIntoView({ block: 'center' }); }}>Sign in</a>
          </header>
          <div className="scroll-cue" ref={cue} aria-hidden><span>Scroll</span><Icon name="down" small /></div>
        </div>
      </div>
      <section className="welcome-info" id="start">
        <div className="stub" ref={stub} />
        <p className="welcome-lead">Scratch turns loose thoughts into pieces you can move around, so going from idea to draft is quick.</p>
        <Steps />
        <div className="welcome-signin" id="sign-in">
          {signIn}
          <p>2 free credits to start.</p>
        </div>
        <footer className="welcome-foot">An experiment by <a href="https://coopershea.com">Cooper Shea</a></footer>
      </section>
    </div>
  );
}

const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The three stages, stacked. Each holds mid-screen for a stretch of scrolling, then moves on. Only the one nearest the
 * middle plays; the others hold where they got to, so one thing moves at a time.
 */
function Steps() {
  const list = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);
  useEffect(() => {
    if (still()) return;
    const pick = () => {
      const mid = window.innerHeight / 2;
      let best = -1, dist = window.innerHeight * 0.4;
      list.current?.querySelectorAll('.welcome-step').forEach((el, k) => {
        const r = el.getBoundingClientRect(), d = Math.abs((r.top + r.bottom) / 2 - mid);
        if (d < dist) { dist = d; best = k; }
      });
      setActive(best);
    };
    pick();
    window.addEventListener('scroll', pick, { passive: true });
    window.addEventListener('resize', pick);
    return () => { window.removeEventListener('scroll', pick); window.removeEventListener('resize', pick); };
  }, []);
  return (
    <div className="welcome-steps" ref={list}>
      <Step on={active === 0} n={1} name="Spill"><SpillMini active={active === 0} /></Step>
      <Step on={active === 1} n={2} name="Shape"><ShapeMini active={active === 1} /></Step>
      <Step on={active === 2} n={3} name="Draft"><DraftMini active={active === 2} /></Step>
    </div>
  );
}

function Step({ on, n, name, children }: { on: boolean; n: number; name: string; children: React.ReactNode }) {
  return (
    <div className="welcome-step-hold">
      <div className={'welcome-step' + (on ? ' on' : '')}>
        <h3><span>{n}</span>{name}</h3>
        <div className="mini" aria-hidden>{children}</div>
      </div>
    </div>
  );
}

/** Runs `tick` while `active`, waiting however long it returns before the next; `null` means finished for good. */
function useTicker(active: boolean, tick: () => number | null) {
  const fn = useRef(tick);
  fn.current = tick;
  const done = useRef(false);
  useEffect(() => {
    if (!active || done.current) return;
    let t = window.setTimeout(function run() {
      const next = fn.current();
      if (next === null) { done.current = true; return; }
      t = window.setTimeout(run, next);
    }, 450);
    return () => window.clearTimeout(t);
  }, [active]);
}

/** How long to wait after typing `c`: quick uneven keystrokes, a beat after a word, longer after a sentence or a return. */
function beat(c: string) {
  if (c === '\n') return 380;
  if ('.?!'.includes(c)) return 240;
  if (c === ',') return 130;
  if (c === ' ') return 60 + Math.random() * 70;
  return 30 + Math.random() * 45;
}

/** A typing script: text to type, or a number of characters to backspace over. */
type Script = (string | number)[];

/** Every keystroke in a script: the text on the page after it, and how long to wait before the next. */
function keystrokes(script: Script) {
  const keys: { text: string; wait: number }[] = [];
  let text = '';
  script.forEach((part, n) => {
    if (typeof part === 'string') for (const c of part) { text += c; keys.push({ text, wait: beat(c) }); }
    else for (let k = 0; k < part; k++) { text = text.slice(0, -1); keys.push({ text, wait: 30 + Math.random() * 25 }); }
    // A second's thought before changing course.
    if (typeof script[n + 1] === 'number' && keys.length) keys[keys.length - 1].wait = 900;
  });
  return keys;
}

/** Plays a typing script into `out` while active, a little faster than a person would, keeping the caret in view. */
function useTyping(active: boolean, script: Script, page: React.RefObject<HTMLElement | null>, out: React.RefObject<HTMLElement | null>, onText?: (text: string) => void) {
  const keys = useMemo(() => keystrokes(script), [script]);
  const i = useRef(0);
  useEffect(() => {
    const last = keys[keys.length - 1].text;
    if (still() && out.current) { out.current.textContent = last; onText?.(last); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useTicker(active && !still(), () => {
    const el = page.current;
    if (!out.current || !el) return null;
    const key = keys[i.current++];
    out.current.textContent = key.text;
    onText?.(key.text);
    if (el.scrollHeight > el.clientHeight + el.scrollTop) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    return i.current < keys.length ? key.wait : null;
  });
}

const SPILL = `How the hell do turbines work? how do they not just melt if they get so hot?

Is it some special metal or what? I remember watching a youtube video about rolls royce doing materials research... gotta dig that up. I think they grew a big single crystal of metal like how they do with computer chips then somehow turn that into a blade.

How does it even make economic sense to build something that complicated? I suppose the impacts of air travel are so important that amortizing the cost of hundreds of engineers makes sense... if you can get to a destination 2% faster, you can deliver high value parts faster, and that probably gets paid off pretty quick. I'll also bet governments try to subsidize this development for military and then it trickles down to consumer. need to confirm.`;
const SPILL_SCRIPT: Script = [SPILL];

/** Someone typing loose thoughts into the page. */
function SpillMini({ active }: { active: boolean }) {
  const page = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  useTyping(active, SPILL_SCRIPT, page, text);
  return (
    <div className="mini-page" ref={page}>
      <span ref={text} /><span className="mini-caret" />
    </div>
  );
}

/** The ideas the spill came back as; the first three go into the outline, in order. */
const IDEAS = [
  { label: 'Turbine blades should melt', row: 0 },
  { label: 'J curve of turbine blade development', row: 1 },
  { label: 'Turbine cost subsidies & other markets?', row: 1 },
  { label: 'Rolls-Royce single-crystal blade video', row: -1 },
];
const ROWS = ['Hook', 'Argument', 'End'];
const MOVES = IDEAS.filter((d) => d.row >= 0).length;

/**
 * A cursor drags the ideas out of the tray into the outline, one at a time. Every idea has an invisible place held for
 * it in the tray and in its row, so the layout never shifts; the cards themselves float over those places.
 * Each move is four steps: point at the card, pick it up, carry it to its row, let go.
 */
function ShapeMini({ active }: { active: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(() => (still() ? MOVES * 4 + 1 : 0));
  const [spots, setSpots] = useState<{ tray: DOMRect[]; row: (DOMRect | null)[] } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = box.current;
      if (!el) return;
      const o = el.getBoundingClientRect();
      const at = (q: Element | null) => { if (!q) return null; const r = q.getBoundingClientRect(); return new DOMRect(r.left - o.left, r.top - o.top, r.width, r.height); };
      setSpots({
        tray: IDEAS.map((_, k) => at(el.querySelector(`[data-tray="${k}"]`))!),
        row: IDEAS.map((_, k) => at(el.querySelector(`[data-row="${k}"]`))),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  useTicker(active && !still(), () => {
    const next = step + 1;
    setStep(next);
    if (next > MOVES * 4) return null;
    return [550, 180, 750, 450][(next - 1) % 4];
  });
  const move = Math.floor((step - 1) / 4), phase = (step - 1) % 4;
  const placed = (k: number) => IDEAS[k].row >= 0 && (k < move || (k === move && phase >= 2));
  // The ideas left in the tray close up as each one leaves, stacked by their own heights: a two-line card moving up
  // into a one-line card's place would be overlapped by the card below it.
  const slot = (k: number) => {
    const t = spots!.tray, gap = t.length > 1 ? t[1].y - t[0].y - t[0].height : 0;
    const y = IDEAS.slice(0, k).reduce((y, _, j) => (placed(j) ? y : y + t[j].height + gap), t[0].y);
    return new DOMRect(t[0].x, y, t[k].width, t[k].height);
  };
  const lifted = step > 0 && step <= MOVES * 4 && (phase === 1 || phase === 2) ? move : -1;
  const target = step > 0 && step <= MOVES * 4 && spots ? (phase < 2 ? slot(move) : spots.row[move]) : null;
  return (
    <div className="mini-shape" ref={box}>
      <div className="mini-tray">
        <em>Ideas</em>
        {IDEAS.map((d, k) => <i key={k} data-tray={k}>{d.label}</i>)}
      </div>
      <div className="mini-rows">
        {ROWS.map((name, r) => (
          <div key={name} className={lifted >= 0 && IDEAS[lifted].row === r && phase === 2 ? 'on' : ''}>
            <span>{name}</span>
            <div>{IDEAS.map((d, k) => d.row === r && <i key={k} data-row={k}>{d.label}</i>)}</div>
          </div>
        ))}
      </div>
      {spots && IDEAS.map((d, k) => {
        const at = placed(k) ? spots.row[k]! : slot(k);
        return (
          <b key={k} className={'mini-card' + (lifted === k ? ' lifted' : '')}
            style={{ width: at.width, transform: `translate(${at.x}px, ${at.y}px)${lifted === k ? ' rotate(-2deg)' : ''}` }}>{d.label}</b>
        );
      })}
      <svg className="mini-cursor" viewBox="0 0 16 22" width="16" height="22"
        style={{ opacity: target ? 1 : 0, transform: target ? `translate(${target.x + target.width * 0.7}px, ${target.y + target.height * 0.55}px)` : undefined }}>
        <path d="M1 1 L1 17 L5 13 L8 20 L11 19 L8 12 L14 12 Z" />
      </svg>
    </div>
  );
}

/** Cooper's draft, with a change of mind partway through the second sentence. */
const DRAFT: Script = [
  "Turbine blades should melt. The gas rushing past them is hotter than the metal they're made of",
  " past them is hotter than the metal they're made of".length,
  ` over them is blistering, and far exceeds the melting point of the metal. But clearly they don't, and spin happily for millions of cycles in thousands of aircraft every day.

So how did we get from spinning pieces of hand carved wood to jet engines more reliable than the average home printer?`,
];
/** What the draft is written about by the time each idea lights: the hook from the start, the argument from here. */
const COVERS = ['', 'So how'];

/** The outline beside the page, and the draft being typed, lighting each idea as it's written about. */
function DraftMini({ active }: { active: boolean }) {
  const page = useRef<HTMLParagraphElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState(-1);
  useTyping(active, DRAFT, page, text, (t) => setAt(COVERS.filter((c) => t.includes(c)).length - 1));
  const outline = IDEAS.filter((d) => d.row >= 0);
  return (
    <div className="mini-draft">
      <div>
        {outline.map((d, k) => (
          <i key={k} className={k === at ? 'now' : k < at ? 'used' : ''}>{k === 0 || outline[k - 1].row !== d.row ? <em>{ROWS[d.row]}</em> : null}{d.label}</i>
        ))}
      </div>
      <p ref={page}><span ref={text} /><span className="mini-caret" /></p>
    </div>
  );
}
