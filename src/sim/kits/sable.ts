import type { Unit, Vec2 } from '../types';
import { angleTo, dirTo, dist, ticks, toward } from '../util';
import type { World } from '../world';
import { at, champsAndMinions } from './common';
import type { Kit } from './types';

/** Gleaning: hooked enemies are in reach of the scythe's full length, and damaging them heals her. */
const GLEAN = { seconds: 4, reach: 1.2, heal: 0.25 };
/** Her scythe swings sweep: other enemies in a short arc past the target take part of each attack. */
const SWEEP = { radius: 2.6, angle: 1.3, damage: 0.5 };
/** The Reaping window: after a hook lands, one follow-up (Reap, Bind or Vault) before it closes. */
const WINDOW = 2.5;
const Q = { base: [60, 90, 120, 150, 180], ad: 0.6, cost: [55, 55, 55, 55, 55], cd: [8, 7.5, 7, 6.5, 6], range: 8, width: 0.7, speed: 24 };
/** Reap: the empowered swing (an auto-attack on a reaping target), harder the lower they are. */
const REAP = { base: [50, 80, 110, 140, 170], ad: 0.8, missing: 0.75, radius: 3, angle: 1.8, others: 0.5 };
const W = { base: [60, 90, 120, 150, 180], ad: 0.5, cost: [35, 35, 35, 35, 35], cd: [6, 5.5, 5, 4.5, 4], radius: 2.8, slow: 0.3, slowFor: 1.5, windup: 0.15, minion: 1.5 };
const BIND = { base: [30, 45, 60, 75, 90], ad: 0.3, root: 1.25 };
const E = { cost: [40, 40, 40, 40, 40], cd: [16, 15, 14, 13, 12], range: 4, speed: 22, guard: 0.25, guardFor: 2 };
const VAULT = { base: [40, 60, 80, 100, 120], ad: 0.4, over: 0.8, speed: 20, slow: 0.4, slowFor: 1.5 };
const R = { base: [150, 250], ad: 0.6, cost: [100, 100], cd: [80, 65], radius: 7, angle: 1.6, windup: 0.45, speed: 22 };

const rank = (u: Unit, slot: number) => Math.max(1, u.champ!.abilities[slot].rank);

/** Units she currently has a Reaping window on. */
export function reaping(world: World, self: Unit) {
  return world.units.filter((u) => !u.dead && world.status(u, 'reaping', self.id));
}

export const windowOpen = (world: World, self: Unit) => reaping(world, self).length > 0;

/** Hooked: Gleaned, and (re)opens the Reaping window — Q becomes Reap, W Bind, E Vault. */
function hooked(world: World, self: Unit, t: Unit) {
  world.addStatus(t, { kind: 'gleaned', value: 1, sourceId: self.id, seconds: GLEAN.seconds });
  world.addStatus(t, { kind: 'reaping', value: 1, sourceId: self.id, seconds: WINDOW });
  const until = world.tick + ticks(WINDOW);
  for (const slot of [0, 1, 2]) {
    const st = self.champ!.abilities[slot];
    if (st.rank > 0) st.recastUntil = until; // Bind and Vault need W and E learned
  }
}

/** One follow-up per hook: using any of them closes the window for the others. */
function closeWindow(world: World, self: Unit) {
  for (const u of world.units) u.statuses = u.statuses.filter((s) => !(s.kind === 'reaping' && s.sourceId === self.id));
  for (const slot of [0, 1, 2]) self.champ!.abilities[slot].recastUntil = 0;
}

/** Pull `t` to just in front of her, keeping some of its sideways offset so a crowd doesn't stack. */
function reel(world: World, self: Unit, t: Unit, dir: Vec2, side = 0) {
  const reach = self.radius + t.radius + 0.3;
  world.pull(t, { x: self.pos.x + dir.x * reach - dir.y * side, y: self.pos.y + dir.y * reach + dir.x * side }, 20);
}

/** The empowered swing, toward whoever she's reaping (the champion first). */
function reap(world: World, self: Unit) {
  const targets = reaping(world, self);
  const target = targets.find((u) => u.kind === 'champion') ?? targets.sort((a, b) => dist(a.pos, self.pos) - dist(b.pos, self.pos))[0];
  if (!target) return closeWindow(world, self);
  const r = rank(self, 0);
  const dir = angleTo(self.pos, target.pos);
  self.facing = dir;
  const base = at(REAP.base, r) + REAP.ad * self.damage;
  world.addFx({ kind: 'swing', pos: self.pos, dir, radius: REAP.radius, angle: REAP.angle, team: self.team });
  const marked = new Set(reaping(world, self).map((u) => u.id));
  closeWindow(world, self);
  for (const e of world.enemiesInCone(self.team, self.pos, dir, REAP.radius, REAP.angle)) {
    if (!marked.has(e.id)) {
      world.dealDamage(self, e, base * REAP.others, { slot: 0, proc: true });
      continue;
    }
    const missing = 1 - e.hp / e.maxHp;
    world.dealDamage(self, e, base * (1 + REAP.missing * missing), { slot: 0, proc: true });
  }
}

/** A quiet harvest reaper: hook an enemy in, then choose one follow-up — Reap, Bind or Vault. */
export const SABLE: Kit = {
  id: 'sable',
  name: 'Sable',
  title: 'the Silent',
  blurb:
    'Melee catcher with a chained scythe. Hook an enemy to her, weave in a swing, then pick one follow-up: Reap them with an empowered swing, ' +
    'Bind them in place, or Vault over them to cut off their escape.',
  color: '#c9b26b',
  experimental: true,
  stats: {
    hp: 700, hpPerLevel: 100, mana: 360, manaPerLevel: 45, manaRegen: 2.2, damage: 66, damagePerLevel: 4,
    attackInterval: 0.85, attackSpeedPerLevel: 0.02, windup: 0.22, range: 2.0, projectileSpeed: 0, speed: 6.6, radius: 0.6,
  },
  passive: {
    name: 'Gleaning',
    icon: '🌾',
    describe: () =>
      `Enemies Sable hooks are Gleaned for ${GLEAN.seconds}s: she can attack them from ${GLEAN.reach} units further away ` +
      `(the scythe's full length), and her damage to them heals her for ${GLEAN.heal * 100}% of it. Her attacks sweep: other ` +
      `enemies in a short arc take ${SWEEP.damage * 100}% of the hit.`,
  },
  levelOrder: [3, 0, 1, 2],
  abilities: [
    {
      name: 'Reaping Hook',
      icon: '🪝',
      maxRank: 5,
      cost: (r) => at(Q.cost, r),
      cooldown: (r) => at(Q.cd, r),
      castTime: 0.2,
      aim: { shape: 'line', length: Q.range, width: Q.width },
      damage: (r, self) => at(Q.base, r) + Q.ad * self.damage,
      describe: (r, self) =>
        `Throw the scythe's blade on its chain. The first enemy hit takes ${Math.round(SABLE.abilities[0].damage!(r, self))} damage and is ` +
        `yanked to Sable, opening a ${WINDOW}s Reaping window for ONE follow-up (attack them as much as you like first): press Q ` +
        `again to Reap (an empowered swing for ${Math.round(at(REAP.base, r) + REAP.ad * self.damage)} damage, up to ` +
        `${REAP.missing * 100}% more the lower they are), W to Bind, or E to Vault.`,
      cast: ({ world, self, at: aim, rank: r }) => {
        world.fireLine(self, {
          style: 'hook', dir: dirTo(self.pos, aim), speed: Q.speed, range: Q.range, width: Q.width, canHit: champsAndMinions,
          onHit: (t) => {
            world.dealDamage(self, t, SABLE.abilities[0].damage!(r, self), { slot: 0 });
            if (t.dead) return;
            reel(world, self, t, dirTo(self.pos, t.pos));
            hooked(world, self, t);
          },
        });
      },
      // Reap: the recast is only ever open during a Reaping window.
      recast: ({ world, self }) => reap(world, self),
      recastTime: 0.1,
    },
    {
      name: 'Wide Swath',
      icon: '🌀',
      maxRank: 5,
      cost: (r) => at(W.cost, r),
      cooldown: (r) => at(W.cd, r),
      castTime: W.windup,
      aim: { shape: 'circle', range: 0, radius: W.radius },
      damage: (r, self) => at(W.base, r) + W.ad * self.damage,
      describe: (r, self) =>
        `Spin the scythe around her: ${Math.round(SABLE.abilities[1].damage!(r, self))} damage to enemies within ${W.radius} units ` +
        `(${Math.round(W.minion * 100)}% to minions), slowing ` +
        `them ${W.slow * 100}% for ${W.slowFor}s. In a Reaping window, Bind instead: the chain wraps everyone she's reaping, ` +
        `dealing ${Math.round(at(BIND.base, r) + BIND.ad * self.damage)} damage and rooting them for ${BIND.root}s.`,
      cast: ({ world, self, rank: r }) => {
        world.addFx({ kind: 'swing', pos: self.pos, dir: self.facing, radius: W.radius, angle: Math.PI * 2, team: self.team });
        for (const e of world.enemiesInCircle(self.team, self.pos, W.radius)) {
          world.dealDamage(self, e, SABLE.abilities[1].damage!(r, self) * (e.kind === 'minion' ? W.minion : 1), { slot: 1 });
          if (!e.dead) world.addStatus(e, { kind: 'slow', value: W.slow, sourceId: self.id, seconds: W.slowFor });
        }
      },
      // Bind: the recast is only ever open during a Reaping window.
      recast: ({ world, self, rank: r }) => {
        const targets = reaping(world, self);
        closeWindow(world, self);
        for (const t of targets) {
          world.dealDamage(self, t, at(BIND.base, r) + BIND.ad * self.damage, { slot: 1 });
          if (!t.dead) world.addStatus(t, { kind: 'root', value: 1, sourceId: self.id, seconds: BIND.root });
          world.addFx({ kind: 'bind', pos: t.pos, radius: t.radius + 0.4, team: self.team });
        }
      },
      recastTime: 0,
    },
    {
      name: 'Drift',
      icon: '🪶',
      maxRank: 5,
      cost: (r) => at(E.cost, r),
      cooldown: (r) => at(E.cd, r),
      castTime: 0,
      aim: { shape: 'dash', range: E.range },
      describe: (r, self) =>
        `Glide up to ${E.range} units, wrapping her cloak around her: she takes ${E.guard * 100}% less damage for ${E.guardFor}s. In a Reaping window, Vault instead: pole-vault over the enemy she's reaping (the champion ` +
        `first), landing on their far side for ${Math.round(at(VAULT.base, r) + VAULT.ad * self.damage)} damage and slowing them ` +
        `${VAULT.slow * 100}% for ${VAULT.slowFor}s.`,
      cast: ({ world, self, at: aim }) => {
        world.dash(self, toward(self.pos, aim, E.range), E.speed);
        world.addStatus(self, { kind: 'guard', value: E.guard, sourceId: self.id, seconds: E.guardFor });
      },
      // Vault: the recast is only ever open during a Reaping window.
      recast: ({ world, self, rank: r }) => {
        const targets = reaping(world, self);
        const t = targets.find((u) => u.kind === 'champion') ?? targets.sort((a, b) => dist(a.pos, self.pos) - dist(b.pos, self.pos))[0];
        closeWindow(world, self);
        if (!t) return;
        const d = dirTo(self.pos, t.pos);
        const over = self.radius + t.radius + VAULT.over;
        world.dash(self, { x: t.pos.x + d.x * over, y: t.pos.y + d.y * over }, VAULT.speed, undefined, () => {
          world.addFx({ kind: 'dashHit', pos: self.pos, team: self.team });
          if (t.dead) return;
          world.dealDamage(self, t, at(VAULT.base, r) + VAULT.ad * self.damage, { slot: 2 });
          if (!t.dead) world.addStatus(t, { kind: 'slow', value: VAULT.slow, sourceId: self.id, seconds: VAULT.slowFor });
          self.facing = angleTo(self.pos, t.pos);
        });
      },
      recastTime: 0,
    },
    {
      name: 'Last Harvest',
      icon: '🌙',
      maxRank: 2,
      cost: (r) => at(R.cost, r),
      cooldown: (r) => at(R.cd, r),
      castTime: R.windup,
      aim: { shape: 'cone', radius: R.radius, angle: R.angle },
      damage: (r, self) => at(R.base, r) + R.ad * self.damage,
      describe: (r, self) =>
        `After ${R.windup}s, sweep a great crescent: everything in it takes ${Math.round(SABLE.abilities[3].damage!(r, self))} damage ` +
        `and is dragged in to Sable, Gleaned and opened to a Reaping window (one Bind roots them all, one Reap hits them all).`,
      onWindup: ({ world, self, at: aim }) => {
        world.telegraph({ team: self.team, shape: 'cone', pos: self.pos, dir: angleTo(self.pos, aim), length: R.radius, width: R.angle }, R.windup);
      },
      cast: ({ world, self, at: aim, rank: r }) => {
        const dir = angleTo(self.pos, aim);
        const d = { x: Math.cos(dir), y: Math.sin(dir) };
        world.addFx({ kind: 'swing', pos: self.pos, dir, radius: R.radius, angle: R.angle, team: self.team });
        for (const e of world.enemiesInCone(self.team, self.pos, dir, R.radius, R.angle)) {
          world.dealDamage(self, e, SABLE.abilities[3].damage!(r, self), { slot: 3 });
          if (e.dead) continue;
          const side = (e.pos.x - self.pos.x) * -d.y + (e.pos.y - self.pos.y) * d.x;
          reel(world, self, e, d, Math.max(-1.5, Math.min(1.5, side * 0.3)));
          hooked(world, self, e);
        }
      },
    },
  ],
  attackRangeBonus: (world, self, target) => (world.status(target, 'gleaned', self.id) ? GLEAN.reach : 0),
  onAttackHit: (world, self, target) => {
    const dir = angleTo(self.pos, target.pos);
    for (const e of world.enemiesInCone(self.team, self.pos, dir, SWEEP.radius, SWEEP.angle)) {
      if (e !== target) world.dealDamage(self, e, self.damage * SWEEP.damage, { proc: true });
    }
  },
  onDamageDealt: (world, self, target, amount) => {
    if (world.status(target, 'gleaned', self.id)) world.heal(self, amount * GLEAN.heal);
  },
  onDeath: (world, self) => closeWindow(world, self),
};

export const SABLE_TUNING = { GLEAN, SWEEP, WINDOW, Q, REAP, W, BIND, E, VAULT, R };
