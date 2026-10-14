import { spawnPoint } from '../lane';
import { FOUNTAIN } from '../stats';
import type { Unit, Vec2 } from '../types';
import { DT, dirTo, dist, ticks, toward } from '../util';
import { enemyOf, type World } from '../world';
import { at, champsAndMinions } from './common';
import type { AbilityDef, Kit } from './types';

/**
 * Pip & Thistle: a tiny sprout-knight and the giant, anxious toad he rides. Mounted, Pip is a fast
 * melee bruiser and Thistle's health takes hits first. On foot, Pip pokes from range with a slingshot
 * while Thistle stands guard. Only Pip's death counts.
 */

/** Thistle: his health and bite (both grow with Pip's level), how far he strays, and how long he panics. */
const THISTLE = { hp: 650, hpPerLevel: 85, soak: 0.8, damage: 32, damagePerLevel: 2.5, range: 1.2, attackInterval: 1.1, windup: 0.2, speed: 6.6, radius: 0.85, leash: 7, guardAhead: 1.4, panic: 12, comeBack: 0.5, calm: 4, regen: 0.02 };
/** Riding: melee reach, a little faster, and harder hits (the toad's tongue). */
const MOUNT = { range: 1.6, speed: 1.12, autoDamage: 1.2, radius: 0.85 };
const GULP = { base: [70, 110, 150, 190, 230], ad: 0.6, cost: 45, cd: [9, 8, 7, 6, 5], range: 5.5, width: 0.9, speed: 24, minion: 1.5, heal: 40, healPct: 0.06, yank: 2.5 };
const HOP = { base: [60, 95, 130, 165, 200], ad: 0.4, cost: 40, cd: [11, 10, 9, 8, 7], range: 4.5, speed: 15, radius: 1.8, slow: 0.25, slowFor: 1 };
const PEBBLES = { base: [40, 60, 80, 100, 120], ad: 0.3, cost: 35, cd: [6, 5.5, 5, 4.5, 4], range: 5.5, width: 0.5, speed: 26, spread: 0.22, repeat: 0.5 };
const PUFF = { cost: 40, cd: [14, 13, 12, 11, 10], range: 4, radius: 2.5, guard: 0.4, slow: 0.3, seconds: 3, pulse: 0.5, reach: 8, heal: 30, healPct: 0.06 };
const SWAP = { cd: [6, 5.5, 5, 4.5, 4], haste: 0.2, hasteFor: 2, vault: 3.5, vaultSpeed: 18, saddleReach: 7, saddleSpeed: 18 };
const LEAP = { base: [160, 280], ad: 0.7, cost: 100, cd: [90, 75], range: 7, radius: 2.2, castTime: 0.25, flight: 0.7, stun: 0.8 };

interface PipData {
  thistleId?: number;
  /** On foot (Thistle walks beside him). */
  foot?: boolean;
  /** Pip's own stats, kept so riding can change them and getting off can put them back. */
  base?: { range: number; projectileSpeed: number; speed: number; radius: number };
  /** Q and W cooldowns of the form not in use (each form keeps its own). */
  otherReady?: [number, number];
  /** Died since Thistle was last reset (he comes back with Pip, fresh). */
  died?: boolean;
}
const data = (u: Unit) => u.champ!.data as PipData;

export const riding = (u: Unit) => !data(u).foot;
export const thistleOf = (world: World, pip: Unit) => world.get(data(pip).thistleId);
/** Thistle is broken and fleeing. */
export const panicking = (world: World, thistle: Unit | undefined) => !!thistle?.pet && world.tick < thistle.pet.panicUntil;
const thistleReady = (world: World, pip: Unit) => {
  const t = thistleOf(world, pip);
  return !!t && !panicking(world, t) && t.hp > 0;
};

const thistleMaxHp = (pip: Unit) => (THISTLE.hp + THISTLE.hpPerLevel * (pip.champ!.level - 1)) * (1 + pip.champ!.mods.hpPct);

/** Ride Thistle or get off him: stats, which abilities show, and each form's Q/W cooldowns. */
function setForm(world: World, pip: Unit, ride: boolean) {
  const d = data(pip);
  const t = thistleOf(world, pip);
  if (riding(pip) === ride && d.base) return;
  const c = pip.champ!;
  const [q, w] = d.otherReady ?? [0, 0];
  d.otherReady = [c.abilities[0].readyAt, c.abilities[1].readyAt];
  c.abilities[0].readyAt = q;
  c.abilities[1].readyAt = w;
  c.abilities[0].recastUntil = c.abilities[1].recastUntil = 0;
  d.foot = !ride;
  const b = d.base!;
  pip.range = ride ? MOUNT.range : b.range;
  pip.projectileSpeed = ride ? 0 : b.projectileSpeed;
  pip.speed = ride ? b.speed * MOUNT.speed : b.speed;
  pip.radius = ride ? MOUNT.radius : b.radius;
  pip.windup = 0;
  if (t?.pet) {
    t.pet.mounted = ride;
    t.attackTarget = null;
    t.moveTarget = null;
    t.windup = 0;
    t.forced = null;
    if (ride) t.pos = { ...pip.pos };
  }
}

/** Thistle hits 0: he throws Pip off and bounds away to calm down. */
function panic(world: World, pip: Unit, t: Unit) {
  t.hp = 0;
  t.pet!.panicUntil = world.tick + ticks(THISTLE.panic);
  const wasRiding = riding(pip);
  if (wasRiding) setForm(world, pip, false);
  t.pet!.mounted = false;
  t.attackTarget = null;
  t.statuses = [];
  t.moveTarget = spawnPoint(pip.team);
  world.addFx({ kind: 'splash', pos: t.pos, radius: 1.4, team: pip.team });
  if (wasRiding && !pip.dead) {
    // Pip tumbles off backwards.
    const back = pip.team === 'blue' ? -1 : 1;
    world.pull(pip, { x: pip.pos.x + back * 1.5, y: pip.pos.y }, 10);
  }
}

/** Thistle on foot: guards Pip, bites whatever Pip attacks, and flees home while panicking. */
function thistleBrain(world: World, pip: Unit, t: Unit) {
  if (panicking(world, t)) {
    t.attackTarget = null;
    t.moveTarget = spawnPoint(pip.team);
    return;
  }
  if (t.hp <= 0) t.hp = t.maxHp * THISTLE.comeBack; // calmed down
  if (t.forced) return; // mid-hop (Puff Up, Big Leap)
  const far = dist(t.pos, pip.pos) > THISTLE.leash + 2;
  const mark = world.get(pip.attackTarget);
  if (!far && mark && world.canAttack(t, mark) && dist(mark.pos, pip.pos) <= THISTLE.leash) {
    t.attackTarget = mark.id;
    return;
  }
  // Bodyguard: snap at an enemy champion that's attacking Pip.
  const bully = world.units.find((u) => u.kind === 'champion' && !u.dead && u.team !== pip.team && u.attackTarget === pip.id);
  if (!far && bully && dist(bully.pos, t.pos) <= 4 && world.canAttack(t, bully)) {
    t.attackTarget = bully.id;
    return;
  }
  t.attackTarget = null;
  // Stand a little in front of Pip, toward the enemy side.
  const ahead = pip.team === 'blue' ? 1 : -1;
  const spot = { x: pip.pos.x + ahead * THISTLE.guardAhead, y: pip.pos.y };
  t.moveTarget = dist(t.pos, spot) > 1 ? spot : null;
}

/** Big Leap's landing: everything under Thistle takes damage and is knocked up. */
function land(world: World, pip: Unit, where: Vec2, rank: number) {
  const dmg = at(LEAP.base, rank) + LEAP.ad * pip.damage;
  world.addFx({ kind: 'slam', pos: where, radius: LEAP.radius, team: pip.team });
  for (const e of world.enemiesInCircle(pip.team, where, LEAP.radius)) {
    world.dealDamage(pip, e, dmg, { slot: 3 });
    if (!e.dead) world.addStatus(e, { kind: 'stun', value: 1, sourceId: pip.id, seconds: LEAP.stun });
  }
}

const bigLeap: AbilityDef = {
  name: 'Big Leap',
  icon: '🐸',
  maxRank: 2,
  cost: () => LEAP.cost,
  cooldown: (r) => at(LEAP.cd, r),
  castTime: LEAP.castTime,
  aim: { shape: 'circle', range: LEAP.range, radius: LEAP.radius },
  available: (world, self) => thistleReady(world, self) && (riding(self) || dist(thistleOf(world, self)!.pos, self.pos) <= LEAP.range + 2),
  damage: (r, self) => at(LEAP.base, r) + LEAP.ad * self.damage,
  describe: (r, self) =>
    `Thistle jumps high and crashes down on an area, dealing ${Math.round(bigLeap.damage!(r, self))} damage and knocking up ` +
    `everyone there for ${LEAP.stun}s. Riding, Pip comes along for the ride (an engage). On foot, Thistle jumps alone ` +
    `(from wherever he is), so Pip can set it up from safety.`,
  onWindup: ({ world, self, at: aim }) => {
    world.telegraph({ team: self.team, shape: 'circle', pos: clampReach(self, aim), dir: 0, length: LEAP.radius, width: 0 }, LEAP.castTime + LEAP.flight);
  },
  cast: ({ world, self, at: aim, rank }) => {
    const t = thistleOf(world, self);
    if (!t) return;
    const to = clampReach(self, aim);
    if (riding(self)) {
      world.dash(self, to, Math.max(8, dist(self.pos, to) / LEAP.flight), undefined, () => land(world, self, self.pos, rank));
    } else {
      world.pull(t, to, Math.max(8, dist(t.pos, to) / LEAP.flight));
      world.after(LEAP.flight, () => {
        if (!self.dead && t.pet && !panicking(world, t)) land(world, self, t.pos, rank);
      });
    }
  },
};

/** Aimed points are capped at the ability's range from Pip. */
function clampReach(self: Unit, aim: Vec2) {
  return dist(self.pos, aim) <= LEAP.range ? { ...aim } : toward(self.pos, aim, LEAP.range);
}

const RIDING_ABILITIES: Kit['abilities'] = [
  {
    name: 'Gulp',
    icon: '👅',
    maxRank: 5,
    cost: () => GULP.cost,
    cooldown: (r) => at(GULP.cd, r),
    castTime: 0.15,
    aim: { shape: 'line', length: GULP.range, width: GULP.width },
    damage: (r, self) => at(GULP.base, r) + GULP.ad * self.damage,
    describe: (r, self) =>
      `Thistle's tongue lashes out. The first enemy hit takes ${Math.round(RIDING_ABILITIES[0].damage!(r, self))} damage. ` +
      `A minion takes ${GULP.minion * 100}%, and if that finishes it Thistle swallows it (Pip's last hit) and heals ` +
      `${GULP.heal} + ${GULP.healPct * 100}% of his max health. The enemy champion is yanked ${GULP.yank} units in.`,
    cast: ({ world, self, at: aim, rank }) => {
      world.fireLine(self, {
        style: 'hook', dir: dirTo(self.pos, aim), speed: GULP.speed, range: GULP.range, width: GULP.width, canHit: champsAndMinions,
        onHit: (t) => {
          const dmg = RIDING_ABILITIES[0].damage!(rank, self);
          if (t.kind === 'minion') {
            world.dealDamage(self, t, dmg * GULP.minion, { slot: 0 });
            const toad = thistleOf(world, self);
            if (t.dead && toad) world.heal(toad, GULP.heal + toad.maxHp * GULP.healPct);
            return;
          }
          world.dealDamage(self, t, dmg, { slot: 0 });
          if (t.kind === 'champion' && !t.dead) world.pull(t, toward(t.pos, self.pos, Math.min(GULP.yank, Math.max(0, dist(t.pos, self.pos) - 1.5))), 14);
        },
      });
    },
  },
  {
    name: 'Hop',
    icon: '🦘',
    maxRank: 5,
    cost: () => HOP.cost,
    cooldown: (r) => at(HOP.cd, r),
    castTime: 0,
    aim: { shape: 'dash', range: HOP.range },
    damage: (r, self) => at(HOP.base, r) + HOP.ad * self.damage,
    describe: (r, self) =>
      `Thistle leaps up to ${HOP.range} units. Landing splashes enemies within ${HOP.radius} units for ` +
      `${Math.round(RIDING_ABILITIES[1].damage!(r, self))} damage and slows them ${HOP.slow * 100}% for ${HOP.slowFor}s.`,
    cast: ({ world, self, at: aim, rank }) => {
      world.dash(self, toward(self.pos, aim, HOP.range), HOP.speed, undefined, () => {
        world.addFx({ kind: 'splash', pos: self.pos, radius: HOP.radius, team: self.team });
        for (const e of world.enemiesInCircle(self.team, self.pos, HOP.radius)) {
          world.dealDamage(self, e, RIDING_ABILITIES[1].damage!(rank, self), { slot: 1 });
          if (!e.dead) world.addStatus(e, { kind: 'slow', value: HOP.slow, sourceId: self.id, seconds: HOP.slowFor });
        }
      });
    },
  },
  {
    name: 'Hop Off',
    icon: '🤸',
    maxRank: 5,
    cost: () => 0,
    cooldown: (r) => at(SWAP.cd, r),
    castTime: 0,
    aim: { shape: 'dash', range: SWAP.vault },
    describe: () =>
      `Pip vaults off Thistle up to ${SWAP.vault} units toward the cursor, landing with ${SWAP.haste * 100}% movement speed ` +
      `for ${SWAP.hasteFor}s, and fights on foot: a ranged slingshot, while ` +
      `Thistle stays behind to guard him. Q and W change, and each set keeps its own cooldowns.`,
    cast: ({ world, self, at: aim }) => {
      setForm(world, self, false);
      // Getting off by choice (not thrown off by a panic) puts a spring in his step.
      world.dash(self, toward(self.pos, aim, SWAP.vault), SWAP.vaultSpeed, undefined, () =>
        world.addStatus(self, { kind: 'haste', value: SWAP.haste, sourceId: self.id, seconds: SWAP.hasteFor }),
      );
    },
  },
  bigLeap,
];

const FOOT_ABILITIES: Kit['abilities'] = [
  {
    name: 'Pebble Burst',
    icon: '🪨',
    maxRank: 5,
    cost: () => PEBBLES.cost,
    cooldown: (r) => at(PEBBLES.cd, r),
    castTime: 0.15,
    aim: { shape: 'cone', radius: PEBBLES.range, angle: PEBBLES.spread * 2 + 0.2 },
    damage: (r, self) => at(PEBBLES.base, r) + PEBBLES.ad * self.damage,
    describe: (r, self) =>
      `Fire three pebbles in a narrow spread. Each stops on the first enemy it hits for ` +
      `${Math.round(FOOT_ABILITIES[0].damage!(r, self))} damage; the second and third to hit the same enemy deal ${PEBBLES.repeat * 100}%.`,
    cast: ({ world, self, at: aim, rank }) => {
      const hits = new Map<number, number>();
      const dmg = FOOT_ABILITIES[0].damage!(rank, self);
      const a = Math.atan2(aim.y - self.pos.y, aim.x - self.pos.x);
      for (const off of [-PEBBLES.spread, 0, PEBBLES.spread]) {
        world.fireLine(self, {
          style: 'auto', dir: { x: Math.cos(a + off), y: Math.sin(a + off) }, speed: PEBBLES.speed, range: PEBBLES.range, width: PEBBLES.width,
          canHit: champsAndMinions,
          onHit: (t) => {
            const n = hits.get(t.id) ?? 0;
            hits.set(t.id, n + 1);
            world.dealDamage(self, t, dmg * (n === 0 ? 1 : PEBBLES.repeat), { slot: 0 });
          },
        });
      }
    },
  },
  {
    name: 'Puff Up',
    icon: '🎈',
    maxRank: 5,
    cost: () => PUFF.cost,
    cooldown: (r) => at(PUFF.cd, r),
    castTime: 0,
    aim: { shape: 'circle', range: PUFF.range, radius: PUFF.radius },
    available: (world, self) => thistleReady(world, self) && dist(thistleOf(world, self)!.pos, self.pos) <= PUFF.reach,
    describe: () =>
      `Thistle hops to a spot within ${PUFF.range} units of Pip and puffs up for ${PUFF.seconds}s: he takes ` +
      `${PUFF.guard * 100}% less damage, heals ${PUFF.heal} + ${PUFF.healPct * 100}% of his max health over the duration, ` +
      `and slows enemies within ${PUFF.radius} units of him by ${PUFF.slow * 100}%. ` +
      `Stand him in the way: skillshots stop on him.`,
    cast: ({ world, self, at: aim }) => {
      const t = thistleOf(world, self);
      if (!t) return;
      const to = dist(self.pos, aim) <= PUFF.range ? { ...aim } : toward(self.pos, aim, PUFF.range);
      world.pull(t, to, 14);
      world.addStatus(t, { kind: 'guard', value: PUFF.guard, sourceId: self.id, seconds: PUFF.seconds });
      const pulses = Math.round(PUFF.seconds / PUFF.pulse);
      for (let s = 0; s < PUFF.seconds; s += PUFF.pulse) {
        world.after(s, () => {
          if (panicking(world, t) || t.pet?.mounted) return;
          world.heal(t, (PUFF.heal + t.maxHp * PUFF.healPct) / pulses);
          for (const e of world.enemiesInCircle(self.team, t.pos, PUFF.radius)) {
            world.addStatus(e, { kind: 'slow', value: PUFF.slow, sourceId: self.id, seconds: PUFF.pulse + 0.1 });
          }
        });
      }
      world.addFx({ kind: 'bellow', pos: to, radius: PUFF.radius, team: self.team });
    },
  },
  {
    name: 'Saddle Up',
    icon: '🏇',
    maxRank: 5,
    cost: () => 0,
    cooldown: (r) => at(SWAP.cd, r),
    castTime: 0,
    aim: { shape: 'circle', range: 0, radius: 0.8 },
    available: (world, self) => thistleReady(world, self) && dist(thistleOf(world, self)!.pos, self.pos) <= SWAP.saddleReach,
    describe: () =>
      `Pip runs to Thistle (within ${SWAP.saddleReach} units) and climbs back on. Not while Thistle is panicking.`,
    cast: ({ world, self }) => {
      const t = thistleOf(world, self);
      if (!t) return;
      t.moveTarget = null;
      t.attackTarget = null;
      world.dash(self, t.pos, SWAP.saddleSpeed, undefined, () => {
        if (!panicking(world, t) && t.hp > 0) setForm(world, self, true);
      });
    },
  },
  bigLeap,
];

export const PIP: Kit = {
  id: 'pip',
  name: 'Pip & Thistle',
  title: 'the Odd Couple',
  blurb:
    'A tiny sprout-knight and the giant, anxious toad he rides. Riding, a fast melee bruiser behind Thistle\'s health; ' +
    'on foot, a fragile slingshot poker with a toad bodyguard. Break the toad, then catch the kid.',
  color: '#7cc46a',
  stats: {
    hp: 520, hpPerLevel: 80, mana: 300, manaPerLevel: 40, manaRegen: 2, damage: 54, damagePerLevel: 3,
    attackInterval: 0.85, attackSpeedPerLevel: 0.025, windup: 0.2, range: 5, projectileSpeed: 22, speed: 6.3, radius: 0.5,
  },
  passive: {
    name: 'Best Friends',
    icon: '🤝',
    describe: (self) =>
      `Thistle has his own health (${Math.round(thistleMaxHp(self))} at this level). While Pip rides him, damage hits Thistle first, ` +
      `and he takes only ${THISTLE.soak * 100}% of it. ` +
      `At 0 health Thistle panics: he throws Pip off and bounds home, coming back after ${THISTLE.panic}s with ` +
      `${THISTLE.comeBack * 100}% health. He regenerates ${THISTLE.regen * 100}% of his health per second after ${THISTLE.calm}s ` +
      `without being hit, and heals at the fountain. On foot, Thistle bites whatever Pip attacks, stops skillshots, and minions and towers ` +
      `go for him before Pip. Only Pip's death counts.`,
  },
  levelOrder: [3, 0, 1, 2],
  abilities: RIDING_ABILITIES,
  otherForm: { label: 'On foot', abilities: FOOT_ABILITIES, active: (self) => !riding(self) },
  autoDamageMult: (_world, self) => (riding(self) ? MOUNT.autoDamage : 1),
  soak: (world, self, amount) => {
    const t = thistleOf(world, self);
    if (!riding(self) || !t || t.hp <= 0 || panicking(world, t)) return amount;
    // Thick-skinned: hits he takes for Pip land at THISTLE.soak.
    const take = Math.min(amount, t.hp / THISTLE.soak);
    t.hp -= take * THISTLE.soak;
    t.lastHurtTick = world.tick;
    if (t.hp <= 0.01) panic(world, self, t);
    return amount - take;
  },
  onPetDown: (world, self, pet) => panic(world, self, pet),
  onTick: (world, self) => {
    const d = data(self);
    if (!d.base) {
      // First tick: bring Thistle along, mounted.
      d.base = { range: self.range, projectileSpeed: self.projectileSpeed, speed: self.speed, radius: self.radius };
      const t = world.spawnPet(self, {
        hp: thistleMaxHp(self), damage: THISTLE.damage, range: THISTLE.range, attackInterval: THISTLE.attackInterval,
        windup: THISTLE.windup, projectileSpeed: 0, speed: THISTLE.speed, radius: THISTLE.radius, bounty: 0,
      }, true);
      d.thistleId = t.id;
      d.foot = true; // so setForm applies the riding stats
      setForm(world, self, true);
    }
    const t = thistleOf(world, self);
    if (!t) return;
    // Thistle grows with Pip (keeping how hurt he is).
    const max = thistleMaxHp(self);
    if (Math.abs(max - t.maxHp) > 0.5) {
      t.hp = t.hp > 0 ? (t.hp * max) / t.maxHp : 0;
      t.maxHp = max;
    }
    t.damage = THISTLE.damage + THISTLE.damagePerLevel * (self.champ!.level - 1);
    // He catches his breath out of combat, and the fountain patches him up like anyone else.
    if (t.hp > 0 && !panicking(world, t)) {
      const calm = world.tick - t.lastHurtTick >= ticks(THISTLE.calm);
      const home = dist(t.pos, spawnPoint(self.team)) <= FOUNTAIN.radius;
      world.heal(t, t.maxHp * ((calm ? THISTLE.regen : 0) + (home ? FOUNTAIN.healPerSec : 0)) * DT);
    }
    if (d.died) {
      // Back from the fountain together, both fresh.
      d.died = false;
      t.hp = t.maxHp;
      t.pet!.panicUntil = 0;
      t.statuses = [];
      setForm(world, self, true);
      t.pos = { ...self.pos };
    }
    if (riding(self)) {
      t.pos = { ...self.pos };
      t.facing = self.facing;
      t.attackTarget = null;
      t.moveTarget = null;
      t.windup = 0;
      return;
    }
    thistleBrain(world, self, t);
  },
  onDeath: (world, self) => {
    data(self).died = true;
    const t = thistleOf(world, self);
    if (t) {
      t.attackTarget = null;
      t.moveTarget = spawnPoint(self.team);
    }
  },
};

export const PIP_TUNING = { THISTLE, MOUNT, GULP, HOP, PEBBLES, PUFF, SWAP, LEAP };
/** For the bot and tests: which team Thistle is fighting. */
export const thistleFoe = (pip: Unit) => enemyOf(pip.team);
