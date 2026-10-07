import { Rng } from '../core/rng';
import { AUGMENTS, AUGMENT_IDS, type AugmentTier } from '../sim/augments';
import { KIT_IDS } from '../sim/kits';
import { DUEL_RULES, type DuelRules, type WinReason } from '../sim/rules';
import type { AugmentId, KitId } from '../sim/types';

/** A lane rule change for one floor. */
export interface Modifier {
  id: string;
  name: string;
  icon: string;
  describe: string;
  apply: (r: DuelRules) => void;
}

export const MODIFIERS: Modifier[] = [
  { id: 'rush', name: 'Rush Hour', icon: '🌊', describe: 'Minion waves every 15s.', apply: (r) => (r.waveInterval = 15) },
  { id: 'glass', name: 'Glass Towers', icon: '🧊', describe: 'Towers have half health. The first tower comes fast.', apply: (r) => (r.towerHpMult *= 0.5) },
  { id: 'blood', name: 'Bloodlust', icon: '🩸', describe: 'First blood wins the duel.', apply: (r) => (r.killsToWin = 1) },
  { id: 'overcharged', name: 'Overcharged', icon: '⚡', describe: 'Everyone gets 40 ability haste.', apply: (r) => (r.haste += 40) },
  {
    id: 'goldrush', name: 'Gold Rush', icon: '💰', describe: 'Minions give 50% more gold and XP, but the CS goal rises by 15.',
    apply: (r) => {
      r.xpMult *= 1.5;
      r.goldMult *= 1.5;
      r.csToWin += 15;
    },
  },
];

interface FloorDef {
  title: string;
  /** Bot skillshot accuracy (0..1). */
  accuracy: number;
  /** Opponent base HP/damage multiplier. */
  statMult: number;
  /** Augments the opponent brings, by tier. */
  enemyAugments: AugmentTier[];
  /** Tier of the augment you pick after winning (null = last floor). */
  reward: AugmentTier | null;
}

export const FLOORS: FloorDef[] = [
  { title: 'Rookie', accuracy: 0.55, statMult: 1, enemyAugments: [], reward: 'silver' },
  { title: 'Contender', accuracy: 0.68, statMult: 1, enemyAugments: ['silver'], reward: 'gold' },
  { title: 'Veteran', accuracy: 0.78, statMult: 1.05, enemyAugments: ['silver', 'gold'], reward: 'gold' },
  { title: 'Champion', accuracy: 0.87, statMult: 1.1, enemyAugments: ['silver', 'gold', 'gold'], reward: 'prismatic' },
  { title: 'Legend', accuracy: 0.95, statMult: 1.15, enemyAugments: ['silver', 'gold', 'gold', 'prismatic'], reward: null },
];

export interface DuelResult {
  floor: number;
  won: boolean;
  reason: WinReason | null;
  opponent: KitId;
  seconds: number;
}

export interface RunState {
  version: 1;
  seed: number;
  kit: KitId;
  /** 0-based index into FLOORS of the next duel. */
  floor: number;
  augments: AugmentId[];
  rerolls: number;
  /** Bumped by rerolls so the next offer differs. */
  offerRoll: number;
  results: DuelResult[];
  /** A won duel whose augment hasn't been picked yet (so a reload resumes at the pick, not the fight). */
  pending?: DuelResult;
}

export interface FloorPlan {
  floor: number;
  title: string;
  opponent: KitId;
  opponentAugments: AugmentId[];
  accuracy: number;
  statMult: number;
  modifier: Modifier | null;
  rules: DuelRules;
  /** World seed for the duel. */
  seed: number;
}

const shuffle = <T>(rng: Rng, xs: T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const ofTier = (tier: AugmentTier) => AUGMENT_IDS.filter((id) => AUGMENTS[id].tier === tier);

export function newRun(kit: KitId, seed: number): RunState {
  return { version: 1, seed, kit, floor: 0, augments: [], rerolls: 1, offerRoll: 0, results: [] };
}

/** Everything about the next duel, derived from the run seed so a resumed run sees the same floor. */
export function floorPlan(run: RunState): FloorPlan {
  const def = FLOORS[run.floor];
  const rng = new Rng(run.seed * 7919 + run.floor * 104729 + 17);
  const opponent = KIT_IDS[rng.int(0, KIT_IDS.length - 1)];
  const opponentAugments: AugmentId[] = [];
  for (const tier of def.enemyAugments) {
    const pool = ofTier(tier).filter((id) => !opponentAugments.includes(id));
    opponentAugments.push(pool[rng.int(0, pool.length - 1)]);
  }
  // Each run deals the modifiers out in its own order, so floors 2-5 never repeat one.
  const order = shuffle(new Rng(run.seed * 31 + 7), MODIFIERS);
  const modifier = run.floor === 0 ? null : order[(run.floor - 1) % order.length];
  const rules = { ...DUEL_RULES };
  modifier?.apply(rules);
  return {
    floor: run.floor, title: def.title, opponent, opponentAugments, accuracy: def.accuracy, statMult: def.statMult, modifier, rules,
    seed: (run.seed * 131 + run.floor * 977) % 1e9,
  };
}

/** Three augments of this floor's reward tier that you don't own yet (topped up from other tiers if needed). */
export function augmentOffers(run: RunState): AugmentId[] {
  const tier = FLOORS[run.floor].reward;
  if (!tier) return [];
  const rng = new Rng(run.seed * 4099 + run.floor * 613 + run.offerRoll * 7907);
  const fresh = (ids: AugmentId[]) => ids.filter((id) => !run.augments.includes(id));
  const pool = shuffle(rng, fresh(ofTier(tier)));
  const backup = shuffle(rng, fresh(AUGMENT_IDS.filter((id) => AUGMENTS[id].tier !== tier)));
  return [...pool, ...backup].slice(0, 3);
}

export function reroll(run: RunState) {
  if (run.rerolls <= 0) return false;
  run.rerolls--;
  run.offerRoll++;
  return true;
}

/** Record a duel win and the augment picked for it, and advance to the next floor. */
export function advance(run: RunState, result: DuelResult, pick: AugmentId | null) {
  run.pending = undefined;
  run.results.push(result);
  if (pick) run.augments.push(pick);
  run.floor++;
  run.offerRoll = 0;
}

export const isFinalFloor = (run: RunState) => run.floor === FLOORS.length - 1;

// ---------- persistence (browser only; every access is guarded) ----------

const RUN_KEY = 'lane-rogue.run.v1';
const META_KEY = 'lane-rogue.meta.v1';

export interface Meta {
  runs: number;
  wins: number;
  /** Highest floor reached (1-based) per champion. */
  best: Partial<Record<KitId, number>>;
}

export function saveRun(run: RunState | null) {
  try {
    if (run) localStorage.setItem(RUN_KEY, JSON.stringify(run));
    else localStorage.removeItem(RUN_KEY);
  } catch {
    /* storage unavailable: runs just don't resume */
  }
}

export function loadRun(): RunState | null {
  try {
    const run = JSON.parse(localStorage.getItem(RUN_KEY) ?? 'null') as RunState | null;
    if (run?.version === 1 && KIT_IDS.includes(run.kit) && run.floor < FLOORS.length && run.augments.every((a) => AUGMENTS[a])) return run;
  } catch {
    /* corrupt or unavailable */
  }
  return null;
}

export function loadMeta(): Meta {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) ?? 'null') as Meta | null;
    if (m && typeof m.runs === 'number') return m;
  } catch {
    /* fall through */
  }
  return { runs: 0, wins: 0, best: {} };
}

/** Update lifetime stats when a run ends. */
export function recordRunEnd(run: RunState, won: boolean): Meta {
  const meta = loadMeta();
  meta.runs++;
  if (won) meta.wins++;
  const reached = won ? FLOORS.length : run.floor + 1;
  meta.best[run.kit] = Math.max(meta.best[run.kit] ?? 0, reached);
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* ignore */
  }
  return meta;
}
