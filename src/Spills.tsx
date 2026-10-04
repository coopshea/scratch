import { useEffect, useState } from 'react';
import type { Blurt, Unit } from '../shared/types.ts';
import { CUT, dragAsCard, linkIdeas, SPAN } from './spillDrag.ts';

/**
 * Everything already spilled, below the bar and folded: one quiet row. Opened, each spill is read-only plain text
 * under a thin rule, and folds on its own. Words already cut into ideas are faintly underlined; clicking them opens
 * that idea. Hovering a spill raises its ideas on the board; hovering a cut, just that one. Highlighting words here
 * and dragging them to the board cuts them by hand, at a position known at once.
 */
export function Spills({ blurts, units, onSelect }: { blurts: Blurt[]; units: Unit[]; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  useEffect(() => () => linkIdeas(null), []);
  if (!blurts.length) return null;
  const fold = (id: string) => setFolded((f) => { const n = new Set(f); if (!n.delete(id)) n.add(id); return n; });
  return (
    <div className="spills">
      <button className="spills-row" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="chev" aria-hidden>{open ? '▾' : '▸'}</span>Earlier spills ({blurts.length})
      </button>
      {open && blurts.map((b, i) => (
        <ClosedSpill key={b.id} blurt={b} n={i + 1} units={units} onSelect={onSelect} open={!folded.has(b.id)} onFold={() => fold(b.id)} />
      ))}
    </div>
  );
}

function ClosedSpill({ blurt, n, units, onSelect, open, onFold }: {
  blurt: Blurt; n: number; units: Unit[]; onSelect: (id: string) => void; open: boolean; onFold: () => void;
}) {
  const mine = units.filter((u) => u.blurtId === blurt.id && u.status !== 'cut');
  const ids = mine.map((u) => u.id);
  // The ideas cut from this spill, in order; where two overlap, the earlier one holds the words.
  const cuts = mine.filter((u) => u.start >= 0 && u.end <= blurt.text.length).sort((a, b) => a.start - b.start || b.end - a.end);
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const u of cuts) {
    if (u.start < at) continue;
    if (u.start > at) parts.push(blurt.text.slice(at, u.start));
    parts.push(
      <span key={u.id} className="cut-words" title={u.label}
        onPointerEnter={() => linkIdeas([u.id])} onPointerLeave={() => linkIdeas(ids)}
        onClick={() => { if (window.getSelection()?.isCollapsed !== false) { linkIdeas(null); onSelect(u.id); } }}>
        {blurt.text.slice(u.start, u.end)}
      </span>,
    );
    at = u.end;
  }
  if (at < blurt.text.length) parts.push(blurt.text.slice(at));

  const date = new Date(blurt.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return (
    <section className="spill-past" onPointerEnter={() => linkIdeas(ids)} onPointerLeave={() => linkIdeas(null)}>
      <button className="rule spill-head" onClick={onFold} aria-expanded={open}><span>Spill {n} · {date}</span></button>
      {open && (
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
            dragAsCard(e, words);
          }}>
          {parts}
        </div>
      )}
    </section>
  );
}
