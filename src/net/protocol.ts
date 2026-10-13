import type { DuelRecap } from '../sim/recap';
import type { DuelRules, WinReason } from '../sim/rules';
import type { ChampionKill, Command, Fx, Hit, KitId, Missile, SummonerId, Team, Telegraph, Unit, Zone } from '../sim/types';
import type { World } from '../sim/world';

/**
 * Online PvP. The server (server/main.ts) runs the only real simulation; each client sends its
 * commands and draws from a snapshot of the world sent every tick. Snapshots carry render- and
 * HUD-facing state only: missiles lose their hit callbacks, and per-tick events (effects, hits,
 * kills) are sent once, as they happen.
 */

export const PVP_PORT = 8787;

/** What a player has picked in the room. */
export interface LobbyPlayer {
  team: Team;
  kit: KitId;
  summoners: [SummonerId, SummonerId];
  ready: boolean;
}

/**
 * Players don't send create or join: they connect to `/room/new` or `/room/CODE`, and the room answers
 * with a lobby message (or an error, then closes). Leaving is closing the connection.
 */
export type ClientMsg =
  | { t: 'pick'; kit: KitId; summoners: [SummonerId, SummonerId] }
  | { t: 'ready'; ready: boolean }
  /** `seq` increases with every batch; snapshots acknowledge the last one applied. */
  | { t: 'cmds'; seq: number; cmds: Command[] };

export type ServerMsg =
  | { t: 'lobby'; code: string; you: Team; players: LobbyPlayer[] }
  | { t: 'start'; seed: number; rules: DuelRules; you: number; foe: number; snap: Snapshot }
  | { t: 'snap'; snap: Snapshot }
  /** The duel is over. `left`: the opponent disconnected (you win). Afterwards the room is back in the lobby. */
  | { t: 'end'; winner: Team | null; reason: WinReason | null; left: boolean; recap: DuelRecap }
  | { t: 'error'; message: string };

/** A missile as the client sees it: no hit logic. */
export type MissileSnap = Omit<Missile, 'canHit' | 'onHit' | 'onEnd'>;

export interface Snapshot {
  tick: number;
  /** The last command batch of yours the server has applied (client-side prediction replays the rest). */
  ack: number;
  winner: Team | null;
  winReason: WinReason | null;
  units: Unit[];
  missiles: MissileSnap[];
  zones: Zone[];
  telegraphs: Telegraph[];
  /** Only what happened since the previous snapshot. */
  fx: Fx[];
  hits: Hit[];
  kills: ChampionKill[];
}

/** Which per-tick events a client has already been sent. */
export interface SnapCursor {
  fxTick: number;
  hitSeq: number;
  kills: number;
}

export const newCursor = (): SnapCursor => ({ fxTick: -1, hitSeq: 0, kills: 0 });

/** Server side: the world as one client should see it next, advancing that client's cursor. */
export function takeSnapshot(world: World, cursor: SnapCursor, ack = 0): Snapshot {
  const fx = world.fx.filter((f) => f.tick > cursor.fxTick);
  const hits = world.hits.filter((h) => h.seq > cursor.hitSeq);
  const kills = world.championKills.slice(cursor.kills);
  cursor.fxTick = world.tick - 1; // effects are stamped with the tick they happened on
  if (fx.length) cursor.fxTick = Math.max(cursor.fxTick, ...fx.map((f) => f.tick));
  if (hits.length) cursor.hitSeq = hits[hits.length - 1].seq;
  cursor.kills = world.championKills.length;
  return {
    tick: world.tick,
    ack,
    winner: world.winner,
    winReason: world.winReason,
    units: world.units,
    missiles: world.missiles.map(({ canHit: _c, onHit: _h, onEnd: _e, ...m }) => m),
    zones: world.zones,
    telegraphs: world.telegraphs,
    fx,
    hits,
    kills,
  };
}

const noHit = () => false;

/** Replace an array's contents in place (the world's arrays are readonly references). */
function refill<T>(arr: T[], items: T[]) {
  arr.length = 0;
  for (const i of items) arr.push(i);
}

/**
 * Client side: make `world` (never stepped) look like the server's. Units keep their object identity,
 * so references held by the HUD (your champion, the opponent) stay valid.
 */
export function applySnapshot(world: World, snap: Snapshot) {
  world.tick = snap.tick;
  world.winner = snap.winner;
  world.winReason = snap.winReason;
  const byId = new Map(world.units.map((u) => [u.id, u]));
  const next: Unit[] = [];
  for (const s of snap.units) {
    const u = byId.get(s.id);
    if (u) {
      Object.assign(u, s);
      next.push(u);
    } else next.push(s);
  }
  refill(world.units, next);
  refill(world.missiles, snap.missiles.map((m) => ({ ...m, canHit: noHit, onHit: noHit })));
  refill(world.zones, snap.zones);
  refill(world.telegraphs, snap.telegraphs);
  for (const f of snap.fx) world.fx.push(f);
  while (world.fx.length && world.fx[0].tick < snap.tick - 90) world.fx.shift();
  for (const h of snap.hits) world.hits.push(h);
  while (world.hits.length && world.hits[0].tick < snap.tick - 30) world.hits.shift();
  for (const k of snap.kills) world.championKills.push(k);
}
