import type * as THREE from 'three';
import type { Input } from './core/input';
import type { MobaCamera } from './render/camera';
import { EffectsView, type AimIndicator } from './render/effects';
import { TargetRing, toV3, type ClickMarker } from './render/scene';
import { WorldView } from './render/views';
import { BotController } from './sim/bot';
import { kitOf } from './sim/kits';
import type { DuelRules, WinReason } from './sim/rules';
import { SUMMONERS } from './sim/summoners';
import type { AugmentId, Command, Controller, KitId, Slot, SummonerId, SummonerSlot, Unit } from './sim/types';
import { DT, TICK_HZ, World } from './sim/world';
import { AbilityBar } from './ui/abilityBar';
import { HealthBars } from './ui/bars';
import { DamageNumbers } from './ui/damageNumbers';
import { KillFeed } from './ui/killFeed';
import { duelRecap, type DuelRecap } from './sim/recap';
import type { NetClient } from './net/client';
import { SEAT_GRACE, applySnapshot, type ServerMsg, type Snapshot } from './net/protocol';
import { predictOwn, type PendingBatch } from './net/predict';
import { CURSOR } from './ui/cursors';
import { Hud } from './ui/hud';
import { Minimap } from './ui/minimap';

/** Long-lived pieces owned by main.ts and shared by every duel. */
export interface Shell {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  cam: MobaCamera;
  input: Input;
  marker: ClickMarker;
  indicator: AimIndicator;
}

export interface DuelSetup {
  seed: number;
  rules: DuelRules;
  kit: KitId;
  augments: AugmentId[];
  /** Shop items (permanent + this duel's consumables). */
  items?: AugmentId[];
  /** Levels above the rules' start level (Tome of Insight). */
  extraLevels?: number;
  /** Summoner spells (D, F). Flash + Ignite if not given. */
  summoners?: SummonerId[];
  enemyKit: KitId;
  enemySummoners?: SummonerId[];
  enemyAugments: AugmentId[];
  enemyItems?: AugmentId[];
  enemyStatMult: number;
  enemyAccuracy: number;
  /** Shown in the top bar, e.g. "Floor 2 · Contender". */
  label: string;
  /** Free play: the duel never "finishes"; R reloads after a win. */
  sandbox?: boolean;
  /** Bot vs bot: the blue side is a bot too (at `enemyAccuracy`); the player only watches. */
  spectate?: boolean;
  /**
   * Online PvP: the server runs the sim; this client draws from its snapshots and sends the player's
   * commands. Champions, seed and rules come from `start`; the other setup fields are ignored.
   */
  net?: { client: NetClient; start: Extract<ServerMsg, { t: 'start' }> };
}

export interface DuelOutcome {
  won: boolean;
  reason: WinReason | null;
  seconds: number;
  /** Gold the player earned in the duel. */
  gold: number;
  /** Damage breakdown for the recap screen. */
  recap: DuelRecap;
  /** Online: the opponent disconnected (you win by forfeit). */
  left?: boolean;
  /** Online: your connection dropped mid-duel and couldn't get back in time (a forfeit; `recap` is only what this client saw). */
  lost?: boolean;
}

/**
 * Online: seconds without a word from the server before warning the player, and before treating the
 * connection as dropped and reconnecting; how often to retry, and how long the server holds the seat.
 */
const STALL_WARN = 2;
const STALL_DROP = 6;
const RETRY_EVERY = 1.5;
const RETRY_STUCK = 5;

/** Human controller: queues commands from input; the sim drains them on its next tick. */
class PlayerController implements Controller {
  queue: Command[] = [];
  think() {
    const q = this.queue;
    this.queue = [];
    return q;
  }
}

const ABILITY_KEYS = ['KeyQ', 'KeyW', 'KeyE', 'KeyR'];
const SUMMONER_KEYS = ['KeyD', 'KeyF'];
/** How long the victory/defeat banner shows before the duel hands back control. */
const END_PAUSE = 2.5;

/** One lane duel: the sim, its views and HUD, and the player's input. */
export class Duel {
  readonly world: World;
  readonly me: Unit;
  readonly foe: Unit;
  /** Resolves a moment after someone wins (never, in sandbox mode). */
  readonly finished: Promise<DuelOutcome>;
  private resolve!: (o: DuelOutcome) => void;
  private player = new PlayerController();
  private view: WorldView;
  private effects: EffectsView;
  private bars: HealthBars;
  private damageNumbers: DamageNumbers;
  private killFeed: KillFeed;
  private hud: Hud;
  private abilityBar: AbilityBar;
  private minimap: Minimap;
  private targetRing: TargetRing;
  /** The ability whose key is held down: its indicator shows, and it casts on release. */
  private aiming: Slot | null = null;
  /** The summoner spell whose key (D/F) is held; same hold-to-aim, release-to-cast as abilities. */
  private aimingSpell: SummonerSlot | null = null;
  private acc = 0;
  private reissue = 0;
  /** Wall-clock time the duel was decided (so a throttled background tab still moves on). */
  private decidedAt: number | null = null;
  /** Bot vs bot: simulation speed and the speed/leave panel. */
  private speed = 1;
  private spectatorPanel?: HTMLDivElement;
  /** Online: snapshots received since the last frame, when the latest arrived, and the server's verdict. */
  private snaps: Snapshot[] = [];
  private lastSnapAt = performance.now();
  private netEnd: Extract<ServerMsg, { t: 'end' }> | null = null;
  /**
   * Online movement prediction: command batches the server hasn't applied yet (with when they were
   * sent), the round-trip time measured from its acknowledgements, and a small ping readout.
   */
  private pending: PendingBatch[] = [];
  private seq = 0;
  private acked = 0;
  private rtt = 100;
  private pingEl?: HTMLDivElement;
  /** When the server was last heard from (messages arrive even while the tab is hidden), and whether it's gone. */
  private heardAt = performance.now();
  private lost = false;
  /** Reconnecting after a drop: since when, and when the last attempt started. */
  private reconnectingSince: number | null = null;
  private attemptAt = 0;
  /** The other player has dropped: seconds left of their held seat (the duel is paused), else null. */
  private peerAway: number | null = null;
  private bannerEl?: HTMLDivElement;

  constructor(private shell: Shell, private setup: DuelSetup) {
    this.finished = new Promise((r) => (this.resolve = r));
    const net = setup.net;
    const world = (this.world = new World(net?.start.seed ?? setup.seed, net?.start.rules ?? setup.rules));
    if (net) {
      // A mirror of the server's world: never stepped here, only overwritten by snapshots.
      applySnapshot(world, net.start.snap);
      this.me = world.get(net.start.you)!;
      this.foe = world.get(net.start.foe)!;
      net.client.onMessage = (msg) => {
        this.heardAt = performance.now();
        if (msg.t === 'snap') this.snaps.push(msg.snap);
        else if (msg.t === 'end') this.netEnd = msg;
        else if (msg.t === 'peer') this.peerAway = msg.connected ? null : msg.wait;
        else if (msg.t === 'resume') {
          // Back in: the whole world as the server has it now; anything unacknowledged was lost with the drop.
          this.snaps = [msg.snap];
          this.pending = [];
          this.reconnectingSince = null;
        } else if (msg.t === 'error' && this.reconnectingSince != null) this.lost = true; // the seat is gone
      };
      net.client.onClose = () => (this.reconnectingSince ??= performance.now());
    } else {
      this.me = world.spawnChampion('blue', setup.kit, setup.spectate ? new BotController(setup.enemyAccuracy) : this.player, {
        augments: setup.augments, items: setup.items, extraLevels: setup.extraLevels, summoners: setup.summoners,
      });
      this.foe = world.spawnChampion('red', setup.enemyKit, new BotController(setup.enemyAccuracy), {
        augments: setup.enemyAugments, items: setup.enemyItems, statMult: setup.enemyStatMult, summoners: setup.enemySummoners,
      });
    }
    this.view = new WorldView(shell.scene, world);
    this.effects = new EffectsView(shell.scene, world, this.me.team);
    this.bars = new HealthBars(world, this.view, this.me.id, this.me.team);
    this.damageNumbers = new DamageNumbers(world, this.view, this.me.id);
    this.killFeed = new KillFeed(world, this.me, !!setup.spectate);
    this.hud = new Hud(world, this.me, this.foe, setup.label, !!setup.sandbox, !!setup.spectate);
    this.abilityBar = new AbilityBar(world, this.me, (slot) => this.player.queue.push({ type: 'levelUp', slot }));
    this.targetRing = new TargetRing(shell.scene);
    this.minimap = new Minimap(world, this.me, shell.cam, shell.input, shell.marker, (c) => this.player.queue.push(c));
    if (setup.spectate) this.buildSpectatorPanel();
    shell.input.endFrame(); // drop keys pressed on the menus
    shell.cam.locked = true;
    if (import.meta.env.DEV) Object.assign(window, { world, me: this.me, view: this.view, cam: shell.cam, net: net?.client });
  }

  frame(dt: number) {
    const { world, me, player, shell } = this;
    const { input, cam, marker, renderer } = shell;

    const spectating = !!this.setup.spectate;
    const net = this.setup.net;
    /** Decided: someone won (online, the server's word, which also covers a forfeit). */
    const over = net ? !!this.netEnd || !!world.winner : !!world.winner;
    const hover = me.dead || over || spectating ? undefined : this.enemyUnderCursor();
    renderer.domElement.style.cursor = hover ? CURSOR.attack : this.aiming != null || this.aimingSpell != null ? CURSOR.aim : CURSOR.normal;

    if (spectating && !over) {
      if (input.wasPressed('Escape')) this.leave();
    } else if (!over) {
      this.handleAbilities();
      // Right-click an enemy to attack it, the ground to move; holding keeps re-issuing, like League.
      this.reissue -= dt;
      if (!me.dead && (input.rmbClicked || (input.rmb && this.reissue <= 0))) {
        if (hover) {
          player.queue.push({ type: 'attack', target: hover.id });
        } else {
          const g = cam.groundAt(input.mouse.x, input.mouse.y);
          if (g) {
            player.queue.push({ type: 'move', to: { x: g.x, y: g.z } });
            if (input.rmbClicked) marker.show(g);
          }
        }
        this.reissue = 0.1;
      }
      if (input.wasPressed('KeyS')) player.queue.push({ type: 'stop' });
    } else {
      shell.indicator.hide();
      if (this.setup.sandbox && input.wasPressed('KeyR')) location.reload();
      this.decidedAt ??= performance.now();
      const paused = performance.now() - this.decidedAt >= END_PAUSE * 1000;
      if (net) {
        // The server sends the recap (only it has the full damage history).
        const end = this.netEnd;
        if (end && paused) {
          this.resolve({ won: end.winner === me.team, reason: end.reason, seconds: Math.round(world.tick / TICK_HZ), gold: me.gold, recap: end.recap, left: end.left });
        }
      } else if (!this.setup.sandbox && paused) {
        this.resolve({ won: world.winner === me.team, reason: world.winReason, seconds: Math.round(world.tick / TICK_HZ), gold: me.gold, recap: duelRecap(world, me, this.foe) });
      }
    }

    // Spectators can fast-forward; the sim and the animations speed up together.
    const simDt = dt * (spectating ? this.speed : 1);
    let alpha: number;
    if (net) {
      // Online: send what the player did this frame, then catch up on the server's snapshots.
      // While anyone is away the duel is paused: nothing to send.
      if (this.reconnectingSince != null || this.peerAway != null) player.queue.length = 0;
      if (player.queue.length) {
        const cmds = player.queue.splice(0);
        net.client.send({ t: 'cmds', seq: ++this.seq, cmds });
        this.pending.push({ seq: this.seq, at: performance.now(), cmds });
      }
      for (const snap of this.snaps.splice(0)) {
        this.view.snapshot();
        applySnapshot(world, snap);
        this.acknowledge(snap.ack);
        if (!this.setup.spectate) predictOwn(world, me, this.pending, this.rtt, performance.now());
        this.lastSnapAt = performance.now();
      }
      alpha = Math.min(1, (performance.now() - this.lastSnapAt) / (DT * 1000));
      this.keepConnected(net.client);
      if (this.lost && !this.netEnd) {
        this.resolve({ won: false, reason: null, seconds: Math.round(world.tick / TICK_HZ), gold: me.gold, recap: duelRecap(world, me, this.foe), lost: true });
      }
    } else {
      this.acc += simDt;
      while (this.acc >= DT) {
        this.view.snapshot();
        world.step();
        this.acc -= DT;
      }
      alpha = this.acc / DT;
    }

    this.view.update(alpha, simDt);
    this.effects.update(simDt);
    marker.update(dt);
    this.targetRing.update(dt, hover ? this.view.positionOf(hover.id) ?? null : null, hover?.radius);
    cam.update(dt, input, spectating ? this.watchPoint() : this.view.positionOf(me.id) ?? toV3(me.pos));
    renderer.render(shell.scene, cam.camera);
    this.bars.update(cam.camera);
    this.damageNumbers.update(cam.camera, simDt);
    this.killFeed.update(simDt);
    this.hud.update();
    this.abilityBar.update();
    this.minimap.update(dt);
  }

  dispose() {
    this.spectatorPanel?.remove();
    this.pingEl?.remove();
    this.bannerEl?.remove();
    document.getElementById('abilities')?.classList.remove('spectating');
    this.view.dispose();
    this.effects.dispose();
    this.bars.dispose();
    this.damageNumbers.dispose();
    this.killFeed.dispose();
    this.hud.dispose();
    this.abilityBar.dispose();
    this.minimap.dispose();
    this.shell.indicator.hide();
    this.shell.renderer.domElement.style.cursor = '';
    this.targetRing.dispose();
  }

  /** Bot vs bot: stop watching now (resolves `finished` as if the match ended). */
  leave() {
    const { world, me } = this;
    this.resolve({ won: world.winner === me.team, reason: world.winReason, seconds: Math.round(world.tick / TICK_HZ), gold: me.gold, recap: duelRecap(world, me, this.foe) });
  }

  /**
   * Where the spectator camera looks: between the champions once they're close enough to fight,
   * otherwise on blue (or whoever is alive), so it never stares at an empty stretch of lane.
   */
  private watchPoint(): THREE.Vector3 {
    const alive = [this.me, this.foe].filter((c) => !c.dead).map((c) => this.view.positionOf(c.id) ?? toV3(c.pos));
    if (!alive.length) return toV3(this.me.pos);
    if (alive.length === 1 || alive[0].distanceTo(alive[1]) > 22) return alive[0];
    return alive[0].clone().add(alive[1]).multiplyScalar(0.5);
  }

  private buildSpectatorPanel() {
    const el = document.createElement('div');
    el.id = 'spectate';
    const render = () => {
      el.innerHTML = `<span>🤖 Bot vs bot</span>${[1, 2, 4].map((s) => `<button data-speed="${s}" class="${s === this.speed ? 'on' : ''}">${s}×</button>`).join('')}<button data-leave>Leave</button>`;
    };
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!t) return;
      if (t.dataset.leave != null) return this.leave();
      this.speed = Number(t.dataset.speed);
      render();
    });
    render();
    document.body.appendChild(el);
    this.spectatorPanel = el;
    document.getElementById('abilities')?.classList.add('spectating');
  }

  /**
   * The enemy under the cursor: a mesh hit first, then (since minions are small) the nearest enemy
   * within a forgiving radius of the ground point.
   */
  /** Drop the command batches the server has applied, timing the round trip of the newest one. */
  private acknowledge(ack: number) {
    if (ack <= this.acked) return;
    this.acked = ack;
    const sent = this.pending.find((p) => p.seq === ack);
    if (sent) this.rtt += (performance.now() - sent.at - this.rtt) * 0.2; // smoothed
    this.pending = this.pending.filter((p) => p.seq > ack);
    this.showPing();
  }

  private showPing() {
    if (!this.pingEl) {
      this.pingEl = document.createElement('div');
      this.pingEl.id = 'ping';
      document.body.appendChild(this.pingEl);
    }
    const ms = Math.round(this.rtt);
    this.pingEl.textContent = `${ms} ms`;
    this.pingEl.className = ms < 80 ? 'good' : ms < 160 ? 'ok' : 'bad';
  }

  /**
   * Online: notice a dropped or silent connection and get back into the duel with the seat token (the
   * server pauses the duel and holds the seat for SEAT_GRACE seconds), giving up once it can't be held.
   * Shows a banner for whatever is going on.
   */
  private keepConnected(client: NetClient) {
    const now = performance.now();
    if (this.netEnd || this.lost) return this.banner(null);
    const silent = (now - this.heardAt) / 1000;
    if (this.reconnectingSince == null && silent > STALL_DROP) {
      client.drop(); // gone quiet without closing
      this.reconnectingSince = now;
    }
    if (this.reconnectingSince != null) {
      const left = SEAT_GRACE - (now - this.reconnectingSince) / 1000;
      if (left <= 0) {
        this.lost = true;
        client.leave();
        return this.banner(null);
      }
      const since = (now - this.attemptAt) / 1000;
      if ((!client.active && since > RETRY_EVERY) || since > RETRY_STUCK) {
        this.attemptAt = now;
        if (!client.rejoin()) this.lost = true;
      }
      return this.banner('Connection lost', `Reconnecting… ${Math.ceil(left)}s`);
    }
    if (this.peerAway != null) return this.banner('Opponent disconnected', `Paused · ${this.peerAway}s for them to return`);
    this.banner(silent > STALL_WARN ? 'Connection unstable' : null, 'Waiting for the server…');
  }

  private banner(title: string | null, sub = '') {
    if (!title) {
      this.bannerEl?.remove();
      this.bannerEl = undefined;
      return;
    }
    if (!this.bannerEl) {
      this.bannerEl = document.createElement('div');
      this.bannerEl.id = 'netstall';
      document.body.appendChild(this.bannerEl);
    }
    const html = `<b>${title}</b><span>${sub}</span>`;
    if (this.bannerEl.innerHTML !== html) this.bannerEl.innerHTML = html;
  }

  private enemyUnderCursor(): Unit | undefined {
    const { world, me, view } = this;
    const { cam, input } = this.shell;
    const picked = world.get(view.pick(cam.rayAt(input.mouse.x, input.mouse.y)));
    if (world.canAttack(me, picked)) return picked;
    const g = cam.groundAt(input.mouse.x, input.mouse.y);
    if (!g) return;
    let best: Unit | undefined;
    let bestD = Infinity;
    for (const u of world.units) {
      if (!world.canAttack(me, u)) continue;
      const d = Math.hypot(u.pos.x - g.x, u.pos.y - g.z) - u.radius;
      if (d < 1 && d < bestD) { best = u; bestD = d; }
    }
    return best;
  }

  private handleSummoner(slot: SummonerSlot, cursor: THREE.Vector3 | null) {
    const { world, me, player } = this;
    const { input, indicator } = this.shell;
    if (input.rmbClicked || me.dead) {
      this.aimingSpell = null;
      return indicator.hide();
    }
    const at = cursor ? { x: cursor.x, y: cursor.z } : { ...me.pos };
    if (!input.isDown(SUMMONER_KEYS[slot])) {
      player.queue.push({ type: 'summon', slot, at });
      this.aimingSpell = null;
      return indicator.hide();
    }
    const spell = me.champ!.summoners[slot];
    if (!spell) return indicator.hide();
    indicator.show(SUMMONERS[spell.id].aim, this.view.positionOf(me.id)!, at, world.summonerBlocker(me, slot) === null);
  }

  private handleAbilities() {
    const { world, me, player } = this;
    const { input, cam, indicator } = this.shell;
    const cursor = cam.groundAt(input.mouse.x, input.mouse.y);
    ABILITY_KEYS.forEach((code, i) => {
      if (!input.wasPressed(code)) return;
      if (input.isDown('AltLeft') || input.isDown('AltRight')) player.queue.push({ type: 'levelUp', slot: i as Slot });
      else {
        this.aiming = i as Slot;
        this.aimingSpell = null;
      }
    });
    SUMMONER_KEYS.forEach((code, i) => {
      if (!input.wasPressed(code)) return;
      this.aimingSpell = i as SummonerSlot;
      this.aiming = null;
    });
    if (this.aimingSpell != null) return this.handleSummoner(this.aimingSpell, cursor);
    if (this.aiming == null) return indicator.hide();
    if (input.rmbClicked || me.dead) {
      this.aiming = null; // right-click cancels, like League
      return indicator.hide();
    }
    const at = cursor ? { x: cursor.x, y: cursor.z } : { ...me.pos };
    if (!input.isDown(ABILITY_KEYS[this.aiming])) {
      player.queue.push({ type: 'cast', slot: this.aiming, at });
      this.aiming = null;
      return indicator.hide();
    }
    const blocker = world.castBlocker(me, this.aiming);
    indicator.show(kitOf(me).abilities[this.aiming].aim, this.view.positionOf(me.id)!, at, blocker === null || blocker === 'busy');
  }
}
