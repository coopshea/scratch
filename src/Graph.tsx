import { useLayoutEffect, useMemo, useRef } from 'react';
import { forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationNodeDatum } from 'd3-force';
import type { Unit } from '../shared/types.ts';
import { TYPE_INK } from './typeStyle.ts';
import { rectCollide, resolveOverlaps } from './collide.ts';

type SimNode = SimulationNodeDatum & { id: string; w: number; h: number; claim: boolean };
type SimLink = { source: string | SimNode; target: string | SimNode; key: string };

const PAD = 36;          // screen padding around the fitted graph
const MIN_SCALE = 0.5;   // below this, text stops being readable
const MAX_SCALE = 1.15;

type Props = {
  units: Unit[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

export function Graph({ units, selectedId, onSelect }: Props) {
  const live = useMemo(() => units.filter((u) => u.status !== 'cut'), [units]);
  const liveIds = useMemo(() => new Set(live.map((u) => u.id)), [live]);
  const edges = useMemo(() => live.filter((u) => u.home && liveIds.has(u.home)).map((u) => ({ key: `${u.home}-${u.id}`, source: u.home!, target: u.id })), [live, liveIds]);

  const boxRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const nodeEls = useRef(new Map<string, HTMLDivElement>());
  const edgeEls = useRef(new Map<string, SVGLineElement>());
  const simNodes = useRef(new Map<string, SimNode>());
  const sim = useRef<Simulation<SimNode, SimLink> | null>(null);
  const view = useRef({ s: 1 });
  const first = useRef(true);

  const paint = () => {
    const box = boxRef.current, world = worldRef.current;
    if (!box || !world || !sim.current) return;
    const ns = sim.current.nodes();
    resolveOverlaps(ns);
    for (const n of ns) {
      const el = nodeEls.current.get(n.id);
      if (el) el.style.transform = `translate(${n.x! - n.w / 2}px, ${n.y! - n.h / 2}px)`;
    }
    for (const l of sim.current.force<ReturnType<typeof forceLink<SimNode, SimLink>>>('link')!.links()) {
      const el = edgeEls.current.get(l.key), s = l.source as SimNode, t = l.target as SimNode;
      if (el) { el.setAttribute('x1', String(s.x)); el.setAttribute('y1', String(s.y)); el.setAttribute('x2', String(t.x)); el.setAttribute('y2', String(t.y)); }
    }
    if (!ns.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of ns) { x0 = Math.min(x0, n.x! - n.w / 2); x1 = Math.max(x1, n.x! + n.w / 2); y0 = Math.min(y0, n.y! - n.h / 2); y1 = Math.max(y1, n.y! + n.h / 2); }
    const W = box.clientWidth, H = box.clientHeight;
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, (W - 2 * PAD) / (x1 - x0), (H - 2 * PAD) / (y1 - y0)));
    view.current.s = s;
    const tx = W / 2 - ((x0 + x1) / 2) * s, ty = H / 2 - ((y0 + y1) / 2) * s;
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  };

  // One simulation for the component's life. Layout effect, so it exists before the first sync below.
  useLayoutEffect(() => {
    const s = forceSimulation<SimNode, SimLink>([])
      .force('link', forceLink<SimNode, SimLink>([]).id((d) => d.id).distance(60).strength(0.7))
      .force('charge', forceManyBody<SimNode>().strength((d) => (d.claim ? -420 : -140)))
      .force('x', forceX<SimNode>(0).strength((d) => (d.claim ? 0.09 : 0.03)))
      .force('y', forceY<SimNode>(0).strength((d) => (d.claim ? 0.13 : 0.05)))
      .force('collide', rectCollide())
      .alphaDecay(0.035)
      .on('tick', paint)
      .stop();
    sim.current = s;
    const ro = new ResizeObserver(paint);
    if (boxRef.current) ro.observe(boxRef.current);
    return () => { s.stop(); ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync sim with units after the DOM exists, so real label sizes drive collisions.
  useLayoutEffect(() => {
    const s = sim.current;
    if (!s) return;
    const byUnit = new Map(live.map((u) => [u.id, u]));
    const next: SimNode[] = live.map((u) => {
      const el = nodeEls.current.get(u.id);
      const w = el?.offsetWidth ?? 120, h = el?.offsetHeight ?? 24;
      let n = simNodes.current.get(u.id);
      if (!n) {
        const home = u.home ? simNodes.current.get(u.home) : undefined;
        n = { id: u.id, w, h, claim: u.type === 'claim' };
        if (home) { n.x = home.x! + (Math.random() - 0.5) * 40; n.y = home.y! + (Math.random() - 0.5) * 40; }
      }
      n.w = w; n.h = h; n.claim = byUnit.get(u.id)!.type === 'claim';
      return n;
    });
    simNodes.current = new Map(next.map((n) => [n.id, n]));
    s.nodes(next);
    s.force<ReturnType<typeof forceLink<SimNode, SimLink>>>('link')!.links(edges.map((e) => ({ ...e })));
    if (first.current) {
      first.current = false;
      s.alpha(1);
      for (let i = 0; i < 300; i++) s.tick();
      paint();
    } else {
      s.alpha(Math.max(s.alpha(), 0.35)).restart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, edges]);

  // Drag moves a node; a press without movement is a click.
  const press = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const n = simNodes.current.get(id);
    if (!n || !sim.current) return;
    const startX = e.clientX, startY = e.clientY, ox = n.x!, oy = n.y!;
    let moved = false;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / view.current.s, dy = (ev.clientY - startY) / view.current.s;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) { moved = true; sim.current!.alphaTarget(0.25).restart(); }
      n.fx = ox + dx; n.fy = oy + dy;
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      if (moved) { n.fx = null; n.fy = null; sim.current!.alphaTarget(0); }
      else onSelect(id);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  // Selecting a node keeps everything visible and dims what is outside its cluster.
  const sel = live.find((u) => u.id === selectedId);
  const clusterRoot = sel ? (sel.type === 'claim' ? sel.id : sel.home) : null;
  const inFocus = (u: Unit) => !sel || u.id === sel.id || (clusterRoot !== null && (u.id === clusterRoot || u.home === clusterRoot));

  return (
    <div className="graph" ref={boxRef} onPointerDown={() => onSelect(null)}>
      <div className="graph-world" ref={worldRef}>
        <svg className="graph-edges" aria-hidden>
          {edges.map((e) => (
            <line key={e.key} ref={(el) => { if (el) edgeEls.current.set(e.key, el); else edgeEls.current.delete(e.key); }}
              className={!sel || e.source === clusterRoot ? '' : 'dim'} />
          ))}
        </svg>
        {live.map((u) => {
          const cls = ['unit', u.type === 'claim' ? 'is-claim' : '',
            u.origin === 'model' ? 'is-model' : '', u.id === selectedId ? 'is-selected' : '', inFocus(u) ? '' : 'dim'].join(' ');
          return (
            <div key={u.id} className={cls} style={{ '--c': TYPE_INK[u.type] } as React.CSSProperties}
              ref={(el) => { if (el) nodeEls.current.set(u.id, el); else nodeEls.current.delete(u.id); }}
              onPointerDown={(e) => press(e, u.id)}>
              {u.type !== 'claim' && <span className="kind">{u.type}</span>}
              <span className="lbl">{u.label}</span>
              <div className="tip">{u.text}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
