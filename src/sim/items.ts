import type { Perk } from './augments';
import type { AugmentId, Unit } from './types';
import { dist, ticks } from './util';

/**
 * Shop items. Permanent items are kept for the rest of the run (max 6). Consumables only last for
 * the next duel (`extraLevels` starts you higher), and `rerolls` is granted on purchase.
 */
export interface Item extends Perk {
  cost: number;
  consumable?: boolean;
  /** Start the next duel this many levels higher. */
  extraLevels?: number;
  /** Augment rerolls granted when bought. */
  rerolls?: number;
  /** A relic: only ever the free starting item, never sold or carried by opponents. */
  starter?: boolean;
}

export const MAX_ITEMS = 6;

/** Per-duel counters and cooldowns for item effects, keyed by item id. */
const store = (self: Unit) => self.champ!.augData as Record<string, number | undefined>;

const LIST: Item[] = [
  // ---- basic ----
  { id: 'i.blade', name: 'Iron Blade', icon: '🔪', cost: 350, describe: '+10 attack damage.', mods: { ad: 10 } },
  { id: 'i.ember', name: 'Ember Crystal', icon: '🔴', cost: 400, describe: '+150 max health.', mods: { hpFlat: 150 } },
  { id: 'i.dagger', name: 'Swift Dagger', icon: '🗡', cost: 300, describe: '+15% attack speed.', mods: { attackSpeed: 0.15 } },
  { id: 'i.seaglass', name: 'Sea Glass', icon: '🔷', cost: 300, describe: '+200 max mana and +1.5 mana regen per second.', mods: { manaFlat: 200, manaRegen: 1.5 } },
  { id: 'i.boots', name: 'Swiftboots', icon: '🥾', cost: 300, describe: '+10% move speed.', mods: { speedPct: 0.1 } },

  // ---- mid ----
  { id: 'i.sanguine', name: 'Sanguine Edge', icon: '🩸', cost: 1000, describe: '+15 attack damage and heal for 10% of damage dealt.', mods: { ad: 15, omnivamp: 0.1 } },
  { id: 'i.warden', name: "Warden's Plate", icon: '🛡', cost: 1000, describe: '+250 max health and take 10% less damage.', mods: { hpFlat: 250, takenMult: 0.9 } },
  { id: 'i.focus', name: 'Arcane Focus', icon: '🔮', cost: 900, describe: '+25 ability haste and +150 max mana.', mods: { haste: 25, manaFlat: 150 } },
  {
    id: 'i.storm', name: 'Stormcaller Bow', icon: '🌩', cost: 1000,
    describe: '+25% attack speed. Every third attack calls lightning for 40 + 30% attack damage.',
    mods: { attackSpeed: 0.25 },
    onAttackHit: (w, self, t) => {
      const f = store(self);
      f['i.storm'] = (f['i.storm'] ?? 0) + 1;
      if (f['i.storm'] % 3 !== 0) return;
      w.dealDamage(self, t, 40 + 0.3 * self.damage, { proc: true });
      w.addFx({ kind: 'detonate', pos: t.pos, team: self.team });
    },
  },

  // ---- big ----
  { id: 'i.greatsword', name: "Headsman's Greatsword", icon: '⚔', cost: 1500, describe: '+25 attack damage and deal 12% more damage.', mods: { ad: 25, dmgAmp: 0.12 } },
  {
    id: 'i.aegis', name: 'Tidebreaker Aegis', icon: '🔰', cost: 1400,
    describe: '+300 max health. Dropping below 30% health grants a shield of 150 + 12% max health for 3s (30s cooldown).',
    mods: { hpFlat: 300 },
    onHurt: (w, self) => {
      const f = store(self);
      if (self.dead || self.hp >= self.maxHp * 0.3 || w.tick < (f['i.aegis'] ?? -Infinity)) return;
      f['i.aegis'] = w.tick + ticks(30);
      w.addStatus(self, { kind: 'shield', value: 150 + 0.12 * self.maxHp, sourceId: self.id, seconds: 3 });
      w.addFx({ kind: 'splash', pos: self.pos, radius: 1.2, team: self.team });
    },
  },

  // ---- relics: the free starting item. Playful passives, no stats. ----
  {
    id: 'r.ricochet', name: 'Ricochet Charm', icon: '🪃', cost: 0, starter: true,
    describe: 'Every third attack bounces to another enemy nearby for 20 + 60% attack damage.',
    onAttackHit: (w, self, t) => {
      const f = store(self);
      f['r.ricochet'] = (f['r.ricochet'] ?? 0) + 1;
      if (f['r.ricochet'] % 3 !== 0) return;
      const next = w.units
        .filter((u) => u !== t && w.canAttack(self, u) && (u.kind === 'minion' || u.kind === 'champion') && dist(u.pos, t.pos) <= 5)
        .sort((a, b) => (a.kind === 'champion' ? -1 : 0) - (b.kind === 'champion' ? -1 : 0) || dist(a.pos, t.pos) - dist(b.pos, t.pos))[0];
      if (next) w.fireHoming(self, next, 'auto', 22, (u) => w.dealDamage(self, u, 20 + 0.6 * self.damage, { proc: true }), t.pos);
    },
  },
  {
    id: 'r.wisp', name: 'Wisp Lantern', icon: '🏮', cost: 0, starter: true,
    describe: 'Every 5s a wisp flies out at the enemy champion if they are within 7, dealing 25 + 5 per level + 25% attack damage.',
    onTick: (w, self) => {
      const f = store(self);
      if (self.dead || w.tick < (f['r.wisp'] ?? 0)) return;
      const foe = w.champions().find((c) => w.canAttack(self, c) && dist(c.pos, self.pos) <= 7);
      if (!foe) return;
      f['r.wisp'] = w.tick + ticks(5);
      w.fireHoming(self, foe, 'spark', 14, (u) => w.dealDamage(self, u, 25 + 5 * self.champ!.level + 0.25 * self.damage, { proc: true }));
    },
  },
  {
    id: 'r.phoenix', name: 'Phoenix Feather', icon: '🪶', cost: 0, starter: true,
    describe: 'Dropping below 25% health bursts into flame: heal 20% of max health and scorch enemies within 3 for 40 + 8 per level (60s cooldown).',
    onHurt: (w, self) => {
      const f = store(self);
      if (self.dead || self.hp >= self.maxHp * 0.25 || w.tick < (f['r.phoenix'] ?? -Infinity)) return;
      f['r.phoenix'] = w.tick + ticks(60);
      w.heal(self, 0.2 * self.maxHp);
      for (const e of w.enemiesInCircle(self.team, self.pos, 3)) w.dealDamage(self, e, 40 + 8 * self.champ!.level, { proc: true });
      w.addFx({ kind: 'erupt', pos: self.pos, radius: 3, team: self.team });
    },
  },
  {
    id: 'r.coin', name: 'Lucky Coin', icon: '🎲', cost: 0, starter: true,
    describe: 'Attacks have a 20% chance to land a lucky hit for 80% bonus damage.',
    onAttackHit: (w, self, t) => {
      if (!w.rng.chance(0.2)) return;
      w.dealDamage(self, t, 0.8 * self.damage, { proc: true });
      w.addFx({ kind: 'detonate', pos: t.pos, team: self.team });
    },
  },
  {
    id: 'r.bell', name: 'Echo Bell', icon: '🔔', cost: 0, starter: true,
    describe: 'Every third ability you cast rings the bell: enemies within 4 take 30 + 8 per level + 30% attack damage and are slowed 30% for 1.5s.',
    onCast: (w, self, _slot, _at, recast) => {
      if (recast) return;
      const f = store(self);
      f['r.bell'] = (f['r.bell'] ?? 0) + 1;
      if (f['r.bell'] % 3 !== 0) return;
      for (const e of w.enemiesInCircle(self.team, self.pos, 4)) {
        w.dealDamage(self, e, 30 + 8 * self.champ!.level + 0.3 * self.damage, { proc: true });
        if (!e.dead) w.addStatus(e, { kind: 'slow', value: 0.3, sourceId: self.id, seconds: 1.5 });
      }
      w.addFx({ kind: 'splash', pos: self.pos, radius: 4, team: self.team });
    },
  },
  {
    id: 'r.seed', name: 'Leech Seed', icon: '🌱', cost: 0, starter: true,
    describe: 'Hitting the enemy champion plants a seed (once per second). The fourth seed bursts for 40 + 5% of their max health, and heals you as much.',
    onDamage: (w, self, t, _amount, from) => {
      if (from.proc || t.kind !== 'champion' || t.dead) return;
      const f = store(self);
      if (w.tick < (f['r.seed.next'] ?? 0)) return;
      f['r.seed.next'] = w.tick + ticks(1);
      f['r.seed'] = (f['r.seed'] ?? 0) + 1;
      if (f['r.seed'] % 4 !== 0) return;
      const dealt = w.dealDamage(self, t, 40 + 0.05 * t.maxHp, { proc: true });
      w.heal(self, dealt);
      w.addFx({ kind: 'bloom', pos: t.pos, radius: 1, team: self.team });
    },
  },

  // ---- consumables (next duel only) ----
  { id: 'c.elixir', name: 'Elixir of Wrath', icon: '🧪', cost: 250, consumable: true, describe: 'Next duel only: +12 attack damage and +10% attack speed.', mods: { ad: 12, attackSpeed: 0.1 } },
  { id: 'c.tome', name: 'Tome of Insight', icon: '📘', cost: 300, consumable: true, describe: 'Next duel only: start one level higher.', extraLevels: 1 },
  { id: 'c.reroll', name: 'Fortune Token', icon: '🪙', cost: 200, consumable: true, describe: 'Gain an augment reroll now.', rerolls: 1 },
];

export const ITEMS: Record<AugmentId, Item> = Object.fromEntries(LIST.map((i) => [i.id, i]));
/** Sold in the shop and carried by opponents (relics are starting gifts only). */
export const PERMANENT_ITEMS = LIST.filter((i) => !i.consumable && !i.starter).map((i) => i.id);
export const STARTER_ITEMS = LIST.filter((i) => i.starter).map((i) => i.id);
export const CONSUMABLES = LIST.filter((i) => i.consumable).map((i) => i.id);
