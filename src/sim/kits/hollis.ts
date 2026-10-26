import { clampToLane, sideX, spawnPoint } from '../lane';
import type { Status, Unit, Vec2 } from '../types';
import { DT, dirTo, dist, segmentDistance, ticks, toward } from '../util';
import { RALLY_DAMAGE } from '../stats';
import { gap, type World } from '../world';
import { at } from './common';
import type { Kit } from './types';

/**
 * Hollis, the Shepherd: a gentle old shepherd with a crook and a sheepdog, Bramble. He fights through
 * the minion wave rather than beside it: he whistles his minions onto a target, crooks enemy minions
 * onto his side (they count as his last hits), sends Bramble to herd a wave back, and stampedes a
 * spectral flock down the lane to crash his wave into a tower.
 */

/** The Flock: allied minions near Hollis. */
const FLOCK = { radius: 6, haste: 0.15, guard: 0.15, selfGuard: 0.15, selfMinions: 2 };
/** Bramble bites what Hollis attacks. */
const BITE = { base: 20, ad: 0.3, every: 1.0 };
const DOG = { speed: 9, radius: 0.4, follow: 1.2, run: 18, trot: 12 };
const Q = { cost: 30, cd: [7, 6.5, 6, 5.5, 5], range: 9, pick: 3, radius: 7, seconds: 3, attackSpeed: 0.3, damage: RALLY_DAMAGE };
const W = { base: [70, 105, 140, 175, 210], ad: 0.6, cost: 55, cd: [13, 12, 11, 10, 9], windup: 0.2, length: 8, width: 0.8, speed: 22, herd: 5, pull: 2.5, slow: 0.3, slowFor: 1 };
const E = { base: [60, 95, 130, 165, 200], ad: 0.5, cost: 40, cd: [14, 13, 12, 11, 10], range: 7, radius: 2.5, push: 3, slow: 0.25, slowFor: 1.5 };
const R = { base: [175, 300], ad: 0.6, cost: 100, cd: [90, 70], windup: 0.4, length: 20, width: 6, speed: 12, shove: 2.5, slow: 0.4, slowFor: 1.5, haste: 0.4, guard: 0.3, charge: 6 };

interface HollisData {
  brambleId?: number;
  /** Bramble's next bite (tick). */
  biteAt?: number;
  /** Bramble lunging at what Hollis just hit, until this tick (for where he stands). */
  lunge?: { targetId: number; until: number };
  /** Bramble's E run: out to `to`, then back to Hollis. */
  run?: { to: Vec2; back: boolean; rank: number };
  /** The stampede running down the lane, for boosting the allied minions it passes. */
  stampede?: { from: Vec2; dir: Vec2; start: number; boosted: number[] };
}
const data = (u: Unit) => u.champ!.data as HollisData;

export const brambleOf = (world: World, self: Unit) => world.get(data(self).brambleId);
export const brambleRunning = (self: Unit) => !!data(self).run;

/** Allied minions Whistle would call (within its radius of Hollis). */
export const flockNear = (world: World, self: Unit, radius = Q.radius) =>
  world.units.filter((u) => !u.dead && u.kind === 'minion' && u.team === self.team && dist(u.pos, self.pos) <= radius);

/** What a Whistle aimed at `aim` would set the flock on: the enemy nearest the cursor, in range. */
function whistleTarget(world: World, self: Unit, aim: Vec2) {
  return world.units
    .filter((u) => world.canAttack(self, u) && (u.kind === 'champion' || u.kind === 'minion' || u.kind === 'pet') && gap(self, u) <= Q.range && dist(u.pos, aim) <= Q.pick + u.radius)
    .sort((a, b) => dist(a.pos, aim) - dist(b.pos, aim))[0];
}

/** Keep a short status topped up without adding a new one every tick (which would also churn the online snapshot). */
function keep(world: World, u: Unit, kind: Status['kind'], value: number, sourceId: number) {
  const cur = u.statuses.find((s) => s.kind === kind && s.sourceId === sourceId);
  if (cur && cur.until - world.tick > ticks(0.15)) return;
  if (cur) {
    cur.until = world.tick + ticks(0.5);
    cur.value = value;
  } else {
    world.addStatus(u, { kind, value, sourceId, seconds: 0.5 });
  }
}

/** Bramble reaches his E spot: enemy minions there are herded back toward their tower, a champion is nipped. */
function brambleLands(world: World, self: Unit, pos: Vec2, rank: number) {
  world.addFx({ kind: 'herd', pos, radius: E.radius, team: self.team });
  const dog = brambleOf(world, self) ?? self;
  for (const e of world.enemiesInCircle(self.team, pos, E.radius)) {
    if (e.kind === 'minion') {
      const home = Math.sign(sideX(e.team, 1));
      world.pull(e, { x: e.pos.x + home * E.push, y: e.pos.y }, 14);
    } else {
      world.dealDamage(dog, e, HOLLIS.abilities[2].damage!(rank, self), { slot: 2 });
      if (!e.dead) world.addStatus(e, { kind: 'slow', value: E.slow, sourceId: self.id, seconds: E.slowFor });
    }
  }
}

/** Walk Bramble one tick: his E run, a lunge at what Hollis hit, or at heel. */
function moveBramble(world: World, self: Unit, dog: Unit) {
  const d = data(self);
  const step = (to: Vec2, speed: number) => {
    const next = clampToLane(toward(dog.pos, to, speed * DT), dog.radius);
    if (dist(next, dog.pos) > 1e-4) dog.facing = Math.atan2(next.y - dog.pos.y, next.x - dog.pos.x);
    dog.pos = next;
  };
  if (d.run && !d.run.back) {
    step(d.run.to, DOG.run);
    if (dist(dog.pos, d.run.to) < 0.1) {
      brambleLands(world, self, d.run.to, d.run.rank);
      d.run.back = true;
    }
    return;
  }
  if (d.run?.back) {
    step(self.pos, DOG.trot);
    if (dist(dog.pos, self.pos) <= DOG.follow + self.radius) d.run = undefined;
    return;
  }
  const lunge = d.lunge && world.tick < d.lunge.until ? world.get(d.lunge.targetId) : undefined;
  if (lunge && !lunge.dead) {
    step(toward(lunge.pos, self.pos, lunge.radius + DOG.radius), DOG.run);
    return;
  }
  // At heel: a little behind and to the side, trotting to catch up when Hollis moves off.
  const a = self.facing + Math.PI * 0.75;
  const heel = { x: self.pos.x + Math.cos(a) * DOG.follow, y: self.pos.y + Math.sin(a) * DOG.follow };
  const far = dist(dog.pos, heel);
  if (far > 12) dog.pos = clampToLane(heel, dog.radius);
  else if (far > 0.15) step(heel, Math.max(DOG.speed, world.effectiveSpeed(self) * 1.2));
}

export const HOLLIS: Kit = {
  id: 'hollis',
  name: 'Hollis',
  title: 'the Shepherd',
  blurb:
    'A gentle old shepherd with a crook and a sheepdog called Bramble. He fights through his minions: whistling them onto ' +
    'a target, crooking yours onto his side and stampeding his wave into your tower. Clear his wave and he is just an old man.',
  color: '#9bb877',
  experimental: true,
  stats: {
    hp: 760, hpPerLevel: 110, mana: 300, manaPerLevel: 40, manaRegen: 2.4, damage: 68, damagePerLevel: 4.5,
    attackInterval: 0.85, attackSpeedPerLevel: 0.02, windup: 0.25, range: 2.4, projectileSpeed: 0, speed: 6.3, radius: 0.65,
  },
  passive: {
    name: 'The Flock',
    icon: '🐑',
    describe: (self) =>
      `Allied minions within ${FLOCK.radius} units of Hollis move ${FLOCK.haste * 100}% faster and take ${FLOCK.guard * 100}% less damage, ` +
      `and while ${FLOCK.selfMinions} or more are with him, so does he (${FLOCK.selfGuard * 100}% less). ` +
      `Bramble, his sheepdog, follows him and bites whatever Hollis attacks for ${Math.round(BITE.base + BITE.ad * self.damage)} damage ` +
      `(at most once every ${BITE.every}s). Bramble can't be targeted.`,
  },
  levelOrder: [3, 1, 0, 2],
  abilities: [
    {
      name: 'Whistle',
      icon: '🎶',
      maxRank: 5,
      cost: () => Q.cost,
      cooldown: (r) => at(Q.cd, r),
      castTime: 0,
      aim: { shape: 'target', range: Q.range },
      target: (world, self, aim) => whistleTarget(world, self, aim),
      available: (world, self) => flockNear(world, self).length > 0,
      describe: () =>
        `Whistle up the flock: every allied minion within ${Q.radius} units of Hollis goes for the enemy nearest the cursor ` +
        `(within ${Q.range} units; champion or minion), attacking ${Q.attackSpeed * 100}% faster and dealing ${Q.damage * 100}% more ` +
        `damage to it for ${Q.seconds}s. ` +
        `Their eyes glow while they're set on it.`,
      cast: ({ world, self, at: aim }) => {
        const t = whistleTarget(world, self, aim);
        if (!t) return;
        world.addFx({ kind: 'whistle', pos: self.pos, radius: Q.radius, team: self.team });
        for (const m of flockNear(world, self)) {
          m.statuses = m.statuses.filter((s) => s.kind !== 'rally');
          world.addStatus(m, { kind: 'rally', value: t.id, sourceId: self.id, seconds: Q.seconds });
          world.addStatus(m, { kind: 'frenzy', value: Q.attackSpeed, sourceId: self.id, seconds: Q.seconds });
        }
      },
    },
    {
      name: 'Crook',
      icon: '🪝',
      maxRank: 5,
      cost: () => W.cost,
      cooldown: (r) => at(W.cd, r),
      castTime: W.windup,
      aim: { shape: 'line', length: W.length, width: W.width },
      damage: (r, self) => at(W.base, r) + W.ad * self.damage,
      describe: (r, self) =>
        `Reach out with the crook (${W.length} units): it catches the first enemy it touches. A minion is pulled over to Hollis and ` +
        `herded: it fights for him for ${W.herd}s with at most half its health, then wanders off; however it dies, it's Hollis's ` +
        `last hit. A champion takes ${Math.round(HOLLIS.abilities[1].damage!(r, self))} damage, is pulled ${W.pull} units toward him and ` +
        `slowed ${W.slow * 100}% for ${W.slowFor}s.`,
      cast: ({ world, self, at: aim, rank }) => {
        const dir = dirTo(self.pos, aim);
        world.fireLine(self, {
          style: 'crook', dir, speed: W.speed, range: W.length, width: W.width,
          onHit: (t) => {
            if (t.kind === 'minion') {
              world.herdMinion(t, self, W.herd);
              t.hp = Math.min(t.hp, t.maxHp * 0.5);
              world.pull(t, toward(self.pos, t.pos, self.radius + t.radius + 0.6), 20);
              world.addFx({ kind: 'herd', pos: t.pos, radius: 1, team: self.team });
              return;
            }
            world.dealDamage(self, t, HOLLIS.abilities[1].damage!(rank, self), { slot: 1 });
            if (t.dead || t.kind !== 'champion') return;
            world.addStatus(t, { kind: 'slow', value: W.slow, sourceId: self.id, seconds: W.slowFor });
            const room = dist(t.pos, self.pos) - (t.radius + self.radius + 0.3);
            if (room > 0) world.pull(t, toward(t.pos, self.pos, Math.min(W.pull, room)), 18);
          },
        });
      },
    },
    {
      name: 'Bramble',
      icon: '🐕',
      maxRank: 5,
      cost: () => E.cost,
      cooldown: (r) => at(E.cd, r),
      castTime: 0,
      aim: { shape: 'circle', range: E.range, radius: E.radius },
      available: (world, self) => !!brambleOf(world, self),
      damage: (r, self) => at(E.base, r) + E.ad * self.damage,
      describe: (r, self) =>
        `Send Bramble bounding to a spot up to ${E.range} units away. Enemy minions there are herded ${E.push} units back toward ` +
        `their own tower; an enemy champion there is nipped for ${Math.round(HOLLIS.abilities[2].damage!(r, self))} damage and ` +
        `slowed ${E.slow * 100}% for ${E.slowFor}s. Then he trots back.`,
      cast: ({ world, self, at: aim, rank }) => {
        const dog = brambleOf(world, self);
        if (!dog) return;
        const to = clampToLane(dist(self.pos, aim) <= E.range ? { ...aim } : toward(self.pos, aim, E.range), 0.5);
        data(self).run = { to, back: false, rank };
        data(self).lunge = undefined;
        world.telegraph({ team: self.team, shape: 'circle', pos: to, dir: 0, length: E.radius, width: 0 }, dist(dog.pos, to) / DOG.run + 0.1);
      },
    },
    {
      name: 'Stampede',
      icon: '🐏',
      maxRank: 2,
      cost: () => R.cost,
      cooldown: (r) => at(R.cd, r),
      castTime: R.windup,
      aim: { shape: 'line', length: R.length, width: R.width },
      damage: (r, self) => at(R.base, r) + R.ad * self.damage,
      describe: (r, self) =>
        `A herd of spectral sheep thunders from Hollis ${R.length} units down the lane in a band ${R.width} wide. Enemies it runs ` +
        `over take ${Math.round(HOLLIS.abilities[3].damage!(r, self))} damage, are shoved aside and slowed ${R.slow * 100}% for ` +
        `${R.slowFor}s. Allied minions it passes charge with it: ${R.haste * 100}% faster and taking ${R.guard * 100}% less damage ` +
        `for ${R.charge}s.`,
      onWindup: ({ world, self, at: aim }) => {
        const dir = dirTo(self.pos, aim);
        world.telegraph({ team: self.team, shape: 'line', pos: self.pos, dir: Math.atan2(dir.y, dir.x), length: R.length, width: R.width }, R.windup);
      },
      cast: ({ world, self, at: aim, rank }) => {
        const dir = dirTo(self.pos, aim);
        const from = { ...self.pos };
        data(self).stampede = { from, dir, start: world.tick, boosted: [] };
        const dmg = HOLLIS.abilities[3].damage!(rank, self);
        world.fireLine(self, {
          style: 'stampede', dir, speed: R.speed, range: R.length, width: R.width, pierce: true,
          onHit: (t) => {
            world.dealDamage(self, t, dmg, { slot: 3 });
            if (t.dead) return;
            world.addStatus(t, { kind: 'slow', value: R.slow, sourceId: self.id, seconds: R.slowFor });
            // Shoved out of the herd's path, toward whichever side of it they're on.
            const side = (t.pos.x - from.x) * -dir.y + (t.pos.y - from.y) * dir.x >= 0 ? 1 : -1;
            world.pull(t, { x: t.pos.x - dir.y * side * R.shove, y: t.pos.y + dir.x * side * R.shove }, 16);
          },
        });
      },
    },
  ],
  onAttackHit: (world, self, target) => {
    const d = data(self);
    const dog = brambleOf(world, self);
    if (!dog || d.run || world.tick < (d.biteAt ?? 0) || target.dead) return;
    d.biteAt = world.tick + ticks(BITE.every);
    d.lunge = { targetId: target.id, until: world.tick + ticks(0.35) };
    world.dealDamage(dog, target, BITE.base + BITE.ad * self.damage, { proc: true });
  },
  onTick: (world, self) => {
    const d = data(self);
    let dog = brambleOf(world, self);
    if (!dog) {
      dog = world.spawnPet(self, {
        hp: 1, damage: 0, range: 0, attackInterval: 1, windup: 0, projectileSpeed: 0, speed: DOG.speed, radius: DOG.radius, bounty: 0,
      }, false, { species: 'bramble', intangible: true });
      d.brambleId = dog.id;
    }
    moveBramble(world, self, dog);
    // The Flock (and Hollis is safer among it).
    const flock = flockNear(world, self, FLOCK.radius);
    for (const m of flock) {
      keep(world, m, 'haste', FLOCK.haste, self.id);
      keep(world, m, 'guard', FLOCK.guard, self.id);
    }
    if (flock.length >= FLOCK.selfMinions) keep(world, self, 'guard', FLOCK.selfGuard, self.id);
    // The stampede's front: allied minions it has passed charge with it.
    const st = d.stampede;
    if (st) {
      const run = Math.min(R.length, R.speed * (world.tick - st.start) * DT);
      const front = { x: st.from.x + st.dir.x * run, y: st.from.y + st.dir.y * run };
      for (const m of world.units) {
        if (m.dead || m.kind !== 'minion' || m.team !== self.team || st.boosted.includes(m.id)) continue;
        if (segmentDistance(m.pos, st.from, front).d > R.width / 2 + m.radius) continue;
        st.boosted.push(m.id);
        world.addStatus(m, { kind: 'haste', value: R.haste, sourceId: self.id, seconds: R.charge });
        world.addStatus(m, { kind: 'guard', value: R.guard, sourceId: self.id, seconds: R.charge });
      }
      if (run >= R.length) d.stampede = undefined;
    }
  },
  onDeath: (world, self) => {
    const d = data(self);
    d.run = undefined;
    d.lunge = undefined;
    d.stampede = undefined;
    const dog = brambleOf(world, self);
    if (dog) dog.pos = spawnPoint(self.team); // he waits at the fountain
  },
};

export const HOLLIS_TUNING = { FLOCK, BITE, DOG, Q, W, E, R };
