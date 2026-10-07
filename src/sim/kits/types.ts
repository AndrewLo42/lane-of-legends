import type { Slot, Unit, Vec2 } from '../types';
import type { World } from '../world';

/** How the player aims an ability; drives the cast indicator. */
export type Aim =
  | { shape: 'line'; length: number; width: number }
  | { shape: 'cone'; radius: number; angle: number }
  | { shape: 'circle'; range: number; radius: number }
  | { shape: 'dash'; range: number }
  /** Two blades closing on the cursor from either side of the caster (see `pincerShape`). */
  | { shape: 'pincer'; range: number; minRange: number; spread: number }
  /** Click an enemy within `range`; the indicator shows the range. */
  | { shape: 'target'; range: number };

export interface CastCtx {
  world: World;
  self: Unit;
  /** Where the player aimed (world coordinates). */
  at: Vec2;
  rank: number;
  /** This is the recast of an ability with a recast window. */
  recast: boolean;
}

export interface AbilityDef {
  name: string;
  icon: string;
  maxRank: number;
  cost: (rank: number) => number;
  /** Seconds. */
  cooldown: (rank: number) => number;
  /** Seconds rooted before `cast` runs. */
  castTime: number;
  aim: Aim;
  /**
   * Unit-targeted abilities: the enemy this cast would hit when aimed at `at`, or undefined. With
   * no valid target the cast doesn't start (no mana or cooldown spent).
   */
  target?: (world: World, self: Unit, at: Vec2) => Unit | undefined;
  /** Main damage at a rank, if it deals any (bots and tooltips use this). */
  damage?: (rank: number, self: Unit) => number;
  /** Tooltip text for a rank (0 = not learned yet; describe rank 1). */
  describe: (rank: number, self: Unit) => string;
  cast: (ctx: CastCtx) => void;
  /** Runs the moment the key is pressed, before the wind-up (telegraphs go here). */
  onWindup?: (ctx: CastCtx) => void;
  /** Seconds the recast stays available after casting (0/undefined = no recast). */
  recastWindow?: number;
  recast?: (ctx: CastCtx) => void;
  /** Recast wind-up, if different from castTime. */
  recastTime?: number;
}

export interface KitStats {
  hp: number;
  hpPerLevel: number;
  mana: number;
  manaPerLevel: number;
  manaRegen: number;
  damage: number;
  damagePerLevel: number;
  attackInterval: number;
  /** Fraction of attack speed gained per level. */
  attackSpeedPerLevel: number;
  windup: number;
  range: number;
  projectileSpeed: number;
  speed: number;
  radius: number;
}

export interface Kit {
  id: string;
  name: string;
  title: string;
  blurb: string;
  /** Accent colour for UI and effects. */
  color: string;
  stats: KitStats;
  passive: { name: string; icon: string; describe: (self: Unit) => string };
  abilities: [AbilityDef, AbilityDef, AbilityDef, AbilityDef];
  /** Order the bot spends skill points in. */
  levelOrder: Slot[];
  /** An auto-attack of ours landed. */
  onAttackHit?: (world: World, self: Unit, target: Unit) => void;
  /** One of our abilities damaged something (`slot` is which). */
  onAbilityHit?: (world: World, self: Unit, target: Unit, slot: Slot) => void;
  /** We dealt damage of any kind. */
  onDamageDealt?: (world: World, self: Unit, target: Unit, amount: number) => void;
  onDeath?: (world: World, self: Unit) => void;
  /** Runs every tick while alive. */
  onTick?: (world: World, self: Unit) => void;
}
