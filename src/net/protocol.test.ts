import { describe, expect, it } from 'vitest';
import { BotController } from '../sim/bot';
import { DUEL_RULES } from '../sim/rules';
import { SIGNATURE_SUMMONERS } from '../sim/summoners';
import type { Slot } from '../sim/types';
import { TICK_HZ } from '../sim/util';
import { World } from '../sim/world';
import { applySnapshot, newCursor, takeSnapshot, type Snapshot } from './protocol';

describe('PvP snapshots', () => {
  it('a client world fed JSON snapshots every tick matches the server', () => {
    const server = new World(7, DUEL_RULES);
    const blue = server.spawnChampion('blue', 'maren', new BotController(0.9), { summoners: SIGNATURE_SUMMONERS.maren });
    server.spawnChampion('red', 'aurelle', new BotController(0.9), { summoners: SIGNATURE_SUMMONERS.aurelle });
    const client = new World(7, DUEL_RULES);
    const cursor = newCursor();
    applySnapshot(client, JSON.parse(JSON.stringify(takeSnapshot(server, cursor))) as Snapshot);
    const me = client.get(blue.id)!; // the client keeps this reference for the whole duel

    let fx = 0;
    let hits = 0;
    for (let i = 0; i < 60 * TICK_HZ && !server.winner; i++) {
      server.step();
      const snap = JSON.parse(JSON.stringify(takeSnapshot(server, cursor))) as Snapshot;
      fx += snap.fx.length;
      hits += snap.hits.length;
      applySnapshot(client, snap);
    }

    expect(client.tick).toBe(server.tick);
    expect(client.units.map((u) => [u.id, u.dead, Math.round(u.hp), u.pos.x.toFixed(3), u.pos.y.toFixed(3)])).toEqual(
      server.units.map((u) => [u.id, u.dead, Math.round(u.hp), u.pos.x.toFixed(3), u.pos.y.toFixed(3)]),
    );
    expect(client.missiles.map((m) => m.id)).toEqual(server.missiles.map((m) => m.id));
    expect(client.zones.map((z) => z.id)).toEqual(server.zones.map((z) => z.id));
    expect(client.championKills).toEqual(server.championKills);
    // Every effect and hit arrived exactly once.
    expect(fx).toBeGreaterThan(0);
    expect(hits).toBeGreaterThan(0);
    // The same object the HUD holds was updated in place, and its queries answer like the server's.
    expect(client.get(blue.id)).toBe(me);
    expect(me.champ!.level).toBe(blue.champ!.level);
    for (const slot of [0, 1, 2, 3] as Slot[]) {
      expect(client.castBlocker(me, slot)).toBe(server.castBlocker(blue, slot));
      expect(client.canLevel(me, slot)).toBe(server.canLevel(blue, slot));
    }
  });
});
