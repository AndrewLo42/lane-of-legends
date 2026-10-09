import type { Unit, Vec2 } from '../types';
import { dirTo, dist, ticks } from '../util';
import type { World } from '../world';
import { at, champsAndMinions } from './common';
import type { Kit } from './types';

/** Holding the spear: long-reach thrusts. Without it: arcane bolts that hit softer. */
const ARMED = { range: 2.6 };
const UNARMED = { range: 5, speed: 22, damage: 0.7 };
/** Picking the spear back up readies an empowered thrust. */
const PICKUP = { radius: 1.2, bonus: 0.5, returnAfter: 6 };
const Q = {
  base: [70, 105, 140, 175, 210], ad: 0.7, cost: [50, 50, 50, 50, 50], cd: [8, 7.5, 7, 6.5, 6],
  range: 9, speed: 26, width: 0.6, slow: 0.3, slowSeconds: 1, window: 3, recall: 0.6,
};
const W = { base: [60, 90, 120, 150, 180], ad: 0.4, cost: [60, 60, 60, 60, 60], cd: [16, 15, 14, 13, 12], blink: 4, radius: 2, delay: 0.8, slow: 0.4 };
const E = {
  sweep: [60, 90, 120, 150, 180], sweepAd: 0.7, sweepRadius: 2.4, knockback: 2.5,
  nova: [80, 120, 160, 200, 240], novaAd: 0.5, novaRadius: 3.2, cost: [50, 50, 50, 50, 50], cd: [10, 9.5, 9, 8.5, 8],
};
const R = {
  cost: [100, 100], cd: [85, 70], seconds: 6, lances: 3, fan: 0.3, lance: 0.6, qCd: 2, autoRange: 4.5, cleave: 0.4, cleaveRadius: 1.8,
  crash: [150, 250], crashAd: 0.6, crashRadius: 3,
};

type Spear =
  | { state: 'held' }
  | { state: 'flying'; since: number }
  | { state: 'impaled'; targetId: number; until: number }
  | { state: 'ground'; pos: Vec2; zone: number; returnAt: number }
  | { state: 'returning'; since: number };

interface AurelleData {
  spear?: Spear;
  /** Picked the spear back up: the next thrust hits harder. */
  empowered?: boolean;
  arsenalUntil?: number;
  arsenalRank?: number;
}
const data = (u: Unit) => u.champ!.data as AurelleData;
const spearOf = (u: Unit): Spear => data(u).spear ?? { state: 'held' };
export const holdingSpear = (u: Unit) => spearOf(u).state === 'held';
/** Where her spear is lying, if it's on the ground (the bot walks back for it). */
export const spearOnGround = (u: Unit): Vec2 | null => {
  const s = spearOf(u);
  return s.state === 'ground' ? s.pos : null;
};
const inArsenal = (w: World, u: Unit) => w.tick < (data(u).arsenalUntil ?? 0);

/** Her autos follow the spear: thrusts in hand, bolts without it (and cleaving bolts during Arsenal). */
function updateAttack(w: World, self: Unit) {
  const armed = holdingSpear(self) && !inArsenal(w, self);
  self.range = armed ? ARMED.range : inArsenal(w, self) ? R.autoRange : UNARMED.range;
  self.projectileSpeed = armed ? 0 : UNARMED.speed;
}

function setSpear(w: World, self: Unit, spear: Spear) {
  const d = data(self);
  const old = d.spear;
  if (old?.state === 'ground') w.removeZone(old.zone);
  d.spear = spear;
  updateAttack(w, self);
}

/** Spear lying in the lane: a marker zone, and it flies home by itself if left too long. */
function drop(w: World, self: Unit, pos: Vec2) {
  const zone = w.addZone('spear', self, pos, 0.6, 3600);
  setSpear(w, self, { state: 'ground', pos: { ...pos }, zone: zone.id, returnAt: w.tick + ticks(PICKUP.returnAfter) });
}

/** Fly the spear from `from` back to Aurelle, hitting enemies on the way for `damage` (0 = harmless). */
function fly(w: World, self: Unit, from: Vec2, damage: number) {
  setSpear(w, self, { state: 'returning', since: w.tick });
  const range = Math.max(0.5, dist(from, self.pos));
  w.fireLine(self, {
    style: 'spear', from, dir: dirTo(from, self.pos), speed: Q.speed * 1.2, range, width: Q.width, pierce: true,
    canHit: damage > 0 ? champsAndMinions : () => false,
    onHit: (t) => {
      w.dealDamage(self, t, damage, { slot: 0 });
    },
    onEnd: () => {
      if (spearOf(self).state === 'returning') setSpear(w, self, { state: 'held' });
    },
  });
}

/** One spectral lance during Arsenal: out through everything, then back to her. */
function lance(w: World, self: Unit, dir: number, damage: number) {
  w.fireLine(self, {
    style: 'lance', dir: { x: Math.cos(dir), y: Math.sin(dir) }, speed: Q.speed, range: Q.range, width: Q.width, pierce: true,
    canHit: champsAndMinions,
    onHit: (t) => {
      w.dealDamage(self, t, damage, { slot: 0 });
    },
    onEnd: (end) => {
      if (self.dead) return;
      w.fireLine(self, {
        style: 'lance', from: end, dir: dirTo(end, self.pos), speed: Q.speed * 1.2, range: Math.max(0.5, dist(end, self.pos)), width: Q.width,
        pierce: true, canHit: champsAndMinions, onHit: (t) => {
          w.dealDamage(self, t, damage, { slot: 0 });
        },
      });
    },
  });
}

/**
 * A battle mage with a floating rune spear. In hand it makes her a reach fighter; thrown, she
 * fights with arcane bolts until she recalls it (only after impaling a champion) or picks it up.
 */
export const AURELLE: Kit = {
  id: 'aurelle',
  name: 'Aurelle',
  title: 'the Spellspear',
  blurb: 'Battle mage with a floating spear. Thrust at reach, throw it to impale a champion and rip it back through them, and fight with arcane bolts while it is away.',
  color: '#a98bff',
  autoStyle: 'bolt',
  stats: {
    hp: 650, hpPerLevel: 94, mana: 400, manaPerLevel: 50, manaRegen: 2.4, damage: 64, damagePerLevel: 4,
    attackInterval: 0.8, attackSpeedPerLevel: 0.02, windup: 0.2, range: ARMED.range, projectileSpeed: 0, speed: 6.6, radius: 0.6,
  },
  passive: {
    name: 'Bound Weapon',
    icon: '⟡',
    describe: () =>
      `While Aurelle holds her spear she attacks with ${ARMED.range}-range thrusts. Without it she fires arcane bolts ` +
      `(range ${UNARMED.range}, ${UNARMED.damage * 100}% damage). Picking the spear back up empowers her next thrust by ` +
      `${PICKUP.bonus * 100}%. A spear left on the ground flies back to her after ${PICKUP.returnAfter}s.`,
  },
  levelOrder: [3, 0, 2, 1],
  abilities: [
    {
      name: 'Arcane Lance',
      icon: '➳',
      maxRank: 5,
      cost: (r) => at(Q.cost, r),
      cooldown: (r) => at(Q.cd, r),
      castTime: 0.15,
      aim: { shape: 'line', length: Q.range, width: Q.width },
      available: (w, self) => holdingSpear(self) || inArsenal(w, self),
      damage: (r, self) => at(Q.base, r) + Q.ad * self.damage,
      describe: (r, self) =>
        `Throw her spear through minions for ${Math.round(AURELLE.abilities[0].damage!(r, self))} damage. If it impales a ` +
        `champion it stops in them (slowing ${Q.slow * 100}%), and for ${Q.window}s she can recast to rip it back through ` +
        `everything for ${Q.recall * 100}% damage. If it misses champions it lands at max range: go and pick it up. ` +
        `During Arsenal Ascendant it throws ${R.lances} spectral lances that return on their own.`,
      cast: ({ world, self, at: aim, rank }) => {
        const dmg = AURELLE.abilities[0].damage!(rank, self);
        if (inArsenal(world, self)) {
          const dir = Math.atan2(aim.y - self.pos.y, aim.x - self.pos.x);
          for (let i = 0; i < R.lances; i++) lance(world, self, dir + (i - (R.lances - 1) / 2) * R.fan, dmg * R.lance);
          self.champ!.abilities[0].readyAt = world.tick + ticks(R.qCd);
          return;
        }
        setSpear(world, self, { state: 'flying', since: world.tick });
        let impaled = false;
        world.fireLine(self, {
          style: 'spear', dir: dirTo(self.pos, aim), speed: Q.speed, range: Q.range, width: Q.width, pierce: true, canHit: champsAndMinions,
          onHit: (t) => {
            world.dealDamage(self, t, dmg, { slot: 0 });
            if (t.kind !== 'champion' || t.dead) return false;
            // Impaled: the spear stops in them and the recall opens.
            impaled = true;
            world.addStatus(t, { kind: 'impale', value: 1, sourceId: self.id, seconds: Q.window });
            world.addStatus(t, { kind: 'slow', value: Q.slow, sourceId: self.id, seconds: Q.slowSeconds });
            setSpear(world, self, { state: 'impaled', targetId: t.id, until: world.tick + ticks(Q.window) });
            self.champ!.abilities[0].recastUntil = world.tick + ticks(Q.window);
            return true;
          },
          onEnd: (end) => {
            if (!impaled && spearOf(self).state === 'flying') drop(world, self, end);
          },
        });
      },
      recast: ({ world, self, rank }) => {
        const s = spearOf(self);
        if (s.state !== 'impaled') return;
        const t = world.get(s.targetId);
        const from = t ? { ...t.pos } : { ...self.pos };
        if (t) {
          const st = world.status(t, 'impale', self.id);
          if (st) world.removeStatus(t, st);
        }
        fly(world, self, from, AURELLE.abilities[0].damage!(rank, self) * Q.recall);
      },
    },
    {
      name: 'Glyph Step',
      icon: '✧',
      maxRank: 5,
      cost: (r) => at(W.cost, r),
      cooldown: (r) => at(W.cd, r),
      castTime: 0,
      aim: { shape: 'dash', range: W.blink },
      damage: (r, self) => at(W.base, r) + W.ad * self.damage,
      describe: (r, self) =>
        `Blink up to ${W.blink} units, leaving a glyph behind that detonates after ${W.delay}s for ` +
        `${Math.round(AURELLE.abilities[1].damage!(r, self))} damage, slowing enemies ${W.slow * 100}% for 1.5s.`,
      cast: ({ world, self, at: aim, rank }) => {
        const pos = { ...self.pos };
        world.blink(self, aim, W.blink);
        world.addZone('glyph', self, pos, W.radius, W.delay);
        world.telegraph({ team: self.team, shape: 'circle', pos, dir: 0, length: W.radius, width: 0 }, W.delay);
        world.after(W.delay, () => {
          world.addFx({ kind: 'splash', pos, radius: W.radius, team: self.team });
          for (const e of world.enemiesInCircle(self.team, pos, W.radius)) {
            world.dealDamage(self, e, AURELLE.abilities[1].damage!(rank, self), { slot: 1 });
            if (!e.dead) world.addStatus(e, { kind: 'slow', value: W.slow, sourceId: self.id, seconds: 1.5 });
          }
        });
      },
    },
    {
      name: 'Sweep / Arcane Nova',
      icon: '◎',
      maxRank: 5,
      cost: (r) => at(E.cost, r),
      cooldown: (r) => at(E.cd, r),
      castTime: 0.15,
      aim: { shape: 'circle', range: 0, radius: E.novaRadius },
      damage: (r, self) => (holdingSpear(self) ? at(E.sweep, r) + E.sweepAd * self.damage : at(E.nova, r) + E.novaAd * self.damage),
      describe: (r, self) =>
        `With her spear: Sweep, hitting enemies within ${E.sweepRadius} for ${Math.round(at(E.sweep, r) + E.sweepAd * self.damage)} ` +
        `damage and knocking them back. Without it: Arcane Nova, a burst within ${E.novaRadius} for ` +
        `${Math.round(at(E.nova, r) + E.novaAd * self.damage)} damage.`,
      cast: ({ world, self, rank }) => {
        if (holdingSpear(self)) {
          world.addFx({ kind: 'swing', pos: self.pos, radius: E.sweepRadius, angle: Math.PI * 2, team: self.team });
          for (const e of world.enemiesInCircle(self.team, self.pos, E.sweepRadius)) {
            world.dealDamage(self, e, at(E.sweep, rank) + E.sweepAd * self.damage, { slot: 2 });
            if (!e.dead) {
              const out = dirTo(self.pos, e.pos);
              world.pull(e, { x: e.pos.x + out.x * E.knockback, y: e.pos.y + out.y * E.knockback }, 18);
            }
          }
        } else {
          world.addFx({ kind: 'erupt', pos: self.pos, radius: E.novaRadius, team: self.team });
          for (const e of world.enemiesInCircle(self.team, self.pos, E.novaRadius)) {
            world.dealDamage(self, e, at(E.nova, rank) + E.novaAd * self.damage, { slot: 2 });
          }
        }
      },
    },
    {
      name: 'Arsenal Ascendant',
      icon: '⚚',
      maxRank: 2,
      cost: (r) => at(R.cost, r),
      cooldown: (r) => at(R.cd, r),
      castTime: 0.3,
      aim: { shape: 'circle', range: 0, radius: R.crashRadius },
      damage: (r, self) => at(R.crash, r) + R.crashAd * self.damage,
      describe: (r, self) =>
        `For ${R.seconds}s, spectral lances ring her: Arcane Lance throws ${R.lances} in a fan that return on their own ` +
        `(${R.lance * 100}% damage each way, ${R.qCd}s cooldown), and her attacks become bolts that cleave ` +
        `${R.cleave * 100}% to nearby enemies. When it ends the lances crash down around her for ` +
        `${Math.round(AURELLE.abilities[3].damage!(r, self))} damage.`,
      cast: ({ world, self, rank }) => {
        const d = data(self);
        d.arsenalUntil = world.tick + ticks(R.seconds);
        d.arsenalRank = rank;
        world.addStatus(self, { kind: 'arsenal', value: 1, sourceId: self.id, seconds: R.seconds });
        world.addFx({ kind: 'ghost', pos: self.pos, team: self.team });
        self.champ!.abilities[0].readyAt = world.tick; // a lance volley right away
        updateAttack(world, self);
      },
    },
  ],
  autoDamageMult: (w, self) => (holdingSpear(self) || inArsenal(w, self) ? 1 : UNARMED.damage),
  onAttackHit: (world, self, t) => {
    const d = data(self);
    if (d.empowered && holdingSpear(self)) {
      d.empowered = false;
      world.dealDamage(self, t, PICKUP.bonus * self.damage, { proc: true });
      world.addFx({ kind: 'dashHit', pos: t.pos, team: self.team });
    }
    if (inArsenal(world, self)) {
      for (const e of world.enemiesInCircle(self.team, t.pos, R.cleaveRadius)) {
        if (e !== t) world.dealDamage(self, e, R.cleave * self.damage, { proc: true });
      }
    }
  },
  onTick: (world, self) => {
    const d = data(self);
    const s = spearOf(self);
    // Safety net: a spear somehow lost in flight (a missile removed without landing) drops beside her.
    if ((s.state === 'flying' || s.state === 'returning') && world.tick - s.since > ticks(4)) drop(world, self, self.pos);
    if (s.state === 'impaled') {
      const t = world.get(s.targetId);
      // Not recalled in time (or they died): it drops at their feet.
      if (!t || t.dead || world.tick >= s.until) drop(world, self, t ? t.pos : self.pos);
    } else if (s.state === 'ground') {
      if (dist(self.pos, s.pos) <= PICKUP.radius + self.radius) {
        setSpear(world, self, { state: 'held' });
        d.empowered = true;
        world.addFx({ kind: 'levelUp', pos: self.pos, team: self.team });
      } else if (world.tick >= s.returnAt) {
        const from = s.pos;
        world.removeZone(s.zone);
        fly(world, self, from, 0);
      }
    }
    if (d.arsenalUntil != null && world.tick >= d.arsenalUntil) {
      const rank = d.arsenalRank ?? 1;
      d.arsenalUntil = undefined;
      world.addFx({ kind: 'erupt', pos: self.pos, radius: R.crashRadius, team: self.team });
      for (const e of world.enemiesInCircle(self.team, self.pos, R.crashRadius)) {
        world.dealDamage(self, e, AURELLE.abilities[3].damage!(rank, self), { slot: 3 });
      }
      updateAttack(world, self);
    }
  },
  onDeath: (world, self) => {
    const s = spearOf(self);
    if (s.state === 'ground') world.removeZone(s.zone);
    self.champ!.data = {};
    updateAttack(world, self);
  },
};

export const AURELLE_TUNING = { ARMED, UNARMED, PICKUP, Q, W, E, R };
