import { describe, expect, it } from 'vitest';
import { AUGMENTS, combineMods } from './augments';
import { DUEL_RULES, SANDBOX_RULES } from './rules';
import type { AugmentId, Command, Controller, Unit } from './types';
import { TICK_HZ } from './util';
import { World } from './world';

const idle: Controller = { think: () => [] };
const run = (w: World, s: number) => {
  for (let i = 0; i < Math.round(s * TICK_HZ); i++) w.step();
};
class Script implements Controller {
  queue: Command[] = [];
  think() {
    return this.queue.splice(0);
  }
}

/** Two champions facing off mid-lane; `me` (blue) has `augs`. */
function duel(augs: AugmentId[], rules = SANDBOX_RULES) {
  const w = new World(1, rules);
  const ctl = new Script();
  const me = w.spawnChampion('blue', 'arlo', ctl, { augments: augs });
  const foe = w.spawnChampion('red', 'arlo', idle);
  me.pos = { x: 0, y: 0 };
  foe.pos = { x: 5, y: 0 };
  return { w, me, foe, ctl };
}

describe('augments', () => {
  it('every augment is well-formed', () => {
    for (const a of Object.values(AUGMENTS)) {
      expect(a.name && a.icon && a.describe).toBeTruthy();
      expect(['silver', 'gold', 'prismatic']).toContain(a.tier);
    }
  });

  it('stat augments change spawn stats; multipliers stack multiplicatively', () => {
    const plain = duel([]).me;
    const { me } = duel(['brute', 'thick', 'fleet']);
    expect(me.damage).toBeCloseTo(plain.damage + 14);
    expect(me.maxHp).toBeCloseTo(plain.maxHp + 160);
    expect(me.speed).toBeCloseTo(plain.speed * 1.08);
    expect(combineMods(['juggernaut', 'glass']).hpPct).toBeCloseTo(0.15);
  });

  it('Glass Cannon and Executioner amplify damage', () => {
    const { w, me, foe } = duel(['glass', 'execute']);
    expect(w.dealDamage(me, foe, 100)).toBeCloseTo(122);
    foe.hp = foe.maxHp * 0.2;
    expect(w.dealDamage(me, foe, 100)).toBeCloseTo(122 * 1.3);
  });

  it('Vampirism heals for a share of damage dealt', () => {
    const { w, me, foe } = duel(['vamp']);
    me.hp = 100;
    w.dealDamage(me, foe, 200);
    expect(me.hp).toBeCloseTo(100 + 18);
  });

  it('Thornmail reflects champion damage', () => {
    const { w, me, foe } = duel(['thorns']);
    w.dealDamage(foe, me, 200, { attack: true });
    expect(foe.maxHp - foe.hp).toBeCloseTo(50);
  });

  it('Infernal burns targets hit by abilities', () => {
    const { w, me, foe } = duel(['infernal']);
    w.dealDamage(me, foe, 300, { slot: 0 });
    const after = foe.hp;
    run(w, 3.2);
    expect(after - foe.hp).toBeGreaterThan(300 * 0.4 - 15); // minus a little regen
  });

  it('Juggernaut halves tower damage', () => {
    const { w, me } = duel(['juggernaut']);
    const tower = w.units.find((u) => u.kind === 'tower')!;
    expect(w.dealDamage(tower, me, 100)).toBeCloseTo(50);
  });

  it('Siegebreaker buffs your minions', () => {
    const { w } = duel(['siege']);
    expect(w.spawnMinion('blue', 'melee', { x: 0, y: 0 }).maxHp).toBeCloseTo(300 * 1.4);
    expect(w.spawnMinion('red', 'melee', { x: 0, y: 0 }).maxHp).toBe(300);
  });

  it('Double Tap replays every third basic ability', () => {
    const { w, me, ctl } = duel(['doubletap']);
    me.champ!.maxMana = me.champ!.mana = 5000;
    const fired = () => w.missiles.filter((m) => m.style === 'spark').length;
    let total = 0;
    for (let i = 0; i < 3; i++) {
      me.champ!.abilities[0].readyAt = 0;
      ctl.queue.push({ type: 'cast', slot: 0, at: { x: 0, y: 6 } }); // aim away from the foe so shots stay in the air
      run(w, 0.25);
      total = Math.max(total, fired());
    }
    run(w, 0.2);
    expect(Math.max(total, fired())).toBeGreaterThanOrEqual(2); // the third cast's echo is in flight with it
  });
});

describe('duel rules', () => {
  const win = (w: World) => [w.winner, w.winReason];

  it('a champion death scores for the other side, and the kill goal wins', () => {
    const { w, me, foe } = duel([], { ...DUEL_RULES, killsToWin: 2 });
    const kill = (u: Unit, by: Unit | null) => w.dealDamage(by, u, 1e6);
    kill(foe, me);
    expect(me.champ!.kills).toBe(1);
    expect(w.winner).toBeNull();
    run(w, 9); // respawn
    kill(foe, null); // executed by a tower still counts
    expect(win(w)).toEqual(['blue', 'kills']);
  });

  it('Bounty Hunter kills count double', () => {
    const { w, me, foe } = duel(['bounty'], { ...DUEL_RULES, killsToWin: 2 });
    w.dealDamage(me, foe, 1e6);
    expect(win(w)).toEqual(['blue', 'kills']);
  });

  it('the CS goal wins', () => {
    const { w, me } = duel([], { ...DUEL_RULES, csToWin: 3 });
    for (let i = 0; i < 3; i++) w.dealDamage(me, w.spawnMinion('red', 'caster', { x: 2, y: 0 }), 1e6);
    expect(win(w)).toEqual(['blue', 'cs']);
  });

  it('the first tower wins', () => {
    const { w, me } = duel([], DUEL_RULES);
    const tower = w.units.find((u) => u.kind === 'tower' && u.team === 'red')!;
    w.dealDamage(me, tower, 1e6);
    expect(win(w)).toEqual(['blue', 'tower']);
  });

  it('duels start both champions at level 3 with Q, E and W learned', () => {
    const { me, foe } = duel([], DUEL_RULES);
    for (const c of [me, foe]) {
      expect(c.champ!.level).toBe(3);
      expect(c.champ!.abilities.map((a) => a.rank)).toEqual([1, 1, 1, 0]);
      expect(c.champ!.skillPoints).toBe(0);
    }
  });
});
