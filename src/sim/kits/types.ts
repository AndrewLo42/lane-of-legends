import type { DamageSource, MissileStyle, Slot, Unit, Vec2 } from '../types';
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
  /** Health spent on this cast (health-cost kits), so it can be refunded. */
  paid?: number;
}

export interface AbilityDef {
  name: string;
  icon: string;
  maxRank: number;
  /** Mana (or bees). For `resource: 'health'` kits, a fraction of current health (0.07 = 7%). */
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
  /** Can't be cast right now, whatever the cooldown (Aurelle's Arcane Lance while her spear is away). */
  available?: (world: World, self: Unit) => boolean;
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
  /**
   * No Meshy model yet (plays as a placeholder): only selectable with the select screen's
   * Experimental toggle, and never a bot.
   */
  experimental?: boolean;
  stats: KitStats;
  passive: { name: string; icon: string; describe: (self: Unit) => string };
  /**
   * What the mana bar holds. 'bees' (Mabel): a small whole-number pool; mana items and augments
   * don't add to it, and the HUD shows it as bees. 'health' (Gormund): no mana at all; abilities
   * cost a fraction of current health (never lethal) and the HUD hides the mana bar.
   */
  resource?: 'mana' | 'bees' | 'health';
  /** Abilities cost nothing right now (Gormund's Labyrinth Rage). */
  freeCasts?: (world: World, self: Unit) => boolean;
  /** Extra auto-attack reach against `target` (Sable reaches further against enemies she's Gleaned). */
  attackRangeBonus?: (world: World, self: Unit, target: Unit) => number;
  /** Multiplier on all damage we deal right now (Gormund's Fury). */
  damageMult?: (world: World, self: Unit, target: Unit) => number;
  /** Melee or ranged, for champion select's filters; by default from the attack reach (under 3 is melee). */
  reach?: 'melee' | 'ranged';
  /** A second meter the HUD shows under the mana bar (Lumen's Devotion). */
  meter?: { label: string; max: number; value: (self: Unit) => number };
  /** Missile look for ranged auto-attacks (default 'auto'). */
  autoStyle?: MissileStyle;
  /** Multiplier on auto-attack damage right now (Aurelle's unarmed bolts hit softer). */
  autoDamageMult?: (world: World, self: Unit) => number;
  abilities: [AbilityDef, AbilityDef, AbilityDef, AbilityDef];
  /**
   * A second set of abilities the champion switches to (Pip on foot); `inOtherForm` says when. Use
   * `abilitiesOf(u)` to get whichever set is active.
   */
  otherForm?: { label: string; abilities: [AbilityDef, AbilityDef, AbilityDef, AbilityDef]; active: (self: Unit) => boolean };
  /** Takes damage meant for us first; returns what's left over for our own health (Thistle while Pip rides). */
  soak?: (world: World, self: Unit, amount: number) => number;
  /** Our pet hit 0 health (pets don't die; the kit decides what happens). */
  onPetDown?: (world: World, self: Unit, pet: Unit) => void;
  /** Order the bot spends skill points in. */
  levelOrder: Slot[];
  /** An auto-attack of ours landed. */
  onAttackHit?: (world: World, self: Unit, target: Unit) => void;
  /** One of our abilities damaged something (`slot` is which). */
  onAbilityHit?: (world: World, self: Unit, target: Unit, slot: Slot) => void;
  /** We dealt damage of any kind. */
  onDamageDealt?: (world: World, self: Unit, target: Unit, amount: number) => void;
  /** We were credited with a kill (last hit, or a minion we claimed). */
  onKill?: (world: World, self: Unit, victim: Unit) => void;
  /** Claim an enemy minion that died without a champion's last hit (it counts as ours: gold, CS, bee). */
  claimsMinion?: (world: World, self: Unit, minion: Unit) => boolean;
  /** We took damage (after shields). */
  onHurt?: (world: World, self: Unit, src: Unit | null, amount: number, from: DamageSource) => void;
  onDeath?: (world: World, self: Unit) => void;
  /** Runs every tick while alive. */
  onTick?: (world: World, self: Unit) => void;
}
