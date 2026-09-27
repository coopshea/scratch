import { UNIT_TYPES, type UnitType } from '../shared/types.ts';
import { TYPE_INK } from './typeStyle.ts';

export function TypeSelect({ value, onChange }: { value: UnitType; onChange: (t: UnitType) => void }) {
  return (
    <select className="type-select" value={value} onChange={(e) => onChange(e.target.value as UnitType)}
      style={{ color: TYPE_INK[value] }}>
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
