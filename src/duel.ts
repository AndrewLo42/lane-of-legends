import type * as THREE from 'three';
import type { Input } from './core/input';
import type { MobaCamera } from './render/camera';
import { EffectsView, type AimIndicator } from './render/effects';
import { toV3, type ClickMarker } from './render/scene';
import { WorldView } from './render/views';
import { BotController } from './sim/bot';
import { kitOf } from './sim/kits';
import type { DuelRules, WinReason } from './sim/rules';
import type { AugmentId, Command, Controller, KitId, Slot, Unit } from './sim/types';
import { DT, TICK_HZ, World } from './sim/world';
import { AbilityBar } from './ui/abilityBar';
import { HealthBars } from './ui/bars';
import { Hud } from './ui/hud';

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
  enemyKit: KitId;
  enemyAugments: AugmentId[];
  enemyStatMult: number;
  enemyAccuracy: number;
  /** Shown in the top bar, e.g. "Floor 2 · Contender". */
  label: string;
  /** Free play: the duel never "finishes"; R reloads after a win. */
  sandbox?: boolean;
}

export interface DuelOutcome {
  won: boolean;
  reason: WinReason | null;
  seconds: number;
}

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
  private hud: Hud;
  private abilityBar: AbilityBar;
  /** The ability whose key is held down: its indicator shows, and it casts on release. */
  private aiming: Slot | null = null;
  private acc = 0;
  private reissue = 0;
  /** Wall-clock time the duel was decided (so a throttled background tab still moves on). */
  private decidedAt: number | null = null;

  constructor(private shell: Shell, private setup: DuelSetup) {
    this.finished = new Promise((r) => (this.resolve = r));
    const world = (this.world = new World(setup.seed, setup.rules));
    this.me = world.spawnChampion('blue', setup.kit, this.player, { augments: setup.augments });
    this.foe = world.spawnChampion('red', setup.enemyKit, new BotController(setup.enemyAccuracy), {
      augments: setup.enemyAugments, statMult: setup.enemyStatMult,
    });
    this.view = new WorldView(shell.scene, world);
    this.effects = new EffectsView(shell.scene, world, this.me.team);
    this.bars = new HealthBars(world, this.view, this.me.id, this.me.team);
    this.hud = new Hud(world, this.me, this.foe, setup.label, !!setup.sandbox);
    this.abilityBar = new AbilityBar(world, this.me, (slot) => this.player.queue.push({ type: 'levelUp', slot }));
    shell.input.endFrame(); // drop keys pressed on the menus
    shell.cam.locked = true;
    if (import.meta.env.DEV) Object.assign(window, { world, me: this.me });
  }

  frame(dt: number) {
    const { world, me, player, shell } = this;
    const { input, cam, marker, renderer } = shell;

    const hover = me.dead || world.winner ? undefined : this.enemyUnderCursor();
    renderer.domElement.style.cursor = hover ? 'crosshair' : 'default';

    if (!world.winner) {
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
      if (!this.setup.sandbox && performance.now() - this.decidedAt >= END_PAUSE * 1000) {
        this.resolve({ won: world.winner === me.team, reason: world.winReason, seconds: Math.round(world.tick / TICK_HZ) });
      }
    }

    this.acc += dt;
    while (this.acc >= DT) {
      this.view.snapshot();
      world.step();
      this.acc -= DT;
    }

    this.view.update(this.acc / DT, dt);
    this.effects.update(dt);
    marker.update(dt);
    cam.update(dt, input, this.view.positionOf(me.id) ?? toV3(me.pos));
    renderer.render(shell.scene, cam.camera);
    this.bars.update(cam.camera);
    this.hud.update();
    this.abilityBar.update();
  }

  dispose() {
    this.view.dispose();
    this.effects.dispose();
    this.bars.dispose();
    this.hud.dispose();
    this.abilityBar.dispose();
    this.shell.indicator.hide();
    this.shell.renderer.domElement.style.cursor = 'default';
  }

  /**
   * The enemy under the cursor: a mesh hit first, then (since minions are small) the nearest enemy
   * within a forgiving radius of the ground point.
   */
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
      if (d < 0.7 && d < bestD) { best = u; bestD = d; }
    }
    return best;
  }

  private handleAbilities() {
    const { world, me, player } = this;
    const { input, cam, indicator } = this.shell;
    const cursor = cam.groundAt(input.mouse.x, input.mouse.y);
    ABILITY_KEYS.forEach((code, i) => {
      if (!input.wasPressed(code)) return;
      if (input.isDown('AltLeft') || input.isDown('AltRight')) player.queue.push({ type: 'levelUp', slot: i as Slot });
      else this.aiming = i as Slot;
    });
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
