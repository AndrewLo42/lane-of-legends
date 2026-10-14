import type { Unit, Vec2, Zone } from '../types';
import { DT, dirTo, dist, segmentDistance, ticks, toward } from '../util';
import { gap, type World } from '../world';
import { at } from './common';
import type { Kit } from './types';

/**
 * Sir Gerrit, the Grounded: an old knight of a fallen order who still carries its banner. He plants
 * standards and thrusts himself into them with his halberd, knocking up whoever is in the way, and
 * fights hardest on his own ground.
 */

/** Hold the Ground: near any of his standards. */
const HOLD = { radius: 4, guard: 0.25, attackSpeed: 0.2, regen: 0.02 };
/** Standards (E) and banners (R) fly for a moment before they count. */
const FLIGHT = 0.35;
const Q = { base: [80, 120, 160, 200, 240], ad: 1.0, cost: 40, cd: [7, 6.5, 6, 5.5, 5], length: 7, width: 0.9, windup: 0.25, slow: 0.25, slowFor: 1, pull: 24, knockup: 0.5, knockEvery: 2 };
const W = { base: [70, 100, 130, 160, 190], hp: 0.08, cost: 40, cd: [14, 13, 12, 11, 10], seconds: 3, slow: 0.25, slowFor: 1, slowEvery: 0.5, rootReach: 1, root: 0.75 };
const E = { base: [70, 100, 130, 160, 190], ad: 0.5, cost: 55, cd: [14, 13, 12, 11, 10], range: 7, radius: 1.3, slow: 0.3, slowFor: 1, lasts: 8 };
const R = { base: [175, 300], ad: 1.0, cost: 100, cd: [90, 70], range: 6, flight: 0.45, radius: 1.3, banners: 3, behind: 2.5, spread: 0.55, lasts: 4, near: 1.5, slow: 0.25 };

interface GerritData {
  /** The E standard (one at a time). */
  standardId?: number;
  /** When each enemy was last knocked up by his Q (tick), so each can only be once every few seconds. */
  knocked?: Record<number, number>;
  /** Last tick his Bulwark slowed someone. */
  slowedAt?: number;
  /** Mid-leap (R): where from and to, for the renderer's arc. */
  leap?: { from: Vec2; to: Vec2 };
}
const data = (u: Unit) => u.champ!.data as GerritData;

/** His standards that have landed: the E standard and any R banners. */
export function standardsOf(world: World, self: Unit): Zone[] {
  return world.zones.filter(
    (z) => z.ownerId === self.id && (z.kind === 'standard' || z.kind === 'banner') && world.tick >= z.start + ticks(FLIGHT) && world.tick < z.until,
  );
}
export const leapOf = (u: Unit) => data(u).leap;
export const nearStandard = (world: World, self: Unit) => standardsOf(world, self).some((z) => dist(z.pos, self.pos) <= HOLD.radius);

/** Enemies (champions, minions, pets) along a segment of `width`. */
function inLine(world: World, self: Unit, from: Vec2, to: Vec2, width: number) {
  return world.units.filter(
    (u) => world.canAttack(self, u) && (u.kind === 'champion' || u.kind === 'minion' || u.kind === 'pet') && segmentDistance(u.pos, from, to).d <= width / 2 + u.radius,
  );
}

/** The standard the thrust from `from` toward `aim` would reach (the nearest one along the line), if any. */
export function standardOnLine(world: World, self: Unit, from: Vec2, aim: Vec2): Zone | undefined {
  const end = toward(from, aim, Q.length);
  return standardsOf(world, self)
    .map((z) => ({ z, ...segmentDistance(z.pos, from, end) }))
    .filter((h) => h.d <= Q.width / 2 + z_radius(h.z))
    .sort((a, b) => a.t - b.t)[0]?.z;
}
const z_radius = (z: Zone) => z.radius;

function rTarget(world: World, self: Unit, aim: Vec2) {
  return world
    .champions()
    .filter((c) => world.canAttack(self, c) && gap(self, c) <= R.range)
    .sort((a, b) => dist(a.pos, aim) - dist(b.pos, aim))[0];
}

export const GERRIT: Kit = {
  id: 'gerrit',
  name: 'Sir Gerrit',
  title: 'the Grounded',
  blurb:
    'An old knight of a fallen order who still carries its banner. He plants standards and thrusts himself into them, ' +
    'knocking up whoever is in the way, and fights hardest on his own ground. Stay off the line to his standard.',
  color: '#c9a24a',
  experimental: true,
  stats: {
    hp: 800, hpPerLevel: 120, mana: 340, manaPerLevel: 45, manaRegen: 2.6, damage: 73, damagePerLevel: 4.5,
    attackInterval: 0.9, attackSpeedPerLevel: 0.022, windup: 0.25, range: 1.8, projectileSpeed: 0, speed: 6.4, radius: 0.7,
  },
  passive: {
    name: 'Hold the Ground',
    icon: '🚩',
    describe: () =>
      `Within ${HOLD.radius} units of any of his standards, Gerrit takes ${HOLD.guard * 100}% less damage, attacks ` +
      `${HOLD.attackSpeed * 100}% faster and restores ${HOLD.regen * 100}% of his max health per second.`,
  },
  levelOrder: [3, 0, 2, 1],
  abilities: [
    {
      name: 'Halberd Thrust',
      icon: '🔱',
      maxRank: 5,
      cost: () => Q.cost,
      cooldown: (r) => at(Q.cd, r),
      castTime: Q.windup,
      aim: { shape: 'line', length: Q.length, width: Q.width },
      damage: (r, self) => at(Q.base, r) + Q.ad * self.damage,
      describe: (r, self) =>
        `Thrust the halberd ${Q.length} units: enemies in the line take ${Math.round(GERRIT.abilities[0].damage!(r, self))} damage ` +
        `and are slowed ${Q.slow * 100}% for ${Q.slowFor}s. If the thrust reaches one of his standards, Gerrit is pulled to it, ` +
        `knocking up everyone he passes for ${Q.knockup}s (each enemy at most once every ${Q.knockEvery}s). The standard stays.`,
      onWindup: ({ world, self, at: aim }) => {
        const end = toward(self.pos, aim, Q.length);
        world.telegraph({ team: self.team, shape: 'line', pos: self.pos, dir: Math.atan2(end.y - self.pos.y, end.x - self.pos.x), length: Q.length, width: Q.width }, Q.windup);
      },
      cast: ({ world, self, at: aim, rank }) => {
        const from = { ...self.pos };
        const flag = world.isRooted(self) ? undefined : standardOnLine(world, self, from, aim);
        const end = flag ? { ...flag.pos } : toward(from, aim, Q.length);
        const dmg = GERRIT.abilities[0].damage!(rank, self);
        const d = data(self);
        d.knocked ??= {};
        world.addFx({ kind: 'thrust', pos: from, dir: Math.atan2(end.y - from.y, end.x - from.x), radius: Math.max(1, dist(from, end)), team: self.team });
        for (const e of inLine(world, self, from, end, Q.width)) {
          world.dealDamage(self, e, dmg, { slot: 0 });
          if (e.dead) continue;
          world.addStatus(e, { kind: 'slow', value: Q.slow, sourceId: self.id, seconds: Q.slowFor });
          if (flag && world.tick >= (d.knocked[e.id] ?? -1e9) + ticks(Q.knockEvery)) {
            d.knocked[e.id] = world.tick;
            world.addStatus(e, { kind: 'stun', value: 1, sourceId: self.id, seconds: Q.knockup });
          }
        }
        if (flag) world.dash(self, end, Q.pull, undefined, () => world.addFx({ kind: 'dashHit', pos: self.pos, team: self.team }));
      },
    },
    {
      name: 'Bulwark',
      icon: '🛡',
      maxRank: 5,
      cost: () => W.cost,
      cooldown: (r) => at(W.cd, r),
      castTime: 0,
      aim: { shape: 'circle', range: 0, radius: W.rootReach + 0.7 },
      recastWindow: W.seconds,
      describe: (r, self) =>
        `Brace behind his shield: a ${Math.round(at(W.base, r) + W.hp * self.maxHp)} shield for ${W.seconds}s. Champions who hit ` +
        `him while it holds are slowed ${W.slow * 100}% for ${W.slowFor}s. Recast while the shield holds to slam it down, ` +
        `giving up what's left of it, and root enemies within ${W.rootReach} unit of him for ${W.root}s.`,
      cast: ({ world, self, rank }) => {
        world.addStatus(self, { kind: 'shield', value: at(W.base, rank) + W.hp * self.maxHp, sourceId: self.id, seconds: W.seconds });
        world.addFx({ kind: 'barrier', pos: self.pos, team: self.team });
      },
      recast: ({ world, self }) => {
        self.statuses = self.statuses.filter((s) => !(s.kind === 'shield' && s.sourceId === self.id));
        world.addFx({ kind: 'slam', pos: self.pos, radius: W.rootReach + self.radius, team: self.team });
        for (const e of world.units) {
          if (!world.canAttack(self, e) || !(e.kind === 'champion' || e.kind === 'minion' || e.kind === 'pet')) continue;
          if (gap(self, e) <= W.rootReach) world.addStatus(e, { kind: 'root', value: 1, sourceId: self.id, seconds: W.root });
        }
      },
    },
    {
      name: 'Plant the Standard',
      icon: '🚩',
      maxRank: 5,
      cost: () => E.cost,
      cooldown: (r) => at(E.cd, r),
      castTime: 0.1,
      aim: { shape: 'circle', range: E.range, radius: E.radius },
      damage: (r, self) => at(E.base, r) + E.ad * self.damage,
      describe: (r, self) =>
        `Hurl his standard up to ${E.range} units. Where it lands, enemies take ${Math.round(GERRIT.abilities[2].damage!(r, self))} damage ` +
        `and are slowed ${E.slow * 100}% for ${E.slowFor}s. It stays planted for ${E.lasts}s (one at a time) and can't be attacked.`,
      onWindup: ({ world, self, at: aim }) => {
        const to = dist(self.pos, aim) <= E.range ? aim : toward(self.pos, aim, E.range);
        world.telegraph({ team: self.team, shape: 'circle', pos: to, dir: 0, length: E.radius, width: 0 }, 0.1 + FLIGHT);
      },
      cast: ({ world, self, at: aim, rank }) => {
        const to = dist(self.pos, aim) <= E.range ? { ...aim } : toward(self.pos, aim, E.range);
        const d = data(self);
        if (d.standardId != null) world.removeZone(d.standardId);
        d.standardId = world.addZone('standard', self, to, 0.6, FLIGHT + E.lasts).id;
        const dmg = GERRIT.abilities[2].damage!(rank, self);
        world.after(FLIGHT, () => {
          world.addFx({ kind: 'slam', pos: to, radius: E.radius, team: self.team });
          for (const e of world.enemiesInCircle(self.team, to, E.radius)) {
            world.dealDamage(self, e, dmg, { slot: 2 });
            if (!e.dead) world.addStatus(e, { kind: 'slow', value: E.slow, sourceId: self.id, seconds: E.slowFor });
          }
        });
      },
    },
    {
      name: 'Fallen Standards',
      icon: '⚔',
      maxRank: 2,
      cost: () => R.cost,
      cooldown: (r) => at(R.cd, r),
      castTime: 0.1,
      aim: { shape: 'target', range: R.range },
      target: (world, self, aim) => rTarget(world, self, aim),
      available: (world, self) => !world.isRooted(self),
      damage: (r, self) => at(R.base, r) + R.ad * self.damage,
      describe: (r, self) =>
        `Leap onto an enemy champion within ${R.range} units, dealing ${Math.round(GERRIT.abilities[3].damage!(r, self))} damage ` +
        `where he lands. ${R.banners} old banners fly out and plant themselves behind the target for ${R.lasts}s: they count as his ` +
        `standards, and enemies passing close to one are slowed ${R.slow * 100}%. Halberd Thrust comes off cooldown.`,
      cast: ({ world, self, at: aim, rank }) => {
        const t = rTarget(world, self, aim);
        if (!t) return;
        const from = { ...self.pos };
        const dir = dirTo(from, t.pos);
        const to = { x: t.pos.x - dir.x * (t.radius + self.radius * 0.6), y: t.pos.y - dir.y * (t.radius + self.radius * 0.6) };
        data(self).leap = { from, to };
        world.dash(self, to, Math.max(10, dist(from, to) / R.flight), undefined, () => {
          data(self).leap = undefined;
          world.addFx({ kind: 'slam', pos: self.pos, radius: R.radius, team: self.team });
          const dmg = GERRIT.abilities[3].damage!(rank, self);
          for (const e of world.enemiesInCircle(self.team, self.pos, R.radius)) world.dealDamage(self, e, dmg, { slot: 3 });
          // Banners fly out behind the target (on the far side from where he leapt), cutting off the retreat.
          const centre = t.dead ? to : t.pos;
          const away = Math.atan2(centre.y - from.y, centre.x - from.x);
          for (let i = 0; i < R.banners; i++) {
            const a = away + (i - (R.banners - 1) / 2) * R.spread;
            world.addZone('banner', self, { x: centre.x + Math.cos(a) * R.behind, y: centre.y + Math.sin(a) * R.behind }, 0.5, FLIGHT + R.lasts);
          }
          self.champ!.abilities[0].readyAt = world.tick;
        });
      },
    },
  ],
  onHurt: (world, self, src, _amount, from) => {
    // Bulwark: champions who hit him while his shield holds are slowed.
    if (!src?.champ || from.proc || src.dead) return;
    if (!self.statuses.some((s) => s.kind === 'shield' && s.sourceId === self.id)) return;
    const d = data(self);
    if (world.tick < (d.slowedAt ?? -1e9) + ticks(W.slowEvery)) return;
    d.slowedAt = world.tick;
    world.addStatus(src, { kind: 'slow', value: W.slow, sourceId: self.id, seconds: W.slowFor });
  },
  onTick: (world, self) => {
    // Hold the Ground.
    if (nearStandard(world, self)) {
      world.addStatus(self, { kind: 'guard', value: HOLD.guard, sourceId: self.id, seconds: 0.25 });
      world.addStatus(self, { kind: 'frenzy', value: HOLD.attackSpeed, sourceId: self.id, seconds: 0.25 });
      world.heal(self, self.maxHp * HOLD.regen * DT);
    }
    // Bulwark's recast only lasts while the shield does.
    const w = self.champ!.abilities[1];
    if (w.recastUntil > world.tick && !self.statuses.some((s) => s.kind === 'shield' && s.sourceId === self.id)) w.recastUntil = world.tick;
    // Fallen Standards: walking past a banner is slow going.
    const banners = standardsOf(world, self).filter((z) => z.kind === 'banner');
    if (banners.length) {
      for (const e of world.units) {
        if (!world.canAttack(self, e) || e.speed <= 0) continue;
        if (banners.some((z) => dist(z.pos, e.pos) <= R.near + e.radius)) world.addStatus(e, { kind: 'slow', value: R.slow, sourceId: self.id, seconds: 0.3 });
      }
    }
  },
  onDeath: (_world, self) => {
    data(self).leap = undefined;
  },
};

export const GERRIT_TUNING = { HOLD, FLIGHT, Q, W, E, R };
