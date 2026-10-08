import { describe, expect, it } from 'vitest';
import { BARRIER, FLASH, GHOST, IGNITE, RAGE, SUMMONERS, TETHER } from './summoners';
import type { Command, Controller, SummonerId, SummonerSlot } from './types';
import { TICK_HZ, dist } from './util';
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

/** `me` (blue) at the centre carrying `spells`; a harmless foe 4 units away. */
function duel(spells: SummonerId[]) {
  const w = new World(1);
  const ctl = new Script();
  const me = w.spawnChampion('blue', 'arlo', ctl, { summoners: spells });
  const foe = w.spawnChampion('red', 'arlo', idle);
  me.pos = { x: 0, y: 0 };
  foe.pos = { x: 4, y: 0 };
  foe.damage = 0;
  me.range = 0; // no auto-attacking unless a test wants it
  const summon = (slot: SummonerSlot, x: number, y = 0) => {
    ctl.queue.push({ type: 'summon', slot, at: { x, y } });
    w.step();
  };
  return { w, me, foe, summon };
}

describe('summoner spells', () => {
  it('every spell is well-formed', () => {
    for (const s of Object.values(SUMMONERS)) expect(s.name && s.icon && s.cooldown > 0).toBeTruthy();
  });

  it('champions carry Flash and Ignite by default', () => {
    const w = new World(1);
    expect(w.spawnChampion('blue', 'tock', idle).champ!.summoners.map((s) => s.id)).toEqual(['flash', 'ignite']);
  });

  it('Flash blinks toward the cursor, even while rooted, then goes on cooldown', () => {
    const { w, me, summon } = duel(['flash', 'ghost']);
    w.addStatus(me, { kind: 'root', value: 1, sourceId: 0, seconds: 2 });
    summon(0, 0, -10);
    expect(me.pos.y).toBeCloseTo(-FLASH.range, 1);
    expect(w.summonerBlocker(me, 0)).toBe('cooldown');
    summon(0, 0, -20);
    expect(me.pos.y).toBeCloseTo(-FLASH.range, 1); // still on cooldown
  });

  it('nothing works while stunned', () => {
    const { w, me, summon } = duel(['flash', 'ghost']);
    w.addStatus(me, { kind: 'stun', value: 1, sourceId: 0, seconds: 2 });
    summon(0, 0, -10);
    expect(me.pos.y).toBeCloseTo(0, 1);
    expect(me.champ!.summoners[0].readyAt).toBe(0);
  });

  it('Ignite needs an enemy champion in range, burns, and halves healing', () => {
    const { w, me, foe, summon } = duel(['ignite', 'flash']);
    foe.pos = { x: 20, y: 0 };
    summon(0, 20);
    expect(me.champ!.summoners[0].readyAt).toBe(0); // out of range: not cast, no cooldown
    foe.pos = { x: 4, y: 0 };
    foe.hp = 300;
    summon(0, 4);
    expect(w.heal(foe, 100)).toBeCloseTo(100 * (1 - IGNITE.grievous));
    const before = foe.hp;
    run(w, IGNITE.seconds + 0.2);
    const burned = IGNITE.base + IGNITE.perLevel * me.champ!.level;
    // Regen keeps ticking (halved while burning), so allow a little slack.
    expect(before - foe.hp).toBeGreaterThan(burned - 8);
    expect(w.heal(foe, 100)).toBeCloseTo(100); // wounds gone with the burn
  });

  it('Ghost makes you faster for a while', () => {
    const { w, me, summon } = duel(['ghost', 'flash']);
    const base = w.effectiveSpeed(me);
    summon(0, 0);
    expect(w.effectiveSpeed(me)).toBeCloseTo(base * (1 + GHOST.speed));
    run(w, GHOST.seconds + 0.1);
    expect(w.effectiveSpeed(me)).toBeCloseTo(base);
  });

  it('Barrier shields for a couple of seconds', () => {
    const { w, me, foe, summon } = duel(['barrier', 'flash']);
    summon(0, 0);
    const shield = BARRIER.base + BARRIER.perLevel * me.champ!.level;
    expect(w.dealDamage(foe, me, shield - 10)).toBe(0);
    expect(w.dealDamage(foe, me, 30)).toBeCloseTo(20);
  });

  it('Rage adds attack damage and attack speed', () => {
    const { w, me, foe, summon } = duel(['rage', 'flash']);
    const slow = w.attackTicks(me);
    summon(0, 0);
    expect(w.attackTicks(me)).toBeLessThan(slow);
    me.range = 2;
    foe.pos = { x: 1.5, y: 0 };
    foe.hp = foe.maxHp;
    me.champ!.data = {};
    run(w, 1.2); // Arlo's bolt flies to the target
    const per = me.damage + RAGE.ad + RAGE.adPerLevel * me.champ!.level;
    expect(foe.maxHp - foe.hp).toBeGreaterThanOrEqual(per - 5);
  });

  it('Tether tags the first enemy hit; casting again dashes to it', () => {
    const { w, me, foe, summon } = duel(['tether', 'flash']);
    foe.pos = { x: 8, y: 0 };
    foe.speed = 0;
    summon(0, 8);
    run(w, 0.6);
    expect(w.status(foe, 'tether', me.id)).toBeTruthy();
    const hp = foe.hp;
    summon(0, 0); // recast: free, even though Tether is on cooldown
    run(w, 0.6);
    expect(dist(me.pos, foe.pos)).toBeLessThan(2);
    expect(Math.abs(hp - foe.hp - (TETHER.base + TETHER.perLevel * me.champ!.level))).toBeLessThan(2); // regen during the dash
    expect(w.summonerBlocker(me, 0)).toBe('cooldown');
  });

  it('a missed Tether only costs a short cooldown', () => {
    const { w, me, summon } = duel(['tether', 'flash']);
    summon(0, 0, -10); // nothing up there
    run(w, 1);
    const left = (me.champ!.summoners[0].readyAt - w.tick) / TICK_HZ;
    expect(left).toBeLessThan(TETHER.missCooldown);
    expect(left).toBeGreaterThan(TETHER.missCooldown - 2);
  });
});
