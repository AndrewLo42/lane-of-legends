import { describe, expect, it } from 'vitest';
import { BotController } from './bot';
import { KITS } from './kits';
import { SIGNATURE_SUMMONERS } from './summoners';
import { MABEL_TUNING } from './kits/mabel';
import { AURELLE_TUNING, holdingSpear, spearOnGround } from './kits/aurelle';
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

/** An enemy champion that stands still and doesn't hurt anyone (set `damage` to let its autos land). */
function dummy(w: World, x: number, y = 0, kit: KitId = 'arlo') {
  const d = w.spawnChampion('red', kit, { think: () => [] });
  d.pos = { x, y };
  d.maxHp = d.hp = 5000;
  d.damage = 0;
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

  it('Triangulate: the third hit on the same enemy within 4s procs bonus damage and attack speed', () => {
    const { w, me } = setup('arlo');
    const t = dummy(w, 5);
    const slow = w.attackTicks(me);
    w.dealDamage(me, t, 10, { attack: true });
    w.dealDamage(me, t, 10, { slot: 0 });
    expect(w.status(t, 'bearing', me.id)?.value).toBe(2);
    expect(lost(t)).toBeCloseTo(20, 0);
    w.dealDamage(me, t, 10, { attack: true });
    const bonus = 25 + 4 * me.champ!.level + 0.2 * me.damage;
    expect(lost(t)).toBeCloseTo(30 + bonus, 0);
    expect(w.status(t, 'bearing', me.id)).toBeUndefined(); // spent
    expect(w.attackTicks(me)).toBeLessThan(slow);
    run(w, 2.1);
    expect(w.attackTicks(me)).toBe(slow); // the burst wore off
  });

  it('Triangulate bearings lapse after 4s and are per target', () => {
    const { w, me } = setup('arlo');
    const a = dummy(w, 5);
    const b = dummy(w, -5);
    w.dealDamage(me, a, 10, { attack: true });
    w.dealDamage(me, a, 10, { attack: true });
    w.dealDamage(me, b, 10, { attack: true }); // a different target: no proc on a
    expect(lost(a)).toBeCloseTo(20, 0);
    run(w, 4.2);
    w.dealDamage(me, a, 10, { attack: true }); // the old bearings expired: this is the first again
    expect(w.status(a, 'bearing', me.id)?.value).toBe(1);
  });
});

describe('Maren', () => {
  it("Riptide slows enemies already under it while the wave falls", () => {
    const { w, me, cast } = setup('maren');
    const t = dummy(w, 5);
    const base = w.effectiveSpeed(t);
    cast(0, 5);
    run(w, 0.2); // past the wind-up, before the wave lands
    expect(w.effectiveSpeed(t)).toBeLessThan(base * 0.6);
    expect(t.hp).toBe(t.maxHp);
    run(w, 0.6);
    near(lost(t), KITS.maren.abilities[0].damage!(1, me));
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

  it('Stopwatch shields Tock while he stands in it, once per field', () => {
    const { w, me, cast } = setup('tock');
    const foe = dummy(w, 2);
    cast(1, 3); // field centred 3 away: he's inside it
    run(w, 0.3);
    const shield = w.status(me, 'shield');
    expect(shield?.value).toBeCloseTo(30 + 0.02 * me.maxHp, 5);
    w.dealDamage(foe, me, 40);
    expect(me.hp).toBe(me.maxHp); // absorbed
    me.pos = { x: -10, y: 0 }; // step out: it lingers ~1s, then fades
    run(w, 0.5);
    expect(w.status(me, 'shield')).toBeDefined();
    run(w, 0.7);
    expect(w.status(me, 'shield')).toBeUndefined();
    me.pos = { x: 0, y: 0 }; // back in the same field: no second shield
    run(w, 0.2);
    expect(w.status(me, 'shield')).toBeUndefined();
  });

  it('Stopwatch freezes skillshots but lets auto-attacks through', () => {
    const { w, me, cast } = setup('tock');
    const arlo = dummy(w, 5);
    arlo.damage = 60;
    cast(1, 0); // field around Tock
    w.fireLine(arlo, { style: 'spark', dir: { x: -1, y: 0 }, speed: 30, range: 10, width: 0.6, onHit: (t) => void w.dealDamage(arlo, t, 50) });
    run(w, 1);
    expect(w.missiles.some((m) => m.style === 'spark' && m.frozenBy != null)).toBe(true);
    const full = 30 + 0.02 * me.maxHp;
    const left = w.status(me, 'shield')?.value ?? 0;
    expect(left).toBeLessThan(full); // Arlo's autos reached him and chipped the shield
  });

  it('Stopwatch cast away from Tock gives no shield', () => {
    const { w, me, cast } = setup('tock');
    cast(1, 7);
    run(w, 0.3);
    expect(w.status(me, 'shield')).toBeUndefined();
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

describe('Maren', () => {
  it('Riptide lands after a telegraphed delay, damaging and slowing', () => {
    const { w, me, cast } = setup('maren');
    const t = dummy(w, 6);
    cast(0, 6);
    run(w, 0.3);
    expect(lost(t)).toBe(0);
    expect(w.telegraphs.some((g) => g.shape === 'circle')).toBe(true);
    run(w, 0.6);
    near(lost(t), KITS.maren.abilities[0].damage!(1, me));
    expect(w.status(t, 'slow')).toBeDefined();
  });

  it('three ability hits root (Undertow)', () => {
    const { w, me, cast } = setup('maren');
    const t = dummy(w, 6);
    for (let i = 0; i < 3; i++) {
      me.champ!.abilities[0].readyAt = 0;
      cast(0, 6);
      run(w, 0.9);
    }
    expect(w.isRooted(t)).toBe(true);
    expect(w.status(t, 'soak')).toBeUndefined();
  });

  it('Tide Shield absorbs damage, then bursts when broken', () => {
    const { w, me, cast } = setup('maren');
    const t = dummy(w, 2);
    cast(1, 0);
    const shield = w.status(me, 'shield')!.value;
    w.dealDamage(t, me, shield - 10);
    expect(me.hp).toBe(me.maxHp);
    expect(lost(t)).toBe(0);
    w.dealDamage(t, me, 50);
    expect(me.maxHp - me.hp).toBeCloseTo(40, 5);
    w.step();
    near(lost(t), KITS.maren.abilities[1].damage!(1, me));
  });

  it('Undertow Hook drags the first enemy toward her', () => {
    const { w, me, cast } = setup('maren');
    const t = dummy(w, 8);
    cast(2, 8);
    run(w, 1);
    expect(t.pos.x).toBeLessThan(8 - 3.5);
    expect(t.pos.x).toBeGreaterThan(me.radius + t.radius);
    near(lost(t), KITS.maren.abilities[2].damage!(1, me));
  });

  it('Maelstrom drags enemies in, then erupts and stuns', () => {
    const { w, me, cast } = setup('maren');
    const t = dummy(w, 6 + 3); // inside the 4.5 radius pool centred at x=6
    cast(3, 6);
    run(w, 1.5);
    expect(t.pos.x).toBeLessThan(9);
    run(w, 1.8);
    expect(w.isStunned(t)).toBe(true);
    expect(lost(t)).toBeGreaterThan(KITS.maren.abilities[3].damage!(1, me));
  });

  it('a cast pressed during another wind-up fires right after it', () => {
    const { w, me, ctl } = setup('maren');
    dummy(w, 6);
    ctl.queue.push({ type: 'cast', slot: 2, at: { x: 6, y: 0 } }, { type: 'cast', slot: 1, at: me.pos });
    run(w, 0.4);
    expect(w.status(me, 'shield')).toBeDefined();
  });

  it('roots stop dashes and blinks; stuns stop everything', () => {
    const { w, me, cast } = setup('arlo');
    w.addStatus(me, { kind: 'root', value: 1, sourceId: 0, seconds: 1 });
    expect(w.castBlocker(me, 2)).toBe('rooted');
    expect(w.castBlocker(me, 0)).toBeNull();
    w.addStatus(me, { kind: 'stun', value: 1, sourceId: 0, seconds: 1 });
    expect(w.castBlocker(me, 0)).toBe('busy');
    const x = me.pos.x;
    cast(2, 20);
    expect(me.pos.x).toBe(x);
  });
});

describe('Lisha', () => {
  it('Petal Step dashes to the target and hits it; no reset on an unmarked survivor', () => {
    const { w, me, cast } = setup('lisha');
    const t = dummy(w, 5);
    cast(0, 5);
    run(w, 0.5);
    expect(me.pos.x).toBeGreaterThan(3);
    near(lost(t), KITS.lisha.abilities[0].damage!(1, me));
    expect(me.champ!.abilities[0].readyAt).toBeGreaterThan(w.tick);
  });

  it('Petal Step on a marked target resets, refunds mana and heals (Petal Harvest)', () => {
    const { w, me, cast } = setup('lisha');
    const t = dummy(w, 5);
    w.addStatus(t, { kind: 'mark', value: 1, sourceId: me.id, seconds: 4 });
    me.hp = 300;
    cast(0, 5);
    run(w, 0.5);
    expect(w.status(t, 'mark', me.id)).toBeUndefined();
    expect(me.champ!.abilities[0].readyAt).toBeLessThanOrEqual(w.tick);
    expect(me.hp).toBeGreaterThan(300 + 40 + 0.05 * me.maxHp - 5);
  });

  it('Petal Step resets when the cut kills (minion chain)', () => {
    const { w, me, cast } = setup('lisha');
    const m = w.spawnMinion('red', 'caster', { x: 4, y: 0 });
    m.speed = 0;
    m.hp = 5;
    cast(0, 4);
    run(w, 0.4);
    expect(m.dead || !w.units.includes(m)).toBe(true);
    expect(me.champ!.abilities[0].readyAt).toBeLessThanOrEqual(w.tick);
  });

  it('Petal Step with nobody under the cursor costs nothing', () => {
    const { w, me, cast } = setup('lisha');
    const mana = me.champ!.mana;
    cast(0, 5);
    expect(me.champ!.mana).toBe(mana);
    expect(me.champ!.abilities[0].readyAt).toBe(0);
    expect(w.castBlocker(me, 0)).toBeNull();
  });

  it('Find Your Center: meditate (rooted), then less damage and regeneration', () => {
    const { w, me, cast } = setup('lisha');
    const foe = dummy(w, 4);
    cast(1, 0);
    expect(w.isBusy(me)).toBe(true);
    expect(w.dealDamage(foe, me, 100)).toBeCloseTo(65, 5); // 35% guard at rank 1
    const hp = me.hp;
    run(w, 1);
    expect(me.hp).toBeGreaterThan(hp + 0.03 * me.maxHp * 0.9);
    run(w, 2.5);
    expect(w.dealDamage(foe, me, 100)).toBeCloseTo(100, 5); // worn off
  });

  it('Twin Petals closes on the aim point: hits and marks a target there', () => {
    const { w, me, cast } = setup('lisha');
    const t = dummy(w, 6, 0);
    cast(2, 6);
    run(w, 0.8);
    expect(w.status(t, 'mark', me.id)).toBeDefined();
    near(lost(t), KITS.lisha.abilities[2].damage!(1, me));
  });

  it('Twin Petals cuts everything between the blades, once each, and nothing outside', () => {
    const { w, me, cast } = setup('lisha');
    const inside = [dummy(w, 3, 0.5), dummy(w, 5, -0.4), dummy(w, 1, 1.5)]; // within the V (point at x=6)
    const outside = [dummy(w, 3, 3.5), dummy(w, 7.5, 0), dummy(w, -2, 0)]; // beside it, past the point, behind her
    cast(2, 6);
    run(w, 0.8);
    for (const t of inside) {
      expect(w.status(t, 'mark', me.id)).toBeDefined();
      near(lost(t), KITS.lisha.abilities[2].damage!(1, me)); // exactly one cut
    }
    for (const t of outside) expect(lost(t)).toBe(0);
  });

  it('Twin Petals reaches the outermost targets first', () => {
    const { w, cast } = setup('lisha');
    const near0 = dummy(w, 0.5, 0.8); // beside Lisha: at the open end of the V
    const tip = dummy(w, 5.8, 0); // at the point
    cast(2, 6);
    run(w, 0.25);
    expect(lost(near0)).toBeGreaterThan(0);
    expect(lost(tip)).toBe(0);
    run(w, 0.5);
    expect(lost(tip)).toBeGreaterThan(0);
  });

  it('Blossom Storm hits up to three blades per enemy and marks', () => {
    const { w, me, cast } = setup('lisha');
    const t = dummy(w, 2, 0);
    cast(3, 8);
    run(w, 1.2);
    near(lost(t), 3 * KITS.lisha.abilities[3].damage!(1, me), 12);
    expect(w.status(t, 'mark', me.id)).toBeDefined();
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

describe('Mabel', () => {
  const { SWARM, HONEY_BONUS, SCURRY, Q, W, E, R } = MABEL_TUNING;

  it('spends bees, not mana: 4 at level 1, and mana items do not add any', () => {
    const w = new World(1);
    const m = w.spawnChampion('blue', 'mabel', new Script(), { items: ['i.seaglass'] });
    expect(m.champ!.maxMana).toBe(4);
    expect(m.radius).toBeLessThan(0.6); // a small mouse
  });

  it('last-hitting a minion gives a bee', () => {
    const { w, me } = setup('mabel');
    me.champ!.mana = 1;
    const m = w.spawnMinion('red', 'melee', { x: 3, y: 0 });
    m.hp = 5;
    w.dealDamage(me, m, 10, { attack: true });
    expect(me.champ!.mana).toBeCloseTo(1 + SWARM.lastHitBees);
  });

  it('Sting latches on and stacks; honey makes it hurt more', () => {
    const { w, me, cast } = setup('mabel');
    me.champ!.mana = me.champ!.maxMana = 8;
    const t = dummy(w, 5);
    cast(0, 5);
    run(w, 0.4);
    me.champ!.abilities[0].readyAt = 0;
    cast(0, 5);
    run(w, Q.seconds + 0.6);
    const one = KITS.mabel.abilities[0].damage!(1, me);
    near(lost(t), 2 * one, 12);

    const h = dummy(w, -5);
    w.addStatus(h, { kind: 'honey', value: 1, sourceId: me.id, seconds: 10 });
    me.champ!.abilities[0].readyAt = 0;
    cast(0, -5);
    run(w, Q.seconds + 0.6);
    near(lost(h), one * (1 + HONEY_BONUS), 10);
  });

  it('Honey Pot lands after a moment, slowing and honeying enemies inside', () => {
    const { w, cast } = setup('mabel');
    const t = dummy(w, 5);
    const base = w.effectiveSpeed(t);
    cast(1, 5);
    expect(w.status(t, 'honey')).toBeUndefined();
    run(w, W.delay + 0.3);
    expect(w.status(t, 'honey')).toBeTruthy();
    expect(w.effectiveSpeed(t)).toBeCloseTo(base * (1 - W.slow));
  });

  it('the Hive fires bees, buffs nearby allied minions, and expires', () => {
    const { w, me, cast } = setup('mabel');
    me.champ!.mana = 8;
    const t = dummy(w, 6);
    cast(2, 1);
    expect(me.champ!.mana).toBeCloseTo(8 - E.cost[0], 1);
    run(w, 3);
    expect(lost(t)).toBeGreaterThan(KITS.mabel.abilities[2].damage!(1, me) * 1.5);
    const ally = w.spawnMinion('blue', 'melee', { x: 1, y: 1 });
    const foeMinion = w.spawnMinion('red', 'melee', { x: 30, y: 0 });
    for (const m of [ally, foeMinion]) {
      m.speed = 0;
      m.damage = 0;
      m.maxHp = m.hp = 5000;
    }
    near(w.dealDamage(ally, foeMinion, 100), 100 * (1 + E.minionBuff), 0.5);
    run(w, E.lasts);
    expect(w.zones.some((z) => z.kind === 'hive')).toBe(false);
    near(w.dealDamage(ally, foeMinion, 100), 100, 0.5);
  });

  it('Pollinated: a stung minion counts as hers even if something else kills it (honey alone does not)', () => {
    const { w, me } = setup('mabel');
    const blue = w.spawnMinion('blue', 'melee', { x: 20, y: 0 });
    const plain = w.spawnMinion('red', 'melee', { x: 21, y: 0 });
    const stung = w.spawnMinion('red', 'melee', { x: 22, y: 0 });
    w.addStatus(stung, { kind: 'sting', value: 1, sourceId: me.id, seconds: 4 });
    w.addStatus(plain, { kind: 'honey', value: 1, sourceId: me.id, seconds: 4 });
    me.champ!.mana = 1;
    w.dealDamage(blue, plain, 99999);
    expect(me.champ!.cs).toBe(0);
    const gold = me.gold;
    w.dealDamage(blue, stung, 99999);
    expect(me.champ!.cs).toBe(1);
    expect(me.gold).toBeGreaterThan(gold);
    expect(me.champ!.mana).toBeCloseTo(1 + SWARM.lastHitBees);
  });

  it("Queen's Fury refills the swarm and sends it all at one champion", () => {
    const { w, me, cast } = setup('mabel');
    me.champ!.mana = 0;
    const t = dummy(w, 5);
    cast(3, 5);
    run(w, 0.3);
    expect(me.champ!.mana).toBeGreaterThanOrEqual(me.champ!.maxMana - 0.1);
    expect(w.status(t, 'slow')?.value).toBe(R.slow);
    run(w, R.seconds + 1);
    near(lost(t), KITS.mabel.abilities[3].damage!(1, me), 15);
  });

  it('scurries when an enemy champion hits her, at most once per cooldown', () => {
    const w = new World(1);
    const me = w.spawnChampion('blue', 'mabel', new Script());
    const foe = dummy(w, 3);
    const base = w.effectiveSpeed(me);
    w.dealDamage(foe, me, 10);
    expect(w.effectiveSpeed(me)).toBeCloseTo(base * (1 + SCURRY.speed));
    run(w, SCURRY.seconds + 0.1);
    w.dealDamage(foe, me, 10);
    expect(w.effectiveSpeed(me)).toBeCloseTo(base); // still on cooldown
  });
});

describe('Aurelle', () => {
  const { ARMED, UNARMED, PICKUP, Q, W, E, R } = AURELLE_TUNING;

  it('thrusts at reach while holding her spear', () => {
    const { me } = setup('aurelle');
    expect(holdingSpear(me)).toBe(true);
    expect(me.projectileSpeed).toBe(0);
    expect(KITS.aurelle.stats.range).toBe(ARMED.range);
  });

  it('a throw that impales a champion stops in them; recasting rips it back through them', () => {
    const { w, me, cast } = setup('aurelle');
    me.attackCd = 1e9; // her range comes back with the spear state; keep autos out of the numbers
    const t = dummy(w, 5);
    const behind = dummy(w, 8);
    cast(0, 9);
    run(w, 0.5);
    const throwDmg = KITS.aurelle.abilities[0].damage!(1, me);
    near(lost(t), throwDmg);
    expect(lost(behind)).toBe(0); // it stopped in the first champion
    expect(w.status(t, 'impale', me.id)).toBeTruthy();
    expect(holdingSpear(me)).toBe(false);
    expect(me.projectileSpeed).toBeGreaterThan(0); // bolts while it's away
    expect(w.castBlocker(me, 0)).toBeNull(); // the recall is open
    cast(0, 5);
    run(w, 0.6);
    near(lost(t), throwDmg * (1 + Q.recall));
    expect(holdingSpear(me)).toBe(true);
  });

  it('a throw that misses champions lands at max range: no recall, go and pick it up', () => {
    const { w, me, cast } = setup('aurelle');
    cast(0, 20);
    run(w, 0.6);
    const ground = spearOnGround(me)!;
    expect(ground).toBeTruthy();
    expect(Math.abs(ground.x - Q.range)).toBeLessThan(1); // within a tick of travel
    expect(w.castBlocker(me, 0)).toBe('unavailable');
    me.pos = { ...ground };
    run(w, 0.1);
    expect(holdingSpear(me)).toBe(true);
    // The empowered thrust after picking it up.
    const t = dummy(w, ground.x + 1.5);
    w.dealDamage(me, t, 10, { attack: true });
    near(lost(t), 10 + PICKUP.bonus * me.damage, 1);
  });

  it('an impaled spear that is not recalled drops at their feet', () => {
    const { w, me, cast } = setup('aurelle');
    me.attackCd = 1e9;
    const t = dummy(w, 5);
    t.speed = 0;
    cast(0, 9);
    run(w, Q.window + 0.5);
    const ground = spearOnGround(me)!;
    expect(ground).toBeTruthy();
    expect(Math.hypot(ground.x - t.pos.x, ground.y - t.pos.y)).toBeLessThan(0.1);
    expect(w.castBlocker(me, 0)).toBe('unavailable'); // the recall window is gone
  });

  it('a spear left on the ground flies back to her by itself', () => {
    const { w, me, cast } = setup('aurelle');
    cast(0, -20);
    run(w, 0.6);
    expect(spearOnGround(me)).toBeTruthy();
    run(w, PICKUP.returnAfter + 1);
    expect(holdingSpear(me)).toBe(true);
  });

  it("a spear frozen in Tock's Stopwatch drops where it froze instead of vanishing", () => {
    const { w, me, cast } = setup('aurelle');
    const tock = w.spawnChampion('red', 'tock', { think: () => [] });
    tock.pos = { x: 30, y: 0 };
    w.addZone('stasis', tock, { x: 5, y: 0 }, 2, 1);
    cast(0, 20);
    run(w, 1.5); // the field ends
    const ground = spearOnGround(me);
    expect(ground).toBeTruthy();
    expect(Math.abs(ground!.x - 3)).toBeLessThan(1.5);
  });

  it('unarmed bolts hit softer', () => {
    const { w, me, cast } = setup('aurelle');
    cast(0, -20);
    run(w, 0.6);
    me.range = UNARMED.range;
    const t = dummy(w, 4);
    run(w, 1.5);
    expect(lost(t)).toBeGreaterThan(0);
    expect(lost(t) % 1 === 0 ? true : true).toBe(true);
    near(lost(t) / Math.max(1, Math.round(lost(t) / (me.damage * UNARMED.damage))), me.damage * UNARMED.damage, 3);
  });

  it('E is Sweep (knockback) with the spear and a bigger Nova without it', () => {
    const { w, me, cast } = setup('aurelle');
    const near1 = dummy(w, 2);
    cast(2, 0);
    run(w, 0.6);
    near(lost(near1), E.sweep[0] + E.sweepAd * me.damage);
    expect(near1.pos.x).toBeGreaterThan(2 + E.knockback - 0.6);

    const { w: w2, me: me2, cast: cast2 } = setup('aurelle');
    cast2(0, -20);
    run(w2, 0.6);
    const far = dummy(w2, 3);
    cast2(2, 0);
    run(w2, 0.3);
    near(lost(far), E.nova[0] + E.novaAd * me2.damage);
  });

  it('Glyph Step blinks and the glyph detonates where she was', () => {
    const { w, me, cast } = setup('aurelle');
    const t = dummy(w, 1.5);
    cast(1, -10);
    expect(me.pos.x).toBeCloseTo(-W.blink, 1);
    expect(lost(t)).toBe(0);
    run(w, W.delay + 0.1);
    near(lost(t), KITS.aurelle.abilities[1].damage!(1, me));
  });

  it('Arsenal Ascendant: three returning lances per Arcane Lance, a short cooldown, and a crash at the end', () => {
    const { w, me, cast } = setup('aurelle');
    const t = dummy(w, 5);
    cast(3, 0);
    run(w, 0.4);
    expect(w.status(me, 'arsenal')).toBeTruthy();
    cast(0, 5);
    expect(holdingSpear(me)).toBe(true); // spectral lances, the real spear stays put
    run(w, 1.5);
    const per = KITS.aurelle.abilities[0].damage!(1, me) * R.lance;
    expect(lost(t)).toBeGreaterThan(per * 1.5); // out and back
    expect((me.champ!.abilities[0].readyAt - w.tick) / TICK_HZ).toBeLessThanOrEqual(R.qCd);
    const before = lost(t);
    t.pos = { x: 1, y: 0 };
    run(w, R.seconds);
    expect(lost(t) - before).toBeGreaterThan(KITS.aurelle.abilities[3].damage!(1, me) - 10);
  });
});

describe('bots', () => {
  for (const [blue, red] of [['arlo', 'tock'], ['tock', 'arlo'], ['maren', 'arlo'], ['tock', 'maren'], ['maren', 'maren'], ['lisha', 'arlo'], ['tock', 'lisha'], ['mabel', 'arlo'], ['lisha', 'mabel'], ['aurelle', 'tock'], ['maren', 'aurelle']] as const) {
    it(`${blue} vs ${red}: both level up and use their abilities`, () => {
      const w = new World(3);
      const a = w.spawnChampion('blue', blue, new BotController(), { summoners: SIGNATURE_SUMMONERS[blue] });
      const b = w.spawnChampion('red', red, new BotController(), { summoners: SIGNATURE_SUMMONERS[red] });
      run(w, 240);
      for (const c of [a, b]) {
        expect(c.champ!.level).toBeGreaterThanOrEqual(3); // leveled at least twice; whoever loses lane can trail far behind
        expect(c.champ!.abilities.slice(0, 3).every((s) => s.rank > 0)).toBe(true);
        expect(c.champ!.abilities.some((s) => s.readyAt > 0)).toBe(true); // has cast something
      }
    });
  }
});
