import { useEffect, useState } from 'react';

/**
 * The Spill board before anything is cut: a group grows ideas, splits into two and then four of different sizes, ages
 * and merges back, on a loop. It says, without words, that ideas will gather here in loose groups.
 */
type Box = [number, number, number, number]; // centre x, centre y, width, height, in a 700 × 400 frame

const A0: Box = [0, 0, 150, 96], A1: Box = [0, 0, 236, 150];
const B1: Box = [-150, -8, 196, 132], B2: Box = [140, 14, 150, 112];
const C1: Box = [-236, -64, 150, 100], C2: Box = [-112, 92, 172, 112], C3: Box = [112, -78, 126, 90], C4: Box = [238, 58, 164, 118];
const aged = (c: Box): Box => [c[0] * 0.5, c[1] * 0.5, c[2] * 0.62, c[3] * 0.62];
const KEYS: [number, Box[], number][] = [
  [0, [A0, A0, A0, A0], 1], [1.8, [A1, A1, A1, A1], 1], [3.4, [B1, B1, B2, B2], 1], [4.4, [B1, B1, B2, B2], 1],
  [6, [C1, C2, C3, C4], 1], [7.4, [C1, C2, C3, C4], 1], [8.8, [aged(C1), aged(C2), aged(C3), aged(C4)], 0.55], [10, [A0, A0, A0, A0], 1],
];
// The ideas inside each group: which group, where in it, width, when it appears, and its type's mark.
const IDEAS: [number, number, number, number, number, string][] = [
  [0, -0.26, -0.2, 52, 0.3, 'claim'], [0, -0.1, 0.22, 40, 1.0, ''], [0, 0.14, -0.16, 34, 4.8, 'question'],
  [1, -0.3, 0.1, 44, 0.8, ''], [1, 0.14, 0.2, 38, 5.2, 'objection'],
  [2, 0.22, -0.22, 46, 0.5, 'question'], [2, 0.06, 0.2, 36, 1.4, ''], [2, -0.14, 0.08, 30, 5.0, ''],
  [3, 0.28, 0.08, 42, 1.1, 'claim'], [3, -0.08, -0.22, 36, 3.9, 'objection'], [3, 0.14, 0.24, 32, 5.6, ''], [3, -0.22, 0.18, 28, 6.2, ''],
];
const LOOP = 10, W = 700, H = 400;
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const back = (x: number) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const pct = (v: number, of: number) => `${(v / of) * 100}%`;

export function EmptyBoard() {
  const [t, setT] = useState(6.6);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => { setT(((now - t0) / 1000) % LOOP); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  let k = 0;
  while (k < KEYS.length - 2 && t >= KEYS[k + 1][0]) k++;
  const [ta, ca, aa] = KEYS[k], [tb, cb, ab] = KEYS[k + 1];
  const u = ease(clamp((t - ta) / (tb - ta)));
  const cells = ca.map((c, i) => c.map((v, j) => v + (cb[i][j] - v) * u) as Box);
  const alpha = aa + (ab - aa) * u;
  const breathe = 1 + Math.sin(t * 2.2) * 0.015;
  const box = (c: Box, pad: number): React.CSSProperties => {
    const w = c[2] * breathe + 2 * pad, h = c[3] * breathe + 2 * pad;
    return { left: pct(W / 2 + c[0] - w / 2, W), top: pct(H / 2 + c[1] - h / 2, H), width: pct(w, W), height: pct(h, H), borderRadius: 24 + pad };
  };

  return (
    <div className="empty">
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <filter id="goo" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" />
        </filter>
      </svg>
      <div className="cells" aria-hidden>
        <div className="cells-layer" style={{ opacity: alpha }}>{cells.map((c, i) => <div key={i} style={{ ...box(c, 3), background: 'var(--pencil-line)' }} />)}</div>
        <div className="cells-layer" style={{ opacity: alpha }}>{cells.map((c, i) => <div key={i} style={{ ...box(c, 0), background: 'var(--pencil-soft)' }} />)}</div>
        <div className="cells-orgs">
          {IDEAS.map(([cell, fx, fy, w, born, mark], i) => {
            const c = cells[cell];
            const grow = clamp((t - born) / 0.45), die = clamp((t - (7.5 + i * 0.07)) / 0.5);
            const s = t < born ? 0 : Math.max(0, back(grow) * (1 - die));
            return (
              <div key={i} className="org" style={{ left: pct(W / 2 + c[0] + fx * c[2], W), top: pct(H / 2 + c[1] + fy * c[3], H), width: w,
                transform: `translate(-50%, -50%) scale(${s.toFixed(3)})` }}>
                <b className={mark} /><i />
              </div>
            );
          })}
        </div>
      </div>
      <p className="hint">Ideas gather here in loose groups. Let's get those ducks in a row.</p>
    </div>
  );
}
