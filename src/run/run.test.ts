import { describe, expect, it } from 'vitest';
import { AUGMENTS } from '../sim/augments';
import { DUEL_RULES } from '../sim/rules';
import { ITEMS, MAX_ITEMS } from '../sim/items';
import { FLOORS, WIN_BONUS, advance, augmentOffers, buy, cantBuy, floorPlan, loadout, newRun, reroll, shopStock } from './run';

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
    advance(run, { floor: 0, won: true, reason: 'kills', opponent: 'tock', seconds: 100, gold: 0 }, offers[0]);
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

  const win = (gold: number) => ({ floor: 0, won: true, reason: 'kills' as const, opponent: 'tock' as const, seconds: 100, gold });

  it('a win banks duel gold plus the bonus and opens the shop', () => {
    const run = newRun('arlo', 5);
    advance(run, win(600), null);
    expect(run.gold).toBe(600 + WIN_BONUS);
    expect(run.shopping).toBe(true);
  });

  it('the shop sells its stock once, within budget and slots', () => {
    const run = newRun('arlo', 5);
    advance(run, win(5000), null);
    const stock = shopStock(run);
    expect(stock).toHaveLength(5);
    expect(shopStock(run)).toEqual(stock); // seeded
    const id = stock[0];
    expect(buy(run, id)).toBe(true);
    expect(run.items).toEqual([id]);
    expect(run.gold).toBe(5000 + WIN_BONUS - ITEMS[id].cost);
    expect(cantBuy(run, id)).toBe('Sold out');
    expect(shopStock(run)).toEqual(stock); // buying doesn't reshuffle the shelf
    run.gold = 0;
    expect(cantBuy(run, stock[1])).toBe('Not enough gold');
    run.gold = 99999;
    run.items = Array(MAX_ITEMS).fill('i.blade');
    expect(cantBuy(run, stock[1])).toBe('Inventory full');
  });

  it('consumables last one duel; the tome adds a level; tokens add rerolls', () => {
    const run = newRun('arlo', 5);
    advance(run, win(2000), null);
    buy(run, 'c.elixir');
    buy(run, 'c.tome');
    buy(run, 'c.reroll');
    expect(run.rerolls).toBe(2);
    expect(loadout(run)).toEqual({ items: ['c.elixir'], extraLevels: 1 });
    advance(run, win(0), null);
    expect(run.consumables).toEqual([]);
  });

  it('opponents bring items from a growing budget', () => {
    const run = newRun('arlo', 9);
    expect(floorPlan(run).opponentItems).toEqual([]);
    run.floor = 4;
    const items = floorPlan(run).opponentItems;
    const spent = items.reduce((t, id) => t + ITEMS[id].cost, 0);
    expect(items.length).toBeGreaterThan(0);
    expect(spent).toBeLessThanOrEqual(4 * 800);
    expect(items.every((id) => !ITEMS[id].consumable)).toBe(true);
  });
});
