import { PVP_PORT, type ClientMsg, type ServerMsg } from './protocol';

/**
 * Where the PvP server is: `?server=wss://…` in the URL, else VITE_PVP_SERVER at build time, else
 * in development the machine serving the game (LAN play: whoever runs `npm run dev` also runs
 * `npm run server`), and in a build the site itself (the Cloudflare Worker serves both).
 */
export function serverUrl() {
  const fromUrl = new URLSearchParams(location.search).get('server');
  const fromBuild = import.meta.env.VITE_PVP_SERVER as string | undefined;
  const ws = location.protocol === 'https:' ? 'wss' : 'ws';
  const here = import.meta.env.DEV ? `${ws}://${location.hostname}:${PVP_PORT}` : `${ws}://${location.host}`;
  return (fromUrl ?? fromBuild ?? here).replace(/\/+$/, '');
}

/**
 * The PvP server, and your connection to a room on it. Each room is its own connection: `enter()`
 * opens one (creating a room, or joining one by code) and `leave()` closes it. Every message received
 * goes to `onMessage`.
 */
export class NetClient {
  onMessage: (msg: ServerMsg) => void = () => {};
  /** The connection dropped (not a `leave()`). */
  onClose: () => void = () => {};
  /** The room as last reported, whoever was listening at the time (the lobby picks up after a duel). */
  lobby: Extract<ServerMsg, { t: 'lobby' }> | null = null;
  /** The room's connection dropped and hasn't been replaced. */
  closed = false;
  /** The room you're in and your seat token: enough to get back into a duel after a drop. */
  private code: string | null = null;
  private seat: string | null = null;
  private ws: WebSocket | null = null;

  constructor(readonly url = serverUrl()) {}

  /** Whether a server answers at all (before showing the lobby). */
  async available(timeoutMs = 4000) {
    try {
      const res = await fetch(`${this.url.replace(/^ws/, 'http')}/health`, { signal: AbortSignal.timeout(timeoutMs) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Create a room (no code) or join one. The room answers with a lobby message, or an error and a close. */
  enter(code: string | null) {
    this.leave();
    this.open(`${this.url}/room/${code ?? 'new'}`);
  }

  /** Back into the duel after a drop (the room answers `resume`, or an error if the seat is gone). */
  rejoin() {
    if (!this.code || !this.seat) return false;
    this.drop();
    this.open(`${this.url}/room/${this.code}?seat=${encodeURIComponent(this.seat)}`);
    return true;
  }

  /** A connection is open or opening. */
  get active() {
    return this.ws != null;
  }

  /** Give up on a connection that has gone quiet, keeping the seat for `rejoin()`. */
  drop() {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  private open(url: string) {
    const ws = (this.ws = new WebSocket(url));
    this.closed = false;
    ws.addEventListener('message', (e) => {
      if (ws !== this.ws) return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return; // ignore malformed messages
      }
      if (msg.t === 'seat') this.seat = msg.token;
      if (msg.t === 'lobby') {
        this.lobby = msg;
        this.code = msg.code;
      }
      if (msg.t === 'error' && !this.lobby) this.leave(); // turned away (no such room, full, or the duel is over)
      this.onMessage(msg);
    });
    ws.addEventListener('close', () => {
      if (ws !== this.ws) return;
      this.ws = null;
      this.lobby = null;
      this.closed = true;
      this.onClose();
    });
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Leave the room (an opponent mid-duel wins by forfeit). */
  leave() {
    this.drop();
    this.lobby = null;
    this.code = this.seat = null;
  }
}
