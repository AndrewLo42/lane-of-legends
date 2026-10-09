import { lead, leadTime, minionInTheWay } from './aim';
import { kitOf } from './kits';
import { holdingSpear, spearOnGround } from './kits/aurelle';
import { isRewinding } from './kits/tock';
import { LANE, sideX, spawnPoint } from './lane';
import { BARRIER, IGNITE, TETHER, igniteTarget } from './summoners';
import type { Command, Controller, Slot, SummonerId, SummonerSlot, Unit, Vec2 } from './types';
import { TICK_HZ, dirTo, dist, inCone, segmentDistance, toward } from './util';
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
  private nextSummoner = 0;
  /** Telegraphs and missiles already judged: id -> whether this bot reacts to it. */
  private noticed = new Map<number, boolean>();
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
    // Step out of telegraphed attacks first (Skyline Barrage, Maren's geyser, Mabel's honey).
    const dodge = world.isBusy(self) ? null : this.dodge(world, self);
    if (dodge) {
      cmds.push(dodge);
      return cmds;
    }
    // Summoner spells are checked more often than the main decision: Barrier and Flash are reactions.
    if (world.tick >= this.nextSummoner) {
      this.nextSummoner = world.tick + 3;
      const spell = this.summoners(world, self);
      if (spell) {
        cmds.push(spell);
        return cmds;
      }
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
      lisha: { play: this.lisha, escape: this.lishaEscape },
      mabel: { play: this.mabel, escape: this.mabelEscape },
      aurelle: { play: this.aurelle, escape: this.aurelleEscape },
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

  // ---------- dodging ----------

  /**
   * Where to step to get out of an enemy line or circle telegraph (or a lane-crossing wave in flight)
   * that covers us, or null if nothing threatens. Whether it reacts at all is rolled once per threat
   * against this bot's accuracy, so low floors still get caught.
   */
  private dodge(world: World, self: Unit): Command | null {
    const reacts = (id: number) => {
      if (!this.noticed.has(id)) this.noticed.set(id, world.rng.next() < this.accuracy);
      return this.noticed.get(id)!;
    };
    const margin = self.radius + 0.3;
    const fromLine = (pos: Vec2, dir: number, length: number, width: number): Vec2 | null => {
      const dx = Math.cos(dir);
      const dy = Math.sin(dir);
      const rx = self.pos.x - pos.x;
      const ry = self.pos.y - pos.y;
      const along = rx * dx + ry * dy;
      const side = rx * -dy + ry * dx; // signed distance from the line
      if (along < -1 || along > length || Math.abs(side) > width / 2 + margin) return null;
      const need = width / 2 + margin + 0.8 - Math.abs(side);
      for (const sgn of [Math.sign(side) || 1, -(Math.sign(side) || 1)]) {
        const to = { x: self.pos.x - dy * need * sgn, y: self.pos.y + dx * need * sgn };
        if (Math.abs(to.y) < LANE.halfWidth - self.radius) return to; // stay inside the lane
      }
      return null;
    };
    for (const t of world.telegraphs) {
      if (t.team === self.team || !reacts(t.id)) continue;
      if (t.shape === 'line') {
        const to = fromLine(t.pos, t.dir, t.length, t.width);
        if (to) return { type: 'move', to };
      } else if (t.shape === 'circle') {
        const d = dist(self.pos, t.pos);
        if (d < t.length + margin) {
          const out = dirTo(t.pos, self.pos);
          const r = t.length + margin + 0.8;
          return { type: 'move', to: { x: t.pos.x + out.x * r, y: t.pos.y + out.y * r } };
        }
      }
    }
    // A wide line missile (Skyline Barrage) still crossing the lane.
    for (const m of world.missiles) {
      if (m.team === self.team || m.targetId != null || m.width < 1.5 || !reacts(m.id)) continue;
      const to = fromLine(m.pos, Math.atan2(m.dir.y, m.dir.x), m.range - m.travelled, m.width);
      if (to) return { type: 'move', to };
    }
    if (this.noticed.size > 200) this.noticed.clear();
    return null;
  }

  // ---------- summoner spells ----------

  private summoners(world: World, self: Unit): Command | null {
    const c = self.champ!;
    const foe = world.champions().find((u) => u.team !== self.team && !u.dead);
    if (!foe || self.dead) return null;
    const slotOf = (id: SummonerId) => {
      const i = c.summoners.findIndex((s) => s.id === id);
      return i >= 0 && world.summonerBlocker(self, i as SummonerSlot) === null ? (i as SummonerSlot) : null;
    };
    const use = (id: SummonerId, at: Vec2): Command | null => {
      const slot = slotOf(id);
      return slot == null ? null : { type: 'summon', slot, at };
    };
    const d = gap(self, foe);
    const hp = self.hp / self.maxHp;
    const foeHp = foe.hp / foe.maxHp;
    const home = spawnPoint(self.team);
    const hurtLately = world.tick - self.lastHurtTick < 10;
    const towerCovers = (p: Vec2) =>
      world.units.some((t) => !t.dead && t.kind === 'tower' && t.team !== self.team && dist(p, t.pos) < t.range + t.radius);

    // Save yourself first.
    if (hp < 0.25 && hurtLately && d < 7) {
      const save = use('barrier', self.pos);
      if (save && self.hp < BARRIER.base * 3) return save;
    }
    if (hp < 0.2 && d < 4 && hurtLately) {
      const away = { x: self.pos.x + Math.sign(home.x - self.pos.x) * 6, y: self.pos.y };
      return use('flash', away) ?? use('ghost', self.pos);
    }
    if (this.retreating && d < 6) {
      const run = use('ghost', self.pos);
      if (run) return run;
    }

    // Then press an advantage.
    const winning = hp > 0.4 && (foeHp < 0.35 || self.hp > foe.hp * 1.4);
    if (winning && !towerCovers(foe.pos)) {
      const burn = IGNITE.base + IGNITE.perLevel * c.level;
      if (igniteTarget(world, self, foe.pos) && (foe.hp < burn + self.damage * 2 || foeHp < 0.3)) {
        const ig = use('ignite', foe.pos);
        if (ig) return ig;
      }
      if (foeHp < 0.2 && d > self.range + 0.5 && d < self.range + 4) {
        const jump = use('flash', foe.pos);
        if (jump) return jump;
      }
      if (foeHp < 0.3 && d > 3 && d < 9) {
        const chase = use('ghost', self.pos);
        if (chase) return chase;
      }
    }
    if (d < self.range + 1 && self.attackTarget === foe.id && hp > 0.3) {
      const rage = use('rage', self.pos);
      if (rage) return rage;
    }

    // Tether: throw at a weakened champion with a clear line, dash in if it lands somewhere safe.
    const tSlot = c.summoners.findIndex((s) => s.id === 'tether');
    if (tSlot >= 0) {
      const st = c.summoners[tSlot];
      const tagged = world.status(foe, 'tether', self.id);
      if (st.recastUntil > world.tick) {
        if (tagged && hp > 0.35 && !towerCovers(foe.pos)) return { type: 'summon', slot: tSlot as SummonerSlot, at: foe.pos };
      } else if (hp > 0.5 && foeHp < 0.55 && d > 3 && d < TETHER.range - 1 && !towerCovers(foe.pos)) {
        const p = this.miss(world, lead(world, self.pos, foe, TETHER.speed));
        if (!minionInTheWay(world, self, p, TETHER.width)) {
          const throwIt = use('tether', p);
          if (throwIt) return throwIt;
        }
      }
    }
    return null;
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

    // Against ranged champions: drop Stopwatch on them (35% slow), then Skip in while they're stuck.
    if (foe.range >= 3 && !unsafe(foe.pos)) {
      const inField = world.zones.some((z) => z.kind === 'stasis' && z.ownerId === self.id && dist(z.pos, foe.pos) <= z.radius + foe.radius);
      if (ready(1) && healthy && near(7) && !near(2)) return cast(1, ctx.aimAfter(foe, 0.3));
      if (ready(2) && inField && near(6.5) && !near(1.5)) return cast(2, foe.pos);
    }

    if (ready(3) && !healthy && near(4)) return cast(3, self.pos);
    if (ready(1) && near(2.5)) return cast(1, self.pos); // slow them and shield himself in a melee trade
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

  // ---------- Lisha ----------

  private lisha(ctx: Ctx): Command | null {
    const { world, self, foe, near, unsafe, ready, dmg, aim } = ctx;
    const marked = (u: Unit) => !!world.status(u, 'mark', self.id);
    const qReach = (u: Unit) => gap(self, u) <= 6;
    const healthy = self.hp > self.maxHp * 0.5;
    if (foe) {
      // Brace when trading at close range and getting hurt.
      if (ready(1) && near(3) && self.hp < self.maxHp * 0.7) return cast(1, self.pos);
      if (ready(3) && near(7) && (foe.hp < foe.maxHp * 0.55 || healthy) && !unsafe(foe.pos)) return cast(3, aim(foe, 24));
      if (ready(0) && qReach(foe) && (marked(foe) || foe.hp < dmg(0)) && !unsafe(foe.pos)) return cast(0, foe.pos);
      // Twin Petals' point reaches 8 at most, so only throw it when they're close enough to sit inside the V.
      if (ready(2) && dist(self.pos, foe.pos) <= 6.5 && !unsafe(foe.pos)) {
        // Mark the champion first; the dash follows once it lands. The pincer closes on its point a
        // moment after the cast, so lead by that, and aim well past them: the V is widest at its open
        // end, so a target deep inside it is much harder to slip out of.
        const p = ctx.aimAfter(foe, 0.15 + dist(self.pos, foe.pos) / 24);
        const d = dirTo(self.pos, p);
        return cast(2, { x: p.x + d.x * 2.5, y: p.y + d.y * 2.5 });
      }
      // Commit when the fight is good, mark or not: she's a duelist. But if Twin Petals is about to
      // come back, wait for it: a marked Petal Step refunds itself and heals her, an unmarked one doesn't.
      const winning = foe.hp < foe.maxHp * 0.6 || self.hp > foe.hp * 1.2;
      const eSoon = self.champ!.abilities[2].rank > 0 && (self.champ!.abilities[2].readyAt - world.tick) / TICK_HZ < 2;
      if (ready(0) && qReach(foe) && healthy && winning && !eSoon && !near(1) && !unsafe(foe.pos)) return cast(0, foe.pos);
      // Engage through the wave: dash onto a marked or killable minion next to them (the reset brings
      // Petal Step straight back), then onto them.
      if (ready(0) && healthy && !qReach(foe) && gap(self, foe) < 12 && !unsafe(foe.pos)) {
        const stone = world.units.find(
          (u) => !u.dead && u.kind === 'minion' && u.team !== self.team && qReach(u) && (marked(u) || u.hp < dmg(0)) &&
            dist(u.pos, foe.pos) < dist(self.pos, foe.pos) - 2 && gap(u, foe) <= 5 && !unsafe(u.pos),
        );
        if (stone) return cast(0, stone.pos);
      }
    }
    // Chain Petal Step through marked or killable minions (each one resets it).
    if (ready(0)) {
      const hop = world.units.find(
        (u) => !u.dead && u.kind === 'minion' && u.team !== self.team && qReach(u) && (marked(u) || u.hp < dmg(0)) && !unsafe(u.pos),
      );
      if (hop) return cast(0, hop.pos);
    }
    // Twin Petals on the wave only when the champion is nowhere near (keep it for them).
    if (ready(2) && self.champ!.mana > self.champ!.maxMana * 0.6 && !(foe && near(12))) {
      const minions = world.units.filter((u) => !u.dead && u.kind === 'minion' && u.team !== self.team && dist(u.pos, self.pos) < 7 && !unsafe(u.pos));
      if (minions.length >= 3) return cast(2, minions[0].pos);
    }
    return null;
  }

  private lishaEscape({ world, self, foe, near, ready, dmg, unsafe }: Ctx): Command | null {
    // Hop out through a marked or killable minion further from them (the reset keeps Petal Step up).
    if (foe && ready(0) && near(5)) {
      const out = world.units.find(
        (u) => !u.dead && u.kind === 'minion' && u.team !== self.team && gap(self, u) <= 6 &&
          (!!world.status(u, 'mark', self.id) || u.hp < dmg(0)) && dist(u.pos, foe.pos) > dist(self.pos, foe.pos) + 2 && !unsafe(u.pos),
      );
      if (out) return cast(0, out.pos);
    }
    return ready(1) && near(4) ? cast(1, self.pos) : null; // brace and regenerate on the way out
  }

  // ---------- Aurelle ----------

  private aurelle(ctx: Ctx): Command | null {
    const { world, self, foe, near, unsafe, ready, recasting, aim } = ctx;
    if (foe) {
      // Arsenal when a fight is on: three lances a volley and cleaving bolts.
      if (ready(3) && near(6) && (foe.hp < foe.maxHp * 0.6 || self.hp > self.maxHp * 0.6) && !unsafe(foe.pos)) return cast(3, self.pos);
      // The spear is in them: rip it back through them right away.
      if (recasting(0)) return cast(0, foe.pos);
      if (ready(0) && near(9) && !unsafe(foe.pos)) {
        // Don't feed the spear to a Stopwatch field: it would freeze there and drop.
        const p = aim(foe, 26);
        const frozen = world.zones.some((z) => z.kind === 'stasis' && z.team !== self.team && segmentDistance(z.pos, self.pos, p).d < z.radius);
        if (!frozen) return cast(0, p);
      }
      // Sweep with the spear in hand, Nova without it, each only when they're inside it.
      if (ready(2) && (holdingSpear(self) ? near(2.2) : near(3))) return cast(2, self.pos);
    }
    // Walk back for a dropped spear when it's somewhere safe.
    const spear = spearOnGround(self);
    if (spear && !unsafe(spear) && !(foe && near(3) && self.hp < self.maxHp * 0.5)) return { type: 'move', to: spear };
    return null;
  }

  private aurelleEscape({ self, near, ready }: Ctx): Command | null {
    // Blink home, leaving a glyph on the chaser.
    if (ready(1) && near(4)) return cast(1, spawnPoint(self.team));
    return null;
  }

  // ---------- Mabel ----------

  private mabel(ctx: Ctx): Command | null {
    const { world, self, foe, near, unsafe, ready, aim, aimAfter } = ctx;
    const bees = Math.floor(self.champ!.mana);
    const hive = world.zones.some((z) => z.kind === 'hive' && z.ownerId === self.id);
    const towardFoe = self.team === 'blue' ? 1 : -1;
    // Kite melee champions: honey the chaser, drop the hive behind her, and between shots step back
    // along the lane (toward her side) so they never get to swing.
    if (foe && foe.range < 3) {
      const theirReach = foe.range + foe.radius + self.radius;
      const d = dist(self.pos, foe.pos);
      if (d < theirReach + 2.5) {
        if (ready(1)) return cast(1, aimAfter(foe, 0.5));
        if (ready(2) && !hive && bees >= 2) return cast(2, { x: self.pos.x - towardFoe * 1.5, y: self.pos.y });
        if (self.windup > 0) return { type: 'attack', target: foe.id }; // let the bee leave her paw
        const canShoot = self.attackCd === 0 && gap(self, foe) <= self.range;
        if (canShoot && d > theirReach + 0.4) return { type: 'attack', target: foe.id };
        const away = { x: self.pos.x - towardFoe * 3, y: self.pos.y + Math.sign(self.pos.y - foe.pos.y || 1) * 1.2 };
        if (!unsafe(away)) return { type: 'move', to: away };
      }
    }
    if (foe) {
      const honeyed = !!world.status(foe, 'honey');
      if (ready(3) && near(7) && (foe.hp < foe.maxHp * 0.5 || (honeyed && self.hp > self.maxHp * 0.5)) && !unsafe(foe.pos)) {
        return cast(3, foe.pos);
      }
      // Honey first: the slow sets up stings, and honeyed targets take more from the bees.
      if (ready(1) && near(8)) return cast(1, aimAfter(foe, 0.6));
      // Keep a bee in reserve for the hive unless the target is honeyed or low.
      if (ready(0) && near(9) && (bees >= 3 || honeyed || foe.hp < foe.maxHp * 0.35)) {
        const p = aim(foe, 22);
        if (!minionInTheWay(world, self, p, 0.5)) return cast(0, p);
      }
      // Plant the hive between her and the fight when they come at her.
      if (ready(2) && !hive && near(6)) return cast(2, { x: self.pos.x + towardFoe * 1.5, y: self.pos.y });
    }
    // Honey a clump of enemy minions: slowed and honeyed, they melt under her bees and the hive.
    const enemyMinions = world.units.filter((u) => !u.dead && u.kind === 'minion' && u.team !== self.team && dist(u.pos, self.pos) < 9 && !unsafe(u.pos));
    if (ready(1) && enemyMinions.length >= 3 && !near(5)) {
      const c = enemyMinions.reduce((p, m) => ({ x: p.x + m.pos.x / enemyMinions.length, y: p.y + m.pos.y / enemyMinions.length }), { x: 0, y: 0 });
      return cast(1, c);
    }
    // Siege: plant the hive by her wave when it's near enemy minions or a tower.
    if (ready(2) && !hive && bees >= 3) {
      const wave = world.units.filter((u) => !u.dead && u.kind === 'minion' && u.team !== self.team && dist(u.pos, self.pos) < 8);
      if (wave.length >= 3) return cast(2, toward(self.pos, wave[0].pos, 4));
    }
    // Spare bees go into stinging the weakest unclaimed minion (Pollinated: stung minions are hers when they die).
    if (ready(0) && bees >= 2) {
      const m = enemyMinions
        .filter((u) => !u.statuses.some((st) => st.kind === 'sting' && st.sourceId === self.id))
        .sort((a, b) => a.hp - b.hp)[0];
      if (m && m.hp < m.maxHp * 0.6) return cast(0, m.pos);
    }
    return null;
  }

  private mabelEscape({ world, self, foe, near, ready, aimAfter }: Ctx): Command | null {
    // Drop honey on the chaser.
    if (foe && ready(1) && near(5)) return cast(1, aimAfter(foe, 0.5));
    if (ready(2) && near(5) && !world.zones.some((z) => z.kind === 'hive' && z.ownerId === self.id)) return cast(2, self.pos);
    return null;
  }
}
