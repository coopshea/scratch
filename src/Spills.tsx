import { useState } from 'react';
import type { Blurt, Unit } from '../shared/types.ts';
import { CUT, SPAN } from './spillDrag.ts';

const PREF = 'spills-shown';
const readShown = () => { try { return localStorage.getItem(PREF) !== 'false'; } catch { return true; } };
const writeShown = (v: boolean) => { try { localStorage.setItem(PREF, String(v)); } catch { /* storage unavailable */ } };

/**
 * Everything already spilled, oldest first, above the box: one plain page. Closed spills are fixed, so they are
 * read-only. Words already cut into ideas are faintly underlined; clicking them opens that idea. Highlighting words
 * here and dragging them to the board cuts them by hand, at a position known at once.
 */
export function Spills({ blurts, units, onSelect }: { blurts: Blurt[]; units: Unit[]; onSelect: (id: string) => void }) {
  const [shown, setShown] = useState(readShown);
  if (!blurts.length) return null;
  const toggle = () => setShown((s) => { writeShown(!s); return !s; });
  return (
    <div className="spills">
      <button className="link muted spills-toggle" onClick={toggle} aria-expanded={shown}>
        {shown ? 'hide earlier spills' : `${blurts.length} earlier ${blurts.length === 1 ? 'spill' : 'spills'}`}
      </button>
      {shown && blurts.map((b, i) => <ClosedSpill key={b.id} blurt={b} n={i + 1} units={units} onSelect={onSelect} />)}
    </div>
  );
}

function ClosedSpill({ blurt, n, units, onSelect }: { blurt: Blurt; n: number; units: Unit[]; onSelect: (id: string) => void }) {
  // The ideas cut from this spill, in order; where two overlap, the earlier one holds the words.
  const cuts = units.filter((u) => u.blurtId === blurt.id && u.status !== 'cut' && u.start >= 0 && u.end <= blurt.text.length)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const u of cuts) {
    if (u.start < at) continue;
    if (u.start > at) parts.push(blurt.text.slice(at, u.start));
    parts.push(
      <span key={u.id} className="cut-words" title={u.label}
        onClick={() => { if (window.getSelection()?.isCollapsed !== false) onSelect(u.id); }}>
        {blurt.text.slice(u.start, u.end)}
      </span>,
    );
    at = u.end;
  }
  if (at < blurt.text.length) parts.push(blurt.text.slice(at));

  const date = new Date(blurt.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return (
    <section className="spill-past">
      <div className="rule"><span>Spill {n} · {date}</span></div>
      <div className="spill-text"
        onDragStart={(e) => {
          // The highlighted words and where they sit: the page's text is exactly the spill's, so offsets carry over.
          const sel = window.getSelection();
          if (!sel || sel.isCollapsed || !sel.rangeCount) return;
          const range = sel.getRangeAt(0), box = e.currentTarget;
          if (!box.contains(range.startContainer) || !box.contains(range.endContainer)) return;
          const before = document.createRange();
          before.selectNodeContents(box);
          before.setEnd(range.startContainer, range.startOffset);
          const start = before.toString().length, words = range.toString();
          e.dataTransfer.setData(CUT, words);
          e.dataTransfer.setData(SPAN, JSON.stringify({ blurtId: blurt.id, start, end: start + words.length }));
          e.dataTransfer.effectAllowed = 'copy';
        }}>
        {parts}
      </div>
    </section>
  );
}
