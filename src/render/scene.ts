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
    case 'pet':
      g.add(thistlePlaceholder(mat));
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

/**
 * Thistle, Pip's giant anxious toad: a squat green body, bulging eyes, a pale belly and a ridge of
 * thistle spikes down his back, with a collar in his team's colour. Facing +x.
 */
function thistlePlaceholder(teamMat: THREE.Material) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x5f8f4a, flatShading: true });
  const belly = new THREE.MeshStandardMaterial({ color: 0xd8d29a, flatShading: true });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.85, 14, 10), skin);
  body.scale.set(1.1, 0.62, 1);
  body.position.y = 0.55;
  const under = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), belly);
  under.scale.set(1, 0.45, 0.85);
  under.position.set(0.15, 0.38, 0);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.07, 6, 16), teamMat);
  collar.rotation.y = Math.PI / 2;
  collar.position.set(0.55, 0.62, 0);
  g.add(body, under, collar);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf2e6a0 }));
    eye.position.set(0.55, 0.95, side * 0.38);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    pupil.position.set(0.72, 0.97, side * 0.38);
    const leg = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), skin);
    leg.scale.set(1.3, 0.6, 0.8);
    leg.position.set(-0.45, 0.22, side * 0.72);
    g.add(eye, pupil, leg);
  }
  const spike = new THREE.MeshStandardMaterial({ color: 0x8d5aa8, flatShading: true });
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.32, 5), spike);
    s.position.set(-0.55 + i * 0.28, 0.98 - Math.abs(i - 1.5) * 0.05, 0);
    s.rotation.z = 0.35;
    g.add(s);
  }
  return g;
}

/** Champion stand-ins: Arlo is a slim capsule with a glowing gauntlet, Tock a squat clockwork knight with a scythe. */
function championPlaceholder(u: Unit, teamMat: THREE.Material) {
  const g = new THREE.Group();
  const accent = new THREE.Color(KITS[u.champ!.kit].color);
  const glow = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.8 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8b2a2, metalness: 0.6, roughness: 0.35, flatShading: true });
  if (u.champ!.kit === 'fennick') {
    // Fennick: a lean tinker in a green coat and goggles, a satchel in his team's colour, a quiver of three
    // coloured arrows, and a mechanical bow whose nocked arrowhead glows the next arrow's colour (views.ts).
    const coat = new THREE.MeshStandardMaterial({ color: 0x3f6b55, roughness: 0.8, flatShading: true });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 1.3, 8), coat);
    body.position.y = 0.95;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10), new THREE.MeshStandardMaterial({ color: 0xe6c3a0 }));
    head.position.y = 1.85;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), new THREE.MeshStandardMaterial({ color: 0xc0632e, flatShading: true }));
    hair.position.y = 1.9;
    const goggles = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.04, 6, 18), metal);
    goggles.rotation.x = Math.PI / 2;
    goggles.position.y = 1.98;
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.86), teamMat);
    strap.position.set(0, 1.25, 0);
    strap.rotation.x = 0.6;
    const satchel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.14), teamMat);
    satchel.position.set(0.05, 0.75, -0.42);
    const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.7, 8), new THREE.MeshStandardMaterial({ color: 0x6b4a2e }));
    quiver.position.set(-0.3, 1.45, 0.12);
    quiver.rotation.x = 0.35;
    g.add(body, head, hair, goggles, strap, satchel, quiver);
    [0x8fd8ff, 0xff8a3d, 0xffe14a].forEach((color, i) => {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.06), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 }));
      f.position.set(-0.3, 1.88, 0.24 + (i - 1) * 0.07);
      g.add(f);
    });
    // The bow, held out in front: a brass-capped arc with a string and a nocked arrow.
    const bow = new THREE.Group();
    const limb = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.04, 6, 24, Math.PI * 0.9), new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.6 }));
    limb.rotation.z = -Math.PI * 0.45;
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.48, 4), new THREE.MeshBasicMaterial({ color: 0xeeeeee }));
    string.position.x = -0.12;
    const gear = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 8), metal);
    gear.rotation.x = Math.PI / 2;
    gear.position.x = 0.73;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 5), new THREE.MeshStandardMaterial({ color: 0x8a6a44 }));
    shaft.rotation.z = Math.PI / 2;
    shaft.position.x = 0.38;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 6), new THREE.MeshStandardMaterial({ color: 0x8fd8ff, emissive: 0x8fd8ff, emissiveIntensity: 1.2 }));
    tip.name = 'arrowtip';
    tip.rotation.z = -Math.PI / 2;
    tip.position.x = 0.98;
    bow.add(limb, string, gear, shaft, tip);
    bow.position.set(0.35, 1.25, 0.15);
    g.add(bow);
    return g;
  }
  if (u.champ!.kit === 'lumen') {
    // Lumen: a candle-saint in long cream robes with a team-coloured stole, a soft face, and a lit candle in her hands.
    const cloth = new THREE.MeshStandardMaterial({ color: 0xf1e6cf, roughness: 0.85, flatShading: true });
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.8, 10), cloth);
    robe.position.y = 0.9;
    const stole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.5), teamMat);
    stole.position.set(0.22, 1.1, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), new THREE.MeshStandardMaterial({ color: 0xf0d2b6 }));
    head.position.y = 2.0;
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.29, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), cloth);
    hood.position.y = 2.03;
    hood.rotation.z = 0.3;
    const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.32, 8), new THREE.MeshStandardMaterial({ color: 0xfff6e0 }));
    wax.position.set(0.45, 1.25, 0);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 8), new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xffa020, emissiveIntensity: 2 }));
    flame.position.set(0.45, 1.5, 0);
    g.add(robe, stole, head, hood, wax, flame);
    return g;
  }
  if (u.champ!.kit === 'gerrit') {
    // Gerrit: a broad old knight in dented plate with a team-coloured tabard, a helm with a plume, and a halberd.
    const plate = new THREE.MeshStandardMaterial({ color: 0x8d8f94, metalness: 0.65, roughness: 0.4, flatShading: true });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 1.2, 8), plate);
    body.position.y = 1.0;
    const tabard = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.86), teamMat);
    tabard.position.set(0.12, 0.85, 0);
    const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.3, 0.42, 8), plate);
    helm.position.y = 1.85;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.34), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    visor.position.set(0.29, 1.88, 0);
    const plume = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.45, 6), new THREE.MeshStandardMaterial({ color: 0xc9a24a }));
    plume.position.set(-0.08, 2.25, 0);
    plume.rotation.z = 0.5;
    const wood = new THREE.MeshStandardMaterial({ color: 0x5b3a1e });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.8, 6), wood);
    shaft.position.set(0.45, 1.35, 0.55);
    shaft.rotation.z = -0.12;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.3), metal);
    blade.position.set(0.62, 2.7, 0.62);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.35, 6), metal);
    spike.position.set(0.62, 3.05, 0.55);
    g.add(body, tabard, helm, visor, plume, shaft, blade, spike);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.5, 6), plate);
      leg.position.set(0, 0.25, side * 0.2);
      const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), plate);
      pauldron.position.set(0, 1.55, side * 0.48);
      g.add(leg, pauldron);
    }
    return g;
  }
  if (u.champ!.kit === 'pip') {
    // Pip: a tiny sprout-knight in a green tunic, a leaf on his head, a pot-lid shield and a slingshot.
    const tunic = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.6, 8), new THREE.MeshStandardMaterial({ color: 0x4f8a3c, flatShading: true }));
    tunic.position.y = 0.45;
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.04, 6, 14), teamMat);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.42;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshStandardMaterial({ color: 0xe9c39b }));
    head.position.y = 0.95;
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.32, 5), new THREE.MeshStandardMaterial({ color: 0x8fd16a, flatShading: true }));
    leaf.position.set(-0.04, 1.27, 0);
    leaf.rotation.z = 0.4;
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 14), metal);
    lid.rotation.x = Math.PI / 2;
    lid.position.set(0.12, 0.55, -0.32);
    const sling = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 5, 10, Math.PI), new THREE.MeshStandardMaterial({ color: 0x7a5434 }));
    sling.position.set(0.2, 0.75, 0.3);
    g.add(tunic, belt, head, leaf, lid, sling);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
      eye.position.set(0.2, 0.98, side * 0.08);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.25, 6), new THREE.MeshStandardMaterial({ color: 0x5a4030 }));
      leg.position.set(0, 0.12, side * 0.1);
      g.add(eye, leg);
    }
    return g;
  }
  if (u.champ!.kit === 'sable') {
    // A tall, quiet harvester: a tattered field cloak, a dark crow-feather mantle, a deep hood with two
    // pale eyes, and a long scythe with a small lantern hanging from the blade.
    const cloak = new THREE.MeshStandardMaterial({ color: 0x5a5245, flatShading: true });
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.9, 9), cloak);
    robe.position.y = 0.95;
    const sash = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 6, 16), teamMat);
    sash.rotation.x = Math.PI / 2;
    sash.position.y = 1.15;
    const mantle = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.55, 10), new THREE.MeshStandardMaterial({ color: 0x1d1b22, flatShading: true }));
    mantle.position.y = 1.75;
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), cloak);
    hood.position.y = 2.15;
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: 0x0c0b10 }));
    face.position.set(0.14, 2.12, 0);
    g.add(robe, sash, mantle, hood, face);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), glow);
      eye.position.set(0.31, 2.15, side * 0.07);
      g.add(eye);
    }
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a32 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.8, 6), wood);
    shaft.position.set(0.35, 1.45, 0.55);
    shaft.rotation.z = -0.15;
    const blade = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.05, 4, 18, Math.PI * 0.85), metal);
    blade.position.set(0.55, 2.75, 0.55);
    blade.rotation.z = Math.PI * 0.95;
    const lantern = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), new THREE.MeshStandardMaterial({ color: 0xffe6a0, emissive: 0xffd36b, emissiveIntensity: 1.5 }));
    lantern.position.set(-0.05, 2.35, 0.55);
    g.add(shaft, blade, lantern);
  } else if (u.champ!.kit === 'gormund') {
    // A hulking, hunched minotaur: broad chest, bull head with horns and a brass nose ring, chain-wrapped
    // fists, no weapon.
    const hide = new THREE.MeshStandardMaterial({ color: 0x6b4630, flatShading: true });
    const horn = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, flatShading: true });
    const brass = new THREE.MeshStandardMaterial({ color: 0xd8a84a, metalness: 0.7, roughness: 0.3 });
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.38, 0.9, 8), teamMat);
    legs.position.y = 0.45;
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.72, 12, 10).scale(0.9, 1, 1.1), hide);
    chest.position.set(0.12, 1.45, 0);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.5), hide);
    head.position.set(0.62, 1.95, 0);
    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.42), new THREE.MeshStandardMaterial({ color: 0x4a3022, flatShading: true }));
    muzzle.position.set(0.98, 1.85, 0);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 6, 14), brass);
    ring.position.set(1.13, 1.74, 0);
    ring.rotation.y = Math.PI / 2;
    g.add(legs, chest, head, muzzle, ring);
    for (const side of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.7, 8), horn);
      h.position.set(0.6, 2.3, side * 0.42);
      h.rotation.x = side * -0.9;
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), glow);
      eye.position.set(0.94, 2.03, side * 0.17);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.75, 4, 8), hide);
      arm.position.set(0.3, 1.15, side * 0.8);
      arm.rotation.z = -0.3;
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), hide);
      fist.position.set(0.48, 0.72, side * 0.82);
      const chain = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.04, 6, 12), metal);
      chain.position.set(0.42, 0.9, side * 0.82);
      chain.rotation.x = Math.PI / 2;
      g.add(h, eye, arm, fist, chain);
    }
  } else if (u.champ!.kit === 'aurelle') {
    // A floating battle mage: flowing robe with no legs, white-and-gold armour, gold hair, glowing
    // violet eyes, and her rune spear hovering at her side (named so the view can hide it when thrown).
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.5, 12), new THREE.MeshStandardMaterial({ color: 0xf1ece0, flatShading: true }));
    robe.position.y = 0.75;
    const sash = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 6, 16), teamMat);
    sash.rotation.x = Math.PI / 2;
    sash.position.y = 1.05;
    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.33, 0.45, 10), new THREE.MeshStandardMaterial({ color: 0xd8b25a, metalness: 0.6, roughness: 0.35 }));
    chest.position.y = 1.4;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), new THREE.MeshStandardMaterial({ color: 0xf0d2b8 }));
    head.position.y = 1.85;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), new THREE.MeshStandardMaterial({ color: 0xf2d77a }));
    hair.position.set(-0.04, 1.88, 0);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.7, 8), new THREE.MeshStandardMaterial({ color: 0xf2d77a }));
    tail.position.set(-0.22, 1.55, 0);
    tail.rotation.z = -0.4;
    g.add(robe, sash, chest, head, hair, tail);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), glow);
      eye.position.set(0.21, 1.88, side * 0.08);
      g.add(eye);
    }
    const spear = new THREE.Group();
    spear.name = 'heldSpear';
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.8, 6), new THREE.MeshStandardMaterial({ color: 0xe9e4ea, metalness: 0.7, roughness: 0.3 }));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.35, 6), glow);
    tip.position.y = 1.05;
    spear.add(shaft, tip);
    spear.position.set(0.35, 1.35, 0.55);
    spear.rotation.z = -0.25;
    g.add(spear);
  } else if (u.champ!.kit === 'mabel') {
    // A small mouse beekeeper: round body, big ears, a tail, a veiled hat, one paw pointing with a bee at its tip.
    const fur = new THREE.MeshStandardMaterial({ color: 0x9b8576, flatShading: true });
    const pink = new THREE.MeshStandardMaterial({ color: 0xf0a7b4 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.5, 4, 12), teamMat);
    body.position.y = 0.6;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), fur);
    head.position.y = 1.25;
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.28, 10).rotateZ(-Math.PI / 2), fur);
    snout.position.set(0.3, 1.2, 0);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), pink);
    nose.position.set(0.45, 1.2, 0);
    g.add(body, head, snout, nose);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 16).rotateX(Math.PI / 2), fur);
      ear.position.set(-0.02, 1.52, side * 0.24);
      ear.rotation.y = side * 0.3;
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 14).rotateX(Math.PI / 2), pink);
      inner.position.copy(ear.position).add(new THREE.Vector3(0.02, 0, 0));
      inner.rotation.y = ear.rotation.y;
      g.add(ear, inner);
    }
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.035, 6, 16, Math.PI * 1.2), pink);
    tail.position.set(-0.45, 0.45, 0);
    tail.rotation.y = Math.PI / 2;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 20), new THREE.MeshStandardMaterial({ color: 0xf3ead8 }));
    brim.position.y = 1.5;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.18, 16), new THREE.MeshStandardMaterial({ color: 0xf3ead8 }));
    crown.position.y = 1.6;
    const veil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.44, 0.35, 20, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
    );
    veil.position.y = 1.32;
    // No staff: she points, and a bee flies out (her autos are bees).
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.38, 4, 8).rotateZ(-Math.PI / 2), fur);
    arm.position.set(0.32, 0.92, 0.3);
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), pink);
    paw.position.set(0.58, 0.92, 0.3);
    const bee = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6).scale(1.5, 1, 1), glow);
    bee.position.set(0.7, 1.1, 0.3);
    g.add(tail, brim, crown, veil, arm, paw, bee);
  } else if (u.champ!.kit === 'lisha') {
    // Slim duelist with a topknot and a blade on each hip.
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 1.05, 4, 12), teamMat);
    body.position.y = 0.9;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10), new THREE.MeshStandardMaterial({ color: 0xe8c3a0 }));
    head.position.y = 1.9;
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshStandardMaterial({ color: 0x241a1f }));
    bun.position.set(-0.05, 2.18, 0);
    const sash = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.06, 6, 16), glow);
    sash.rotation.x = Math.PI / 2;
    sash.position.y = 0.95;
    g.add(body, head, bun, sash);
    for (const side of [-1, 1]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.09), metal);
      blade.position.set(0.15, 0.95, side * 0.42);
      blade.rotation.z = -0.5;
      g.add(blade);
    }
  } else if (u.champ!.kit === 'maren') {
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
/** A pulsing red ring under the enemy a right-click would attack, so you see the target before clicking. */
export class TargetRing {
  readonly mesh: THREE.Mesh;
  private t = 0;

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 32),
      new THREE.MeshBasicMaterial({ color: 0xff4a3d, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Ring the unit at `at` (its feet) sized to `radius`, or hide with null. */
  update(dt: number, at: THREE.Vector3 | null, radius = 0.6) {
    this.t += dt;
    this.mesh.visible = !!at;
    if (!at) return;
    this.mesh.position.set(at.x, 0.05, at.z);
    this.mesh.scale.setScalar((radius + 0.35) * (1 + Math.sin(this.t * 8) * 0.05));
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

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

  /** Green for a move, red for an attack-move (as in League). */
  show(at: THREE.Vector3, attack = false) {
    (this.mesh.material as THREE.MeshBasicMaterial).color.set(attack ? 0xff5a4a : 0x6dff7a);
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
