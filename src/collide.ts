import type { SimulationNodeDatum } from 'd3-force';

export type BoxNode = SimulationNodeDatum & { id: string; w: number; h: number };

/**
 * Push apart any two rectangles that overlap. A node pinned on an axis (fx / fy set) does not move on that axis.
 * Returns whether anything moved.
 */
export function separate(nodes: BoxNode[], gap: number, strength: number, axis: 'auto' | 'y' = 'auto') {
  let moved = false;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = b.x! - a.x!, dy = b.y! - a.y!;
      const ox = (a.w + b.w) / 2 + gap - Math.abs(dx);
      const oy = (a.h + b.h) / 2 + gap - Math.abs(dy);
      if (ox <= 0 || oy <= 0) continue;
      moved = true;
      const alongX = axis === 'auto' && ox < oy;
      let aPin = alongX ? a.fx != null : a.fy != null, bPin = alongX ? b.fx != null : b.fy != null;
      if (aPin && bPin) { if (axis === 'y') { aPin = false; bPin = true; } else continue; }
      const wa = aPin ? 0 : bPin ? 1 : 0.5, wb = bPin ? 0 : aPin ? 1 : 0.5;
      if (alongX) { const s = ox * strength * (dx < 0 ? -1 : 1); a.x! -= s * wa; b.x! += s * wb; }
      else { const s = oy * strength * (dy < 0 ? -1 : 1); a.y! -= s * wa; b.y! += s * wb; }
    }
  }
  return moved;
}

/** d3 force: a few soft passes per tick. */
export function rectCollide(gap = 12) {
  let nodes: BoxNode[] = [];
  const force = () => { for (let k = 0; k < 3; k++) if (!separate(nodes, gap, 0.8)) break; };
  force.initialize = (n: BoxNode[]) => { nodes = n; };
  return force;
}

/** Hard rule before painting: no two labels touch. */
export function resolveOverlaps(nodes: BoxNode[], gap = 12) {
  for (let k = 0; k < 60; k++) if (!separate(nodes, gap, 1)) break;
}

/** Vertical-only cleanup, for regions too narrow to separate sideways. */
export function resolveVertically(nodes: BoxNode[], gap = 10) {
  for (let k = 0; k < 60; k++) if (!separate(nodes, gap, 1, 'y')) break;
}

export type GroupNode = BoxNode & { group: string | null; order: number };

/**
 * d3 force: keep clusters distinct. Each group's bounding box pushes away from every other group's box
 * until at least `gap` separates them, moving whole groups so their shape is kept. Ungrouped nodes are ignored.
 */
export function separateGroups(gap = 48, strength = 0.5) {
  let nodes: GroupNode[] = [];
  const force = (alpha: number) => {
    const groups = new Map<string, GroupNode[]>();
    for (const n of nodes) if (n.group) (groups.get(n.group) ?? groups.set(n.group, []).get(n.group)!).push(n);
    const boxes = [...groups.values()].map((ns) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of ns) { x0 = Math.min(x0, n.x! - n.w / 2); x1 = Math.max(x1, n.x! + n.w / 2); y0 = Math.min(y0, n.y! - n.h / 2); y1 = Math.max(y1, n.y! + n.h / 2); }
      return { ns, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
    });
    const k = strength * Math.max(alpha, 0.1);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const dx = b.cx - a.cx, dy = b.cy - a.cy;
        const ox = (a.w + b.w) / 2 + gap - Math.abs(dx), oy = (a.h + b.h) / 2 + gap - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        // Separate along the axis that needs the smaller move, so clusters slide apart rather than jump.
        const [mx, my] = ox < oy ? [ox * (dx < 0 ? -1 : 1), 0] : [0, oy * (dy < 0 ? -1 : 1)];
        for (const n of a.ns) { n.vx! -= (mx / 2) * k; n.vy! -= (my / 2) * k; }
        for (const n of b.ns) { n.vx! += (mx / 2) * k; n.vy! += (my / 2) * k; }
      }
    }
  };
  force.initialize = (n: GroupNode[]) => { nodes = n; };
  return force;
}

/**
 * d3 force: ungrouped nodes (lone roots, pieces that belong to nothing) line up in one left-aligned column
 * to the right of every cluster, in blurt order. Still graph nodes: they can be dragged and collide as usual.
 */
export function soloColumn(gapX = 72, gapY = 16) {
  let nodes: GroupNode[] = [];
  const force = (alpha: number) => {
    const solos = nodes.filter((n) => !n.group).sort((a, b) => a.order - b.order);
    if (!solos.length) return;
    let right = -Infinity;
    for (const n of nodes) if (n.group) right = Math.max(right, n.x! + n.w / 2);
    const left = right === -Infinity ? 0 : right + gapX;
    let y = -solos.reduce((h, n) => h + n.h + gapY, -gapY) / 2;
    for (const n of solos) {
      // Settles firmly into its slot, so left edges line up and blurt order holds; a dragged node is left alone.
      if (n.fx == null) { n.x! += (left + n.w / 2 - n.x!) * 0.5; n.vx = 0; }
      if (n.fy == null) { n.y! += (y + n.h / 2 - n.y!) * 0.5; n.vy = 0; }
      y += n.h + gapY;
    }
  };
  force.initialize = (n: GroupNode[]) => { nodes = n; };
  return force;
}
