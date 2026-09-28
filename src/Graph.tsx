import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationNodeDatum } from 'd3-force';
import type { Unit } from '../shared/types.ts';
import { isRoot, pickVisible } from '../shared/clusters.ts';
import { TYPE_INK } from './typeStyle.ts';
import { rectCollide, resolveOverlaps, separateGroups, soloColumn } from './collide.ts';

/** group: the cluster's root id, or null for a solo node (a root with no pieces, or a piece that belongs to nothing). */
type SimNode = SimulationNodeDatum & { id: string; w: number; h: number; claim: boolean; mini: boolean; group: string | null; order: number };
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
  // Each cluster shows its root and up to four pieces; the rest collapse to dots until the cluster is hovered.
  const hiddenBy = useMemo(() => {
    const out = new Map<string, Unit[]>();
    for (const r of live) {
      if (!isRoot(r)) continue;
      const h = pickVisible(live.filter((k) => k.home === r.id)).hidden;
      if (h.length) out.set(r.id, h);
    }
    return out;
  }, [live]);
  const hidden = useMemo(() => new Set([...hiddenBy.values()].flat().map((u) => u.id)), [hiddenBy]);
  const [hoverRoot, setHoverRoot] = useState<string | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const rootIdOf = (u: Unit) => (u.home && liveIds.has(u.home) ? u.home : u.id);
  const enter = (u: Unit) => { window.clearTimeout(hoverTimer.current); setHoverRoot(rootIdOf(u)); };
  const leave = () => { window.clearTimeout(hoverTimer.current); hoverTimer.current = window.setTimeout(() => setHoverRoot(null), 250); };

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
      .force('link', forceLink<SimNode, SimLink>([]).id((d) => d.id).distance((l) => ((l.target as SimNode).mini ? 34 : 60)).strength(0.7))
      .force('charge', forceManyBody<SimNode>().strength((d) => (!d.group ? -30 : d.claim ? -420 : d.mini ? -40 : -140)))
      // Clusters pull to the center; solo nodes are placed by their column instead.
      .force('x', forceX<SimNode>(0).strength((d) => (!d.group ? 0 : d.claim ? 0.09 : 0.03)))
      .force('y', forceY<SimNode>(0).strength((d) => (!d.group ? 0 : d.claim ? 0.13 : 0.05)))
      .force('clusters', separateGroups())
      .force('solo', soloColumn())
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
    const holding = new Set(live.flatMap((u) => (u.home && liveIds.has(u.home) ? [u.home] : [])));
    const groupOf = (u: Unit) => (u.home && liveIds.has(u.home) ? u.home : holding.has(u.id) ? u.id : null);
    const next: SimNode[] = live.map((u, order) => {
      const el = nodeEls.current.get(u.id);
      const w = el?.offsetWidth ?? 120, h = el?.offsetHeight ?? 24;
      let n = simNodes.current.get(u.id);
      if (!n) {
        const home = u.home ? simNodes.current.get(u.home) : undefined;
        n = { id: u.id, w, h, claim: isRoot(u), mini: hidden.has(u.id), group: groupOf(u), order };
        if (home) { n.x = home.x! + (Math.random() - 0.5) * 40; n.y = home.y! + (Math.random() - 0.5) * 40; }
      }
      n.w = w; n.h = h; n.claim = isRoot(byUnit.get(u.id)!); n.mini = hidden.has(u.id); n.group = groupOf(u); n.order = order;
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
  const clusterRoot = sel ? (isRoot(sel) ? sel.id : sel.home) : null;
  const inFocus = (u: Unit) => !sel || u.id === sel.id || (clusterRoot !== null && (u.id === clusterRoot || u.home === clusterRoot));

  return (
    <div className="graph" ref={boxRef} onPointerDown={() => onSelect(null)}>
      <div className="graph-world" ref={worldRef}>
        <svg className="graph-edges" aria-hidden>
          {edges.map((e) => (
            <line key={e.key} ref={(el) => { if (el) edgeEls.current.set(e.key, el); else edgeEls.current.delete(e.key); }}
              className={[!sel || e.source === clusterRoot ? '' : 'dim', hidden.has(e.target) ? 'faint' : ''].join(' ')} />
          ))}
        </svg>
        {live.map((u) => {
          const mini = hidden.has(u.id);
          const open = mini && (hoverRoot === rootIdOf(u) || clusterRoot === rootIdOf(u));
          const cls = ['unit', isRoot(u) ? 'is-claim' : '', mini ? 'collapsed' : '', open ? 'peek' : '',
            u.origin === 'model' ? 'is-model' : '', u.id === selectedId ? 'is-selected' : '', inFocus(u) ? '' : 'dim'].join(' ');
          return (
            <div key={u.id} className={cls} style={{ '--c': TYPE_INK[u.type] } as React.CSSProperties}
              ref={(el) => { if (el) nodeEls.current.set(u.id, el); else nodeEls.current.delete(u.id); }}
              onPointerDown={(e) => press(e, u.id)} onPointerEnter={() => enter(u)} onPointerLeave={leave}>
              {!mini && <>
                {!(u.type === 'claim' && !u.home) && <span className="kind">{u.type}</span>}
                <span className="lbl">{u.label}</span>
              </>}
              <div className="tip">{u.text}</div>
              {hiddenBy.has(u.id) && (hoverRoot === u.id || clusterRoot === u.id) && (
                <div className="more">
                  {hiddenBy.get(u.id)!.map((k) => (
                    <button key={k.id} className={`more-item ${k.id === selectedId ? 'on' : ''}`} style={{ color: TYPE_INK[k.type] }}
                      onPointerDown={(e) => { e.stopPropagation(); onSelect(k.id); }}>
                      <span className="kind">{k.type}</span> {k.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
