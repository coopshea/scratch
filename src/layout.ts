import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force';
import type { Unit } from '../shared/types.ts';

type N = SimulationNodeDatum & { id: string; claim: boolean };

/**
 * Positions only the units that have none yet. Placed units stay pinned, so the map
 * never reshuffles: spatial memory is the point of having a map at all.
 */
export function placeNew(units: Unit[]): { id: string; x: number; y: number }[] {
  const live = units.filter((u) => u.status !== 'cut');
  const fresh = live.filter((u) => u.x === undefined || u.y === undefined);
  if (!fresh.length) return [];

  const byId = new Map(live.map((u) => [u.id, u]));
  const placed = live.filter((u) => u.x !== undefined);
  const maxX = placed.length ? Math.max(...placed.map((u) => u.x!)) : 0;
  const freshClaims = fresh.filter((u) => u.type === 'claim');

  const nodes: N[] = live.map((u) => {
    if (u.x !== undefined && u.y !== undefined) return { id: u.id, claim: u.type === 'claim', x: u.x, y: u.y, fx: u.x, fy: u.y };
    const home = u.home ? byId.get(u.home) : undefined;
    let x: number, y: number;
    if (home?.x !== undefined) { x = home.x + (Math.random() - 0.5) * 160; y = home.y! + (Math.random() - 0.5) * 160; }
    else if (u.type === 'claim') { const i = freshClaims.indexOf(u); x = (placed.length ? maxX + 280 : 0) + (i % 3) * 280; y = Math.floor(i / 3) * 240; }
    else { x = (placed.length ? maxX + 280 : 0) + Math.random() * 500; y = 300 + Math.random() * 120; }
    return { id: u.id, claim: u.type === 'claim', x, y };
  });

  const links = live.filter((u) => u.home && byId.has(u.home)).map((u) => ({ source: u.id, target: u.home! }));

  const sim = forceSimulation(nodes)
    .force('link', forceLink<N, { source: string; target: string }>(links).id((d) => d.id).distance(95).strength(0.9))
    .force('charge', forceManyBody().strength(-260))
    .force('collide', forceCollide<N>((d) => (d.claim ? 85 : 62)))
    .force('x', forceX<N>((d) => d.x ?? 0).strength(0.02))
    .force('y', forceY<N>((d) => d.y ?? 0).strength(0.02))
    .stop();
  for (let i = 0; i < 300; i++) sim.tick();

  const freshIds = new Set(fresh.map((u) => u.id));
  return nodes.filter((n) => freshIds.has(n.id)).map((n) => ({ id: n.id, x: Math.round(n.x!), y: Math.round(n.y!) }));
}
