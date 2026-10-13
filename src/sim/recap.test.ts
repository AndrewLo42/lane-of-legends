import { describe, expect, it } from 'vitest';
import { duelRecap, total } from './recap';
import type { Controller } from './types';
import { World } from './world';

const idle: Controller = { think: () => [] };

describe('duel recap', () => {
  it('breaks damage down by attacks, abilities and other sources, without overkill', () => {
    const w = new World(1);
    const me = w.spawnChampion('blue', 'arlo', idle);
    const foe = w.spawnChampion('red', 'lisha', idle);
    foe.maxHp = foe.hp = 1000;
    w.dealDamage(me, foe, 100, { attack: true });
    w.dealDamage(me, foe, 250, { slot: 0 });
    w.dealDamage(me, foe, 30, { proc: true });
    w.dealDamage(foe, me, 80, { slot: 2 });
    w.dealDamage(w.spawnMinion('red', 'caster', { x: 0, y: 0 }), me, 24, { attack: true });
    w.dealDamage(me, foe, 5000, { slot: 3 }); // finishes her off: only her remaining 620 counts

    const r = duelRecap(w, me, foe);
    const dealt = Object.fromEntries(r.me.dealt.map((x) => [x.key ?? x.label, Math.round(x.amount)]));
    expect(dealt).toEqual({ Attacks: 100, Q: 250, 'Passives, items & burns': 30, R: 620 });
    expect(Math.round(total(r.me.dealt))).toBe(1000);
    expect(r.me.dealt[0].key).toBe('R'); // biggest first

    const taken = Object.fromEntries(r.me.taken.map((x) => [x.label, Math.round(x.amount)]));
    expect(taken).toEqual({ 'Lisha · Twin Petals': 80, Minions: 24 });
    expect(r.foe.dealt.map((x) => x.key)).toEqual(['E']);
    expect(r.me.kills).toBe(1);
    expect(r.foe.deaths).toBe(1);
  });
});
