import { useEffect, useRef, useState } from 'react';
import type { ProjectSummary } from '../shared/types.ts';
import { projects, slug as current } from './api.ts';

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const go = (slug: string) => { location.search = `?p=${encodeURIComponent(slug)}`; };

export function DocList() {
  const [docs, setDocs] = useState<ProjectSummary[]>([]);
  useEffect(() => { projects.list().then(setDocs); }, []);

  // Deleting asks twice: the × turns into "delete?" for a few seconds. The document goes to projects/.trash.
  const [confirming, setConfirming] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const askRemove = async (slug: string) => {
    window.clearTimeout(timer.current);
    if (confirming !== slug) {
      setConfirming(slug);
      timer.current = window.setTimeout(() => setConfirming(null), 3000);
      return;
    }
    setConfirming(null);
    await projects.remove(slug);
    const rest = docs.filter((d) => d.slug !== slug);
    if (slug === current) go(rest[0]?.slug ?? (await projects.create('untitled')).slug);
    else setDocs(rest);
  };

  return (
    <nav className="docs">
      <button className="link new" onClick={async () => go((await projects.create('untitled')).slug)}>new</button>
      {docs.map((d) => (
        <div key={d.slug} className={`doc-row ${confirming === d.slug ? 'confirming' : ''}`}>
          <button className={`doc ${d.slug === current ? 'on' : ''}`} onClick={() => go(d.slug)}>
            <span className="doc-title">{d.title}<span className="doc-when">{ago(d.updatedAt)}</span></span>
            {d.summary && <span className="doc-summary">{d.summary}</span>}
          </button>
          <button className={`remove ${confirming === d.slug ? 'confirm' : ''}`} onClick={() => askRemove(d.slug)}
            aria-label={confirming === d.slug ? `Confirm delete ${d.title}` : `Delete ${d.title}`}>
            {confirming === d.slug ? 'delete?' : '×'}
          </button>
        </div>
      ))}
    </nav>
  );
}
