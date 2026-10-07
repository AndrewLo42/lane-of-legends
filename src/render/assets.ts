import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/**
 * Meshy-built models (tools/meshy → tools/blender/import_meshy.py → public/assets/meshy/).
 * Everything loads once up front; anything missing just falls back to the primitive placeholders.
 */
const BASE = `${import.meta.env.BASE_URL}assets/meshy/`;

/** Model name → file. Animated models' clips use the canonical names: Idle, Walk, Attack, Attack2, Death. */
export const MODELS = {
  minion_melee: 'MinionMelee.glb',
  minion_caster: 'MinionCaster.glb',
  tower: 'Tower.glb',
  nexus: 'Nexus.glb',
  champ_arlo: 'Arlo.glb',
  champ_tock: 'Tock.glb',
  champ_maren: 'Maren.glb',
} as const;
export type ModelName = keyof typeof MODELS;

const loaded = new Map<ModelName, GLTF>();

export async function loadModels(): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    (Object.entries(MODELS) as [ModelName, string][]).map(async ([name, file]) => {
      try {
        loaded.set(name, await loader.loadAsync(BASE + file));
      } catch {
        // Not built yet (or failed): the placeholder mesh is used instead.
      }
    }),
  );
}

export const hasModel = (name: ModelName) => loaded.has(name);

/**
 * Shader patch that swaps the texture's magenta "team key" for the team colour, keeping the
 * painted shading. Concepts are generated with bright magenta cloth precisely so this can find it.
 */
function teamTint(mat: THREE.MeshStandardMaterial, team: THREE.Color) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTeam = { value: team };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform vec3 uTeam;
        // Magenta (red and blue both well above green) becomes the team colour at the same brightness.
        vec3 teamKey(vec3 c) {
          float key = smoothstep(0.04, 0.16, min(c.r, c.b) - c.g);
          return mix(c, uTeam * (0.35 + 1.1 * max(c.r, c.b)), key);
        }
        void main() {`,
      )
      .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = teamKey(diffuseColor.rgb);')
      // `emissive` already includes emissiveIntensity, so undo it around the key swap.
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance = teamKey(totalEmissiveRadiance / max(emissive, vec3(1e-4))) * emissive;');
  };
  mat.customProgramCacheKey = () => `teamTint-${team.getHexString()}`;
  mat.needsUpdate = true;
}

/**
 * Props the Meshy models don't have (the A-pose step drops held items; champions are generated
 * empty-handed). `build` returns the prop in metres for a model `refHeight` tall, with its grip at
 * the origin and pointing up (+y).
 * - `upright`: follows the hand's position but stays vertical with a forward `lean`. Library clips
 *   are made for empty hands, so a staff copying the wrist would flop around.
 * - `held`: locked to the hand bone so it swings with the wrist like a weapon. At the bind pose it
 *   sits `grip` metres past the wrist (mid-fist) and points along `dir` (root space: +x forward,
 *   +y up, +z the model's right) with the forearm's direction removed, so it always leaves the fist
 *   at a right angle instead of running back through the arm.
 * - `float`: not held at all. It hangs from a glowing pivot at `offset` (root space, metres at
 *   `refHeight`), sways and bobs on its own, and strikes forward on `swingProp()`
 *   (attacks and casts). For hands that can't convincingly grip (Tock's open gauntlets).
 */
type PropSpec = { refHeight: number; build: () => THREE.Object3D } & (
  | { mode: 'upright'; bone: string; lean: number }
  | { mode: 'held'; bone: string; dir: [number, number, number]; grip: number }
  | { mode: 'float'; offset: [number, number, number] }
);

const brass = () => new THREE.MeshStandardMaterial({ color: 0xb8893a, metalness: 0.7, roughness: 0.35 });
const glow = (c: number) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.4 });

/** A gear: a thin disc with teeth around its rim. */
function gear(radius: number, thickness: number, teeth: number, mat: THREE.Material) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, thickness, 24), mat);
  g.add(disc);
  for (let i = 0; i < teeth; i++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.3, thickness, radius * 0.28), mat);
    const a = (i / teeth) * Math.PI * 2;
    t.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    t.rotation.y = -a;
    g.add(t);
  }
  return g;
}

const PROPS: Partial<Record<ModelName, PropSpec>> = {
  minion_caster: {
    bone: 'LeftHand', // the torch idle and spear walk carry their object in the left hand
    mode: 'upright',
    lean: 0.18,
    refHeight: 1.3,
    build: () => {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.0, 6), brass());
      shaft.position.y = 0.15;
      const cup = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 6, 1, true), brass());
      cup.position.y = 0.68;
      cup.rotation.x = Math.PI;
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x5fd0ff, emissiveIntensity: 1.4 }));
      crystal.position.y = 0.76;
      crystal.scale.y = 1.6;
      g.add(shaft, cup, crystal);
      return g;
    },
  },
  // Tock's pendulum blade: a clock pendulum with a sharpened crescent around its bob.
  champ_tock: {
    mode: 'float',
    // Ahead and to his right, pivot above his head: measured clear of his mesh in every clip,
    // through the whole sway and strike (anything closer gets hit by his arms when he runs or casts).
    offset: [1.3, 2.9, 1.5],
    refHeight: 2.8,
    build: () => {
      const g = new THREE.Group();
      const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.8 });
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 8), dark);
      grip.position.y = 0.02;
      const pommel = gear(0.08, 0.05, 8, brass());
      pommel.rotation.x = Math.PI / 2;
      pommel.position.y = -0.22;
      const guard = gear(0.16, 0.06, 10, brass());
      guard.position.y = 0.26;
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 16), glow(0x5fd0c4));
      core.position.y = 0.26;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.85, 8), brass());
      shaft.position.y = 0.7;
      // The bob: a brass disc, edge-on to the swing so it cuts with its rim.
      const bob = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 28), brass());
      bob.rotation.z = Math.PI / 2;
      bob.position.y = 1.35;
      const face = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.07, 24), glow(0x5fd0c4));
      face.rotation.z = Math.PI / 2;
      face.position.y = 1.35;
      // Crescent blade around the far half of the bob, glowing at the edge.
      const outer = 0.48;
      const inner = 0.3;
      const shape = new THREE.Shape();
      shape.absarc(0, 0, outer, -Math.PI * 0.15, Math.PI * 1.15, false);
      shape.absarc(0, 0.08, inner, Math.PI * 1.15, -Math.PI * 0.15, true);
      const blade = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.02, bevelSegments: 1, curveSegments: 24 }),
        new THREE.MeshStandardMaterial({ color: 0xbfe9e4, metalness: 0.8, roughness: 0.25, emissive: 0x2a8f86, emissiveIntensity: 0.6 }),
      );
      blade.rotation.y = Math.PI / 2; // into the same plane as the bob
      blade.position.set(0.015, 1.35, 0);
      g.add(grip, pommel, guard, core, shaft, bob, face, blade);
      return g;
    },
  },
};

/**
 * An independently animatable copy of a model, scaled to `height` metres, facing +x (the sim's
 * facing 0). With a `team` colour, its magenta key cloth is tinted (champions keep their own colours).
 */
export function instantiate(name: ModelName, height: number, team: THREE.Color | null) {
  const gltf = loaded.get(name);
  if (!gltf) return null;
  const model = cloneSkinned(gltf.scene);
  model.updateMatrixWorld(true); // Meshy armatures carry a 0.01 (centimetre) scale; measure with it applied
  const box = new THREE.Box3().setFromObject(model);
  const k = height / Math.max(0.01, box.max.y - box.min.y);
  model.scale.setScalar(k);
  // Stand it on the ground and centre it: not every Meshy export has its origin at the feet.
  const centre = box.getCenter(new THREE.Vector3());
  model.position.set(-centre.z * k, -box.min.y * k, centre.x * k); // (after the quarter turn below)
  model.rotation.y = Math.PI / 2; // Meshy models face +z
  const materials: THREE.MeshStandardMaterial[] = [];
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.frustumCulled = false; // skinned bounds don't follow animation
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    // Lift the painted albedo a little so small units read from the MOBA camera.
    mat.emissive.set(0xffffff);
    mat.emissiveMap = mat.map;
    mat.emissiveIntensity = 0.3;
    if (team) teamTint(mat, team);
    m.material = mat;
    materials.push(mat);
  });
  const root = new THREE.Group();
  root.add(model);

  const spec = PROPS[name];
  /** Prop scale: props are built for a model `refHeight` tall. */
  const ps = spec ? height / spec.refHeight : 1;
  /** Call after each animation update (with the frame's dt) so props track their hand or keep floating. */
  let syncProps: (dt?: number) => void = () => {};
  /** Kick a floating prop into a swing (attacks and casts); a no-op for other props. */
  let swingProp = () => {};
  const hand = spec && spec.mode !== 'float' ? model.getObjectByName(spec.bone) : undefined;
  if (spec) {
    const p = spec.build();
    p.scale.setScalar(ps);
    p.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : null));
    root.updateMatrixWorld(true);
    const at = new THREE.Vector3();
    if (spec.mode === 'float') {
      // Hang it upside down from a pivot (bob below), with a spinning clockwork halo selling the magic.
      const pivot = new THREE.Group();
      const [ox, oy, oz] = spec.offset;
      pivot.position.set(ox * ps, oy * ps, oz * ps);
      p.rotation.z = Math.PI;
      p.position.y = 0.25 * ps; // grip end just above the pivot
      const halo = gear(0.13, 0.025, 10, new THREE.MeshStandardMaterial({ color: 0x5fd0c4, emissive: 0x5fd0c4, emissiveIntensity: 1.6 }));
      halo.scale.setScalar(ps);
      halo.rotation.x = Math.PI / 2;
      pivot.add(p, halo);
      root.add(pivot);
      let t = Math.random() * 10;
      let swingT = Infinity;
      syncProps = (dt = 0) => {
        t += dt;
        swingT += dt;
        // A slow forward-back sway, plus a fast strike for ~0.45 s after a swing: rotating about the
        // pivot's z axis tips the bob forward (+x), toward the target and away from his body.
        const strike = swingT < 0.45 ? Math.sin((swingT / 0.45) * Math.PI) * 1.5 : 0;
        pivot.rotation.z = Math.sin(t * 1.7) * 0.25 + strike;
        pivot.position.y = (oy + Math.sin(t * 2.3) * 0.05) * ps;
        halo.rotation.z += dt * 3;
      };
      swingProp = () => (swingT = 0);
    } else if (spec.mode === 'held' && hand) {
      // At the bind pose: forearm direction (elbow → wrist), the grip mid-fist along it, and the
      // blade pointing along `dir` made perpendicular to it. Then hand it to the bone (attach keeps
      // the world transform).
      const wrist = hand.getWorldPosition(at);
      const elbow = (hand.parent ?? hand).getWorldPosition(new THREE.Vector3());
      const fore = wrist.clone().sub(elbow).normalize();
      const dir = new THREE.Vector3(...spec.dir).normalize();
      dir.addScaledVector(fore, -dir.dot(fore)).normalize();
      p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      p.position.copy(wrist).addScaledVector(fore, spec.grip * ps);
      hand.attach(p);
    } else if (spec.mode === 'upright' && hand) {
      p.rotation.z = -spec.lean; // top tips toward +x, the way the unit faces
      root.add(p);
      syncProps = () => {
        root.updateMatrixWorld(true);
        p.position.copy(root.worldToLocal(hand.getWorldPosition(at)));
      };
      syncProps();
    }
  }
  return { root, model, clips: gltf.animations, materials, syncProps, swingProp };
}
