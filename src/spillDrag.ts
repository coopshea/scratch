import { useRef } from 'react';
import type { Unit } from '../shared/types.ts';
import { nestTarget } from '../shared/clusters.ts';

/**
 * Dragging onto the Spill board, with the browser's own drag and drop: words highlighted in the spill box (the
 * textarea's native text drag, tagged CUT so only the spill's words are taken), or an idea already on the board (UNIT).
 * Dropped on an idea, it nests under that idea's cluster; dropped on open board, it stands alone.
 */
export const CUT = 'application/x-scratch-cut';
export const UNIT = 'application/x-scratch-unit';

const targetOf = (e: React.DragEvent) => (e.target as Element).closest<HTMLElement>('[data-drop]');

export function useBoardDrop({ units, onCut, onNest }: {
  units: Unit[];
  onCut: (text: string, home: string | null) => void;
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
      if (text.trim()) { onCut(text, nestTarget(units, on) ?? null); return; }
      const id = e.dataTransfer.getData(UNIT);
      const moving = units.find((u) => u.id === id);
      if (!moving) return;
      const home = on ? nestTarget(units, on, id) : null;
      if (home === undefined || home === moving.home) return;
      onNest(id, home);
    },
  };
}
