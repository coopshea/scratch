import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Unit } from '../shared/types.ts';
import { isRoot } from '../shared/clusters.ts';
import {
  STRUCTURES, SUPPORT_TITLE, reslot, support, type Board, type StructureDef, type StructureId,
} from '../shared/structures.ts';
import { archetypes } from './api.ts';
import { LevelPicker } from './LevelPicker.tsx';
import { slugify, type Lane, type Role } from '../shared/structures.ts';
import { UNIT_TYPES } from '../shared/types.ts';
import { inkOf } from './typeStyle.ts';
import { layoutCard, masonry } from './cards.ts';
import { posthog } from './posthog.ts';

const LABEL_W = 180;     // outline column at far left
const MID = 0.5;        // drop left of this to lock into a level, right of it to release
const LOCKED_MAX = 0.48; // placed rows wrap before this, leaving the right side to the loose pool
const LOOSE_MIN = 0.5;   // loose clusters float right of this
const MIN_BAND = 88;
const MARK = { none: '○', unchecked: '◐', checked: '●' } as const;

type Props = {
  units: Unit[];
  board: Board;
  onBoard: (b: Board) => void;
  onSelect: (id: string | null) => void;
  selectedId: string | null;
  readOnly?: boolean;
  structures: Record<string, StructureDef>;
  onCustom: (list: StructureDef[]) => void;
  /** The button on to the next stage, at the right of the outline bar. */
  next?: React.ReactNode;
};

export function Structure({ units, board, onBoard, onSelect, selectedId, readOnly = false, structures, onCustom, next }: Props) {
  const live = useMemo(() => units.filter((u) => u.status !== 'cut'), [units]);
  const byId = useMemo(() => new Map(live.map((u) => [u.id, u])), [live]);
  const sid = board.structure;
  const def = structures[sid] ?? STRUCTURES.persuasive;
  const lanes = def.lanes;
  const [adding, setAdding] = useState(false);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [reorder, setReorder] = useState<{ from: number; to: number } | null>(null);
  const [dialog, setDialog] = useState<{ id?: string; name: string; outline: string; error?: string } | null>(null);
  const assign = board.lanes[sid] ?? {};

  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ W: 800, H: 600 });
  const poolX = Math.round(size.W * MID);

  // Which lane each unit is placed in, and its order there.
  const placedAt = useMemo(() => {
    const m = new Map<string, { lane: number; order: number }>();
    lanes.forEach((l, i) => (assign[l.id] ?? []).filter((id) => byId.has(id)).forEach((id, order) => m.set(id, { lane: i, order })));
    return m;
  }, [lanes, assign, byId]);

  /** The unit a node travels with: itself if placed or a root; otherwise its claim. */
  const rootOf = (u: Unit): Unit => (placedAt.has(u.id) || !u.home || !byId.has(u.home) ? u : rootOf(byId.get(u.home)!));

  const nodeEls = useRef(new Map<string, HTMLDivElement>());

  /**
   * Placed rows are laid out, not simulated. Each cluster is one horizontal line: its root at the left, its pieces
   * running to the right, wrapping under the first piece only when the row runs out of width. Each new cluster
   * starts a new line, so a row grows downward cluster by cluster. A piece placed in the same row as its root
   * rejoins that root's line; placed anywhere else, it stands on its own line with a thread back to its root.
   */
  // The pool starts below its title, POOL_TOP from the top.
  const GAP_X = 18, GAP_Y = 10, LINE_GAP = 22, PAD_Y = 16, POOL_TOP = 46, LEFT = LABEL_W + 30;
  // Layout needs real label sizes: recompute once the nodes for the current content exist in the page.
  const [measured, setMeasured] = useState(0);
  useLayoutEffect(() => { setMeasured((n) => n + 1); }, [live]);
  const { bandTop, bandHt, totalH, slots, poolCards } = useMemo(() => {
    const base = Math.max(MIN_BAND, size.H / lanes.length);
    const right = size.W * LOCKED_MAX;
    const dims = (id: string) => ({ w: nodeEls.current.get(id)?.offsetWidth ?? 140, h: nodeEls.current.get(id)?.offsetHeight ?? 32 });
    const local = lanes.map(() => new Map<string, { x: number; y: number }>());
    const heights = lanes.map(() => base);
    const byLane = lanes.map(() => [] as string[]);
    for (const [id, p] of [...placedAt.entries()].sort((a, b) => a[1].order - b[1].order)) byLane[p.lane].push(id);
    byLane.forEach((ids, li) => {
      const here = new Set(ids);
      let y = PAD_Y;
      for (const id of ids) {
        const u = byId.get(id);
        if (u?.home && here.has(u.home)) continue; // travels on its root's line
        const kids = live.filter((k) => k.home === id && (!placedAt.has(k.id) || here.has(k.id))).map((k) => k.id);
        const root = dims(id);
        local[li].set(id, { x: LEFT + root.w / 2, y: y + root.h / 2 });
        const start = LEFT + root.w + GAP_X;
        let x = start, lineTop = y, lineH = root.h;
        for (const c of kids) {
          const d = dims(c);
          if (x > start && x + d.w > right) { lineTop += lineH + GAP_Y; x = start; lineH = 0; }
          local[li].set(c, { x: x + d.w / 2, y: lineTop + d.h / 2 });
          x += d.w + GAP_X; lineH = Math.max(lineH, d.h);
        }
        y = lineTop + lineH + LINE_GAP;
      }
      heights[li] = Math.max(base, y - LINE_GAP + PAD_Y);
    });
    const bandTop = heights.map((_, i) => heights.slice(0, i).reduce((a, b) => a + b, 0));
    const slots = new Map<string, { x: number; y: number; band?: [number, number] }>();
    local.forEach((m, li) => m.forEach((p, id) => slots.set(id, { x: p.x, y: bandTop[li] + p.y, band: [bandTop[li], bandTop[li] + heights[li]] })));
    // The loose pool: the same cluster cards as Talk, in two masonry columns on the right. Every unplaced root is a
    // card with its unplaced pieces; a lone root or loose piece is a card of one.
    const poolLeft = size.W * MID + 24, COL_GAP = 16;
    const room = size.W - poolLeft - 20;
    const poolCols = room >= 2 * 180 + COL_GAP ? 2 : 1;
    const colW = Math.max(160, (room - (poolCols - 1) * COL_GAP) / poolCols);
    const loose = live.filter((u) => !placedAt.has(u.id) && !(u.home && byId.has(u.home)));
    const cards = loose.map((r) => ({ id: r.id, ...layoutCard(r.id, live.filter((k) => k.home === r.id && !placedAt.has(k.id)).map((k) => k.id), dims, colW) }));
    const m = masonry(cards, poolCols, colW, COL_GAP);
    const poolCards = cards.map((c) => ({ id: c.id, x: poolLeft + m.at.get(c.id)!.x, y: POOL_TOP + m.at.get(c.id)!.y, w: colW, h: c.h }));
    for (const c of cards) {
      const at = m.at.get(c.id)!;
      for (const [id, p] of c.pos) if (!slots.has(id)) slots.set(id, { x: poolLeft + at.x + p.x, y: POOL_TOP + at.y + p.y });
    }
    const rowsH = heights.reduce((a, b) => a + b, 0);
    return { bandTop, bandHt: heights, totalH: Math.max(rowsH, m.height + POOL_TOP + PAD_Y), slots, poolCards };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanes, live, placedAt, size.H, size.W, measured]);

  /** Units pulled out of their cluster keep a faint thread back to their claim; it does not pull them. */
  const threads = useMemo(() => live.filter((u) => u.home && byId.has(u.home) && placedAt.has(u.id)
      && placedAt.get(u.home)?.lane !== placedAt.get(u.id)!.lane)
    .map((u) => ({ key: `t-${u.home}-${u.id}`, a: u.home!, b: u.id })), [live, byId, placedAt]);

  const threadEls = useRef(new Map<string, SVGLineElement>());
  /** Where each unit is drawn: its centre and size. The one being dragged follows the pointer instead. */
  const drawn = useRef(new Map<string, { x: number; y: number; w: number; h: number }>());
  const drag = useRef<{ id: string; x: number; y: number } | null>(null);
  const [hoverBand, setHoverBand] = useState<{ i: number; ok: boolean } | null>(null);
  const [dragOn, setDragOn] = useState(false);

  /** Write positions straight to the page: no simulation, the same arrangement always lands in the same place. */
  const paint = () => {
    const pos = (id: string) => (drag.current?.id === id ? drag.current : drawn.current.get(id));
    for (const [id, p] of drawn.current) {
      const el = nodeEls.current.get(id), q = pos(id)!;
      if (el) el.style.transform = `translate(${q.x - p.w / 2}px, ${q.y - p.h / 2}px)`;
    }
    for (const th of threads) {
      const el = threadEls.current.get(th.key), a = pos(th.a), b = pos(th.b);
      if (el && a && b) { el.setAttribute('x1', String(a.x)); el.setAttribute('y1', String(a.y)); el.setAttribute('x2', String(b.x)); el.setAttribute('y2', String(b.y)); }
    }
  };

  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => {
      const b = boxRef.current; if (b) setSize({ W: b.clientWidth, H: b.clientHeight });
    });
    if (boxRef.current) { ro.observe(boxRef.current); setSize({ W: boxRef.current.clientWidth, H: boxRef.current.clientHeight }); }
    return () => ro.disconnect();
  }, []);

  // Place every unit at its slot, kept inside its region (placed: its band, left of the pool; loose: the pool).
  // Runs after every render, so the page is complete even while animation frames are paused.
  useLayoutEffect(() => {
    const W = size.W, next = new Map<string, { x: number; y: number; w: number; h: number }>();
    const pool = { x: W * 0.78, y: totalH / 2 };
    for (const u of live) {
      const el = nodeEls.current.get(u.id);
      const w = el?.offsetWidth ?? 120, h = el?.offsetHeight ?? 24;
      const slot = slots.get(u.id) ?? slots.get(rootOf(u).id), band = slot?.band;
      const placed = !!band;
      const minX = (placed ? LABEL_W : W * LOOSE_MIN) + w / 2 + 8, maxX = (placed ? W * LOCKED_MAX : W) - w / 2 - 8;
      const x = Math.min(Math.max(slot?.x ?? pool.x, minX), Math.max(minX, maxX));
      const y = band
        ? Math.min(Math.max(slot!.y, band[0] + h / 2 + 6), Math.max(band[0] + h / 2 + 6, band[1] - h / 2 - 6))
        : Math.min(Math.max(slot?.y ?? pool.y, h / 2 + 6), totalH - h / 2 - 6);
      next.set(u.id, { x, y, w, h });
    }
    drawn.current = next;
    paint();
  });

  const canvasPoint = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left + boxRef.current!.scrollLeft, y: e.clientY - r.top + boxRef.current!.scrollTop };
  };

  const place = (id: string, laneIdx: number | null, x: number) => {
    const next: Record<string, string[]> = Object.fromEntries(Object.entries(assign).map(([k, v]) => [k, v.filter((z) => z !== id)]));
    if (laneIdx !== null) {
      const lane = lanes[laneIdx];
      const others = (next[lane.id] ?? []).filter((z) => byId.has(z));
      // The writer's placement wins: no type or slot limits, just order by where it was dropped.
      const at = others.findIndex((z) => (drawn.current.get(z)?.x ?? 0) > x);
      next[lane.id] = at < 0 ? [...others, id] : [...others.slice(0, at), id, ...others.slice(at)];
    }
    onBoard({ ...board, lanes: { ...board.lanes, [sid]: next } });
    posthog?.capture('unit_placed', { destination: laneIdx === null ? 'ideas_pool' : 'outline_level' });
  };

  const press = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const n = drawn.current.get(id), u = byId.get(id);
    if (!n || !u) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const start = canvasPoint(e), ox = n.x, oy = n.y;
    let moved = false;
    const bandAt = (y: number) => { const i = bandTop.findIndex((t, k) => y >= t && y < t + bandHt[k]); return i < 0 ? lanes.length - 1 : i; };
    const move = (ev: PointerEvent) => {
      const p = canvasPoint(ev);
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < 4) return;
      if (!moved) { moved = true; setDragOn(true); }
      last = ev;
      follow();
      edgeScroll();
    };
    // The dragged item follows the pointer in canvas coordinates, which change as the pane scrolls under it.
    let last: { clientX: number; clientY: number } = e;
    const follow = () => {
      const p = canvasPoint(last);
      drag.current = { id, x: ox + p.x - start.x, y: oy + p.y - start.y };
      paint();
      setHoverBand(p.x < poolX ? { i: bandAt(p.y), ok: true } : null);
    };
    // Auto-scroll: holding the pointer near the top or bottom edge scrolls the pane, faster the closer it is.
    // A 60 Hz timer, not animation frames: frames pause in background tabs, a timer keeps going.
    let timer = 0;
    const EDGE = 70, MAX = 16;
    const edgeScroll = () => {
      if (timer) return;
      const step = () => {
        const box = boxRef.current; timer = 0;
        if (!box || !drag.current) return;
        const r = box.getBoundingClientRect();
        const near = last.clientY < r.top + EDGE ? -(1 - (last.clientY - r.top) / EDGE) : last.clientY > r.bottom - EDGE ? 1 - (r.bottom - last.clientY) / EDGE : 0;
        if (!near) return;
        const before = box.scrollTop;
        box.scrollTop += Math.sign(near) * Math.ceil(MAX * Math.min(1, Math.abs(near)) ** 2);
        if (box.scrollTop === before) return; // at the end: stop
        follow();
        timer = window.setTimeout(step, 16);
      };
      timer = window.setTimeout(step, 16);
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      drag.current = null;
      window.clearTimeout(timer); timer = 0;
      setHoverBand(null);
      setDragOn(false);
      paint(); // back to its slot until the new arrangement lays it out
      if (!moved) { onSelect(id); return; }
      if (readOnly) return;
      const p = canvasPoint(ev);
      if (p.x >= poolX) { if (placedAt.has(id)) place(id, null, p.x); return; }
      place(id, bandAt(p.y), p.x);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const switchTo = (to: StructureId) => {
    if (to === sid || readOnly || !structures[to]) return;
    const has = Object.values(board.lanes[to] ?? {}).some((a) => a.length);
    onBoard({ structure: to, lanes: { ...board.lanes, [to]: has ? board.lanes[to] : reslot(board, structures[sid], structures[to], live) } });
    posthog?.capture('outline_changed', { outline_type: structures[to].custom ? 'custom' : 'built_in' });
  };

  const saveOutline = async () => {
    if (!dialog) return;
    if (!dialog.name.trim()) { setDialog({ ...dialog, error: 'Name it first' }); return; }
    if (!dialog.outline.trim()) { setDialog({ ...dialog, error: 'Add at least one level' }); return; }
    try {
      const saved = await archetypes.save({ id: dialog.id, name: dialog.name, outline: dialog.outline });
      posthog?.capture('custom_outline_saved', { operation: dialog.id ? 'updated' : 'created' });
      onCustom(await archetypes.list());
      setDialog(null);
      if (saved.id !== sid) {
        const has = Object.values(board.lanes[saved.id] ?? {}).some((a) => a.length);
        onBoard({ structure: saved.id, lanes: { ...board.lanes, [saved.id]: has ? board.lanes[saved.id] : reslot(board, structures[sid], saved, live) } });
      }
    } catch (e) { setDialog({ ...dialog, error: (e as Error).message }); }
  };

  /** Add a level where the outline lives. Built-in outlines are templates: the first edit saves the writer's own copy. */
  /**
   * Save an edited list of levels. Your own outline is updated in place; a built-in's first edit saves your own copy
   * with every placement carried over. `dropLane` is a removed level, whose placements return to the pool.
   */
  const commitLanes = async (next: Lane[], dropLane?: string) => {
    try {
      const saved = await archetypes.save(def.custom ? { id: def.id, name: def.name, lanes: next } : { name: copyName(), lanes: next });
      onCustom(await archetypes.list());
      if (saved.id !== sid || dropLane) {
        const carried = Object.fromEntries(Object.entries(board.lanes[sid] ?? {}).filter(([k]) => k !== dropLane));
        onBoard({ structure: saved.id, lanes: { ...board.lanes, [saved.id]: carried } });
      }
    } catch (e) { setDialog({ name: def.name, outline: '', error: (e as Error).message }); }
  };

  /** Add a level: at `at` if given (inserted from a divider), else next to its own kind, before the closing levels. */
  const addLevel = async (name: string, role: Role = 'point', at?: number) => {
    setAdding(false); setInsertAt(null);
    const clean = name.trim().toLowerCase();
    if (!clean || readOnly) return;
    let id = slugify(clean) || 'level';
    for (let i = 2; lanes.some((l) => l.id === id); i++) id = `${slugify(clean) || 'level'}-${i}`;
    const lane: Lane = { id, name: clean, role, accepts: [...UNIT_TYPES], single: false, required: false };
    const sameKind = lanes.map((l) => l.role).lastIndexOf(role);
    const closing = lanes.findIndex((l) => l.role === 'close' || l.role === 'footnote');
    const pos = at ?? (role === 'footnote' ? lanes.length : sameKind >= 0 ? sameKind + 1 : closing >= 0 ? closing : lanes.length);
    await commitLanes([...lanes.slice(0, pos), lane, ...lanes.slice(pos)]);
  };

  /**
   * Press a level's name: a click renames it, a drag reorders it. While dragging, a line shows where it will land.
   * Levels keep their ids, so everything placed in them moves with them.
   */
  const pressLevel = (e: React.PointerEvent, from: number) => {
    e.stopPropagation();
    if (readOnly) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    let to: number | null = null;
    const slotAt = (y: number) => {
      const i = bandTop.findIndex((t, k) => y < t + bandHt[k] / 2);
      return i < 0 ? lanes.length : i;
    };
    const move = (ev: PointerEvent) => {
      if (to === null && Math.abs(ev.clientY - startY) < 5) return;
      to = slotAt(canvasPoint(ev).y);
      setReorder({ from, to });
    };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
      setReorder(null);
      if (to === null) { setRenaming(lanes[from].id); return; }
      if (to === from || to === from + 1) return;
      const next = [...lanes];
      const [moved] = next.splice(from, 1);
      next.splice(to > from ? to - 1 : to, 0, moved);
      commitLanes(next);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  /** Rename a level in place. It keeps its id, so everything placed in it stays. */
  const renameLevel = async (laneId: string, name: string) => {
    setRenaming(null);
    const clean = name.trim().toLowerCase().slice(0, 60);
    const lane = lanes.find((l) => l.id === laneId);
    if (!clean || !lane || clean === lane.name || readOnly) return;
    await commitLanes(lanes.map((l) => (l.id === laneId ? { ...l, name: clean } : l)));
  };

  /** The name for your own copy of a built-in: "my paper", then "my paper 2" if that is taken. */
  const copyName = () => {
    const taken = new Set(Object.values(structures).map((s) => s.name));
    let name = `my ${def.name}`;
    for (let i = 2; taken.has(name); i++) name = `my ${def.name} ${i}`;
    return name;
  };

  /** Removing a whole outline asks twice: the × turns into "delete?" for a few seconds. Built-ins are templates and stay. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const confirmTimer = useRef<number | undefined>(undefined);
  const askRemoveOutline = (id: string) => {
    window.clearTimeout(confirmTimer.current);
    if (confirming === id) { setConfirming(null); removeOutlineId(id); return; }
    setConfirming(id);
    confirmTimer.current = window.setTimeout(() => setConfirming(null), 3000);
  };
  const removeOutlineId = async (id: string) => {
    await archetypes.remove(id);
    onCustom(await archetypes.list());
    if (sid === id) onBoard({ ...board, structure: 'persuasive' });
  };

  /** Remove a level, no confirmation: levels are cheap to recreate. Whatever was placed there returns to the pool. */
  const removeLevel = async (laneId: string) => {
    if (readOnly || lanes.length <= 1) return;
    await commitLanes(lanes.filter((l) => l.id !== laneId), laneId);
  };

  const removeOutline = async () => {
    if (!dialog?.id) return;
    await archetypes.remove(dialog.id);
    onCustom(await archetypes.list());
    setDialog(null);
    if (sid === dialog.id) onBoard({ ...board, structure: 'persuasive' });
  };

  const sel = selectedId ? byId.get(selectedId) : undefined;
  const selRoot = sel ? rootOf(sel).id : null;

  return (
    <div className="structure">
      <nav className="structure-bar">
        <div className="seg">
        {Object.values(structures).map((s) => (
          <span key={s.id} className="outline-tab">
            <button className={`stage ${s.id === sid ? 'on' : ''}`} onClick={() => switchTo(s.id)}
              onDoubleClick={() => s.custom && !readOnly && setDialog({ id: s.id, name: s.name, outline: s.lanes.map((l) => l.name).join('\n') })}>{s.name}</button>
            {s.custom && !readOnly && (
              <button className={`remove ${confirming === s.id ? 'confirm' : ''}`} aria-label={confirming === s.id ? `Confirm delete ${s.name}` : `Remove ${s.name}`}
                onClick={() => askRemoveOutline(s.id)}>{confirming === s.id ? 'delete?' : '×'}</button>
            )}
          </span>
        ))}
        {!readOnly && <button className="stage add" onClick={() => setDialog({ name: '', outline: '' })} aria-label="Make your own outline" title="Make your own outline">+</button>}
        </div>
        <span className="spacer" />
        {next}
      </nav>
      {dialog && (
        <div className="outline-dialog" onKeyDown={(e) => { if (e.key === 'Escape') setDialog(null); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveOutline(); }}>
          <input autoFocus placeholder="name" value={dialog.name} onChange={(e) => setDialog({ ...dialog, name: e.target.value, error: undefined })} />
          <textarea rows={Math.max(6, dialog.outline.split('\n').length + 1)} placeholder={'one level per line\n\nhook\nthesis\nargument 1\nargument 2\nconclusion'}
            value={dialog.outline} onChange={(e) => setDialog({ ...dialog, outline: e.target.value, error: undefined })} />
          {dialog.error && <p className="error">{dialog.error}</p>}
          <div className="dialog-bar">
            {dialog.id && <button className="link muted" onClick={removeOutline}>delete</button>}
            <span className="spacer" />
            <button className="link muted" onClick={() => setDialog(null)}>cancel</button>
            <button className="link" onClick={saveOutline}>{dialog.id ? 'save' : 'use'}</button>
          </div>
        </div>
      )}
      <div className="levels" ref={boxRef} onPointerDown={() => onSelect(null)}>
        <div className="levels-canvas" style={{ height: totalH + 56 }}>
          {lanes.map((l, i) => {
            const filled = (assign[l.id] ?? []).some((id) => byId.has(id));
            const hb = hoverBand?.i === i ? (hoverBand.ok ? 'accept' : 'reject') : '';
            return (
              <div key={l.id} className={`level ${hb}`} style={{ top: bandTop[i], height: bandHt[i], right: 'auto', width: poolX }}>
                {/* The level's own controls live in this zone around its name, and only show while the pointer is in it. */}
                <div className="level-head">
                <span className={`level-name ${l.required && !filled && placedAt.size ? 'gap' : ''}`} style={{ top: 34 }} onPointerDown={(e) => e.stopPropagation()}>
                  {renaming === l.id
                    ? <input className="level-rename" defaultValue={l.name} autoFocus spellCheck onFocus={(e) => e.currentTarget.select()}
                        onBlur={(e) => renameLevel(l.id, e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} />
                    : (() => {
                        // The × is glued to the last word, so it ends whichever line the name ends on.
                        const words = l.name.split(' '), last = words.pop();
                        return (
                          <span className={`level-label ${reorder?.from === i ? 'moving' : ''}`} onPointerDown={(e) => pressLevel(e, i)}>
                            {words.length ? `${words.join(' ')} ` : ''}
                            <span className="glue">{last}{!readOnly && lanes.length > 1 && (
                              <button className="remove" aria-label={`Remove ${l.name}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => removeLevel(l.id)}>×</button>
                            )}</span>
                          </span>
                        );
                      })()}
                </span>
                {!readOnly && (insertAt === i
                  ? <div className="level-insert-picker" onPointerDown={(e) => e.stopPropagation()}>
                      <LevelPicker existing={lanes.map((x) => x.name)} onPick={(name, role) => addLevel(name, role, i)} onCancel={() => setInsertAt(null)} />
                    </div>
                  : <button className={`level-insert ${i === 0 ? 'first' : ''}`} aria-label={`Insert a level above ${l.name}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => setInsertAt(i)} />)}
                </div>
                {hb && <span className="drop-plus" aria-hidden>+</span>}
                {i === 0 && !placedAt.size && !readOnly && !hb && <p className="hint level-hint">Drag an idea here to start.</p>}
              </div>
            );
          })}
          {!readOnly && (
            <div className="level-add" style={{ top: totalH + 10 }} onPointerDown={(e) => e.stopPropagation()}>
              {adding
                ? <LevelPicker existing={lanes.map((l) => l.name)} onPick={addLevel} onCancel={() => setAdding(false)} />
                : <button className="link" onClick={() => setAdding(true)} aria-label="Add a level">+</button>}
            </div>
          )}
          <span className="pool-title" style={{ left: poolX + 24 }}>Ideas</span>
          {hoverBand !== undefined && dragOn && <div className="pool-edge" style={{ left: poolX, height: totalH }} />}
          {reorder && <div className="level-drop-line" style={{ top: reorder.to < lanes.length ? bandTop[reorder.to] : bandTop[lanes.length - 1] + bandHt[lanes.length - 1], width: poolX }} />}
          {poolCards.map((c) => (
            <div key={`pc-${c.id}`} className={`pool-card ${selRoot !== null && c.id !== selRoot ? 'dim' : ''}`}
              style={{ transform: `translate(${c.x}px, ${c.y}px)`, width: c.w, height: c.h }} />
          ))}
          <svg className="graph-edges" aria-hidden>
            {threads.map((e) => <line key={e.key} className="thread" ref={(el) => { if (el) threadEls.current.set(e.key, el); else threadEls.current.delete(e.key); }} />)}
          </svg>
          {live.map((u) => {
            const r = rootOf(u);
            const dim = selRoot !== null && r.id !== selRoot;
            const s = u.type === 'claim' ? support(u, live) : null;
            const at = placedAt.get(u.id);
            // Untyped has no usual level, so it is never marked off-type.
            const offType = at !== undefined && u.type !== null && !lanes[at.lane].accepts.includes(u.type);
            const cls = ['unit', isRoot(u) && u.type ? 'is-claim' : '', u.type ? '' : 'untyped', placedAt.has(r.id) ? 'is-placed' : '', offType ? 'off-type' : '',
              u.id === selectedId ? 'is-selected' : '', dim ? 'dim' : ''].join(' ');
            return (
              <div key={u.id} className={cls} data-type={u.type ?? undefined} style={{ '--c': inkOf(u.type) } as React.CSSProperties}
                title={offType ? `${lanes[at!.lane].name} usually holds: ${lanes[at!.lane].accepts.join(', ')}` : undefined}
                ref={(el) => { if (el) nodeEls.current.set(u.id, el); else nodeEls.current.delete(u.id); }}
                onPointerDown={(e) => press(e, u.id)}>
                {u.type && !(u.type === 'claim' && !u.home) && <span className="kind">{u.type}</span>}
                <span className="lbl">
                  {s && <span className={`support s-${s}`} title={SUPPORT_TITLE[s]}>{MARK[s]} </span>}
                  {u.label}
                </span>
                <div className="tip">{u.text}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
