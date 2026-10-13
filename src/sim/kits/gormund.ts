import type { Unit, Vec2 } from '../types';
import { DT, dirTo, dist, ticks, toward } from '../util';
import type { World } from '../world';
import { at, champsAndMinions } from './common';
import type { Kit } from './types';

/** Thick Hide: out-of-combat regeneration, and Fury's damage as his health drops. */
const HIDE = { calm: 3, regen: 0.05, fury: 0.3, furyAt: 0.3 };
const Q = { base: [70, 110, 150, 190, 230], ad: 0.6, cost: 0.07, cd: [6, 5.5, 5, 4.5, 4], range: 8, width: 0.8, speed: 20, slow: 0.35, slowFor: 1.5, shatter: 2, splash: 0.6 };
const W = { cost: 0.05, cd: [14, 13, 12, 11, 10], radius: 3.5, slow: 0.35, slowFor: 2, haste: 0.25, hasteFor: 2, guard: 0.25, guardFor: 3 };
const E = { base: [60, 95, 130, 165, 200], ad: 0.5, cost: 0.1, cd: [14, 13, 12, 11, 10], range: 6, speed: 18, windup: 0.15, stun: 0.75, minion: 0.5, shove: 1.5 };
const R = { cd: [80, 65], seconds: 7, vamp: 0.2 };

interface GormundData {
  /** Last tick he traded with the enemy champion or took a tower shot (minions don't count). */
  struck?: number;
  /** Labyrinth Rage runs until this tick. */
  rageUntil?: number;
}
const data = (u: Unit) => u.champ!.data as GormundData;

export const raging = (world: World, u: Unit) => (data(u).rageUntil ?? 0) > world.tick;

/** Ticks since he last fought: hit or got hit by the enemy champion, or took a tower shot. */
export function calmFor(world: World, u: Unit) {
  return world.tick - (data(u).struck ?? -999);
}

/** Fury: 0 at full health, rising to the full bonus at `furyAt` health and below. */
export function fury(u: Unit) {
  const missing = 1 - u.hp / u.maxHp;
  return HIDE.fury * Math.min(1, Math.max(0, missing / (1 - HIDE.furyAt)));
}

/** A minotaur who pays for his abilities in blood and hits harder the more he's bled. */
export const GORMUND: Kit = {
  id: 'gormund',
  name: 'Gormund',
  title: 'Lord of the Labyrinth',
  blurb:
    'Melee juggernaut with no mana: his abilities cost health, he regenerates fast out of combat, and he hits harder the lower he gets. ' +
    'Slow him, poke him, and never let him catch his breath.',
  color: '#c0703a',
  resource: 'health',
  stats: {
    hp: 820, hpPerLevel: 115, mana: 0, manaPerLevel: 0, manaRegen: 0, damage: 66, damagePerLevel: 4,
    attackInterval: 0.95, attackSpeedPerLevel: 0.018, windup: 0.25, range: 1.5, projectileSpeed: 0, speed: 6.4, radius: 0.75,
  },
  passive: {
    name: 'Thick Hide',
    icon: '🐂',
    describe: (self) =>
      `Abilities cost a share of Gormund's current health instead of mana. After ${HIDE.calm}s without trading with the enemy ` +
      `champion or taking tower shots (minions don't count), he regenerates ${HIDE.regen * 100}% of his max health per second. ` +
      `Fury: he deals up to ${HIDE.fury * 100}% more damage as his health drops, maxing out at ${HIDE.furyAt * 100}% health ` +
      `(now +${Math.round(fury(self) * 100)}%).`,
  },
  levelOrder: [3, 0, 2, 1],
  abilities: [
    {
      name: 'Hurl Stone',
      icon: '🪨',
      maxRank: 5,
      cost: () => Q.cost,
      cooldown: (r) => at(Q.cd, r),
      castTime: 0.2,
      aim: { shape: 'line', length: Q.range, width: Q.width },
      damage: (r, self) => at(Q.base, r) + Q.ad * self.damage,
      describe: (r, self) =>
        `Rip up a chunk of the labyrinth floor and hurl it. The first enemy hit takes ${Math.round(GORMUND.abilities[0].damage!(r, self))} ` +
        `damage and is slowed ${Q.slow * 100}% for ${Q.slowFor}s; the stone shatters, dealing ${Q.splash * 100}% to other enemies ` +
        `within ${Q.shatter} units. Hitting the enemy champion gives back the health it cost.`,
      cast: ({ world, self, at: aim, rank, paid }) => {
        world.fireLine(self, {
          style: 'stone', dir: dirTo(self.pos, aim), speed: Q.speed, range: Q.range, width: Q.width, canHit: champsAndMinions,
          onHit: (t) => {
            const dmg = GORMUND.abilities[0].damage!(rank, self);
            const at = { ...t.pos };
            const others = world.enemiesInCircle(self.team, at, Q.shatter).filter((e) => e !== t);
            world.dealDamage(self, t, dmg, { slot: 0 });
            if (!t.dead) world.addStatus(t, { kind: 'slow', value: Q.slow, sourceId: self.id, seconds: Q.slowFor });
            for (const e of others) world.dealDamage(self, e, dmg * Q.splash, { slot: 0 });
            world.addFx({ kind: 'slam', pos: at, radius: Q.shatter, team: self.team });
            if (t.kind === 'champion' && paid) world.heal(self, paid);
          },
        });
      },
    },
    {
      name: 'Bellow',
      icon: '📢',
      maxRank: 5,
      cost: () => W.cost,
      cooldown: (r) => at(W.cd, r),
      castTime: 0,
      aim: { shape: 'circle', range: 0, radius: W.radius },
      describe: () =>
        `Roar. Enemies within ${W.radius} units are slowed ${W.slow * 100}% for ${W.slowFor}s. Gormund gains ${W.haste * 100}% ` +
        `movement speed for ${W.hasteFor}s and takes ${W.guard * 100}% less damage for ${W.guardFor}s.`,
      cast: ({ world, self }) => {
        world.addFx({ kind: 'bellow', pos: self.pos, radius: W.radius, team: self.team });
        for (const e of world.enemiesInCircle(self.team, self.pos, W.radius)) {
          world.addStatus(e, { kind: 'slow', value: W.slow, sourceId: self.id, seconds: W.slowFor });
        }
        world.addStatus(self, { kind: 'haste', value: W.haste, sourceId: self.id, seconds: W.hasteFor });
        world.addStatus(self, { kind: 'guard', value: W.guard, sourceId: self.id, seconds: W.guardFor });
      },
    },
    {
      name: 'Bull Rush',
      icon: '🐃',
      maxRank: 5,
      cost: () => E.cost,
      cooldown: (r) => at(E.cd, r),
      castTime: E.windup,
      aim: { shape: 'dash', range: E.range },
      damage: (r, self) => at(E.base, r) + E.ad * self.damage,
      describe: (r, self) =>
        `Lower the horns and charge up to ${E.range} units in a straight line. The first enemy champion in the way is carried ` +
        `to the end of the charge, then takes ${Math.round(GORMUND.abilities[2].damage!(r, self))} damage and is stunned for ${E.stun}s. ` +
        `Minions in the way are shoved aside and take ${E.minion * 100}% damage.`,
      onWindup: ({ world, self, at: aim }) => {
        const end = toward(self.pos, aim, E.range);
        world.telegraph({ team: self.team, shape: 'line', pos: self.pos, dir: Math.atan2(end.y - self.pos.y, end.x - self.pos.x), length: dist(self.pos, end), width: self.radius * 2 }, E.windup);
      },
      cast: ({ world, self, at: aim, rank }) => {
        const dir = dirTo(self.pos, aim);
        const end = toward(self.pos, aim, E.range);
        const dmg = GORMUND.abilities[2].damage!(rank, self);
        let carried: Unit | undefined;
        const ahead = (): Vec2 => {
          const lead = self.radius + (carried?.radius ?? 0) + 0.1;
          return { x: end.x + dir.x * lead, y: end.y + dir.y * lead };
        };
        world.dash(
          self, end, E.speed,
          (e) => {
            if (e.kind === 'champion' && !carried) {
              carried = e;
              world.pull(e, ahead(), E.speed);
            } else if (e.kind === 'minion') {
              world.dealDamage(self, e, dmg * E.minion, { slot: 2 });
              const side = { x: -dir.y, y: dir.x };
              const s = (e.pos.x - self.pos.x) * side.x + (e.pos.y - self.pos.y) * side.y >= 0 ? 1 : -1;
              if (!e.dead) world.pull(e, { x: e.pos.x + side.x * s * E.shove, y: e.pos.y + side.y * s * E.shove }, 12);
            }
          },
          () => {
            world.addFx({ kind: 'slam', pos: self.pos, radius: 1.4, team: self.team });
            if (!carried || carried.dead) return;
            carried.forced = null; // dropped where the charge ends
            world.dealDamage(self, carried, dmg, { slot: 2 });
            if (!carried.dead) world.addStatus(carried, { kind: 'stun', value: 1, sourceId: self.id, seconds: E.stun });
          },
        );
      },
    },
    {
      name: 'Labyrinth Rage',
      icon: '♉',
      maxRank: 2,
      cost: () => 0,
      cooldown: (r) => at(R.cd, r),
      castTime: 0,
      aim: { shape: 'circle', range: 0, radius: 1.2 },
      describe: () =>
        `Grow huge for ${R.seconds}s: shake off and ignore slows, roots and stuns, abilities cost no health, and he heals ` +
        `for ${R.vamp * 100}% of the damage he deals.`,
      cast: ({ world, self }) => {
        self.statuses = self.statuses.filter((s) => s.kind !== 'slow' && s.kind !== 'root' && s.kind !== 'stun');
        world.addStatus(self, { kind: 'unstoppable', value: 1, sourceId: self.id, seconds: R.seconds });
        data(self).rageUntil = world.tick + ticks(R.seconds);
        world.addFx({ kind: 'bellow', pos: self.pos, radius: 2, team: self.team });
      },
    },
  ],
  freeCasts: (world, self) => raging(world, self),
  damageMult: (_world, self) => 1 + fury(self),
  onDamageDealt: (world, self, target, amount) => {
    if (target.kind === 'champion') data(self).struck = world.tick;
    if (raging(world, self)) world.heal(self, amount * R.vamp);
  },
  onHurt: (world, self, src) => {
    if (src?.kind === 'champion' || src?.kind === 'tower') data(self).struck = world.tick;
  },
  onTick: (world, self) => {
    if (calmFor(world, self) >= ticks(HIDE.calm)) world.heal(self, self.maxHp * HIDE.regen * DT);
  },
  onDeath: (_world, self) => {
    self.champ!.data = {};
  },
};

export const GORMUND_TUNING = { HIDE, Q, W, E, R };
