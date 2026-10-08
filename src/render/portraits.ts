import * as THREE from 'three';
import { KITS, KIT_IDS } from '../sim/kits';
import type { KitId } from '../sim/types';
import { AnimatedModel } from './animatedModel';
import { hasModel, instantiate } from './assets';
import { RIGS } from './rigs';

const SIZE = 256;
/** Data URLs of each champion's bust, baked once the models have loaded. */
const urls = new Map<KitId, string>();

/**
 * Render a head-and-shoulders portrait of every champion that has a model: idle pose, a
 * three-quarter view, lit with a rim in the champion's colour, on a transparent background (the UI
 * draws the backdrop). Uses its own small renderer so the game's canvas and state are untouched.
 */
export function bakePortraits() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x000000, 0);
  try {
    for (const kit of KIT_IDS) {
      const url = bake(renderer, kit);
      if (url) urls.set(kit, url);
    }
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

function bake(renderer: THREE.WebGLRenderer, kit: KitId): string | null {
  const height = 2.5;
  const built = hasModel(`champ_${kit}`) ? instantiate(`champ_${kit}`, height, null) : null;
  if (!built) return null;
  // Just the body: floating props (Tock's pendulum, Lisha's blades) would crowd the frame.
  for (const child of [...built.root.children]) if (child !== built.model) child.visible = false;
  const anim = new AnimatedModel(built.model, built.clips, RIGS.meshy);
  anim.setBase('Idle');
  anim.update(0.4);
  built.root.updateMatrixWorld(true);

  const head = built.model.getObjectByName('Head') ?? built.model.getObjectByName('head');
  const box = new THREE.Box3().setFromObject(built.model);
  const focus = head ? head.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, box.max.y - height * 0.12, 0);
  focus.y += height * 0.01; // the head bone sits at the base of the skull; centre just above it

  const scene = new THREE.Scene();
  scene.add(built.root);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3020, 1.5));
  const key = new THREE.DirectionalLight(0xfff1dc, 2.4);
  key.position.set(focus.x + 3, focus.y + 2, focus.z + 2);
  const rim = new THREE.DirectionalLight(new THREE.Color(KITS[kit].color), 3);
  rim.position.set(focus.x - 3, focus.y + 1, focus.z - 2.5);
  scene.add(key, rim);

  // Champions face +x; look at them from the front, turned a little toward their right.
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
  const span = height * 0.36; // metres of body shown top to bottom
  const d = span / 2 / Math.tan(THREE.MathUtils.degToRad(14));
  const turn = THREE.MathUtils.degToRad(25);
  camera.position.set(focus.x + Math.cos(turn) * d, focus.y + 0.08, focus.z + Math.sin(turn) * d);
  camera.lookAt(focus);

  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  // Geometry is shared with the game's cached models, so leave it be; this renderer's context goes away.
  anim.dispose();
  return url;
}

/** A champion's portrait: the baked bust, or their initial when they have no model yet. */
export function portraitHtml(kit: KitId) {
  const url = urls.get(kit);
  return url ? `<img class="face" src="${url}" alt="${KITS[kit].name}">` : `<b>${KITS[kit].name[0]}</b>`;
}
