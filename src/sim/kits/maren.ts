import type { Unit, Vec2 } from '../types';
import { DT, dirTo, dist, ticks, toward } from '../util';
import type { World } from '../world';
import { at, champsAndMinions } from './common';
import type { Kit } from './types';

const Q = { base: [90, 130, 170, 210, 250], ad: 0.6, cost: [50, 50, 50, 50, 50], cd: [6, 5.75, 5.5, 5.25, 5], range: 9, radius: 2, delay: 0.6, slow: 0.3, warnSlow: 0.45 };
const W = { shield: [80, 120, 160, 200, 240], hpRatio: 0.08, burst: [60, 90, 120, 150, 180], ad: 0.4, cost: [60, 60, 60, 60, 60], cd: [14, 13.5, 13, 12.5, 12], duration: 2.5, radius: 2.6 };
const E = { base: [50, 75, 100, 125, 150], ad: 0.4, cost: [70, 70, 70, 70, 70], cd: [16, 15, 14, 13, 12], range: 9, pull: 4 };
const R = { perSec: [60, 100], tickAd: 0.25, erupt: [150, 250], ad: 0.6, cost: [100, 100], cd: [90, 75], range: 8, radius: 4.5, duration: 3, drag: 1.6, stun: 1, warn: 0.75 };
const SOAK = { stacks: 3, root: 1, lasts: 4 };

interface MarenData {
  shieldUp?: boolean;
  maelstrom?: { zone: number; pos: Vec2; until: number; rank: number; nextTick: number };
}
const data = (u: Unit) => u.champ!.data as MarenData;

/** Damage + passive in one place: any of her abilities that hits a champion soaks it. */
function soak(world: World, self: Unit, t: Unit) {
  if (t.kind !== 'champion' || t.dead) return;
  world.addStatus(t, { kind: 'soak', value: 1, sourceId: self.id, seconds: SOAK.lasts });
  const s = world.status(t, 'soak', self.id)!;
  if (s.value >= SOAK.stacks) {
    world.removeStatus(t, s);
    world.addStatus(t, { kind: 'root', value: 1, sourceId: self.id, seconds: SOAK.root });
    world.addFx({ kind: 'splash', pos: t.pos, radius: 1, team: self.team });
  }
}

function burst(world: World, self: Unit) {
  data(self).shieldUp = false;
  const rank = self.champ!.abilities[1].rank;
  world.addFx({ kind: 'splash', pos: self.pos, radius: W.radius, team: self.team });
  for (const e of world.enemiesInCircle(self.team, self.pos, W.radius)) {
    world.dealDamage(self, e, at(W.burst, rank) + W.ad * self.damage, { slot: 1 });
  }
}

function erupt(world: World, self: Unit) {
  const m = data(self).maelstrom;
  if (!m) return;
  data(self).maelstrom = undefined;
  world.removeZone(m.zone);
  world.addFx({ kind: 'erupt', pos: m.pos, radius: R.radius, team: self.team });
  for (const e of world.enemiesInCircle(self.team, m.pos, R.radius)) {
    world.dealDamage(self, e, at(R.erupt, m.rank) + R.ad * self.damage, { slot: 3 });
    if (!e.dead) world.addStatus(e, { kind: 'stun', value: 1, sourceId: self.id, seconds: R.stun });
  }
}

/** A sea-witch who controls space: slow, hook, shield, and a whirlpool that ends in a stun. */
export const MAREN: Kit = {
  id: 'maren',
  name: 'Maren',
  title: 'the Tidecaller',
  blurb: 'Ranged control mage. Land three abilities to root, hook enemies out of position, and drown them in a whirlpool that ends in a stun.',
  color: '#ff9f7a',
  autoStyle: 'water',
  stats: {
    hp: 610, hpPerLevel: 88, mana: 420, manaPerLevel: 50, manaRegen: 2.6, damage: 52, damagePerLevel: 3,
    attackInterval: 0.8, attackSpeedPerLevel: 0.015, windup: 0.22, range: 5, projectileSpeed: 18, speed: 6.4, radius: 0.6,
  },
  passive: {
    name: 'Undertow',
    icon: '≋',
    describe: () => `Maren's abilities Soak enemy champions for ${SOAK.lasts}s. The ${SOAK.stacks}rd stack roots them for ${SOAK.root}s.`,
  },
  levelOrder: [3, 0, 2, 1],
  abilities: [
    {
      name: 'Riptide',
      icon: '◍',
      maxRank: 5,
      cost: (r) => at(Q.cost, r),
      cooldown: (r) => at(Q.cd, r),
      castTime: 0.15,
      aim: { shape: 'circle', range: Q.range, radius: Q.radius },
      damage: (r, self) => at(Q.base, r) + Q.ad * self.damage,
      describe: (r, self) =>
        `Lob a wave at an area. Enemies already inside are slowed ${Q.warnSlow * 100}% while it falls. After ${Q.delay}s it ` +
        `crashes down for ${Math.round(MAREN.abilities[0].damage!(r, self))} damage and slows by ${Q.slow * 100}% for 1.5s.`,
      cast: ({ world, self, at: aim, rank }) => {
        const p = toward(self.pos, aim, Q.range);
        world.telegraph({ team: self.team, shape: 'circle', pos: p, dir: 0, length: Q.radius, width: 0 }, Q.delay);
        if (Q.warnSlow > 0) {
          // The undertow drags at anyone already standing where the wave will land.
          for (const e of world.enemiesInCircle(self.team, p, Q.radius)) world.addStatus(e, { kind: 'slow', value: Q.warnSlow, sourceId: self.id, seconds: Q.delay });
        }
        world.after(Q.delay, () => {
          world.addFx({ kind: 'splash', pos: p, radius: Q.radius, team: self.team });
          for (const e of world.enemiesInCircle(self.team, p, Q.radius)) {
            world.dealDamage(self, e, MAREN.abilities[0].damage!(rank, self), { slot: 0 });
            if (!e.dead) world.addStatus(e, { kind: 'slow', value: Q.slow, sourceId: self.id, seconds: 1.5 });
          }
        });
      },
    },
    {
      name: 'Tide Shield',
      icon: '◓',
      maxRank: 5,
      cost: (r) => at(W.cost, r),
      cooldown: (r) => at(W.cd, r),
      castTime: 0,
      aim: { shape: 'circle', range: 0, radius: W.radius },
      damage: (r, self) => at(W.burst, r) + W.ad * self.damage,
      describe: (r, self) =>
        `Gain a shield that absorbs ${Math.round(at(W.shield, r) + W.hpRatio * self.maxHp)} damage for ${W.duration}s. When it breaks ` +
        `or fades, it bursts for ${Math.round(MAREN.abilities[1].damage!(r, self))} damage around her.`,
      cast: ({ world, self, rank }) => {
        for (const s of self.statuses) if (s.kind === 'shield' && s.sourceId === self.id) s.until = world.tick; // refresh, don't stack
        world.addStatus(self, { kind: 'shield', value: at(W.shield, rank) + W.hpRatio * self.maxHp, sourceId: self.id, seconds: W.duration });
        data(self).shieldUp = true;
      },
    },
    {
      name: 'Undertow Hook',
      icon: '⥂',
      maxRank: 5,
      cost: (r) => at(E.cost, r),
      cooldown: (r) => at(E.cd, r),
      castTime: 0.2,
      aim: { shape: 'line', length: E.range, width: 0.7 },
      damage: (r, self) => at(E.base, r) + E.ad * self.damage,
      describe: (r, self) =>
        `Cast a tidal hook that grabs the first enemy hit, dealing ${Math.round(MAREN.abilities[2].damage!(r, self))} damage ` +
        `and dragging it ${E.pull} units toward Maren.`,
      cast: ({ world, self, at: aim, rank }) => {
        world.fireLine(self, {
          style: 'tide', dir: dirTo(self.pos, aim), speed: 26, range: E.range, width: 0.7, canHit: champsAndMinions,
          onHit: (t) => {
            world.dealDamage(self, t, MAREN.abilities[2].damage!(rank, self), { slot: 2 });
            const room = Math.max(0, dist(t.pos, self.pos) - t.radius - self.radius - 0.4);
            world.pull(t, toward(t.pos, self.pos, Math.min(E.pull, room)), 20);
          },
        });
      },
    },
    {
      name: 'Maelstrom',
      icon: '꩜',
      maxRank: 2,
      cost: (r) => at(R.cost, r),
      cooldown: (r) => at(R.cd, r),
      castTime: 0.25,
      aim: { shape: 'circle', range: R.range, radius: R.radius },
      damage: (r, self) => at(R.erupt, r) + R.ad * self.damage,
      describe: (r, self) =>
        `Summon a whirlpool for ${R.duration}s that drags enemies toward its centre and deals ${Math.round(at(R.perSec, r) + R.tickAd * self.damage)} ` +
        `damage per second. Then it erupts for ${Math.round(MAREN.abilities[3].damage!(r, self))} damage, stunning everyone inside for ${R.stun}s.`,
      cast: ({ world, self, at: aim, rank }) => {
        const pos = toward(self.pos, aim, R.range);
        const zone = world.addZone('maelstrom', self, pos, R.radius, R.duration);
        data(self).maelstrom = { zone: zone.id, pos, until: zone.until, rank, nextTick: world.tick };
        world.after(R.duration - R.warn, () => {
          if (data(self).maelstrom?.zone === zone.id) world.telegraph({ team: self.team, shape: 'circle', pos, dir: 0, length: R.radius, width: 0 }, R.warn);
        });
      },
    },
  ],
  onAbilityHit: (world, self, target) => soak(world, self, target),
  onTick: (world, self) => {
    const d = data(self);
    if (d.shieldUp && !world.status(self, 'shield', self.id)) burst(world, self);
    const m = d.maelstrom;
    if (!m) return;
    if (world.tick >= m.until) return erupt(world, self);
    for (const e of world.enemiesInCircle(self.team, m.pos, R.radius)) world.nudge(e, m.pos, R.drag * DT);
    if (world.tick >= m.nextTick) {
      m.nextTick = world.tick + ticks(0.5);
      for (const e of world.enemiesInCircle(self.team, m.pos, R.radius)) {
        world.dealDamage(self, e, (at(R.perSec, m.rank) + R.tickAd * self.damage) / 2, { proc: true });
      }
    }
  },
  onDeath: (world, self) => {
    const m = data(self).maelstrom;
    if (m) world.removeZone(m.zone);
    self.champ!.data = {};
  },
};

export const MAREN_TUNING = { Q, R };
