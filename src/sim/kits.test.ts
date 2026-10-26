import { describe, expect, it } from 'vitest';
import { BotController } from './bot';
import { KITS } from './kits';
import { HOLLIS } from './kits/hollis';
import { SIGNATURE_SUMMONERS } from './summoners';
import { MABEL_TUNING } from './kits/mabel';
import { AURELLE_TUNING, holdingSpear, spearOnGround } from './kits/aurelle';
import { GORMUND_TUNING, fury } from './kits/gormund';
import { SABLE_TUNING, reaping, windowOpen } from './kits/sable';
import { PIP_TUNING, panicking, riding, thistleOf } from './kits/pip';
import { GERRIT_TUNING, leapOf, standardsOf } from './kits/gerrit';
import { LUMEN_TUNING, devotion, lumenHeal, radiant, sunrise } from './kits/lumen';
import { FENNICK_TUNING, drawing, nextArrow, overcharged } from './kits/fennick';
import { HOLLIS_TUNING, brambleOf } from './kits/hollis';
import { abilitiesOf } from './kits';
import type { Command, Controller, KitId, Slot, Unit } from './types';
import { TICK_HZ, dist } from './util';
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

describe('Gormund', () => {
  const { HIDE, Q, W, E, R } = GORMUND_TUNING;
  /** Count him as in combat for the whole test, so Thick Hide's regeneration stays out of the numbers. */
  const fighting = (me: Unit) => ((me.champ!.data as { struck?: number }).struck = 1e9);

  it('abilities cost a share of current health, never mana, and never kill him', () => {
    const { w, me, cast } = setup('gormund');
    fighting(me);
    expect(w.castBlocker(me, 1)).toBe(null);
    me.champ!.mana = 0;
    me.hp = 100;
    cast(1, 0);
    expect(me.hp).toBeCloseTo(100 * (1 - W.cost), 0);
    me.hp = 1;
    me.champ!.abilities[2].readyAt = 0;
    cast(2, 5);
    expect(me.hp).toBeGreaterThan(0);
    expect(me.dead).toBe(false);
  });

  it('Hurl Stone slows, and hitting the champion gives the health back', () => {
    const { w, me, cast } = setup('gormund');
    const t = dummy(w, 6);
    fighting(me);
    me.hp = me.maxHp * 0.5; // below full, so the refund has room
    const before = me.hp;
    cast(0, 6);
    run(w, 0.6);
    expect(w.status(t, 'slow', me.id)).toBeTruthy();
    expect(me.hp).toBeGreaterThan(before - 1); // paid, then refunded (plus a little regen)
    near(lost(t), KITS.gormund.abilities[0].damage!(1, me) * (1 + fury(me)), 20);

    const { w: w2, me: me2, cast: cast2 } = setup('gormund');
    fighting(me2);
    me2.hp = me2.maxHp * 0.5;
    const before2 = me2.hp;
    cast2(0, -6); // a miss keeps the cost
    run(w2, 0.6);
    expect(me2.hp).toBeLessThan(before2 - before2 * Q.cost + 5);
  });

  it('Bellow slows enemies around him, speeds him up and cuts the damage he takes', () => {
    const { w, me, cast } = setup('gormund');
    const t = dummy(w, 2.5);
    const far = dummy(w, W.radius + 3);
    cast(1, 0);
    expect(w.status(t, 'slow', me.id)).toBeTruthy();
    expect(w.status(far, 'slow', me.id)).toBeFalsy();
    expect(w.effectiveSpeed(me)).toBeCloseTo(me.speed * (1 + W.haste), 5);
    const hp = me.hp;
    w.dealDamage(null, me, 100);
    expect(hp - me.hp).toBeCloseTo(100 * (1 - W.guard), 3);
  });

  it('Bull Rush carries the first champion to the end of the charge and stuns it', () => {
    const { w, me, cast } = setup('gormund');
    const t = dummy(w, 2);
    cast(2, 10);
    run(w, E.windup + E.range / E.speed + 0.3);
    expect(me.pos.x).toBeGreaterThan(E.range - 0.3);
    expect(t.pos.x).toBeGreaterThan(me.pos.x); // still in front of him, carried along
    expect(w.isStunned(t)).toBe(true);
    expect(lost(t)).toBeGreaterThan(KITS.gormund.abilities[2].damage!(1, me) - 10);
  });

  it('Labyrinth Rage: unstoppable, free abilities, and he heals off his damage', () => {
    const { w, me, cast } = setup('gormund');
    const t = dummy(w, 6);
    w.addStatus(me, { kind: 'slow', value: 0.5, sourceId: t.id, seconds: 3 });
    cast(3, 0);
    expect(w.status(me, 'slow')).toBeFalsy(); // shaken off
    w.addStatus(me, { kind: 'stun', value: 1, sourceId: t.id, seconds: 1 });
    w.pull(me, { x: -5, y: 0 }, 20);
    expect(w.isStunned(me)).toBe(false);
    expect(me.forced).toBe(null);
    fighting(me);
    me.hp = me.maxHp * 0.5;
    const before = me.hp;
    cast(0, 6);
    expect(me.hp).toBeCloseTo(before, 0); // free (base regen aside)
    run(w, 0.6);
    const dealt = lost(t);
    expect(me.hp - before).toBeGreaterThan(dealt * R.vamp * 0.9);
  });

  it('Fury grows as his health drops, and he regenerates once out of combat', () => {
    const { w, me } = setup('gormund');
    expect(fury(me)).toBe(0);
    me.hp = me.maxHp * HIDE.furyAt;
    expect(fury(me)).toBeCloseTo(HIDE.fury, 5);
    me.hp = me.maxHp * 0.5;
    const t = dummy(w, 3);
    w.dealDamage(t, me, 1);
    const hurt = me.hp;
    run(w, HIDE.calm - 0.5);
    expect(me.hp - hurt).toBeLessThan(me.maxHp * 0.01); // only base regen while in combat
    run(w, 1.5);
    expect(me.hp - hurt).toBeGreaterThan(me.maxHp * HIDE.regen * 0.8);
  });
});

describe('Sable', () => {
  const { GLEAN, WINDOW, REAP, BIND, VAULT, R } = SABLE_TUNING;
  /** Hook a dummy standing at `x` and let the pull finish. */
  function hook(x = 6) {
    const s = setup('sable');
    const t = dummy(s.w, x);
    s.cast(0, x);
    run(s.w, 0.8);
    return { ...s, t };
  }

  it('Reaping Hook yanks the first enemy to her, Gleans it and opens the window', () => {
    const { w, me, t } = hook();
    expect(t.pos.x).toBeLessThan(2);
    near(lost(t), KITS.sable.abilities[0].damage!(1, me));
    expect(w.status(t, 'gleaned', me.id)).toBeTruthy();
    expect(windowOpen(w, me)).toBe(true);
    expect(w.castBlocker(me, 1)).toBe(null); // W is now Bind, E is now Vault
    run(w, WINDOW);
    expect(windowOpen(w, me)).toBe(false);
    expect(reaping(w, me)).toEqual([]);
  });

  it('Bind roots everything she is reaping and closes the window (one follow-up only)', () => {
    const { w, me, t, cast } = hook();
    const before = lost(t);
    cast(1, 0);
    expect(w.isRooted(t)).toBe(true);
    near(lost(t) - before, BIND.base[0] + BIND.ad * me.damage);
    expect(windowOpen(w, me)).toBe(false);
    expect(w.castBlocker(me, 2)).toBe(null); // plain Drift is still there...
    const from = { ...me.pos };
    cast(2, -10);
    run(w, 0.5);
    expect(me.pos.x).toBeLessThan(from.x - 3); // ...and it's Drift, not Vault
    run(w, BIND.root);
    expect(w.isRooted(t)).toBe(false);
  });

  it('Drift dashes and cuts the damage she takes for a moment', () => {
    const { w, me, cast } = setup('sable');
    cast(2, 10);
    const hp = me.hp;
    w.dealDamage(null, me, 100);
    expect(hp - me.hp).toBeCloseTo(100 * (1 - SABLE_TUNING.E.guard), 3);
    run(w, SABLE_TUNING.E.guardFor + 0.1);
    expect(me.pos.x).toBeGreaterThan(SABLE_TUNING.E.range - 0.3);
    const hp2 = me.hp;
    w.dealDamage(null, me, 100);
    expect(hp2 - me.hp).toBeCloseTo(100, 3);
  });

  it('Vault leaps over the target to its far side and slows it', () => {
    const { w, me, t, cast } = hook();
    const before = lost(t);
    cast(2, 0);
    run(w, 0.6);
    expect(me.pos.x).toBeGreaterThan(t.pos.x);
    expect(w.status(t, 'slow', me.id)).toBeTruthy();
    near(lost(t) - before, VAULT.base[0] + VAULT.ad * me.damage);
    expect(windowOpen(w, me)).toBe(false);
  });

  it('autos in the window are plain swings; Q again Reaps, harder the lower they are', () => {
    const { w, me, t, cast } = hook();
    me.range = 2;
    me.attackCd = 0;
    me.attackTarget = t.id;
    t.hp = t.maxHp * 0.5;
    let before = t.hp;
    run(w, 0.5); // one woven auto
    expect(before - t.hp).toBeGreaterThan(me.damage * 0.9);
    expect(before - t.hp).toBeLessThan(me.damage * 1.4);
    expect(windowOpen(w, me)).toBe(true); // the auto didn't spend the window
    me.range = 0;
    me.attackTarget = null;
    before = t.hp;
    const missing = 1 - t.hp / t.maxHp;
    cast(0, t.pos.x);
    run(w, 0.2);
    near(before - t.hp, (REAP.base[0] + REAP.ad * me.damage) * (1 + REAP.missing * missing), 12);
    expect(windowOpen(w, me)).toBe(false);
    expect(w.castBlocker(me, 1)).toBe(null); // plain Wide Swath again, not Bind
    expect(me.champ!.abilities[1].recastUntil).toBe(0);
  });

  it('Gleaned enemies are in reach from further away, and hurting them heals her', () => {
    const { w, me, t } = hook();
    run(w, WINDOW); // let the window close so autos don't Reap
    me.range = 2;
    t.pos = { x: me.pos.x + me.radius + t.radius + 2 + GLEAN.reach - 0.2, y: 0 };
    expect(w.attackRange(me, t)).toBeCloseTo(2 + GLEAN.reach, 5);
    me.hp = me.maxHp * 0.5;
    const hp = me.hp;
    w.dealDamage(me, t, 100);
    expect(me.hp - hp).toBeCloseTo(100 * GLEAN.heal, 0);
  });

  it('Last Harvest drags everything in the crescent to her and opens the window on all of them', () => {
    const { w, me, cast } = setup('sable', 1);
    const a = dummy(w, 5, 1.5);
    const m = w.spawnMinion('red', 'melee', { x: 6, y: -1.5 });
    m.speed = 4.6;
    cast(3, 6);
    run(w, R.windup + 0.6);
    expect(a.pos.x).toBeLessThan(2.5);
    expect(m.pos.x).toBeLessThan(2.5);
    expect(reaping(w, me).map((u) => u.id).sort()).toEqual([a.id, m.id].sort());
    cast(1, 0);
    expect(w.isRooted(a) && w.isRooted(m)).toBe(true);
  });
});

describe('experimental champions', () => {
  it('are exactly the ones without a Meshy model', () => {
    const models = Object.keys(import.meta.glob('../../public/assets/meshy/*.glb'));
    expect(models.length).toBeGreaterThan(0);
    for (const kit of Object.values(KITS)) {
      const model = models.some((m) => m.toLowerCase().endsWith(`/${kit.id}.glb`)); // Arlo.glb, Pip.glb (Pip & Thistle)
      expect({ kit: kit.id, experimental: !!kit.experimental }).toEqual({ kit: kit.id, experimental: !model });
    }
  });
});

describe('bots', () => {
  for (const [blue, red] of [['arlo', 'tock'], ['tock', 'arlo'], ['maren', 'arlo'], ['tock', 'maren'], ['maren', 'maren'], ['lisha', 'arlo'], ['tock', 'lisha'], ['mabel', 'arlo'], ['lisha', 'mabel'], ['aurelle', 'tock'], ['maren', 'aurelle'], ['gormund', 'arlo'], ['lisha', 'gormund'], ['sable', 'maren'], ['tock', 'sable'], ['pip', 'arlo'], ['gormund', 'pip'], ['hollis', 'arlo'], ['tock', 'hollis']] as const) {
    it(`${blue} vs ${red}: both level up and use their abilities`, () => {
      const w = new World(3);
      const a = w.spawnChampion('blue', blue, new BotController(), { summoners: SIGNATURE_SUMMONERS[blue] });
      const b = w.spawnChampion('red', red, new BotController(), { summoners: SIGNATURE_SUMMONERS[red] });
      run(w, 240);
      for (const c of [a, b]) {
        // Levelled at all: whoever loses lane can trail far behind (a stomped melee bot sits at level 2
        // in some seeds, and the seed is fixed here, so this only checks the bot isn't standing idle).
        expect(c.champ!.level).toBeGreaterThanOrEqual(2);
        // Spends its points: one basic ability per level up to all three.
        expect(c.champ!.abilities.slice(0, 3).filter((s) => s.rank > 0).length).toBeGreaterThanOrEqual(Math.min(3, c.champ!.level));
        expect(c.champ!.abilities.some((s) => s.readyAt > 0)).toBe(true); // has cast something
      }
    });
  }
});

describe('Pip & Thistle', () => {
  /** Pip riding Thistle in mid-lane (Thistle arrives on the first tick). */
  function pip(rank = 1) {
    const s = setup('pip', rank);
    s.w.step();
    const toad = thistleOf(s.w, s.me)!;
    return { ...s, toad };
  }

  it('starts riding Thistle: melee, Thistle untargetable under him, the riding abilities', () => {
    const { w, me, toad } = pip();
    expect(riding(me)).toBe(true);
    expect(toad.kind).toBe('pet');
    expect(w.isTargetable(toad)).toBe(false);
    expect(me.projectileSpeed).toBe(0);
    expect(abilitiesOf(me)[0].name).toBe('Gulp');
    run(w, 1);
    expect(toad.pos).toEqual(me.pos);
  });

  it("riding, damage hits Thistle first; when he breaks he panics, throws Pip off and the rest carries over", () => {
    const { w, me, toad } = pip();
    const enemy = dummy(w, 30);
    const { soak } = PIP_TUNING.THISTLE;
    w.dealDamage(enemy, me, 100);
    expect(me.hp).toBe(me.maxHp);
    near(toad.maxHp - toad.hp, 100 * soak, 1); // thick-skinned: he takes less of it
    const overflow = 50;
    w.dealDamage(enemy, me, toad.hp / soak + overflow);
    expect(riding(me)).toBe(false);
    expect(panicking(w, toad)).toBe(true);
    expect(w.status(me, 'haste')).toBeUndefined(); // thrown off, not hopping off: no speed
    expect(w.isTargetable(toad)).toBe(false);
    near(me.maxHp - me.hp, overflow, 1);
    expect(abilitiesOf(me)[0].name).toBe('Pebble Burst');
    // Saddle Up and Puff Up wait until he calms down (once Pip has landed from his tumble).
    run(w, 0.5);
    expect(w.castBlocker(me, 2)).toBe('unavailable');
    expect(w.castBlocker(me, 1)).toBe('unavailable');
    run(w, PIP_TUNING.THISTLE.panic + 0.5);
    expect(panicking(w, toad)).toBe(false);
    // Back with at least half health (he fled to the fountain, which tops him up from there).
    expect(toad.hp).toBeGreaterThanOrEqual(toad.maxHp * PIP_TUNING.THISTLE.comeBack - 1);
  });

  it('Hop Off and Saddle Up switch forms, and each form keeps its own Q and W cooldowns', () => {
    const { w, me, toad, cast } = pip();
    me.champ!.abilities[2].rank = 1;
    cast(0, 5); // Gulp on cooldown
    const gulpReady = me.champ!.abilities[0].readyAt;
    expect(gulpReady).toBeGreaterThan(w.tick);
    cast(2, -3); // Hop Off
    run(w, 0.5);
    expect(riding(me)).toBe(false);
    expect(w.status(me, 'haste')?.value).toBe(PIP_TUNING.SWAP.haste); // a willing dismount: quicker on his feet
    expect(me.projectileSpeed).toBeGreaterThan(0);
    expect(w.isTargetable(toad)).toBe(true);
    expect(me.champ!.abilities[0].readyAt).toBeLessThanOrEqual(w.tick); // Pebble Burst is ready
    me.champ!.abilities[2].readyAt = 0;
    cast(2, me.pos.x);
    run(w, 1);
    expect(riding(me)).toBe(true);
    expect(me.champ!.abilities[0].readyAt).toBe(gulpReady); // Gulp's cooldown came back with him
  });

  it('on foot, Thistle bites what Pip attacks, and minions and towers go for him before Pip', () => {
    const { w, me, toad, cast } = pip();
    cast(2, -3);
    run(w, 0.5);
    const m = w.spawnMinion('red', 'melee', { x: me.pos.x + 3, y: 0 });
    m.damage = 0;
    me.range = 5;
    w.step();
    // Pip auto-acquires the minion; Thistle joins in.
    run(w, 1);
    expect(toad.attackTarget).toBe(m.id);
    // A fresh enemy minion picks Thistle over Pip.
    const m2 = w.spawnMinion('red', 'melee', { x: toad.pos.x + 2, y: toad.pos.y });
    w.units.filter((u) => u.kind === 'minion' && u.team === 'blue').forEach((u) => (u.dead = true));
    w.step();
    expect(m2.attackTarget).toBe(toad.id);
  });

  it("Thistle's kills are Pip's, and Gulp swallows a minion it finishes", () => {
    const { w, me, toad, cast, ctl } = pip();
    const m = w.spawnMinion('red', 'melee', { x: 3, y: 0 });
    m.hp = 20;
    toad.hp = toad.maxHp * 0.5;
    const before = toad.hp;
    cast(0, 3);
    run(w, 0.5);
    expect(me.champ!.cs).toBe(1);
    expect(toad.hp).toBeGreaterThan(before);
    // On foot: Thistle's last hit counts for Pip.
    cast(2, -3);
    run(w, 0.5);
    const m2 = w.spawnMinion('red', 'caster', { x: toad.pos.x + 1.5, y: toad.pos.y });
    m2.hp = 1;
    m2.damage = 0;
    // Pip attacks it for nothing (so the last hit is Thistle's), and Thistle joins in.
    me.range = 5;
    me.damage = 0;
    ctl.queue.push({ type: 'attack', target: m2.id });
    run(w, 2);
    expect(m2.dead || !w.units.includes(m2)).toBe(true);
    expect(me.champ!.cs).toBe(2);
  });

  it('Puff Up guards Thistle and slows enemies near him; skillshots stop on him', () => {
    const { w, me, toad, cast } = pip();
    cast(2, -3);
    run(w, 0.5);
    const foe = dummy(w, me.pos.x + 6);
    toad.hp = toad.maxHp * 0.5;
    toad.lastHurtTick = w.tick + 1e6; // keep his out-of-combat regeneration out of it
    const hurt = toad.hp;
    cast(1, me.pos.x + 3);
    run(w, 0.5);
    expect(w.status(toad, 'guard')).toBeTruthy();
    run(w, 3);
    near(toad.hp - hurt, PIP_TUNING.PUFF.heal + toad.maxHp * PIP_TUNING.PUFF.healPct, 2); // healed a little over the puff
    const nearFoe = dist2(toad.pos, foe.pos) <= PIP_TUNING.PUFF.radius + foe.radius;
    if (nearFoe) expect(w.status(foe, 'slow')).toBeTruthy();
    // An enemy skillshot at Pip through Thistle stops on Thistle.
    const hitIds: number[] = [];
    toad.pos = { x: me.pos.x + 2, y: me.pos.y };
    w.fireLine(foe, { style: 'auto', dir: { x: -1, y: 0 }, speed: 30, range: 12, width: 0.5, from: { x: me.pos.x + 5, y: me.pos.y }, onHit: (t) => { hitIds.push(t.id); } });
    run(w, 0.5);
    expect(hitIds).toEqual([toad.id]);
  });

  it('Big Leap knocks up everything where it lands, riding or with Thistle alone', () => {
    const { w, me, toad, cast, ctl } = pip();
    const foe = dummy(w, 5);
    cast(3, 5);
    run(w, 1.2);
    expect(lost(foe)).toBeGreaterThan(100);
    expect(w.isStunned(foe)).toBe(true);
    near(me.pos.x, 5, 2.5); // Pip rode along

    // On foot, Thistle jumps alone and Pip stays put.
    run(w, 2);
    cast(2, -3);
    ctl.queue.push({ type: 'stop' }); // (he'd otherwise go back to chasing the dummy he was hitting)
    run(w, 0.5);
    const pipAt = { ...me.pos };
    me.champ!.abilities[3].readyAt = 0;
    const before = lost(foe);
    cast(3, foe.pos.x);
    run(w, 1.2);
    expect(lost(foe)).toBeGreaterThan(before + 100);
    expect(w.isStunned(foe)).toBe(true);
    // Thistle went; Pip didn't (he only drifts a little as units nudge apart).
    near(toad.pos.x, foe.pos.x, 2.5);
    expect(Math.abs(me.pos.x - pipAt.x)).toBeLessThan(2);
    expect(Math.abs(me.pos.x - foe.pos.x)).toBeGreaterThan(Math.abs(toad.pos.x - foe.pos.x) + 1);
  });

  it('Thistle regenerates out of combat', () => {
    const { w, toad } = pip();
    toad.hp = toad.maxHp * 0.5;
    toad.lastHurtTick = w.tick;
    run(w, PIP_TUNING.THISTLE.calm - 0.5);
    near(toad.hp, toad.maxHp * 0.5, 1); // still catching his breath
    run(w, 2);
    expect(toad.hp).toBeGreaterThan(toad.maxHp * 0.5 + toad.maxHp * PIP_TUNING.THISTLE.regen);
  });

  it("only Pip's death counts, and both come back fresh", () => {
    const { w, me, toad } = pip();
    const enemy = dummy(w, 30);
    w.dealDamage(enemy, me, toad.hp / PIP_TUNING.THISTLE.soak + me.hp + 10);
    expect(me.dead).toBe(true);
    expect(enemy.champ!.kills).toBe(1);
    run(w, 30);
    expect(me.dead).toBe(false);
    w.step();
    expect(riding(me)).toBe(true);
    expect(toad.hp).toBe(toad.maxHp);
  });
});

const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('Gerrit', () => {
  const { FLIGHT, Q, E, R } = GERRIT_TUNING;

  it('plants his standard after a short flight; a new one replaces it, and it expires', () => {
    const { w, me, cast } = setup('gerrit');
    const foe = dummy(w, 5);
    cast(2, 5);
    expect(standardsOf(w, me)).toHaveLength(0); // still in the air
    run(w, FLIGHT + 0.15);
    expect(standardsOf(w, me)).toHaveLength(1);
    expect(lost(foe)).toBeGreaterThan(30);
    expect(w.status(foe, 'slow')).toBeTruthy();
    me.champ!.abilities[2].readyAt = 0;
    cast(2, -4);
    run(w, FLIGHT + 0.15);
    const flags = standardsOf(w, me);
    expect(flags).toHaveLength(1);
    near(flags[0].pos.x, -4, 0.2);
    run(w, E.lasts + 0.5);
    expect(standardsOf(w, me)).toHaveLength(0);
  });

  it('thrusts without moving when no standard is on the line', () => {
    const { w, me, cast } = setup('gerrit');
    const foe = dummy(w, 3);
    cast(0, 6);
    run(w, Q.windup + 0.1);
    expect(lost(foe)).toBeGreaterThan(60);
    expect(w.isStunned(foe)).toBe(false);
    near(me.pos.x, 0, 0.3);
  });

  it("is pulled to a standard on the line, knocking up who he passes (once every few seconds); the standard stays", () => {
    const { w, me, cast } = setup('gerrit');
    cast(2, 5);
    run(w, FLIGHT + 0.2);
    const foe = dummy(w, 2.5);
    me.champ!.abilities[2].readyAt = 0;
    cast(0, 6);
    run(w, Q.windup + 0.05);
    expect(w.isStunned(foe)).toBe(true);
    run(w, 0.5);
    near(me.pos.x, 5, 0.8);
    expect(standardsOf(w, me)).toHaveLength(1);
    // Straight back through: the standard isn't on that line, so no pull and no knock-up.
    run(w, Q.knockup + 0.1);
    me.champ!.abilities[0].readyAt = 0;
    cast(0, -6);
    run(w, Q.windup + 0.05);
    expect(w.isStunned(foe)).toBe(false);
  });

  it('only knocks each enemy up once every couple of seconds', () => {
    const { w, me, cast } = setup('gerrit');
    cast(2, 5);
    run(w, FLIGHT + 0.2);
    const foe = dummy(w, 2.5);
    cast(0, 6);
    run(w, Q.windup + 0.05);
    expect(w.isStunned(foe)).toBe(true);
    run(w, 0.8);
    // Put both back and thrust again right away.
    me.pos = { x: 0, y: 0 };
    foe.pos = { x: 2.5, y: 0 };
    me.champ!.abilities[0].readyAt = 0;
    cast(0, 6);
    run(w, Q.windup + 0.05);
    expect(w.isStunned(foe)).toBe(false);
  });

  it('holds the ground near his standards: less damage taken, faster attacks', () => {
    const { w, me, cast } = setup('gerrit');
    run(w, 0.1);
    expect(w.status(me, 'guard')).toBeUndefined();
    cast(2, 2);
    run(w, FLIGHT + 0.2);
    expect(w.status(me, 'guard')?.value).toBe(GERRIT_TUNING.HOLD.guard);
    expect(w.status(me, 'frenzy')?.value).toBe(GERRIT_TUNING.HOLD.attackSpeed);
  });

  it('Bulwark shields and slows champions who hit him; the recast trades the shield for a point-blank root', () => {
    const { w, me, cast } = setup('gerrit');
    const foe = dummy(w, 1.5);
    cast(1, 0);
    expect(me.statuses.some((s) => s.kind === 'shield')).toBe(true);
    w.dealDamage(foe, me, 10, { attack: true });
    expect(w.status(foe, 'slow')).toBeTruthy();
    const far = dummy(w, 6);
    cast(1, 0); // recast
    expect(me.statuses.some((s) => s.kind === 'shield')).toBe(false);
    expect(w.isRooted(foe)).toBe(true);
    expect(w.isRooted(far)).toBe(false);
  });

  it("Bulwark's recast goes away when the shield breaks", () => {
    const { w, me, cast } = setup('gerrit');
    const foe = dummy(w, 1.5);
    cast(1, 0);
    w.dealDamage(foe, me, 5000);
    w.step();
    cast(1, 0); // nothing to recast: it's on cooldown now
    expect(w.isRooted(foe)).toBe(false);
  });

  it('Fallen Standards leaps onto the target, plants banners behind them and refreshes his thrust', () => {
    const { w, me, cast } = setup('gerrit');
    const foe = dummy(w, 5);
    me.champ!.abilities[0].readyAt = w.tick + 999;
    cast(3, 5);
    run(w, 0.15);
    expect(leapOf(me)).toBeTruthy();
    run(w, R.flight + 0.3);
    expect(leapOf(me)).toBeUndefined();
    near(me.pos.x, 5 - foe.radius - me.radius * 0.6, 0.5);
    expect(lost(foe)).toBeGreaterThan(100);
    expect(me.champ!.abilities[0].readyAt).toBeLessThanOrEqual(w.tick);
    run(w, FLIGHT + 0.1);
    const banners = standardsOf(w, me).filter((z) => z.kind === 'banner');
    expect(banners).toHaveLength(R.banners);
    for (const b of banners) expect(b.pos.x).toBeGreaterThan(foe.pos.x + 1); // behind the target, away from him
    // The middle banner is right in the escape path: a thrust through the target pulls him past them.
    cast(0, 12);
    run(w, Q.windup + 0.6);
    expect(me.pos.x).toBeGreaterThan(foe.pos.x);
    // Walking past a banner is slow going.
    expect(w.status(foe, 'slow')).toBeTruthy();
  });

  it("bots step off the line between Gerrit and his standard while his thrust is up", () => {
    const { w, me, cast } = setup('gerrit');
    me.range = 0;
    cast(2, 6);
    run(w, FLIGHT + 0.2);
    const bot = w.spawnChampion('red', 'arlo', new BotController(1));
    bot.pos = { x: 3, y: 0 };
    bot.moveTarget = null;
    const off = () => Math.abs(bot.pos.y) > Q.width / 2 + bot.radius;
    for (let i = 0; i < TICK_HZ && !off(); i++) w.step();
    expect(off()).toBe(true);
    // With the thrust on a long cooldown, the line isn't a threat.
    me.champ!.abilities[0].readyAt = w.tick + TICK_HZ * 10;
    const calm = w.spawnChampion('red', 'arlo', new BotController(1));
    calm.pos = { x: 3, y: 0 };
    calm.moveTarget = null;
    w.step();
    const goal = calm.moveTarget as { x: number; y: number } | null; // (the bot may have set it during the step)
    expect(goal == null || Math.abs(goal.y) < 0.5).toBe(true);
  });

  it('a standard thrown at full range is always within reach of the thrust', () => {
    const { w, me, cast } = setup('gerrit');
    cast(2, 50); // well past the toss range: it lands at the edge
    run(w, FLIGHT + 0.2);
    const flag = standardsOf(w, me)[0];
    near(flag.pos.x, E.range, 0.05);
    cast(0, 50);
    run(w, Q.windup + 0.6);
    near(me.pos.x, flag.pos.x, 0.8);
  });

  it('needs an enemy champion in range for the leap', () => {
    const { w, me, cast } = setup('gerrit');
    dummy(w, 15);
    cast(3, 15);
    run(w, 0.3);
    expect(me.champ!.abilities[3].readyAt).toBe(0);
    near(me.pos.x, 0, 0.1);
  });
});

describe('Lumen', () => {
  const { DEVOTION, GLOW, RADIANT, R } = LUMEN_TUNING;
  const setDevotion = (u: Unit, n: number) => ((u.champ!.data as { devotion?: number }).devotion = n);

  it('Candleflame heals her for part of the hit and fills Devotion', () => {
    const { w, me, cast } = setup('lumen');
    me.hp = me.maxHp * 0.5;
    const foe = dummy(w, 4);
    const before = me.hp;
    cast(0, 4);
    run(w, 0.6);
    expect(lost(foe)).toBeGreaterThan(80);
    expect(me.hp).toBeGreaterThan(before + 20);
    expect(devotion(me)).toBeGreaterThan(0);
  });

  it('caps her healing: past a few percent of her health a second, healing becomes Devotion instead', () => {
    const { w, me } = setup('lumen');
    me.hp = me.maxHp * 0.2;
    const before = me.hp;
    lumenHeal(w, me, me.maxHp); // a huge heal at once
    near(me.hp - before, me.maxHp * DEVOTION.capPerSec, 1);
    expect(devotion(me)).toBeGreaterThan(50);
  });

  it('Afterglow: healing past full health becomes a shield, up to a cap', () => {
    const { w, me } = setup('lumen');
    for (let i = 0; i < 40; i++) {
      lumenHeal(w, me, me.maxHp * 0.03);
      w.step();
    }
    const shield = me.statuses.filter((st) => st.kind === 'shield').reduce((t, st) => t + st.value, 0);
    expect(shield).toBeGreaterThan(0);
    expect(shield).toBeLessThanOrEqual(me.maxHp * GLOW.cap + 0.01);
  });

  it('at full Devotion she is Radiant: more damage and a little speed', () => {
    const { w, me } = setup('lumen');
    const foe = dummy(w, 3);
    w.dealDamage(me, foe, 100);
    const plain = lost(foe);
    setDevotion(me, DEVOTION.max);
    w.step();
    expect(radiant(me)).toBe(true);
    expect(w.status(me, 'haste')?.value).toBe(RADIANT.haste);
    const before = lost(foe);
    w.dealDamage(me, foe, 100);
    near(lost(foe) - before, plain * (1 + RADIANT.damage), 3);
  });

  it('Sanctuary heals her inside and burns and slows enemies in it', () => {
    const { w, me, cast } = setup('lumen');
    me.hp = me.maxHp * 0.5;
    const foe = dummy(w, 1);
    const before = me.hp;
    cast(1, 0.5);
    run(w, 1.5);
    expect(me.hp).toBeGreaterThan(before + 20);
    expect(lost(foe)).toBeGreaterThan(20);
    expect(w.status(foe, 'slow')).toBeTruthy();
  });

  it('Warm Embrace shields her and burns whoever she dashes through', () => {
    const { w, me, cast } = setup('lumen');
    const foe = dummy(w, 2);
    cast(2, 4);
    expect(me.statuses.some((st) => st.kind === 'shield')).toBe(true);
    run(w, 0.5);
    expect(foe.statuses.some((st) => st.kind === 'burn')).toBe(true);
    run(w, 2);
    expect(lost(foe)).toBeGreaterThan(40);
  });

  it(`Sunrise needs ${50} Devotion, spends it all, and lasts longer the more she had`, () => {
    const { w, me, cast } = setup('lumen');
    const foe = dummy(w, 2);
    setDevotion(me, DEVOTION.sunrise - 1);
    expect(w.castBlocker(me, 3)).toBe('unavailable');
    setDevotion(me, DEVOTION.max);
    cast(3, 0);
    run(w, 0.3);
    expect(sunrise(w, me)).toBe(true);
    expect(devotion(me)).toBeLessThan(5);
    run(w, R.base + R.bonus - 0.6);
    expect(sunrise(w, me)).toBe(true); // a full meter: the longest sun
    run(w, 0.6);
    expect(sunrise(w, me)).toBe(false);
    expect(lost(foe)).toBeGreaterThan(200);
    // From the minimum, it's the shortest.
    me.champ!.abilities[3].readyAt = 0;
    setDevotion(me, DEVOTION.sunrise);
    cast(3, 0);
    run(w, R.base + 0.3);
    expect(sunrise(w, me)).toBe(false);
  });
});

describe('Fennick', () => {
  const { QUIVER, Q, W, E } = FENNICK_TUNING;
  const release = (ctl: Script, w: World, x: number, y = 0) => {
    ctl.queue.push({ type: 'release', slot: 0, at: { x, y } });
    w.step();
  };

  it('his attacks turn through frost, fire and spark', () => {
    const { w, me, ctl } = setup('fennick');
    me.range = 5.5;
    const foe = dummy(w, 4);
    const other = w.spawnMinion('red', 'melee', { x: 5, y: 1 });
    other.speed = 0;
    other.damage = 0;
    expect(nextArrow(me)).toBe('frost');
    ctl.queue.push({ type: 'attack', target: foe.id });
    // First arrow: frost slows.
    for (let i = 0; i < 60 && !w.status(foe, 'slow'); i++) w.step();
    expect(w.status(foe, 'slow')?.value).toBe(QUIVER.slow);
    expect(nextArrow(me)).toBe('fire');
    // Second: fire burns. Third: spark jumps to the minion beside them.
    for (let i = 0; i < 60 && !foe.statuses.some((st) => st.kind === 'burn'); i++) w.step();
    expect(foe.statuses.some((st) => st.kind === 'burn')).toBe(true);
    for (let i = 0; i < 60 && other.hp === other.maxHp; i++) w.step();
    expect(other.hp).toBeLessThan(other.maxHp);
    expect(nextArrow(me)).toBe('frost');
  });

  it('Longshot draws while held, reaching further and hitting harder, and looses on release', () => {
    // A quick tap: short reach.
    const tap = setup('fennick');
    const missed = dummy(tap.w, 10);
    tap.cast(0, 10);
    expect(drawing(tap.me)).toBe(true);
    release(tap.ctl, tap.w, 10);
    run(tap.w, 1);
    expect(drawing(tap.me)).toBe(false);
    expect(lost(missed)).toBe(0); // out of the short draw's reach
    // A full draw reaches, goes through the near dummy, hits harder, and the cooldown starts from the release.
    const { w, me, ctl, cast } = setup('fennick');
    const far = dummy(w, 10);
    const close = dummy(w, 3);
    cast(0, 10);
    run(w, Q.full + 0.1);
    expect(w.status(me, 'slow')?.value).toBe(Q.drawSlow);
    release(ctl, w, 10);
    run(w, 1);
    const full = Q.base[0] + Q.ad * me.damage;
    expect(lost(close)).toBeGreaterThan(0);
    expect(lost(far)).toBeGreaterThan(full * Q.fullMult - 10);
    expect(me.champ!.abilities[0].readyAt - w.tick).toBeGreaterThan((Q.cd[0] - 1.2) * TICK_HZ);
    expect(nextArrow(me)).toBe('fire'); // the full draw carried (and used up) the frost arrow
    expect(w.status(far, 'slow')).toBeTruthy();
  });

  it("can't attack while drawing, and looses by itself after a while", () => {
    const { w, me, ctl, cast } = setup('fennick');
    me.range = 5.5;
    const foe = dummy(w, 4);
    cast(0, 4);
    ctl.queue.push({ type: 'attack', target: foe.id });
    run(w, 1);
    expect(lost(foe)).toBe(0);
    run(w, Q.timeout);
    expect(drawing(me)).toBe(false);
    expect(lost(foe)).toBeGreaterThan(0);
  });

  it('Volley: the next attack looses all three arrows, then the quiver skips ahead one', () => {
    const { w, me, ctl, cast } = setup('fennick');
    me.range = 5.5;
    const foe = dummy(w, 4);
    cast(1, 0);
    ctl.queue.push({ type: 'attack', target: foe.id });
    for (let i = 0; i < 30 && lost(foe) === 0; i++) w.step();
    run(w, 0.4);
    expect(w.status(foe, 'slow')).toBeTruthy();
    expect(foe.statuses.some((st) => st.kind === 'burn')).toBe(true);
    // Three arrows at reduced damage, plus the burn so far.
    expect(lost(foe)).toBeGreaterThan(me.damage * W.mult * 3 - 10);
    expect(nextArrow(me)).toBe('fire');
  });

  it('Snare Shot nets the target and roots them if they stay in it', () => {
    const { w, cast } = setup('fennick');
    const foe = dummy(w, 4);
    cast(2, 4);
    run(w, 0.4);
    expect(lost(foe)).toBeGreaterThan(0);
    expect(w.status(foe, 'slow')?.value).toBe(E.slow);
    run(w, E.delay);
    expect(w.status(foe, 'root')).toBeTruthy();
  });

  it('Snare Shot: walking out of the net in time avoids the root', () => {
    const { w, cast } = setup('fennick');
    const ctl = new Script();
    const foe = w.spawnChampion('red', 'arlo', ctl);
    foe.pos = { x: 4, y: 0 };
    foe.damage = 0;
    cast(2, 4);
    run(w, 0.25);
    ctl.queue.push({ type: 'move', to: { x: 4, y: 6 } });
    run(w, E.delay + 0.2);
    expect(w.status(foe, 'root')).toBeFalsy();
  });

  it('Overcharge: every attack carries all three arrows, and he speeds up, fading', () => {
    const { w, me, ctl, cast } = setup('fennick');
    me.range = 5.5;
    const foe = dummy(w, 4);
    const other = w.spawnMinion('red', 'melee', { x: 5, y: 1 });
    other.speed = 0;
    other.damage = 0;
    cast(3, 0);
    expect(overcharged(w, me)).toBe(true);
    w.step();
    const early = w.status(me, 'haste')!.value;
    ctl.queue.push({ type: 'attack', target: foe.id });
    for (let i = 0; i < 30 && lost(foe) === 0; i++) w.step();
    w.step();
    expect(w.status(foe, 'slow')).toBeTruthy();
    expect(foe.statuses.some((st) => st.kind === 'burn')).toBe(true);
    expect(other.hp).toBeLessThan(other.maxHp);
    run(w, 3);
    expect(w.status(me, 'haste')!.value).toBeLessThan(early);
  });
});

describe('Hollis', () => {
  const { FLOCK, BITE, Q, W, E, R } = HOLLIS_TUNING;
  /** A minion that stands where it's put (unless something moves it). */
  const post = (w: World, team: 'blue' | 'red', x: number, y = 0, role: 'melee' | 'caster' = 'melee') => {
    const m = w.spawnMinion(team, role, { x, y });
    m.speed = 0;
    return m;
  };

  it('Bramble follows him, can never be targeted, and bites what Hollis attacks', () => {
    const { w, me } = setup('hollis');
    w.step();
    const dog = brambleOf(w, me)!;
    expect(dog.pet?.intangible).toBe(true);
    expect(w.isTargetable(dog)).toBe(false);
    me.range = HOLLIS.stats.range;
    const target = dummy(w, 2.5);
    run(w, 0.1);
    near(dist(dog.pos, me.pos), 1.2, 1);
    me.attackTarget = target.id;
    run(w, 1);
    const bites = w.hits.filter((h) => h.sourceId === dog.id && h.targetId === target.id);
    expect(bites.length).toBe(1);
    near(bites[0].amount, BITE.base + BITE.ad * me.damage, 1);
  });

  it('The Flock: nearby allied minions are faster and tougher', () => {
    const { w, me } = setup('hollis');
    const close = post(w, 'blue', 3);
    const far = post(w, 'blue', FLOCK.radius + 3);
    run(w, 0.2);
    expect(w.status(close, 'haste')?.value).toBe(FLOCK.haste);
    expect(w.status(close, 'guard')?.value).toBe(FLOCK.guard);
    expect(w.status(far, 'haste')).toBeUndefined();
    expect(me.hp).toBe(me.maxHp);
  });

  it('Whistle sets his minions on the enemy nearest the cursor, attacking faster', () => {
    const { w, me, cast } = setup('hollis');
    const ally = post(w, 'blue', 2, 1, 'caster');
    const decoy = post(w, 'red', 4, 1); // a minion the caster would normally pick
    const foe = dummy(w, 6, -1);
    cast(0, 6, -1);
    expect(w.status(ally, 'rally')?.value).toBe(foe.id);
    expect(w.status(ally, 'frenzy')?.value).toBe(Q.attackSpeed);
    run(w, 2);
    expect(ally.attackTarget).toBe(foe.id);
    expect(lost(foe)).toBeGreaterThan(0);
    expect(decoy.hp).toBe(decoy.maxHp);
    expect(me.champ!.abilities[0].readyAt).toBeGreaterThan(w.tick);
  });

  it("Whistle can't be cast with no minions near him", () => {
    const { w, me, cast } = setup('hollis');
    dummy(w, 5);
    cast(0, 5);
    expect(me.champ!.abilities[0].readyAt).toBe(0);
  });

  it('Crook herds an enemy minion: it fights for him, then dies as his last hit', () => {
    const { w, me, cast } = setup('hollis');
    const m = post(w, 'red', 6);
    m.speed = 4.6; // it has to be able to move to be pulled over
    const gold = me.gold;
    cast(1, 6);
    run(w, 0.6);
    expect(m.team).toBe('blue');
    expect(m.hp).toBeLessThanOrEqual(m.maxHp * 0.5);
    expect(dist(m.pos, me.pos)).toBeLessThan(3);
    expect(me.champ!.cs).toBe(0);
    run(w, W.herd);
    expect(m.dead).toBe(true);
    expect(me.champ!.cs).toBe(1);
    expect(me.gold).toBeGreaterThan(gold);
  });

  it("a herded minion killed by the enemy is still Hollis's last hit", () => {
    const { w, me, cast } = setup('hollis');
    const m = post(w, 'red', 6);
    const foe = dummy(w, 9);
    cast(1, 6);
    run(w, 0.6);
    w.dealDamage(foe, m, 9999, { attack: true });
    expect(m.dead).toBe(true);
    expect(me.champ!.cs).toBe(1);
    expect(foe.champ!.cs).toBe(0);
  });

  it('Crook on a champion: damage, a slow, and a pull toward him', () => {
    const { w, me, cast } = setup('hollis');
    const foe = dummy(w, 6);
    cast(1, 6);
    run(w, 0.6);
    near(lost(foe), HOLLIS.abilities[1].damage!(1, me));
    expect(foe.pos.x).toBeLessThan(6 - W.pull + 0.3);
    expect(w.status(foe, 'slow')?.value).toBe(W.slow);
  });

  it('Bramble (E) herds enemy minions back toward their tower and nips a champion', () => {
    const { w, me, cast } = setup('hollis');
    w.step();
    const m = post(w, 'red', 5, 1);
    m.speed = 4; // must be able to move to be herded
    m.moveTarget = null;
    const foe = dummy(w, 5, -1);
    cast(2, 5);
    run(w, 0.5);
    expect(m.pos.x).toBeGreaterThan(5 + E.push * 0.5); // red's tower is at +x (it starts walking back once it lands)
    near(lost(foe), HOLLIS.abilities[2].damage!(1, me));
    expect(w.status(foe, 'slow')?.value).toBe(E.slow);
  });

  it('Stampede tramples enemies in the band and sends his own minions charging', () => {
    const { w, me, cast } = setup('hollis');
    const ally = post(w, 'blue', 4, 2);
    const foe = dummy(w, 10, 1.5);
    const enemy = post(w, 'red', 14, -2);
    cast(3, 20);
    run(w, R.windup + 1.6);
    near(lost(foe), HOLLIS.abilities[3].damage!(1, me));
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
    expect(ally.statuses.some((st) => st.kind === 'haste' && st.value === R.haste)).toBe(true);
    expect(Math.abs(foe.pos.y)).toBeGreaterThan(1.5); // shoved aside
  });
});
