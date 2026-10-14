import type { MinionRole, UnitKind } from './types';

/** Base stats. Times are in seconds here; the world converts them to ticks. */
export interface BaseStats {
  radius: number;
  hp: number;
  speed: number;
  damage: number;
  range: number;
  attackInterval: number;
  windup: number;
  projectileSpeed: number;
  /** Gold for the champion who lands the killing blow. */
  bounty: number;
}

/** Gold for a champion kill. Champion stats live in their kits (`src/sim/kits`). */
export const CHAMPION_BOUNTY = 300;

export const MINIONS: Record<MinionRole, BaseStats> = {
  melee: { radius: 0.45, hp: 300, speed: 4.6, damage: 14, range: 1.0, attackInterval: 1.25, windup: 0.3, projectileSpeed: 0, bounty: 21 },
  caster: { radius: 0.4, hp: 190, speed: 4.6, damage: 24, range: 5.0, attackInterval: 1.6, windup: 0.35, projectileSpeed: 14, bounty: 14 },
};

export const STRUCTURES: Record<Exclude<UnitKind, 'champion' | 'minion' | 'pet'>, BaseStats> = {
  tower: { radius: 1.4, hp: 2400, speed: 0, damage: 160, range: 7, attackInterval: 1.0, windup: 0.15, projectileSpeed: 24, bounty: 150 },
  nexus: { radius: 2.6, hp: 4000, speed: 0, damage: 0, range: 0, attackInterval: 1, windup: 0, projectileSpeed: 0, bounty: 0 },
};

export const WAVE = {
  /** Seconds before the first wave, and between waves. */
  first: 3,
  interval: 30,
  /** Spawn order; melee lead the wave. */
  roles: ['melee', 'melee', 'melee', 'caster', 'caster', 'caster'] as MinionRole[],
  /** Seconds between minions of one wave. */
  stagger: 0.5,
};

export const MINION_AGGRO = 7;
/** Allied minions within this distance of a champion that gets hit by an enemy champion switch to the attacker. */
export const CALL_FOR_HELP = 7;
export const RESPAWN_SECONDS = 8;

/** Standing within `radius` of your fountain heals `healPerSec` of max HP per second. */
export const FOUNTAIN = { radius: 6, healPerSec: 0.2 };
/** Champions' passive regeneration, HP per second. */
export const CHAMPION_REGEN = 2;

export const MAX_LEVEL = 11;
/** XP needed to go from level n to n+1 is XP_BASE + XP_STEP * (n - 1). */
export const XP_BASE = 280;
export const XP_STEP = 90;
/** XP for every enemy champion within XP_RANGE when a minion dies (no last hit needed). */
export const XP_RANGE = 12;
export const MINION_XP: Record<MinionRole, number> = { melee: 70, caster: 40 };
export const champKillXp = (victimLevel: number) => 180 + 30 * victimLevel;
