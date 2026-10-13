import { PVP_PORT, type ClientMsg, type ServerMsg } from './protocol';

/**
 * Where the PvP server is: `?server=wss://…` in the URL, else VITE_PVP_SERVER at build time, else
 * the machine serving the game (LAN play: whoever runs `npm run dev` also runs `npm run server`).
 */
export function serverUrl() {
  const fromUrl = new URLSearchParams(location.search).get('server');
  const fromBuild = import.meta.env.VITE_PVP_SERVER as string | undefined;
  return fromUrl ?? fromBuild ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:${PVP_PORT}`;
}

/** A connection to the PvP server: send messages, and hand every message received to `onMessage`. */
export class NetClient {
  onMessage: (msg: ServerMsg) => void = () => {};
  onClose: () => void = () => {};
  /** The room as last reported, whoever was listening at the time (the lobby picks up after a duel). */
  lobby: Extract<ServerMsg, { t: 'lobby' }> | null = null;
  closed = false;

  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return; // ignore malformed messages
      }
      if (msg.t === 'lobby') this.lobby = msg;
      this.onMessage(msg);
    });
    ws.addEventListener('close', () => {
      this.closed = true;
      this.onClose();
    });
  }

  static connect(url = serverUrl(), timeoutMs = 4000): Promise<NetClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`No PvP server at ${url}`));
      }, timeoutMs);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new NetClient(ws));
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`No PvP server at ${url}`));
      });
    });
  }

  send(msg: ClientMsg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.ws.close();
  }
}
