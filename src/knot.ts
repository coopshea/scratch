/**
 * The welcome page's rope, in a 1440 × 900 frame: it comes in from above, ties a knot, threads down through the middle
 * and leaves straight down. Where the tail comes out of the knot sits at mid-screen. The knot is a smooth closed curve (fixed seed and rotation) opened into a rope; each
 * crossing alternates over and under, drawn by cutting a gap in the strand underneath. Deterministic: same every load.
 */
export const FRAME = { w: 1440, h: 900 };
export const STROKE = 18;

type Pt = [number, number];

function rng(seed: number) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

function curve(seed: number) {
  const r = rng(seed);
  const h = [0, 1, 2].map(() => ({ fx: 1 + Math.floor(r() * 4), fy: 1 + Math.floor(r() * 4), ax: 60 + r() * 140, ay: 50 + r() * 100, px: r() * 6.28, py: r() * 6.28 }));
  return (t: number): Pt => [h.reduce((s, q) => s + q.ax * Math.sin(q.fx * t + q.px), 0), h.reduce((s, q) => s + q.ay * Math.cos(q.fy * t + q.py), 0)];
}

function bezier(a: Pt, b: Pt, c: Pt, d: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0], u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]]);
  }
  return out;
}

const unit = (a: Pt, b: Pt): Pt => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };

/** The rope from off-screen above to where it leaves the knot, as a polyline, with the top of the knot at y = 0. */
function rope(seed: number, rotDeg: number, width: number, cx: number) {
  const f = curve(seed), rot = (rotDeg * Math.PI) / 180, N = 1200;
  let P: Pt[] = [];
  for (let i = 0; i < N; i++) {
    const [x, y] = f((i / N) * 2 * Math.PI);
    P.push([x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
  const k = width / (Math.max(...xs) - Math.min(...xs)), mx = (Math.max(...xs) + Math.min(...xs)) / 2, my = Math.min(...ys);
  P = P.map((p) => [cx + (p[0] - mx) * k, (p[1] - my) * k]);
  let iT = 0;
  P.forEach((p, i) => { if (p[1] < P[iT][1]) iT = i; });
  const bottom = Math.max(...P.map((p) => p[1]));
  // Once around, stopping short of where it started; then the tail threads down through the middle.
  const body = P.slice(iT).concat(P.slice(0, iT)).slice(0, N - Math.round(N * 0.07));
  // The rope comes in along the arc it is already on: back from the top of the knot, curving up and off the top edge.
  const T = body[0], du = unit(T, body[3]), b: Pt = [-du[0], -du[1]];
  const far: Pt = [T[0] + b[0] * 300, T[1] - 460];
  const arc = bezier(far, [T[0] + b[0] * 280, T[1] - 240], [T[0] + b[0] * 170, T[1] + b[1] * 170], T, 80);
  // Carried on straight, far past the top edge, so no end shows however tall the window is.
  const up = unit(arc[0], far);
  const inlet: Pt[] = [[far[0] + up[0] * 1600, far[1] + up[1] * 1600], far, ...arc];
  const E = body[body.length - 1], eu = unit(body[body.length - 4], E);
  const exit: Pt = [cx, bottom + 50];
  const outlet = bezier(E, [E[0] + eu[0] * 90, E[1] + eu[1] * 90], [cx, exit[1] - 160], exit, 90);
  return { pts: [...inlet, ...body.slice(1), ...outlet], exit };
}

/**
 * Where to lift the pen so the rope crosses itself: a gap in the lower strand at every crossing, alternating over and
 * under along the rope. `L` is the length along the rope at each point; `cut` the gaps, as spans of that length.
 */
function crossings(P: Pt[]) {
  const L = [0];
  for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const at = (x: number) => { const i = Math.floor(x); return L[i] + (L[Math.min(i + 1, L.length - 1)] - L[i]) * (x - i); };
  const hits: { i: number; j: number; sin: number }[] = [];
  for (let i = 0; i < P.length - 1; i++) {
    for (let j = i + 3; j < P.length - 1; j++) {
      const a = P[i], b = P[i + 1], c = P[j], d = P[j + 1];
      const u0 = [b[0] - a[0], b[1] - a[1]], v0 = [d[0] - c[0], d[1] - c[1]];
      const den = u0[0] * v0[1] - u0[1] * v0[0];
      if (Math.abs(den) < 1e-9) continue;
      const u = ((c[0] - a[0]) * v0[1] - (c[1] - a[1]) * v0[0]) / den, v = ((c[0] - a[0]) * u0[1] - (c[1] - a[1]) * u0[0]) / den;
      if (u >= 0 && u < 1 && v >= 0 && v < 1) hits.push({ i: i + u, j: j + v, sin: Math.abs(Math.sin(Math.atan2(den, u0[0] * v0[0] + u0[1] * v0[1]))) });
    }
  }
  const ev: [number, number][] = [];
  hits.forEach((h, n) => { ev.push([h.i, n]); ev.push([h.j, n]); });
  ev.sort((x, y) => x[0] - y[0]);
  const under: [number, number][] = []; // [position along the rope, crossing]
  ev.forEach(([pos, n], k) => { if (k % 2) under.push([pos, n]); });
  // The rope leaves the knot on top at its last crossing, so it comes out in one piece.
  const last = ev[ev.length - 1];
  if (last && under.some(([pos]) => pos === last[0])) {
    const other = hits[last[1]].i === last[0] ? hits[last[1]].j : hits[last[1]].i;
    under.splice(under.findIndex(([pos]) => pos === last[0]), 1, [other, last[1]]);
  }
  let cut: [number, number][] = under.map(([pos, n]) => {
    const half = ((STROKE + 14) / Math.max(0.45, hits[n].sin) + STROKE) / 2, s = at(pos);
    return [s - half, s + half];
  });
  // Gaps closer than a stroke's width merge, so no crumbs of rope are left between them.
  cut.sort((a, b) => a[0] - b[0]);
  cut = cut.reduce<[number, number][]>((m, c) => {
    const last = m[m.length - 1];
    if (last && c[0] - last[1] < STROKE * 1.6) last[1] = Math.max(last[1], c[1]); else m.push([...c]);
    return m;
  }, []);
  return { L, cut };
}

function draw(P: Pt[], L: number[], cut: [number, number][]): string {
  let d = '', pen = false;
  for (let i = 0; i < P.length; i++) {
    if (cut.some(([a, b]) => L[i] > a && L[i] < b)) { pen = false; continue; }
    d += (pen ? 'L' : 'M') + P[i][0].toFixed(1) + ',' + P[i][1].toFixed(1);
    pen = true;
  }
  return d;
}

/**
 * The welcome page's geometry, in the 1440 × 900 frame:
 * - `knot`: the rope from off-screen above into the knot and out of its bottom at `exit`. It sits on the paper, placed
 *   so the tail comes out from under its last crossing at mid-screen: the knot above the middle, the tail below.
 * - `paperTravel`: how far the paper moves up while the pencil point rises from `exit` to `rest`, drawing a straight
 *   line down; by then the knot is off the top of the screen.
 * - `pen`: where the point goes once the paper stops: on down, then deflecting round the top-right corner of the
 *   headline and down past its right side. `penLength` is its length; `penBottom` how far along it reaches the frame's
 *   bottom edge.
 * - `headline`: the box the headline sits in, tucked into that corner, uncovered top to bottom as the point passes.
 */
export function welcomeRope() {
  const knot = rope(212, 40, 400, FRAME.w / 2);
  const { L, cut } = crossings(knot.pts);
  const out = L.findIndex((l) => l >= cut[cut.length - 1][1]);
  const dy = FRAME.h / 2 - knot.pts[out][1];
  const pts = knot.pts.map(([x, y]): Pt => [x, y + dy]), exit: Pt = [knot.exit[0], knot.exit[1] + dy];
  const knotBottom = Math.max(...pts.map((p) => p[1]));
  const paperTravel = Math.ceil(knotBottom + STROKE + 20);
  const x0 = exit[0], r1 = 40, r2 = 64, right = 1060, size = 140, lineGap = 124;
  // The headline, from the line over it to its last baseline, centres a little above mid-screen, where the eye puts the
  // middle; the point comes to rest above that.
  const block = 34 + size * 0.8 + lineGap;
  const edge = Math.round(FRAME.h * 0.47 - block / 2); // the line runs along here, just above the headline
  const turn = edge - r1, rest = turn - 34;
  const pen = `M${x0},${rest} L${x0},${turn} A${r1},${r1} 0 0 0 ${x0 + r1},${edge} L${right - r2},${edge} A${r2},${r2} 0 0 1 ${right},${edge + r2} L${right},4000`;
  const quarter = (r: number) => (Math.PI / 2) * r;
  const beforeDown = (turn - rest) + quarter(r1) + (right - r2 - (x0 + r1)) + quarter(r2);
  const penLength = beforeDown + (4000 - (edge + r2));
  const penBottom = beforeDown + (FRAME.h - (edge + r2));
  const headline = { x: 150, top: edge + 34, size, lineGap };
  return { knot: draw(pts, L, cut), exit, rest, paperTravel, pen, penLength, penBottom, beforeDown, downFrom: edge + r2, threadX: right, headline };
}
