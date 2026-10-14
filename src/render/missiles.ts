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
  /** Draw a tongue from the thrower's toad's mouth to the missile (Pip's Gulp), snapping back when it lands. */
  tongue?: boolean;
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

let bandTexture: THREE.Texture | null = null;
/** Bright in the middle, fading to nothing at both ends along u: a band of light seen from above. */
function bandMap() {
  if (bandTexture) return bandTexture;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 4;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.92, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 4);
  bandTexture = new THREE.CanvasTexture(c);
  return bandTexture;
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
    // Tower shots: a team-coloured crystal shard, spinning as it falls on its target.
    tower: () => {
      const light = new THREE.Color(team).lerp(new THREE.Color(0xffffff), 0.45).getHex();
      const shard = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0).scale(2.2, 0.8, 0.8), basic(light)), glow(team, 1.8));
      return { height: 6.4, trail: { color: team, width: 0.32, life: 0.12 }, animate: (t) => (shard.rotation.x = t * 10) };
    },
    // Arlo's autos: a gold dart of gauntlet energy.
    gauntlet: () => {
      add(new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0).scale(2.6, 0.7, 0.7), basic(0xfff0b8)), glow(0xf2c14e, 0.75));
      return { height: 1.1, trail: { color: 0xf2c14e, width: 0.12, life: 0.1 } };
    },
    // Maren's autos: an orb of seawater with droplets circling it.
    water: () => {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), basic(0x7fe0ff, 0.75));
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), basic(0xeafcff));
      const drops = droplets(3, 0.2, 0.035, basic(0xbff4ff));
      add(orb, core, drops, glow(0x7fe0ff, 0.8));
      return { height: 1.1, trail: { color: 0x5fc8ff, width: 0.14, life: 0.1 }, animate: (t) => (drops.rotation.x = t * 9) };
    },
    // Arlo's Sparkshot: a white-hot core with lightning crackling round it.
    spark: () => {
      add(new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.7, 4, 8).rotateZ(Math.PI / 2), basic(0xfffbe8)), glow(0xffd76a, 1.2));
      const arcs = [lightning(0xffe08a, 1.3, 7, 0.14), lightning(0xfff3c4, 1.0, 6, 0.1)];
      for (const a of arcs) {
        add(a.group);
        mats.push({ m: a.mat, color: a.mat.color.clone() });
      }
      let next = 0;
      return {
        height: 1.1,
        trail: { color: 0xffc94a, width: 0.3, life: 0.12 },
        animate: (t) => {
          if (t < next) return;
          next = t + 0.05; // re-strike ~20 times a second
          for (const a of arcs) a.strike();
        },
      };
    },
    // Arlo's Rune Flare: a violet core inside two counter-rotating rune rings.
    flare: () => {
      const core = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), basic(0xf0e0ff)), glow(0xb36bff, 1.5));
      const ringMat = basic(0xb36bff);
      const r1 = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 6, 6), ringMat); // hexagonal: reads as a rune
      const r2 = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.02, 6, 3), ringMat); // triangular
      add(r1, r2);
      return {
        height: 1.1,
        trail: { color: 0xb36bff, width: 0.34, life: 0.25 },
        animate: (t) => {
          core.rotation.set(t * 3, t * 4, 0);
          r1.rotation.set(t * 2, t * 1.3, 0);
          r2.rotation.set(-t * 2.6, 0, t * 1.7);
        },
      };
    },
    // Aurelle's unarmed bolts: an arcane shard with two motes circling it.
    bolt: () => {
      const gem = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.15).scale(1.6, 1, 1), basic(0xe6dcff)), glow(0xa98bff, 0.9));
      const motes = droplets(2, 0.2, 0.03, basic(0xcdb6ff));
      add(motes);
      return { height: 1.1, trail: { color: 0xa98bff, width: 0.16, life: 0.15 }, animate: (t) => ((gem.rotation.x = t * 12), (motes.rotation.x = -t * 10)) };
    },
    // Arlo's Skyline Barrage: a shimmering wall of gold light sweeping across the lane.
    wave: () => {
      const sheet = (h: number, op: number) => {
        const mat = new THREE.MeshBasicMaterial({ map: glowMap(), color: 0xffc94a, blending: THREE.AdditiveBlending, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide });
        mats.push({ m: mat, color: mat.color.clone() });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(m.width + 0.8, h).rotateY(Math.PI / 2), mat);
        return { mesh, mat };
      };
      const outer = sheet(2.2, 0.9);
      const inner = sheet(1.1, 1);
      inner.mat.color.set(0xfff3c4);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, m.width), basic(0xfffbe8));
      edge.position.y = -0.55;
      // A broad band of light on the ground under the wall: from the top-down camera the wall itself is edge-on.
      const bandMat = new THREE.MeshBasicMaterial({ map: bandMap(), color: 0xffc94a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
      mats.push({ m: bandMat, color: bandMat.color.clone() });
      const band = new THREE.Mesh(new THREE.PlaneGeometry(2.4, m.width).rotateX(-Math.PI / 2), bandMat);
      band.position.set(-0.6, -0.95, 0);
      add(outer.mesh, inner.mesh, edge, band);
      return {
        height: 1.0,
        animate: (t) => {
          const f = 0.8 + Math.sin(t * 30) * 0.1 + Math.sin(t * 47) * 0.1;
          outer.mat.opacity = 0.9 * f;
          inner.mesh.scale.y = 0.85 + Math.sin(t * 22) * 0.15;
        },
      };
    },
    // Maren's Undertow Hook: a point of water wrapped in a swirling ring, shedding droplets.
    tide: () => {
      add(new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.8, 10).rotateZ(-Math.PI / 2), basic(0xbff4ff, 0.9)), glow(0x7fe0ff, 1.0));
      const swirl = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 6, 16, Math.PI * 1.5).rotateY(Math.PI / 2), basic(0x7fe0ff, 0.8));
      swirl.position.x = -0.15;
      const drops = droplets(4, 0.36, 0.04, basic(0xeafcff));
      drops.position.x = -0.35;
      add(swirl, drops);
      return { height: 1.0, trail: { color: 0x7fe0ff, width: 0.26, life: 0.12 }, animate: (t) => ((swirl.rotation.x = t * 14), (drops.rotation.x = -t * 8)) };
    },
    // Lisha's blades of blossom: a pointed petal with a pale edge, spinning flat.
    petal: () => {
      const lens = new THREE.Shape();
      lens.moveTo(-0.28, 0);
      lens.quadraticCurveTo(0, 0.13, 0.28, 0);
      lens.quadraticCurveTo(0, -0.13, -0.28, 0);
      const flat = (scale: number, color: number) => {
        const mat = basic(color);
        mat.side = THREE.DoubleSide;
        return new THREE.Mesh(new THREE.ShapeGeometry(lens, 10).scale(scale, scale, 1).rotateX(-Math.PI / 2), mat);
      };
      const petal = new THREE.Group();
      const edge = flat(1, 0xfbe2ec);
      const face = flat(0.8, 0xf28ab3);
      face.position.y = 0.005;
      petal.add(edge, face);
      add(petal, glow(0xe86f9a, 0.5));
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
    // Lumen's Candleflame (and her attacks): a warm teardrop of flame with a glow.
    candle: () => {
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8).scale(1.7, 1, 1), basic(0xffd27a));
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), basic(0xffffff));
      core.position.x = 0.06;
      add(flame, core, glow(0xffa630, 1.3));
      return { height: 1.2, trail: { color: 0xffb347, width: 0.3, life: 0.2 }, animate: (t) => flame.scale.set(1 + Math.sin(t * 40) * 0.12, 1, 1) };
    },
    tongue: () => {
      // Thistle's Gulp: a sticky, bulbous pink tip; the stretch back to his mouth is a `Tongue`.
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10).scale(1.15, 0.8, 1), lit(0xe56f86, { roughness: 0.35 }));
      const groove = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8).scale(1, 0.5, 0.35), lit(0xb84a63, { roughness: 0.5 }));
      groove.position.set(0.05, 0.12, 0);
      add(tip, groove);
      return { height: TONGUE_HEIGHT, tongue: true };
    },
  };
  const look = looks[m.style]();
  // Solid things cast shadows; light (additive or see-through) doesn't.
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.Material;
    mesh.castShadow = !mat.transparent && mat.blending !== THREE.AdditiveBlending;
  });
  return { obj, mats, ...look };
}

/** Small beads in a ring around the missile's axis (+x), for droplets and motes; spin the group to orbit them. */
function droplets(n: number, radius: number, size: number, mat: THREE.Material) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const d = new THREE.Mesh(new THREE.SphereGeometry(size, 6, 5), mat);
    d.position.set(0, Math.cos(a) * radius, Math.sin(a) * radius);
    g.add(d);
  }
  return g;
}

/** A jagged arc of lightning along +x, re-struck on demand (thin boxes between jittered points). */
function lightning(color: number, length: number, segments: number, amp: number) {
  const mat = new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const geo = new THREE.BoxGeometry(1, 0.025, 0.025);
  const group = new THREE.Group();
  const bits = Array.from({ length: segments }, () => group.add(new THREE.Mesh(geo, mat)).children.at(-1) as THREE.Mesh);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const strike = () => {
    const pts = Array.from({ length: segments + 1 }, (_, i) => {
      const end = i === 0 || i === segments;
      const j = () => (end ? 0 : (Math.random() * 2 - 1) * amp);
      return new THREE.Vector3(-length * 0.75 + (length * i) / segments, j(), j());
    });
    bits.forEach((bit, i) => {
      a.copy(pts[i]);
      b.copy(pts[i + 1]);
      bit.position.copy(a).add(b).multiplyScalar(0.5);
      bit.scale.x = a.distanceTo(b);
      bit.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), b.sub(a).normalize());
    });
  };
  strike();
  return { group, strike, mat };
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

/** Height of Thistle's mouth (and so of his tongue) above the ground, in the game's metres. */
export const TONGUE_HEIGHT = 0.55;
const tongueGeo = new THREE.CylinderGeometry(0.06, 0.11, 1, 10, 1, true).rotateZ(-Math.PI / 2).translate(0.5, 0, 0); // along +x, 0..1, thick end at the mouth
const tongueMat = new THREE.MeshStandardMaterial({ color: 0xe56f86, roughness: 0.35 });

/**
 * Thistle's tongue: a fleshy strand from his mouth to the flying tip, a little thicker at the mouth.
 * When the tip lands it snaps back in (`retract`), so the tongue doesn't just vanish.
 */
export class Tongue {
  readonly mesh = new THREE.Mesh(tongueGeo, tongueMat);
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  /** Seconds left in the snap back (null while the tip is still out). */
  private back: number | null = null;
  private static readonly SNAP = 0.14;

  constructor() {
    this.mesh.castShadow = true;
  }

  update(from: THREE.Vector3, to: THREE.Vector3) {
    this.from.copy(from);
    this.to.copy(to);
    this.place(1);
  }

  /** Start snapping back; then call `step` each frame until it returns false. */
  retract() {
    this.back = Tongue.SNAP;
  }

  step(dt: number) {
    if (this.back == null) return false;
    this.back -= dt;
    if (this.back <= 0) return false;
    this.place(this.back / Tongue.SNAP);
    return true;
  }

  private place(k: number) {
    const d = this.to.clone().sub(this.from);
    const len = Math.max(0.01, d.length() * k);
    this.mesh.position.copy(this.from);
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize());
    this.mesh.scale.set(len, 1, 1);
  }

  dispose() {
    this.mesh.removeFromParent();
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
