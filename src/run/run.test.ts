import { describe, expect, it } from 'vitest';
import { AUGMENTS } from '../sim/augments';
import { DUEL_RULES } from '../sim/rules';
import { FLOORS, advance, augmentOffers, floorPlan, newRun, reroll } from './run';

describe('run', () => {
  it('floor plans are deterministic per seed', () => {
    const a = newRun('arlo', 42);
    const b = newRun('arlo', 42);
    for (let f = 0; f < FLOORS.length; f++) {
      a.floor = b.floor = f;
      const pa = floorPlan(a);
      const pb = floorPlan(b);
      expect({ ...pa, modifier: pa.modifier?.id }).toEqual({ ...pb, modifier: pb.modifier?.id });
    }
  });

  it('floor 1 is plain; later floors each get a different modifier and more enemy augments', () => {
    const run = newRun('tock', 7);
    const first = floorPlan(run);
    expect(first.modifier).toBeNull();
    expect(first.opponentAugments).toEqual([]);
    expect(first.rules).toEqual(DUEL_RULES);
    const mods = new Set<string>();
    for (let f = 1; f < FLOORS.length; f++) {
      run.floor = f;
      const p = floorPlan(run);
      mods.add(p.modifier!.id);
      expect(p.opponentAugments.map((id) => AUGMENTS[id].tier)).toEqual(FLOORS[f].enemyAugments);
      expect(new Set(p.opponentAugments).size).toBe(p.opponentAugments.length);
    }
    expect(mods.size).toBe(FLOORS.length - 1);
  });

  it('offers three unowned augments of the reward tier, and rerolls change them', () => {
    const run = newRun('arlo', 3);
    const offers = augmentOffers(run);
    expect(offers).toHaveLength(3);
    expect(offers.every((id) => AUGMENTS[id].tier === 'silver')).toBe(true);
    advance(run, { floor: 0, won: true, reason: 'kills', opponent: 'tock', seconds: 100 }, offers[0]);
    expect(augmentOffers(run)).not.toContain(offers[0]);
    expect(augmentOffers(run).every((id) => AUGMENTS[id].tier === 'gold')).toBe(true);
    const before = augmentOffers(run);
    expect(reroll(run)).toBe(true);
    expect(augmentOffers(run)).not.toEqual(before);
    expect(reroll(run)).toBe(false); // one per run
  });

  it('the boss floor offers nothing afterwards', () => {
    const run = newRun('arlo', 1);
    run.floor = FLOORS.length - 1;
    expect(augmentOffers(run)).toEqual([]);
  });
});
