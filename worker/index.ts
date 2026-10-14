/**
 * Lane League PvP server on Cloudflare: the same rooms as the Node server (server/room.ts), one per
 * Durable Object, so each room runs near whoever created it. The Worker routes /room/new (pick an unused
 * code), /room/CODE (join) and /health; the room's object holds both players' connections and steps the duel.
 *
 *   npx wrangler dev -c worker/wrangler.jsonc       (local, port 8787 like the Node server)
 *   npx wrangler deploy -c worker/wrangler.jsonc    (to your Cloudflare account)
 */
import { DurableObject } from 'cloudflare:workers';
import { Room, newCode, send, validCode, type Socket } from '../server/room';

interface Env {
  ROOMS: DurableObjectNamespace<RoomObject>;
}

const cors = { 'access-control-allow-origin': '*' };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/health') return new Response('ok', { headers: cors });
    if (!path.startsWith('/room/')) return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const wanted = path.slice(6).toUpperCase();
    const stubFor = (code: string) => env.ROOMS.get(env.ROOMS.idFromName(code));
    if (wanted === 'NEW') {
      // A random code whose room is empty (a busy one answers 409).
      for (let i = 0; i < 10; i++) {
        const code = newCode();
        const res = await stubFor(code).fetch(roomRequest(request, code, true));
        if (res.status !== 409) return res;
      }
      return new Response('No free room code', { status: 503 });
    }
    // An invalid code goes to a throwaway room that turns the player away with the usual error.
    return stubFor(validCode(wanted) ? wanted : 'XXXX').fetch(roomRequest(request, wanted, false));
  },
} satisfies ExportedHandler<Env>;

function quietly(fn: () => void) {
  try {
    fn();
  } catch {
    /* already closed */
  }
}

function roomRequest(request: Request, code: string, create: boolean) {
  const headers = new Headers(request.headers);
  headers.set('x-room-code', code);
  headers.set('x-room-create', create ? '1' : '0');
  headers.set('x-room-seat', new URL(request.url).searchParams.get('seat') ?? '');
  return new Request(request.url, { headers });
}

/** One room. It lives while either player is connected; an empty room holds nothing worth keeping. */
export class RoomObject extends DurableObject<Env> {
  private room: Room | null = null;

  async fetch(request: Request): Promise<Response> {
    const code = request.headers.get('x-room-code') ?? '';
    const create = request.headers.get('x-room-create') === '1';
    const seat = request.headers.get('x-room-seat');
    if (this.room?.empty) this.room = null;
    if (create && this.room) return new Response('Room code in use', { status: 409 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    // Sending to (or closing) a connection that has just dropped throws: the close event handles it.
    // A turned-away player closes the connection on the error message; closing it from here as well
    // (the fallback) only after a while, as a close from the room's side logs a spurious error.
    const socket: Socket = { send: (data) => quietly(() => server.send(data)), close: () => setTimeout(() => quietly(() => server.close(1000)), 5000) };
    if (create) {
      const fresh: Room = new Room(code, () => {
        if (this.room === fresh) this.room = null;
      });
      this.room = fresh;
    }
    const room = this.room;
    // Listen before anything can close the connection (a turned-away player is closed straight away).
    const gone = () => {
      quietly(() => server.close(1000)); // answer the player's close
      room?.leave(socket);
    };
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    server.addEventListener('message', (e) => room?.message(socket, typeof e.data === 'string' ? e.data : ''));
    if (!room || !validCode(code)) {
      send(socket, { t: 'error', message: 'No room with that code.' });
      socket.close();
    } else if (seat) room.rejoin(socket, seat);
    else room.add(socket);
    return new Response(null, { status: 101, webSocket: client });
  }
}
