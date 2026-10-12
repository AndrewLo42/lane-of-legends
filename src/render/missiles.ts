import * as THREE from 'three';
import type { Missile, MissileStyle } from '../sim/types';
import { buildProp } from './assets';
import { TEAM_COLOR } from './scene';

/**
 * Projectile visuals: a model per missile style (built pointing along +x), plus what makes motion
 * read from the MOBA camera: a fading ribbon trail, a soft additive glow on energy shots, and a chain
 * back to the thrower's hand for hooks (Sable's Reaping Hook, Tether). Trail `life` is in seconds, so
 * its length scales with speed: fast shots (spear, Sparkshot) keep it short or it reads as a beam.
 */
export interface MissileLook {
  obj: THREE.Object3D;
  height: number;
  /** Materials with their resting colours (missiles frozen in a Stopwatch field tint pale). */
  mats: { m: THREE.MeshBasicMaterial | THREE.MeshStandardMaterial; color: THREE.Color }[];
  trail?: { color: number; width: number; life: number };
  /** Per-frame flourish (spin, tumble, wing flap); `t` is seconds since it was thrown. */
  animate?: (t: number) => void;
  /** Draw a chain from the thrower's hand to the missile. */
  chain?: boolean;
}

let glowTexture: THREE.Texture | null = null;
/** A soft round falloff, shared by every glow sprite. */
function glowMap() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}

function glow(color: number, size: number) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(size);
  return s;
}

export function buildMissile(m: Missile): MissileLook {
  const team = TEAM_COLOR[m.team];
  const mats: MissileLook['mats'] = [];
  const basic = (color: number, opacity?: number) => {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity != null, opacity: opacity ?? 1 });
    mats.push({ m: mat, color: mat.color.clone() });
    return mat;
  };
  const lit = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => {
    const mat = new THREE.MeshStandardMaterial({ color, ...o });
    mats.push({ m: mat, color: mat.color.clone() });
    return mat;
  };
  const obj = new THREE.Group();
  const add = (...o: THREE.Object3D[]) => (obj.add(...o), o[0]);

  const looks: Record<MissileStyle, () => Omit<MissileLook, 'obj' | 'mats'>> = {
    // Champion and caster-minion autos: a team-coloured orb.
    auto: () => {
      add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), basic(team)), glow(team, 0.7));
      return { height: 1.1, trail: { color: team, width: 0.14, life: 0.1 } };
    },
    tower: () => {
      add(new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), basic(new THREE.Color(team).lerp(new THREE.Color(0xffffff), 0.45).getHex())), glow(team, 1.7));
      return { height: 6.4, trail: { color: team, width: 0.32, life: 0.12 } };
    },
    // Arlo's Sparkshot: a bright gold streak.
    spark: () => {
      add(new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.9, 4, 8).rotateZ(Math.PI / 2), basic(0xfff0b8)), glow(0xffd76a, 1.1));
      return { height: 1.1, trail: { color: 0xffc94a, width: 0.3, life: 0.12 } };
    },
    // Arlo's Rune Flare: a slowly turning violet rune-orb.
    flare: () => {
      const orb = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), basic(0xd2a8ff)), glow(0xb36bff, 1.5));
      return { height: 1.1, trail: { color: 0xb36bff, width: 0.34, life: 0.25 }, animate: (t) => orb.rotation.set(t * 3, t * 4, 0) };
    },
    // Aurelle's unarmed bolts.
    bolt: () => {
      const gem = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.17), basic(0xe6dcff)), glow(0xa98bff, 0.9));
      return { height: 1.1, trail: { color: 0xa98bff, width: 0.16, life: 0.15 }, animate: (t) => (gem.rotation.x = t * 12) };
    },
    // Arlo's Skyline Barrage: a translucent wall of light crossing the lane.
    wave: () => {
      add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, m.width), basic(0xffc94a, 0.5)));
      return { height: 0.9 };
    },
    // Maren's Undertow Hook: a cresting water point.
    tide: () => {
      add(new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 10).rotateZ(-Math.PI / 2), basic(0xbff4ff, 0.9)), glow(0x7fe0ff, 1.0));
      return { height: 1.0, trail: { color: 0x7fe0ff, width: 0.26, life: 0.12 } };
    },
    // Lisha's blades of blossom: a spinning petal.
    petal: () => {
      const petal = add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 6).scale(1.5, 0.15, 0.6), basic(0xf7a8c8)));
      return { height: 1.2, trail: { color: 0xe86f9a, width: 0.12, life: 0.16 }, animate: (t) => (petal.rotation.y = t * 14) };
    },
    // Mabel's bees: a striped body, a dark head and flickering wings.
    bee: () => {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8).scale(1.6, 1, 1), basic(0xf2b632));
      const dark = basic(0x241b10);
      const stripes = [-0.05, 0.03].map((x) => {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.093, 0.093, 0.028, 12).rotateZ(Math.PI / 2), dark);
        s.position.x = x;
        return s;
      });
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), dark);
      head.position.x = 0.15;
      const wingMat = basic(0xffffff, 0.6);
      wingMat.side = THREE.DoubleSide;
      const wings = [-1, 1].map((side) => {
        const pivot = new THREE.Group();
        const w = new THREE.Mesh(new THREE.CircleGeometry(0.08, 10).scale(1.2, 0.7, 1), wingMat);
        w.position.z = 0.07 * side;
        w.rotation.x = Math.PI / 2;
        pivot.add(w);
        pivot.position.y = 0.06;
        return { pivot, side };
      });
      add(body, ...stripes, head, ...wings.map((w) => w.pivot));
      return {
        height: 1.0,
        trail: { color: 0xf2b632, width: 0.06, life: 0.12 },
        animate: (t) => {
          const flap = Math.sin(t * 70) * 0.7;
          for (const w of wings) w.pivot.rotation.x = w.side * (0.3 + flap);
        },
      };
    },
    // Aurelle's rune spear: the very spear that floats at her side, thrown point-first.
    spear: () => {
      spearModel(obj, mats, false);
      return { height: 1.2, trail: { color: 0xa98bff, width: 0.2, life: 0.1 } };
    },
    // Arsenal Ascendant's lances: ghostly copies of the spear.
    lance: () => {
      spearModel(obj, mats, true);
      return { height: 1.3, trail: { color: 0xe6dcff, width: 0.16, life: 0.1 } };
    },
    // Tether: a glowing hook on a line back to its thrower.
    tether: () => {
      add(new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 6, 16, Math.PI * 1.4).rotateZ(Math.PI * 0.3).rotateX(Math.PI / 2), basic(0xc9f2ff)), glow(0xc9f2ff, 0.8));
      return { height: 1.1, chain: true };
    },
    // Gormund's Hurl Stone: a tumbling chunk of labyrinth floor, shedding dust.
    stone: () => {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 0).scale(1, 0.8, 0.9), lit(0x8f877b, { flatShading: true, roughness: 0.95 }));
      add(rock);
      return { height: 1.3, trail: { color: 0x6b6358, width: 0.5, life: 0.22 }, animate: (t) => rock.rotation.set(t * 5, 0, t * 7) };
    },
    // Sable's Reaping Hook: her scythe's crescent blade, flying on its chain.
    hook: () => {
      const shape = new THREE.Shape();
      shape.absarc(0, 0, 0.5, -Math.PI * 0.55, Math.PI * 0.55, false);
      shape.absarc(-0.08, 0, 0.4, Math.PI * 0.5, -Math.PI * 0.5, true);
      const blade = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.015, bevelSegments: 1, curveSegments: 20 }).rotateX(-Math.PI / 2),
        lit(0xdcdcd6, { metalness: 0.8, roughness: 0.3, emissive: 0x6b5a2a, emissiveIntensity: 0.4 }),
      );
      blade.position.x = -0.35; // the curve's leading edge sits at the missile's tip
      add(blade, glow(0xe6c86b, 0.6));
      return { height: 1.2, chain: true };
    },
  };
  const look = looks[m.style]();
  obj.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : null));
  return { obj, mats, ...look };
}

/** Aurelle's spear prop laid point-forward (+x), solid or as a ghostly lance. */
function spearModel(obj: THREE.Group, mats: MissileLook['mats'], ghost: boolean) {
  const built = buildProp('champ_aurelle');
  if (!built) return;
  const spear = built.obj;
  spear.rotation.z = -Math.PI / 2; // the prop is built point-up (+y)
  spear.position.x = -0.5; // centre its length on the missile
  spear.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (ghost) mesh.material = new THREE.MeshBasicMaterial({ color: 0xe6dcff, transparent: true, opacity: 0.5, depthWrite: false });
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mats.push({ m: mat, color: mat.color.clone() });
  });
  const tip = glow(0xa98bff, ghost ? 0.6 : 0.8);
  tip.position.x = 0.95; // on the spearhead
  obj.add(spear, tip);
}

/**
 * A ribbon left behind a moving point: flat on the ground plane (it reads from the top-down camera),
 * tapering and fading over `life` seconds. Additive, so faded vertices simply vanish.
 */
export class Trail {
  readonly mesh: THREE.Mesh;
  private pts: { p: THREE.Vector3; age: number }[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private color: THREE.Color;

  constructor(color: number, private width: number, private life: number, private max = 18) {
    this.color = new THREE.Color(color);
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 2 * 3);
    this.col = new Float32Array(max * 2 * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const idx: number[] = [];
    for (let i = 0; i < max - 1; i++) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
  }

  /** Feed the head position (null once the missile is gone); returns false when fully faded. */
  update(head: THREE.Vector3 | null, dt: number) {
    for (const p of this.pts) p.age += dt;
    if (head && (!this.pts.length || this.pts[0].p.distanceToSquared(head) > 1e-4)) this.pts.unshift({ p: head.clone(), age: 0 });
    while (this.pts.length > this.max || (this.pts.length && this.pts[this.pts.length - 1].age > this.life)) this.pts.pop();
    const n = this.pts.length;
    const geo = this.mesh.geometry;
    if (n < 2) {
      geo.setDrawRange(0, 0);
      return n > 0 || !!head;
    }
    for (let i = 0; i < n; i++) {
      const a = this.pts[Math.max(0, i - 1)].p;
      const b = this.pts[Math.min(n - 1, i + 1)].p;
      let dx = a.x - b.x;
      let dz = a.z - b.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const k = Math.max(0, 1 - this.pts[i].age / this.life) * (1 - i / n);
      const w = this.width * k;
      const p = this.pts[i].p;
      this.pos.set([p.x - dz * w, p.y, p.z + dx * w, p.x + dz * w, p.y, p.z - dx * w], i * 6);
      const r = this.color.r * k;
      const g = this.color.g * k;
      const bl = this.color.b * k;
      this.col.set([r, g, bl, r, g, bl], i * 6);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.setDrawRange(0, (n - 1) * 6);
    return true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

const LINK_GAP = 0.12;
const linkGeo = new THREE.TorusGeometry(0.045, 0.014, 5, 10);
const linkMat = new THREE.MeshStandardMaterial({ color: 0x3a3732, metalness: 0.7, roughness: 0.45 });

/** Iron links strung between two points, alternately turned like a real chain. */
export class Chain {
  readonly group = new THREE.Group();
  private links: THREE.Mesh[] = [];

  update(from: THREE.Vector3, to: THREE.Vector3) {
    const d = to.clone().sub(from);
    const len = d.length();
    const n = Math.min(120, Math.max(1, Math.floor(len / LINK_GAP)));
    while (this.links.length < n) {
      const l = new THREE.Mesh(linkGeo, linkMat);
      this.links.push(l);
      this.group.add(l);
    }
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.clone().normalize());
    const twist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    this.links.forEach((l, i) => {
      l.visible = i < n;
      if (!l.visible) return;
      l.position.copy(from).addScaledVector(d, (i + 0.5) / n);
      l.quaternion.copy(q);
      if (i % 2) l.quaternion.multiply(twist);
    });
  }

  dispose() {
    this.group.removeFromParent();
  }
}
