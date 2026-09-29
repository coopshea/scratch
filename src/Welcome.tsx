import { useEffect, useMemo, useRef } from 'react';
import { Icon } from './icons.tsx';
import { FRAME, STROKE, welcomeRope } from './knot.ts';

/**
 * The signed-out front page. A knotted rope hangs in the middle. Scrolling pulls the paper up under a pinned pencil
 * point, so the knot leaves and a line trails down; then the paper stops and the point deflects round the headline,
 * uncovering it. Then what Scratch does, and sign-in.
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
    // A pencil point pinned in place and the paper pulled up under it: first the paper moves (the knot leaves the top,
    // a line trails down to the point); then the paper stops and the point moves, round the headline, uncovering it.
    // Straight from the scroll event, which browsers already pace to the frame rate.
    const update = () => {
      const el = track.current;
      if (!el) return;
      const s = Math.min(window.innerWidth / FRAME.w, window.innerHeight / FRAME.h);
      // In a tall window the frame sits mid-screen; the paper travels that much further so the knot clears the top.
      const band = (window.innerHeight - FRAME.h * s) / 2 / s;
      const travel = rope.paperTravel + band;
      // The point draws on to the bottom of the screen, not just of the frame, where the section below takes the line on.
      const reach = rope.beforeDown + (FRAME.h + band - rope.downFrom) + 40;
      const paperScroll = travel * s, penScroll = reach * s * 1.05;
      const height = Math.round(window.innerHeight + paperScroll + penScroll + window.innerHeight * 0.25);
      if (el.offsetHeight !== height) el.style.height = `${height}px`;
      const y = Math.max(0, window.scrollY - el.offsetTop);
      const o = clamp(y / paperScroll) * travel;
      paper.current?.setAttribute('transform', `translate(0 ${-o})`);
      line.current?.setAttribute('y2', String(rope.exit[1] + o));
      const drawn = clamp((y - paperScroll) / penScroll) * reach;
      pen.current?.style.setProperty('stroke-dashoffset', String(total - drawn));
      const penY = drawn > rope.beforeDown ? rope.downFrom + (drawn - rope.beforeDown) : 0;
      reveal.current?.setAttribute('height', String(Math.round(clamp((penY - textTop) / (textBottom - textTop)) * (textBottom - textTop + 24))));
      if (cue.current) cue.current.style.opacity = String(1 - clamp(y / (paperScroll * 0.2)));
      // The section below carries the thread on at the same x, so match how the stage scales the frame.
      if (stub.current) {
        stub.current.style.left = `${(window.innerWidth - FRAME.w * s) / 2 + (rope.threadX - STROKE / 2) * s}px`;
        stub.current.style.width = `${STROKE * s}px`;
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
            <a className="btn btn-quiet btn-sm" href="#start">Sign in</a>
          </header>
          <div className="scroll-cue" ref={cue} aria-hidden><span>Scroll</span><Icon name="down" small /></div>
        </div>
      </div>
      <section className="welcome-info" id="start">
        <div className="stub" ref={stub} />
        <p className="welcome-lead">Scratch turns loose thoughts into pieces you can move around, so going from idea to draft is quick.</p>
        <div className="welcome-steps">
          <Step n={1} name="Spill" line="Type, speak or paste everything. Mess is fine." mini={<SpillMini />} />
          <Step n={2} name="Shape" line="Your thoughts come back as ideas. Drag them into an outline." mini={<ShapeMini />} />
          <Step n={3} name="Draft" line="Write each part with its ideas beside you." mini={<DraftMini />} />
        </div>
        <div className="welcome-signin">
          {signIn}
          <p>2 free credits to start.</p>
        </div>
      </section>
    </div>
  );
}

function Step({ n, name, line, mini }: { n: number; name: string; line: string; mini: React.ReactNode }) {
  return (
    <div className="welcome-step">
      <div className="mini">{mini}</div>
      <h3><span>{n}</span>{name}</h3>
      <p>{line}</p>
    </div>
  );
}

const Cut = () => <b className="mini-cut">|</b>;

function SpillMini() {
  return (
    <div className="mini-page">
      the blades sit in gas hotter than the metal <Cut /> so air is bled off the compressor <Cut /> and pushed through tiny holes <Cut /> but why not ceramics
    </div>
  );
}

function ShapeMini() {
  return (
    <div className="mini-rows">
      <div><span>Hook</span><div><i className="head" /><i /></div></div>
      <div className="on"><span>Argument</span><div><i className="head tilt" /></div></div>
      <div><span>End</span><div /></div>
    </div>
  );
}

function DraftMini() {
  return (
    <div className="mini-draft">
      <div><i className="used" /><i /><i /></div>
      <p>The fix is air, bled off the compressor and pushed through tiny holes in each blade<span className="mini-caret" /></p>
    </div>
  );
}
