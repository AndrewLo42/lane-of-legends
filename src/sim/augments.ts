import type { AugmentId, DamageSource, Mods, Slot, Unit, Vec2 } from './types';
import { ITEMS } from './items';
import { KITS } from './kits';
import { TICK_HZ, ticks } from './util';
import type { World } from './world';

export type AugmentTier = 'silver' | 'gold' | 'prismatic';

/**
 * Anything a champion carries for a duel: augments and shop items. Simple ones are just `mods`; the
 * rest hook into the sim. Hooks run for the champion that owns the perk (bots included).
 */
export interface Perk {
  id: AugmentId;
  name: string;
  icon: string;
  describe: string;
  mods?: Partial<Mods>;
  /** Multiplier on damage we deal to `target`. */
  damageMult?: (world: World, self: Unit, target: Unit) => number;
  /** We dealt damage (after multipliers). */
  onDamage?: (world: World, self: Unit, target: Unit, amount: number, from: DamageSource) => void;
  /** We took damage. */
  onHurt?: (world: World, self: Unit, src: Unit | null, amount: number, from: DamageSource) => void;
  /** We cast (or recast) an ability. */
  onCast?: (world: World, self: Unit, slot: Slot, at: Vec2, recast: boolean) => void;
  onAttackHit?: (world: World, self: Unit, target: Unit) => void;
  /** We landed a killing blow. */
  onKill?: (world: World, self: Unit, victim: Unit) => void;
  onTick?: (world: World, self: Unit) => void;
  /** Our minions get this much extra health and damage. */
  minionBuff?: number;
  /** A champion kill counts this many times toward the kill goal. */
  killValue?: number;
}

/** A run-long power-up picked after a win. */
export interface Augment extends Perk {
  tier: AugmentTier;
}

const data = <T>(self: Unit, id: string, init: T): T => {
  const d = self.champ!.augData;
  if (d[id] === undefined) d[id] = init;
  return d[id] as T;
};

const LIST: Augment[] = [
  // ---- silver: plain stats ----
  { id: 'brute', name: 'Brute Force', icon: '🗡', tier: 'silver', describe: '+14 attack damage.', mods: { ad: 14 } },
  { id: 'thick', name: 'Thick Skin', icon: '🛡', tier: 'silver', describe: '+160 max health.', mods: { hpFlat: 160 } },
  { id: 'quick', name: 'Quickdraw', icon: '🏹', tier: 'silver', describe: '+22% attack speed.', mods: { attackSpeed: 0.22 } },
  { id: 'haste', name: 'Clockwork Focus', icon: '⏱', tier: 'silver', describe: '+20 ability haste (cooldowns ~17% shorter).', mods: { haste: 20 } },
  { id: 'fleet', name: 'Fleet Foot', icon: '👟', tier: 'silver', describe: '+8% move speed.', mods: { speedPct: 0.08 } },
  { id: 'well', name: 'Deep Well', icon: '💧', tier: 'silver', describe: '+150 max mana and +2 mana regen per second.', mods: { manaFlat: 150, manaRegen: 2 } },
  { id: 'vamp', name: 'Vampirism', icon: '🩸', tier: 'silver', describe: 'Heal for 9% of all damage you deal.', mods: { omnivamp: 0.09 } },

  // ---- gold: mechanics ----
  { id: 'glass', name: 'Glass Cannon', icon: '💥', tier: 'gold', describe: 'Deal 22% more damage, but have 15% less max health.', mods: { dmgAmp: 0.22, hpPct: -0.15 } },
  {
    id: 'execute', name: 'Executioner', icon: '🪓', tier: 'gold', describe: 'Deal 30% more damage to targets below 35% health.',
    damageMult: (_w, _s, t) => (t.hp < t.maxHp * 0.35 ? 1.3 : 1),
  },
  {
    id: 'spellblade', name: 'Spellblade', icon: '✴', tier: 'gold',
    describe: 'After casting an ability, your next attack within 8s deals bonus damage equal to 90% of your attack damage.',
    onCast: (w, self) => (self.champ!.augData.spellblade = w.tick + ticks(8)),
    onAttackHit: (w, self, t) => {
      if ((self.champ!.augData.spellblade as number | undefined ?? -1) < w.tick) return;
      self.champ!.augData.spellblade = -1;
      w.dealDamage(self, t, self.damage * 0.9, { proc: true });
      w.addFx({ kind: 'detonate', pos: t.pos, team: self.team });
    },
  },
  {
    id: 'secondwind', name: 'Second Wind', icon: '🍃', tier: 'gold',
    describe: 'After 4s without taking damage, regenerate 4% of your max health per second.',
    onTick: (w, self) => {
      if (w.tick - self.lastHurtTick > ticks(4)) w.heal(self, (self.maxHp * 0.04) / TICK_HZ);
    },
  },
  {
    id: 'thorns', name: 'Thornmail', icon: '🌵', tier: 'gold', describe: 'Reflect 25% of the damage enemy champions deal to you.',
    onHurt: (w, self, src, amount, from) => {
      if (src?.kind === 'champion' && !from.proc && !src.dead) w.dealDamage(self, src, amount * 0.25, { proc: true });
    },
  },
  {
    id: 'scavenger', name: 'Scavenger', icon: '🦴', tier: 'gold', describe: 'Last-hitting a minion restores 20 health and 15 mana.',
    onKill: (w, self, v) => {
      if (v.kind !== 'minion') return;
      w.heal(self, 20);
      // Bee champions get one bee instead (15 would refill the whole swarm).
      const gain = KITS[self.champ!.kit].resource === 'bees' ? 1 : 15;
      self.champ!.mana = Math.min(self.champ!.maxMana, self.champ!.mana + gain);
    },
  },
  { id: 'bounty', name: 'Bounty Hunter', icon: '🎯', tier: 'gold', describe: 'Champion kills count double toward the kill goal.', killValue: 2 },
  { id: 'siege', name: 'Siegebreaker', icon: '🏰', tier: 'gold', describe: 'Your minions have 40% more health and damage.', minionBuff: 0.4 },

  // ---- prismatic: build-defining ----
  {
    id: 'doubletap', name: 'Double Tap', icon: '⟳', tier: 'prismatic',
    describe: 'Every third basic ability you cast fires again for free 0.3s later.',
    onCast: (w, self, slot, at, recast) => {
      if (slot === 3 || recast) return;
      const d = data(self, 'doubletap', { n: 0 });
      if (++d.n % 3 === 0) w.after(0.3, () => w.replayCast(self, slot, at));
    },
  },
  {
    id: 'juggernaut', name: 'Juggernaut', icon: '🗿', tier: 'prismatic', describe: '+30% max health, and towers deal half damage to you.',
    mods: { hpPct: 0.3, towerTakenMult: 0.5 },
  },
  {
    id: 'tempo', name: 'Tempo', icon: '♻', tier: 'prismatic',
    describe: 'Damaging the enemy champion with an ability cuts your other basic cooldowns by 1s. Kills reset them all.',
    onDamage: (_w, self, t, _amt, from) => {
      if (t.kind !== 'champion' || from.slot == null || from.proc) return;
      self.champ!.abilities.forEach((a, i) => i !== 3 && i !== from.slot && (a.readyAt -= ticks(1)));
    },
    onKill: (w, self, v) => {
      if (v.kind === 'champion') self.champ!.abilities.forEach((a, i) => i !== 3 && (a.readyAt = w.tick));
    },
  },
  {
    id: 'infernal', name: 'Infernal', icon: '🔥', tier: 'prismatic', describe: 'Your abilities set targets ablaze for 40% extra damage over 3s.',
    onDamage: (w, self, t, amount, from) => {
      if (from.slot == null || from.proc || t.dead) return;
      w.addStatus(t, { kind: 'burn', value: (amount * 0.4) / 3, sourceId: self.id, seconds: 3 });
    },
  },
];

export const AUGMENTS: Record<AugmentId, Augment> = Object.fromEntries(LIST.map((a) => [a.id, a]));
export const AUGMENT_IDS = LIST.map((a) => a.id);
/** Every augment and item a champion carries, for running hooks. */
export const perksOf = (u: Unit): Perk[] =>
  u.champ ? [...u.champ.augments.map((id) => AUGMENTS[id]), ...u.champ.items.map((id) => ITEMS[id])].filter(Boolean) : [];

export const NO_MODS: Mods = {
  ad: 0, hpFlat: 0, hpPct: 0, attackSpeed: 0, haste: 0, speedPct: 0, omnivamp: 0, dmgAmp: 0, takenMult: 1, towerTakenMult: 1, manaFlat: 0, manaRegen: 0,
};

/** Sum augment and item mods (multipliers multiply) on top of `base`. */
export function combineMods(ids: AugmentId[], base: Partial<Mods> = {}): Mods {
  const out: Mods = { ...NO_MODS, ...base };
  for (const id of ids) {
    const m = (AUGMENTS[id] ?? ITEMS[id])?.mods;
    if (!m) continue;
    for (const k of Object.keys(m) as (keyof Mods)[]) {
      if (k === 'takenMult' || k === 'towerTakenMult') out[k] *= m[k]!;
      else out[k] += m[k]!;
    }
  }
  return out;
}
