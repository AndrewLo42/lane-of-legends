import { describe, expect, it } from 'vitest';
import { BotController } from './bot';
import { KITS } from './kits';
import type { Command, Controller, KitId, Slot, Unit } from './types';
import { TICK_HZ } from './util';
import { World, xpToNext } from './world';

/** A controller you push commands into between steps. */
class Script implements Controller {
  queue: Command[] = [];
  think() {
    const q = this.queue;
    this.queue = [];
    return q;
  }
}

const run = (w: World, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * TICK_HZ); i++) w.step();
};

/** A champion of `kit` in mid-lane with every ability at `rank` (R at most 2) and plenty of mana. */
function setup(kit: KitId, rank = 1) {
  const w = new World(1);
  const ctl = new Script();
  const me = w.spawnChampion('blue', kit, ctl);
  me.pos = { x: 0, y: 0 };
  me.champ!.level = 11;
  me.champ!.maxMana = me.champ!.mana = 2000;
  me.champ!.abilities.forEach((a, i) => (a.rank = i === 3 ? Math.min(rank, 2) : rank));
  me.range = 0; // no auto-acquiring the dummies, so only ability damage lands (tests that want autos restore it)
  const cast = (slot: Slot, x: number, y = 0) => {
    ctl.queue.push({ type: 'cast', slot, at: { x, y } });
    w.step();
  };
  return { w, ctl, me, cast };
}

/** An enemy champion that stands still. */
function dummy(w: World, x: number, y = 0, kit: KitId = 'arlo') {
  const d = w.spawnChampion('red', kit, { think: () => [] });
  d.pos = { x, y };
  d.maxHp = d.hp = 5000;
  return d;
}

const lost = (u: Unit) => u.maxHp - u.hp;
/** Dummies regenerate 2 HP/s, so damage checks allow a few points of slack. */
const near = (actual: number, expected: number, slack = 8) => expect(Math.abs(actual - expected)).toBeLessThan(slack);

describe('Arlo', () => {
  it('Sparkshot hits the first enemy in line and shortens all cooldowns', () => {
    const { w, me, cast } = setup('arlo');
    const shield = w.spawnMinion('red', 'melee', { x: 4, y: 0 });
    shield.speed = 0;
    const behind = dummy(w, 8);
    me.champ!.abilities[2].readyAt = w.tick + 10 * TICK_HZ;
    const eBefore = me.champ!.abilities[2].readyAt;
    cast(0, 10);
    run(w, 1);
    expect(shield.hp).toBeLessThan(shield.maxHp);
    expect(lost(behind)).toBe(0);
    expect(me.champ!.abilities[2].readyAt).toBe(eBefore - 1.5 * TICK_HZ);
  });

  it('Rune Flare passes minions, marks the champion, and an attack detonates it for mana', () => {
    const { w, me, ctl, cast } = setup('arlo');
    w.spawnMinion('red', 'melee', { x: 2.5, y: 0 }).speed = 0;
    const target = dummy(w, 5);
    cast(1, 10);
    run(w, 0.6);
    expect(w.status(target, 'mark', me.id)).toBeDefined();
    expect(lost(target)).toBe(0);
    me.champ!.mana = 500;
    const mana = me.champ!.mana;
    const hp = target.hp;
    me.range = KITS.arlo.stats.range;
    ctl.queue.push({ type: 'attack', target: target.id }); // an auto pops the mark
    run(w, 1);
    expect(w.status(target, 'mark', me.id)).toBeUndefined();
    expect(hp - target.hp).toBeGreaterThan(KITS.arlo.abilities[1].damage!(1, me));
    expect(me.champ!.mana).toBeGreaterThan(mana + 50);
  });

  it('Phase Step blinks at most 4.5 units and its bolt finds the nearest enemy', () => {
    const { w, me, cast } = setup('arlo');
    const target = dummy(w, 8, 2);
    cast(2, 20);
    expect(me.pos.x).toBeCloseTo(4.5, 5);
    run(w, 1);
    near(lost(target), KITS.arlo.abilities[2].damage!(1, me));
  });

  it('Skyline Barrage roots for its wind-up, then pierces everything; minions take half', () => {
    const { w, me, cast } = setup('arlo');
    const m = w.spawnMinion('red', 'melee', { x: 6, y: 0 });
    m.speed = 0;
    m.maxHp = m.hp = 5000;
    const far = dummy(w, 30); // (not 40: that's the red tower, which would shove the dummy aside)
    cast(3, 50);
    expect(w.telegraphs).toHaveLength(1);
    expect(w.isBusy(me)).toBe(true);
    run(w, 3);
    const full = KITS.arlo.abilities[3].damage!(1, me);
    near(lost(far), full);
    expect(m.maxHp - m.hp).toBeCloseTo(full / 2, 5);
  });

  it('Momentum stacks attack speed from ability hits', () => {
    const { w, me, cast } = setup('arlo');
    dummy(w, 5);
    const slow = w.attackTicks(me);
    cast(0, 10);
    run(w, 0.5);
    expect(w.status(me, 'momentum')?.value).toBe(1);
    expect(w.attackTicks(me)).toBeLessThan(slow);
  });
});

describe('Tock', () => {
  it('Pendulum hits a cone; the backswing hits twice-caught enemies harder', () => {
    const { w, me, cast } = setup('tock');
    const front = dummy(w, 2.5);
    const behind = dummy(w, -2.5);
    cast(0, 5);
    run(w, 0.4);
    const first = lost(front);
    near(first, KITS.tock.abilities[0].damage!(1, me));
    expect(lost(behind)).toBe(0);
    cast(0, 5); // recast the same way
    run(w, 0.3);
    near(lost(front) - first, KITS.tock.abilities[0].damage!(1, me) * 1.5);
  });

  it('Stopwatch freezes enemy skillshots, which crumble when it ends', () => {
    const { w, me, cast } = setup('tock');
    const arloCtl = new Script();
    const arlo = w.spawnChampion('red', 'arlo', arloCtl);
    arlo.pos = { x: 9, y: 0 };
    arlo.champ!.abilities[0].rank = 1;
    cast(1, 4); // field between us
    arloCtl.queue.push({ type: 'cast', slot: 0, at: { x: 0, y: 0 } });
    run(w, 0.8);
    expect(w.missiles.some((m) => m.frozenBy != null && m.style === 'spark')).toBe(true);
    run(w, 3);
    expect(w.missiles.some((m) => m.style === 'spark')).toBe(false);
    expect(me.hp).toBe(me.maxHp);
  });

  it('Skip dashes through enemies, then the recast snaps back to the echo', () => {
    const { w, me, cast } = setup('tock');
    const target = dummy(w, 3, 0.3);
    cast(2, 10);
    run(w, 0.5);
    expect(me.pos.x).toBeGreaterThan(4);
    near(lost(target), KITS.tock.abilities[2].damage!(1, me));
    cast(2, 0);
    expect(me.pos.x).toBeCloseTo(0, 5);
  });

  it('Rewind returns to the anchor, restores lost health and replays damage dealt', () => {
    const { w, me, cast } = setup('tock');
    const target = dummy(w, 30);
    cast(3, 0);
    me.pos = { x: 5, y: 3 };
    me.hp -= 300;
    w.dealDamage(me, target, 200, { attack: true });
    run(w, 3.1);
    expect(me.pos).toEqual({ x: 0, y: 0 });
    expect(me.hp).toBeGreaterThan(me.maxHp - 20); // regen ticks a little too
    near(lost(target), 200 * 1.5);
  });

  it('Second Hand echoes every third attack', () => {
    const { w, me, ctl } = setup('tock');
    const target = dummy(w, 1.8);
    me.range = KITS.tock.stats.range;
    me.champ!.level = 1; // no level attack speed, so the timing below holds
    ctl.queue.push({ type: 'attack', target: target.id });
    run(w, 2.45); // attacks start at 0, 0.85 and 1.7s; the third one's echo lands 0.4s after it hits
    near(lost(target), me.damage * 3 + me.damage * 0.6);
  });
});

describe('levels and resources', () => {
  it('minion deaths nearby grant XP and level-ups grant skill points', () => {
    const w = new World(1);
    const me = w.spawnChampion('blue', 'arlo', { think: () => [] });
    me.pos = { x: 0, y: 0 };
    w.grantXp(me, xpToNext(1));
    expect(me.champ!.level).toBe(2);
    expect(me.champ!.abilities[0].rank).toBe(1); // the level-1 point goes into Q automatically
    expect(me.champ!.skillPoints).toBe(1);
    const m = w.spawnMinion('red', 'melee', { x: 3, y: 0 });
    w.dealDamage(null, m, 9999);
    expect(me.champ!.xp).toBe(70);
  });

  it('enforces rank caps: basic <= ceil(level/2), ultimate at 6 and 11', () => {
    const w = new World(1);
    const me = w.spawnChampion('blue', 'arlo', { think: () => [] });
    me.champ!.skillPoints = 5;
    expect(w.canLevel(me, 3)).toBe(false);
    me.champ!.abilities[0].rank = 1;
    expect(w.canLevel(me, 0)).toBe(false); // level 1: one rank max
    me.champ!.level = 6;
    expect(w.canLevel(me, 3)).toBe(true);
    expect(w.canLevel(me, 0)).toBe(true);
  });

  it('casting needs rank, mana and an off-cooldown ability', () => {
    const { w, me } = setup('arlo');
    me.champ!.abilities[1].rank = 0;
    expect(w.castBlocker(me, 1)).toBe('rank');
    me.champ!.mana = 0;
    expect(w.castBlocker(me, 0)).toBe('mana');
    me.champ!.mana = 500;
    me.champ!.abilities[0].readyAt = w.tick + 10;
    expect(w.castBlocker(me, 0)).toBe('cooldown');
  });
});

describe('bots', () => {
  for (const [blue, red] of [['arlo', 'tock'], ['tock', 'arlo'], ['arlo', 'arlo']] as const) {
    it(`${blue} vs ${red}: both level up and use their abilities`, () => {
      const w = new World(3);
      const a = w.spawnChampion('blue', blue, new BotController());
      const b = w.spawnChampion('red', red, new BotController());
      run(w, 240);
      for (const c of [a, b]) {
        expect(c.champ!.level).toBeGreaterThanOrEqual(5);
        expect(c.champ!.abilities.slice(0, 3).every((s) => s.rank > 0)).toBe(true);
        expect(c.champ!.abilities.some((s) => s.readyAt > 0)).toBe(true); // has cast something
      }
    });
  }
});
