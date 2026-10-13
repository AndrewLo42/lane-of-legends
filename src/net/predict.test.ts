import { describe, expect, it } from 'vitest';
import { DUEL_RULES } from '../sim/rules';
import type { Command, Controller, Vec2 } from '../sim/types';
import { DT, World } from '../sim/world';
import { predictOwn, type PendingBatch } from './predict';
import { applySnapshot, newCursor, takeSnapshot, type Snapshot } from './protocol';

/** The server side of one player: commands arrive with a delay, and are acknowledged once applied. */
class Remote implements Controller {
  inbox: { at: number; seq: number; cmds: Command[] }[] = [];
  queue: Command[] = [];
  applied = 0;
  received = 0;
  deliver(now: number) {
    while (this.inbox.length && this.inbox[0].at <= now) {
      const b = this.inbox.shift()!;
      this.queue.push(...b.cmds);
      this.received = b.seq;
    }
  }
  think() {
    this.applied = this.received;
    return this.queue.splice(0);
  }
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

describe('client-side prediction', () => {
  it('moves your champion at once and keeps it where the server will put it, under 200 ms of ping', () => {
    const ONE_WAY = 100; // ms
    const server = new World(3, DUEL_RULES);
    const remote = new Remote();
    const meOnServer = server.spawnChampion('blue', 'arlo', remote);
    server.spawnChampion('red', 'tock', { think: () => [] });
    const client = new World(3, DUEL_RULES);
    const cursor = newCursor();
    applySnapshot(client, JSON.parse(JSON.stringify(takeSnapshot(server, cursor))) as Snapshot);
    const me = client.get(meOnServer.id)!;

    const tickMs = DT * 1000;
    const snaps: { at: number; snap: Snapshot }[] = [];
    const pending: PendingBatch[] = [];
    let now = 0;
    let seq = 0;
    const serverTrail: { at: number; pos: Vec2 }[] = [];
    const clientTrail: { at: number; pos: Vec2 }[] = [];
    const start = { ...me.pos };
    let clickAt = 0;

    for (let i = 0; i < 150; i++) {
      now = i * tickMs;
      if (i === 10) {
        // Click to walk 12 units up the lane.
        clickAt = now;
        const cmds: Command[] = [{ type: 'move', to: { x: me.pos.x + 12, y: me.pos.y } }];
        pending.push({ seq: ++seq, at: now, cmds });
        remote.inbox.push({ at: now + ONE_WAY, seq, cmds });
      }
      remote.deliver(now);
      server.step();
      serverTrail.push({ at: now, pos: { ...meOnServer.pos } });
      snaps.push({ at: now + ONE_WAY, snap: JSON.parse(JSON.stringify(takeSnapshot(server, cursor, remote.applied))) as Snapshot });
      while (snaps.length && snaps[0].at <= now) {
        const { snap } = snaps.shift()!;
        applySnapshot(client, snap);
        while (pending.length && pending[0].seq <= snap.ack) pending.shift();
        predictOwn(client, me, pending, 2 * ONE_WAY, now);
      }
      clientTrail.push({ at: now, pos: { ...me.pos } });
    }

    // It starts walking on the first snapshot after the click, not a round trip later.
    const firstMove = clientTrail.find((c) => dist(c.pos, start) > 0.05)!;
    expect(firstMove.at - clickAt).toBeLessThan(tickMs * 2);

    // While walking, the predicted position is where the server will have it one way later
    // (when the command lands there): no rubber-banding.
    const settled = clientTrail.filter((c) => c.at > clickAt + 400 && c.at < clickAt + 1300);
    expect(settled.length).toBeGreaterThan(10);
    for (const c of settled) {
      const truth = serverTrail.find((s) => s.at >= c.at + ONE_WAY)!;
      expect(dist(c.pos, truth.pos)).toBeLessThan(0.6);
    }
    // And once the walk is over, both rest at the same spot.
    expect(dist(clientTrail.at(-1)!.pos, serverTrail.at(-1)!.pos)).toBeLessThan(0.05);
  });
});
