import * as THREE from 'three';
import { Input } from './core/input';
import { Duel, type Shell } from './duel';
import { MobaCamera } from './render/camera';
import { loadModels } from './render/assets';
import { installCursors } from './ui/cursors';
import { installHoverTips } from './ui/hoverTip';
import { bakePortraits } from './render/portraits';
import { AimIndicator } from './render/effects';
import { SelectStage } from './render/selectStage';
import { ClickMarker, buildArena, toV3 } from './render/scene';
import {
  advance, augmentOffers, buy, runSummoners, setSummoners, validSummoners, starterAugments, starterItems, takeStarter, floorPlan, isFinalFloor, leaveShop, loadMeta, loadRun, loadout, newRun, recordRunEnd, reroll, saveRun,
  type DuelResult, type RunState,
} from './run/run';
import { AUGMENTS } from './sim/augments';
import { ITEMS } from './sim/items';
import { spawnPoint } from './sim/lane';
import { BOT_KIT_IDS, KITS, KIT_IDS } from './sim/kits';
import { DUEL_RULES, SANDBOX_RULES } from './sim/rules';
import { SIGNATURE_SUMMONERS } from './sim/summoners';
import type { KitId } from './sim/types';
import { augmentPick, floorIntro, pickBots, pickChampion, runEnd, shop, starterItem } from './ui/screens';

installCursors();
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
  stage?.resize();
  renderer.setSize(innerWidth, innerHeight);
});

// Right-click is the game's move/attack button, so the browser menu never opens anywhere in the game
// (HUD, ability bar, menus), not just over the lane. Text fields keep it for copy and paste.
installHoverTips();

addEventListener('contextmenu', (e) => {
  if (!(e.target as HTMLElement | null)?.closest?.('input, textarea')) e.preventDefault();
});

const shell: Shell = {
  renderer, scene, cam, input: new Input(renderer.domElement), marker: new ClickMarker(scene), indicator: new AimIndicator(scene),
};

/** Champion select backdrop; built once the models have loaded (the render loop starts before that). */
let stage: SelectStage | null = null;
/** The duel being played, if any. Between duels the camera drifts over the empty lane behind the menus. */
let duel: Duel | null = null;
let last = performance.now();
let idleT = 0;

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (duel) {
    duel.frame(dt);
  } else if (stage?.active) {
    stage.update(dt);
    stage.render(renderer);
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
bakePortraits();
stage = new SelectStage();
if (import.meta.env.DEV) Object.assign(window, { stage });

const params = new URLSearchParams(location.search);
const asKit = (v: string | null) => (KIT_IDS.includes(v as KitId) ? (v as KitId) : null);
const freePlayKit = asKit(params.get('champ'));

if (freePlayKit) {
  // Free play: the old sandbox, no goals, nexus to win.
  const spells = params.get('spells')?.split(',');
  // Bots never play experimental champions.
  const asked = asKit(params.get('enemy'));
  const enemyKit = (asked && BOT_KIT_IDS.includes(asked) ? asked : null) ?? BOT_KIT_IDS.find((k) => k !== freePlayKit) ?? BOT_KIT_IDS[0];
  // `&augments=…&items=…` (comma-separated ids) start with upgrades, for trying them out.
  const ids = (key: string, known: Record<string, unknown>) => (params.get(key)?.split(',') ?? []).filter((id) => id in known);
  duel = new Duel(shell, {
    seed: Number(params.get('seed') ?? Date.now() % 1e9), rules: SANDBOX_RULES, kit: freePlayKit,
    augments: ids('augments', AUGMENTS), items: ids('items', ITEMS),
    summoners: validSummoners(spells) ? spells : undefined, enemyKit, enemySummoners: SIGNATURE_SUMMONERS[enemyKit], enemyAugments: [], enemyStatMult: 1, enemyAccuracy: 0.8, label: 'Free play', sandbox: true,
  });
} else {
  void runLoop();
}

/** Bot vs bot, just for fun: pick two champions, watch them duel under the run's duel rules, then back home. */
async function watchBots() {
  const pick = await pickBots();
  if (!pick) return;
  duel = new Duel(shell, {
    seed: Date.now() % 1e9, rules: { ...DUEL_RULES }, kit: pick.blue, augments: [], summoners: SIGNATURE_SUMMONERS[pick.blue],
    enemyKit: pick.red, enemyAugments: [], enemySummoners: SIGNATURE_SUMMONERS[pick.red], enemyStatMult: 1, enemyAccuracy: 0.9,
    label: `${KITS[pick.blue].name} vs ${KITS[pick.red].name}`, spectate: true,
  });
  await duel.finished;
  duel.dispose();
  duel = null;
}

/** Champion select → floor intro → duel → augment pick → shop → ... until a loss or the boss falls. */
async function runLoop() {
  let run: RunState | null = loadRun();
  for (;;) {
    if (!run) {
      const s = stage!;
      s.active = true;
      const choice = await pickChampion(loadMeta(), (k) => s.focus(k));
      s.active = false;
      s.focus(null);
      if (choice.mode === 'watch') {
        await watchBots();
        continue;
      }
      run = newRun(choice.kit, Date.now() % 1e9, choice.summoners);
      saveRun(run);
    }
    // A free augment and a free item to start the run.
    if (run.starter === 'augment') {
      const r = run;
      const pick = await augmentPick(r, () => starterAugments(r), () => {
        const ok = reroll(r);
        saveRun(r);
        return ok;
      }, `Starting gift · ${KITS[r.kit].name}`);
      takeStarter(r, pick);
      saveRun(r);
    }
    if (run.starter === 'item') {
      takeStarter(run, await starterItem(run, starterItems(run)));
      saveRun(run);
    }
    if (run.shopping) {
      const r = run;
      await shop(
        r,
        (id) => {
          if (buy(r, id)) saveRun(r);
        },
        (pair) => {
          setSummoners(r, pair);
          saveRun(r);
        },
      );
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
        seed: plan.seed, rules: plan.rules, kit: run.kit, augments: run.augments, ...loadout(run), summoners: runSummoners(run),
        enemyKit: plan.opponent, enemySummoners: plan.opponentSummoners,
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
