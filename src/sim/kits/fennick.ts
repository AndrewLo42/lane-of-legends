import type { MissileStyle, Unit, Vec2 } from '../types';
import { dirTo, dist, ticks } from '../util';
import type { World } from '../world';
import { at, champsAndMinions } from './common';
import type { Kit } from './types';

/**
 * Fennick, the Tinker-Archer: a ranged auto-attack carry with no dash. His quiver turns through frost,
 * fire and spark arrows; he pokes with a bow drawn as long as he dares, nets whoever dives him, and
 * wins long fights by attacking.
 */

export type Arrow = 'frost' | 'fire' | 'spark';
export const ARROWS: readonly Arrow[] = ['frost', 'fire', 'spark'];
export const ARROW_LOOK: Record<Arrow, { icon: string; name: string; color: string; style: MissileStyle }> = {
  frost: { icon: '❄', name: 'Frost', color: '#8fd8ff', style: 'frostArrow' },
  fire: { icon: '🔥', name: 'Fire', color: '#ff8a3d', style: 'fireArrow' },
  spark: { icon: '⚡', name: 'Spark', color: '#ffe14a', style: 'sparkArrow' },
};

/** Quiver: what each arrow does on top of the attack. Burn and spark damage scale with attack damage. */
const QUIVER = { slow: 0.25, slowFor: 1.2, burn: 14, burnAd: 0.3, burnFor: 2, spark: 16, sparkAd: 0.45, sparkRange: 3.5 };
/** Longshot: the draw reaches from `minRange` to `maxRange` over `full` seconds, and looses itself after `timeout`. */
const Q = {
  base: [60, 95, 130, 165, 200], ad: 0.9, cost: 55, cd: [9, 8.5, 8, 7.5, 7], minRange: 6, maxRange: 12, full: 1.25, timeout: 3,
  minMult: 0.6, fullMult: 1.3, drawSlow: 0.25, width: 0.7, speed: 30,
};
/** Volley: the next attack within `window` seconds looses all three arrows, `gap` seconds apart, each at `mult` damage. */
const W = { cost: 40, cd: [11, 10, 9, 8, 7], window: 4, mult: 0.6, gap: 0.1 };
/** Snare Shot: a net that slows inside its circle, then roots whoever is still in it after `delay`. */
const E = { cost: 60, cd: [16, 15, 14, 13, 12], range: 7, width: 0.9, speed: 18, damage: [40, 60, 80, 100, 120], ad: 0.3, radius: 1.6, delay: 0.75, slow: 0.5, root: [1, 1.1, 1.2, 1.3, 1.4] };
/** Overcharge: every attack carries all three arrows, and a burst of move speed that fades. */
const R = { cd: [70, 55], seconds: 5, haste: [0.25, 0.35] };

interface FennickData {
  /** Index into ARROWS of the next arrow. */
  next?: number;
  /** Drawing Longshot since this tick, aimed here when the draw began. */
  drawStart?: number;
  drawAim?: Vec2;
  /** How far the bow is drawn, 0..1, as of the last tick (for the HUD, which has no world). */
  charge?: number;
  /** Volley's next attack is primed until this tick. */
  volleyUntil?: number;
  /** Overcharge runs from overStart until overUntil. */
  overStart?: number;
  overUntil?: number;
}
const data = (u: Unit) => u.champ!.data as FennickData;

export const nextArrow = (u: Unit): Arrow => ARROWS[data(u).next ?? 0];
export const drawing = (u: Unit) => data(u).drawStart != null;
/** How far the bow is drawn, 0..1 (0 when not drawing). */
export const drawn = (world: World, u: Unit) => {
  const start = data(u).drawStart;
  return start == null ? 0 : Math.min(1, (world.tick - start) / ticks(Q.full));
};
/** `drawn` as of the last tick, from the unit alone (the HUD and the aim indicator have no world). */
export const drawFraction = (u: Unit) => (drawing(u) ? data(u).charge ?? 0 : 0);
export const longshotRange = (charge: number) => Q.minRange + (Q.maxRange - Q.minRange) * charge;
export const volleyReady = (world: World, u: Unit) => (data(u).volleyUntil ?? 0) > world.tick;
export const overcharged = (world: World, u: Unit) => (data(u).overUntil ?? 0) > world.tick;

function advance(u: Unit, by = 1) {
  const d = data(u);
  d.next = ((d.next ?? 0) + by) % ARROWS.length;
}

/** One arrow's effect landing on `t` (after its damage). */
export function applyArrow(world: World, self: Unit, t: Unit, arrow: Arrow) {
  if (arrow === 'frost') {
    if (!t.dead) world.addStatus(t, { kind: 'slow', value: QUIVER.slow, sourceId: self.id, seconds: QUIVER.slowFor });
  } else if (arrow === 'fire') {
    if (!t.dead) world.addStatus(t, { kind: 'burn', value: (QUIVER.burn + QUIVER.burnAd * self.damage) / QUIVER.burnFor, sourceId: self.id, seconds: QUIVER.burnFor });
  } else {
    // Spark jumps to the nearest other enemy: a minion, or the champion behind the wave.
    const next = world
      .enemiesInCircle(self.team, t.pos, QUIVER.sparkRange)
      .filter((u) => u !== t && !u.dead)
      .sort((a, b) => dist(a.pos, t.pos) - dist(b.pos, t.pos))[0];
    if (!next) return;
    world.dealDamage(self, next, QUIVER.spark + QUIVER.sparkAd * self.damage, { proc: true });
    world.addFx({ kind: 'zap', pos: t.pos, dir: Math.atan2(next.pos.y - t.pos.y, next.pos.x - t.pos.x), radius: dist(t.pos, next.pos), team: self.team });
  }
}

function stopDrawing(u: Unit) {
  const d = data(u);
  d.drawStart = undefined;
  d.drawAim = undefined;
  d.charge = 0;
}

/** Loose Longshot toward `aim`, as far and as hard as the bow is drawn. */
function loose(world: World, self: Unit, aim: Vec2, rank: number) {
  const charge = drawn(world, self);
  stopDrawing(self);
  const full = charge >= 1;
  const mult = full ? Q.fullMult : Q.minMult + (1 - Q.minMult) * charge;
  // A full draw carries the next arrow (and uses it up) and goes through everything in its path.
  const arrow = full ? nextArrow(self) : null;
  if (arrow) advance(self);
  const dir = dist(self.pos, aim) > 0.01 ? dirTo(self.pos, aim) : { x: Math.cos(self.facing), y: Math.sin(self.facing) };
  self.facing = Math.atan2(dir.y, dir.x);
  self.champ!.abilities[0].readyAt = world.tick + world.cooldownTicks(self, 0); // the cooldown runs from the release
  self.champ!.lastCast = { slot: 0, tick: world.tick, time: 0.15 };
  world.fireLine(self, {
    style: 'longshot', dir, speed: Q.speed, range: longshotRange(charge), width: Q.width, pierce: full, canHit: champsAndMinions,
    onHit: (t) => {
      world.dealDamage(self, t, FENNICK.abilities[0].damage!(rank, self) * mult, { slot: 0, poke: true });
      if (arrow) applyArrow(world, self, t, arrow);
    },
  });
}

export const FENNICK: Kit = {
  id: 'fennick',
  name: 'Fennick',
  title: 'the Tinker-Archer',
  blurb:
    'A gadgeteer archer whose quiver turns through frost, fire and spark arrows. No dash: he wins on spacing, a bow drawn ' +
    'as far as he dares, and a net for anyone who dives him. Weak early, deadly in a long fight. Catch him out of position.',
  color: '#6fc3a0',
  experimental: true,
  stats: {
    hp: 570, hpPerLevel: 88, mana: 340, manaPerLevel: 45, manaRegen: 2.4, damage: 54, damagePerLevel: 3.8,
    attackInterval: 0.75, attackSpeedPerLevel: 0.032, windup: 0.17, range: 5.5, projectileSpeed: 28, speed: 6.4, radius: 0.5,
  },
  passive: {
    name: 'Quiver',
    icon: '🏹',
    describe: (self) =>
      `His attacks turn through three arrows (next: ${ARROW_LOOK[nextArrow(self)].icon} ${ARROW_LOOK[nextArrow(self)].name}). ` +
      `Frost slows ${QUIVER.slow * 100}% for ${QUIVER.slowFor}s. Fire burns for ${Math.round(QUIVER.burn + QUIVER.burnAd * self.damage)} ` +
      `over ${QUIVER.burnFor}s. Spark jumps to the nearest other enemy for ${Math.round(QUIVER.spark + QUIVER.sparkAd * self.damage)}.`,
  },
  meter: {
    label: 'Quiver',
    max: 1,
    value: (self) => (drawing(self) ? drawFraction(self) : 1),
    text: (self) => (drawing(self) ? (drawFraction(self) >= 1 ? 'Full draw!' : 'Drawing…') : `Next: ${ARROW_LOOK[nextArrow(self)].icon} ${ARROW_LOOK[nextArrow(self)].name}`),
    color: (self) => (drawing(self) ? '' : ARROW_LOOK[nextArrow(self)].color),
    glow: (self) => drawing(self) && drawFraction(self) >= 1,
  },
  levelOrder: [3, 0, 1, 2],
  abilities: [
    {
      name: 'Longshot',
      icon: '🎯',
      maxRank: 5,
      cost: () => Q.cost,
      cooldown: (r) => at(Q.cd, r),
      castTime: 0,
      aim: { shape: 'line', length: Q.minRange, width: Q.width },
      damage: (r, self) => at(Q.base, r) + Q.ad * self.damage,
      describe: (r, self) => {
        const dmg = FENNICK.abilities[0].damage!(r, self);
        return (
          `Hold to draw: he slows ${Q.drawSlow * 100}% and can't attack, and the shot reaches from ${Q.minRange} to ${Q.maxRange} units ` +
          `over ${Q.full}s. Let go to loose it at the first enemy hit for ${Math.round(dmg * Q.minMult)}–${Math.round(dmg)} damage. ` +
          `A full draw hits for ${Math.round(dmg * Q.fullMult)}, goes through everything, and carries his next arrow. ` +
          `Looses itself after ${Q.timeout}s.`
        );
      },
      cast: ({ world, self, at: aim }) => {
        if (drawing(self)) return;
        const d = data(self);
        d.drawStart = world.tick;
        d.drawAim = { ...aim };
        self.attackTarget = null;
        self.windup = 0;
      },
      release: ({ world, self, at: aim, rank }) => {
        if (drawing(self) && !self.dead) loose(world, self, aim, rank);
      },
      holdAim: (self) => ({ shape: 'line', length: longshotRange(drawFraction(self)), width: Q.width }),
    },
    {
      name: 'Volley',
      icon: '🎆',
      maxRank: 5,
      cost: () => W.cost,
      cooldown: (r) => at(W.cd, r),
      castTime: 0,
      aim: { shape: 'circle', range: 0, radius: 1 },
      describe: () =>
        `His next attack within ${W.window}s looses all three arrows in quick succession, each for ${W.mult * 100}% damage with its ` +
        `effect, and his quiver skips ahead one arrow. Resets his attack timer.`,
      cast: ({ world, self }) => {
        data(self).volleyUntil = world.tick + ticks(W.window);
        self.attackCd = 0;
        world.addFx({ kind: 'volley', pos: self.pos, team: self.team });
      },
    },
    {
      name: 'Snare Shot',
      icon: '🕸',
      maxRank: 5,
      cost: () => E.cost,
      cooldown: (r) => at(E.cd, r),
      castTime: 0.15,
      aim: { shape: 'line', length: E.range, width: E.width },
      damage: (r, self) => at(E.damage, r) + E.ad * self.damage,
      describe: (r, self) =>
        `Shoots a weighted net at the first enemy hit for ${Math.round(FENNICK.abilities[2].damage!(r, self))} damage. It spreads ` +
        `${E.radius} units around them: enemies inside are slowed ${E.slow * 100}%, and anyone still inside after ${E.delay}s is ` +
        `rooted for ${at(E.root, r)}s.`,
      cast: ({ world, self, at: aim, rank }) => {
        world.fireLine(self, {
          style: 'net', dir: dirTo(self.pos, aim), speed: E.speed, range: E.range, width: E.width, canHit: champsAndMinions,
          onHit: (t) => {
            world.dealDamage(self, t, FENNICK.abilities[2].damage!(rank, self), { slot: 2 });
            const net = world.addZone('net', self, t.pos, E.radius, E.delay + 0.3);
            world.after(E.delay, () => {
              for (const e of world.enemiesInCircle(self.team, net.pos, E.radius)) {
                world.addStatus(e, { kind: 'root', value: 0, sourceId: self.id, seconds: at(E.root, rank) });
                world.addFx({ kind: 'bind', pos: e.pos, team: self.team });
              }
            });
          },
        });
      },
    },
    {
      name: 'Overcharge',
      icon: '🌈',
      maxRank: 2,
      cost: () => 0,
      cooldown: (r) => at(R.cd, r),
      castTime: 0,
      aim: { shape: 'circle', range: 0, radius: 1 },
      describe: (r) =>
        `For ${R.seconds}s every attack carries all three arrows (slow, burn and spark), and he gains ${at(R.haste, r) * 100}% move ` +
        `speed that fades over the duration.`,
      cast: ({ world, self }) => {
        const d = data(self);
        d.overStart = world.tick;
        d.overUntil = world.tick + ticks(R.seconds);
        world.addFx({ kind: 'bloom', pos: self.pos, radius: 2, team: self.team });
      },
    },
  ],
  onAttackFire: (world, self, target) => {
    if (overcharged(world, self)) {
      return { style: 'prismArrow', onHit: (t) => ARROWS.forEach((a) => applyArrow(world, self, t, a)) };
    }
    const d = data(self);
    const first = nextArrow(self);
    if (volleyReady(world, self)) {
      d.volleyUntil = 0;
      // The other two arrows follow the first, then the quiver skips ahead one.
      const rest = [1, 2].map((i) => ARROWS[((d.next ?? 0) + i) % ARROWS.length]);
      advance(self, 1);
      rest.forEach((arrow, i) =>
        world.after(W.gap * (i + 1), () => {
          if (self.dead || target.dead) return;
          world.fireHoming(self, target, ARROW_LOOK[arrow].style, self.projectileSpeed, (t) => {
            world.dealDamage(self, t, self.damage * W.mult, { slot: 1 });
            applyArrow(world, self, t, arrow);
          });
        }),
      );
      return { style: ARROW_LOOK[first].style, damageMult: W.mult, onHit: (t) => applyArrow(world, self, t, first) };
    }
    advance(self);
    return { style: ARROW_LOOK[first].style, onHit: (t) => applyArrow(world, self, t, first) };
  },
  onTick: (world, self) => {
    const d = data(self);
    if (drawing(self)) {
      if (world.isStunned(self) || self.forced) {
        stopDrawing(self); // knocked out of the draw: the arrow is lost
      } else {
        d.charge = drawn(world, self);
        world.addStatus(self, { kind: 'slow', value: Q.drawSlow, sourceId: self.id, seconds: 0.1 });
        self.attackCd = Math.max(self.attackCd, 2);
        self.windup = 0;
        if (world.tick - d.drawStart! >= ticks(Q.timeout)) loose(world, self, d.drawAim ?? self.pos, Math.max(1, self.champ!.abilities[0].rank));
      }
    }
    if (overcharged(world, self)) {
      const r = Math.max(1, self.champ!.abilities[3].rank);
      const left = (d.overUntil! - world.tick) / Math.max(1, d.overUntil! - d.overStart!);
      world.addStatus(self, { kind: 'haste', value: at(R.haste, r) * left, sourceId: self.id, seconds: 0.1 });
    }
    // Nets slow whoever is inside.
    for (const z of world.zones) {
      if (z.ownerId !== self.id || z.kind !== 'net' || world.tick >= z.until) continue;
      for (const e of world.enemiesInCircle(self.team, z.pos, z.radius)) {
        world.addStatus(e, { kind: 'slow', value: E.slow, sourceId: self.id, seconds: 0.1 });
      }
    }
  },
  onDeath: (_world, self) => {
    const d = data(self);
    stopDrawing(self);
    d.volleyUntil = 0;
    d.overUntil = 0;
  },
};

export const FENNICK_TUNING = { QUIVER, Q, W, E, R };
