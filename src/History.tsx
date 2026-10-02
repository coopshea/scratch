import type { LogEvent } from '../shared/replay.ts';
import { UNTYPED, type Unit } from '../shared/types.ts';

function when(iso: string) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
  return `${d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${ago}`;
}

const VERB: Record<string, string> = { 'blurt.create': 'blurt', parse: 'parsed', 'unit.update': 'edit', 'unit.create': 'cut by hand','asset.upload': 'image' };

type Props = {
  events: LogEvent[];
  count: number;
  onCount: (n: number) => void;
  units: Unit[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function History({ events, count, onCount, units, selectedId, onSelect }: Props) {
  const e = events[count - 1];
  const kept = units.filter((u) => u.status !== 'cut');
  const cut = units.filter((u) => u.status === 'cut');
  return (
    <div className="talk history">
      <div className="when">{e ? when(e.t) : '—'}</div>
      <input type="range" min={1} max={Math.max(1, events.length)} value={count} onChange={(ev) => onCount(Number(ev.target.value))} />
      <div className="rule"><span>{e ? `${VERB[e.type] ?? e.type} · ${e.author}` : ''}</span><span>{count}/{events.length}</span></div>
      {kept.map((u) => (
        <button key={u.id} className={`hist-row ${u.id === selectedId ? 'on' : ''}`} onClick={() => onSelect(u.id)}>
          <em>{u.type ?? UNTYPED}</em> {u.label}
        </button>
      ))}
      {cut.length > 0 && <div className="rule"><span>cut</span></div>}
      {cut.map((u) => (
        <button key={u.id} className={`hist-row is-cut ${u.id === selectedId ? 'on' : ''}`} onClick={() => onSelect(u.id)}>
          <em>{u.type ?? UNTYPED}</em> {u.label}
        </button>
      ))}
    </div>
  );
}
