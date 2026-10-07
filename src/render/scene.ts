import * as THREE from 'three';
import { LANE } from '../sim/lane';
import { KITS } from '../sim/kits';
import type { Team, Unit, Vec2 } from '../sim/types';

/** Sim (x, y) -> three.js (x, 0, z). */
export const toV3 = (p: Vec2, h = 0) => new THREE.Vector3(p.x, h, p.y);

export const TEAM_COLOR: Record<Team, number> = { blue: 0x3d8bff, red: 0xff4a3d };

/** Ground, walls and lights for the single lane. */
export function buildArena(scene: THREE.Scene) {
  scene.background = new THREE.Color(0x10141a);
  scene.fog = new THREE.Fog(0x10141a, 60, 120);

  scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x3a3020, 1.2));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(-20, 40, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -70; s.right = 70; s.top = 30; s.bottom = -30; s.far = 120;
  scene.add(sun);

  const L = LANE.halfLength;
  const W = LANE.halfWidth;

  // Grass outside the lane, dirt path inside.
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(L * 2 + 40, W * 2 + 40), new THREE.MeshStandardMaterial({ color: 0x2f4a2a }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.01;
  grass.receiveShadow = true;
  scene.add(grass);

  const path = new THREE.Mesh(new THREE.PlaneGeometry(L * 2, W * 2), new THREE.MeshStandardMaterial({ color: 0x7a6748 }));
  path.rotation.x = -Math.PI / 2;
  path.receiveShadow = true;
  scene.add(path);

  // Low rock walls along both edges.
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x55585f, flatShading: true });
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(L * 2 + 4, 1.6, 1.2), wallMat);
    wall.position.set(0, 0.8, side * (W + 0.6));
    wall.castShadow = wall.receiveShadow = true;
    scene.add(wall);
  }

  // Team-tinted base pads under each nexus.
  for (const [team, x] of [['blue', -LANE.nexusX], ['red', LANE.nexusX]] as const) {
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(5, 40),
      new THREE.MeshStandardMaterial({ color: TEAM_COLOR[team], transparent: true, opacity: 0.18 }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(x, 0.01, 0);
    scene.add(pad);
  }
}

/** Placeholder meshes until the Meshy models land. Origin at the feet, facing +x. */
export function placeholderFor(u: Unit): THREE.Object3D {
  const color = TEAM_COLOR[u.team];
  const mat = new THREE.MeshStandardMaterial({ color, flatShading: true });
  const g = new THREE.Group();
  switch (u.kind) {
    case 'champion':
      g.add(championPlaceholder(u, mat));
      break;
    case 'minion': {
      const body = u.role === 'melee'
        ? new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.8, 0.75), mat)
        : new THREE.Mesh(new THREE.ConeGeometry(u.radius, 1.0, 6), mat);
      body.position.y = u.role === 'melee' ? 0.4 : 0.5;
      g.add(body);
      if (u.role === 'caster') {
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2 }));
        orb.position.set(0.3, 1.1, 0);
        g.add(orb);
      }
      break;
    }
    case 'tower': {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(u.radius, u.radius * 1.2, 4, 8), new THREE.MeshStandardMaterial({ color: 0x8a8d96, flatShading: true }));
      base.position.y = 2;
      const top = new THREE.Mesh(new THREE.ConeGeometry(u.radius * 1.1, 1.8, 8), mat);
      top.position.y = 4.9;
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5 }));
      crystal.position.y = 6.4;
      g.add(base, top, crystal);
      break;
    }
    case 'nexus': {
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(u.radius * 0.9), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, flatShading: true }));
      core.position.y = u.radius + 0.6;
      core.name = 'spin';
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(u.radius, u.radius * 1.15, 0.6, 10), new THREE.MeshStandardMaterial({ color: 0x8a8d96, flatShading: true }));
      plinth.position.y = 0.3;
      g.add(core, plinth);
      break;
    }
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
  });
  return g;
}

/** Champion stand-ins: Arlo is a slim capsule with a glowing gauntlet, Tock a squat clockwork knight with a scythe. */
function championPlaceholder(u: Unit, teamMat: THREE.Material) {
  const g = new THREE.Group();
  const accent = new THREE.Color(KITS[u.champ!.kit].color);
  const glow = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.8 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8b2a2, metalness: 0.6, roughness: 0.35, flatShading: true });
  if (u.champ!.kit === 'maren') {
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.6, 10), teamMat);
    robe.position.y = 0.8;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), new THREE.MeshStandardMaterial({ color: 0xc9a27e }));
    head.position.y = 1.8;
    const hair = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.9, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0x1f4f6a, side: THREE.DoubleSide }));
    hair.position.y = 1.75;
    hair.rotation.x = Math.PI;
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x6b4a32 }));
    staff.position.set(0.15, 1.1, 0.62);
    const coral = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22), glow);
    coral.position.set(0.15, 2.3, 0.62);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshStandardMaterial({ color: 0x7fe0ff, emissive: 0x7fe0ff, emissiveIntensity: 1.2 }));
    orb.position.set(0.15, 2.55, 0.62);
    g.add(robe, head, hair, staff, coral, orb);
  } else if (u.champ!.kit === 'arlo') {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.0, 4, 12), teamMat);
    body.position.y = 0.92;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), new THREE.MeshStandardMaterial({ color: 0xf0d2b0 }));
    head.position.y = 1.95;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.31, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8b84a }));
    hair.position.y = 2.0;
    const gauntlet = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), glow);
    gauntlet.position.set(0.35, 1.1, 0.42);
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.08, 6, 16), new THREE.MeshStandardMaterial({ color: 0x8a3b2e }));
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 1.65;
    g.add(body, head, hair, gauntlet, scarf);
  } else {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 1.3, 8), teamMat);
    body.position.y = 0.85;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), metal);
    head.position.y = 1.8;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.36), glow);
    visor.position.set(0.26, 1.82, 0);
    const gear = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.1, 6, 12), glow);
    gear.rotation.x = Math.PI / 2;
    gear.position.y = 1.15;
    gear.name = 'gear';
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.2, 0.08), metal);
    shaft.position.set(0.15, 1.2, 0.7);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.05), glow);
    blade.position.set(0.6, 2.25, 0.7);
    blade.rotation.z = -0.25;
    g.add(body, head, visor, gear, shaft, blade);
  }
  return g;
}

/** The green "move here" marker that shrinks away after a right click. */
export class ClickMarker {
  readonly mesh: THREE.Mesh;
  private age = 1;

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.5, 24),
      new THREE.MeshBasicMaterial({ color: 0x6dff7a, transparent: true, depthWrite: false }),
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  show(at: THREE.Vector3) {
    this.mesh.position.set(at.x, 0.03, at.z);
    this.age = 0;
  }

  update(dt: number) {
    this.age += dt;
    const t = Math.min(1, this.age / 0.35);
    this.mesh.visible = t < 1;
    this.mesh.scale.setScalar(1.4 - t * 0.9);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t;
  }
}
