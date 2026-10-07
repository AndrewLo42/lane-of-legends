import type { Team, Vec2 } from './types';

/** Lane layout in world units (~1 unit = 1 m). Mirrored across x = 0. */
export const LANE = {
  halfLength: 60,
  halfWidth: 7,
  /** Distance from centre to each side's structures, outermost first. */
  nexusX: 54,
  towerXs: [40, 22],
} as const;

/** Mirror an x coordinate onto a team's side (blue = negative x). */
export const sideX = (team: Team, x: number) => (team === 'blue' ? -x : x);

/** Champions' fountain, behind the nexus so it's out of the minions' path. */
export const spawnPoint = (team: Team): Vec2 => ({ x: sideX(team, LANE.nexusX + 4), y: 0 });

/** Keep a point inside the walkable lane rectangle (minus a unit's radius). */
export function clampToLane(p: Vec2, radius: number): Vec2 {
  const hx = LANE.halfLength - radius;
  const hy = LANE.halfWidth - radius;
  return { x: Math.max(-hx, Math.min(hx, p.x)), y: Math.max(-hy, Math.min(hy, p.y)) };
}
