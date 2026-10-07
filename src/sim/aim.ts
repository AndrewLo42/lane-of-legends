import type { Unit, Vec2 } from './types';
import { dirTo, dist, segmentDistance } from './util';
import type { World } from './world';

/** Where `target` will be when a missile of `speed` fired from `from` reaches it, if it keeps walking. */
export function lead(world: World, from: Vec2, target: Unit, speed: number): Vec2 {
  if (!target.moveTarget || world.isBusy(target)) return { ...target.pos };
  const v = dirTo(target.pos, target.moveTarget);
  const s = world.effectiveSpeed(target);
  const maxT = dist(target.pos, target.moveTarget) / Math.max(s, 1e-6);
  let p = { ...target.pos };
  for (let i = 0; i < 3; i++) {
    const t = Math.min(maxT, dist(from, p) / speed);
    p = { x: target.pos.x + v.x * s * t, y: target.pos.y + v.y * s * t };
  }
  return p;
}

/** Where `target` will be after `seconds` if it keeps walking (for delayed ground effects). */
export function leadTime(world: World, target: Unit, seconds: number): Vec2 {
  if (!target.moveTarget || world.isBusy(target) || world.isRooted(target)) return { ...target.pos };
  const step = Math.min(dist(target.pos, target.moveTarget), world.effectiveSpeed(target) * seconds);
  const v = dirTo(target.pos, target.moveTarget);
  return { x: target.pos.x + v.x * step, y: target.pos.y + v.y * step };
}

/** Would a non-piercing line of `width` from `from` to `to` hit an enemy minion first? */
export function minionInTheWay(world: World, self: Unit, to: Vec2, width: number, ignore?: Unit) {
  return world.units.some(
    (u) => u !== ignore && !u.dead && u.kind === 'minion' && u.team !== self.team && segmentDistance(u.pos, self.pos, to).d <= width / 2 + u.radius,
  );
}
