import type { DuelRecap } from '../sim/recap';
import type { DuelRules, WinReason } from '../sim/rules';
import type { AugmentId, ChampionKill, Command, Fx, Hit, KitId, Missile, SummonerId, Team, Telegraph, Unit, Zone } from '../sim/types';
import type { World } from '../sim/world';

/**
 * Online PvP. The server (server/main.ts) runs the only real simulation; each client sends its
 * commands and draws from a snapshot of the world sent every tick. Snapshots carry render- and
 * HUD-facing state only, and only what changed since that client's last one: missiles lose their hit
 * callbacks, and per-tick events (effects, hits, kills) are sent once, as they happen.
 */

export const PVP_PORT = 8787;

/** How long a dropped player's seat is held (the duel paused) before it counts as leaving. */
export const SEAT_GRACE = 30;

/** What a player has picked in the room. */
export interface LobbyPlayer {
  team: Team;
  kit: KitId;
  summoners: [SummonerId, SummonerId];
  ready: boolean;
  /** While relics are being picked: whether they've chosen theirs (not which). */
  picked?: boolean;
}

/** With relics on, how long players have to choose one before it's picked for them. */
export const RELIC_SECONDS = 20;

/**
 * Players don't send create or join: they connect to `/room/new` or `/room/CODE`, and the room answers
 * with their seat token and a lobby message (or an error, then closes). Leaving is closing the connection.
 * A player who drops mid-duel reconnects to `/room/CODE?seat=TOKEN` within `SEAT_GRACE` seconds.
 */
export type ClientMsg =
  | { t: 'pick'; kit: KitId; summoners: [SummonerId, SummonerId] }
  | { t: 'ready'; ready: boolean }
  /** Turn relics on or off for the room (either player; unreadies both). */
  | { t: 'relics'; on: boolean }
  /** Your choice from the relic offer. */
  | { t: 'relic'; id: AugmentId }
  /** `seq` increases with every batch; snapshots acknowledge the last one applied. */
  | { t: 'cmds'; seq: number; cmds: Command[] };

export type ServerMsg =
  /** Your seat in the room: the token that lets you back into a duel after a drop. Sent on joining. */
  | { t: 'seat'; token: string }
  /** `relics`: each player picks 1 of 3 random relics before the duel; `picking`: that's happening now. */
  | { t: 'lobby'; code: string; you: Team; players: LobbyPlayer[]; relics: boolean; picking: boolean }
  /** Relics are on and both players are ready: your three to choose from. */
  | { t: 'relicOffer'; offer: AugmentId[]; seconds: number }
  | { t: 'start'; seed: number; rules: DuelRules; you: number; foe: number; snap: Snapshot }
  | { t: 'snap'; snap: Snapshot }
  /** You're back in the duel after a drop: the duel's setup (as in `start`) and the whole world as it is now. */
  | { t: 'resume'; seed: number; rules: DuelRules; you: number; foe: number; snap: Snapshot }
  /**
   * The other player dropped (the duel is paused; `wait` is the seconds left before it's a forfeit),
   * or is back. Repeated about once a second while they're away.
   */
  | { t: 'peer'; connected: boolean; wait: number }
  /** The duel is over. `left`: the opponent disconnected (you win). Afterwards the room is back in the lobby. */
  | { t: 'end'; winner: Team | null; reason: WinReason | null; left: boolean; recap: DuelRecap }
  | { t: 'error'; message: string };

/** A missile as the client sees it: no hit logic. */
export type MissileSnap = Omit<Missile, 'canHit' | 'onHit' | 'onEnd'>;

/**
 * A list of things with ids (units, missiles), sent as changes: `ids` is the whole list in order (so the
 * client drops whatever is gone), and `changed` has, for each new or changed item, its id and only the
 * fields that changed since this client's previous snapshot. A champion's `champ` (and a pet's `pet`)
 * is itself sent field by field.
 */
export interface ListDelta<T> {
  ids: number[];
  changed: (Partial<T> & { id: number })[];
}

export interface Snapshot {
  tick: number;
  /** The last command batch of yours the server has applied (client-side prediction replays the rest). */
  ack: number;
  winner: Team | null;
  winReason: WinReason | null;
  units: ListDelta<Unit>;
  missiles: ListDelta<MissileSnap>;
  /** Left out when they haven't changed since the previous snapshot. */
  zones?: Zone[];
  telegraphs?: Telegraph[];
  /** Only what happened since the previous snapshot. */
  fx: Fx[];
  hits: Hit[];
  kills: ChampionKill[];
}

/** For each item id, the encoded value of each field as last sent (nested fields as `champ.mana`). */
type Sent = Map<number, Map<string, string>>;

/** What a client has already been sent: per-tick events, and the state its world holds. A fresh cursor sends everything. */
export interface SnapCursor {
  fxTick: number;
  hitSeq: number;
  kills: number;
  units: Sent;
  missiles: Sent;
  zones: string;
  telegraphs: string;
}

export const newCursor = (): SnapCursor => ({ fxTick: -1, hitSeq: 0, kills: 0, units: new Map(), missiles: new Map(), zones: '', telegraphs: '' });

/** Fractions to 3 decimals: a millimetre of position or a thousandth of a hit point is plenty, and it's a third of the bytes. */
const rounded = (_key: string, v: unknown) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v);
/** A message as sent on the wire. */
export const encode = (msg: unknown) => JSON.stringify(msg, rounded);

/** Unit fields sent field by field, one level down. */
const NESTED = ['champ', 'pet'];

function delta<T extends { id: number }>(items: readonly T[], sent: Sent, leaveOut: readonly string[] = []): ListDelta<T> {
  const ids: number[] = [];
  const changed: ListDelta<T>['changed'] = [];
  for (const item of items) {
    ids.push(item.id);
    let mine = sent.get(item.id);
    const fresh = !mine;
    if (!mine) sent.set(item.id, (mine = new Map()));
    const out: Record<string, unknown> = {};
    let any = false;
    const check = (key: string, v: unknown) => {
      const e = encode(v);
      if (mine!.get(key) === e) return false;
      mine!.set(key, e);
      return true;
    };
    for (const [k, v] of Object.entries(item)) {
      if (v === undefined || leaveOut.includes(k)) continue;
      if (NESTED.includes(k) && v && typeof v === 'object') {
        const sub: Record<string, unknown> = {};
        let subAny = false;
        for (const [k2, v2] of Object.entries(v)) {
          if (v2 !== undefined && check(`${k}.${k2}`, v2)) {
            sub[k2] = v2;
            subAny = true;
          }
        }
        if (subAny) {
          out[k] = sub;
          any = true;
        }
      } else if (check(k, v)) {
        out[k] = v;
        any = true;
      }
    }
    if (any || fresh) changed.push({ ...out, id: item.id } as ListDelta<T>['changed'][number]);
  }
  const live = new Set(ids);
  for (const id of sent.keys()) if (!live.has(id)) sent.delete(id);
  return { ids, changed };
}

/** Server side: the world as one client should see it next (only what changed), advancing that client's cursor. */
export function takeSnapshot(world: World, cursor: SnapCursor, ack = 0): Snapshot {
  const fx = world.fx.filter((f) => f.tick > cursor.fxTick);
  const hits = world.hits.filter((h) => h.seq > cursor.hitSeq);
  const kills = world.championKills.slice(cursor.kills);
  cursor.fxTick = world.tick - 1; // effects are stamped with the tick they happened on
  if (fx.length) cursor.fxTick = Math.max(cursor.fxTick, ...fx.map((f) => f.tick));
  if (hits.length) cursor.hitSeq = hits[hits.length - 1].seq;
  cursor.kills = world.championKills.length;
  const zones = encode(world.zones);
  const telegraphs = encode(world.telegraphs);
  const snap: Snapshot = {
    tick: world.tick,
    ack,
    winner: world.winner,
    winReason: world.winReason,
    units: delta(world.units, cursor.units),
    missiles: delta<MissileSnap>(world.missiles, cursor.missiles, ['canHit', 'onHit', 'onEnd']),
    fx,
    hits,
    kills,
  };
  if (zones !== cursor.zones) snap.zones = world.zones;
  if (telegraphs !== cursor.telegraphs) snap.telegraphs = world.telegraphs;
  cursor.zones = zones;
  cursor.telegraphs = telegraphs;
  return snap;
}

const noHit = () => false;

/** Replace an array's contents in place (the world's arrays are readonly references). */
function refill<T>(arr: T[], items: T[]) {
  arr.length = 0;
  for (const i of items) arr.push(i);
}

/** Apply a list delta to `arr` in place: changed fields onto the objects already there, new items added, gone ones dropped. */
function merge<T extends { id: number }>(arr: T[], d: ListDelta<T>, added: (item: T) => T = (item) => item) {
  const byId = new Map(arr.map((x) => [x.id, x]));
  for (const c of d.changed) {
    const cur = byId.get(c.id) as Record<string, unknown> | undefined;
    if (!cur) {
      byId.set(c.id, added(c as T));
      continue;
    }
    for (const [k, v] of Object.entries(c)) {
      const inner = cur[k];
      if (NESTED.includes(k) && inner && typeof inner === 'object') Object.assign(inner, v);
      else cur[k] = v;
    }
  }
  refill(arr, d.ids.map((id) => byId.get(id)).filter((x): x is T => !!x));
}

/**
 * Client side: make `world` (never stepped) look like the server's. Units keep their object identity,
 * so references held by the HUD (your champion, the opponent) stay valid.
 */
export function applySnapshot(world: World, snap: Snapshot) {
  world.tick = snap.tick;
  world.winner = snap.winner;
  world.winReason = snap.winReason;
  merge(world.units, snap.units);
  merge(world.missiles as MissileSnap[], snap.missiles, (m) => Object.assign(m, { canHit: noHit, onHit: noHit }));
  if (snap.zones) refill(world.zones, snap.zones);
  if (snap.telegraphs) refill(world.telegraphs, snap.telegraphs);
  for (const f of snap.fx) world.fx.push(f);
  while (world.fx.length && world.fx[0].tick < snap.tick - 90) world.fx.shift();
  for (const h of snap.hits) world.hits.push(h);
  while (world.hits.length && world.hits[0].tick < snap.tick - 30) world.hits.shift();
  for (const k of snap.kills) world.championKills.push(k);
}
