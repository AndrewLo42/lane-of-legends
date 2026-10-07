import type { Unit } from '../types';
import { dirTo, dist, ticks } from '../util';
import type { World } from '../world';
import { at, champsAndMinions } from './common';
import type { Kit } from './types';

const Q = { base: [20, 45, 70, 95, 120], ad: 1.2, cost: [28, 31, 34, 37, 40], cd: [5.5, 5.25, 5, 4.75, 4.5], refund: 1.5 };
const W = { base: [80, 135, 190, 245, 300], ad: 0.6, cost: [50, 50, 50, 50, 50], cd: [12, 12, 12, 12, 12], manaBack: 60 };
const E = { base: [80, 130, 180, 230, 280], ad: 0.5, cost: [90, 90, 90, 90, 90], cd: [22, 20, 18, 16, 14], blink: 4.5, seek: 7.5 };
const R = { base: [320, 500], ad: 1.0, cost: [100, 100], cd: [90, 75], minionFactor: 0.5 };
const RANGE = 11;

const momentum = (world: World, self: Unit) => world.addStatus(self, { kind: 'momentum', value: 1, sourceId: self.id, seconds: 6 });

/** Arlo's W mark on `target`, if any. */
const markOf = (world: World, self: Unit, target: Unit) => world.status(target, 'mark', self.id);

/**
 * Hitting a Rune Flare-marked target with an attack or another ability pops the mark for bonus
 * damage and refunds mana (plus the triggering ability's cost).
 */
function detonate(world: World, self: Unit, target: Unit, refund: number) {
  const mark = markOf(world, self, target);
  if (!mark || target.dead) return;
  world.removeStatus(target, mark);
  const rank = self.champ!.abilities[1].rank;
  world.dealDamage(self, target, ARLO.abilities[1].damage!(rank, self), { proc: true });
  self.champ!.mana = Math.min(self.champ!.maxMana, self.champ!.mana + W.manaBack + refund);
  world.addFx({ kind: 'detonate', pos: target.pos, team: self.team });
}

/** A ranged explorer: poke with long skillshots, reposition with a blink, finish from anywhere. */
export const ARLO: Kit = {
  id: 'arlo',
  name: 'Arlo',
  title: 'the Wayfinder',
  blurb: 'Ranged skillshot marksman. Land Sparkshots to shorten every cooldown, blink out of trouble, and snipe the low-health from across the lane.',
  color: '#f2c14e',
  stats: {
    hp: 600, hpPerLevel: 90, mana: 380, manaPerLevel: 45, manaRegen: 2.2, damage: 58, damagePerLevel: 3.5,
    attackInterval: 0.75, attackSpeedPerLevel: 0.025, windup: 0.18, range: 5.5, projectileSpeed: 24, speed: 6.5, radius: 0.6,
  },
  passive: {
    name: 'Momentum',
    icon: '⚡',
    describe: () => 'Each ability hit grants 10% attack speed for 6s, stacking up to 5 times.',
  },
  levelOrder: [3, 0, 2, 1],
  abilities: [
    {
      name: 'Sparkshot',
      icon: '✦',
      maxRank: 5,
      cost: (r) => at(Q.cost, r),
      cooldown: (r) => at(Q.cd, r),
      castTime: 0.2,
      aim: { shape: 'line', length: RANGE, width: 0.6 },
      damage: (r, self) => at(Q.base, r) + Q.ad * self.damage,
      describe: (r, self) =>
        `Fire a bolt that hits the first enemy for ${Math.round(ARLO.abilities[0].damage!(r, self))} damage. ` +
        `On hit, all of Arlo's cooldowns drop by ${Q.refund}s.`,
      cast: ({ world, self, at: aim, rank }) => {
        world.fireLine(self, {
          style: 'spark', dir: dirTo(self.pos, aim), speed: 32, range: RANGE, width: 0.6, canHit: champsAndMinions,
          onHit: (t) => {
            world.dealDamage(self, t, ARLO.abilities[0].damage!(rank, self), { slot: 0 });
            for (const a of self.champ!.abilities) a.readyAt -= ticks(Q.refund);
          },
        });
      },
    },
    {
      name: 'Rune Flare',
      icon: '◈',
      maxRank: 5,
      cost: (r) => at(W.cost, r),
      cooldown: (r) => at(W.cd, r),
      castTime: 0.2,
      aim: { shape: 'line', length: RANGE, width: 0.9 },
      damage: (r, self) => at(W.base, r) + W.ad * self.damage,
      describe: (r, self) =>
        `Launch an orb that passes through minions and marks the first champion for 4s. Hitting the mark with an attack ` +
        `or ability detonates it for ${Math.round(ARLO.abilities[1].damage!(r, self))} damage and restores ${W.manaBack} mana ` +
        `(plus that ability's cost).`,
      cast: ({ world, self, at: aim }) => {
        world.fireLine(self, {
          style: 'flare', dir: dirTo(self.pos, aim), speed: 22, range: RANGE, width: 0.9,
          canHit: (u) => u.kind === 'champion',
          onHit: (t) => {
            world.addStatus(t, { kind: 'mark', value: 1, sourceId: self.id, seconds: 4 });
            momentum(world, self); // a hit, though it deals no damage itself
          },
        });
      },
    },
    {
      name: 'Phase Step',
      icon: '➶',
      maxRank: 5,
      cost: (r) => at(E.cost, r),
      cooldown: (r) => at(E.cd, r),
      castTime: 0,
      aim: { shape: 'dash', range: E.blink },
      damage: (r, self) => at(E.base, r) + E.ad * self.damage,
      describe: (r, self) =>
        `Blink up to ${E.blink} units, then fire a homing bolt at the nearest enemy within ${E.seek} (marked targets first) ` +
        `for ${Math.round(ARLO.abilities[2].damage!(r, self))} damage.`,
      cast: ({ world, self, at: aim, rank }) => {
        world.blink(self, aim, E.blink);
        const near = world.units
          .filter((u) => world.canAttack(self, u) && champsAndMinions(u) && dist(u.pos, self.pos) <= E.seek + u.radius)
          .sort((a, b) => Number(!!markOf(world, self, b)) - Number(!!markOf(world, self, a)) || dist(a.pos, self.pos) - dist(b.pos, self.pos));
        if (near[0]) {
          world.fireHoming(self, near[0], 'bolt', 30, (t) => world.dealDamage(self, t, ARLO.abilities[2].damage!(rank, self), { slot: 2 }));
        }
      },
    },
    {
      name: 'Skyline Barrage',
      icon: '☄',
      maxRank: 2,
      cost: (r) => at(R.cost, r),
      cooldown: (r) => at(R.cd, r),
      castTime: 1,
      aim: { shape: 'line', length: 130, width: 2.4 },
      damage: (r, self) => at(R.base, r) + R.ad * self.damage,
      describe: (r, self) =>
        `After 1s, unleash a wave that crosses the whole lane, hitting everything in its path for ` +
        `${Math.round(ARLO.abilities[3].damage!(r, self))} damage (minions take ${R.minionFactor * 100}%).`,
      onWindup: ({ world, self, at: aim }) => {
        world.telegraph({ team: self.team, shape: 'line', pos: self.pos, dir: Math.atan2(aim.y - self.pos.y, aim.x - self.pos.x), length: 130, width: 2.4 }, 1);
      },
      cast: ({ world, self, at: aim, rank }) => {
        world.fireLine(self, {
          style: 'wave', dir: dirTo(self.pos, aim), speed: 28, range: 130, width: 2.4, pierce: true, canHit: champsAndMinions,
          onHit: (t) => {
            const dmg = ARLO.abilities[3].damage!(rank, self);
            world.dealDamage(self, t, t.kind === 'minion' ? dmg * R.minionFactor : dmg, { slot: 3 });
          },
        });
      },
    },
  ],
  onAbilityHit: (world, self, target, slot) => {
    momentum(world, self);
    if (slot !== 1) detonate(world, self, target, ARLO.abilities[slot].cost(self.champ!.abilities[slot].rank));
  },
  onAttackHit: (world, self, target) => detonate(world, self, target, 0),
};
