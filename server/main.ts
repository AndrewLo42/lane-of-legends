/**
 * Lane Rogue PvP server: rooms with join codes, a lobby where both players pick and ready up, then
 * an authoritative 1v1 duel stepped at 30 Hz with a snapshot to each player every tick.
 *
 *   npm run server            (port 8787, or PORT=…)
 *
 * Matchmaking would sit in front of this: pair two players into a room instead of trading a code.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import { PVP_PORT, newCursor, takeSnapshot, type ClientMsg, type LobbyPlayer, type ServerMsg, type SnapCursor } from '../src/net/protocol';
import { KIT_IDS } from '../src/sim/kits';
import { duelRecap } from '../src/sim/recap';
import { DUEL_RULES } from '../src/sim/rules';
import { SIGNATURE_SUMMONERS, SUMMONER_IDS } from '../src/sim/summoners';
import type { Command, Controller, KitId, SummonerId, Team, Unit } from '../src/sim/types';
import { DT } from '../src/sim/util';
import { World } from '../src/sim/world';

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
  ws: WebSocket;
  controller: NetController;
  unit?: Unit;
  cursor: SnapCursor;
}

interface Room {
  code: string;
  players: Player[];
  world: World | null;
  timer: ReturnType<typeof setInterval> | null;
}

const rooms = new Map<string, Room>();
const roomOf = new Map<WebSocket, Room>();

/**
 * Simulated network delay for testing prediction on one machine: `LATENCY=100 npm run server` holds every
 * message for 100 ms each way (about a 200 ms ping).
 */
const LATENCY = Number(process.env.LATENCY ?? 0);
const later = (fn: () => void) => (LATENCY > 0 ? setTimeout(fn, LATENCY) : fn());

const send = (ws: WebSocket, msg: ServerMsg) => {
  const data = JSON.stringify(msg);
  later(() => ws.readyState === ws.OPEN && ws.send(data));
};

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O (they read as 1 and 0)
  for (;;) {
    const code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
    if (!rooms.has(code)) return code;
  }
}

function lobbyUpdate(room: Room) {
  const players = room.players.map(({ team, kit, summoners, ready }) => ({ team, kit, summoners, ready }));
  for (const p of room.players) send(p.ws, { t: 'lobby', code: room.code, you: p.team, players });
}

function addPlayer(room: Room, ws: WebSocket) {
  const team: Team = room.players.some((p) => p.team === 'blue') ? 'red' : 'blue';
  const kit: KitId = team === 'blue' ? 'arlo' : 'tock';
  room.players.push({ ws, team, kit, summoners: SIGNATURE_SUMMONERS[kit], ready: false, controller: new NetController(), cursor: newCursor() });
  roomOf.set(ws, room);
  lobbyUpdate(room);
}

function startDuel(room: Room) {
  const seed = Math.floor(Math.random() * 1e9);
  const rules = { ...DUEL_RULES };
  const world = (room.world = new World(seed, rules));
  for (const p of room.players) {
    p.controller = new NetController(); // fresh queue and command acks for each duel
    p.unit = world.spawnChampion(p.team, p.kit, p.controller, { summoners: p.summoners });
    p.cursor = newCursor();
  }
  for (const p of room.players) {
    const foe = room.players.find((o) => o !== p)!;
    send(p.ws, { t: 'start', seed, rules, you: p.unit!.id, foe: foe.unit!.id, snap: takeSnapshot(world, p.cursor, p.controller.applied) });
  }
  // Step on a fixed clock, catching up if the event loop runs late.
  let next = performance.now();
  room.timer = setInterval(() => {
    const now = performance.now();
    let steps = 0;
    while (now >= next && steps < 5) {
      world.step();
      next += DT * 1000;
      steps++;
    }
    if (steps === 0) return;
    for (const p of room.players) send(p.ws, { t: 'snap', snap: takeSnapshot(world, p.cursor, p.controller.applied) });
    if (world.winner) endDuel(room, false);
  }, 5);
}

/** Send both players their recap and put the room back in the lobby for a rematch. */
function endDuel(room: Room, left: boolean) {
  const world = room.world;
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
  room.world = null;
  if (!world) return;
  for (const p of room.players) {
    const foe = room.players.find((o) => o !== p)?.unit ?? world.champions().find((c) => c !== p.unit)!;
    send(p.ws, {
      t: 'end', winner: left ? p.team : world.winner, reason: left ? null : world.winReason, left,
      recap: duelRecap(world, p.unit!, foe),
    });
    p.ready = false;
  }
  lobbyUpdate(room);
}

function leave(ws: WebSocket) {
  const room = roomOf.get(ws);
  if (!room) return;
  roomOf.delete(ws);
  room.players = room.players.filter((p) => p.ws !== ws);
  if (room.world) endDuel(room, true); // whoever's left wins by forfeit
  if (!room.players.length) {
    rooms.delete(room.code);
    return;
  }
  lobbyUpdate(room);
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

function handle(ws: WebSocket, msg: ClientMsg) {
  const room = roomOf.get(ws);
  const me = room?.players.find((p) => p.ws === ws);
  switch (msg.t) {
    case 'create': {
      if (room) return;
      const code = newCode();
      const r: Room = { code, players: [], world: null, timer: null };
      rooms.set(code, r);
      addPlayer(r, ws);
      return;
    }
    case 'join': {
      if (room) return;
      const r = rooms.get(String(msg.code).toUpperCase().trim());
      if (!r) return send(ws, { t: 'error', message: 'No room with that code.' });
      if (r.players.length >= 2) return send(ws, { t: 'error', message: 'That room is full.' });
      addPlayer(r, ws);
      return;
    }
    case 'pick':
      if (!room || !me || room.world || !KIT_IDS.includes(msg.kit) || !validSpells(msg.summoners)) return;
      me.kit = msg.kit;
      me.summoners = msg.summoners;
      me.ready = false;
      return lobbyUpdate(room);
    case 'ready':
      if (!room || !me || room.world) return;
      me.ready = !!msg.ready;
      lobbyUpdate(room);
      if (room.players.length === 2 && room.players.every((p) => p.ready)) startDuel(room);
      return;
    case 'cmds':
      // Only ever their own champion, and only commands the sim understands.
      if (!room?.world || !me || !Array.isArray(msg.cmds)) return;
      for (const c of msg.cmds.slice(0, 20)) if (validCommand(c)) me.controller.queue.push(c);
      if (Number.isInteger(msg.seq) && msg.seq > me.controller.received) me.controller.received = msg.seq;
      return;
    case 'leave':
      return leave(ws);
  }
}

const port = Number(process.env.PORT ?? PVP_PORT);
// Snapshots are repetitive JSON: per-message compression cuts them to about a sixth (~280 -> ~50 KB/s a player).
const wss = new WebSocketServer({ port, perMessageDeflate: { threshold: 512 } });
wss.on('connection', (ws) => {
  ws.on('message', (data) =>
    later(() => {
      try {
        handle(ws, JSON.parse(String(data)) as ClientMsg);
      } catch {
        /* ignore malformed messages */
      }
    }),
  );
  ws.on('close', () => leave(ws));
});
console.log(`Lane Rogue PvP server on ws://0.0.0.0:${port}${LATENCY ? ` (simulating ${LATENCY} ms each way)` : ''}`);
