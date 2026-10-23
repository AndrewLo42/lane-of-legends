import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LANE } from '../sim/lane';

/**
 * The lane's scenery, all procedural and seeded so it's the same every game: a mottled dirt path worn
 * paler down the middle, stone walls of uneven blocks under capstones with moss and ivy, pillars every
 * 12 m (on the far wall each carries a banner in the colour of the half it stands in and a brazier), and
 * outside the walls grass, flowers, rocks and a pine wood. The camera looks across the lane from the +z
 * side, so anything tall goes on the far (-z) side, where it can't hide the lane, and the near side
 * keeps to knee height.
 */
export function buildScenery(scene: THREE.Scene, teamColors: { blue: number; red: number }) {
  const fires: Fire[] = [];
  const rand = mulberry32(0x1a4e);
  const L = LANE.halfLength;
  const W = LANE.halfWidth;
  ground(scene, L, W);
  walls(scene, L, W, rand, teamColors, fires);
  outside(scene, L, W, rand);
  return {
    /** Flicker the braziers; `t` in seconds. */
    update(t: number) {
      for (const f of fires) {
        // Layered noise at a few rates: a slow breathing, a quicker waver, and the odd sharp flare.
        const k = 0.55 * noise(t * 1.3 + f.phase, f.phase) + 0.3 * noise(t * 5.5, f.phase * 3) + 0.15 * noise(t * 13, f.phase * 7);
        f.light.intensity = 9 + 16 * k;
        f.outer.scale.set(0.9 + k * 0.2, 0.75 + k * 0.55, 0.9 + k * 0.2);
        f.core.scale.set(1, 0.7 + noise(t * 9, f.phase + 5) * 0.6, 1);
        f.outer.rotation.z = (noise(t * 2.2, f.phase + 9) - 0.5) * 0.25;
        f.outer.rotation.x = (noise(t * 2.6, f.phase + 11) - 0.5) * 0.2;
        (f.outer.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.6 + k * 1.6;
        f.light.position.y = f.baseY + k * 0.15;
      }
    },
  };
}

const WALL_DEPTH = 1.2;
/** Top of the capstones. */
const WALL_TOP = 1.66;
const PILLAR_XS = Array.from({ length: 10 }, (_, k) => -54 + 12 * k);

function ground(scene: THREE.Scene, L: number, W: number) {
  const tint = (geo: THREE.BufferGeometry, colorAt: (x: number, z: number, out: THREE.Color) => void) => {
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      colorAt(pos.getX(i), pos.getZ(i), c);
      c.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });

  const grassGeo = new THREE.PlaneGeometry(L * 2 + 80, W * 2 + 80, 140, 60).rotateX(-Math.PI / 2);
  const lush = new THREE.Color(0x2f4a2a), bright = new THREE.Color(0x3f6131), dry = new THREE.Color(0x56603a);
  tint(grassGeo, (x, z, c) => {
    const n = fbm(x * 0.08, z * 0.08);
    c.copy(lush).lerp(bright, smooth(0.35, 0.75, n)).lerp(dry, smooth(0.6, 0.9, fbm(x * 0.03 + 7, z * 0.03)) * 0.6);
  });
  const grass = new THREE.Mesh(grassGeo, mat);
  grass.position.y = -0.01;
  grass.receiveShadow = true;
  scene.add(grass);

  const pathGeo = new THREE.PlaneGeometry(L * 2, W * 2, 200, 28).rotateX(-Math.PI / 2);
  const dirt = new THREE.Color(0x7a6748), dark = new THREE.Color(0x5c4c35), pale = new THREE.Color(0x96805a), moss = new THREE.Color(0x4f5a34);
  tint(pathGeo, (x, z, c) => {
    c.copy(dirt).lerp(dark, smooth(0.45, 0.85, fbm(x * 0.25, z * 0.25)) * 0.7);
    // Worn paler where the waves march: a broad band down the middle, streaked along the lane.
    const worn = Math.exp(-((z / 3.2) ** 2)) * (0.45 + 0.4 * fbm(x * 0.6, z * 2.5));
    c.lerp(pale, worn);
    // Grass creeping in at the foot of the walls.
    c.lerp(moss, smooth(W - 1.6, W, Math.abs(z)) * (0.4 + 0.5 * fbm(x * 0.4 + 3, z)));
  });
  const path = new THREE.Mesh(pathGeo, mat);
  path.receiveShadow = true;
  scene.add(path);

  // Pebbles scattered over the path, more of them toward the edges.
  const rand = mulberry32(0x9e66);
  const pebbles = instanced(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), 420);
  const greys = [0x7d756a, 0x8a8478, 0x6a6258, 0x9a9182];
  for (let i = 0; i < 420; i++) {
    const z = (rand() < 0.5 ? 1 : -1) * (W - 0.3) * (1 - rand() ** 1.6);
    const s = 0.05 + rand() ** 2 * 0.16;
    pebbles.put(rand() * L * 2 - L, s * 0.25, z, s, s * 0.55, s * (0.8 + rand() * 0.5), rand() * Math.PI, greys[(rand() * greys.length) | 0], 0.85 + rand() * 0.3);
  }
  scene.add(pebbles.done(false, true));
}

interface Fire { light: THREE.PointLight; outer: THREE.Mesh; core: THREE.Mesh; phase: number; baseY: number }

function walls(scene: THREE.Scene, L: number, W: number, rand: () => number, teamColors: { blue: number; red: number }, fires: Fire[]) {
  const stoneMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
  const blocks = instanced(new THREE.BoxGeometry(1, 1, 1), stoneMat, 900);
  const greys = [0x5d6068, 0x686b72, 0x50535a, 0x73716a, 0x5a5650, 0x63605a];
  const grey = () => greys[(rand() * greys.length) | 0];
  const end = L + 2;

  for (const side of [-1, 1]) {
    const zc = side * (W + WALL_DEPTH / 2);
    // Three courses of uneven blocks, the joints staggered, each block nudged a little in and out.
    let y = 0;
    [0.55, 0.5, 0.45].forEach((h, course) => {
      let x = -end - (course % 2 ? 0.6 : 0);
      while (x < end) {
        const len = Math.min(1.1 + rand() * 1.1, end - x);
        if (len > 0.3) {
          blocks.put(x + len / 2, y + h / 2, zc + (rand() - 0.5) * 0.1, len - 0.06, h - 0.05, WALL_DEPTH - course * 0.04 + rand() * 0.06,
            (rand() - 0.5) * 0.04, grey(), 0.9 + rand() * 0.2);
        }
        x += len;
      }
      y += h;
    });
    // Capstones: flat slabs, a little wider than the wall.
    for (let x = -end; x < end;) {
      const len = Math.min(1.6 + rand() * 0.9, end - x);
      if (len > 0.3) blocks.put(x + len / 2, y + 0.08, zc, len - 0.05, 0.16, WALL_DEPTH + 0.22, (rand() - 0.5) * 0.03, 0x7a7c80, 0.95 + rand() * 0.15);
      x += len;
    }
    // Pillars, taller on the far side; a plinth, a shaft and a cap.
    const tall = side < 0 ? 2.9 : 1.9;
    for (const x of PILLAR_XS) {
      blocks.put(x, 0.2, zc, 1.75, 0.4, 1.75, 0, 0x5a5c62, 1);
      blocks.put(x, tall / 2, zc, 1.45, tall, 1.45, 0, grey(), 1.05);
      blocks.put(x, tall + 0.12, zc, 1.8, 0.24, 1.8, 0, 0x7a7c80, 1);
    }
  }
  scene.add(blocks.done(true, true));

  // Moss on the capstones and pillar caps.
  const mossMat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
  const moss = instanced(new THREE.IcosahedronGeometry(1, 0), mossMat, 260);
  const greens = [0x4f6b35, 0x5d7a3a, 0x445e2e, 0x6a8442];
  for (const side of [-1, 1]) {
    const zc = side * (W + WALL_DEPTH / 2);
    for (let i = 0; i < 110; i++) {
      moss.put(rand() * end * 2 - end, WALL_TOP, zc + (rand() - 0.5) * 0.9, 0.14 + rand() * 0.26, 0.04 + rand() * 0.04, 0.1 + rand() * 0.18,
        rand() * Math.PI, greens[(rand() * greens.length) | 0], 0.9 + rand() * 0.2);
    }
    for (const x of PILLAR_XS) {
      if (rand() < 0.6) moss.put(x + (rand() - 0.5) * 0.8, (side < 0 ? 2.9 : 1.9) + 0.24, zc + (rand() - 0.5) * 0.8, 0.25, 0.05, 0.2, rand() * 3, greens[0], 1);
    }
  }
  scene.add(moss.done(false, true));

  // Ivy hanging down the faces the camera sees: the far wall's lane side and the near wall's outer side.
  const ivy = instanced(new THREE.BoxGeometry(1, 1, 1), mossMat, 90);
  for (const [face, n] of [[-W + 0.1, 50], [W + WALL_DEPTH + 0.15, 40]] as const) {
    for (let i = 0; i < n; i++) {
      const h = 0.35 + rand() ** 1.5 * 1.1;
      ivy.put(rand() * end * 2 - end, WALL_TOP - 0.04 - h / 2, face, 0.2 + rand() * 0.45, h, 0.04, 0, greens[(rand() * greens.length) | 0], 0.8 + rand() * 0.25);
    }
  }
  scene.add(ivy.done(false, true));

  // Rubble along the foot of the walls, inside the lane.
  const rubble = instanced(new THREE.DodecahedronGeometry(1, 0), stoneMat, 200);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 100; i++) {
      const s = 0.1 + rand() ** 2 * 0.25;
      rubble.put(rand() * L * 2 - L, s * 0.3, side * (W - 0.05 - rand() * 0.35), s, s * 0.7, s, rand() * Math.PI, grey(), 1 + rand() * 0.2);
    }
  }
  scene.add(rubble.done(true, true));

  // Far-wall pillars: a banner on the lane side in the colour of that half, and a brazier on top.
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.6, roughness: 0.4 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2b2a2c, metalness: 0.5, roughness: 0.6, flatShading: true });
  const outerGeo = new THREE.ConeGeometry(0.24, 0.55, 7).translate(0, 0.27, 0);
  const coreGeo = new THREE.ConeGeometry(0.12, 0.32, 6).translate(0, 0.16, 0);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff0b0 });
  const banner = bannerGeometry(0.95, 1.55);
  const emblem = new THREE.CircleGeometry(0.2, 6);
  const faceZ = -W - WALL_DEPTH / 2 + 1.45 / 2;
  for (const x of PILLAR_XS) {
    const color = x < 0 ? teamColors.blue : teamColors.red;
    const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.75), roughness: 0.85, side: THREE.DoubleSide });
    const b = new THREE.Mesh(banner, cloth);
    b.position.set(x, 2.55, faceZ + 0.03);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.15, 6).rotateZ(Math.PI / 2), gold);
    rod.position.set(x, 2.58, faceZ + 0.06);
    const mark = new THREE.Mesh(emblem, gold);
    mark.position.set(x, 2.0, faceZ + 0.045);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.2, 0.3, 8), iron);
    bowl.position.set(x, 2.9 + 0.24 + 0.15, -W - WALL_DEPTH / 2);
    // The flames grow from the bowl's rim; each has its own material so it can flicker on its own.
    const rim = bowl.position.y + 0.12;
    const outer = new THREE.Mesh(outerGeo, new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff7a1a, emissiveIntensity: 2.2, transparent: true, opacity: 0.92 }));
    outer.position.set(x, rim, bowl.position.z);
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.copy(outer.position);
    const light = new THREE.PointLight(0xff8a3a, 15, 10, 2);
    light.position.set(x, rim + 0.35, bowl.position.z + 0.9);
    b.castShadow = bowl.castShadow = true;
    scene.add(b, rod, mark, bowl, outer, core, light);
    fires.push({ light, outer, core, phase: x * 0.37 + 11, baseY: light.position.y });
  }
}

function outside(scene: THREE.Scene, L: number, W: number, rand: () => number) {
  const outer = W + WALL_DEPTH + 0.3;
  // Somewhere on the grass outside the walls: far side (-z) or near side (+z), or past the lane's ends.
  const spot = (near: boolean, depth: number) => {
    const x = rand() * (L * 2 + 40) - L - 20;
    const z = outer + rand() * depth;
    return { x, z: near ? z : -z };
  };

  // Grass tufts: a few blades each.
  const blade = new THREE.ConeGeometry(0.05, 0.42, 3).translate(0, 0.21, 0);
  const tuftGeo = mergeGeometries([0, 1, 2].map((i) => blade.clone().rotateZ((i - 1) * 0.35).translate((i - 1) * 0.05, 0, (i % 2) * 0.04)));
  const tufts = instanced(tuftGeo, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), 2200);
  const greens = [0x3e6a2e, 0x4c7a34, 0x5e8a3a, 0x6b7f3a];
  for (let i = 0; i < 2200; i++) {
    const p = spot(i % 2 === 0, 24);
    const s = 0.7 + rand() * 0.8;
    tufts.put(p.x, 0, p.z, s, s * (0.7 + rand() * 0.6), s, rand() * Math.PI * 2, greens[(rand() * greens.length) | 0], 0.9 + rand() * 0.2);
  }
  scene.add(tufts.done(false, false));

  // Flowers among them.
  const flowers = instanced(new THREE.IcosahedronGeometry(0.08, 0), new THREE.MeshStandardMaterial({ roughness: 0.7 }), 360);
  const petals = [0xf4e27a, 0xf2f0e6, 0xb48ad8, 0xf0a0b8];
  for (let i = 0; i < 360; i++) {
    const p = spot(i % 2 === 0, 18);
    flowers.put(p.x, 0.3 + rand() * 0.15, p.z, 1, 0.8, 1, 0, petals[(rand() * petals.length) | 0], 1);
  }
  scene.add(flowers.done(false, false));

  // Rocks: big ones on the far side, small on the near side.
  const rocks = instanced(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), 90);
  const greys = [0x6a6c70, 0x5b5d61, 0x77766f];
  for (let i = 0; i < 90; i++) {
    const near = i % 3 === 0;
    const p = spot(near, near ? 14 : 24);
    const s = near ? 0.25 + rand() * 0.35 : 0.4 + rand() * 1.1;
    rocks.put(p.x, s * 0.25, p.z, s * (1 + rand() * 0.6), s * (0.55 + rand() * 0.3), s, rand() * Math.PI, greys[(rand() * greys.length) | 0], 0.9 + rand() * 0.2);
  }
  scene.add(rocks.done(true, true));

  // Bushes, low enough for the near side.
  const bushes = instanced(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), 70);
  for (let i = 0; i < 70; i++) {
    const p = spot(i % 2 === 0, 16);
    const s = 0.45 + rand() * 0.45;
    bushes.put(p.x, s * 0.45, p.z, s * (1 + rand() * 0.5), s * 0.75, s, rand() * Math.PI, [0x355a2a, 0x3f6630, 0x2e4f26][(rand() * 3) | 0], 0.9 + rand() * 0.2);
  }
  scene.add(bushes.done(true, false));

  // Pines on the far side, and past both ends of the lane.
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 1.4, 6).translate(0, 0.7, 0);
  const crownGeo = mergeGeometries([
    new THREE.ConeGeometry(1.35, 2.0, 7).translate(0, 2.0, 0),
    new THREE.ConeGeometry(1.05, 1.7, 7).translate(0, 2.9, 0),
    new THREE.ConeGeometry(0.7, 1.4, 7).translate(0, 3.7, 0),
  ]);
  const N = 120;
  const trunks = instanced(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a3e28, roughness: 1, flatShading: true }), N);
  const crowns = instanced(crownGeo, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), N);
  const pine = [0x24402a, 0x2c4a2e, 0x1f3826, 0x335233];
  for (let i = 0; i < N; i++) {
    let x: number, z: number;
    if (i < 90) {
      x = rand() * (L * 2 + 40) - L - 20;
      z = -(outer + 1.5 + rand() ** 0.7 * 26);
    } else {
      x = (i % 2 ? 1 : -1) * (L + 4 + rand() * 18);
      z = rand() * 40 - 20;
    }
    const s = 0.8 + rand() * 0.75;
    const yaw = rand() * Math.PI;
    trunks.put(x, 0, z, s, s, s, yaw, 0xffffff, 1);
    crowns.put(x, 0, z, s, s * (0.9 + rand() * 0.3), s, yaw, pine[(rand() * pine.length) | 0], 0.85 + rand() * 0.3);
  }
  scene.add(trunks.done(true, false), crowns.done(true, false));
}

/** A hanging banner with a swallowtail, its top edge at y = 0. */
function bannerGeometry(w: number, h: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, -h);
  s.lineTo(0, -h + 0.32);
  s.lineTo(-w / 2, -h);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

/** An InstancedMesh filled one transform at a time: position, scale, yaw, colour and a brightness jitter. */
function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, max: number) {
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  const p = new THREE.Vector3(), s = new THREE.Vector3();
  let n = 0;
  return {
    put(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, color: number, shade: number) {
      if (n >= max) return;
      e.set(0, yaw, 0);
      m.compose(p.set(x, y, z), q.setFromEuler(e), s.set(sx, sy, sz));
      mesh.setMatrixAt(n, m);
      mesh.setColorAt(n, c.set(color).multiplyScalar(shade));
      n++;
    },
    done(castShadow: boolean, receiveShadow: boolean) {
      mesh.count = n;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.computeBoundingSphere();
      return mesh;
    },
  };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(i: number, j: number) {
  let n = Math.imul(i, 374761393) + Math.imul(j, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
function noise(x: number, y: number) {
  const i = Math.floor(x), j = Math.floor(y);
  const fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number) {
  return noise(x, y) * 0.6 + noise(x * 2.1, y * 2.1) * 0.28 + noise(x * 4.3, y * 4.3) * 0.12;
}

function smooth(a: number, b: number, t: number) {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
}
