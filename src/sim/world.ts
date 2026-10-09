import { Rng } from '../core/rng';
import { combineMods, perksOf } from './augments';
import { KITS, kitOf } from './kits';
import { hiveMinionMult } from './kits/mabel';
import type { CastCtx } from './kits/types';
import { LANE, clampToLane, sideX, spawnPoint } from './lane';
import { SANDBOX_RULES, type DuelRules, type WinReason } from './rules';
import { DEFAULT_SUMMONERS, RAGE, SUMMONERS } from './summoners';
import {
  CALL_FOR_HELP, CHAMPION_BOUNTY, CHAMPION_REGEN, FOUNTAIN, MAX_LEVEL, MINION_AGGRO, MINION_XP, MINIONS, RESPAWN_SECONDS,
  STRUCTURES, WAVE, XP_BASE, XP_RANGE, XP_STEP, champKillXp, type BaseStats,
} from './stats';
import type {
  AugmentId, ChampState, Command, DamageSource, Controller, Fx, KitId, MinionRole, Missile, MissileStyle, Slot, Status, SummonerId, SummonerSlot,
  Team, Telegraph, Unit, UnitKind, Vec2, Zone,
} from './types';
import { DT, TICK_HZ, angleTo, dist, dirTo, enemyOf, gap, inCone, segmentDistance, ticks, toward } from './util';

export { DT, TICK_HZ, enemyOf, gap };
export type { DamageSource };

/** How much a Stopwatch field slows enemies inside it. */
export const STASIS_SLOW = 0.35;

export const xpToNext = (level: number) => XP_BASE + XP_STEP * (level - 1);

export class World {
  tick = 0;
  readonly units: Unit[] = [];
  readonly missiles: Missile[] = [];
  readonly zones: Zone[] = [];
  readonly telegraphs: Telegraph[] = [];
  /** Recent one-shot visual events (kept ~3 s). */
  readonly fx: Fx[] = [];
  readonly rng: Rng;
  winner: Team | null = null;
  winReason: WinReason | null = null;
  private nextId = 1;
  private controllers = new Map<number, Controller>();
  private spawnQueue: { tick: number; team: Team; role: MinionRole; laneY: number }[] = [];
  private nextWaveTick = ticks(WAVE.first);
  private scheduled: { tick: number; fn: () => void }[] = [];

  constructor(seed = 1, readonly rules: DuelRules = SANDBOX_RULES) {
    this.rng = new Rng(seed);
    const tower = { ...STRUCTURES.tower, hp: STRUCTURES.tower.hp * rules.towerHpMult };
    for (const team of ['blue', 'red'] as Team[]) {
      this.spawn('nexus', team, { x: sideX(team, LANE.nexusX), y: 0 }, STRUCTURES.nexus);
      for (const x of LANE.towerXs) this.spawn('tower', team, { x: sideX(team, x), y: 0 }, tower);
    }
  }

  private spawn(kind: UnitKind, team: Team, pos: Vec2, s: BaseStats, role?: MinionRole): Unit {
    const u: Unit = {
      id: this.nextId++, kind, team, role, pos: { ...pos }, radius: s.radius, hp: s.hp, maxHp: s.hp,
      speed: s.speed, moveTarget: null, facing: team === 'blue' ? 0 : Math.PI,
      damage: s.damage, range: s.range, attackInterval: s.attackInterval, windupTicks: ticks(s.windup),
      projectileSpeed: s.projectileSpeed, attackTarget: null, attackCd: 0, windup: 0,
      lastAttackTick: -999, lastHurtTick: -999, dead: false, respawnTick: 0, gold: 0, laneY: 0, statuses: [], forced: null,
    };
    this.units.push(u);
    return u;
  }

  /**
   * `augments`, `items` and `statMult` (opponent scaling) apply for the whole duel. Champions start
   * at `rules.startLevel` (+ `extraLevels`) with their first points spent Q, E, W, and carry two
   * summoner spells (Flash and Ignite unless told otherwise).
   */
  spawnChampion(
    team: Team, kit: KitId, controller: Controller,
    opts: { augments?: AugmentId[]; items?: AugmentId[]; statMult?: number; extraLevels?: number; summoners?: SummonerId[] } = {},
  ): Unit {
    const k = KITS[kit].stats;
    const augments = opts.augments ?? [];
    const items = opts.items ?? [];
    const statMult = opts.statMult ?? 1;
    const mods = combineMods([...augments, ...items], { haste: this.rules.haste });
    const hp = (k.hp * statMult + mods.hpFlat) * (1 + mods.hpPct);
    const u = this.spawn('champion', team, spawnPoint(team), {
      radius: k.radius, hp, speed: k.speed * (1 + mods.speedPct), damage: k.damage * statMult + mods.ad, range: k.range,
      attackInterval: k.attackInterval, windup: k.windup, projectileSpeed: k.projectileSpeed, bounty: CHAMPION_BOUNTY,
    });
    const ability = () => ({ rank: 0, readyAt: 0, recastUntil: 0 });
    const manaFlat = KITS[kit].resource === 'bees' ? 0 : mods.manaFlat; // mana items don't grow bees
    const champ: ChampState = {
      kit, level: 1, xp: 0, skillPoints: 1, mana: k.mana + manaFlat, maxMana: k.mana + manaFlat,
      abilities: [ability(), ability(), ability(), ability()], casting: null, lastCast: null, queued: null, dash: null, data: {},
      augments: [...augments], items: [...items], augData: {}, mods, statMult, kills: 0, deaths: 0, cs: 0,
      summoners: (opts.summoners ?? DEFAULT_SUMMONERS).slice(0, 2).map((id) => ({ id, readyAt: 0, recastUntil: 0 })),
    };
    u.champ = champ;
    const start = this.rules.startLevel + (opts.extraLevels ?? 0);
    while (champ.level < Math.min(MAX_LEVEL, start)) this.levelUp(u);
    for (const slot of ([0, 2, 1] as Slot[]).slice(0, champ.level)) this.levelAbility(u, slot);
    this.controllers.set(u.id, controller);
    return u;
  }

  get(id: number | null | undefined) {
    return id == null ? undefined : this.units.find((u) => u.id === id);
  }

  champions() {
    return this.units.filter((u) => u.kind === 'champion');
  }

  /** Towers are protected by the tower in front of them, the nexus by every tower. */
  isTargetable(u: Unit) {
    if (u.dead) return false;
    const own = this.units.filter((o) => o.team === u.team && o.kind === 'tower' && !o.dead);
    if (u.kind === 'nexus') return own.length === 0;
    if (u.kind === 'tower') return !own.some((o) => Math.abs(o.pos.x) < Math.abs(u.pos.x));
    return true;
  }

  canAttack(a: Unit, b: Unit | undefined): b is Unit {
    return !!b && !a.dead && b.team !== a.team && this.isTargetable(b);
  }

  /** Busy with an ability wind-up or a dash: can't walk or auto-attack. */
  isBusy(u: Unit) {
    return !!(u.champ?.casting || u.champ?.dash || u.forced || this.isStunned(u));
  }

  isStunned(u: Unit) {
    return u.statuses.some((s) => s.kind === 'stun');
  }

  /** Can't walk, dash or blink (rooted or stunned). */
  isRooted(u: Unit) {
    return u.statuses.some((s) => s.kind === 'root' || s.kind === 'stun');
  }

  step() {
    if (this.winner) return;
    this.spawnWaves();
    for (const u of this.units) {
      if (u.dead) continue;
      const c = this.controllers.get(u.id);
      if (c) for (const cmd of c.think(this, u)) this.apply(u, cmd);
    }
    for (const u of this.units) {
      if (u.dead) continue;
      if (u.kind === 'minion') this.minionBrain(u);
      else if (u.kind === 'tower') this.towerBrain(u);
      else if (u.kind === 'champion' && !u.moveTarget && u.attackTarget == null && !this.isBusy(u)) this.autoAcquire(u);
    }
    for (const u of this.champions()) if (!u.dead) this.updateCast(u);
    for (const u of this.units) if (!u.dead && u.forced) this.updateForced(u);
    for (const u of this.units) if (!u.dead) this.combat(u);
    for (const u of this.units) if (!u.dead && u.speed > 0) this.move(u);
    this.separate();
    this.updateMissiles();
    this.updateZones();
    this.runScheduled();
    for (const u of this.champions()) {
      if (u.dead) continue;
      kitOf(u).onTick?.(this, u);
      for (const a of perksOf(u)) a.onTick?.(this, u);
    }
    this.regen();
    this.expire();
    this.reap();
    this.tick++;
  }

  // ---------- commands ----------

  private apply(u: Unit, cmd: Command) {
    switch (cmd.type) {
      case 'move':
        u.moveTarget = clampToLane(cmd.to, u.radius);
        u.attackTarget = null;
        u.windup = 0; // moving cancels a wound-up attack
        break;
      case 'attack':
        if (u.attackTarget === cmd.target || !this.canAttack(u, this.get(cmd.target))) break;
        u.attackTarget = cmd.target;
        u.windup = 0;
        break;
      case 'stop':
        u.moveTarget = null;
        u.attackTarget = null;
        u.windup = 0;
        break;
      case 'cast':
        this.startCast(u, cmd.slot, cmd.at);
        break;
      case 'levelUp':
        this.levelAbility(u, cmd.slot);
        break;
      case 'summon':
        this.castSummoner(u, cmd.slot, cmd.at);
        break;
    }
  }

  // ---------- abilities ----------

  /** Why a cast would fail right now, or null if it would go through. */
  castBlocker(u: Unit, slot: Slot): 'rank' | 'cooldown' | 'mana' | 'busy' | 'rooted' | null {
    const c = u.champ;
    if (!c || u.dead) return 'busy';
    if (this.isBusy(u)) return 'busy';
    const st = c.abilities[slot];
    const def = kitOf(u).abilities[slot];
    if (def.aim.shape === 'dash' && this.isRooted(u)) return 'rooted';
    if (st.rank === 0) return 'rank';
    if (def.recast && this.tick < st.recastUntil) return null;
    if (this.tick < st.readyAt) return 'cooldown';
    if (c.mana < def.cost(st.rank)) return 'mana';
    return null;
  }

  private startCast(u: Unit, slot: Slot, at: Vec2) {
    const blocker = this.castBlocker(u, slot);
    if (blocker === 'busy' && (u.champ?.casting || u.champ?.dash)) {
      u.champ.queued = { slot, at: { ...at }, until: this.tick + ticks(0.4) }; // buffer combos like E→W
      return;
    }
    if (blocker) return;
    const c = u.champ!;
    const st = c.abilities[slot];
    const targeted = kitOf(u).abilities[slot].target;
    if (targeted && !(this.tick < st.recastUntil) && !targeted(this, u, at)) return; // nothing to click on
    const def = kitOf(u).abilities[slot];
    const recast = !!def.recast && this.tick < st.recastUntil;
    if (recast) {
      st.recastUntil = 0;
    } else {
      c.mana -= def.cost(st.rank);
      st.readyAt = this.tick + ticks((def.cooldown(st.rank) * 100) / (100 + c.mods.haste));
      if (def.recastWindow) st.recastUntil = this.tick + ticks(def.recastWindow);
    }
    u.windup = 0;
    u.facing = angleTo(u.pos, at);
    const ctx: CastCtx = { world: this, self: u, at: { ...at }, rank: st.rank, recast };
    def.onWindup?.(ctx);
    const time = recast ? def.recastTime ?? def.castTime : def.castTime;
    c.lastCast = { slot, tick: this.tick, time };
    if (time > 0) c.casting = { slot, at: { ...at }, fireAt: this.tick + ticks(time), recast };
    else this.resolveCast(ctx, slot);
    for (const a of perksOf(u)) a.onCast?.(this, u, slot, ctx.at, recast);
  }

  /** Run an ability's effect again with no cost, wind-up or cooldown (Double Tap). */
  replayCast(u: Unit, slot: Slot, at: Vec2) {
    if (u.dead || !u.champ) return;
    this.resolveCast({ world: this, self: u, at: { ...at }, rank: u.champ.abilities[slot].rank, recast: false }, slot);
  }

  private resolveCast(ctx: CastCtx, slot: Slot) {
    const def = kitOf(ctx.self).abilities[slot];
    if (ctx.recast) def.recast!(ctx);
    else def.cast(ctx);
  }

  private updateCast(u: Unit) {
    const c = u.champ!;
    if (c.casting && this.isStunned(u)) c.casting = null; // stuns interrupt wind-ups
    if (c.casting && this.tick >= c.casting.fireAt) {
      const { slot, at, recast } = c.casting;
      c.casting = null;
      this.resolveCast({ world: this, self: u, at, rank: c.abilities[slot].rank, recast }, slot);
    }
    if (c.dash) {
      const d = c.dash;
      const next = toward(u.pos, d.to, d.speed * DT);
      u.facing = angleTo(u.pos, d.to);
      u.pos = clampToLane(next, u.radius);
      for (const e of this.units) {
        if (!this.canAttack(u, e) || e.kind === 'tower' || e.kind === 'nexus' || d.passed.includes(e.id)) continue;
        if (dist(e.pos, u.pos) <= e.radius + u.radius + 0.3) {
          d.passed.push(e.id);
          d.onPass?.(e);
        }
      }
      this.resolveStructures(u);
      if (dist(u.pos, d.to) < 0.05 || dist(next, d.to) < 1e-6 || u.pos.x !== next.x || u.pos.y !== next.y) {
        c.dash = null;
        d.onArrive?.();
      }
    }
    if (c.queued && !c.casting && !c.dash) {
      const q = c.queued;
      c.queued = null;
      if (this.tick <= q.until) this.startCast(u, q.slot, q.at);
    }
  }

  /** Basic abilities: rank <= ceil(level / 2), max 5. Ultimate: ranks at levels 6 and 11. */
  canLevel(u: Unit, slot: Slot) {
    const c = u.champ;
    if (!c || c.skillPoints <= 0) return false;
    const rank = c.abilities[slot].rank;
    if (rank >= kitOf(u).abilities[slot].maxRank) return false;
    if (slot === 3) return rank < (c.level >= 11 ? 2 : c.level >= 6 ? 1 : 0);
    return rank < Math.ceil(c.level / 2);
  }

  private levelAbility(u: Unit, slot: Slot) {
    if (!this.canLevel(u, slot)) return;
    u.champ!.skillPoints--;
    u.champ!.abilities[slot].rank++;
  }

  grantXp(u: Unit, amount: number) {
    const c = u.champ;
    if (!c || c.level >= MAX_LEVEL) return;
    c.xp += amount;
    while (c.level < MAX_LEVEL && c.xp >= xpToNext(c.level)) {
      c.xp -= xpToNext(c.level);
      this.levelUp(u);
      this.addFx({ kind: 'levelUp', pos: u.pos, team: u.team });
    }
    if (c.level >= MAX_LEVEL) c.xp = 0;
  }

  private levelUp(u: Unit) {
    const c = u.champ!;
    const k = kitOf(u).stats;
    c.level++;
    c.skillPoints++;
    const hp = k.hpPerLevel * c.statMult * (1 + c.mods.hpPct);
    u.maxHp += hp;
    u.hp += hp;
    c.maxMana += k.manaPerLevel;
    c.mana += k.manaPerLevel;
    u.damage += k.damagePerLevel * c.statMult;
  }

  // ---------- helpers for kits ----------

  /** Run `fn` after a delay (seconds). */
  after(seconds: number, fn: () => void) {
    this.scheduled.push({ tick: this.tick + ticks(seconds), fn });
  }

  addFx(fx: Omit<Fx, 'tick'>) {
    this.fx.push({ ...fx, pos: { ...fx.pos }, tick: this.tick });
  }

  telegraph(t: Omit<Telegraph, 'id' | 'start' | 'end'>, seconds: number) {
    this.telegraphs.push({ ...t, pos: { ...t.pos }, id: this.nextId++, start: this.tick, end: this.tick + ticks(seconds) });
  }

  addZone(kind: Zone['kind'], owner: Unit, pos: Vec2, radius: number, seconds: number): Zone {
    const z: Zone = { id: this.nextId++, kind, team: owner.team, ownerId: owner.id, pos: { ...pos }, radius, start: this.tick, until: this.tick + ticks(seconds) };
    this.zones.push(z);
    return z;
  }

  removeZone(id: number) {
    const i = this.zones.findIndex((z) => z.id === id);
    if (i >= 0) this.zones[i].until = this.tick; // expire through updateZones so frozen missiles drop too
  }

  addStatus(u: Unit, s: Omit<Status, 'until'> & { seconds: number }) {
    const until = this.tick + ticks(s.seconds);
    if (s.kind === 'momentum' || s.kind === 'mark' || s.kind === 'soak' || s.kind === 'bearing') {
      const cur = u.statuses.find((o) => o.kind === s.kind && o.sourceId === s.sourceId);
      if (cur) {
        cur.until = until;
        cur.value = s.kind === 'momentum' ? Math.min(5, cur.value + s.value) : s.kind === 'soak' || s.kind === 'bearing' ? cur.value + s.value : s.value;
        return;
      }
    }
    u.statuses.push({ kind: s.kind, value: s.value, sourceId: s.sourceId, until });
  }

  status(u: Unit, kind: Status['kind'], sourceId?: number) {
    return u.statuses.find((s) => s.kind === kind && s.until > this.tick && (sourceId == null || s.sourceId === sourceId));
  }

  removeStatus(u: Unit, st: Status) {
    u.statuses = u.statuses.filter((s) => s !== st);
  }

  effectiveSpeed(u: Unit) {
    const slow = u.statuses.reduce((m, s) => (s.kind === 'slow' ? Math.max(m, s.value) : m), 0);
    const haste = u.statuses.reduce((m, s) => (s.kind === 'haste' ? Math.max(m, s.value) : m), 0);
    return u.speed * (1 - slow) * (1 + haste);
  }

  /**
   * Restore health, cut by Ignite's grievous wounds. Every heal (regen, lifesteal, kit and augment
   * heals) goes through here. Returns how much was actually restored.
   */
  heal(u: Unit, amount: number) {
    if (u.dead || amount <= 0) return 0;
    const cut = u.statuses.reduce((m, s) => (s.kind === 'grievous' ? Math.max(m, s.value) : m), 0);
    const before = u.hp;
    u.hp = Math.min(u.maxHp, u.hp + amount * (1 - cut));
    return u.hp - before;
  }

  // ---------- summoner spells ----------

  /** Why a summoner spell can't be cast right now, or null if it can. */
  summonerBlocker(u: Unit, slot: SummonerSlot): 'cooldown' | 'busy' | null {
    const c = u.champ;
    const st = c?.summoners[slot];
    if (!c || !st || u.dead || this.isStunned(u) || u.forced || c.dash) return 'busy';
    if (this.tick < st.recastUntil) return null;
    return this.tick < st.readyAt ? 'cooldown' : null;
  }

  /** Summoner spells are instant: they don't interrupt a wind-up, and Flash works while rooted. */
  castSummoner(u: Unit, slot: SummonerSlot, at: Vec2) {
    if (this.summonerBlocker(u, slot)) return;
    const st = u.champ!.summoners[slot];
    const def = SUMMONERS[st.id];
    if (this.tick < st.recastUntil && def.recast) {
      st.recastUntil = 0;
      def.recast(this, u, at, st);
      return;
    }
    if (def.cast(this, u, at, st)) st.readyAt = Math.max(st.readyAt, this.tick + ticks(def.cooldown));
  }

  /** Ticks between attacks, after level, momentum, Rage and frenzy attack speed. */
  attackTicks(u: Unit) {
    let bonus = 0;
    if (u.champ) {
      bonus += kitOf(u).stats.attackSpeedPerLevel * (u.champ.level - 1);
      bonus += 0.1 * (this.status(u, 'momentum')?.value ?? 0);
      bonus += u.champ.mods.attackSpeed;
      if (this.status(u, 'rage')) bonus += RAGE.attackSpeed;
      bonus += u.statuses.reduce((m, s) => (s.kind === 'frenzy' && s.until > this.tick ? Math.max(m, s.value) : m), 0);
    }
    return ticks(u.attackInterval / (1 + bonus));
  }

  /** Enemies of `team` (minions and champions) overlapping a circle. */
  enemiesInCircle(team: Team, c: Vec2, r: number) {
    return this.units.filter((u) => !u.dead && u.team !== team && (u.kind === 'minion' || u.kind === 'champion') && dist(u.pos, c) <= r + u.radius);
  }

  enemiesInCone(team: Team, origin: Vec2, dir: number, radius: number, angle: number) {
    return this.units.filter((u) => !u.dead && u.team !== team && (u.kind === 'minion' || u.kind === 'champion') && inCone(origin, dir, radius, angle, u.pos, u.radius));
  }

  /** Teleport up to `max` toward `to`, staying out of walls and structures. */
  blink(u: Unit, to: Vec2, max: number) {
    const from = { ...u.pos };
    u.pos = clampToLane(toward(u.pos, to, max), u.radius);
    this.resolveStructures(u);
    u.facing = angleTo(from, u.pos);
    u.moveTarget = null;
    u.windup = 0;
    this.addFx({ kind: 'blink', pos: from, team: u.team });
    this.addFx({ kind: 'blink', pos: u.pos, team: u.team });
  }

  /** Drag `u` to `to` (pulls, knockbacks). It can't act until it arrives; wind-ups and dashes are cancelled. */
  pull(u: Unit, to: Vec2, speed: number) {
    if (u.speed <= 0 || u.dead) return;
    u.forced = { to: clampToLane(to, u.radius), speed };
    u.windup = 0;
    if (u.champ) {
      u.champ.casting = null;
      u.champ.dash = null;
    }
  }

  /** Shift `u` up to `max` toward `to` this tick (slow drags like a whirlpool). */
  nudge(u: Unit, to: Vec2, max: number) {
    if (u.speed <= 0 || u.dead) return;
    u.pos = clampToLane(toward(u.pos, to, max), u.radius);
    this.resolveStructures(u);
  }

  private updateForced(u: Unit) {
    const f = u.forced!;
    const next = clampToLane(toward(u.pos, f.to, f.speed * DT), u.radius);
    u.pos = next;
    this.resolveStructures(u);
    if (dist(u.pos, f.to) < 0.05 || u.pos.x !== next.x || u.pos.y !== next.y) u.forced = null;
  }

  dash(u: Unit, to: Vec2, speed: number, onPass?: (e: Unit) => void, onArrive?: () => void) {
    u.champ!.dash = { to: clampToLane(to, u.radius), speed, onPass, onArrive, passed: [] };
    u.moveTarget = null;
    u.windup = 0;
  }

  fireLine(src: Unit, o: { style: MissileStyle; dir: Vec2; speed: number; range: number; width: number; pierce?: boolean; canHit?: (u: Unit) => boolean; onHit: (t: Unit) => void; from?: Vec2 }) {
    this.missiles.push({
      id: this.nextId++, team: src.team, sourceId: src.id, style: o.style, pos: { ...(o.from ?? src.pos) }, speed: o.speed, targetId: null,
      dir: o.dir, range: o.range, travelled: 0, width: o.width, pierce: !!o.pierce,
      canHit: o.canHit ?? ((u) => u.kind === 'minion' || u.kind === 'champion'), hit: [], onHit: o.onHit, frozenBy: null,
    });
  }

  fireHoming(src: Unit, target: Unit, style: MissileStyle, speed: number, onHit: (t: Unit) => void, from: Vec2 = src.pos) {
    this.missiles.push({
      id: this.nextId++, team: src.team, sourceId: src.id, style, pos: { ...from }, speed, targetId: target.id,
      dir: dirTo(from, target.pos), range: Infinity, travelled: 0, width: 0, pierce: false, canHit: () => true, hit: [], onHit, frozenBy: null,
    });
  }

  // ---------- waves ----------

  private spawnWaves() {
    if (this.tick >= this.nextWaveTick) {
      this.nextWaveTick += ticks(this.rules.waveInterval);
      WAVE.roles.forEach((role, i) => {
        const laneY = ((i % 3) - 1) * 1.3;
        for (const team of ['blue', 'red'] as Team[]) {
          this.spawnQueue.push({ tick: this.tick + ticks(WAVE.stagger * i), team, role, laneY });
        }
      });
    }
    for (let i = this.spawnQueue.length - 1; i >= 0; i--) {
      const s = this.spawnQueue[i];
      if (s.tick > this.tick) continue;
      this.spawnQueue.splice(i, 1);
      this.spawnMinion(s.team, s.role, { x: sideX(s.team, LANE.nexusX - 4), y: s.laneY });
    }
  }

  spawnMinion(team: Team, role: MinionRole, pos: Vec2): Unit {
    const buff = this.champions().filter((c) => c.team === team).flatMap(perksOf).reduce((b, a) => b + (a.minionBuff ?? 0), 0);
    const base = MINIONS[role];
    const m = this.spawn('minion', team, pos, { ...base, hp: base.hp * (1 + buff), damage: base.damage * (1 + buff) }, role);
    m.laneY = pos.y;
    return m;
  }

  // ---------- target selection ----------

  private nearest(from: Unit, within: number, pred: (u: Unit) => boolean) {
    let best: Unit | undefined;
    let bestD = within;
    for (const u of this.units) {
      if (!this.canAttack(from, u) || !pred(u)) continue;
      const d = gap(from, u);
      if (d <= bestD) { best = u; bestD = d; }
    }
    return best;
  }

  /** Keep the current target while it stays valid and close; otherwise minion > structure > champion. */
  private minionBrain(m: Unit) {
    const cur = this.get(m.attackTarget);
    if (!this.canAttack(m, cur) || gap(m, cur) > MINION_AGGRO + 2) {
      const t =
        this.nearest(m, MINION_AGGRO, (u) => u.kind === 'minion') ??
        this.nearest(m, MINION_AGGRO, (u) => u.kind === 'tower' || u.kind === 'nexus') ??
        this.nearest(m, MINION_AGGRO, (u) => u.kind === 'champion');
      m.attackTarget = t?.id ?? null;
      if (!t) m.windup = 0;
    }
    // March on the enemy nexus when there's nothing to fight.
    m.moveTarget = m.attackTarget == null ? { x: sideX(enemyOf(m.team), LANE.nexusX), y: m.laneY } : null;
  }

  /** Keep the current target while in range; otherwise nearest minion, then nearest champion. */
  private towerBrain(t: Unit) {
    const cur = this.get(t.attackTarget);
    if (this.canAttack(t, cur) && gap(t, cur) <= t.range) return;
    const next = this.nearest(t, t.range, (u) => u.kind === 'minion') ?? this.nearest(t, t.range, (u) => u.kind === 'champion');
    t.attackTarget = next?.id ?? null;
    t.windup = 0;
  }

  /** An idle champion attacks whatever wanders into range, preferring minions (so it doesn't pull tower aggro by accident). */
  private autoAcquire(c: Unit) {
    const t = this.nearest(c, c.range, (u) => u.kind === 'minion') ?? this.nearest(c, c.range, (u) => u.kind === 'champion');
    if (t) c.attackTarget = t.id;
  }

  // ---------- attacking ----------

  private combat(u: Unit) {
    if (u.attackCd > 0) u.attackCd--;
    if (this.isStunned(u) || u.forced) u.windup = 0;
    if (this.isBusy(u)) return;
    const target = this.get(u.attackTarget);
    if (u.attackTarget != null && !this.canAttack(u, target)) {
      u.attackTarget = null;
      u.windup = 0;
      return;
    }
    if (!target) return;

    if (u.windup > 0) {
      if (--u.windup === 0) this.fire(u, target);
      return;
    }
    if (gap(u, target) > u.range) {
      if (u.speed > 0) u.moveTarget = { ...target.pos }; // chase
      return;
    }
    u.moveTarget = null;
    u.facing = angleTo(u.pos, target.pos);
    if (u.attackCd > 0) return;
    u.attackCd = this.attackTicks(u);
    u.windup = u.windupTicks;
    u.lastAttackTick = this.tick;
  }

  private fire(u: Unit, target: Unit) {
    const rage = this.status(u, 'rage')?.value ?? 0;
    const hit = (t: Unit) => this.dealDamage(this.get(u.id) ?? null, t, u.damage + rage, { attack: true });
    if (u.projectileSpeed <= 0) return hit(target);
    const off = u.kind === 'tower' ? 0 : u.radius;
    const from = { x: u.pos.x + Math.cos(u.facing) * off, y: u.pos.y + Math.sin(u.facing) * off };
    this.fireHoming(u, target, u.kind === 'tower' ? 'tower' : (u.champ && kitOf(u).autoStyle) || 'auto', u.projectileSpeed, hit, from);
  }

  private updateMissiles() {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      if (m.frozenBy != null) continue; // released (destroyed) when its field ends
      // Stopwatch freezes skillshots, not auto-attacks (homing shots): otherwise standing in his own
      // field made Tock immune to ranged champions for its whole duration.
      const field = m.targetId == null && this.zones.find((z) => z.kind === 'stasis' && z.team !== m.team && dist(z.pos, m.pos) <= z.radius);
      if (field) { m.frozenBy = field.id; continue; }

      const stepLen = m.speed * DT;
      if (m.targetId != null) {
        const t = this.get(m.targetId);
        if (!t || t.dead) { this.missiles.splice(i, 1); continue; }
        const d = dist(m.pos, t.pos);
        if (d <= stepLen + t.radius * 0.5) {
          this.missiles.splice(i, 1);
          m.onHit(t); // a shot already in the air still lands if its shooter died
        } else {
          m.dir = dirTo(m.pos, t.pos);
          m.pos = toward(m.pos, t.pos, stepLen);
        }
        continue;
      }

      const next = { x: m.pos.x + m.dir.x * stepLen, y: m.pos.y + m.dir.y * stepLen };
      const hits = this.units
        .filter((u) => !u.dead && u.team !== m.team && this.isTargetable(u) && !m.hit.includes(u.id) && m.canHit(u))
        .map((u) => ({ u, ...segmentDistance(u.pos, m.pos, next) }))
        .filter((h) => h.d <= m.width / 2 + h.u.radius)
        .sort((a, b) => a.t - b.t);
      let stopped = false;
      for (const h of hits) {
        m.hit.push(h.u.id);
        m.onHit(h.u);
        if (!m.pierce) {
          stopped = true;
          break;
        }
      }
      m.pos = next;
      m.travelled += stepLen;
      if (stopped || m.travelled >= m.range || Math.abs(m.pos.x) > LANE.halfLength + 5) this.missiles.splice(i, 1);
    }
  }

  private updateZones() {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      if (this.tick >= z.until) {
        this.zones.splice(i, 1);
        for (let j = this.missiles.length - 1; j >= 0; j--) if (this.missiles[j].frozenBy === z.id) this.missiles.splice(j, 1);
        continue;
      }
      if (z.kind === 'stasis') {
        for (const u of this.units) {
          if (u.dead || u.team === z.team || u.speed <= 0 || dist(u.pos, z.pos) > z.radius + u.radius) continue;
          this.addStatus(u, { kind: 'slow', value: STASIS_SLOW, sourceId: z.ownerId, seconds: 0.25 });
        }
      }
    }
  }

  private runScheduled() {
    const due = this.scheduled.filter((s) => s.tick <= this.tick);
    if (!due.length) return;
    this.scheduled = this.scheduled.filter((s) => s.tick > this.tick);
    for (const s of due) s.fn();
  }

  /** Apply damage (after augment and rule multipliers) and fire kit and augment hooks. Returns damage dealt. */
  dealDamage(src: Unit | null, target: Unit, amount: number, from: DamageSource = {}): number {
    if (target.dead || amount <= 0) return 0;
    if (src?.kind === 'minion') amount *= hiveMinionMult(this, src);
    if (src?.champ) {
      amount *= 1 + src.champ.mods.dmgAmp;
      for (const a of perksOf(src)) amount *= a.damageMult?.(this, src, target) ?? 1;
    }
    if (target.champ) {
      amount *= target.champ.mods.takenMult;
      const guard = target.statuses.reduce((g, st) => (st.kind === 'guard' && st.until > this.tick ? Math.max(g, st.value) : g), 0);
      amount *= 1 - guard;
      if (src?.kind === 'tower') amount *= target.champ.mods.towerTakenMult;
    }
    // Shields soak damage first (oldest first); an emptied shield expires this tick.
    for (const sh of target.statuses) {
      if (sh.kind !== 'shield' || amount <= 0) continue;
      const take = Math.min(sh.value, amount);
      sh.value -= take;
      amount -= take;
      if (sh.value <= 0) sh.until = this.tick;
    }
    target.hp -= amount;
    target.lastHurtTick = this.tick;
    if (src?.kind === 'champion' && target.kind === 'champion') this.callForHelp(src, target);
    if (target.hp <= 0) this.kill(target, src);
    if (src?.champ && !src.dead) {
      if (src.champ.mods.omnivamp > 0) this.heal(src, amount * src.champ.mods.omnivamp);
      const kit = kitOf(src);
      kit.onDamageDealt?.(this, src, target, amount);
      for (const a of perksOf(src)) a.onDamage?.(this, src, target, amount, from);
      if (!from.proc) {
        if (from.attack) {
          kit.onAttackHit?.(this, src, target);
          for (const a of perksOf(src)) a.onAttackHit?.(this, src, target);
        }
        if (from.slot != null) kit.onAbilityHit?.(this, src, target, from.slot);
      }
    }
    if (target.champ && !target.dead) {
      kitOf(target).onHurt?.(this, target, src, amount, from);
      for (const a of perksOf(target)) a.onHurt?.(this, target, src, amount, from);
    }
    return amount;
  }

  private win(team: Team, reason: WinReason) {
    if (this.winner) return;
    this.winner = team;
    this.winReason = reason;
  }

  /** Hitting a champion turns its towers and nearby minions on you. */
  private callForHelp(attacker: Unit, victim: Unit) {
    for (const u of this.units) {
      if (u.dead || u.team !== victim.team) continue;
      const helps =
        (u.kind === 'tower' && gap(u, attacker) <= u.range) ||
        (u.kind === 'minion' && dist(u.pos, victim.pos) <= CALL_FOR_HELP);
      if (helps && u.attackTarget !== attacker.id) {
        u.attackTarget = attacker.id;
        u.windup = 0;
      }
    }
  }

  private kill(u: Unit, killer: Unit | null) {
    u.hp = 0;
    u.dead = true;
    u.attackTarget = null;
    u.moveTarget = null;
    u.windup = 0;
    const { xpMult, goldMult } = this.rules;
    let byChampion = killer?.champ && killer.team !== u.team ? killer : null;
    // A minion no champion finished off can still be claimed (Mabel's Pollinated: stung or honeyed).
    if (!byChampion && u.kind === 'minion') {
      byChampion = this.champions().find((c) => !c.dead && c.team !== u.team && kitOf(c).claimsMinion?.(this, c, u)) ?? null;
    }
    u.statuses = [];
    if (byChampion) {
      byChampion.gold += Math.round(
        (u.kind === 'champion' ? CHAMPION_BOUNTY : u.kind === 'minion' ? MINIONS[u.role!].bounty * goldMult : STRUCTURES[u.kind].bounty),
      );
      if (u.kind === 'minion') byChampion.champ!.cs++;
      kitOf(byChampion).onKill?.(this, byChampion, u);
      for (const a of perksOf(byChampion)) a.onKill?.(this, byChampion, u);
    }
    if (u.kind === 'minion') {
      for (const c of this.champions()) {
        if (!c.dead && c.team !== u.team && dist(c.pos, u.pos) <= XP_RANGE) this.grantXp(c, MINION_XP[u.role!] * xpMult);
      }
    }
    if (u.kind === 'champion') {
      // Any death scores for the other side (a tower execute counts), worth more with Bounty Hunter.
      const foe = this.champions().find((c) => c.team !== u.team);
      if (foe?.champ) foe.champ.kills += byChampion ? Math.max(1, ...perksOf(byChampion).map((a) => a.killValue ?? 1)) : 1;
      u.champ!.deaths++;
      if (byChampion) this.grantXp(byChampion, champKillXp(u.champ!.level) * xpMult);
      u.champ!.casting = null;
      u.champ!.dash = null;
      kitOf(u).onDeath?.(this, u);
      u.respawnTick = this.tick + ticks(RESPAWN_SECONDS);
      if (foe && foe.champ!.kills >= this.rules.killsToWin) this.win(foe.team, 'kills');
    }
    if (byChampion && byChampion.champ!.cs >= this.rules.csToWin) this.win(byChampion.team, 'cs');
    if (u.kind === 'tower' && this.rules.firstTowerWins) this.win(enemyOf(u.team), 'tower');
    if (u.kind === 'nexus') this.win(enemyOf(u.team), 'nexus');
  }

  private regen() {
    for (const u of this.champions()) {
      if (u.dead) continue;
      const atFountain = dist(u.pos, spawnPoint(u.team)) <= FOUNTAIN.radius;
      const c = u.champ!;
      this.heal(u, (CHAMPION_REGEN + (atFountain ? u.maxHp * FOUNTAIN.healPerSec : 0)) * DT);
      const bonusRegen = kitOf(u).resource === 'bees' ? 0 : c.mods.manaRegen; // mana items don't grow bees
      c.mana = Math.min(c.maxMana, c.mana + (kitOf(u).stats.manaRegen + bonusRegen + (atFountain ? c.maxMana * FOUNTAIN.healPerSec : 0)) * DT);
    }
    for (const u of this.champions()) {
      if (u.dead) continue;
      const heal = u.statuses.reduce((h, st) => (st.kind === 'regen' ? h + st.value : h), 0);
      if (heal) this.heal(u, heal * DT);
    }
    for (const u of this.units) {
      for (const b of u.statuses) {
        if ((b.kind === 'burn' || b.kind === 'sting') && !u.dead) this.dealDamage(this.get(b.sourceId) ?? null, u, b.value * DT, { proc: true });
      }
    }
  }

  private expire() {
    for (const u of this.units) if (u.statuses.length) u.statuses = u.statuses.filter((s) => s.until > this.tick);
    for (let i = this.telegraphs.length - 1; i >= 0; i--) if (this.telegraphs[i].end <= this.tick) this.telegraphs.splice(i, 1);
    while (this.fx.length && this.fx[0].tick < this.tick - 3 * TICK_HZ) this.fx.shift();
  }

  /** Remove dead non-champions; bring champions back at their fountain. */
  private reap() {
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (!u.dead) continue;
      if (u.kind !== 'champion') { this.units.splice(i, 1); continue; }
      if (this.tick >= u.respawnTick) {
        u.dead = false;
        u.hp = u.maxHp;
        u.champ!.mana = u.champ!.maxMana;
        u.pos = spawnPoint(u.team);
        u.attackCd = 0;
      }
    }
  }

  // ---------- movement ----------

  private move(u: Unit) {
    if (!u.moveTarget || u.windup > 0 || this.isBusy(u) || this.isRooted(u)) return;
    const dx = u.moveTarget.x - u.pos.x;
    const dy = u.moveTarget.y - u.pos.y;
    const d = Math.hypot(dx, dy);
    const stepLen = this.effectiveSpeed(u) * DT;
    if (d <= stepLen) {
      u.pos = { ...u.moveTarget };
      u.moveTarget = null;
    } else {
      const dir = this.steer(u, { x: dx / d, y: dy / d });
      u.pos = { x: u.pos.x + dir.x * stepLen, y: u.pos.y + dir.y * stepLen };
      u.facing = Math.atan2(dir.y, dir.x);
    }
    this.resolveStructures(u);
  }

  /**
   * When touching something that isn't going anywhere (a structure, or a unit standing still) and
   * heading into it, walk along its edge instead, toward whichever side the target is on. Without
   * this a unit pushed straight back out of an obstacle stalls there.
   */
  private steer(u: Unit, dir: Vec2): Vec2 {
    for (const s of this.units) {
      if (s === u || s.dead || (s.speed > 0 && s.moveTarget && s.windup === 0 && !this.isBusy(s))) continue;
      const ox = s.pos.x - u.pos.x;
      const oy = s.pos.y - u.pos.y;
      const d = Math.hypot(ox, oy);
      if (d > u.radius + s.radius + 0.05 || d < 1e-6) continue;
      const nx = ox / d;
      const ny = oy / d;
      if (dir.x * nx + dir.y * ny <= 0) continue; // moving away already
      const side = nx * dir.y - ny * dir.x >= 0 ? 1 : -1;
      return { x: -ny * side, y: nx * side };
    }
    return dir;
  }

  /** Push a mobile unit out of structures (structures never move) and back into the lane. */
  private resolveStructures(u: Unit) {
    for (const s of this.units) {
      if (s === u || s.speed > 0 || s.dead) continue;
      const dx = u.pos.x - s.pos.x;
      const dy = u.pos.y - s.pos.y;
      const min = u.radius + s.radius;
      const d = Math.hypot(dx, dy);
      if (d >= min) continue;
      // Exactly on top: push sideways so the unit slides around the structure.
      const nx = d > 1e-6 ? dx / d : 0;
      const ny = d > 1e-6 ? dy / d : 1;
      u.pos = { x: s.pos.x + nx * min, y: s.pos.y + ny * min };
    }
    u.pos = clampToLane(u.pos, u.radius);
  }

  /** Soft circle separation between mobile units so waves spread out instead of stacking. Dashing units pass through. */
  private separate() {
    const mobile = this.units.filter((u) => !u.dead && u.speed > 0 && !u.champ?.dash);
    for (let i = 0; i < mobile.length; i++) {
      for (let j = i + 1; j < mobile.length; j++) {
        const a = mobile[i];
        const b = mobile[j];
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const min = a.radius + b.radius;
        const d = Math.hypot(dx, dy);
        if (d >= min) continue;
        const nx = d > 1e-6 ? dx / d : 0;
        const ny = d > 1e-6 ? dy / d : 1;
        const push = (min - d) * 0.5;
        a.pos = { x: a.pos.x - nx * push, y: a.pos.y - ny * push };
        b.pos = { x: b.pos.x + nx * push, y: b.pos.y + ny * push };
      }
    }
    for (const u of mobile) this.resolveStructures(u);
  }
}
