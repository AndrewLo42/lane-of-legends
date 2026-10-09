import type { DamageSource, Unit, Vec2 } from '../types';
import { DT, dirTo, dist, gap, ticks, toward } from '../util';
import type { World } from '../world';
import { at, champsAndMinions } from './common';
import type { Kit } from './types';

/** Passive: each bee in the swarm adds this much to her autos. */
const SWARM = { perBee: 3, lastHitBees: 1 };
/** Honeyed targets take this much more from her bees (autos, stings, hive, Queen's Fury). */
const HONEY_BONUS = 0.3;
const SCURRY = { speed: 0.3, seconds: 1.5, cooldown: 8 };
const Q = { base: [45, 70, 95, 120, 145], ad: 0.35, cost: [1, 1, 1, 1, 1], cd: [3.5, 3.25, 3, 2.75, 2.5], range: 9, speed: 22, width: 0.5, seconds: 3, minion: 0.6 };
const W = { cost: [0, 0, 0, 0, 0], cd: [14, 13, 12, 11, 10], range: 8, radius: 1.8, delay: 0.45, lasts: 3, slow: 0.4, honey: 4 };
const E = {
  base: [20, 30, 40, 50, 60], perLevel: 4, ad: 0.2, cost: [2, 2, 2, 2, 2], cd: [26, 24, 22, 20, 18], range: 6, radius: 5.5, lasts: 12,
  every: 1, minionBuff: 0.2, regenMult: 2, speed: 16,
};
const R = { base: [280, 420], ad: 1.2, cost: [0, 0], cd: [90, 75], range: 7, pick: 2.5, seconds: 4, slow: 0.25 };

interface MabelData {
  hive?: { zone: number; pos: Vec2; until: number; nextShot: number; rank: number };
  /** Queen's Fury: the target every bee (and the hive) is diving. */
  fury?: { targetId: number; until: number };
  scurryReady?: number;
  /** Last enemy champion that hurt her, and when (the hive shoots them first). */
  lastAttacker?: { id: number; tick: number };
}
const data = (u: Unit) => u.champ!.data as MabelData;

const bees = (u: Unit) => Math.floor(u.champ!.mana);
const honeyed = (w: World, t: Unit) => !!w.status(t, 'honey');
/** Bee damage, plus the honey bonus. */
const beeDamage = (w: World, t: Unit, amount: number) => amount * (honeyed(w, t) ? 1 + HONEY_BONUS : 1);

/** The enemy champion Queen's Fury would dive when aimed at `aim`. */
function furyTarget(world: World, self: Unit, aim: Vec2): Unit | undefined {
  return world
    .champions()
    .filter((c) => world.canAttack(self, c) && gap(self, c) <= R.range && dist(c.pos, aim) <= R.pick + c.radius)
    .sort((a, b) => dist(a.pos, aim) - dist(b.pos, aim))[0];
}

/**
 * What the hive shoots: the Fury target, then a minion this shot finishes (a last hit for Mabel), then
 * whoever just hurt her, then the nearest minion, then any champion.
 */
function hiveTarget(world: World, self: Unit, pos: Vec2, shot: number): Unit | undefined {
  const d = data(self);
  const inRange = (u: Unit | undefined) => !!u && !u.dead && world.canAttack(self, u) && dist(u.pos, pos) <= E.radius + u.radius;
  const fury = d.fury && world.tick < d.fury.until ? world.get(d.fury.targetId) : undefined;
  if (inRange(fury)) return fury;
  const finish = world.units.find((u) => u.kind === 'minion' && inRange(u) && u.hp <= beeDamage(world, u, shot));
  if (finish) return finish;
  const attacker = d.lastAttacker && world.tick - d.lastAttacker.tick < ticks(3) ? world.get(d.lastAttacker.id) : undefined;
  if (inRange(attacker)) return attacker;
  const near = (kind: Unit['kind']) =>
    world.units.filter((u) => u.kind === kind && inRange(u)).sort((a, b) => dist(a.pos, pos) - dist(b.pos, pos))[0];
  return near('minion') ?? near('champion');
}

/**
 * A mouse beekeeper who pushes lanes: bees are her resource (farm minions for more), stings stack,
 * honey slows and softens targets for her bees, and a hive holds ground while it buffs her minions.
 */
export const MABEL: Kit = {
  id: 'mabel',
  name: 'Mabel',
  title: 'the Beekeeper',
  blurb: 'Short-range lane pusher. Spend bees on stacking stings, honey enemies so the swarm hits harder, and plant a hive that fires bees and powers up your wave.',
  color: '#f2b632',
  resource: 'bees',
  autoStyle: 'bee',
  stats: {
    // Bees, not mana: 4 at level 1 rising to 8, regrowing one every 4s.
    hp: 560, hpPerLevel: 88, mana: 4, manaPerLevel: 0.4, manaRegen: 0.25, damage: 52, damagePerLevel: 3.2,
    attackInterval: 0.75, attackSpeedPerLevel: 0.03, windup: 0.18, range: 4.5, projectileSpeed: 18, speed: 6.9, radius: 0.5,
  },
  passive: {
    name: 'The Swarm',
    icon: '🐝',
    describe: (self) =>
      `Mabel spends bees instead of mana: she regrows one every 4s, and last-hitting a minion gives one more. Pollinated: ` +
      `an enemy minion that dies stung or honeyed counts as her last hit, whoever finished it. Each bee ` +
      `in her swarm adds ${SWARM.perBee} damage to her attacks (she points and a bee flies out) (${SWARM.perBee * bees(self)} now). Honeyed enemies take ` +
      `${HONEY_BONUS * 100}% more from her bees. When an enemy champion hits her she scurries ${SCURRY.speed * 100}% faster ` +
      `for ${SCURRY.seconds}s (once every ${SCURRY.cooldown}s).`,
  },
  levelOrder: [3, 0, 2, 1],
  abilities: [
    {
      name: 'Sting',
      icon: '🐝',
      maxRank: 5,
      cost: (r) => at(Q.cost, r),
      cooldown: (r) => at(Q.cd, r),
      castTime: 0,
      aim: { shape: 'line', length: Q.range, width: Q.width },
      damage: (r, self) => at(Q.base, r) + Q.ad * self.damage,
      describe: (r, self) =>
        `Send a bee that latches onto the first enemy hit and stings it for ${Math.round(MABEL.abilities[0].damage!(r, self))} damage ` +
        `over ${Q.seconds}s (minions take ${Q.minion * 100}%). Stings stack.`,
      cast: ({ world, self, at: aim, rank }) => {
        world.fireLine(self, {
          style: 'bee', dir: dirTo(self.pos, aim), speed: Q.speed, range: Q.range, width: Q.width, canHit: champsAndMinions,
          onHit: (t) => {
            const total = beeDamage(world, t, MABEL.abilities[0].damage!(rank, self) * (t.kind === 'minion' ? Q.minion : 1));
            world.addStatus(t, { kind: 'sting', value: total / Q.seconds, sourceId: self.id, seconds: Q.seconds });
          },
        });
      },
    },
    {
      name: 'Honey Pot',
      icon: '🍯',
      maxRank: 5,
      cost: (r) => at(W.cost, r),
      cooldown: (r) => at(W.cd, r),
      castTime: 0.15,
      aim: { shape: 'circle', range: W.range, radius: W.radius },
      describe: () =>
        `Lob a pot of honey that splashes after ${W.delay}s, leaving a sticky puddle for ${W.lasts}s. Enemies in it are slowed ` +
        `${W.slow * 100}% and honeyed for ${W.honey}s. Costs no bees.`,
      onWindup: ({ world, self, at: aim }) => {
        const pos = toward(self.pos, aim, W.range);
        world.telegraph({ team: self.team, shape: 'circle', pos, dir: 0, length: W.radius, width: 0 }, W.delay + 0.15);
      },
      cast: ({ world, self, at: aim }) => {
        const pos = toward(self.pos, aim, W.range);
        world.after(W.delay, () => {
          if (!self.dead) world.addZone('honey', self, pos, W.radius, W.lasts);
        });
      },
    },
    {
      name: 'Hive',
      icon: '🏠',
      maxRank: 5,
      cost: (r) => at(E.cost, r),
      cooldown: (r) => at(E.cd, r),
      castTime: 0.2,
      aim: { shape: 'circle', range: E.range, radius: E.radius },
      damage: (r, self) => at(E.base, r) + E.perLevel * self.champ!.level + E.ad * self.damage,
      describe: (r, self) =>
        `Plant a hive for ${E.lasts}s. Every ${E.every}s it fires a bee for ${Math.round(MABEL.abilities[2].damage!(r, self))} damage ` +
        `at an enemy within ${E.radius} (whoever just hit Mabel first). Allied minions near it deal ${E.minionBuff * 100}% more ` +
        `damage, and Mabel regrows bees ${E.regenMult}× as fast beside it. One hive at a time.`,
      cast: ({ world, self, at: aim, rank }) => {
        const d = data(self);
        if (d.hive) world.removeZone(d.hive.zone);
        const pos = toward(self.pos, aim, E.range);
        const zone = world.addZone('hive', self, pos, E.radius, E.lasts);
        d.hive = { zone: zone.id, pos, until: zone.until, nextShot: world.tick + ticks(0.5), rank };
      },
    },
    {
      name: "Queen's Fury",
      icon: '👑',
      maxRank: 2,
      cost: (r) => at(R.cost, r),
      cooldown: (r) => at(R.cd, r),
      castTime: 0.25,
      aim: { shape: 'target', range: R.range },
      target: furyTarget,
      damage: (r, self) => at(R.base, r) + R.ad * self.damage,
      describe: (r, self) =>
        `Refill the swarm, then send every bee diving at an enemy champion over ${R.seconds}s for ${Math.round(MABEL.abilities[3].damage!(r, self))} ` +
        `damage in total, slowing them ${R.slow * 100}%. Her hive joins in.`,
      cast: ({ world, self, at: aim, rank }) => {
        const t = furyTarget(world, self, aim);
        if (!t) return;
        const c = self.champ!;
        c.mana = c.maxMana;
        const swarm = Math.max(4, Math.floor(c.maxMana));
        const each = MABEL.abilities[3].damage!(rank, self) / swarm;
        data(self).fury = { targetId: t.id, until: world.tick + ticks(R.seconds) };
        world.addStatus(t, { kind: 'slow', value: R.slow, sourceId: self.id, seconds: R.seconds });
        world.addFx({ kind: 'rage', pos: self.pos, team: self.team });
        for (let i = 0; i < swarm; i++) {
          world.after((i * R.seconds) / swarm, () => {
            if (t.dead || self.dead) return;
            world.fireHoming(self, t, 'bee', 20, (u) => world.dealDamage(self, u, beeDamage(world, u, each), { slot: 3 }));
          });
        }
      },
    },
  ],
  onAttackHit: (world, self, t) => {
    // The swarm piles on: a bit more per bee, and the honey bonus on the whole hit.
    const swarm = SWARM.perBee * bees(self);
    const bonus = swarm + (honeyed(world, t) ? HONEY_BONUS * (self.damage + swarm) : 0);
    if (bonus > 0) world.dealDamage(self, t, bonus, { proc: true });
  },
  onKill: (_world, self, victim) => {
    if (victim.kind !== 'minion') return;
    const c = self.champ!;
    c.mana = Math.min(c.maxMana, c.mana + SWARM.lastHitBees);
  },
  // Pollinated: minions that die stung or honeyed are hers, whoever finished them.
  claimsMinion: (world, self, m) => m.statuses.some((s) => (s.kind === 'sting' || s.kind === 'honey') && s.sourceId === self.id && s.until > world.tick),
  onHurt: (world, self, src: Unit | null, _amount, _from: DamageSource) => {
    if (src?.kind !== 'champion' || src.team === self.team) return;
    const d = data(self);
    d.lastAttacker = { id: src.id, tick: world.tick };
    if (world.tick < (d.scurryReady ?? 0)) return;
    d.scurryReady = world.tick + ticks(SCURRY.cooldown);
    world.addStatus(self, { kind: 'haste', value: SCURRY.speed, sourceId: self.id, seconds: SCURRY.seconds });
  },
  onTick: (world, self) => {
    const d = data(self);
    // Honey: slow and honey everything standing in a puddle.
    for (const z of world.zones) {
      if (z.kind !== 'honey' || z.ownerId !== self.id) continue;
      for (const e of world.enemiesInCircle(self.team, z.pos, z.radius)) {
        world.addStatus(e, { kind: 'slow', value: W.slow, sourceId: self.id, seconds: 0.25 });
        const h = world.status(e, 'honey', self.id);
        if (h) h.until = world.tick + ticks(W.honey);
        else world.addStatus(e, { kind: 'honey', value: 1, sourceId: self.id, seconds: W.honey });
      }
    }
    const hive = d.hive;
    if (!hive) return;
    if (world.tick >= hive.until) {
      d.hive = undefined;
      return;
    }
    // Faster bees beside the hive.
    const c = self.champ!;
    if (dist(self.pos, hive.pos) <= E.radius) c.mana = Math.min(c.maxMana, c.mana + MABEL.stats.manaRegen * (E.regenMult - 1) * DT);
    if (world.tick >= hive.nextShot) {
      const dmg = MABEL.abilities[2].damage!(hive.rank, self);
      const t = hiveTarget(world, self, hive.pos, dmg);
      if (t) {
        hive.nextShot = world.tick + ticks(E.every);
        world.fireHoming(self, t, 'bee', E.speed, (u) => world.dealDamage(self, u, beeDamage(world, u, dmg), { slot: 2 }), { x: hive.pos.x, y: hive.pos.y });
      }
    }
  },
  onDeath: (world, self) => {
    const d = data(self);
    if (d.hive) world.removeZone(d.hive.zone);
    self.champ!.data = {};
  },
};

/** Her hive's minion buff: allied minions near one of their team's hives hit harder. */
export function hiveMinionMult(world: World, src: Unit): number {
  if (src.kind !== 'minion') return 1;
  const near = world.zones.some((z) => z.kind === 'hive' && z.team === src.team && dist(z.pos, src.pos) <= z.radius);
  return near ? 1 + E.minionBuff : 1;
}

export const MABEL_TUNING = { SWARM, HONEY_BONUS, SCURRY, Q, W, E, R };
