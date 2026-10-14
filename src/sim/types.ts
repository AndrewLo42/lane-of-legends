/**
 * Simulation types. The sim is pure TypeScript with no three.js or DOM imports, so it can be unit
 * tested and later run on a server for PvP. The world is a 2D plane: `x` runs along the lane
 * (blue base at -x, red base at +x) and `y` across it (the renderer maps it to three.js Z).
 */
export interface Vec2 {
  x: number;
  y: number;
}

export type Team = 'blue' | 'red';
/** `pet`: a champion's companion unit (Pip's Thistle), fighting alongside but not a champion. */
export type UnitKind = 'champion' | 'minion' | 'tower' | 'nexus' | 'pet';
export type MinionRole = 'melee' | 'caster';
export type KitId = 'arlo' | 'tock' | 'maren' | 'lisha' | 'mabel' | 'aurelle' | 'gormund' | 'sable' | 'pip';
/** 0..3 = Q W E R. */
export type Slot = 0 | 1 | 2 | 3;

export type AugmentId = string;

/** Additive stat changes from augments and duel rules (multipliers multiply). */
export interface Mods {
  ad: number;
  hpFlat: number;
  hpPct: number;
  /** Bonus attack speed (0.2 = +20%). */
  attackSpeed: number;
  /** Ability haste: cooldowns are multiplied by 100 / (100 + haste). */
  haste: number;
  speedPct: number;
  /** Heal for this fraction of all damage dealt. */
  omnivamp: number;
  /** Extra damage dealt (0.2 = +20%). */
  dmgAmp: number;
  /** Damage taken multiplier. */
  takenMult: number;
  /** Damage taken from towers multiplier. */
  towerTakenMult: number;
  manaFlat: number;
  manaRegen: number;
}

/** Where damage came from; drives which hooks fire. `proc` damage (on-hit extras, burns) fires no on-hit hooks, so procs can't chain. */
export interface DamageSource {
  attack?: boolean;
  slot?: Slot;
  proc?: boolean;
}

export interface Status {
  kind: 'slow' | 'mark' | 'momentum' | 'burn' | 'soak' | 'root' | 'stun' | 'shield' | 'guard' | 'regen' | 'grievous' | 'haste' | 'rage' | 'tether' | 'sting' | 'honey' | 'bearing' | 'frenzy' | 'impale' | 'arsenal' | 'unstoppable' | 'gleaned' | 'reaping';
  until: number;
  /**
   * slow: fraction removed (0.5 = half speed); momentum/soak: stacks; burn: damage per second;
   * shield: damage it can still absorb; guard: fraction of damage prevented; regen: HP per second;
   * grievous: fraction of healing lost; haste: extra move speed fraction; rage: bonus attack damage
   * (plus a fixed attack speed bonus); tether: tagged by a Tether, so its caster can dash to it;
   * sting: a bee latched on, damage per second (like burn); honey: honeyed, bees hit harder;
   * bearing: Arlo's Triangulate stacks on a target (the third one procs); frenzy: bonus attack speed fraction;
   * impale: Aurelle's spear is stuck in this unit (she can recall it through them); arsenal: Aurelle's
   * ultimate is up (spectral lances ring her); unstoppable: ignores slows, roots, stuns and displacement;
   * gleaned: hooked by Sable (her reach and healing); reaping: Sable's follow-up window is open on this unit.
   * Root stops movement (and dashes); stun stops everything.
   */
  value: number;
  sourceId: number;
}

/** Summoner spells: two per champion, picked for the run and swappable between floors. */
export type SummonerId = 'flash' | 'ignite' | 'ghost' | 'barrier' | 'tether' | 'rage';
export type SummonerSlot = 0 | 1;

export interface SummonerState {
  id: SummonerId;
  readyAt: number;
  /** Tether: while tick < recastUntil, pressing again dashes to the tagged enemy. */
  recastUntil: number;
}

export interface AbilityState {
  rank: number;
  /** Tick when the ability comes off cooldown. */
  readyAt: number;
  /** While tick < recastUntil, pressing the key recasts instead of casting. */
  recastUntil: number;
}

/** Everything only champions have. */
export interface ChampState {
  kit: KitId;
  level: number;
  xp: number;
  skillPoints: number;
  mana: number;
  maxMana: number;
  abilities: [AbilityState, AbilityState, AbilityState, AbilityState];
  /** Rooted while winding up an ability; it fires at `fireAt`. */
  casting: { slot: Slot; at: Vec2; fireAt: number; recast: boolean; paid: number } | null;
  /** The latest ability cast (or recast), for the renderer's cast animation. */
  lastCast: { slot: Slot; tick: number; time: number } | null;
  /** A cast pressed during a wind-up or dash; it fires as soon as the champion is free (if before `until`). */
  queued: { slot: Slot; at: Vec2; until: number } | null;
  /** Moving under its own power (can't act until it lands). */
  dash: { to: Vec2; speed: number; onPass?: (u: Unit) => void; onArrive?: () => void; passed: number[] } | null;
  /** Kit-specific bookkeeping (echo positions, rewind history, ...). */
  data: Record<string, unknown>;
  augments: AugmentId[];
  /** Shop items carried into this duel (permanent ones plus this duel's consumables). */
  items: AugmentId[];
  /** Augment and item bookkeeping, keyed by id. */
  augData: Record<string, unknown>;
  mods: Mods;
  /** Opponent scaling: base HP and damage (and their growth) are multiplied by this. */
  statMult: number;
  kills: number;
  deaths: number;
  /** Minion last hits. */
  cs: number;
  summoners: SummonerState[];
}

export interface Unit {
  id: number;
  kind: UnitKind;
  team: Team;
  role?: MinionRole;
  pos: Vec2;
  radius: number;
  hp: number;
  maxHp: number;
  /** Units per second before slows; 0 for structures. */
  speed: number;
  /** Where the unit is walking to, if anywhere. */
  moveTarget: Vec2 | null;
  /** Facing angle in radians (0 = +x). */
  facing: number;

  // ---- auto-attacks ----
  damage: number;
  /** Edge-to-edge reach. */
  range: number;
  /** Seconds between attacks before attack-speed bonuses. */
  attackInterval: number;
  /** Ticks from attack start until it fires (moving during it cancels the attack). */
  windupTicks: number;
  /** 0 = melee (instant hit when the windup ends). */
  projectileSpeed: number;
  attackTarget: number | null;
  /** Ticks until the next attack may start. */
  attackCd: number;
  /** Ticks left in the current windup, 0 when not attacking. */
  windup: number;

  // ---- bookkeeping ----
  /** Tick the last attack started / damage was taken (renderer feedback). */
  lastAttackTick: number;
  lastHurtTick: number;
  dead: boolean;
  /** Champions only: tick at which they come back. */
  respawnTick: number;
  gold: number;
  /** Minions: lateral offset they keep while marching. */
  laneY: number;
  statuses: Status[];
  /** Being pulled or knocked somewhere; can't act until it lands. */
  forced: { to: Vec2; speed: number } | null;
  champ?: ChampState;
  pet?: PetState;
}

/** A pet's tie to its champion. Its owner's kit drives it (where it walks, what it attacks). */
export interface PetState {
  ownerId: number;
  /** Carrying its owner (Pip riding Thistle): it moves with them and can't be targeted. */
  mounted: boolean;
  /** Broken at 0 health: untargetable and out of the fight until this tick. */
  panicUntil: number;
}

/** What a missile looks like; the renderer picks a mesh per style. */
export type MissileStyle = 'auto' | 'tower' | 'spark' | 'flare' | 'bolt' | 'wave' | 'tide' | 'petal' | 'tether' | 'bee' | 'spear' | 'lance' | 'stone' | 'hook' | 'gauntlet' | 'water';

export interface Missile {
  id: number;
  team: Team;
  sourceId: number;
  style: MissileStyle;
  pos: Vec2;
  speed: number;
  /** Homing missiles chase a unit; line missiles fly along `dir` until `range` runs out. */
  targetId: number | null;
  dir: Vec2;
  range: number;
  travelled: number;
  /** Line missiles: collision width. */
  width: number;
  /** Line missiles keep going after a hit. */
  pierce: boolean;
  /** Line missiles: which units can stop/take it. */
  canHit: (u: Unit) => boolean;
  hit: number[];
  /** Return true from a piercing line missile's hit to stop it there (Aurelle's spear stops in a champion). */
  onHit: (target: Unit) => void | boolean;
  /** Line missiles: called with where it came to rest (range spent, stopped, or left the lane). */
  onEnd?: (pos: Vec2) => void;
  /** Id of the stasis field holding it in place, if any. */
  frozenBy: number | null;
}

export interface Zone {
  id: number;
  kind: 'stasis' | 'echo' | 'anchor' | 'maelstrom' | 'honey' | 'hive' | 'glyph' | 'spear';
  team: Team;
  ownerId: number;
  pos: Vec2;
  radius: number;
  until: number;
  start: number;
}

/** A ground warning shown while something winds up. */
export interface Telegraph {
  id: number;
  team: Team;
  shape: 'line' | 'cone' | 'circle';
  pos: Vec2;
  /** Angle in radians (lines and cones). */
  dir: number;
  length: number;
  /** Line width, or cone angle in radians. */
  width: number;
  start: number;
  end: number;
}

/** A damage event, kept briefly for the HUD's floating damage numbers (display only). */
export interface Hit {
  /** Increases by one per hit, so readers can tell which they've already seen. */
  seq: number;
  tick: number;
  sourceId: number | null;
  /** The source's kind, kept because dead minions leave the world. */
  sourceKind: UnitKind | null;
  targetId: number;
  /** The target's kind and where it stood, kept because a minion killed by the hit leaves the world. */
  targetKind: UnitKind;
  at: Vec2;
  /** Damage dealt, including anything a shield absorbed. */
  amount: number;
  /** The part that counted: overkill on the killing blow left out (for recaps). */
  effective: number;
  attack: boolean;
  /** Damage over time and on-hit extras (burns, stings, procs). */
  proc: boolean;
  /** The ability it came from, if any. */
  slot?: Slot;
}

/** A champion death, for the kill banner. */
export interface ChampionKill {
  tick: number;
  victimId: number;
  /** The champion credited with it, or null (a tower or minion finished them). */
  killerId: number | null;
  /** What landed the killing blow when it wasn't a champion. */
  executedBy: 'tower' | 'minion' | null;
}

/** One-shot visual events for the renderer (swings, blinks, detonations). */
export interface Fx {
  tick: number;
  kind: 'swing' | 'blink' | 'detonate' | 'echoHit' | 'rewind' | 'levelUp' | 'dashHit' | 'splash' | 'erupt' | 'bloom' | 'ignite' | 'ghost' | 'barrier' | 'rage' | 'triangulate' | 'bellow' | 'slam' | 'bind';
  pos: Vec2;
  dir?: number;
  radius?: number;
  angle?: number;
  team: Team;
}

/**
 * Everything a controller can ask its champion to do. Human input and the CPU bot both produce
 * these, so swapping one for the other (or a network peer) doesn't touch the sim.
 */
export type Command =
  | { type: 'move'; to: Vec2 }
  | { type: 'attack'; target: number }
  | { type: 'stop' }
  | { type: 'cast'; slot: Slot; at: Vec2 }
  | { type: 'levelUp'; slot: Slot }
  | { type: 'summon'; slot: SummonerSlot; at: Vec2 };

export interface Controller {
  /** Called once per tick; returns the commands for this tick. */
  think(world: import('./world').World, self: Unit): Command[];
}
