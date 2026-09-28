/**
 * Cluster cards and masonry: the deterministic layout both Talk and Structure's loose pool use.
 * A card is a root on top with its pieces flowing beneath it, left to right, wrapping at the card's width.
 * Cards stack into columns, each new card into the shortest column (masonry), so a pane fills by construction.
 * No physics: the same content always lands in the same place.
 */

export type Dim = { w: number; h: number };
export type Point = { x: number; y: number };

export const CARD_PAD = 12;
const INDENT = 10, GAP_X = 14, GAP_Y = 8;

/**
 * Lay out one card. Positions are node centers relative to the card's top-left.
 * `dots` (collapsed pieces) always start their own line beneath the pieces.
 */
export function layoutCard(rootId: string | null, pieces: string[], dim: (id: string) => Dim, width: number, dots: string[] = []) {
  const pos = new Map<string, Point>();
  let y = CARD_PAD;
  if (rootId) {
    const r = dim(rootId);
    pos.set(rootId, { x: CARD_PAD + r.w / 2, y: y + r.h / 2 });
    y += r.h + GAP_Y;
  }
  const left = CARD_PAD + (rootId ? INDENT : 0), right = width - CARD_PAD;
  let x = left, line = 0;
  const flow = (ids: string[], gap: number) => {
    for (const id of ids) {
      const d = dim(id);
      if (x > left && x + d.w > right) { x = left; y += line + GAP_Y; line = 0; }
      pos.set(id, { x: x + d.w / 2, y: y + d.h / 2 });
      x += d.w + gap; line = Math.max(line, d.h);
    }
  };
  flow(pieces, GAP_X);
  if (dots.length && pieces.length) { x = left; y += line + GAP_Y; line = 0; }
  flow(dots, 8);
  const h = (pieces.length || dots.length ? y + line : y - GAP_Y) + CARD_PAD;
  return { pos, h };
}

/** Pack cards (in order) into `cols` columns; each goes into the shortest column. Returns top-left per card. */
export function masonry(cards: { id: string; h: number }[], cols: number, colW: number, gap: number) {
  const heights = Array(Math.max(1, cols)).fill(0);
  const at = new Map<string, Point>();
  for (const c of cards) {
    const i = heights.indexOf(Math.min(...heights));
    at.set(c.id, { x: i * (colW + gap), y: heights[i] });
    heights[i] += c.h + gap;
  }
  return { at, height: Math.max(0, Math.max(...heights) - gap), width: cols * colW + (cols - 1) * gap };
}
