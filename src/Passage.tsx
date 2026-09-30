import type { Passage } from './api.ts';

/** Readwise keeps a highlight's links as markdown; show the linked words, not the syntax. */
export const plain = (md: string) => md.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

/** One offered passage: the writer's note first, the highlight set apart, then where it's from. Picking it adds it. */
export function PassageRow({ p, n, onPick }: { p: Passage; n: number; onPick: () => void }) {
  return (
    <button className="passage" onClick={onPick}>
      <kbd className="kbd">{n}</kbd>
      <span>
        {p.note && <span className="passage-note">{p.note}</span>}
        <span className="passage-quote">{plain(p.quote)}</span>
        <cite>{[p.title, p.author].filter(Boolean).join(' · ')}</cite>
      </span>
    </button>
  );
}
