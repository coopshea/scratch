import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
const HULL_PAD = 12;    // shaded area around a cluster

type Props = {
  units: Unit[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

export function Graph({ units, selectedId, onSelect }: Props) {
  const live = useMemo(() => units.filter((u) => u.status !== 'cut'), [units]);
  const liveIds = useMemo(() => new Set(live.map((u) => u.id)), [live]);
  const edges = useMemo(() => live.filter((u) => u.home && liveIds.has(u.home)).map((u) => ({ key: `${u.home}-${u.id}`, source: u.home!, target: u.id })), [live, liveIds]);
  // Each cluster shows its root and up to four pieces; the rest collapse to dots. The +N control on the corner of
  // its shaded area unfolds them all, pushing neighbors aside; moving away folds it back.
  const [expanded, setExpanded] = useState<string | null>(null);
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const r of live) if (isRoot(r)) { const n = pickVisible(live.filter((k) => k.home === r.id)).hidden.length; if (n) out.set(r.id, n); }
    return out;
  }, [live]);
  const hiddenBy = useMemo(() => {
    const out = new Map<string, Unit[]>();
    for (const r of live) {
      if (!isRoot(r) || r.id === expanded) continue;
      const h = pickVisible(live.filter((k) => k.home === r.id)).hidden;
      if (h.length) out.set(r.id, h);
    }
    return out;
  }, [live, expanded]);
  const hidden = useMemo(() => new Set([...hiddenBy.values()].flat().map((u) => u.id)), [hiddenBy]);
  const clusterIds = useMemo(() => [...new Set(live.flatMap((u) => (u.home && liveIds.has(u.home) ? [u.home] : [])))], [live, liveIds]);
  const holding = useMemo(() => new Set(clusterIds), [clusterIds]);
  const hullEls = useRef(new Map<string, SVGRectElement>());
  const [hoverRoot, setHoverRoot] = useState<string | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const rootIdOf = (u: Unit) => (u.home && liveIds.has(u.home) ? u.home : u.id);
  const enter = (u: Unit) => { window.clearTimeout(hoverTimer.current); setHoverRoot(rootIdOf(u)); };
  const leave = () => { window.clearTimeout(hoverTimer.current); hoverTimer.current = window.setTimeout(() => setHoverRoot(null), 250); };
  const unfurlEls = useRef(new Map<string, HTMLButtonElement>());
  const hullBoxes = useRef(new Map<string, [number, number, number, number]>());
  const foldTimer = useRef<number | undefined>(undefined);
  /** Positions saved when a cluster unfolds; folding glides back to them exactly, so the layout never drifts. */
  const snapshot = useRef<Map<string, { x: number; y: number }> | null>(null);
  const frozen = useRef(false);
  const anim = useRef<number | undefined>(undefined);
  // Fold back as soon as the writer goes somewhere else: Esc, or the pointer staying outside the unfolded area.
  useEffect(() => {
    if (!expanded) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(null); };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); window.clearTimeout(foldTimer.current); };
  }, [expanded]);
  const track = (e: React.PointerEvent) => {
    if (!expanded || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect(), { s, tx, ty } = view.current;
    const x = (e.clientX - r.left - tx) / s, y = (e.clientY - r.top - ty) / s;
    const b = hullBoxes.current.get(expanded), m = HULL_PAD + 24;
    const inside = !!b && x > b[0] - m && x < b[2] + m && y > b[1] - m && y < b[3] + m;
    window.clearTimeout(foldTimer.current);
    if (!inside) foldTimer.current = window.setTimeout(() => setExpanded(null), 600);
  };

  const boxRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const nodeEls = useRef(new Map<string, HTMLDivElement>());
  const edgeEls = useRef(new Map<string, SVGLineElement>());
  const simNodes = useRef(new Map<string, SimNode>());
  const sim = useRef<Simulation<SimNode, SimLink> | null>(null);
  const view = useRef({ s: 1, aspect: 1.5, tx: 0, ty: 0 });
  const first = useRef(true);

  const paint = () => {
    const box = boxRef.current, world = worldRef.current;
    if (!box || !world || !sim.current) return;
    const ns = sim.current.nodes();
    if (!frozen.current) resolveOverlaps(ns);
    for (const n of ns) {
      const el = nodeEls.current.get(n.id);
      if (el) el.style.transform = `translate(${n.x! - n.w / 2}px, ${n.y! - n.h / 2}px)`;
    }
    for (const l of sim.current.force<ReturnType<typeof forceLink<SimNode, SimLink>>>('link')!.links()) {
      const el = edgeEls.current.get(l.key), s = l.source as SimNode, t = l.target as SimNode;
      if (el) { el.setAttribute('x1', String(s.x)); el.setAttribute('y1', String(s.y)); el.setAttribute('x2', String(t.x)); el.setAttribute('y2', String(t.y)); }
    }
    // Common region: a faint shaded area behind each cluster, the strongest cue that its pieces belong together.
    const boxes = new Map<string, [number, number, number, number]>();
    for (const n of ns) {
      if (!n.group) continue;
      const b = boxes.get(n.group) ?? [Infinity, Infinity, -Infinity, -Infinity];
      boxes.set(n.group, [Math.min(b[0], n.x! - n.w / 2), Math.min(b[1], n.y! - n.h / 2), Math.max(b[2], n.x! + n.w / 2), Math.max(b[3], n.y! + n.h / 2)]);
    }
    hullBoxes.current = boxes;
    for (const [id, el] of unfurlEls.current) {
      const b = boxes.get(id); if (!b) continue;
      el.style.transform = `translate(${b[2] + HULL_PAD - 12}px, ${b[3] + HULL_PAD - 12}px)`;
    }
    for (const [id, el] of hullEls.current) {
      const b = boxes.get(id); if (!b) continue;
      el.setAttribute('x', String(b[0] - HULL_PAD)); el.setAttribute('y', String(b[1] - HULL_PAD));
      el.setAttribute('width', String(b[2] - b[0] + 2 * HULL_PAD)); el.setAttribute('height', String(b[3] - b[1] + 2 * HULL_PAD));
    }
    if (!ns.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of ns) { x0 = Math.min(x0, n.x! - n.w / 2); x1 = Math.max(x1, n.x! + n.w / 2); y0 = Math.min(y0, n.y! - n.h / 2); y1 = Math.max(y1, n.y! + n.h / 2); }
    const W = box.clientWidth, H = box.clientHeight;
    // Clamped: before layout the pane can measure 0 tall, and an unbounded ratio would blow up the forces.
    if (W > 0 && H > 0) view.current.aspect = Math.min(2.5, Math.max(0.6, W / H));
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, (W - 2 * PAD) / (x1 - x0), (H - 2 * PAD) / (y1 - y0)));
    view.current.s = s;
    const tx = W / 2 - ((x0 + x1) / 2) * s, ty = H / 2 - ((y0 + y1) / 2) * s;
    view.current.tx = tx; view.current.ty = ty;
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  };

  // One simulation for the component's life. Layout effect, so it exists before the first sync below.
  useLayoutEffect(() => {
    const s = forceSimulation<SimNode, SimLink>([])
      .force('link', forceLink<SimNode, SimLink>([]).id((d) => d.id).distance((l) => ((l.target as SimNode).mini ? 34 : 60)).strength(0.7))
      .force('charge', forceManyBody<SimNode>().strength((d) => (!d.group ? -30 : d.claim ? -420 : d.mini ? -40 : -140)))
      // Clusters pull to the center; solo nodes are placed by their column instead.
      .force('x', forceX<SimNode>(0).strength((d) => (!d.group ? 0 : (d.claim ? 0.09 : 0.03) / Math.max(1, view.current.aspect))))
      .force('y', forceY<SimNode>(0).strength((d) => (!d.group ? 0 : (d.claim ? 0.13 : 0.05) * Math.max(1, view.current.aspect))))
      .force('clusters', separateGroups(48, 0.5, () => view.current.aspect))
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

  // New content resets any unfolded cluster: the simulation owns the layout again.
  useEffect(() => { snapshot.current = null; frozen.current = false; setExpanded(null); }, [live]);

  /** Glide every node to its target over a short ease-out, instead of letting physics oscillate. */
  const glide = (targets: Map<string, { x: number; y: number }>, done?: () => void) => {
    const ns = sim.current?.nodes() ?? [];
    const from = new Map(ns.map((n) => [n.id, { x: n.x!, y: n.y! }]));
    cancelAnimationFrame(anim.current!);
    const place = (e: number) => {
      for (const n of ns) { const a = from.get(n.id)!, b = targets.get(n.id); if (b) { n.x = a.x + (b.x - a.x) * e; n.y = a.y + (b.y - a.y) * e; } }
      paint();
    };
    if (document.hidden) { place(1); done?.(); return; } // animation frames are paused in hidden tabs
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 280);
      place(1 - Math.pow(1 - k, 3));
      if (k < 1) anim.current = requestAnimationFrame(step); else done?.();
    };
    anim.current = requestAnimationFrame(step);
  };

  // Unfold and fold without re-running physics: freeze, lay out the unfolded cluster, slide aside only what is in the way.
  useLayoutEffect(() => {
    const s = sim.current; if (!s) return;
    const ns = s.nodes();
    if (!expanded) {
      if (!snapshot.current) return;
      const back = snapshot.current; snapshot.current = null;
      for (const n of ns) { const el = nodeEls.current.get(n.id); if (el) { n.w = el.offsetWidth; n.h = el.offsetHeight; } n.mini = hidden.has(n.id); }
      glide(back, () => { frozen.current = false; });
      return;
    }
    s.stop(); frozen.current = true;
    snapshot.current ??= new Map(ns.map((n) => [n.id, { x: n.x!, y: n.y! }]));
    const base = snapshot.current;
    for (const n of ns) { const el = nodeEls.current.get(n.id); if (el) { n.w = el.offsetWidth; n.h = el.offsetHeight; } n.mini = false; }
    const targets = new Map(base);
    const members = ns.filter((n) => n.group === expanded);
    const wasHidden = new Set(pickVisible(live.filter((k) => k.home === expanded)).hidden.map((k) => k.id));
    // The visible part keeps its place; the unfolded pieces fill rows under it, as wide as the cluster.
    const shown = members.filter((n) => !wasHidden.has(n.id));
    const box = (list: typeof ns, at: Map<string, { x: number; y: number }>) => list.reduce((b, n) => {
      const p = at.get(n.id)!; return [Math.min(b[0], p.x - n.w / 2), Math.min(b[1], p.y - n.h / 2), Math.max(b[2], p.x + n.w / 2), Math.max(b[3], p.y + n.h / 2)];
    }, [Infinity, Infinity, -Infinity, -Infinity]);
    const [bx0, , bx1, by1] = box(shown, base);
    const width = Math.max(bx1 - bx0, 260);
    let x = bx0, y = by1 + 16, line = 0;
    for (const n of members.filter((m) => wasHidden.has(m.id))) {
      if (x > bx0 && x + n.w > bx0 + width) { x = bx0; y += line + 10; line = 0; }
      targets.set(n.id, { x: x + n.w / 2, y: y + n.h / 2 });
      x += n.w + 16; line = Math.max(line, n.h);
    }
    // Everything else moves as rigid blocks (a cluster, or one solo node), only as far as needed to clear.
    const B = box(members, targets), GAP = 36;
    const blocks = new Map<string, typeof ns>();
    for (const n of ns) { if (n.group === expanded) continue; const k = n.group ?? `solo-${n.id}`; (blocks.get(k) ?? blocks.set(k, []).get(k)!).push(n); }
    let fixed: { key: string; b: number[] }[] = [{ key: expanded, b: B }];
    for (let pass = 0; pass < 24; pass++) {
      let moved = false;
      for (const [key, list] of blocks) {
        for (const { key: fk, b: F } of fixed) {
          if (fk === key) continue;
          const b = box(list, targets);
          const ox = Math.min(b[2], F[2]) - Math.max(b[0], F[0]) + GAP, oy = Math.min(b[3], F[3]) - Math.max(b[1], F[1]) + GAP;
          if (ox <= 0 || oy <= 0) continue;
          const dx = (b[0] + b[2]) / 2 - (F[0] + F[2]) / 2, dy = (b[1] + b[3]) / 2 - (F[1] + F[3]) / 2;
          const [mx, my] = ox / view.current.aspect < oy ? [ox * (dx < 0 ? -1 : 1), 0] : [0, oy * (dy < 0 ? -1 : 1)];
          for (const n of list) { const p = targets.get(n.id)!; targets.set(n.id, { x: p.x + mx, y: p.y + my }); }
          moved = true;
        }
      }
      // Blocks that moved can now collide with each other: treat each settled block as fixed for the next pass.
      fixed = [{ key: expanded, b: B }, ...[...blocks].map(([key, list]) => ({ key, b: box(list, targets) }))];
      if (!moved) break;
    }
    glide(targets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

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
      if (!moved) { moved = true; frozen.current = false; snapshot.current = null; sim.current!.alphaTarget(0.25).restart(); }
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
    <div className="graph" ref={boxRef} onPointerDown={() => { onSelect(null); setExpanded(null); }} onPointerMove={track}>
      <div className="graph-world" ref={worldRef}>
        <svg className="graph-edges" aria-hidden>
          {clusterIds.map((id) => (
            <rect key={`h-${id}`} rx={10} className={`hull ${hoverRoot === id || clusterRoot === id ? 'on' : ''} ${!sel || clusterRoot === id ? '' : 'dim'}`}
              ref={(el) => { if (el) hullEls.current.set(id, el); else hullEls.current.delete(id); }} />
          ))}
          {edges.map((e) => (
            <line key={e.key} ref={(el) => { if (el) edgeEls.current.set(e.key, el); else edgeEls.current.delete(e.key); }}
              className={[!sel || e.source === clusterRoot ? '' : 'dim', hidden.has(e.target) ? 'faint' : ''].join(' ')} />
          ))}
        </svg>
        {live.map((u) => {
          const mini = hidden.has(u.id);
          const inCluster = (u.home && liveIds.has(u.home)) || holding.has(u.id);
          const cls = ['unit', isRoot(u) ? 'is-claim' : '', inCluster ? 'clustered' : 'solo', mini ? 'collapsed' : '',
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
            </div>
          );
        })}
        {[...counts.entries()].map(([id, n]) => (
          <button key={`u-${id}`} className={`unfurl ${expanded === id ? 'on' : ''}`}
            aria-label={expanded === id ? 'Fold cluster' : `Show ${n} more`} title={expanded === id ? 'fold' : `${n} more`}
            ref={(el) => { if (el) unfurlEls.current.set(id, el); else unfurlEls.current.delete(id); }}
            onPointerDown={(e) => { e.stopPropagation(); setExpanded(expanded === id ? null : id); }}>
            {expanded === id ? '−' : `+${n}`}
          </button>
        ))}
      </div>
    </div>
  );
}
