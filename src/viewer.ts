import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AnimatedModel } from './render/animatedModel';
import { MODELS, hasModel, instantiate, loadModels, type ModelName } from './render/assets';
import { RIGS } from './render/rigs';
import { TEAM_COLOR } from './render/scene';

/**
 * Dev-only model viewer (/viewer.html): one Meshy model up close with its runtime props and team
 * tint, a button per clip, slow-motion and a team toggle. For judging rigs and prop placement,
 * which the game camera is too far away to show.
 */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x3a3f47);
scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x3a3020, 1.4));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
sun.position.set(3, 6, 4);
scene.add(sun);
const floor = new THREE.Mesh(new THREE.CircleGeometry(2, 40), new THREE.MeshStandardMaterial({ color: 0x7a6748 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 50);
camera.position.set(2.2, 1.4, 2.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.7, 0);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

await loadModels();
const params = new URLSearchParams(location.search);
const names = (Object.keys(MODELS) as ModelName[]).filter(hasModel);
let name = (params.get('model') as ModelName) ?? names[0];
let team: 'blue' | 'red' = 'blue';
let speed = 1;
let current: { root: THREE.Object3D; anim: AnimatedModel; syncProps: (dt?: number) => void; swingProp: () => void } | null = null;
let clip = 'Idle';
let swingClock = 0;

const ui = document.getElementById('ui')!;

function load() {
  if (current) {
    scene.remove(current.root);
    current.anim.dispose();
  }
  const built = instantiate(name, 1.4, new THREE.Color(TEAM_COLOR[team]));
  if (!built) return;
  built.root.rotation.y = -Math.PI / 4; // three-quarter view to start
  scene.add(built.root);
  current = { root: built.root, anim: new AnimatedModel(built.model, built.clips, RIGS.meshy), syncProps: built.syncProps, swingProp: built.swingProp };
  play(clip, built.clips.map((c) => c.name));
}

function play(c: string, clips?: string[]) {
  clip = c;
  if (!current) return;
  // Loop everything as a base clip so one-shots (attacks, death) can be watched repeatedly.
  current.anim.stopOverlay();
  current.anim.setBase(c);
  if (clips) render(clips);
}

function render(clips: string[]) {
  const btn = (label: string, on: boolean, action: string) => `<button class="${on ? 'on' : ''}" data-a="${action}">${label}</button>`;
  ui.innerHTML = `
    <div>${names.map((n) => btn(n, n === name, `m:${n}`)).join('')}</div>
    <div>${clips.map((c) => btn(c, c === clip, `c:${c}`)).join('')}</div>
    <div>${btn('blue', team === 'blue', 't:blue')}${btn('red', team === 'red', 't:red')}
      ${[0.25, 0.5, 1].map((s) => btn(`${s}×`, s === speed, `s:${s}`)).join('')}</div>`;
}

ui.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
  if (!a) return;
  const [k, v] = [a.slice(0, 1), a.slice(2)];
  if (k === 'm') name = v as ModelName;
  if (k === 't') team = v as 'blue' | 'red';
  if (k === 's') speed = Number(v);
  if (k === 'c') clip = v;
  load();
});

load();
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000) * speed;
  last = now;
  current?.anim.update(dt);
  current?.syncProps(dt);
  // Swing floating props each time an attack or cast clip loops round.
  if (current && /^(Attack|Cast)/.test(clip)) {
    const len = current.anim.clip(clip)?.duration ?? 1;
    swingClock += dt;
    if (swingClock >= len) {
      swingClock -= len;
      current.swingProp();
    }
  }
  controls.update();
  renderer.render(scene, camera);
});

if (import.meta.env.DEV) Object.assign(window, { viewer: { get current() { return current; }, play } });
