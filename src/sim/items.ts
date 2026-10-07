import type { Perk } from './augments';
import type { AugmentId, Unit } from './types';
import { ticks } from './util';

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

  // ---- consumables (next duel only) ----
  { id: 'c.elixir', name: 'Elixir of Wrath', icon: '🧪', cost: 250, consumable: true, describe: 'Next duel only: +12 attack damage and +10% attack speed.', mods: { ad: 12, attackSpeed: 0.1 } },
  { id: 'c.tome', name: 'Tome of Insight', icon: '📘', cost: 300, consumable: true, describe: 'Next duel only: start one level higher.', extraLevels: 1 },
  { id: 'c.reroll', name: 'Fortune Token', icon: '🪙', cost: 200, consumable: true, describe: 'Gain an augment reroll now.', rerolls: 1 },
];

export const ITEMS: Record<AugmentId, Item> = Object.fromEntries(LIST.map((i) => [i.id, i]));
export const PERMANENT_ITEMS = LIST.filter((i) => !i.consumable).map((i) => i.id);
export const CONSUMABLES = LIST.filter((i) => i.consumable).map((i) => i.id);
