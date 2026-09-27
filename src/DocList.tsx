import { useEffect, useState } from 'react';
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
  return (
    <nav className="docs">
      <button className="link new" onClick={async () => go((await projects.create('untitled')).slug)}>new</button>
      {docs.map((d) => (
        <button key={d.slug} className={`doc ${d.slug === current ? 'on' : ''}`} onClick={() => go(d.slug)}>
          <span className="doc-title">{d.title}<span className="doc-when">{ago(d.updatedAt)}</span></span>
          {d.summary && <span className="doc-summary">{d.summary}</span>}
        </button>
      ))}
    </nav>
  );
}
