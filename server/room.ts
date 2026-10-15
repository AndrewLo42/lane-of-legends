/**
 * One PvP room, whatever hosts it: the Node server (server/main.ts) keeps many in a map, a Cloudflare
 * Durable Object (worker/index.ts) holds exactly one. Players pick and ready up in the lobby, then the
 * room runs an authoritative 1v1 duel stepped at 30 Hz with a snapshot to each player every tick.
 */
import { RELIC_SECONDS, SEAT_GRACE, newCursor, takeSnapshot, type ClientMsg, type LobbyPlayer, type ServerMsg, type SnapCursor } from '../src/net/protocol';
import { STARTER_ITEMS } from '../src/sim/items';
import { KIT_IDS } from '../src/sim/kits';
import { duelRecap } from '../src/sim/recap';
import { DUEL_RULES } from '../src/sim/rules';
import { SIGNATURE_SUMMONERS, SUMMONER_IDS } from '../src/sim/summoners';
import type { AugmentId, Command, Controller, KitId, SummonerId, Team, Unit } from '../src/sim/types';
import { DT } from '../src/sim/util';
import { World } from '../src/sim/world';

/** A player's connection, as the room needs it. */
export interface Socket {
  send(data: string): void;
  close(): void;
}

/** Feeds a player's commands to their champion: whatever arrived since the last tick. */
class NetController implements Controller {
  queue: Command[] = [];
  /** The newest command batch received, and the newest applied (acknowledged in snapshots). */
  received = 0;
  applied = 0;
  think() {
    this.applied = this.received;
    return this.queue.splice(0);
  }
}

interface Player extends LobbyPlayer {
  socket: Socket;
  /** Secret to this player: proves it's them reconnecting. */
  token: string;
  controller: NetController;
  unit?: Unit;
  cursor: SnapCursor;
  /** Mid-duel drop: when their held seat runs out (performance.now() ms), or null while connected. */
  goneUntil: number | null;
  /** With relics on: the three offered before the duel, and the one chosen. */
  offer: AugmentId[];
  relic: AugmentId | null;
}

const shuffled = <T>(xs: readonly T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O (they read as 1 and 0)
export const newCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
export const validCode = (code: string) => /^[A-Z]{4}$/.test(code);

export class Room {
  players: Player[] = [];
  private world: World | null = null;
  private seed = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Room setting: each player picks a relic before every duel. And the pick in progress, if any. */
  private relics = false;
  private picking: ReturnType<typeof setTimeout> | null = null;

  /** `onEmpty`: the last player has gone (including a held seat running out), so the host can drop the room. */
  constructor(readonly code: string, private onEmpty: () => void = () => {}) {}

  get empty() {
    return this.players.length === 0;
  }

  /** Someone has dropped mid-duel and their seat is held: the duel is paused. */
  private get paused() {
    return this.players.some((p) => p.goneUntil != null);
  }

  /** Seat a new connection, or turn it away (with an error message) if the room is full. */
  add(socket: Socket) {
    if (this.players.length >= 2) {
      send(socket, { t: 'error', message: 'That room is full.' });
      socket.close();
      return;
    }
    const team: Team = this.players.some((p) => p.team === 'blue') ? 'red' : 'blue';
    const kit: KitId = team === 'blue' ? 'arlo' : 'tock';
    const token = crypto.randomUUID();
    this.players.push({ socket, token, team, kit, summoners: SIGNATURE_SUMMONERS[kit], ready: false, controller: new NetController(), cursor: newCursor(), goneUntil: null, offer: [], relic: null });
    send(socket, { t: 'seat', token });
    this.lobbyUpdate();
  }

  /** A player back after a drop, with their seat token: back into the duel where it was paused. */
  rejoin(socket: Socket, token: string) {
    const p = this.players.find((o) => o.token === token);
    if (!p || !this.world || !p.unit) {
      send(socket, { t: 'error', message: 'That duel is over.' });
      socket.close();
      return;
    }
    if (p.socket !== socket) p.socket.close(); // a connection that went quiet without closing
    p.socket = socket;
    p.goneUntil = null;
    p.cursor = newCursor();
    const foe = this.players.find((o) => o !== p)!;
    send(socket, { t: 'resume', seed: this.seed, rules: this.world.rules, you: p.unit.id, foe: foe.unit!.id, snap: takeSnapshot(this.world, p.cursor, p.controller.applied) });
    this.peerUpdate();
  }

  /** A message from one of the players (raw text off the wire; anything malformed is ignored). */
  message(socket: Socket, data: string) {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(data) as ClientMsg;
    } catch {
      return;
    }
    const me = this.players.find((p) => p.socket === socket);
    if (!me || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'pick':
        if (this.world || this.picking || !KIT_IDS.includes(msg.kit) || !validSpells(msg.summoners)) return;
        me.kit = msg.kit;
        me.summoners = msg.summoners;
        me.ready = false;
        return this.lobbyUpdate();
      case 'ready':
        if (this.world || this.picking) return;
        me.ready = !!msg.ready;
        this.lobbyUpdate();
        if (this.players.length === 2 && this.players.every((p) => p.ready)) {
          if (this.relics) this.offerRelics();
          else this.startDuel();
        }
        return;
      case 'relics':
        if (this.world || this.picking) return;
        this.relics = !!msg.on;
        for (const p of this.players) p.ready = false;
        return this.lobbyUpdate();
      case 'relic':
        if (!this.picking || me.relic || !me.offer.includes(msg.id)) return;
        me.relic = msg.id;
        if (this.players.every((p) => p.relic)) this.startDuel();
        else this.lobbyUpdate();
        return;
      case 'cmds':
        // Only ever their own champion, and only commands the sim understands.
        if (!this.world || !Array.isArray(msg.cmds)) return;
        for (const c of msg.cmds.slice(0, 20)) if (validCommand(c)) me.controller.queue.push(c);
        if (Number.isInteger(msg.seq) && msg.seq > me.controller.received) me.controller.received = msg.seq;
        return;
    }
  }

  /**
   * A player's connection closed. In the lobby they're gone; mid-duel their seat is held for
   * SEAT_GRACE seconds with the duel paused, and if they don't come back the other player wins by forfeit.
   */
  leave(socket: Socket) {
    const p = this.players.find((o) => o.socket === socket);
    if (!p) return;
    if (this.world) {
      p.goneUntil = performance.now() + SEAT_GRACE * 1000;
      p.controller.queue.length = 0;
      this.peerUpdate();
      return;
    }
    if (this.picking) {
      // Someone left while choosing relics: back to the lobby.
      clearTimeout(this.picking);
      this.picking = null;
      for (const o of this.players) o.ready = false;
    }
    this.remove(p);
    this.lobbyUpdate();
  }

  /** Relics on and both ready: each player gets three to choose from, and a random one if time runs out. */
  private offerRelics() {
    for (const p of this.players) {
      p.offer = shuffled(STARTER_ITEMS).slice(0, 3);
      p.relic = null;
      send(p.socket, { t: 'relicOffer', offer: p.offer, seconds: RELIC_SECONDS });
    }
    this.picking = setTimeout(() => {
      for (const p of this.players) p.relic ??= p.offer[Math.floor(Math.random() * p.offer.length)];
      this.startDuel();
    }, RELIC_SECONDS * 1000);
    this.lobbyUpdate();
  }

  private remove(p: Player) {
    this.players = this.players.filter((o) => o !== p);
    if (this.empty) this.onEmpty();
  }

  /** Tell everyone connected whether the other player is there (and how long the seat is held). */
  private peerUpdate() {
    const now = performance.now();
    for (const p of this.players) {
      if (p.goneUntil != null) continue;
      const other = this.players.find((o) => o !== p);
      const wait = other?.goneUntil != null ? Math.max(0, Math.ceil((other.goneUntil - now) / 1000)) : 0;
      send(p.socket, { t: 'peer', connected: other?.goneUntil == null, wait });
    }
  }

  private lobbyUpdate() {
    const picking = !!this.picking;
    const players = this.players.map(({ team, kit, summoners, ready, relic }) => ({ team, kit, summoners, ready, ...(picking ? { picked: !!relic } : {}) }));
    for (const p of this.players) send(p.socket, { t: 'lobby', code: this.code, you: p.team, players, relics: this.relics, picking });
  }

  private startDuel() {
    if (this.picking) clearTimeout(this.picking);
    this.picking = null;
    const seed = Math.floor(Math.random() * 1e9);
    const rules = { ...DUEL_RULES };
    this.seed = seed;
    const world = (this.world = new World(seed, rules));
    for (const p of this.players) {
      p.controller = new NetController(); // fresh queue and command acks for each duel
      p.unit = world.spawnChampion(p.team, p.kit, p.controller, { summoners: p.summoners, items: this.relics && p.relic ? [p.relic] : [] });
      p.offer = [];
      p.relic = null;
      p.cursor = newCursor();
    }
    for (const p of this.players) {
      const foe = this.players.find((o) => o !== p)!;
      send(p.socket, { t: 'start', seed, rules, you: p.unit!.id, foe: foe.unit!.id, snap: takeSnapshot(world, p.cursor, p.controller.applied) });
    }
    // Step on a fixed clock, catching up if the timer runs late.
    let next = performance.now();
    let peerAt = 0;
    this.timer = setInterval(() => {
      const now = performance.now();
      if (this.paused) {
        // Hold the world still; tell the other player about once a second (it doubles as a heartbeat).
        next = now;
        const expired = this.players.find((p) => p.goneUntil != null && now >= p.goneUntil);
        if (expired) {
          this.remove(expired);
          return this.endDuel(true);
        }
        if (now - peerAt >= 1000) {
          peerAt = now;
          this.peerUpdate();
        }
        return;
      }
      let steps = 0;
      while (now >= next && steps < 5) {
        world.step();
        next += DT * 1000;
        steps++;
      }
      if (steps === 0) return;
      if (now - next > 1000) next = now; // stalled for a long time: don't fast-forward
      for (const p of this.players) send(p.socket, { t: 'snap', snap: takeSnapshot(world, p.cursor, p.controller.applied) });
      if (world.winner) this.endDuel(false);
    }, 5);
  }

  /** Send the players their recap and put the room back in the lobby for a rematch (without anyone still away). */
  private endDuel(left: boolean) {
    const world = this.world;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.world = null;
    if (!world) return;
    for (const p of this.players) {
      const foe = this.players.find((o) => o !== p)?.unit ?? world.champions().find((c) => c !== p.unit)!;
      send(p.socket, {
        t: 'end', winner: left ? p.team : world.winner, reason: left ? null : world.winReason, left,
        recap: duelRecap(world, p.unit!, foe),
      });
      p.ready = false;
    }
    for (const p of this.players.filter((o) => o.goneUntil != null)) this.remove(p);
    this.lobbyUpdate();
  }
}

export function send(socket: Socket, msg: ServerMsg) {
  socket.send(JSON.stringify(msg));
}

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const point = (p: unknown) => !!p && num((p as { x: unknown }).x) && num((p as { y: unknown }).y);

/** A command a client may send: well-formed, so nothing malformed reaches the sim. */
function validCommand(c: unknown): c is Command {
  if (!c || typeof c !== 'object') return false;
  const cmd = c as Record<string, unknown>;
  const slot = (max: number) => Number.isInteger(cmd.slot) && (cmd.slot as number) >= 0 && (cmd.slot as number) <= max;
  switch (cmd.type) {
    case 'move': return point(cmd.to);
    case 'attack': return Number.isInteger(cmd.target);
    case 'stop': return true;
    case 'cast': return slot(3) && point(cmd.at);
    case 'release': return slot(3) && point(cmd.at);
    case 'levelUp': return slot(3);
    case 'summon': return slot(1) && point(cmd.at);
    default: return false;
  }
}

const validSpells = (s: unknown): s is [SummonerId, SummonerId] =>
  Array.isArray(s) && s.length === 2 && s[0] !== s[1] && s.every((id) => SUMMONER_IDS.includes(id));
