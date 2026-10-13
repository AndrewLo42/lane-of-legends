import { describe, expect, it } from 'vitest';
import { AUGMENTS, FIRST_STRIKE, combineMods } from './augments';
import { ITEMS, PERMANENT_ITEMS, STARTER_ITEMS } from './items';
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

  it('First Strike: the opening hit of a trade deals bonus damage, then not again until things calm down', () => {
    const { w, me, foe } = duel(['firststrike']);
    me.range = foe.range = 0; // no autos of their own, only the hits below
    foe.maxHp = foe.hp = 5000;
    const bonus = FIRST_STRIKE.base + FIRST_STRIKE.perLevel * me.champ!.level;
    let hp = foe.hp;
    w.dealDamage(me, foe, 10);
    expect(hp - foe.hp).toBeCloseTo(10 + bonus, 3);
    hp = foe.hp;
    w.dealDamage(me, foe, 10); // mid-trade: no bonus
    expect(hp - foe.hp).toBeCloseTo(10, 3);
    run(w, FIRST_STRIKE.calm - 1);
    w.dealDamage(foe, me, 5); // getting hit keeps the trade going
    run(w, 1.5);
    hp = foe.hp;
    w.dealDamage(me, foe, 10);
    expect(hp - foe.hp).toBeLessThan(15);
    run(w, FIRST_STRIKE.calm + 0.1);
    hp = foe.hp;
    w.dealDamage(me, foe, 10);
    expect(hp - foe.hp).toBeGreaterThan(bonus);
  });

  it('a champion kill counts once toward the kill goal', () => {
    const { w, me, foe } = duel([], { ...DUEL_RULES, killsToWin: 2 });
    w.dealDamage(me, foe, 1e6);
    expect(me.champ!.kills).toBe(1);
    expect(w.winner).toBeNull();
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

describe('items', () => {
  it('item mods apply at spawn alongside augments', () => {
    const w = new World(1, DUEL_RULES);
    const plain = w.spawnChampion('blue', 'arlo', idle);
    const geared = w.spawnChampion('red', 'arlo', idle, { items: ['i.blade', 'i.warden'], augments: ['brute'] });
    expect(geared.damage).toBeCloseTo(plain.damage + 24);
    expect(geared.maxHp).toBeCloseTo(plain.maxHp + 250);
    expect(w.dealDamage(plain, geared, 100)).toBeCloseTo(90);
  });

  it('Stormcaller Bow strikes every third attack', () => {
    const w = new World(1);
    // Maren: no on-attack passive of her own (Arlo's Triangulate would proc on the third hit too).
    const me = w.spawnChampion('blue', 'maren', idle, { items: ['i.storm'] });
    const foe = w.spawnChampion('red', 'arlo', idle);
    for (let i = 0; i < 3; i++) w.dealDamage(me, foe, 10, { attack: true });
    expect(foe.maxHp - foe.hp).toBeCloseTo(30 + 40 + 0.3 * me.damage);
  });

  it('Tidebreaker Aegis shields once when health gets low', () => {
    const w = new World(1);
    const me = w.spawnChampion('blue', 'arlo', idle, { items: ['i.aegis'] });
    const foe = w.spawnChampion('red', 'arlo', idle);
    w.dealDamage(foe, me, me.maxHp * 0.75);
    expect(w.status(me, 'shield')).toBeDefined();
    w.dealDamage(foe, me, 1e6);
    expect(me.dead).toBe(true);
  });

  it('Tome of Insight starts a duel a level higher', () => {
    const w = new World(1, DUEL_RULES);
    expect(w.spawnChampion('blue', 'maren', idle, { extraLevels: 1 }).champ!.level).toBe(DUEL_RULES.startLevel + 1);
  });
});

describe('relics (free starting items)', () => {
  /** `me` carries the relic; the foe stands 2 away, harmless. */
  function relic(id: AugmentId) {
    const w = new World(1);
    const ctl = new Script();
    const me = w.spawnChampion('blue', 'arlo', ctl, { items: [id] });
    const foe = w.spawnChampion('red', 'arlo', idle);
    me.pos = { x: 0, y: 0 };
    foe.pos = { x: 2, y: 0 };
    foe.damage = 0;
    me.range = 0; // no auto-attacking on its own
    return { w, me, foe };
  }
  const lost = (u: Unit) => u.maxHp - u.hp;

  it('are passives only, never sold or carried by opponents', () => {
    expect(STARTER_ITEMS.length).toBeGreaterThanOrEqual(3);
    for (const id of STARTER_ITEMS) {
      expect(ITEMS[id].mods).toBeUndefined();
      expect(PERMANENT_ITEMS).not.toContain(id);
    }
  });

  it('Ricochet Charm bounces every third attack to a nearby enemy', () => {
    const { w, me, foe } = relic('r.ricochet');
    const m = w.spawnMinion('red', 'melee', { x: 4, y: 0 });
    m.speed = 0;
    m.damage = 0;
    for (let i = 0; i < 2; i++) w.dealDamage(me, foe, 10, { attack: true });
    run(w, 1);
    expect(lost(m)).toBe(0);
    w.dealDamage(me, foe, 10, { attack: true });
    run(w, 1);
    expect(lost(m)).toBeCloseTo(20 + 0.6 * me.damage, 0);
  });

  it('Wisp Lantern fires at the enemy champion in range every 5s', () => {
    const { w, me, foe } = relic('r.wisp');
    run(w, 1);
    const one = 25 + 5 * me.champ!.level + 0.25 * me.damage;
    expect(lost(foe)).toBeGreaterThan(one - 5);
    run(w, 5);
    expect(lost(foe)).toBeGreaterThan(2 * one - 15); // minus ~6s of regen
  });

  it('Phoenix Feather heals and scorches once when dropping low, then waits 60s', () => {
    const { w, me, foe } = relic('r.phoenix');
    w.dealDamage(foe, me, me.maxHp * 0.8);
    expect(me.hp).toBeCloseTo(me.maxHp * 0.4, 0);
    expect(lost(foe)).toBeCloseTo(40 + 8 * me.champ!.level, 0);
    w.dealDamage(foe, me, me.maxHp * 0.3);
    expect(me.hp).toBeCloseTo(me.maxHp * 0.1, 0); // on cooldown
  });

  it('Echo Bell rings on every third ability cast', () => {
    const { w, me, foe } = relic('r.bell');
    const bell = ITEMS['r.bell'];
    bell.onCast!(w, me, 0, foe.pos, false);
    bell.onCast!(w, me, 1, foe.pos, true); // recasts don't count
    bell.onCast!(w, me, 2, foe.pos, false);
    expect(lost(foe)).toBe(0);
    bell.onCast!(w, me, 0, foe.pos, false);
    expect(lost(foe)).toBeCloseTo(30 + 8 * me.champ!.level + 0.3 * me.damage, 0);
    expect(w.status(foe, 'slow')?.value).toBe(0.3);
  });

  it('Leech Seed bursts on the fourth seed (one per second) and heals', () => {
    const { w, me, foe } = relic('r.seed');
    me.hp = 100;
    for (let i = 0; i < 6; i++) w.dealDamage(me, foe, 1, { attack: true }); // one second: one seed
    for (let i = 0; i < 2; i++) {
      run(w, 1.05);
      w.dealDamage(me, foe, 1, { attack: true });
    }
    expect(me.hp).toBeLessThan(110);
    run(w, 1.05);
    w.dealDamage(me, foe, 1, { attack: true });
    expect(me.hp).toBeGreaterThan(100 + 40 + 0.05 * foe.maxHp - 10);
  });
});

