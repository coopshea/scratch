import { UNIT_TYPES, UNTYPED, type UnitType } from '../shared/types.ts';
import { inkOf } from './typeStyle.ts';

/** null shows as untyped until the writer picks a type; untyped can't be picked back. */
export function TypeSelect({ value, onChange }: { value: UnitType | null; onChange: (t: UnitType) => void }) {
  return (
    <select className="type-select" value={value ?? ''} onChange={(e) => { if (e.target.value) onChange(e.target.value as UnitType); }}
      style={{ color: inkOf(value) }}>
      {value === null && <option value="" disabled>{UNTYPED}</option>}
      {UNIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}

export function HomeSelect({ value, claims, onChange }: { value: string | null; claims: { id: string; label: string }[]; onChange: (id: string | null) => void }) {
  return (
    <select className="home-select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">—</option>
      {claims.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
    </select>
  );
}
