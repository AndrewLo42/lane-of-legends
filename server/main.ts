/**
 * Lane League PvP server for Node (LAN play and local testing); worker/index.ts hosts the same rooms on
 * Cloudflare. Players connect to /room/new to create a room or /room/CODE to join one; GET /health
 * answers "ok" so the game can tell whether a server is there.
 *
 *   npm run server            (port 8787, or PORT=…)
 *
 * Matchmaking would sit in front of this: pair two players into a room instead of trading a code.
 */
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { PVP_PORT } from '../src/net/protocol';
import { Room, newCode, send, validCode, type Socket } from './room';

const rooms = new Map<string, Room>();

/**
 * Simulated network delay for testing prediction on one machine: `LATENCY=100 npm run server` holds every
 * message for 100 ms each way (about a 200 ms ping).
 */
const LATENCY = Number(process.env.LATENCY ?? 0);
const later = (fn: () => void) => (LATENCY > 0 ? setTimeout(fn, LATENCY) : fn());

function socketFor(ws: WebSocket): Socket {
  return {
    send: (data) => later(() => ws.readyState === ws.OPEN && ws.send(data)),
    close: () => later(() => ws.close()),
  };
}

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
    return res.end('ok');
  }
  res.writeHead(404).end();
});

// Snapshots are repetitive JSON: per-message compression cuts them to about a sixth (~280 -> ~50 KB/s a player).
const wss = new WebSocketServer({ server: http, perMessageDeflate: { threshold: 512 } });
wss.on('connection', (ws, req) => {
  const socket = socketFor(ws);
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const seat = url.searchParams.get('seat');
  let room: Room | undefined;
  if (path === '/room/new') {
    let code = newCode();
    while (rooms.has(code)) code = newCode();
    rooms.set(code, (room = new Room(code, () => rooms.delete(code))));
  } else {
    const code = path.startsWith('/room/') ? path.slice(6).toUpperCase() : '';
    room = validCode(code) ? rooms.get(code) : undefined;
    if (!room) {
      send(socket, { t: 'error', message: 'No room with that code.' });
      return socket.close();
    }
  }
  const r = room;
  later(() => (seat ? r.rejoin(socket, seat) : r.add(socket)));
  ws.on('message', (data) => later(() => r.message(socket, String(data))));
  ws.on('close', () => later(() => r.leave(socket)));
});

const port = Number(process.env.PORT ?? PVP_PORT);
http.listen(port, () =>
  console.log(`Lane League PvP server on ws://0.0.0.0:${port}${LATENCY ? ` (simulating ${LATENCY} ms each way)` : ''}`),
);
