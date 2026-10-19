import { lead, leadTime, minionInTheWay } from './aim';
import { abilitiesOf, kitOf } from './kits';
import { holdingSpear, spearOnGround } from './kits/aurelle';
import { GORMUND_TUNING, calmFor, raging } from './kits/gormund';
import { SABLE_TUNING, reaping, windowOpen } from './kits/sable';
import { PIP_TUNING, panicking, riding, thistleOf } from './kits/pip';
import { GERRIT_TUNING, nearStandard, standardOnLine, standardsOf } from './kits/gerrit';
import { LUMEN_TUNING, devotion } from './kits/lumen';
import { FENNICK_TUNING, drawFraction, drawing, longshotRange, overcharged, volleyReady } from './kits/fennick';
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
 * Poke awareness: having taken `share` of max health from the enemy champion within `window` seconds
 * while below `healthy` health (and not ahead), a bot farming the wave plays safe; `margin` is how far
 * outside their attack reach it waits.
 */
const POKE = { share: 0.08, window: 3, margin: 1, healthy: 0.75 };
/** A narrow skillshot is noticed this many seconds before it would hit, and dodged with this share of the bot's accuracy. */
const SKILLSHOT_NOTICE = 0.45;
/** Bots attack-move up to the wave only when the enemy champion is dead or at least this far away. */
const ATTACK_MOVE_CLEAR = 15;
const SKILLSHOT_DODGE = 0.3;

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
  /** Damage this bot took from the enemy champion lately (when, how much), for noticing poke while farming. */
  private poke: { tick: number; amount: number }[] = [];
  private hitSeq = 0;

  constructor(private accuracy = 0.8) {}

  think(world: World, self: Unit): Command[] {
    const cmds: Command[] = [];
    this.notePoke(world, self);
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
      dmg: (slot) => abilitiesOf(self)[slot].damage?.(abilities[slot].rank, self) ?? 0,
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
      gormund: { play: this.gormund, escape: this.gormundEscape },
      sable: { play: this.sable, escape: this.sableEscape },
      pip: { play: this.pip, escape: this.pipEscape },
      gerrit: { play: this.gerrit, escape: this.gerritEscape },
      lumen: { play: this.lumen, escape: this.lumenEscape },
      fennick: { play: this.fennick, escape: this.fennickEscape },
    }[self.champ!.kit];

    // Go home when low and stay until (nearly) healed by the fountain.
    // Gormund fights on lower (Fury) and only needs to get back to most of his health: Thick Hide
    // regenerates it in lane.
    const tanky = self.champ!.kit === 'gormund';
    // Pip: while he rides, Thistle's health takes the hits, so judge by both.
    const toad = self.champ!.kit === 'pip' && riding(self) ? thistleOf(world, self) : undefined;
    const health = toad ? (self.hp + toad.hp) / (self.maxHp + toad.maxHp) : self.hp / self.maxHp;
    if (health < (tanky ? 0.22 : 0.3)) this.retreating = true;
    if (health > (tanky ? 0.65 : 0.9)) this.retreating = false;
    if (this.retreating) {
      // Gormund doesn't need the fountain: once nobody is hitting him, he stands still and regenerates.
      const chased = world.units.some((u) => !u.dead && u.team !== self.team && u.attackTarget === self.id);
      if (tanky && !chased && !ctx.near(9) && calmFor(world, self) > TICK_HZ * 2 && !ctx.unsafe(self.pos)) return { type: 'stop' };
      return kitPlay.escape.call(this, ctx) ?? { type: 'move', to: spawnPoint(self.team) };
    }
    if (ctx.unsafe(self.pos)) return { type: 'move', to: { x: self.pos.x - towardFoe * 4, y: self.pos.y } };

    const play = kitPlay.play.call(this, ctx);
    if (play) return play;

    // Being poked from out of reach while farming: only step in for last hits, and otherwise wait out of
    // the enemy champion's reach behind the wave.
    const cautious = !!foe && this.underPoke(world, self, foe);
    if (cautious && foe) {
      const reach = foe.range + foe.radius + self.radius + POKE.margin;
      if (dist(self.pos, foe.pos) < reach) {
        const out = { x: self.pos.x - towardFoe * 2.5, y: self.pos.y + Math.sign(self.pos.y - foe.pos.y || 1) * 0.8 };
        if (!ctx.unsafe(out)) return { type: 'move', to: out };
      }
      // Walk in for a last hit, as long as it isn't inside their reach.
      const lastHit = alive
        .filter((u) => u.team === foeTeam && u.kind === 'minion' && u.hp <= self.damage * 1.05 && gap(self, u) < self.range + 4 &&
          dist(u.pos, foe.pos) > reach && !ctx.unsafe(u.pos))
        .sort((a, b) => gap(self, a) - gap(self, b))[0];
      if (lastHit) return { type: 'attack', target: lastHit.id };
      if (self.attackTarget != null) return { type: 'stop' }; // don't keep swinging at the wave from in front of them
      // Otherwise wait behind our wave, out of their reach.
      const wait = allies.length
        ? { x: allies.reduce((f, m) => (m.pos.x * towardFoe > f * towardFoe ? m.pos.x : f), allies[0].pos.x) - towardFoe * 4, y: self.pos.y }
        : null;
      if (wait && dist(wait, foe.pos) > reach && !ctx.unsafe(wait) && Math.abs(wait.x - self.pos.x) > 1.5) return { type: 'move', to: wait };
      return null;
    }

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
    // Walking up to the wave with the enemy champion dead or far off: attack-move, hitting whatever it
    // meets on the way. Nearer, a plain move: attack-move would start trades nobody decided on.
    if (!foe || dist(self.pos, foe.pos) > ATTACK_MOVE_CLEAR) return { type: 'attackMove', to: spot };
    return { type: 'move', to: spot };
  }

  // ---------- poke ----------

  /** Record damage from the enemy champion (and its pet) since the last tick; forget anything older than the window. */
  private notePoke(world: World, self: Unit) {
    for (const h of world.hits) {
      if (h.seq <= this.hitSeq) continue;
      this.hitSeq = h.seq;
      // Direct hits only: stepping back doesn't stop a burn or a sting that's already ticking.
      if (h.targetId !== self.id || h.proc || (h.sourceKind !== 'champion' && h.sourceKind !== 'pet')) continue;
      const src = world.get(h.sourceId);
      // Only hits from out of our reach are poke; trading blows up close is a fight.
      if (!src || src.team === self.team || gap(self, src) <= self.range + 0.5) continue;
      this.poke.push({ tick: h.tick, amount: h.amount });
    }
    const since = world.tick - POKE.window * TICK_HZ;
    while (this.poke.length && this.poke[0].tick < since) this.poke.shift();
  }

  /**
   * Taking poke: the enemy champion has dealt a noticeable share of our health lately from outside our
   * own reach. Someone standing in reach is a fight, not poke: the usual trade-or-retreat rules handle it.
   */
  private underPoke(world: World, self: Unit, foe: Unit) {
    if (gap(self, foe) <= self.range + 0.5 || world.isBusy(self)) return false;
    // A melee champion can't out-wait a ranged one: it farms through the poke and looks for the all-in.
    if (self.range < 3 && foe.range >= 3) return false;
    // Healthy, or ahead on health, it can afford some poke; and their wave on our tower needs defending.
    const hp = self.hp / self.maxHp;
    if (hp > POKE.healthy || hp > foe.hp / foe.maxHp + 0.1) return false;
    const sieged = world.units.some(
      (t) => !t.dead && t.kind === 'tower' && t.team === self.team &&
        world.units.some((m) => !m.dead && m.kind === 'minion' && m.team !== self.team && dist(m.pos, t.pos) < t.range + t.radius),
    );
    if (sieged) return false;
    const taken = this.poke.reduce((t, p) => t + p.amount, 0);
    return taken >= self.maxHp * POKE.share;
  }

  // ---------- dodging ----------

  /**
   * Where to step to get out of an enemy line or circle telegraph (or a lane-crossing wave in flight)
   * that covers us, or null if nothing threatens. Whether it reacts at all is rolled once per threat
   * against this bot's accuracy, so low floors still get caught.
   */
  private dodge(world: World, self: Unit): Command | null {
    const reacts = (id: number, chance = this.accuracy) => {
      if (!this.noticed.has(id)) this.noticed.set(id, world.rng.next() < chance);
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
    // A wide line missile (Skyline Barrage) still crossing the lane, or a skillshot about to land: step
    // out of its path. Narrow ones are harder to read (and only worth it in the last moment before they hit).
    for (const m of world.missiles) {
      if (m.team === self.team || m.targetId != null || m.frozenBy != null) continue;
      const wide = m.width >= 1.5;
      if (!wide) {
        const along = (self.pos.x - m.pos.x) * m.dir.x + (self.pos.y - m.pos.y) * m.dir.y;
        if (along < 0 || along > m.range - m.travelled || along / m.speed > SKILLSHOT_NOTICE) continue;
      }
      if (!reacts(m.id, wide ? this.accuracy : this.accuracy * SKILLSHOT_DODGE)) continue;
      const to = fromLine(m.pos, Math.atan2(m.dir.y, m.dir.x), m.range - m.travelled, m.width);
      if (to) return { type: 'move', to };
    }
    // Gerrit's standards: never stand on the line between him and one he can thrust to (it pulls him
    // through you for a knock-up). Only while his thrust is ready or nearly so.
    const { Q } = GERRIT_TUNING;
    for (const g of world.champions()) {
      if (g.team === self.team || g.dead || g.champ!.kit !== 'gerrit') continue;
      const q = g.champ!.abilities[0];
      if (q.rank === 0 || q.readyAt - world.tick > TICK_HZ * 1.5) continue;
      for (const z of standardsOf(world, g)) {
        const d = dist(g.pos, z.pos);
        if (d > Q.length + 0.5 || !reacts(z.id)) continue;
        const to = fromLine(g.pos, Math.atan2(z.pos.y - g.pos.y, z.pos.x - g.pos.x), d, Q.width + 0.6);
        if (to) return { type: 'move', to };
      }
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
    // Walk back for a dropped spear when it's somewhere safe: not under their tower, not in the enemy
    // champion's reach or the middle of their wave (unless they're nearly dead).
    const spear = spearOnGround(self);
    if (spear && !unsafe(spear) && !(foe && near(3) && self.hp < self.maxHp * 0.5)) {
      const crowd = world.units.filter((u) => !u.dead && u.kind === 'minion' && u.team !== self.team && dist(u.pos, spear) < 3).length;
      const guarded = !!foe && foe.hp > foe.maxHp * 0.3 && (dist(spear, foe.pos) < foe.range + foe.radius + self.radius + 2 || crowd >= 3);
      if (!guarded) return { type: 'move', to: spear };
    }
    return null;
  }

  private aurelleEscape({ self, near, ready }: Ctx): Command | null {
    // Blink home, leaving a glyph on the chaser.
    if (ready(1) && near(4)) return cast(1, spawnPoint(self.team));
    return null;
  }

  // ---------- Gormund ----------

  private gormund(ctx: Ctx): Command | null {
    const { world, self, foe, near, unsafe, ready, aim, aimAfter } = ctx;
    if (!foe) return this.gormundFarm(ctx);
    const { Q, W, E } = GORMUND_TUNING;
    const hp = self.hp / self.maxHp;
    const foeHp = foe.hp / foe.maxHp;
    const d = gap(self, foe);
    // Fury makes low health less scary for him than for anyone else, so he commits on even trades.
    const fighting = foeHp < 0.6 || hp > foeHp - 0.05 || raging(world, self);
    // Hitting a champion turns their minions on him, so don't dive into the middle of their wave
    // unless it ends the fight (or Labyrinth Rage is carrying him through it).
    const wave = world.units.filter((u) => !u.dead && u.kind === 'minion' && u.team === foe.team && dist(u.pos, foe.pos) < 5).length;
    const safe = !unsafe(foe.pos) && (wave < 3 || foeHp < 0.3 || raging(world, self));
    // Only chase what he can catch: slowed, stunned, nearly dead, or already in his face. Otherwise
    // he farms and lets ranged champions come to him.
    const caught = world.isRooted(foe) || !!world.status(foe, 'slow') || foeHp < 0.3 || near(2) || raging(world, self);
    if (ready(3) && near(4) && fighting && safe) return cast(3, self.pos);
    // Bellow when they're in reach: slows them for the chase and cuts what he takes in the trade.
    if (ready(1) && near(W.radius - 0.5) && (fighting || world.tick - self.lastHurtTick < 10)) return cast(1, self.pos);
    // Fresh from a Bull Rush or Hurl Stone: they're stuck, swing.
    if (caught && fighting && near(4) && safe) return { type: 'attack', target: foe.id };
    // Being poked from out of reach: charge them (unless their whole wave is waiting), or throw a
    // stone, or back off out of their range. Never just stand and take it.
    const poked = foe.attackTarget === self.id && d > self.range + 0.5;
    if (poked) {
      if (ready(2) && d < E.range - 0.5 && hp > 0.35 && !unsafe(foe.pos) && (wave < 4 || foeHp < 0.5)) {
        const p = aimAfter(foe, E.windup + d / E.speed);
        return cast(2, toward(self.pos, p, dist(self.pos, p) + 2));
      }
      if (ready(0) && near(Q.range - 0.5)) {
        const p = aim(foe, Q.speed);
        if (!minionInTheWay(world, self, p, Q.width)) return cast(0, p);
      }
      const back = self.team === 'blue' ? -1 : 1;
      const out = { x: foe.pos.x + back * (foe.range + foe.radius + self.radius + 2), y: self.pos.y };
      if (!unsafe(out)) return { type: 'move', to: out };
    }
    // Bull Rush through them (aimed past, so they're carried the full distance).
    if (ready(2) && d > 1.5 && d < E.range - 0.5 && fighting && safe && (hp > 0.3 || foeHp < 0.3)) {
      const p = aimAfter(foe, E.windup + d / E.speed);
      return cast(2, toward(self.pos, p, dist(self.pos, p) + 2));
    }
    if (ready(0) && near(Q.range - 0.5) && (hp > 0.35 || raging(world, self) || foeHp < 0.3)) {
      const p = aim(foe, Q.speed);
      if (!minionInTheWay(world, self, p, Q.width)) return cast(0, p);
    }
    return this.gormundFarm(ctx);
  }

  /** Hurl Stone into a clump of minions when healthy: the shatter clears waves, and Thick Hide pays it back. */
  private gormundFarm({ world, self, unsafe, ready }: Ctx): Command | null {
    const { Q } = GORMUND_TUNING;
    if (!ready(0) || self.hp < self.maxHp * 0.45) return null;
    const minions = world.units.filter((u) => !u.dead && u.kind === 'minion' && u.team !== self.team && dist(u.pos, self.pos) < Q.range && !unsafe(u.pos));
    const best = minions.find((m) => minions.filter((o) => dist(o.pos, m.pos) < Q.shatter).length >= 3);
    return best && !minionInTheWay(world, self, best.pos, Q.width, best) ? cast(0, best.pos) : null;
  }

  private gormundEscape({ self, near, ready }: Ctx): Command | null {
    // Slow them and run.
    if (ready(1) && near(GORMUND_TUNING.W.radius)) return cast(1, self.pos);
    return null;
  }

  // ---------- Sable ----------

  private sable(ctx: Ctx): Command | null {
    const { world, self, foe, near, unsafe, ready, recasting, aim, aimAfter } = ctx;
    const { Q, REAP, W, E, R } = SABLE_TUNING;
    const mana = self.champ!.mana;
    const costs = (...slots: Slot[]) => slots.reduce((t: number, s) => t + abilitiesOf(self)[s].cost(Math.max(1, self.champ!.abilities[s].rank)), 0);
    if (foe) {
      const hp = self.hp / self.maxHp;
      const foeHp = foe.hp / foe.maxHp;
      const winning = foeHp < 0.6 || hp > foeHp + 0.1;
      // Hitting them turns their nearby minions on her: don't start fights next to their wave.
      const wave = world.units.filter((u) => !u.dead && u.kind === 'minion' && u.team === foe.team && dist(u.pos, foe.pos) < 6).length;
      const safe = !unsafe(foe.pos) && (wave < 3 || foeHp < 0.3);
      // A hook landed on them: weave in an auto while the window is young, then spend the one follow-up.
      if (windowOpen(world, self) && reaping(world, self).includes(foe)) {
        const r = Math.max(1, self.champ!.abilities[0].rank);
        const reap = (REAP.base[r - 1] + REAP.ad * self.damage) * (1 + REAP.missing * (1 - foeHp));
        const st = world.status(foe, 'reaping', self.id)!;
        const left = (st.until - world.tick) / TICK_HZ;
        const swinging = self.windup > 0 && self.attackTarget === foe.id;
        const canSwing = self.attackCd === 0 && gap(self, foe) <= world.attackRange(self, foe);
        if (left > 0.8 && (swinging || canSwing)) return { type: 'attack', target: foe.id };
        if (recasting(0) && foe.hp < reap) return cast(0, foe.pos); // Reap finishes them
        // Low and about to run: vault over them, onto their escape route (never under their tower).
        const d = dirTo(self.pos, foe.pos);
        const landing = { x: foe.pos.x + d.x * 2, y: foe.pos.y + d.y * 2 };
        if (recasting(2) && foeHp < 0.45 && !unsafe(landing)) return cast(2, foe.pos);
        if (recasting(1)) return cast(1, self.pos); // Bind, then the swings land
        if (recasting(0)) return cast(0, foe.pos);
        return { type: 'attack', target: foe.id };
      }
      if (ready(3) && near(R.radius - 1.5) && (winning || foeHp < 0.5) && safe) return cast(3, aimAfter(foe, R.windup));
      // Aggressive: Drift in beside them (its damage reduction carries the trade), then Wide Swath and swing.
      // She accepts a few of their minions' hits for it, just not a full wave or their tower.
      const bold = hp > 0.45 && hp > foeHp - 0.2 && (wave < 5 || foeHp < 0.4) && !unsafe(foe.pos);
      const d = gap(self, foe);
      if (ready(2) && bold && d > W.radius - 0.8 && d < E.range + W.radius - 1 && ready(1) && mana > costs(1, 2)) {
        return cast(2, toward(self.pos, foe.pos, Math.min(E.range, dist(self.pos, foe.pos) - 1)));
      }
      if (ready(0) && near(Q.range - 0.5) && hp > 0.4 && hp > foeHp - 0.15 && safe) {
        const p = aim(foe, Q.speed);
        if (!minionInTheWay(world, self, p, Q.width)) return cast(0, p);
      }
      if (ready(1) && near(W.radius - 0.3)) return cast(1, self.pos);
      // Committed (Drift's guard is up, or they're slowed by the swath): keep swinging.
      if (bold && d <= world.attackRange(self, foe) + 1.5 && (world.status(self, 'guard') || world.status(foe, 'slow'))) {
        return { type: 'attack', target: foe.id };
      }
      // Gleaned: her reach is longer against them, so keep swinging while it lasts.
      if (world.status(foe, 'gleaned', self.id) && winning && safe && gap(self, foe) <= world.attackRange(self, foe) + 1) {
        return { type: 'attack', target: foe.id };
      }
      // In her face and hitting her: swing back if the trade is even, otherwise slow them and drift off.
      if (foe.attackTarget === self.id && gap(self, foe) <= world.attackRange(self, foe) + 0.5) {
        // Drift's damage reduction makes the trade: glide in beside them and keep swinging.
        if (ready(2) && safe && (hp > foeHp - 0.15 || hp > 0.5)) return cast(2, foe.pos);
        if (hp > foeHp - 0.15 || hp > 0.5) return { type: 'attack', target: foe.id };
        if (ready(1)) return cast(1, self.pos);
        if (ready(2)) return cast(2, spawnPoint(self.team));
      }
      // Poked from out of reach: hook them out of their wave (that's what the hook is for), walk at them
      // if they're alone, and only back off when she can do neither.
      if (foe.attackTarget === self.id && gap(self, foe) > self.range + 0.5) {
        if (ready(0) && near(Q.range - 0.5) && hp > 0.3 && !unsafe(foe.pos)) {
          const p = aim(foe, Q.speed);
          if (!minionInTheWay(world, self, p, Q.width)) return cast(0, p);
        }
        if (safe && hp > 0.5) return { type: 'attack', target: foe.id };
        const back = self.team === 'blue' ? -1 : 1;
        const out = { x: foe.pos.x + back * (foe.range + foe.radius + self.radius + 2), y: self.pos.y };
        if (!unsafe(out)) return { type: 'move', to: out };
      }
    }
    // Farm with Wide Swath: when it would finish a minion, or catches two.
    const enemyMinions = world.units.filter((u) => !u.dead && u.kind === 'minion' && u.team !== self.team && !unsafe(u.pos));
    if (ready(1) && mana > self.champ!.maxMana * 0.2) {
      const swath = ctx.dmg(1) * W.minion;
      const close = enemyMinions.filter((u) => dist(u.pos, self.pos) < W.radius + u.radius);
      if (close.length >= 2 || close.some((m) => m.hp < swath)) return cast(1, self.pos);
    }
    // Drift into their casters at the back of the wave and swath them, unless that's walking into the champion.
    if (ready(2) && ready(1) && mana > costs(1, 2) + self.champ!.maxMana * 0.15) {
      const casters = enemyMinions.filter((u) => u.role === 'caster' && dist(u.pos, self.pos) < E.range + W.radius - 0.5);
      for (const c of casters) {
        const caught = enemyMinions.filter((u) => dist(u.pos, c.pos) < W.radius - 0.3).length;
        const exposed = foe && !foe.dead && dist(foe.pos, c.pos) < foe.range + foe.radius + 2 && self.hp < self.maxHp * 0.6;
        if (caught >= 2 && !exposed && dist(c.pos, self.pos) > W.radius - 0.5) {
          return cast(2, toward(self.pos, c.pos, Math.min(E.range, dist(self.pos, c.pos) - 0.5)));
        }
      }
    }
    return null;
  }

  private sableEscape({ self, near, ready }: Ctx): Command | null {
    if (ready(2) && near(4)) return cast(2, spawnPoint(self.team)); // Drift away
    if (ready(1) && near(2.5)) return cast(1, self.pos); // slow the chaser
    return null;
  }

  // ---------- Pip & Thistle ----------

  /**
   * Riding: engage with Big Leap, Hop and Gulp when the trade is good, and Gulp minions to feed a
   * hurt Thistle. When Thistle runs low mid-fight, hop off backwards and poke from behind him. On foot:
   * puff Thistle up between Pip and the enemy, poke with pebbles, keep away from melee, and saddle back
   * up once Thistle has his health back. While Thistle panics, Pip plays it safe.
   */
  private pip(ctx: Ctx): Command | null {
    const { world, self, foe, near, unsafe, ready, aim, aimAfter } = ctx;
    const { GULP, HOP, PEBBLES, PUFF, LEAP } = PIP_TUNING;
    const toad = thistleOf(world, self);
    const toadHp = toad && !panicking(world, toad) ? toad.hp / toad.maxHp : 0;
    const back = self.team === 'blue' ? -1 : 1;
    const hp = self.hp / self.maxHp;

    if (riding(self)) {
      if (foe) {
        const foeHp = foe.hp / foe.maxHp;
        const d = gap(self, foe);
        // Thistle is the health bar that matters while riding: count both.
        const ours = (self.hp + (toad?.hp ?? 0)) / (self.maxHp + (toad?.maxHp ?? 0));
        const winning = foeHp < 0.5 || ours > foeHp - 0.05;
        const wave = world.units.filter((u) => !u.dead && u.kind === 'minion' && u.team === foe.team && dist(u.pos, foe.pos) < 5).length;
        const safe = !unsafe(foe.pos) && (wave < 3 || foeHp < 0.3);
        // Thistle's wearing thin and they're not about to drop: step out of their reach so he can recover.
        if (toadHp < 0.33 && foeHp > 0.35 && near(foe.range + 3)) {
          const out = { x: foe.pos.x + back * (foe.range + foe.radius + self.radius + 2.5), y: self.pos.y };
          if (!unsafe(out)) return { type: 'move', to: out };
        }
        if (ready(3) && near(LEAP.range - 0.5) && winning && safe) return cast(3, aimAfter(foe, LEAP.castTime + LEAP.flight));
        if (ready(0) && near(GULP.range - 0.5) && winning && !unsafe(foe.pos)) {
          const p = aim(foe, GULP.speed);
          if (!minionInTheWay(world, self, p, GULP.width)) return cast(0, p);
        }
        if (ready(1) && d > 1.5 && d < HOP.range && winning && safe) return cast(1, aimAfter(foe, d / HOP.speed));
        if (near(2.5) && winning && safe) return { type: 'attack', target: foe.id };
        // Poked from out of reach and not winning: back off out of their range.
        if (foe.attackTarget === self.id && d > self.range + 0.5 && !winning) {
          const out = { x: foe.pos.x + back * (foe.range + foe.radius + self.radius + 2), y: self.pos.y };
          if (!unsafe(out)) return { type: 'move', to: out };
        }
      }
      // Feed a hurt Thistle: Gulp a minion it would finish.
      if (ready(0) && toadHp < 0.85 && self.champ!.mana > self.champ!.maxMana * 0.3) {
        const gulp = ctx.dmg(0) * GULP.minion;
        const snack = world.units.find(
          (u) => !u.dead && u.kind === 'minion' && u.team !== self.team && u.hp < gulp && dist(u.pos, self.pos) < GULP.range - 0.3 &&
            !unsafe(u.pos) && !minionInTheWay(world, self, u.pos, GULP.width, u),
        );
        if (snack) return cast(0, snack.pos);
      }
      return null;
    }

    // ---- on foot ----
    // Riding is the stronger form: climb back on as soon as Thistle has calmed down.
    if (toad && toadHp >= PIP_TUNING.THISTLE.comeBack - 0.05 && ready(2)) return cast(2, toad.pos);
    if (!foe) return null;
    const foeHp = foe.hp / foe.maxHp;
    const d = gap(self, foe);
    const melee = foe.range < 3;
    // Thistle is panicking: Pip alone is fragile. Stay out of reach and poke only from safety.
    if (!toadHp) {
      const reach = foe.range + foe.radius + self.radius + 2.5;
      if (d < reach) {
        const out = { x: self.pos.x + back * 3, y: self.pos.y };
        if (!unsafe(out)) return { type: 'move', to: out };
      }
      if (ready(0) && d < PEBBLES.range - 0.5 && d > reach - 1) return cast(0, aim(foe, PEBBLES.speed));
      return null;
    }
    // Thistle between us: puff him up in their path.
    if (ready(1) && near(PUFF.range + 3)) return cast(1, toward(self.pos, foe.pos, Math.min(PUFF.range, dist(self.pos, foe.pos) * 0.6)));
    if (ready(3) && toad && dist(toad.pos, foe.pos) < LEAP.range && (foeHp < 0.6 || hp > foeHp) && !unsafe(foe.pos)) {
      return cast(3, aimAfter(foe, LEAP.castTime + LEAP.flight));
    }
    if (ready(0) && d < PEBBLES.range - 0.3) return cast(0, aim(foe, PEBBLES.speed));
    // Keep melee champions at slingshot range, behind Thistle.
    if (melee && d < 2.5) {
      const out = { x: self.pos.x + back * 3, y: self.pos.y };
      if (!unsafe(out)) return { type: 'move', to: out };
    }
    if (d < self.range && hp > 0.4 && !unsafe(foe.pos)) return { type: 'attack', target: foe.id };
    return null;
  }

  private pipEscape({ self, foe, near, ready }: Ctx): Command | null {
    const { HOP, PUFF } = PIP_TUNING;
    if (!foe) return null;
    if (riding(self) && ready(1) && near(5)) return cast(1, toward(self.pos, spawnPoint(self.team), HOP.range)); // hop away
    // Puff Thistle up in their path while Pip runs.
    if (!riding(self) && ready(1) && near(PUFF.range + 2)) return cast(1, toward(self.pos, foe.pos, Math.min(PUFF.range, dist(self.pos, foe.pos) * 0.6)));
    return null;
  }

  // ---------- Gerrit ----------

  /**
   * Engage with the standard: plant it just past the enemy, then thrust through them into it (a knock-up
   * and he lands on his own ground). R leaps in and drops banners behind them, then the refreshed thrust
   * carries him through them to cut off the retreat. Bulwark when trading, slammed down point-blank.
   */
  private gerrit(ctx: Ctx): Command | null {
    const { world, self, foe, near, unsafe, ready, recasting } = ctx;
    const { Q, E, R } = GERRIT_TUNING;
    const thrustAt = (p: Vec2) => toward(self.pos, p, Q.length);
    if (foe) {
      const hp = self.hp / self.maxHp;
      const foeHp = foe.hp / foe.maxHp;
      const d = gap(self, foe);
      const winning = foeHp < 0.55 || hp > foeHp - 0.05;
      const wave = world.units.filter((u) => !u.dead && u.kind === 'minion' && u.team === foe.team && dist(u.pos, foe.pos) < 4).length;
      const safe = !unsafe(foe.pos) && (wave < 4 || foeHp < 0.35);
      // Slam the shield down on someone standing right on him.
      if (recasting(1) && d <= GERRIT_TUNING.W.rootReach) return cast(1, self.pos);
      // A standard just past them: thrust through them into it.
      const flag = standardOnLine(world, self, self.pos, thrustAt(foe.pos));
      if (ready(0) && flag && dist(self.pos, flag.pos) > dist(self.pos, foe.pos) && (winning || foeHp < 0.4) && !unsafe(flag.pos)) {
        return cast(0, flag.pos);
      }
      if (ready(3) && d < R.range - 0.3 && winning && safe) return cast(3, foe.pos);
      // A fight's starting and he's not on his own ground: plant the standard at his feet (a little toward
      // them, so it lands on them if they're close) and fight there.
      const grounded = nearStandard(world, self);
      const fighting = d < 4 || foe.attackTarget === self.id;
      if (!grounded && fighting && ready(2)) return cast(2, toward(self.pos, foe.pos, Math.min(1.2, dist(self.pos, foe.pos))));
      // Plant the standard behind them for the thrust (the next decision throws Q once it lands).
      const past = dist(self.pos, foe.pos) + 1.5;
      if (ready(2) && ready(0) && !fighting && past < Math.min(E.range, Q.length) - 0.3 && winning && safe) return cast(2, toward(self.pos, foe.pos, past));
      if (ready(1) && near(3) && foe.attackTarget === self.id) return cast(1, self.pos);
      if (ready(0) && near(Q.length - 0.6) && safe && !standardsOf(world, self).length && self.champ!.mana > self.champ!.maxMana * 0.4) return cast(0, foe.pos);
      if (near(2.5) && winning && safe) return { type: 'attack', target: foe.id };
      // Being hit up close: hit back if the trade is even (their minions only turn on him if he starts it),
      // otherwise step out of their reach.
      if (foe.attackTarget === self.id && d <= foe.range + 1.5) {
        if (hp > foeHp - 0.1 || hp > 0.55 || (grounded && hp > foeHp - 0.25)) return { type: 'attack', target: foe.id };
        const back = self.team === 'blue' ? -1 : 1;
        const out = { x: foe.pos.x + back * (foe.range + foe.radius + self.radius + 2.5), y: self.pos.y };
        if (!unsafe(out)) return { type: 'move', to: out };
      }
      // Hitting a champion in their wave turns the wave on him: farm instead of trading there.
      if (!safe && near(5)) {
        const farm = world.units
          .filter((u) => !u.dead && u.kind === 'minion' && u.team !== self.team && gap(self, u) < 7 && !unsafe(u.pos))
          .sort((a, b) => a.hp - b.hp || gap(self, a) - gap(self, b))[0];
        if (farm) return { type: 'attack', target: farm.id }; // (re-issuing the same target doesn't cancel a swing)
        // Nothing to farm: hold just behind our own wave rather than walking into theirs.
        const towardFoe = self.team === 'blue' ? 1 : -1;
        const ours = world.units.filter((u) => !u.dead && u.kind === 'minion' && u.team === self.team);
        const front = ours.length ? ours.reduce((f, m) => (m.pos.x * towardFoe > f * towardFoe ? m.pos.x : f), ours[0].pos.x) : self.pos.x;
        return { type: 'move', to: { x: front - towardFoe * 2, y: self.pos.y } };
      }
      // Poked from out of reach and not winning: back off out of their range.
      if (foe.attackTarget === self.id && d > self.range + 0.5 && !winning) {
        const back = self.team === 'blue' ? -1 : 1;
        const out = { x: foe.pos.x + back * (foe.range + foe.radius + self.radius + 2), y: self.pos.y };
        if (!unsafe(out)) return { type: 'move', to: out };
      }
    }
    // Farm with the thrust: through two or more minions, or to finish one he can't reach with a swing.
    if (ready(0) && self.champ!.mana > self.champ!.maxMana * 0.35) {
      const minions = world.units.filter((u) => !u.dead && u.kind === 'minion' && u.team !== self.team && dist(u.pos, self.pos) < Q.length - 0.3 && !unsafe(u.pos));
      const killing = (m: Unit) => m.hp < ctx.dmg(0);
      const line = (m: Unit) => minions.filter((o) => segmentDistance(o.pos, self.pos, thrustAt(m.pos)).d < Q.width / 2 + o.radius);
      const best =
        minions.find((m) => line(m).filter(killing).length >= 2 || line(m).length >= 3) ??
        minions.find((m) => killing(m) && gap(self, m) > self.range + 0.3 && self.champ!.mana > self.champ!.maxMana * 0.5);
      if (best) return cast(0, best.pos);
    }
    return null;
  }

  /** Run home: plant the standard toward the tower and thrust away to it. */
  private gerritEscape({ world, self, foe, near, ready }: Ctx): Command | null {
    const { Q, E } = GERRIT_TUNING;
    if (!foe || !near(7)) return null;
    const home = spawnPoint(self.team);
    const flag = standardOnLine(world, self, self.pos, toward(self.pos, home, Q.length));
    if (ready(0) && flag && dist(flag.pos, home) < dist(self.pos, home)) return cast(0, flag.pos);
    if (ready(2) && ready(0)) return cast(2, toward(self.pos, home, Math.min(E.range, Q.length) - 0.5));
    if (ready(1) && near(3)) return cast(1, self.pos);
    return null;
  }

  // ---------- Lumen ----------

  /**
   * Poke with Candleflame (it heals her), lay Sanctuary under the trade, dash through them with Warm
   * Embrace when winning (or away when losing), keep melee champions at arm's length, and cash Devotion
   * in for Sunrise when it decides the fight (otherwise sit on a full meter: Radiant).
   */
  private lumen(ctx: Ctx): Command | null {
    const { world, self, foe, near, unsafe, ready, aim } = ctx;
    const { Q, W, E, R, DEVOTION } = LUMEN_TUNING;
    const mana = self.champ!.mana / self.champ!.maxMana;
    if (foe) {
      const hp = self.hp / self.maxHp;
      const foeHp = foe.hp / foe.maxHp;
      const d = gap(self, foe);
      const winning = foeHp < 0.55 || hp > foeHp;
      const wave = world.units.filter((u) => !u.dead && u.kind === 'minion' && u.team === foe.team && dist(u.pos, foe.pos) < 4).length;
      const safe = !unsafe(foe.pos) && (wave < 4 || foeHp < 0.35);
      const fighting = d < 4 || foe.attackTarget === self.id;
      if (ready(3) && devotion(self) >= DEVOTION.sunrise && near(R.radius - 0.5) && (foeHp < 0.5 || hp < 0.45 || (winning && fighting))) return cast(3, self.pos);
      if (ready(1) && fighting && dist(self.pos, foe.pos) < W.range + 1) {
        const mid = d < W.radius * 1.4 ? { x: (self.pos.x + foe.pos.x) / 2, y: (self.pos.y + foe.pos.y) / 2 } : self.pos;
        return cast(1, mid);
      }
      if (ready(2) && winning && safe && d > 1 && d < E.range - 0.8 && foeHp < 0.6) return cast(2, toward(self.pos, foe.pos, E.range));
      if (ready(0) && near(Q.range - 0.5) && mana > 0.25) {
        const p = aim(foe, Q.speed);
        if (!minionInTheWay(world, self, p, Q.width)) return cast(0, p);
      }
      // Ranged: keep melee champions off her.
      if (foe.range < 3 && d < 2.2) {
        const back = self.team === 'blue' ? -1 : 1;
        const out = { x: self.pos.x + back * 3, y: self.pos.y };
        if (!unsafe(out)) return { type: 'move', to: out };
      }
    }
    // Last-hit with Candleflame: each kill heals her (and feeds Devotion).
    if (ready(0) && mana > 0.3) {
      const kill = world.units.find(
        (u) => !u.dead && u.kind === 'minion' && u.team !== self.team && u.hp < ctx.dmg(0) && dist(u.pos, self.pos) < Q.range - 0.5 &&
          gap(self, u) > self.range * 0.6 && !unsafe(u.pos) && !minionInTheWay(world, self, u.pos, Q.width, u),
      );
      if (kill) return cast(0, kill.pos);
    }
    return null;
  }

  private lumenEscape({ self, foe, near, ready }: Ctx): Command | null {
    if (!foe) return null;
    if (ready(2) && near(5)) return cast(2, toward(self.pos, spawnPoint(self.team), LUMEN_TUNING.E.range));
    if (ready(1) && near(3)) return cast(1, self.pos);
    return null;
  }

  // ---------- Fennick ----------

  /**
   * Draw Longshot from long range and loose it at full draw (or early when someone closes in), net
   * whoever dives him, Volley into trades, Overcharge to finish a fight, and kite melee champions
   * between attacks.
   */
  private fennick(ctx: Ctx): Command | null {
    const { world, self, foe, near, unsafe, ready, aim } = ctx;
    const { Q, E } = FENNICK_TUNING;
    const mana = self.champ!.mana / self.champ!.maxMana;
    if (drawing(self)) return this.fennickLoose(ctx);
    if (!foe) return null;
    const hp = self.hp / self.maxHp;
    const foeHp = foe.hp / foe.maxHp;
    const d = gap(self, foe);
    const towardFoe = self.team === 'blue' ? 1 : -1;
    const diving = d < 3.5 && (foe.attackTarget === self.id || foe.range < 3);
    const trading = d <= self.range + 0.3 && !unsafe(foe.pos);
    // Net a diver, or a target worth an all-in.
    if (ready(2) && near(E.range - 0.8) && (diving || (foeHp < 0.45 && hp > 0.4 && !unsafe(foe.pos)))) {
      const p = aim(foe, E.speed);
      if (!minionInTheWay(world, self, p, E.width)) return cast(2, p);
    }
    if (ready(3) && near(self.range + 1.5) && ((foeHp < 0.5 && hp > 0.3) || (hp > 0.5 && foe.attackTarget === self.id))) return cast(3, self.pos);
    if (ready(1) && trading && (foeHp < 0.7 || overcharged(world, self) || diving)) return cast(1, self.pos);
    if (trading && (foeHp < 0.55 || overcharged(world, self) || volleyReady(world, self))) return { type: 'attack', target: foe.id };
    // Kite melee champions: shoot when the bow is ready, step back along the lane in between.
    if (foe.range < 3 && d < foe.range + 3) {
      if (self.windup > 0) return { type: 'attack', target: foe.id };
      if (self.attackCd === 0 && d <= self.range) return { type: 'attack', target: foe.id };
      const away = { x: self.pos.x - towardFoe * 3, y: self.pos.y + Math.sign(self.pos.y - foe.pos.y || 1) };
      if (!unsafe(away)) return { type: 'move', to: away };
    }
    // Poke: start drawing at a safe distance (it can't be cancelled, and he can't attack meanwhile).
    if (ready(0) && mana > 0.3 && d > 4 && d < Q.maxRange - 1 && !diving) return cast(0, foe.pos);
    return null;
  }

  /** Mid-draw: loose at full draw, or early if the target is closing in or about to slip out of reach. */
  private fennickLoose({ world, self, foe, aim }: Ctx): Command | null {
    const { Q } = FENNICK_TUNING;
    const k = drawFraction(self);
    const held = (world.tick - ((self.champ!.data as { drawStart?: number }).drawStart ?? world.tick)) / TICK_HZ;
    if (!foe) return held > 1.5 ? { type: 'release', slot: 0, at: self.pos } : null;
    const p = aim(foe, Q.speed);
    const reach = longshotRange(k);
    const d = dist(self.pos, p);
    const pressed = gap(self, foe) < 3;
    if ((k >= 1 && d < reach) || (pressed && k > 0.3) || held > Q.timeout - 0.4) return { type: 'release', slot: 0, at: p };
    // Walk back while drawing if they're closing in.
    if (gap(self, foe) < 5) return { type: 'move', to: toward(self.pos, spawnPoint(self.team), 2) };
    return null;
  }

  private fennickEscape(ctx: Ctx): Command | null {
    const { world, self, foe, near, ready, aim } = ctx;
    if (drawing(self)) {
      const out = this.fennickLoose(ctx);
      if (out?.type === 'release') return out;
    }
    if (!foe) return null;
    const { E } = FENNICK_TUNING;
    if (ready(2) && near(5)) {
      const p = aim(foe, E.speed);
      if (!minionInTheWay(world, self, p, E.width)) return cast(2, p);
    }
    if (ready(3) && near(4)) return cast(3, self.pos);
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
