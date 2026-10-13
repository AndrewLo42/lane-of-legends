import { clampToLane } from '../sim/lane';
import type { Command, Unit } from '../sim/types';
import { DT, gap, type World } from '../sim/world';

/** A command batch sent to the server, not yet acknowledged; `at` is when it was sent (ms). */
export interface PendingBatch {
  seq: number;
  at: number;
  cmds: Command[];
}

/**
 * Client-side prediction for your own champion's walking. `me` holds the server's state from the
 * snapshot just applied, which is about a round trip behind your inputs: replay the batches the server
 * hasn't applied yet, each at the moment it was given, and walk one round trip forward with the sim's
 * own movement. The next snapshot corrects anything the server saw differently (a minion in the way, a
 * root). Casts, dashes and everyone else stay exactly as the server says.
 */
export function predictOwn(world: World, me: Unit, pending: PendingBatch[], rttMs: number, now: number) {
  if (me.dead) return;
  const ticks = Math.min(20, Math.max(0, Math.round(rttMs / 1000 / DT)));
  let next = 0;
  for (let i = 0; i < ticks; i++) {
    const at = now - (ticks - i) * DT * 1000;
    while (next < pending.length && pending[next].at <= at) applyLocally(me, pending[next++].cmds);
    chase(world, me);
    world.predictMove(me);
  }
  while (next < pending.length) applyLocally(me, pending[next++].cmds); // given within the last tick
}

/** What the server will do with a command, as far as walking goes. */
function applyLocally(me: Unit, cmds: Command[]) {
  for (const c of cmds) {
    if (c.type === 'move') {
      me.moveTarget = clampToLane(c.to, me.radius);
      me.attackTarget = null;
      me.windup = 0;
    } else if (c.type === 'attack') {
      me.attackTarget = c.target;
      me.windup = 0;
    } else if (c.type === 'stop') {
      me.moveTarget = null;
      me.attackTarget = null;
      me.windup = 0;
    }
  }
}

/** Walking to an attack target that's out of reach, and stopping once it's in reach (the server swings). */
function chase(world: World, me: Unit) {
  const t = world.get(me.attackTarget);
  if (!t || t.dead) return;
  me.moveTarget = gap(me, t) > world.attackRange(me, t) ? { ...t.pos } : null;
}
