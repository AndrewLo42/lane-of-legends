import type { Unit, Vec2 } from '../types';
import { angleTo, dirTo, dist, gap, inCone, pincerShape, toward } from '../util';
import type { World } from '../world';
import { at, champsAndMinions } from './common';
import type { Kit } from './types';

const Q = { base: [45, 70, 95, 120, 145], ad: 0.65, cost: [25, 25, 25, 25, 25], cd: [9, 8, 7, 6, 5], range: 6, pick: 1.6, manaBack: 0.5 };
const W = { guard: [0.35, 0.4, 0.45, 0.5, 0.55], regen: 0.03, cost: [50, 50, 50, 50, 50], cd: [16, 15, 14, 13, 12], meditate: 1, lasts: 3 };
const E = { base: [60, 95, 130, 165, 200], ad: 0.6, cost: [60, 60, 60, 60, 60], cd: [12, 11, 10, 9, 8], range: 8, minRange: 3, spread: 0.4, speed: 24, minion: 0.8 };
const R = { base: [90, 140], ad: 0.5, cost: [100, 100], cd: [80, 65], blades: 9, fan: (70 * Math.PI) / 180, length: 9, maxPerTarget: 3 };
const HARVEST = { flat: 40, hp: 0.05 };
const MARK_SECONDS = 4;

const mark = (world: World, self: Unit, t: Unit) => {
  if (!t.dead) world.addStatus(t, { kind: 'mark', value: 1, sourceId: self.id, seconds: MARK_SECONDS });
};

/** The enemy Petal Step would dash to when aimed at `aim`: closest to the cursor, within range. */
function qTarget(world: World, self: Unit, aim: Vec2): Unit | undefined {
  return world.units
    .filter((u) => world.canAttack(self, u) && champsAndMinions(u) && dist(u.pos, aim) <= Q.pick + u.radius && gap(self, u) <= Q.range)
    .sort((a, b) => dist(a.pos, aim) - dist(b.pos, aim))[0];
}

/** Fire one Blossom Storm blade along `dir` (radians); `hits` caps how often each enemy can be struck by this cast. */
function blade(world: World, self: Unit, dir: number, length: number, damage: number, hits: Map<number, number>, cap: number) {
  world.fireLine(self, {
    style: 'petal', dir: { x: Math.cos(dir), y: Math.sin(dir) }, speed: 24, range: length, width: 0.6, pierce: true,
    canHit: champsAndMinions,
    onHit: (t) => {
      const n = hits.get(t.id) ?? 0;
      if (n >= cap) return;
      hits.set(t.id, n + 1);
      world.dealDamage(self, t, damage, { slot: 3 });
      mark(world, self, t);
    },
  });
}

/**
 * A duelist who flows between targets: mark enemies with thrown blades, then dash through them,
 * each marked (or killed) target refunding the dash and healing her.
 */
export const LISHA: Kit = {
  id: 'lisha',
  name: 'Lisha',
  title: 'the Blossom Blade',
  blurb: 'Melee duelist. Mark enemies with twin blades, then dash from target to target: every mark or kill resets the dash and heals her.',
  color: '#e86f9a',
  stats: {
    hp: 670, hpPerLevel: 95, mana: 340, manaPerLevel: 45, manaRegen: 2.0, damage: 62, damagePerLevel: 4,
    attackInterval: 0.78, attackSpeedPerLevel: 0.025, windup: 0.2, range: 1.6, projectileSpeed: 0, speed: 6.7, radius: 0.6,
  },
  passive: {
    name: 'Petal Harvest',
    icon: '❀',
    describe: (self) => `When Petal Step consumes a mark, Lisha heals ${Math.round(HARVEST.flat + HARVEST.hp * self.maxHp)} health.`,
  },
  levelOrder: [3, 0, 2, 1],
  abilities: [
    {
      name: 'Petal Step',
      icon: '➹',
      maxRank: 5,
      cost: (r) => at(Q.cost, r),
      cooldown: (r) => at(Q.cd, r),
      castTime: 0,
      aim: { shape: 'target', range: Q.range },
      target: qTarget,
      damage: (r, self) => at(Q.base, r) + Q.ad * self.damage,
      describe: (r, self) =>
        `Dash to an enemy and cut it for ${Math.round(LISHA.abilities[0].damage!(r, self))} damage. If it was marked or the ` +
        `cut kills it, the cooldown resets (a mark also refunds half the mana).`,
      cast: ({ world, self, at: aim, rank }) => {
        const t = qTarget(world, self, aim);
        if (!t) return;
        const reach = Math.max(0, dist(self.pos, t.pos) - self.radius - t.radius - 0.2);
        self.facing = angleTo(self.pos, t.pos);
        world.dash(self, toward(self.pos, t.pos, reach), 30, undefined, () => {
          if (t.dead || gap(self, t) > 1.5) return;
          const marked = world.status(t, 'mark', self.id);
          if (marked) world.removeStatus(t, marked);
          world.dealDamage(self, t, LISHA.abilities[0].damage!(rank, self), { slot: 0 });
          world.addFx({ kind: 'dashHit', pos: t.pos, team: self.team });
          const c = self.champ!;
          if (marked) {
            // Petal Harvest.
            world.heal(self, HARVEST.flat + HARVEST.hp * self.maxHp);
            c.mana = Math.min(c.maxMana, c.mana + Q.manaBack * at(Q.cost, rank));
            world.addFx({ kind: 'bloom', pos: self.pos, radius: 1, team: self.team });
          }
          if (marked || t.dead) c.abilities[0].readyAt = world.tick;
        });
      },
    },
    {
      name: 'Find Your Center',
      icon: '☯',
      maxRank: 5,
      cost: (r) => at(W.cost, r),
      cooldown: (r) => at(W.cd, r),
      castTime: W.meditate,
      aim: { shape: 'circle', range: 0, radius: 1.2 },
      describe: (r, self) =>
        `Meditate for ${W.meditate}s (rooted, no attacks). For ${W.lasts}s she takes ${at(W.guard, r) * 100}% less damage and ` +
        `regenerates ${Math.round(W.regen * self.maxHp)} health per second.`,
      onWindup: ({ world, self, rank }) => {
        world.addStatus(self, { kind: 'guard', value: at(W.guard, rank), sourceId: self.id, seconds: W.lasts });
        world.addStatus(self, { kind: 'regen', value: W.regen * self.maxHp, sourceId: self.id, seconds: W.lasts });
        world.addFx({ kind: 'bloom', pos: self.pos, radius: 1.4, team: self.team });
      },
      cast: () => {},
    },
    {
      name: 'Twin Petals',
      icon: '⋁',
      maxRank: 5,
      cost: (r) => at(E.cost, r),
      cooldown: (r) => at(E.cd, r),
      castTime: 0.15,
      aim: { shape: 'pincer', range: E.range, minRange: E.minRange, spread: E.spread },
      damage: (r, self) => at(E.base, r) + E.ad * self.damage,
      describe: (r, self) =>
        `Send two blades from either side of her to close on a point like a pincer. Everything between them is cut for ` +
        `${Math.round(LISHA.abilities[2].damage!(r, self))} damage (minions take ${E.minion * 100}%) and marked for ${MARK_SECONDS}s.`,
      cast: ({ world, self, at: aim, rank }) => {
        const dmg = LISHA.abilities[2].damage!(rank, self);
        const p = pincerShape(self.pos, aim, E.range, E.minRange, E.spread);
        // The blades fly in from the arms' outer ends; everything inside the V is cut as they sweep
        // past it (outermost first), finishing on the point.
        for (const s of p.starts) {
          world.fireLine(self, { style: 'petal', from: s, dir: dirTo(s, p.point), speed: E.speed, range: dist(s, p.point), width: 0.6, canHit: () => false, onHit: () => {} });
        }
        const victims = world.units.filter(
          (u) => !u.dead && u.team !== self.team && champsAndMinions(u) && inCone(p.point, p.back, p.depth, E.spread * 2, u.pos, u.radius),
        );
        for (const t of victims) {
          const closing = dist(p.point, t.pos); // the blades reach this depth after travelling the rest
          world.after(Math.max(0, p.depth - closing) / E.speed, () => {
            if (t.dead) return;
            world.dealDamage(self, t, t.kind === 'minion' ? dmg * E.minion : dmg, { slot: 2 });
            mark(world, self, t);
          });
        }
      },
    },
    {
      name: 'Blossom Storm',
      icon: '✾',
      maxRank: 2,
      cost: (r) => at(R.cost, r),
      cooldown: (r) => at(R.cd, r),
      castTime: 0.35,
      aim: { shape: 'cone', radius: R.length, angle: R.fan },
      damage: (r, self) => at(R.base, r) + R.ad * self.damage,
      describe: (r, self) =>
        `Hurl a hail of ${R.blades} blades in a fan. Each deals ${Math.round(LISHA.abilities[3].damage!(r, self))} damage ` +
        `(up to ${R.maxPerTarget} blades per enemy) and marks everything it cuts.`,
      onWindup: ({ world, self, at: aim }) => {
        world.telegraph({ team: self.team, shape: 'cone', pos: self.pos, dir: angleTo(self.pos, aim), length: R.length, width: R.fan }, 0.35);
      },
      cast: ({ world, self, at: aim, rank }) => {
        const dir = angleTo(self.pos, aim);
        const hits = new Map<number, number>();
        const dmg = LISHA.abilities[3].damage!(rank, self);
        for (let i = 0; i < R.blades; i++) {
          blade(world, self, dir - R.fan / 2 + (R.fan * i) / (R.blades - 1), R.length, dmg, hits, R.maxPerTarget);
        }
      },
    },
  ],
};

