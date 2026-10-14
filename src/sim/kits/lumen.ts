import type { Status, Unit } from '../types';
import { DT, dirTo, dist, ticks, toward } from '../util';
import type { World } from '../world';
import { at, champsAndMinions } from './common';
import type { Kit } from './types';

/**
 * Lumen, the Kindly: a gentle candle-saint whose light heals and whose heat burns. She outlasts: her
 * abilities heal her as they hurt, healing builds Devotion, and a full meter makes her Radiant, or
 * she spends it to become a burning sun.
 */

/**
 * Devotion: healing she does fills it (one point per `perHp` health). Healing beyond `capPerSec` of her max
 * health a second is turned into Devotion instead of health (the healing cap). At `max` she's Radiant.
 */
const DEVOTION = { max: 100, perHp: 4, capPerSec: 0.03, sunrise: 50 };
/** Afterglow: healing past full health becomes a shield, up to this share of her max health, for a few seconds. */
const GLOW = { cap: 0.2, seconds: 3 };
/** Radiant (full Devotion): more damage and a little speed. */
const RADIANT = { damage: 0.2, haste: 0.1 };
const Q = { base: [70, 110, 150, 190, 230], ad: 0.6, cost: 45, cd: [6, 5.5, 5, 4.5, 4], range: 7, width: 0.8, speed: 20, burn: 0.25, burnFor: 2, heal: 0.3, minionHeal: 0.15, killHeal: 0.04 };
const W = { cost: 60, cd: [14, 13, 12, 11, 10], range: 6, radius: 2.5, seconds: 3, heal: [14, 20, 26, 32, 38], healPct: 0.006, burn: [30, 40, 50, 60, 70], ad: 0.2, slow: 0.2 };
const E = { cost: 50, cd: [12, 11, 10, 9, 8], range: 4, speed: 16, shield: [60, 90, 120, 150, 180], shieldHp: 0.06, shieldFor: 2.5, burn: [60, 90, 120, 150, 180], ad: 0.3, burnFor: 2 };
const R = { cd: [60, 45], radius: 3, base: 4, bonus: 4, dps: [55, 90], ad: 0.4, heal: 0.35 };

interface LumenData {
  devotion?: number;
  /** Healing she can still do this second before the cap turns the rest into Devotion. */
  budget?: number;
  /** The Afterglow shield (a status of hers), if it's up. */
  glow?: Status;
  /** Sunrise runs until this tick. */
  sunUntil?: number;
}
const data = (u: Unit) => u.champ!.data as LumenData;

export const devotion = (u: Unit) => data(u).devotion ?? 0;
export const radiant = (u: Unit) => devotion(u) >= DEVOTION.max;
export const sunrise = (world: World, u: Unit) => (data(u).sunUntil ?? 0) > world.tick;

function addDevotion(self: Unit, n: number) {
  const d = data(self);
  d.devotion = Math.min(DEVOTION.max, (d.devotion ?? 0) + n);
}

/**
 * Every heal of hers goes through here: the cap (anything past this second's budget becomes Devotion),
 * Afterglow (healing past full health becomes a shield), and Devotion for all of it.
 */
export function lumenHeal(world: World, self: Unit, amount: number) {
  if (amount <= 0 || self.dead) return;
  const d = data(self);
  const budget = d.budget ?? self.maxHp * DEVOTION.capPerSec;
  const allowed = Math.min(amount, budget);
  d.budget = budget - allowed;
  const excess = amount - allowed;
  const cut = self.statuses.reduce((m, s) => (s.kind === 'grievous' ? Math.max(m, s.value) : m), 0);
  const healed = world.heal(self, allowed);
  const over = Math.max(0, allowed * (1 - cut) - healed);
  if (over > 0) {
    // Afterglow: top up (or start) her shield, up to its cap.
    const cap = self.maxHp * GLOW.cap;
    const glow = d.glow && self.statuses.includes(d.glow) && d.glow.until > world.tick ? d.glow : undefined;
    if (glow) {
      glow.value = Math.min(cap, glow.value + over);
      glow.until = world.tick + ticks(GLOW.seconds);
    } else {
      world.addStatus(self, { kind: 'shield', value: Math.min(cap, over), sourceId: self.id, seconds: GLOW.seconds });
      d.glow = self.statuses[self.statuses.length - 1];
    }
  }
  addDevotion(self, (healed + over + excess) / DEVOTION.perHp);
}

export const LUMEN: Kit = {
  id: 'lumen',
  name: 'Lumen',
  title: 'the Kindly',
  blurb:
    'A gentle candle-saint whose light heals and whose heat burns. Every hit heals her, healing builds Devotion, and a ' +
    'full meter makes her Radiant, or becomes a burning sun. Burst her down, or bring Scorch.',
  color: '#f2c86b',
  experimental: true,
  stats: {
    hp: 640, hpPerLevel: 95, mana: 380, manaPerLevel: 50, manaRegen: 2.8, damage: 63, damagePerLevel: 3.5,
    attackInterval: 0.75, attackSpeedPerLevel: 0.022, windup: 0.18, range: 5, projectileSpeed: 26, speed: 6.4, radius: 0.55,
  },
  passive: {
    name: 'Devotion',
    icon: '🕯',
    describe: (self) =>
      `Her healing fills Devotion (${Math.floor(devotion(self))}/${DEVOTION.max}). Healing beyond ${DEVOTION.capPerSec * 100}% of her max ` +
      `health a second becomes Devotion instead of health. Healing past full health becomes a shield (Afterglow, up to ` +
      `${GLOW.cap * 100}% of her max health, for ${GLOW.seconds}s). At full Devotion she's Radiant: ${RADIANT.damage * 100}% more ` +
      `damage and ${RADIANT.haste * 100}% move speed, until she spends it.`,
  },
  meter: { label: 'Devotion', max: DEVOTION.max, value: (self) => devotion(self) },
  autoStyle: 'candle',
  levelOrder: [3, 0, 1, 2],
  abilities: [
    {
      name: 'Candleflame',
      icon: '🔥',
      maxRank: 5,
      cost: () => Q.cost,
      cooldown: (r) => at(Q.cd, r),
      castTime: 0.2,
      aim: { shape: 'line', length: Q.range, width: Q.width },
      damage: (r, self) => at(Q.base, r) + Q.ad * self.damage,
      describe: (r, self) =>
        `A candle flame that burns the first enemy hit for ${Math.round(LUMEN.abilities[0].damage!(r, self))} damage, plus ` +
        `${Q.burn * 100}% more over ${Q.burnFor}s. Lumen heals for ${Q.heal * 100}% of the hit (${Q.minionHeal * 100}% off minions), ` +
        `and ${Q.killHeal * 100}% of her max health more if it kills a minion.`,
      cast: ({ world, self, at: aim, rank }) => {
        world.fireLine(self, {
          style: 'candle', dir: dirTo(self.pos, aim), speed: Q.speed, range: Q.range, width: Q.width, canHit: champsAndMinions,
          onHit: (t) => {
            const dmg = LUMEN.abilities[0].damage!(rank, self);
            const dealt = world.dealDamage(self, t, dmg, { slot: 0 });
            if (!t.dead) world.addStatus(t, { kind: 'burn', value: (dmg * Q.burn) / Q.burnFor, sourceId: self.id, seconds: Q.burnFor });
            lumenHeal(world, self, dealt * (t.kind === 'champion' ? Q.heal : Q.minionHeal));
            if (t.dead && t.kind === 'minion') lumenHeal(world, self, self.maxHp * Q.killHeal);
          },
        });
      },
    },
    {
      name: 'Sanctuary',
      icon: '⭕',
      maxRank: 5,
      cost: () => W.cost,
      cooldown: (r) => at(W.cd, r),
      castTime: 0.15,
      aim: { shape: 'circle', range: W.range, radius: W.radius },
      describe: (r, self) =>
        `A ring of light on the ground for ${W.seconds}s. Inside it Lumen heals ${Math.round(at(W.heal, r) + W.healPct * self.maxHp)} ` +
        `a second, and enemies burn for ${Math.round(at(W.burn, r) + W.ad * self.damage)} a second and are slowed ${W.slow * 100}%.`,
      cast: ({ world, self, at: aim }) => {
        const to = dist(self.pos, aim) <= W.range ? { ...aim } : toward(self.pos, aim, W.range);
        world.addZone('sanctuary', self, to, W.radius, W.seconds);
      },
    },
    {
      name: 'Warm Embrace',
      icon: '🤍',
      maxRank: 5,
      cost: () => E.cost,
      cooldown: (r) => at(E.cd, r),
      castTime: 0,
      aim: { shape: 'dash', range: E.range },
      describe: (r, self) =>
        `Dash up to ${E.range} units wrapped in a ${Math.round(at(E.shield, r) + E.shieldHp * self.maxHp)} shield for ${E.shieldFor}s. ` +
        `Enemies she dashes through burn for ${Math.round(at(E.burn, r) + E.ad * self.damage)} over ${E.burnFor}s.`,
      cast: ({ world, self, at: aim, rank }) => {
        world.addStatus(self, { kind: 'shield', value: at(E.shield, rank) + E.shieldHp * self.maxHp, sourceId: self.id, seconds: E.shieldFor });
        const burn = (at(E.burn, rank) + E.ad * self.damage) / E.burnFor;
        world.dash(self, toward(self.pos, aim, E.range), E.speed, (e) => {
          world.addStatus(e, { kind: 'burn', value: burn, sourceId: self.id, seconds: E.burnFor });
          world.addFx({ kind: 'ignite', pos: e.pos, team: self.team });
        });
      },
    },
    {
      name: 'Sunrise',
      icon: '☀',
      maxRank: 2,
      cost: () => 0,
      cooldown: (r) => at(R.cd, r),
      castTime: 0.2,
      aim: { shape: 'circle', range: 0, radius: R.radius },
      available: (_world, self) => devotion(self) >= DEVOTION.sunrise,
      damage: (r, self) => at(R.dps, r) + R.ad * self.damage,
      describe: (r, self) =>
        `Needs ${DEVOTION.sunrise} Devotion, and spends all of it: Lumen becomes a burning sun for ${R.base}s (up to ` +
        `${R.base + R.bonus}s at full Devotion). Enemies within ${R.radius} units burn for ${Math.round(LUMEN.abilities[3].damage!(r, self))} ` +
        `a second, and she heals for ${R.heal * 100}% of it.`,
      cast: ({ world, self }) => {
        const d = data(self);
        const extra = Math.max(0, (devotion(self) - DEVOTION.sunrise) / (DEVOTION.max - DEVOTION.sunrise));
        d.devotion = 0;
        d.sunUntil = world.tick + ticks(R.base + R.bonus * extra);
        world.addFx({ kind: 'bloom', pos: self.pos, radius: R.radius, team: self.team });
      },
    },
  ],
  damageMult: (_world, self) => (radiant(self) ? 1 + RADIANT.damage : 1),
  onTick: (world, self) => {
    const d = data(self);
    // The healing cap's budget refills over a second.
    const cap = self.maxHp * DEVOTION.capPerSec;
    d.budget = Math.min(cap, (d.budget ?? cap) + cap * DT);
    if (radiant(self)) world.addStatus(self, { kind: 'haste', value: RADIANT.haste, sourceId: self.id, seconds: 0.25 });
    // Sanctuary.
    for (const z of world.zones) {
      if (z.ownerId !== self.id || z.kind !== 'sanctuary' || world.tick >= z.until) continue;
      const r = Math.max(1, self.champ!.abilities[1].rank);
      if (dist(self.pos, z.pos) <= z.radius + self.radius) lumenHeal(world, self, (at(W.heal, r) + W.healPct * self.maxHp) * DT);
      for (const e of world.enemiesInCircle(self.team, z.pos, z.radius)) {
        world.dealDamage(self, e, (at(W.burn, r) + W.ad * self.damage) * DT, { slot: 1, proc: true });
        if (!e.dead) world.addStatus(e, { kind: 'slow', value: W.slow, sourceId: self.id, seconds: 0.25 });
      }
    }
    // Sunrise.
    if (sunrise(world, self)) {
      const r = Math.max(1, self.champ!.abilities[3].rank);
      const dps = LUMEN.abilities[3].damage!(r, self);
      let dealt = 0;
      for (const e of world.enemiesInCircle(self.team, self.pos, R.radius)) dealt += world.dealDamage(self, e, dps * DT, { slot: 3, proc: true });
      lumenHeal(world, self, dealt * R.heal);
    }
  },
  onDeath: (_world, self) => {
    const d = data(self);
    d.sunUntil = 0;
    d.glow = undefined;
  },
};

export const LUMEN_TUNING = { DEVOTION, GLOW, RADIANT, Q, W, E, R };
