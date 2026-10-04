import { useRef } from 'react';
import type { Unit } from '../shared/types.ts';
import { nestTarget } from '../shared/clusters.ts';
import type { CutSource } from './api.ts';

/**
 * Dragging onto the Spill board, with the browser's own drag and drop: words highlighted in the spill box (the
 * textarea's native text drag, tagged CUT so only the spill's words are taken), or an idea already on the board (UNIT).
 * Dropped on an idea, it nests under that idea's cluster; dropped on open board, it stands alone.
 */
export const CUT = 'application/x-scratch-cut';
/** With CUT from the spill box: the box's whole text, so the server saves it before the cut points to it. */
export const SPILL = 'application/x-scratch-spill';
/** With CUT from a closed spill: where the words sit in it, as JSON { blurtId, start, end }. */
export const SPAN = 'application/x-scratch-span';
export const UNIT = 'application/x-scratch-unit';

/** The longest selection shown whole in the drag card; past it, the card ends in an ellipsis. */
const CARD_CHARS = 140;

/**
 * Picked-up words look like what they become: a card like the board's (its own classes), holding the words. The
 * card must be in the page while dragstart runs (Safari needs it there), so it sits offscreen and goes a frame later.
 */
export function dragAsCard(e: React.DragEvent, words: string) {
  const card = document.createElement('div');
  card.className = 'unit untyped drag-card';
  const lbl = document.createElement('span');
  lbl.className = 'lbl';
  const flat = words.replace(/\s+/g, ' ').trim();
  lbl.textContent = flat.length > CARD_CHARS ? `${flat.slice(0, CARD_CHARS).trimEnd()}…` : flat;
  card.appendChild(lbl);
  document.body.appendChild(card);
  e.dataTransfer.setDragImage(card, 14, 14);
  window.setTimeout(() => card.remove(), 0);
}

/**
 * Hovering an earlier spill (or one of its cuts) raises the ideas that came from it on the board and quiets the rest.
 * Attributes on the board's own elements, so nothing re-renders; null clears it.
 */
export function linkIdeas(ids: string[] | null) {
  const board = document.querySelector<HTMLElement>('.graph');
  if (!board) return;
  board.querySelectorAll('[data-linked]').forEach((el) => el.removeAttribute('data-linked'));
  if (!ids) { board.removeAttribute('data-linking'); return; }
  board.setAttribute('data-linking', '');
  for (const id of ids) board.querySelector(`.unit[data-drop="${CSS.escape(id)}"]`)?.setAttribute('data-linked', '');
}

const targetOf = (e: React.DragEvent) => (e.target as Element).closest<HTMLElement>('[data-drop]');

export function useBoardDrop({ units, onCut, onNest }: {
  units: Unit[];
  onCut: (text: string, home: string | null, src: CutSource) => void;
  onNest: (id: string, home: string | null) => void;
}) {
  const lit = useRef<HTMLElement | null>(null);
  const zone = useRef<HTMLElement | null>(null);
  const light = (el: HTMLElement | null) => {
    if (lit.current === el) return;
    lit.current?.classList.remove('drop-on');
    el?.classList.add('drop-on');
    lit.current = el;
  };
  const clear = () => { light(null); zone.current?.classList.remove('drop-ready'); };
  const ours = (e: React.DragEvent) => e.dataTransfer.types.includes(CUT) || e.dataTransfer.types.includes(UNIT);

  return {
    onDragOver: (e: React.DragEvent<HTMLElement>) => {
      if (!ours(e)) return;
      e.preventDefault();
      // Copy, never move: a native move would take the words out of the spill box.
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes(CUT) ? 'copy' : 'move';
      zone.current = e.currentTarget;
      e.currentTarget.classList.add('drop-ready');
      // Mark where it will land, not what is under the pointer: over a piece, that is its cluster's tray.
      const home = nestTarget(units, targetOf(e)?.dataset.drop ?? null);
      const z = e.currentTarget;
      light(home ? z.querySelector<HTMLElement>(`.card[data-drop="${home}"]`) ?? z.querySelector<HTMLElement>(`.unit[data-drop="${home}"]`) : null);
    },
    onDragLeave: (e: React.DragEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) clear();
    },
    onDrop: (e: React.DragEvent<HTMLElement>) => {
      if (!ours(e)) return;
      e.preventDefault();
      const on = targetOf(e)?.dataset.drop ?? null;
      clear();
      const text = e.dataTransfer.getData(CUT);
      if (text.trim()) {
        const span = e.dataTransfer.getData(SPAN);
        onCut(text, nestTarget(units, on) ?? null, span ? { from: JSON.parse(span) } : { spill: e.dataTransfer.getData(SPILL) });
        return;
      }
      const id = e.dataTransfer.getData(UNIT);
      const moving = units.find((u) => u.id === id);
      if (!moving) return;
      const home = on ? nestTarget(units, on, id) : null;
      if (home === undefined || home === moving.home) return;
      onNest(id, home);
    },
  };
}
