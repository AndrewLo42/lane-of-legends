import * as THREE from 'three';
import { Input } from './core/input';
import { Duel, type Shell } from './duel';
import { MobaCamera } from './render/camera';
import { loadModels } from './render/assets';
import { AimIndicator } from './render/effects';
import { ClickMarker, buildArena, toV3 } from './render/scene';
import {
  advance, augmentOffers, buy, floorPlan, isFinalFloor, leaveShop, loadMeta, loadRun, loadout, newRun, recordRunEnd, reroll, saveRun,
  type DuelResult, type RunState,
} from './run/run';
import { spawnPoint } from './sim/lane';
import { KIT_IDS } from './sim/kits';
import { SANDBOX_RULES } from './sim/rules';
import type { KitId } from './sim/types';
import { augmentPick, floorIntro, pickChampion, runEnd, shop } from './ui/screens';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
buildArena(scene);
const cam = new MobaCamera(toV3(spawnPoint('blue')));
addEventListener('resize', () => {
  cam.resize();
  renderer.setSize(innerWidth, innerHeight);
});

const shell: Shell = {
  renderer, scene, cam, input: new Input(renderer.domElement), marker: new ClickMarker(scene), indicator: new AimIndicator(scene),
};

/** The duel being played, if any. Between duels the camera drifts over the empty lane behind the menus. */
let duel: Duel | null = null;
let last = performance.now();
let idleT = 0;

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (duel) {
    duel.frame(dt);
  } else {
    idleT += dt;
    cam.camera.position.set(Math.sin(idleT * 0.05) * 40, 24, 20);
    cam.camera.lookAt(Math.sin(idleT * 0.05) * 40 + 8, 0, 0);
    renderer.render(scene, cam.camera);
  }
  shell.input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

await loadModels(); // missing models fall back to placeholders

const params = new URLSearchParams(location.search);
const asKit = (v: string | null) => (KIT_IDS.includes(v as KitId) ? (v as KitId) : null);
const freePlayKit = asKit(params.get('champ'));

if (freePlayKit) {
  // Free play: the old sandbox, no goals, nexus to win.
  const enemyKit = asKit(params.get('enemy')) ?? KIT_IDS.find((k) => k !== freePlayKit) ?? freePlayKit;
  duel = new Duel(shell, {
    seed: Number(params.get('seed') ?? Date.now() % 1e9), rules: SANDBOX_RULES, kit: freePlayKit, augments: [],
    enemyKit, enemyAugments: [], enemyStatMult: 1, enemyAccuracy: 0.8, label: 'Free play', sandbox: true,
  });
} else {
  void runLoop();
}

/** Champion select → floor intro → duel → augment pick → shop → ... until a loss or the boss falls. */
async function runLoop() {
  let run: RunState | null = loadRun();
  for (;;) {
    if (!run) {
      run = newRun(await pickChampion(loadMeta()), Date.now() % 1e9);
      saveRun(run);
    }
    if (run.shopping) {
      const r = run;
      await shop(r, (id) => {
        if (buy(r, id)) saveRun(r);
      });
      leaveShop(run);
      saveRun(run);
    }
    let result: DuelResult | undefined = run.pending;
    if (!result) {
      const plan = floorPlan(run);
      if ((await floorIntro(run, plan)) === 'abandon') {
        recordRunEnd(run, false);
        saveRun(null);
        run = null;
        continue;
      }

      duel = new Duel(shell, {
        seed: plan.seed, rules: plan.rules, kit: run.kit, augments: run.augments, ...loadout(run), enemyKit: plan.opponent,
        enemyAugments: plan.opponentAugments, enemyItems: plan.opponentItems, enemyStatMult: plan.statMult, enemyAccuracy: plan.accuracy,
        label: `Floor ${run.floor + 1} · ${plan.title}`,
      });
      const outcome = await duel.finished;
      duel.dispose();
      duel = null;

      result = { floor: run.floor, won: outcome.won, reason: outcome.reason, opponent: plan.opponent, seconds: outcome.seconds, gold: outcome.gold };
      if (!outcome.won || isFinalFloor(run)) {
        run.results.push(result);
        const meta = recordRunEnd(run, outcome.won);
        saveRun(null);
        await runEnd(run, outcome.won, meta);
        run = null;
        continue;
      }
      run.pending = result;
      saveRun(run);
    }
    const r = run;
    const pick = await augmentPick(r, () => augmentOffers(r), () => {
      const ok = reroll(r);
      saveRun(r);
      return ok;
    });
    advance(run, result, pick);
    saveRun(run);
  }
}
