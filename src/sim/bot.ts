import { lead, leadTime, minionInTheWay } from './aim';
import { kitOf } from './kits';
import { isRewinding } from './kits/tock';
import { LANE, sideX, spawnPoint } from './lane';
import type { Command, Controller, Slot, Unit, Vec2 } from './types';
import { dirTo, dist, inCone } from './util';
import { enemyOf, gap, type World } from './world';

/** Shared view of the lane for one decision. */
interface Ctx {
  world: World;
  self: Unit;
  foe: Unit | undefined;
  /** The enemy champion is alive and within this edge-to-edge distance. */
  near: (d: number) => boolean;
  unsafe: (p: Vec2) => boolean;
  /** Castable now, and not a pending recast. */
  ready: (slot: Slot) => boolean;
  /** A recast is available now. */
  recasting: (slot: Slot) => boolean;
  /** Current-rank damage of an ability. */
  dmg: (slot: Slot) => number;
  aim: (target: Unit, speed: number) => Vec2;
  /** Where `target` will be after `seconds`, with this bot's aim error (delayed ground effects). */
  aimAfter: (target: Unit, seconds: number) => Vec2;
}

const cast = (slot: Slot, at: Vec2): Command => ({ type: 'cast', slot, at });

/**
 * Rule-based CPU opponent: retreat when low, never stand in an enemy tower's range without minions
 * to tank it, use its kit's abilities, trade when healthy, otherwise farm the weakest minion in
 * reach and follow its own wave. Milestone 3 replaces this with a utility AI.
 *
 * `accuracy` (0..1) scales how well it leads skillshots; the roguelike ladder can raise it per floor.
 */
export class BotController implements Controller {
  private nextDecision = 0;
  private retreating = false;

  constructor(private accuracy = 0.8) {}

  think(world: World, self: Unit): Command[] {
    const cmds: Command[] = [];
    if (self.champ!.skillPoints > 0) {
      // One rank in every basic ability first, then the kit's priority order.
      const order = [...([0, 1, 2] as Slot[]).filter((s) => self.champ!.abilities[s].rank === 0), ...kitOf(self).levelOrder];
      const slot = order.find((s) => world.canLevel(self, s));
      if (slot != null) cmds.push({ type: 'levelUp', slot });
    }
    if (world.tick < this.nextDecision || world.isBusy(self)) return cmds;
    this.nextDecision = world.tick + 6; // ~5 decisions a second
    const decision = this.decide(world, self);
    if (decision) cmds.push(decision);
    return cmds;
  }

  private decide(world: World, self: Unit): Command | null {
    const foeTeam = enemyOf(self.team);
    const towardFoe = self.team === 'blue' ? 1 : -1;
    const alive = world.units.filter((u) => !u.dead);
    const enemyTowers = alive.filter((u) => u.team === foeTeam && u.kind === 'tower');
    const allies = alive.filter((u) => u.team === self.team && u.kind === 'minion');
    const foe = alive.find((u) => u.team === foeTeam && u.kind === 'champion');
    const kit = kitOf(self);
    const abilities = self.champ!.abilities;
    const ctx: Ctx = {
      world, self, foe,
      near: (d) => !!foe && gap(self, foe) <= d,
      unsafe: (p) =>
        enemyTowers.some((t) => {
          const covered = allies.some((m) => dist(m.pos, t.pos) < t.range + t.radius);
          return !covered && dist(p, t.pos) < t.range + t.radius + self.radius + 1.5;
        }),
      ready: (slot) => world.castBlocker(self, slot) === null && abilities[slot].recastUntil <= world.tick,
      recasting: (slot) => world.castBlocker(self, slot) === null && abilities[slot].recastUntil > world.tick,
      dmg: (slot) => kit.abilities[slot].damage?.(abilities[slot].rank, self) ?? 0,
      aim: (target, speed) => this.miss(world, lead(world, self.pos, target, speed)),
      aimAfter: (target, seconds) => this.miss(world, leadTime(world, target, seconds)),
    };
    const kitPlay = {
      arlo: { play: this.arlo, escape: this.arloEscape },
      tock: { play: this.tock, escape: this.tockEscape },
      maren: { play: this.maren, escape: this.marenEscape },
    }[self.champ!.kit];

    // Go home when low and stay until (nearly) healed by the fountain.
    if (self.hp < self.maxHp * 0.3) this.retreating = true;
    if (self.hp > self.maxHp * 0.9) this.retreating = false;
    if (this.retreating) return kitPlay.escape.call(this, ctx) ?? { type: 'move', to: spawnPoint(self.team) };
    if (ctx.unsafe(self.pos)) return { type: 'move', to: { x: self.pos.x - towardFoe * 4, y: self.pos.y } };

    const play = kitPlay.play.call(this, ctx);
    if (play) return play;

    // Trade autos when healthy (melee needs to walk further in).
    if (foe && self.hp > self.maxHp * 0.6 && gap(self, foe) < self.range + (self.range < 3 ? 3 : 1) && !ctx.unsafe(foe.pos)) {
      return { type: 'attack', target: foe.id };
    }

    const farm = alive
      .filter((u) => u.team === foeTeam && u.kind === 'minion' && gap(self, u) < self.range + 2 && !ctx.unsafe(u.pos))
      .sort((a, b) => a.hp - b.hp)[0];
    if (farm) return { type: 'attack', target: farm.id };

    // Stand a little behind the front of our wave, or by our outer tower if there's no wave.
    const front = allies.length
      ? allies.reduce((f, m) => (m.pos.x * towardFoe > f * towardFoe ? m.pos.x : f), allies[0].pos.x) - towardFoe * 3
      : sideX(self.team, LANE.towerXs[LANE.towerXs.length - 1] - 3);
    const spot = { x: front, y: (world.rng.next() * 2 - 1) * 2 };
    if (ctx.unsafe(spot) || Math.abs(spot.x - self.pos.x) < 1.5) return null;
    return { type: 'move', to: spot };
  }

  /** Scatter an aim point by this bot's inaccuracy. */
  private miss(world: World, p: Vec2): Vec2 {
    const miss = (1 - this.accuracy) * 3;
    return { x: p.x + (world.rng.next() * 2 - 1) * miss, y: p.y + (world.rng.next() * 2 - 1) * miss };
  }

  // ---------- Arlo ----------

  private arlo(ctx: Ctx): Command | null {
    const { world, self, foe, unsafe, ready, dmg, aim } = ctx;
    const k = kitOf(self).abilities;
    const r = self.champ!.abilities;
    const mana = self.champ!.mana;
    if (foe) {
      const d = dist(self.pos, foe.pos);
      if (ready(3) && foe.hp < dmg(3) && d > 6 && d < 70) return cast(3, aim(foe, 28));
      if (ready(2) && foe.hp < dmg(2) + (ready(0) ? dmg(0) : 0) && d < 9 && !unsafe(foe.pos)) return cast(2, foe.pos);
      if (ready(1) && d < 10 && mana > k[1].cost(r[1].rank) + k[0].cost(r[0].rank)) return cast(1, aim(foe, 22));
      if (ready(0) && d < 10.5) {
        const p = aim(foe, 32);
        if (!minionInTheWay(world, self, p, 0.6)) return cast(0, p);
      }
      if (gap(self, foe) < 3 && self.hp < foe.hp) {
        const out = this.arloEscape(ctx);
        if (out) return out;
      }
    }
    // Last-hit out of auto range with Sparkshot when there's mana to spare.
    if (ready(0) && mana > self.champ!.maxMana * 0.45) {
      const kill = world.units.find(
        (u) => !u.dead && u.kind === 'minion' && u.team !== self.team && u.hp < dmg(0) && dist(u.pos, self.pos) < 10 &&
          gap(self, u) > self.range && !minionInTheWay(world, self, u.pos, 0.6, u) && !unsafe(u.pos),
      );
      if (kill) return cast(0, kill.pos);
    }
    return null;
  }

  private arloEscape({ self, foe, ready }: Ctx): Command | null {
    if (!foe || !ready(2) || gap(self, foe) > 4) return null;
    const home = dirTo(self.pos, spawnPoint(self.team));
    return cast(2, { x: self.pos.x + home.x * 5, y: self.pos.y + home.y * 5 });
  }

  // ---------- Tock ----------

  private tock(ctx: Ctx): Command | null {
    const { world, self, foe, near, unsafe, ready, recasting } = ctx;
    // Freeze skillshots flying at us.
    if (ready(1)) {
      const incoming = world.missiles.find(
        (m) => m.team !== self.team && m.targetId == null && m.frozenBy == null && dist(m.pos, self.pos) < 9 &&
          m.dir.x * (self.pos.x - m.pos.x) + m.dir.y * (self.pos.y - m.pos.y) > 0,
      );
      if (incoming) return cast(1, { x: (self.pos.x + incoming.pos.x) / 2, y: (self.pos.y + incoming.pos.y) / 2 });
    }
    if (!foe) return this.tockFarm(ctx);
    const healthy = self.hp > self.maxHp * 0.5;

    if (ready(3) && !healthy && near(4)) return cast(3, self.pos);
    if (recasting(0) && near(3)) return cast(0, foe.pos);
    if (ready(0) && near(3)) return cast(0, foe.pos);
    if (ready(2) && healthy && near(6.5) && !near(2) && !unsafe(foe.pos)) return cast(2, foe.pos);
    if (ready(1) && near(6) && foe.champ?.kit === 'arlo') return cast(1, foe.pos);
    if (recasting(2) && (self.hp < self.maxHp * 0.35 || unsafe(self.pos))) return cast(2, self.pos);
    if (isRewinding(self)) return { type: 'attack', target: foe.id }; // make the replay hurt
    return this.tockFarm(ctx);
  }

  private tockFarm({ world, self, ready }: Ctx): Command | null {
    if (!ready(0) || self.champ!.mana < self.champ!.maxMana * 0.6) return null;
    const cone = kitOf(self).abilities[0].aim;
    if (cone.shape !== 'cone') return null;
    const minions = world.units.filter((u) => !u.dead && u.kind === 'minion' && u.team !== self.team && gap(self, u) < cone.radius);
    for (const m of minions) {
      const dir = Math.atan2(m.pos.y - self.pos.y, m.pos.x - self.pos.x);
      if (minions.filter((o) => inCone(self.pos, dir, cone.radius, cone.angle, o.pos, o.radius)).length >= 3) return cast(0, m.pos);
    }
    return null;
  }

  private tockEscape({ self, recasting, ready, near }: Ctx): Command | null {
    if (recasting(2)) return cast(2, self.pos);
    if (ready(3) && near(4)) return cast(3, self.pos);
    return null;
  }

  // ---------- Maren ----------

  private maren(ctx: Ctx): Command | null {
    const { world, self, foe, near, unsafe, ready, aim, aimAfter } = ctx;
    const mana = self.champ!.mana;
    if (foe) {
      const d = dist(self.pos, foe.pos);
      const pinned = world.isRooted(foe) || !!world.status(foe, 'slow');
      // Shield up when they commit, or when a tower is about to start hitting us.
      if (ready(1) && (near(2.5) || (self.hp < self.maxHp * 0.6 && near(5)))) return cast(1, self.pos);
      if (ready(3) && d < 10 && (pinned || foe.hp < foe.maxHp * 0.5) && !unsafe(foe.pos)) return cast(3, aimAfter(foe, 0.5));
      if (ready(2) && d < 8.5 && !unsafe(foe.pos) && self.hp > self.maxHp * 0.4) {
        const p = aim(foe, 26);
        if (!minionInTheWay(world, self, p, 0.7)) return cast(2, p);
      }
      if (ready(0) && d < 9.5) return cast(0, aimAfter(foe, 0.75));
    }
    // Farm with Riptide when it hits a cluster.
    if (ready(0) && mana > self.champ!.maxMana * 0.5) {
      const minions = world.units.filter((u) => !u.dead && u.kind === 'minion' && u.team !== self.team && dist(u.pos, self.pos) < 9 && !unsafe(u.pos));
      const best = minions.find((m) => minions.filter((o) => dist(o.pos, m.pos) < 2).length >= 3);
      if (best) return cast(0, best.pos);
    }
    return null;
  }

  private marenEscape({ self, foe, near, ready, aim }: Ctx): Command | null {
    if (ready(1) && near(5)) return cast(1, self.pos);
    if (foe && ready(0) && near(4)) return cast(0, aim(foe, 99)); // slow them on the way out
    return null;
  }
}
