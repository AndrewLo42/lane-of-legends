import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/**
 * Meshy-built models (tools/meshy → tools/blender/import_meshy.py → public/assets/meshy/).
 * Everything loads once up front; anything missing just falls back to the primitive placeholders.
 */
const BASE = `${import.meta.env.BASE_URL}assets/meshy/`;

/** Model name → file. Clips inside use the canonical names: Idle, Walk, Attack, Hit, Death. */
export const MODELS = {
  minion_melee: 'MinionMelee.glb',
  minion_caster: 'MinionCaster.glb',
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
 * Meshy's A-pose step drops held props, so some come back as simple meshes held at a hand bone.
 * `build` returns the prop in metres with its grip at the origin, pointing up (+y). The prop follows
 * the hand's position but stays upright with a slight forward `lean` (radians): library clips are
 * made for empty hands, so copying the wrist's rotation makes a staff flop around.
 */
const PROPS: Partial<Record<ModelName, { bone: string; lean: number; build: () => THREE.Object3D }>> = {
  minion_caster: {
    bone: 'LeftHand', // the torch idle and spear walk carry their object in the left hand
    lean: 0.18,
    build: () => {
      const g = new THREE.Group();
      const brass = new THREE.MeshStandardMaterial({ color: 0xb8893a, metalness: 0.7, roughness: 0.35 });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.0, 6), brass);
      shaft.position.y = 0.15;
      const cup = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 6, 1, true), brass);
      cup.position.y = 0.68;
      cup.rotation.x = Math.PI;
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x5fd0ff, emissiveIntensity: 1.4 }));
      crystal.position.y = 0.76;
      crystal.scale.y = 1.6;
      g.add(shaft, cup, crystal);
      return g;
    },
  },
};

/**
 * An independently animatable copy of a model, scaled to `height` metres, facing +x (the sim's
 * facing 0) and tinted for its team.
 */
export function instantiate(name: ModelName, height: number, team: THREE.Color) {
  const gltf = loaded.get(name);
  if (!gltf) return null;
  const model = cloneSkinned(gltf.scene);
  model.updateMatrixWorld(true); // Meshy armatures carry a 0.01 (centimetre) scale; measure with it applied
  const box = new THREE.Box3().setFromObject(model);
  model.scale.setScalar(height / Math.max(0.01, box.max.y - box.min.y));
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
    teamTint(mat, team);
    m.material = mat;
    materials.push(mat);
  });
  const root = new THREE.Group();
  root.add(model);

  const spec = PROPS[name];
  const hand = spec && model.getObjectByName(spec.bone);
  let syncProps = () => {};
  if (spec && hand) {
    const p = spec.build();
    p.scale.setScalar(height / 1.3);
    p.rotation.z = -spec.lean; // top tips toward +x, the way the unit faces
    p.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : null));
    root.add(p);
    const at = new THREE.Vector3();
    syncProps = () => {
      root.updateMatrixWorld(true);
      p.position.copy(root.worldToLocal(hand.getWorldPosition(at)));
    };
    syncProps();
  }
  /** Call after each animation update so held props track their hand. */
  return { root, model, clips: gltf.animations, materials, syncProps };
}
