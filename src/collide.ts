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

