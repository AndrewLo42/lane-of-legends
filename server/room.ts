/**
 * One PvP room, whatever hosts it: the Node server (server/main.ts) keeps many in a map, a Cloudflare
 * Durable Object (worker/index.ts) holds exactly one. Players pick and ready up in the lobby, then the
 * room runs an authoritative 1v1 duel stepped at 30 Hz with a snapshot to each player every tick.
 */
import { newCursor, takeSnapshot, type ClientMsg, type LobbyPlayer, type ServerMsg, type SnapCursor } from '../src/net/protocol';
import { KIT_IDS } from '../src/sim/kits';
import { duelRecap } from '../src/sim/recap';
import { DUEL_RULES } from '../src/sim/rules';
import { SIGNATURE_SUMMONERS, SUMMONER_IDS } from '../src/sim/summoners';
import type { Command, Controller, KitId, SummonerId, Team, Unit } from '../src/sim/types';
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
  controller: NetController;
  unit?: Unit;
  cursor: SnapCursor;
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O (they read as 1 and 0)
export const newCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
export const validCode = (code: string) => /^[A-Z]{4}$/.test(code);

export class Room {
  players: Player[] = [];
  private world: World | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(readonly code: string) {}

  get empty() {
    return this.players.length === 0;
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
    this.players.push({ socket, team, kit, summoners: SIGNATURE_SUMMONERS[kit], ready: false, controller: new NetController(), cursor: newCursor() });
    this.lobbyUpdate();
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
        if (this.world || !KIT_IDS.includes(msg.kit) || !validSpells(msg.summoners)) return;
        me.kit = msg.kit;
        me.summoners = msg.summoners;
        me.ready = false;
        return this.lobbyUpdate();
      case 'ready':
        if (this.world) return;
        me.ready = !!msg.ready;
        this.lobbyUpdate();
        if (this.players.length === 2 && this.players.every((p) => p.ready)) this.startDuel();
        return;
      case 'cmds':
        // Only ever their own champion, and only commands the sim understands.
        if (!this.world || !Array.isArray(msg.cmds)) return;
        for (const c of msg.cmds.slice(0, 20)) if (validCommand(c)) me.controller.queue.push(c);
        if (Number.isInteger(msg.seq) && msg.seq > me.controller.received) me.controller.received = msg.seq;
        return;
    }
  }

  /** A player's connection closed. If a duel was on, whoever's left wins by forfeit. */
  leave(socket: Socket) {
    if (!this.players.some((p) => p.socket === socket)) return;
    this.players = this.players.filter((p) => p.socket !== socket);
    if (this.world) this.endDuel(true);
    else this.lobbyUpdate();
  }

  private lobbyUpdate() {
    const players = this.players.map(({ team, kit, summoners, ready }) => ({ team, kit, summoners, ready }));
    for (const p of this.players) send(p.socket, { t: 'lobby', code: this.code, you: p.team, players });
  }

  private startDuel() {
    const seed = Math.floor(Math.random() * 1e9);
    const rules = { ...DUEL_RULES };
    const world = (this.world = new World(seed, rules));
    for (const p of this.players) {
      p.controller = new NetController(); // fresh queue and command acks for each duel
      p.unit = world.spawnChampion(p.team, p.kit, p.controller, { summoners: p.summoners });
      p.cursor = newCursor();
    }
    for (const p of this.players) {
      const foe = this.players.find((o) => o !== p)!;
      send(p.socket, { t: 'start', seed, rules, you: p.unit!.id, foe: foe.unit!.id, snap: takeSnapshot(world, p.cursor, p.controller.applied) });
    }
    // Step on a fixed clock, catching up if the timer runs late.
    let next = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
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

  /** Send the players their recap and put the room back in the lobby for a rematch. */
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
    case 'levelUp': return slot(3);
    case 'summon': return slot(1) && point(cmd.at);
    default: return false;
  }
}

const validSpells = (s: unknown): s is [SummonerId, SummonerId] =>
  Array.isArray(s) && s.length === 2 && s[0] !== s[1] && s.every((id) => SUMMONER_IDS.includes(id));
