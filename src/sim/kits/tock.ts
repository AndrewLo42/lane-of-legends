import type { Unit, Vec2 } from '../types';
import { angleTo, dist, ticks, toward } from '../util';
import type { World } from '../world';
import { at } from './common';
import type { Kit } from './types';

const Q = { base: [60, 95, 130, 165, 200], ad: 0.9, cost: [40, 40, 40, 40, 40], cd: [7, 6.5, 6, 5.5, 5], radius: 3.6, angle: (110 * Math.PI) / 180, backswing: 1.5 };
const W = {
  cost: [70, 70, 70, 70, 70], cd: [18, 17, 16, 15, 14], range: 7, radius: 3.5, duration: [2, 2.25, 2.5, 2.75, 3],
  /** Standing in his own field shields Tock (once per field); it fades `linger` s after he leaves. */
  shield: [30, 45, 60, 75, 90], shieldHp: 0.02, linger: 1,
};
const E = { base: [50, 80, 110, 140, 170], ad: 0.5, cost: [40, 40, 40, 40, 40], cd: [14, 13, 12, 11, 10], range: 5.5, echo: 4 };
const R = { echo: [0.5, 0.75], cost: [100, 100], cd: [100, 80], window: 3 };
const PASSIVE = { every: 3, delay: 0.4, ratio: 0.6 };

/** Tock's per-champion bookkeeping, kept in `champ.data`. */
interface TockData {
  hits?: number;
  /** Ids the first Pendulum swing hit (they take more from the backswing). */
  swung?: number[];
  echo?: { pos: Vec2; zone: number };
  rewind?: { anchor: Vec2; hp: number; until: number; zone: number; dealt: Record<number, number> };
  /** Stopwatch fields that have already shielded him. */
  shieldedBy?: number[];
}
const data = (u: Unit) => u.champ!.data as TockData;

function sweep(world: World, self: Unit, aim: Vec2, rank: number, backswing: boolean) {
  const dir = angleTo(self.pos, aim);
  self.facing = dir;
  world.addFx({ kind: 'swing', pos: self.pos, dir, radius: Q.radius, angle: Q.angle, team: self.team });
  const hit = world.enemiesInCone(self.team, self.pos, dir, Q.radius, Q.angle);
  const base = at(Q.base, rank) + Q.ad * self.damage;
  const swung = data(self).swung ?? [];
  for (const t of hit) world.dealDamage(self, t, backswing && swung.includes(t.id) ? base * Q.backswing : base, { slot: 0 });
  data(self).swung = backswing ? [] : hit.map((t) => t.id);
}

function rewind(world: World, self: Unit) {
  const r = data(self).rewind;
  if (!r) return;
  data(self).rewind = undefined;
  self.champ!.abilities[3].recastUntil = 0;
  world.removeZone(r.zone);
  world.addFx({ kind: 'rewind', pos: self.pos, team: self.team });
  self.pos = { ...r.anchor };
  self.moveTarget = null;
  self.champ!.dash = null;
  self.hp = Math.max(self.hp, Math.min(self.maxHp, r.hp));
  world.addFx({ kind: 'rewind', pos: self.pos, team: self.team });
  const ratio = at(R.echo, self.champ!.abilities[3].rank);
  for (const [id, amount] of Object.entries(r.dealt)) {
    const t = world.get(Number(id));
    if (t && !t.dead) {
      world.dealDamage(self, t, amount * ratio, { proc: true });
      world.addFx({ kind: 'echoHit', pos: t.pos, team: self.team });
    }
  }
}

/** Inside his own Stopwatch: shield him once per field, and keep it up while he stays inside. */
function stopwatchShield(world: World, self: Unit) {
  const d = data(self);
  d.shieldedBy = (d.shieldedBy ?? []).filter((id) => world.zones.some((z) => z.id === id));
  const rank = self.champ!.abilities[1].rank;
  for (const z of world.zones) {
    if (z.kind !== 'stasis' || z.ownerId !== self.id || dist(z.pos, self.pos) > z.radius) continue;
    const shield = world.status(self, 'shield', z.id);
    if (shield) {
      shield.until = Math.max(shield.until, world.tick + ticks(W.linger));
    } else if (!d.shieldedBy.includes(z.id)) {
      d.shieldedBy.push(z.id);
      world.addStatus(self, { kind: 'shield', value: at(W.shield, rank) + W.shieldHp * self.maxHp, sourceId: z.id, seconds: W.linger });
    }
  }
}

/**
 * A clockwork knight who bends the few seconds around him: freeze projectiles in the air, skip
 * forward and snap back, and undo a bad trade entirely.
 */
export const TOCK: Kit = {
  id: 'tock',
  name: 'Tock',
  title: 'the Unwound',
  blurb: 'Melee time-bender. Dash in, freeze enemy projectiles mid-air, and when a fight goes wrong, rewind it: back to where you were, health restored, and their pain replayed.',
  color: '#5fd0c4',
  stats: {
    hp: 620, hpPerLevel: 92, mana: 300, manaPerLevel: 40, manaRegen: 1.8, damage: 64, damagePerLevel: 4.5,
    attackInterval: 0.85, attackSpeedPerLevel: 0.02, windup: 0.2, range: 1.4, projectileSpeed: 0, speed: 6.6, radius: 0.65,
  },
  passive: {
    name: 'Second Hand',
    icon: '⏲',
    describe: (self) => `Every ${PASSIVE.every}rd attack echoes ${PASSIVE.delay}s later for ${Math.round(PASSIVE.ratio * self.damage)} damage.`,
  },
  levelOrder: [3, 0, 2, 1],
  abilities: [
    {
      name: 'Pendulum',
      icon: '◠',
      maxRank: 5,
      cost: (r) => at(Q.cost, r),
      cooldown: (r) => at(Q.cd, r),
      castTime: 0.3,
      recastWindow: 3,
      recastTime: 0.2,
      aim: { shape: 'cone', radius: Q.radius, angle: Q.angle },
      damage: (r, self) => at(Q.base, r) + Q.ad * self.damage,
      describe: (r, self) =>
        `Sweep the blade through a wide arc for ${Math.round(at(Q.base, r) + Q.ad * self.damage)} damage. ` +
        `Recast within 3s to backswing; enemies caught by both swings take ${Q.backswing * 100}% from the second.`,
      onWindup: ({ world, self, at: aim, recast }) => {
        world.telegraph({ team: self.team, shape: 'cone', pos: self.pos, dir: angleTo(self.pos, aim), length: Q.radius, width: Q.angle }, recast ? 0.2 : 0.3);
      },
      cast: ({ world, self, at: aim, rank }) => sweep(world, self, aim, rank, false),
      recast: ({ world, self, at: aim, rank }) => sweep(world, self, aim, rank, true),
    },
    {
      name: 'Stopwatch',
      icon: '◷',
      maxRank: 5,
      cost: (r) => at(W.cost, r),
      cooldown: (r) => at(W.cd, r),
      castTime: 0.15,
      aim: { shape: 'circle', range: W.range, radius: W.radius },
      describe: (r, self) =>
        `Stop time in an area for ${at(W.duration, r)}s. Enemies inside are slowed by 35%, and enemy skillshots that ` +
        `enter it freeze in place and crumble when it ends (auto-attacks pass through). Inside his own field, Tock gains a ` +
        `${Math.round(at(W.shield, r) + W.shieldHp * self.maxHp)} shield (once per field) that fades ${W.linger}s after he leaves.`,
      cast: ({ world, self, at: aim, rank }) => {
        world.addZone('stasis', self, toward(self.pos, aim, W.range), W.radius, at(W.duration, rank));
      },
    },
    {
      name: 'Skip',
      icon: '⇥',
      maxRank: 5,
      cost: (r) => at(E.cost, r),
      cooldown: (r) => at(E.cd, r),
      castTime: 0,
      recastWindow: E.echo,
      aim: { shape: 'dash', range: E.range },
      damage: (r, self) => at(E.base, r) + E.ad * self.damage,
      describe: (r, self) =>
        `Dash ${E.range} units, dealing ${Math.round(at(E.base, r) + E.ad * self.damage)} damage to enemies passed, and leave ` +
        `an echo behind. Recast within ${E.echo}s to snap back to the echo.`,
      cast: ({ world, self, at: aim, rank }) => {
        const zone = world.addZone('echo', self, self.pos, self.radius, E.echo);
        data(self).echo = { pos: { ...self.pos }, zone: zone.id };
        world.dash(self, toward(self.pos, aim, E.range), 26, (e) => {
          world.dealDamage(self, e, at(E.base, rank) + E.ad * self.damage, { slot: 2 });
          world.addFx({ kind: 'dashHit', pos: e.pos, team: self.team });
        });
      },
      recast: ({ world, self }) => {
        const echo = data(self).echo;
        if (!echo) return;
        data(self).echo = undefined;
        world.removeZone(echo.zone);
        world.blink(self, echo.pos, Infinity);
      },
    },
    {
      name: 'Rewind',
      icon: '↺',
      maxRank: 2,
      cost: (r) => at(R.cost, r),
      cooldown: (r) => at(R.cd, r),
      castTime: 0,
      recastWindow: R.window,
      aim: { shape: 'circle', range: 0, radius: 1.2 },
      describe: (r) =>
        `Plant an anchor. After ${R.window}s (or on recast), snap back to it, recover all health lost since, and every ` +
        `champion you damaged in that time takes ${at(R.echo, r) * 100}% of that damage again.`,
      cast: ({ world, self }) => {
        const zone = world.addZone('anchor', self, self.pos, 1.2, R.window);
        data(self).rewind = { anchor: { ...self.pos }, hp: self.hp, until: world.tick + ticks(R.window), zone: zone.id, dealt: {} };
      },
      recast: ({ world, self }) => rewind(world, self),
    },
  ],
  onAttackHit: (world, self, target) => {
    const d = data(self);
    d.hits = (d.hits ?? 0) + 1;
    if (d.hits % PASSIVE.every !== 0) return;
    world.after(PASSIVE.delay, () => {
      if (self.dead || target.dead || dist(self.pos, target.pos) > self.range + self.radius + target.radius + 2) return;
      world.dealDamage(self, target, PASSIVE.ratio * self.damage, { proc: true });
      world.addFx({ kind: 'echoHit', pos: target.pos, team: self.team });
    });
  },
  onDamageDealt: (_world, self, target, amount) => {
    const r = data(self).rewind;
    if (r && target.kind === 'champion') r.dealt[target.id] = (r.dealt[target.id] ?? 0) + amount;
  },
  onTick: (world, self) => {
    const r = data(self).rewind;
    if (r && world.tick >= r.until) rewind(world, self);
    stopwatchShield(world, self);
  },
  onDeath: (world, self) => {
    const d = data(self);
    if (d.rewind) world.removeZone(d.rewind.zone);
    if (d.echo) world.removeZone(d.echo.zone);
    self.champ!.data = {};
  },
};

/** Is `u` currently inside its own Rewind window? (bot + HUD) */
export const isRewinding = (u: Unit) => !!(u.champ?.data as TockData | undefined)?.rewind;
