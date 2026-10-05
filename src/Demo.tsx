import { useEffect, useRef, useState } from 'react';
import { STRUCTURES, structureMap, type Board } from '../shared/structures.ts';
import { isRoot } from '../shared/clusters.ts';
import type { Blurt, Unit } from '../shared/types.ts';
import {
  DEMO_BLURT, DEMO_BOARD, DEMO_CLAIM, DEMO_EVIDENCE, DEMO_EXPORT, DEMO_LANE, DEMO_PLACED, DEMO_SENTENCE, DEMO_SPILL, DEMO_TITLE, DEMO_UNITS,
  markDemoSeen,
} from './demoScript.ts';
import { EmptyBoard } from './EmptyBoard.tsx';
import { Graph } from './Graph.tsx';
import { Icon } from './icons.tsx';
import { posthog } from './posthog.ts';
import { StageRail, type Stage } from './StageRail.tsx';
import { Structure } from './Structure.tsx';
import { Talk } from './Talk.tsx';
import { inkOf } from './typeStyle.ts';

/**
 * The demo: about 20 seconds of the app with a cursor in it, laid over the writer's own document. It types three messy
 * lines and parses them, drags a cluster onto the thesis in Shape, writes a sentence in Draft, and exports.
 *
 * It is a script stepping the real components (Talk, Graph, StageRail, Structure read-only) through states, the way
 * History steps them through the log, so it changes when the app does. Draft is a stand-in with Draft's own markup:
 * its editors save as they go. Nothing reaches the server: every handler here is a no-op, the scene is the example's
 * data held in this component, and the whole layer is inert, so no press lands on it.
 *
 * Any key or press stops it at once, and the writer's document is there underneath, as they left it.
 */

const noop = () => {};
const NONE: Unit[] = [];
const NO_SPILLS: Blurt[] = [];
const SPILLED = [DEMO_BLURT];
const STRUCTS = structureMap([]);
const LANES = STRUCTURES.persuasive.lanes;
const EASE = 'cubic-bezier(.45, 0, .25, 1)';

type Scene = { stage: Stage; typed: string; busy: boolean; parsed: boolean; board: Board; writing: boolean; written: string; chip: boolean; exported: boolean };
const START: Scene = { stage: 'talk', typed: '', busy: false, parsed: false, board: DEMO_BOARD, writing: false, written: '', chip: false, exported: false };

class Stopped extends Error {}

export function Demo({ from, onEnd }: { from: 'first_visit' | 'menu'; onEnd: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLSpanElement>(null);
  const [scene, setScene] = useState(START);
  const [leaving, setLeaving] = useState(false);
  const run = useRef(new AbortController());
  const ended = useRef(false);
  const started = useRef(performance.now());

  const end = useRef((completed: boolean) => {
    if (ended.current) return;
    ended.current = true;
    run.current.abort();
    posthog?.capture('demo_ended', { from, completed, seconds: Math.round((performance.now() - started.current) / 100) / 10 });
    setLeaving(true);
    window.setTimeout(onEnd, 180);
  });

  // Any key or press stops it. A moment's grace first, so the click that opened it from the menu doesn't.
  useEffect(() => {
    const stop = () => { if (performance.now() - started.current > 250) end.current(false); };
    window.addEventListener('pointerdown', stop, true);
    window.addEventListener('keydown', stop, true);
    return () => { window.removeEventListener('pointerdown', stop, true); window.removeEventListener('keydown', stop, true); };
  }, []);

  useEffect(() => {
    markDemoSeen();
    posthog?.capture('demo_played', { from });
    const signal = run.current.signal;
    const wait = (ms: number) => new Promise<void>((ok, fail) => {
      if (signal.aborted) { fail(new Stopped()); return; }
      const quit = () => { window.clearTimeout(t); fail(new Stopped()); };
      const t = window.setTimeout(() => { signal.removeEventListener('abort', quit); ok(); }, ms);
      signal.addEventListener('abort', quit, { once: true });
    });
    const set = (p: Partial<Scene>) => setScene((s) => ({ ...s, ...p }));
    const find = (sel: string) => {
      const el = root.current?.querySelector<HTMLElement>(sel);
      if (!el) throw new Stopped();
      return el;
    };
    const point = (el: Element, fx = 0.5, fy = 0.5) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width * fx, y: r.top + r.height * fy };
    };

    // The cursor is moved by hand, not by state, so nothing re-renders under it (Structure repaints on every render).
    const move = async (p: { x: number; y: number }, ms = 520) => {
      const c = cursor.current!;
      c.classList.add('shown');
      c.style.transitionDuration = `${ms}ms, 200ms`;
      c.style.transform = `translate(${p.x}px, ${p.y}px)`;
      await wait(ms);
    };
    const press = (down: boolean) => cursor.current!.classList.toggle('down', down);
    const click = async () => {
      press(true);
      ring.current?.animate([{ transform: 'scale(.3)', opacity: 0.7 }, { transform: 'scale(1.5)', opacity: 0 }], { duration: 420, easing: 'ease-out' });
      await wait(110);
      press(false);
      await wait(90);
    };
    // Quick, uneven keystrokes with a beat after punctuation: a person typing, sped up.
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const type = async (text: string, put: (s: string) => void) => {
      for (let i = 1; i <= text.length; i++) {
        put(text.slice(0, i));
        const ch = text[i - 1];
        await wait(ch === '\n' ? 220 : /[.?,:]/.test(ch) ? 70 : 7 + rnd() * 15);
      }
    };
    const step = (n: number) => root.current!.querySelectorAll<HTMLElement>('.rail .step')[n];

    (async () => {
      const box = find('.blurt');
      cursor.current!.style.transform = `translate(${point(box, 0.55, 0.9).x}px, ${point(box, 0.55, 0.9).y}px)`;
      await wait(250);

      // 1. Spill: type, then Parse; the spill splits into ideas on the board.
      await move(point(box, 0.25, 0.2), 450);
      await click();
      await type(DEMO_SPILL, (typed) => set({ typed }));
      await wait(200);
      await move(point(find('.blurt-bar .btn-primary')), 480);
      await click();
      set({ busy: true });
      await wait(650);
      set({ busy: false, parsed: true, typed: '' });
      await wait(1200);

      // 2. Shape: drag the claim's cluster onto the thesis.
      await move(point(step(1)), 560);
      await click();
      set({ stage: 'structure' });
      await wait(450);
      const claim = DEMO_UNITS.find((u) => u.id === DEMO_CLAIM)!;
      const card = [...root.current!.querySelectorAll<HTMLElement>('.levels .unit')].find((el) => el.textContent?.includes(claim.label));
      const level = root.current!.querySelectorAll<HTMLElement>('.levels .level')[LANES.findIndex((l) => l.id === DEMO_LANE)];
      if (!card || !level) throw new Stopped();
      const grip = point(card, 0.3);
      await move(grip, 500);
      press(true);
      await wait(140);
      // The card rides with the cursor, as Structure's own drag moves it: by its transform, lifted.
      const lr = level.getBoundingClientRect(), cr = card.getBoundingClientRect();
      const to = { x: lr.left + 210 + cr.width * 0.3, y: lr.top + lr.height / 2 };
      const was = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(card.style.transform);
      const [tx, ty] = was ? [Number(was[1]), Number(was[2])] : [0, 0];
      card.style.transition = `transform 850ms ${EASE}`;
      card.style.boxShadow = 'var(--shadow-drag)';
      card.style.zIndex = '5';
      card.style.transform = `translate(${tx + to.x - grip.x}px, ${ty + to.y - grip.y}px)`;
      const lit = window.setTimeout(() => level.classList.add('accept'), 450);
      try { await move(to, 850); } finally { window.clearTimeout(lit); }
      await wait(120);
      level.classList.remove('accept');
      card.style.transition = 'transform 200ms ease-out';
      card.style.boxShadow = '';
      card.style.zIndex = '';
      press(false);
      set({ board: DEMO_PLACED });
      await wait(250);
      card.style.transition = '';
      await wait(550);

      // 3. Draft: a sentence in the thesis, then the evidence beside it as a chip (double-click puts it at the cursor).
      await move(point(step(2)), 560);
      await click();
      set({ stage: 'draft' });
      await wait(400);
      const page = find(`.draft-row[data-lane="${DEMO_LANE}"] .demo-page`);
      const pr = page.getBoundingClientRect();
      await move({ x: pr.left + 70, y: pr.top + 16 }, 520);
      await click();
      set({ writing: true });
      await type(DEMO_SENTENCE, (written) => set({ written }));
      await wait(200);
      await move(point(find(`.cue[data-id="${DEMO_EVIDENCE}"] .cue-label`), 0.3), 540);
      await click();
      await click();
      set({ chip: true });
      await wait(650);

      // 4. Export: the clean markdown, the evidence now a footnote.
      await move(point(find('[data-demo="export"]')), 600);
      await click();
      set({ exported: true });
      await wait(2800);
      end.current(true);
    })().catch((e) => { if (!(e instanceof Stopped)) throw e; end.current(false); });

    return () => run.current.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const units = scene.parsed ? DEMO_UNITS : NONE;
  const placed = scene.board !== DEMO_BOARD;
  const next: Stage | null = scene.stage === 'talk' && scene.parsed ? 'structure' : scene.stage === 'structure' && placed ? 'draft' : null;

  let body: React.ReactNode;
  if (scene.stage === 'talk') {
    body = (
      <main className="body talk-stage">
        <Talk units={units} blurts={scene.parsed ? SPILLED : NO_SPILLS} open={null} onSaveSpill={noop} busy={scene.busy} error={null}
          failedBlurtId={null} outOfCredits={false} onBlurt={async () => false} onReparse={noop} sheetOpen={false} onSelect={noop} demo={scene.typed} />
        <section className="canvas">
          {scene.parsed ? <Graph units={units} selectedId={null} onSelect={noop} movable={false} /> : <EmptyBoard />}
        </section>
      </main>
    );
  } else if (scene.stage === 'structure') {
    body = (
      <main className="body structure-stage">
        <Structure units={units} board={scene.board} onBoard={noop} structures={STRUCTS} onCustom={noop} onSelect={noop} selectedId={null} readOnly />
      </main>
    );
  } else {
    body = <main className="body draft-stage"><DraftPage board={scene.board} writing={scene.writing} written={scene.written} chip={scene.chip} /></main>;
  }

  return (
    <div ref={root} className={`demo ${leaving ? 'leaving' : ''}`}>
      <div className="shell demo-app" inert aria-hidden>
        <div className="app">
          <header className="topbar">
            <div className="topbar-side">
              <span className="icon-btn"><Icon name="panel" /></span>
              <span className="title">{DEMO_TITLE}</span>
            </div>
            <StageRail stage={scene.stage} next={next} onStage={noop} quiet={false} hint={null} />
            <div className="topbar-side right">
              <span className="stage"><Icon name="clock" small /><span className="label">History</span></span>
              <span className="stage"><Icon name="copy" small /><span className="label">Copy</span></span>
              <span className={`stage ${scene.exported ? 'on' : ''}`} data-demo="export"><Icon name="download" small /><span className="label">Export</span></span>
              <span className="icon-btn"><Icon name="help" /></span>
            </div>
          </header>
          {body}
        </div>
        {scene.exported && <pre className="demo-export">{DEMO_EXPORT}</pre>}
      </div>
      <div ref={cursor} className="demo-cursor" aria-hidden>
        <span ref={ring} className="demo-ring" />
        <svg viewBox="0 0 16 24" width="17" height="25"><path d="M1 1v19.5l5-4.6 3.3 7.3 3-1.4-3.2-7.1H16z" /></svg>
      </div>
      <button className="link muted demo-skip" onClick={() => end.current(false)}>skip</button>
    </div>
  );
}

/**
 * Draft, as it looks: Draft's own rows and classes, the outline at the left and the page at the right. A stand-in for
 * the real page, whose section editors save the draft as they go.
 */
function DraftPage({ board, writing, written, chip }: { board: Board; writing: boolean; written: string; chip: boolean }) {
  const assign = board.lanes[board.structure] ?? {};
  const rowsFor = (lane: string) => (assign[lane] ?? []).map((id) => DEMO_UNITS.find((u) => u.id === id)!)
    .flatMap((u) => [{ unit: u, depth: 0 }, ...DEMO_UNITS.filter((k) => k.home === u.id).map((k) => ({ unit: k, depth: 1 }))]);
  const evidence = DEMO_UNITS.find((u) => u.id === DEMO_EVIDENCE)!;
  return (
    <div className="draft-rows">
      <div className="draft-sections">
        {LANES.map((l, i) => (
          <div key={l.id} data-lane={l.id} className={`draft-row ${writing && l.id === DEMO_LANE ? 'active' : ''}`}>
            <section className="cue-cell">
              <h3 className={l.required && !rowsFor(l.id).length ? 'gap' : ''}>{l.name}</h3>
              {rowsFor(l.id).map(({ unit: u, depth }) => (
                <div key={u.id} data-id={u.id} className={`cue depth-${depth} ${chip && u.id === DEMO_EVIDENCE ? 'used' : ''}`}>
                  <div className="cue-line">
                    <button className="disclose">▸</button>
                    {u.type && !(u.type === 'claim' && isRoot(u)) && <em style={{ color: inkOf(u.type) }}>{u.type}</em>}
                    <span className={`cue-label ${isRoot(u) ? 'is-claim' : ''}`}>{u.label}</span>
                  </div>
                </div>
              ))}
            </section>
            <div className="page draft-blocks">
              <div className="demo-page">
                {i === 0 && !writing && !written && <span className="demo-blank">Write here. / for commands.</span>}
                {l.id === DEMO_LANE && <>
                  {written}
                  {chip && <> <span className="draft-chip">{evidence.label}</span> </>}
                  {writing && <span className="demo-caret" />}
                </>}
              </div>
            </div>
          </div>
        ))}
        <div className="draft-row filler"><div className="cue-cell" /><div className="page" /></div>
      </div>
    </div>
  );
}
