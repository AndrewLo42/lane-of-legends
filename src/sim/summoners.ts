import type { KitId, SummonerId, SummonerState, Unit, Vec2 } from './types';
import { dirTo, dist, gap, ticks } from './util';
import type { Aim } from './kits/types';
import type { World } from './world';

/** Self-cast spells show a small circle on the caster while the key is held. */
const SELF: Aim = { shape: 'circle', range: 0, radius: 1 };

export interface SummonerDef {
  id: SummonerId;
  name: string;
  icon: string;
  /** Seconds. Much shorter than League's: a duel lasts a few minutes, so each gets used once or twice. */
  cooldown: number;
  /** Drawn while the key is held, like an ability's. */
  aim: Aim;
  describe: (self: Unit) => string;
  /** Returns false if nothing happened (no target), so no cooldown is spent. */
  cast: (world: World, self: Unit, at: Vec2, st: SummonerState) => boolean;
  /** Pressing again while `recastUntil` is open (Tether's dash). Free: the cooldown already started. */
  recast?: (world: World, self: Unit, at: Vec2, st: SummonerState) => boolean;
}

export const FLASH = { range: 4 };
export const IGNITE = { range: 6, seconds: 5, base: 60, perLevel: 18, grievous: 0.5 };
export const GHOST = { speed: 0.35, seconds: 6 };
export const BARRIER = { base: 90, perLevel: 22, seconds: 2.5 };
export const TETHER = { range: 11, width: 0.6, speed: 24, window: 3, dashSpeed: 26, base: 15, perLevel: 5, missCooldown: 20 };
export const RAGE = { seconds: 6, ad: 10, adPerLevel: 2, attackSpeed: 0.35 };

const level = (u: Unit) => u.champ!.level;

/** The enemy champion Ignite would land on when aimed at `at`: nearest the cursor, within range. */
export function igniteTarget(world: World, self: Unit, at: Vec2): Unit | undefined {
  return world
    .champions()
    .filter((c) => world.canAttack(self, c) && gap(self, c) <= IGNITE.range)
    .sort((a, b) => dist(a.pos, at) - dist(b.pos, at))[0];
}

const LIST: SummonerDef[] = [
  {
    id: 'flash', name: 'Flash', icon: '✦', cooldown: 75, aim: { shape: 'dash', range: FLASH.range },
    describe: () => `Blink up to ${FLASH.range} units toward the cursor. Works while rooted and mid-cast.`,
    cast: (w, self, at) => {
      w.blink(self, at, FLASH.range);
      return true;
    },
  },
  {
    id: 'ignite', name: 'Ignite', icon: '🔥', cooldown: 75, aim: { shape: 'target', range: IGNITE.range },
    describe: (self) =>
      `Set the enemy champion ablaze for ${Math.round(IGNITE.base + IGNITE.perLevel * level(self))} damage over ${IGNITE.seconds}s. ` +
      `They heal ${IGNITE.grievous * 100}% less while burning.`,
    cast: (w, self, at) => {
      const t = igniteTarget(w, self, at);
      if (!t) return false;
      const total = IGNITE.base + IGNITE.perLevel * level(self);
      w.addStatus(t, { kind: 'burn', value: total / IGNITE.seconds, sourceId: self.id, seconds: IGNITE.seconds });
      w.addStatus(t, { kind: 'grievous', value: IGNITE.grievous, sourceId: self.id, seconds: IGNITE.seconds });
      w.addFx({ kind: 'ignite', pos: t.pos, team: self.team });
      return true;
    },
  },
  {
    id: 'ghost', name: 'Ghost', icon: '👻', cooldown: 60, aim: SELF,
    describe: () => `Move ${GHOST.speed * 100}% faster for ${GHOST.seconds}s.`,
    cast: (w, self) => {
      w.addStatus(self, { kind: 'haste', value: GHOST.speed, sourceId: self.id, seconds: GHOST.seconds });
      w.addFx({ kind: 'ghost', pos: self.pos, team: self.team });
      return true;
    },
  },
  {
    id: 'barrier', name: 'Barrier', icon: '🛡', cooldown: 70, aim: SELF,
    describe: (self) => `Shield yourself from ${Math.round(BARRIER.base + BARRIER.perLevel * level(self))} damage for ${BARRIER.seconds}s.`,
    cast: (w, self) => {
      w.addStatus(self, { kind: 'shield', value: BARRIER.base + BARRIER.perLevel * level(self), sourceId: self.id, seconds: BARRIER.seconds });
      w.addFx({ kind: 'barrier', pos: self.pos, team: self.team });
      return true;
    },
  },
  {
    id: 'tether', name: 'Tether', icon: '🪝', cooldown: 60, aim: { shape: 'line', length: TETHER.range, width: TETHER.width },
    describe: (self) =>
      `Throw a line that tags the first enemy hit. Cast again within ${TETHER.window}s to dash to it, dealing ` +
      `${Math.round(TETHER.base + TETHER.perLevel * level(self))} damage. A miss puts it on a ${TETHER.missCooldown}s cooldown.`,
    cast: (w, self, at, st) => {
      const thrown = w.tick;
      let landed = false;
      w.fireLine(self, {
        style: 'tether', dir: dirTo(self.pos, at), speed: TETHER.speed, range: TETHER.range, width: TETHER.width,
        canHit: (u) => u.kind === 'minion' || u.kind === 'champion',
        onHit: (t) => {
          landed = true;
          w.addStatus(t, { kind: 'tether', value: 1, sourceId: self.id, seconds: TETHER.window });
          st.recastUntil = w.tick + ticks(TETHER.window);
        },
      });
      // A miss only costs a short cooldown.
      w.after(TETHER.range / TETHER.speed + 0.1, () => {
        if (!landed) st.readyAt = thrown + ticks(TETHER.missCooldown);
      });
      return true;
    },
    recast: (w, self) => {
      const tagged = w.units.find((u) => !u.dead && w.status(u, 'tether', self.id));
      if (!tagged) return false;
      w.removeStatus(tagged, w.status(tagged, 'tether', self.id)!);
      w.dash(self, tagged.pos, TETHER.dashSpeed, undefined, () => {
        if (!tagged.dead && gap(self, tagged) <= 1.5) w.dealDamage(self, tagged, TETHER.base + TETHER.perLevel * level(self), { proc: true });
      });
      return true;
    },
  },
  {
    id: 'rage', name: 'Rage', icon: '😤', cooldown: 60, aim: SELF,
    describe: (self) =>
      `For ${RAGE.seconds}s, gain ${Math.round(RAGE.ad + RAGE.adPerLevel * level(self))} attack damage and ${RAGE.attackSpeed * 100}% attack speed.`,
    cast: (w, self) => {
      w.addStatus(self, { kind: 'rage', value: RAGE.ad + RAGE.adPerLevel * level(self), sourceId: self.id, seconds: RAGE.seconds });
      w.addFx({ kind: 'rage', pos: self.pos, team: self.team });
      return true;
    },
  },
];

export const SUMMONERS = Object.fromEntries(LIST.map((s) => [s.id, s])) as Record<SummonerId, SummonerDef>;
export const SUMMONER_IDS = LIST.map((s) => s.id);
export const DEFAULT_SUMMONERS: [SummonerId, SummonerId] = ['flash', 'ignite'];

/** Each champion's signature pair: what the CPU takes (and a sensible first pick for players). */
export const SIGNATURE_SUMMONERS: Record<KitId, [SummonerId, SummonerId]> = {
  arlo: ['flash', 'barrier'],
  tock: ['flash', 'ignite'],
  maren: ['flash', 'ignite'],
  lisha: ['flash', 'ghost'],
  mabel: ['flash', 'barrier'],
  aurelle: ['flash', 'ghost'],
  gormund: ['ghost', 'ignite'],
};
