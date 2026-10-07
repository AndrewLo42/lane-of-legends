import { describe, expect, it } from 'vitest';
import { BotController } from './bot';
import { LANE, spawnPoint } from './lane';
import { MINIONS, RESPAWN_SECONDS, WAVE } from './stats';
import type { Command, Controller, Unit } from './types';
import { TICK_HZ, World } from './world';

/** A controller that issues a fixed list of commands on the first tick. */
const scripted = (cmds: Command[]): Controller => {
  let sent = false;
  return { think: () => (sent ? [] : ((sent = true), cmds)) };
};
const idle: Controller = { think: () => [] };

const run = (w: World, seconds: number) => {
  for (let i = 0; i < seconds * TICK_HZ; i++) w.step();
};
const of = (w: World, pred: (u: Unit) => boolean) => w.units.filter((u) => !u.dead && pred(u));
const outerTower = (w: World, team: 'blue' | 'red') =>
  of(w, (u) => u.kind === 'tower' && u.team === team).sort((a, b) => Math.abs(a.pos.x) - Math.abs(b.pos.x))[0];

describe('movement', () => {
  it('spawns a nexus and towers for each team', () => {
    const w = new World();
    for (const team of ['blue', 'red'] as const) {
      expect(of(w, (u) => u.team === team && u.kind === 'nexus')).toHaveLength(1);
      expect(of(w, (u) => u.team === team && u.kind === 'tower')).toHaveLength(LANE.towerXs.length);
    }
  });

  it('walks a champion to its move target and stops', () => {
    const w = new World();
    const c = w.spawnChampion('blue', 'arlo', scripted([{ type: 'move', to: { x: -30, y: 3 } }]));
    run(w, 5);
    expect(c.pos.x).toBeCloseTo(-30, 5);
    expect(c.pos.y).toBeCloseTo(3, 5);
  });

  it('keeps champions inside the lane and out of structures', () => {
    const w = new World();
    const c = w.spawnChampion('blue', 'arlo', scripted([{ type: 'move', to: { x: -46, y: 100 } }]));
    run(w, 1);
    expect(c.pos.y).toBeLessThanOrEqual(LANE.halfWidth - c.radius + 1e-9);

    const tower = of(w, (u) => u.kind === 'tower' && u.team === 'blue')[0];
    const d = w.spawnChampion('blue', 'arlo', scripted([{ type: 'move', to: { ...tower.pos } }]));
    run(w, 2);
    expect(Math.hypot(d.pos.x - tower.pos.x, d.pos.y - tower.pos.y)).toBeGreaterThanOrEqual(tower.radius + d.radius - 1e-9);
  });

  it('walks around a tower that sits directly in the way', () => {
    const w = new World();
    const tower = of(w, (u) => u.kind === 'tower' && u.team === 'blue')[0];
    const c = w.spawnChampion('blue', 'arlo', scripted([{ type: 'move', to: { x: tower.pos.x + 6, y: 0 } }]));
    c.pos = { x: tower.pos.x - 6, y: 0 };
    run(w, 2.5);
    expect(c.pos.x).toBeCloseTo(tower.pos.x + 6, 1);
  });
});

describe('waves', () => {
  it('spawns a full wave per team on schedule', () => {
    const w = new World();
    run(w, WAVE.first + WAVE.stagger * WAVE.roles.length + 0.1);
    for (const team of ['blue', 'red'] as const) {
      const m = of(w, (u) => u.kind === 'minion' && u.team === team);
      expect(m.map((u) => u.role).sort()).toEqual([...WAVE.roles].sort());
    }
  });

  it("minions get past a champion standing still in their path", () => {
    const w = new World();
    const t = of(w, (u) => u.kind === 'tower' && u.team === 'blue' && Math.abs(u.pos.x) === LANE.towerXs[0])[0];
    const c = w.spawnChampion('blue', 'arlo', idle);
    c.pos = { x: t.pos.x - t.radius - c.radius, y: 0 }; // wedged against the base tower, dead centre of the lane
    run(w, WAVE.first + 8);
    const wave = of(w, (u) => u.kind === 'minion' && u.team === 'blue');
    expect(wave).toHaveLength(WAVE.roles.length);
    expect(wave.every((m) => m.pos.x > t.pos.x + 3)).toBe(true);
  });

  it('waves meet in the middle and kill each other', () => {
    const w = new World();
    run(w, WAVE.first + 15);
    const fighting = of(w, (u) => u.kind === 'minion' && u.attackTarget != null);
    expect(fighting.length).toBeGreaterThan(0);
    run(w, 15);
    // Next wave has spawned by now, but the first ones should have thinned out.
    expect(of(w, (u) => u.kind === 'minion').length).toBeLessThan(WAVE.roles.length * 4);
    expect(w.winner).toBeNull();
  });
});

describe('towers', () => {
  it('shoot minions before champions', () => {
    const w = new World();
    const t = outerTower(w, 'red');
    const champ = w.spawnChampion('blue', 'arlo', idle);
    champ.pos = { x: t.pos.x - 4, y: 3 };
    run(w, 0.2);
    expect(t.attackTarget).toBe(champ.id);
    run(w, WAVE.first + 1); // let a blue minion spawn, then drop it under the tower
    const m = w.units.find((u) => u.kind === 'minion' && u.team === 'blue')!;
    m.pos = { x: t.pos.x - 3, y: -2 };
    t.attackTarget = null;
    w.step();
    expect(t.attackTarget).toBe(m.id);
  });

  it('switch to a champion who hits an enemy champion under them', () => {
    const w = new World();
    run(w, WAVE.first + 1);
    const t = outerTower(w, 'red');
    const m = w.units.find((u) => u.kind === 'minion' && u.team === 'blue')!;
    m.pos = { x: t.pos.x - 2.5, y: -2 };
    const victim = w.spawnChampion('red', 'arlo', idle);
    victim.pos = { x: t.pos.x - 4, y: 3 };
    const diver = w.spawnChampion('blue', 'arlo', scripted([{ type: 'attack', target: victim.id }]));
    diver.pos = { x: t.pos.x - 8, y: 3 };
    w.step();
    expect(t.attackTarget).toBe(m.id);
    run(w, 1);
    expect(t.attackTarget).toBe(diver.id);
  });

  it('protect the structures behind them', () => {
    const w = new World();
    const inner = of(w, (u) => u.kind === 'tower' && u.team === 'red').sort((a, b) => Math.abs(b.pos.x) - Math.abs(a.pos.x))[0];
    const nexus = of(w, (u) => u.kind === 'nexus' && u.team === 'red')[0];
    expect(w.isTargetable(outerTower(w, 'red'))).toBe(true);
    expect(w.isTargetable(inner)).toBe(false);
    expect(w.isTargetable(nexus)).toBe(false);
    outerTower(w, 'red').dead = true;
    expect(w.isTargetable(inner)).toBe(true);
  });
});

describe('champions', () => {
  it('earn gold for last hits only', () => {
    const w = new World();
    run(w, WAVE.first + 0.1);
    const m = w.units.find((u) => u.kind === 'minion' && u.team === 'red')!;
    const c = w.spawnChampion('blue', 'arlo', scripted([{ type: 'attack', target: m.id }]));
    c.pos = { x: m.pos.x - 4, y: m.pos.y };
    m.hp = 1;
    m.speed = 0;
    run(w, 1);
    expect(m.dead || !w.units.includes(m)).toBe(true);
    expect(c.gold).toBe(MINIONS[m.role!].bounty);
  });

  it('die and respawn at their fountain', () => {
    const w = new World();
    const c = w.spawnChampion('blue', 'arlo', idle);
    c.pos = { x: 0, y: 0 };
    c.hp = 1;
    const k = w.spawnChampion('red', 'arlo', scripted([{ type: 'attack', target: c.id }]));
    k.pos = { x: 3, y: 0 };
    run(w, 1);
    expect(c.dead).toBe(true);
    expect(k.gold).toBeGreaterThan(0);
    run(w, RESPAWN_SECONDS);
    expect(c.dead).toBe(false);
    expect(c.hp).toBe(c.maxHp);
    expect(c.pos).toEqual(spawnPoint('blue'));
  });

  it('heal quickly at their fountain', () => {
    const w = new World();
    const c = w.spawnChampion('blue', 'arlo', idle);
    c.hp = 50;
    run(w, 5);
    expect(c.hp).toBe(c.maxHp);
  });

  it('a nexus falling ends the game', () => {
    const w = new World();
    for (const t of of(w, (u) => u.kind === 'tower' && u.team === 'red')) t.dead = true;
    const nexus = of(w, (u) => u.kind === 'nexus' && u.team === 'red')[0];
    nexus.hp = 1;
    const c = w.spawnChampion('blue', 'arlo', scripted([{ type: 'attack', target: nexus.id }]));
    c.pos = { x: nexus.pos.x - 6, y: 0 };
    run(w, 1);
    expect(w.winner).toBe('blue');
  });
});

describe('determinism', () => {
  it('replays identically for a given seed', () => {
    const trace = (seed: number) => {
      const w = new World(seed);
      const a = w.spawnChampion('blue', 'arlo', new BotController());
      const b = w.spawnChampion('red', 'arlo', new BotController());
      run(w, 60);
      return JSON.stringify([a.pos, b.pos, a.gold, b.gold, w.units.length]);
    };
    expect(trace(7)).toEqual(trace(7));
    expect(trace(7)).not.toEqual(trace(8));
  });
});
