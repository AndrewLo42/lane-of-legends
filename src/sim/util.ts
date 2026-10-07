import type { Team, Unit, Vec2 } from './types';

/** Fixed simulation rate. Rendering interpolates between ticks. */
export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ;
export const ticks = (seconds: number) => Math.max(1, Math.round(seconds * TICK_HZ));

export const enemyOf = (t: Team): Team => (t === 'blue' ? 'red' : 'blue');
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
/** Edge-to-edge distance between two units. */
export const gap = (a: Unit, b: Unit) => dist(a.pos, b.pos) - a.radius - b.radius;
export const angleTo = (from: Vec2, to: Vec2) => Math.atan2(to.y - from.y, to.x - from.x);
export const dirTo = (from: Vec2, to: Vec2): Vec2 => {
  const d = dist(from, to);
  return d < 1e-6 ? { x: 1, y: 0 } : { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
};
/** `from` moved toward `to` by at most `max`. */
export const toward = (from: Vec2, to: Vec2, max: number): Vec2 => {
  const d = dist(from, to);
  if (d <= max) return { ...to };
  return { x: from.x + ((to.x - from.x) / d) * max, y: from.y + ((to.y - from.y) / d) * max };
};

/** Distance from point p to segment ab, and how far along the segment (0..1) the closest point is. */
export function segmentDistance(p: Vec2, a: Vec2, b: Vec2) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return { d: Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y), t };
}

/** Does the circle (c, r) overlap the cone at `origin` facing `dir` (radians)? */
export function inCone(origin: Vec2, dir: number, radius: number, angle: number, c: Vec2, r: number) {
  const d = dist(origin, c);
  if (d - r > radius) return false;
  if (d < r) return true;
  let diff = Math.atan2(c.y - origin.y, c.x - origin.x) - dir;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  // Widen the arc by the target's angular half-size so big targets at the edge still count.
  return Math.abs(diff) <= angle / 2 + Math.asin(Math.min(1, r / d));
}
