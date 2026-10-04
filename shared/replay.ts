import type { Blurt, Unit } from './types.ts';
import { emptyBoard, type Board } from './structures.ts';
import { settle } from './clusters.ts';

export type LogEvent = { t: string; author: 'human' | 'model' | 'system'; type: string; data: any };

/** Rebuild the project as it stood after the first `count` events. Read-only history, no restore. */
export function replay(events: LogEvent[], count: number): { blurts: Blurt[]; units: Unit[]; board: Board; draft: string } {
  const blurts: Blurt[] = [];
  let board = emptyBoard();
  let draft = '';
  const units = new Map<string, Unit>();
  for (const e of events.slice(0, count)) {
    if (e.type === 'blurt.create') blurts.push({ id: e.data.id, text: e.data.text, createdAt: e.t });
    else if (e.type === 'parse') for (const u of e.data.units as Unit[]) units.set(u.id, { ...u });
    else if (e.type === 'source.adopt' || e.type === 'unit.create') units.set(e.data.unit.id, { ...e.data.unit });
    else if (e.type === 'board.update') board = e.data;
    else if (e.type === 'draft.snapshot') draft = e.data.text;
    else if (e.type === 'unit.update') {
      const u = units.get(e.data.id);
      if (!u) continue;
      Object.assign(u, e.data.patch);
      settle([...units.values()], u);
    }
  }
  return { blurts, units: [...units.values()], board, draft };
}
