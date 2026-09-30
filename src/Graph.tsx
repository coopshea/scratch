import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Unit } from '../shared/types.ts';
import { isRoot, pickVisible } from '../shared/clusters.ts';
import { TYPE_INK } from './typeStyle.ts';
import { layoutCard, masonry, type Dim } from './cards.ts';

const PAD = 28;          // screen padding around the map
const MIN_READ = 0.8;    // text never renders smaller than this; past it the map pans instead of shrinking
const MAX_SCALE = 1.15;
const CARD_W = 270, GAP = 22;
const SOLO = '__solo';   // the column of lone roots and loose pieces, always rightmost

type Props = {
  units: Unit[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

/**
 * The Talk map: each cluster is a card (root on top, pieces flowing beneath), packed into masonry columns chosen
 * to fill the pane. Lone roots and loose pieces sit in their own muted column on the right. Deterministic, no
 * physics: the same content always lands in the same place. If even the smallest readable scale overflows,
 * the map pans (drag the background, or scroll) rather than shrinking the text.
 */
export function Graph({ units, selectedId, onSelect }: Props) {
  const live = useMemo(() => units.filter((u) => u.status !== 'cut'), [units]);
  const liveIds = useMemo(() => new Set(live.map((u) => u.id)), [live]);
  const kidsOf = useMemo(() => {
    const m = new Map<string, Unit[]>();
    for (const u of live) if (u.home && liveIds.has(u.home)) (m.get(u.home) ?? m.set(u.home, []).get(u.home)!).push(u);
    return m;
  }, [live, liveIds]);
  const clusters = useMemo(() => live.filter((u) => kidsOf.has(u.id)), [live, kidsOf]);
  const solo = useMemo(() => live.filter((u) => !(u.home && liveIds.has(u.home)) && !kidsOf.has(u.id)), [live, liveIds, kidsOf]);

  // Each card shows its root and up to four pieces; the rest collapse to dots. +N unfolds them; moving away folds.
  const [expanded, setExpanded] = useState<string | null>(null);
  const split = useMemo(() => new Map(clusters.map((r) => [r.id, pickVisible(kidsOf.get(r.id)!)])), [clusters, kidsOf]);
  const hidden = useMemo(() => new Set(clusters.flatMap((r) => (r.id === expanded ? [] : split.get(r.id)!.hidden.map((k) => k.id)))), [clusters, split, expanded]);
  const [hoverRoot, setHoverRoot] = useState<string | null>(null);

  const boxRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const nodeEls = useRef(new Map<string, HTMLDivElement>());
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  const unfurlEls = useRef(new Map<string, HTMLButtonElement>());
  const cardBoxes = useRef(new Map<string, [number, number, number, number]>());
  const view = useRef({ s: 1, tx: 0, ty: 0, px: 0, py: 0, cw: 0, ch: 0, W: 0, H: 0 });
  const foldTimer = useRef<number | undefined>(undefined);
  /** The folded layout's columns and scale; an unfolded card keeps them, so nothing else changes column or zooms. */
  const settled = useRef<{ cols: number; s: number; col: Map<string, number> } | null>(null);

  const applyView = () => {
    const v = view.current, world = worldRef.current; if (!world) return;
    // Pan only as far as there is content beyond the pane.
    const spareX = v.W - 2 * PAD - v.cw * v.s, spareY = v.H - 2 * PAD - v.ch * v.s;
    v.px = spareX >= 0 ? 0 : Math.min(0, Math.max(spareX, v.px));
    v.py = spareY >= 0 ? 0 : Math.min(0, Math.max(spareY, v.py));
    world.style.transform = `translate(${v.tx + v.px}px, ${v.ty + v.py}px) scale(${v.s})`;
    boxRef.current?.classList.toggle('pannable', spareX < 0 || spareY < 0);
  };

  const layout = () => {
    const box = boxRef.current; if (!box) return;
    const W = box.clientWidth, H = box.clientHeight; if (W <= 0 || H <= 0) return;
    const dim = (id: string): Dim => { const el = nodeEls.current.get(id); return { w: el?.offsetWidth ?? 120, h: el?.offsetHeight ?? 24 }; };
    const cards = clusters.map((r) => {
      const { shown, hidden: rest } = split.get(r.id)!;
      const open = r.id === expanded;
      const order = (open ? kidsOf.get(r.id)! : shown).map((k) => k.id);
      return { id: r.id, ...layoutCard(r.id, order, dim, CARD_W, open ? [] : rest.map((k) => k.id)) };
    });
    const soloCard = solo.length ? { id: SOLO, ...layoutCard(null, solo.map((u) => u.id), dim, CARD_W) } : null;
    const extraW = soloCard ? GAP + CARD_W : 0;
    const fit = (cols: number) => {
      const m = masonry(cards, cols, CARD_W, GAP);
      const cw = (cards.length ? m.width : -GAP) + extraW, ch = Math.max(m.height, soloCard?.h ?? 0);
      return { m, cw, ch, s: Math.min(MAX_SCALE, (W - 2 * PAD) / cw, (H - 2 * PAD) / ch) };
    };
    // Pick the column count that shows everything largest; below the readable floor, fit the width and pan.
    let best = fit(1);
    for (let c = 2; c <= Math.max(1, cards.length); c++) { const f = fit(c); if (f.s > best.s + 0.001) best = f; }
    if (best.s < MIN_READ) {
      const cols = Math.max(1, Math.floor(((W - 2 * PAD) / MIN_READ - extraW + GAP) / (CARD_W + GAP)));
      best = { ...fit(cols), s: MIN_READ };
    }
    const keep = expanded ? settled.current : null;
    if (keep) {
      // Same columns, same scale: stack each column in order, so only cards below the unfolded one move down.
      const heights = Array(keep.cols).fill(0), at = new Map<string, { x: number; y: number }>();
      for (const c of cards) {
        const i = keep.col.get(c.id) ?? heights.indexOf(Math.min(...heights));
        at.set(c.id, { x: i * (CARD_W + GAP), y: heights[i] }); heights[i] += c.h + GAP;
      }
      const width = keep.cols * CARD_W + (keep.cols - 1) * GAP;
      best = { m: { at, width, height: Math.max(...heights) - GAP }, cw: (cards.length ? width : -GAP) + extraW, ch: Math.max(Math.max(...heights) - GAP, soloCard?.h ?? 0), s: keep.s };
    }
    const { m, cw, ch, s } = best;
    if (!expanded) settled.current = { cols: Math.round((m.width + GAP) / (CARD_W + GAP)), s, col: new Map([...m.at].map(([id, p]) => [id, Math.round(p.x / (CARD_W + GAP))])) };
    const place = (cardId: string, x0: number, y0: number, card: { pos: Map<string, { x: number; y: number }>; h: number }) => {
      const el = cardEls.current.get(cardId);
      if (el) { el.style.transform = `translate(${x0}px, ${y0}px)`; el.style.width = `${CARD_W}px`; el.style.height = `${card.h}px`; }
      for (const [id, p] of card.pos) {
        const n = nodeEls.current.get(id), d = dim(id);
        if (n) n.style.transform = `translate(${x0 + p.x - d.w / 2}px, ${y0 + p.y - d.h / 2}px)`;
      }
      cardBoxes.current.set(cardId, [x0, y0, x0 + CARD_W, y0 + card.h]);
      const u = unfurlEls.current.get(cardId);
      if (u) u.style.transform = `translate(${x0 + CARD_W - 18}px, ${y0 + card.h - 12}px)`;
    };
    for (const c of cards) { const at = m.at.get(c.id)!; place(c.id, at.x, at.y, c); }
    if (soloCard) place(SOLO, cards.length ? m.width + GAP : 0, 0, soloCard);
    Object.assign(view.current, {
      s, W, H, cw, ch,
      tx: PAD + Math.max(0, (W - 2 * PAD - cw * s) / 2),
      ty: PAD + Math.max(0, (H - 2 * PAD - ch * s) / 2),
    });
    applyView();
    // Glide between layouts from now on; the first placement is instant.
    requestAnimationFrame(() => worldRef.current?.classList.add('ready'));
  };
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Lay out after every render that can change sizes or membership; labels are measured, never guessed.
  useLayoutEffect(() => { layout(); });
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => layoutRef.current());
    if (boxRef.current) ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, []);

  // New content folds any unfolded card.
  useEffect(() => { setExpanded(null); }, [live]);
  // Fold as soon as the writer goes somewhere else: Esc, or the pointer staying away from the unfolded card.
  useEffect(() => {
    if (!expanded) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(null); };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); window.clearTimeout(foldTimer.current); };
  }, [expanded]);
  const toWorld = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current!.getBoundingClientRect(), v = view.current;
    return { x: (e.clientX - r.left - v.tx - v.px) / v.s, y: (e.clientY - r.top - v.ty - v.py) / v.s };
  };
  const track = (e: React.PointerEvent) => {
    if (!expanded || !boxRef.current) return;
    const p = toWorld(e), b = cardBoxes.current.get(expanded), m = 24;
    const inside = !!b && p.x > b[0] - m && p.x < b[2] + m && p.y > b[1] - m && p.y < b[3] + m;
    window.clearTimeout(foldTimer.current);
    if (!inside) foldTimer.current = window.setTimeout(() => setExpanded(null), 600);
  };

  // Grab the background to pan; a press without movement clears the selection and folds.
  const pan = (e: React.PointerEvent) => {
    const el = boxRef.current!, start = { x: e.clientX, y: e.clientY }, from = { px: view.current.px, py: view.current.py };
    let moved = false;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
      if (!moved) { moved = true; worldRef.current?.classList.remove('ready'); el.classList.add('panning'); }
      view.current.px = from.px + ev.clientX - start.x; view.current.py = from.py + ev.clientY - start.y;
      applyView();
    };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
      el.classList.remove('panning');
      if (moved) worldRef.current?.classList.add('ready');
      else { onSelect(null); setExpanded(null); }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const wheel = (e: React.WheelEvent) => {
    worldRef.current?.classList.remove('ready');
    view.current.px -= e.deltaX; view.current.py -= e.deltaY;
    applyView();
  };

  // Selecting a node keeps everything visible and dims what is outside its cluster.
  const sel = live.find((u) => u.id === selectedId);
  const clusterRoot = sel ? (kidsOf.has(sel.id) ? sel.id : sel.home && liveIds.has(sel.home) ? sel.home : null) : null;
  const inFocus = (u: Unit) => !sel || u.id === sel.id || (clusterRoot !== null && (u.id === clusterRoot || u.home === clusterRoot));

  return (
    <div className="graph" ref={boxRef} onPointerDown={pan} onPointerMove={track} onWheel={wheel}>
      <div className="graph-world" ref={worldRef}>
        {clusters.map((r) => (
          <div key={`c-${r.id}`} className={['card', hoverRoot === r.id || clusterRoot === r.id ? 'on' : '', !sel || clusterRoot === r.id ? '' : 'dim'].join(' ')}
            ref={(el) => { if (el) cardEls.current.set(r.id, el); else cardEls.current.delete(r.id); }}
            onPointerEnter={() => setHoverRoot(r.id)} onPointerLeave={() => setHoverRoot((h) => (h === r.id ? null : h))} />
        ))}
        {solo.length > 0 && <div className="card solo-card" ref={(el) => { if (el) cardEls.current.set(SOLO, el); else cardEls.current.delete(SOLO); }} />}
        {live.map((u) => {
          const mini = hidden.has(u.id);
          const root = kidsOf.has(u.id);
          const cls = ['unit', isRoot(u) ? 'is-claim' : '', root || (u.home && liveIds.has(u.home)) ? 'clustered' : 'solo', mini ? 'collapsed' : '',
            u.origin === 'model' ? 'is-model' : '', u.id === selectedId ? 'is-selected' : '', inFocus(u) ? '' : 'dim'].join(' ');
          return (
            <div key={u.id} className={cls} data-type={u.type} style={{ '--c': TYPE_INK[u.type] } as React.CSSProperties}
              ref={(el) => { if (el) nodeEls.current.set(u.id, el); else nodeEls.current.delete(u.id); }}
              onPointerDown={(e) => e.stopPropagation()} onClick={() => onSelect(u.id)}>
              {!mini && <>
                {!(u.type === 'claim' && !u.home) && <span className="kind">{u.type}</span>}
                <span className="lbl">{u.label}</span>
                {u.source && <span className="src">{u.source.title || 'Readwise'}</span>}
              </>}
              <div className="tip">{u.text}</div>
            </div>
          );
        })}
        {clusters.filter((r) => split.get(r.id)!.hidden.length).map((r) => {
          const n = split.get(r.id)!.hidden.length, open = expanded === r.id;
          return (
            <button key={`u-${r.id}`} className={`unfurl ${open ? 'on' : ''}`} aria-label={open ? 'Fold cluster' : `Show ${n} more`} title={open ? 'fold' : `${n} more`}
              ref={(el) => { if (el) unfurlEls.current.set(r.id, el); else unfurlEls.current.delete(r.id); }}
              onPointerDown={(e) => { e.stopPropagation(); setExpanded(open ? null : r.id); }}>
              {open ? '−' : `+${n}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}
