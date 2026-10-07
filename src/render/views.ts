import * as THREE from 'three';
import type { Missile, MissileStyle, Unit, Vec2 } from '../sim/types';
import type { World } from '../sim/world';
import { AnimatedModel } from './animatedModel';
import { hasModel, instantiate, type ModelName } from './assets';
import { RIGS } from './rigs';
import { TEAM_COLOR, placeholderFor } from './scene';

/** Unit → Meshy model and its in-game height (metres); placeholders are used when none is loaded. */
function modelFor(u: Unit): { name: ModelName; height: number } | undefined {
  if (u.kind === 'minion') return u.role === 'melee' ? { name: 'minion_melee', height: 1.25 } : { name: 'minion_caster', height: 1.5 };
  if (u.kind === 'tower') return { name: 'tower', height: 7.2 };
  if (u.kind === 'nexus') return { name: 'nexus', height: 6.2 };
  return undefined;
}
/** How long a dead minion lingers to play its death clip, then how long it takes to sink away. */
const CORPSE_SECONDS = 2.4;
const SINK_SECONDS = 0.5;
/** A destroyed structure shakes, tilts and sinks into the ground over this long. */
const COLLAPSE_SECONDS = 1.6;

interface UnitView {
  obj: THREE.Object3D;
  /** Lazily built status visuals: shield bubble, root ring, stun stars. */
  bubble?: THREE.Mesh;
  root?: THREE.Mesh;
  stun?: THREE.Object3D;
  prev: Vec2;
  prevFacing: number;
  /** Materials with their resting emissive, for the hit flash. */
  mats: { m: THREE.MeshStandardMaterial; emissive: THREE.Color; intensity: number }[];
  /** Skeletal animation, when the unit uses a Meshy model instead of a placeholder. */
  anim?: AnimatedModel;
  /** Moves held props (the caster's staff) to their hand after the animation updates. */
  syncProps?: () => void;
  lastAttackSeen?: number;
  /** Alternates Attack / Attack2 so swings don't look identical. */
  attacks?: number;
}

interface MissileView {
  obj: THREE.Object3D;
  prev: Vec2;
  mat: THREE.MeshBasicMaterial;
  color: THREE.Color;
}

const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/** Height of a unit's health bar anchor above its feet. */
export const BAR_HEIGHT: Record<Unit['kind'], number> = { champion: 2.6, minion: 1.4, tower: 7.4, nexus: 6.6 };

const FROZEN = new THREE.Color(0xd8fffb);

/** Mesh per missile style, built pointing along +x. */
function missileMesh(m: Missile): { obj: THREE.Object3D; mat: THREE.MeshBasicMaterial; height: number } {
  const team = TEAM_COLOR[m.team];
  const looks: Record<MissileStyle, () => { geo: THREE.BufferGeometry; color: number; height: number; opacity?: number }> = {
    auto: () => ({ geo: new THREE.SphereGeometry(0.16, 8, 6), color: team, height: 1.1 }),
    tower: () => ({ geo: new THREE.SphereGeometry(0.3, 10, 8), color: team, height: 6.4 }),
    spark: () => ({ geo: new THREE.CapsuleGeometry(0.16, 1.1, 4, 8).rotateZ(Math.PI / 2), color: 0xffd76a, height: 1.1 }),
    flare: () => ({ geo: new THREE.IcosahedronGeometry(0.38, 1), color: 0xb36bff, height: 1.1 }),
    bolt: () => ({ geo: new THREE.OctahedronGeometry(0.22), color: 0x9fe8ff, height: 1.1 }),
    wave: () => ({ geo: new THREE.BoxGeometry(1.2, 1.4, m.width), color: 0xffc94a, height: 0.9, opacity: 0.55 }),
    tide: () => ({ geo: new THREE.ConeGeometry(0.3, 1.0, 8).rotateZ(-Math.PI / 2), color: 0x7fe0ff, height: 1.0, opacity: 0.85 }),
  };
  const look = looks[m.style]();
  const mat = new THREE.MeshBasicMaterial({ color: look.color, transparent: look.opacity != null, opacity: look.opacity ?? 1 });
  return { obj: new THREE.Mesh(look.geo, mat), mat, height: look.height };
}

/**
 * Mirrors the sim into the scene: creates and removes meshes as units and missiles come and go,
 * interpolates positions between ticks, and adds cheap feedback (attack lunge, hit flash).
 */
export class WorldView {
  private units = new Map<number, UnitView>();
  /** Dead minions playing their death clip before they're removed. */
  private corpses: { v: UnitView; age: number; collapse: boolean }[] = [];
  private missiles = new Map<number, MissileView>();

  constructor(private scene: THREE.Scene, private world: World) {
    this.sync();
  }

  /** Call right before each sim step so interpolation has the previous tick's positions. */
  snapshot() {
    this.sync();
    for (const u of this.world.units) {
      const v = this.units.get(u.id)!;
      v.prev = { ...u.pos };
      v.prevFacing = u.facing;
    }
    for (const m of this.world.missiles) {
      const v = this.missiles.get(m.id);
      if (v) v.prev = { ...m.pos };
    }
  }

  /** Add views for new things, drop views for things that are gone. */
  private sync() {
    const live = new Set<number>();
    for (const u of this.world.units) {
      live.add(u.id);
      if (this.units.has(u.id)) continue;
      const model = modelFor(u);
      const built = model && hasModel(model.name) ? instantiate(model.name, model.height, new THREE.Color(TEAM_COLOR[u.team])) : null;
      const obj = built?.root ?? placeholderFor(u);
      const anim = built?.clips.length ? new AnimatedModel(built.model, built.clips, RIGS.meshy) : undefined;
      anim?.setBase('Idle');
      obj.userData.structure = u.kind === 'tower' || u.kind === 'nexus';
      // Structures never turn; show their front to the MOBA camera (which looks toward -z).
      obj.rotation.y = obj.userData.structure ? -Math.PI / 2 : -u.facing;
      obj.userData.unitId = u.id;
      const mats: UnitView['mats'] = [];
      obj.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m?.isMeshStandardMaterial) mats.push({ m, emissive: m.emissive.clone(), intensity: m.emissiveIntensity });
      });
      this.scene.add(obj);
      this.units.set(u.id, { obj, prev: { ...u.pos }, prevFacing: u.facing, mats, anim, syncProps: built?.syncProps, lastAttackSeen: u.lastAttackTick });
    }
    for (const [id, v] of this.units) {
      if (live.has(id)) continue;
      this.units.delete(id);
      if (v.anim?.playOnce('Death', { persistent: true }) || v.obj.userData.structure) {
        v.obj.userData.unitId = undefined; // not pickable while dying
        this.corpses.push({ v, age: 0, collapse: !v.anim });
      } else {
        this.removeView(v);
      }
    }

    const liveMissiles = new Set<number>();
    for (const m of this.world.missiles) {
      liveMissiles.add(m.id);
      if (this.missiles.has(m.id)) continue;
      const { obj, mat, height } = missileMesh(m);
      obj.position.set(m.pos.x, height, m.pos.y);
      obj.userData.height = height;
      this.scene.add(obj);
      this.missiles.set(m.id, { obj, prev: { ...m.pos }, mat, color: mat.color.clone() });
    }
    for (const [id, v] of this.missiles) {
      if (liveMissiles.has(id)) continue;
      this.scene.remove(v.obj);
      (v.obj as THREE.Mesh).geometry.dispose();
      v.mat.dispose();
      this.missiles.delete(id);
    }
  }

  private removeView(v: UnitView) {
    this.scene.remove(v.obj);
    v.anim?.dispose();
    v.obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry?.dispose();
      for (const mat of [m.material].flat()) mat.dispose();
    });
  }

  /** Place everything at `alpha` (0..1) of the way from the previous tick to the current one. */
  update(alpha: number, dt: number) {
    this.sync();
    const tick = this.world.tick;
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.age += dt;
      if (c.collapse) {
        // Shake, lean over and sink: a quick, readable "it's gone".
        const k = Math.min(1, c.age / COLLAPSE_SECONDS);
        const o = c.v.obj;
        o.position.y = -k * k * 8;
        o.rotation.z = k * 0.35;
        o.position.x += Math.sin(c.age * 60) * 0.04 * (1 - k);
        if (c.age >= COLLAPSE_SECONDS) {
          this.removeView(c.v);
          this.corpses.splice(i, 1);
        }
        continue;
      }
      c.v.anim!.update(dt);
      c.v.syncProps?.();
      const sink = c.age - (CORPSE_SECONDS - SINK_SECONDS);
      if (sink > 0) c.v.obj.position.y = -sink * 1.2;
      if (c.age >= CORPSE_SECONDS) {
        this.removeView(c.v);
        this.corpses.splice(i, 1);
      }
    }
    for (const u of this.world.units) {
      const v = this.units.get(u.id)!;
      v.obj.visible = !u.dead;
      v.obj.position.set(v.prev.x + (u.pos.x - v.prev.x) * alpha, 0, v.prev.y + (u.pos.y - v.prev.y) * alpha);
      // Blinks and rewinds teleport: don't smear them across the lane.
      if (Math.hypot(u.pos.x - v.prev.x, u.pos.y - v.prev.y) > 3) v.obj.position.set(u.pos.x, 0, u.pos.y);
      if (u.speed > 0) v.obj.rotation.y = -lerpAngle(v.prevFacing, u.facing, alpha); // sim angle runs the other way round +Y

      if (v.anim) {
        // Skeletal: walk while moving, idle otherwise, one-shot attack clip on each new attack.
        const moving = Math.hypot(u.pos.x - v.prev.x, u.pos.y - v.prev.y) > 1e-3;
        // Library walks are paced for a ~1.8 m human; speed the cycle up to match the unit's pace.
        v.anim.setBase(moving ? 'Walk' : 'Idle', moving ? u.speed / 3.2 : 1);
        if (u.lastAttackTick !== v.lastAttackSeen) {
          v.lastAttackSeen = u.lastAttackTick;
          v.attacks = (v.attacks ?? 0) + 1;
          const name = v.attacks % 2 === 0 && v.anim.has('Attack2') ? 'Attack2' : 'Attack';
          const clip = v.anim.clip(name);
          const interval = u.attackInterval * 0.9;
          v.anim.playOnce(name, { timeScale: clip ? Math.max(1, clip.duration / interval) : 1 });
        }
        v.anim.update(dt);
        v.syncProps?.();
      } else {
        // Placeholder: a quick lean toward the target that springs back. Casting leans back a little.
        const sinceAttack = (tick - u.lastAttackTick + alpha) / u.windupTicks;
        const lunge = u.speed > 0 && sinceAttack < 2 ? Math.sin(Math.min(1, sinceAttack / 2) * Math.PI) * 0.25 : 0;
        v.obj.rotation.z = u.champ?.casting ? 0.15 : -lunge;
      }

      // Hit flash.
      const flash = Math.max(0, 1 - (tick - u.lastHurtTick + alpha) / 4);
      for (const { m, emissive, intensity } of v.mats) {
        m.emissive.copy(emissive).lerp(new THREE.Color(0xffffff), flash * 0.7);
        m.emissiveIntensity = Math.max(intensity, flash);
      }

      this.statusVisuals(u, v, dt);

      const spin = v.obj.getObjectByName('spin');
      if (spin) spin.rotation.y += dt * 0.6;
      const gear = v.obj.getObjectByName('gear');
      if (gear) gear.rotation.z += dt * (u.champ?.dash ? 12 : 1.5);
    }

    for (const m of this.world.missiles) {
      const v = this.missiles.get(m.id);
      if (!v) continue;
      const frozen = m.frozenBy != null;
      const x = frozen ? m.pos.x : v.prev.x + (m.pos.x - v.prev.x) * alpha;
      const z = frozen ? m.pos.y : v.prev.y + (m.pos.y - v.prev.y) * alpha;
      const h = v.obj.userData.height as number;
      // Tower shots drop toward their target's chest height.
      v.obj.position.set(x, m.style === 'tower' ? v.obj.position.y + (1.1 - v.obj.position.y) * Math.min(1, dt * 6) : h, z);
      v.obj.rotation.y = -Math.atan2(m.dir.y, m.dir.x);
      v.mat.color.copy(frozen ? FROZEN : v.color);
      if (frozen) v.obj.position.y += Math.sin(performance.now() / 60 + m.id) * 0.03; // shiver in place
    }
  }

  /** Shield bubble, a ring of water while rooted, and circling stars while stunned. */
  private statusVisuals(u: Unit, v: UnitView, dt: number) {
    const shielded = u.statuses.some((s) => s.kind === 'shield');
    const rooted = u.statuses.some((s) => s.kind === 'root');
    const stunned = u.statuses.some((s) => s.kind === 'stun');
    if (shielded && !v.bubble) {
      v.bubble = new THREE.Mesh(new THREE.SphereGeometry(u.radius + 0.6, 20, 14), new THREE.MeshBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0.25, depthWrite: false }));
      v.bubble.position.y = 1.1;
      v.obj.add(v.bubble);
    }
    if (rooted && !v.root) {
      v.root = new THREE.Mesh(new THREE.TorusGeometry(u.radius + 0.25, 0.12, 6, 20), new THREE.MeshBasicMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0.8 }));
      v.root.rotation.x = Math.PI / 2;
      v.root.position.y = 0.25;
      v.obj.add(v.root);
    }
    if (stunned && !v.stun) {
      v.stun = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.13), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
        star.position.set(Math.cos((i / 3) * Math.PI * 2) * 0.5, 0, Math.sin((i / 3) * Math.PI * 2) * 0.5);
        v.stun.add(star);
      }
      v.stun.position.y = 2.3;
      v.obj.add(v.stun);
    }
    if (v.bubble) v.bubble.visible = shielded;
    if (v.root) v.root.visible = rooted;
    if (v.stun) {
      v.stun.visible = stunned;
      v.stun.rotation.y += dt * 5;
    }
  }

  /** Remove everything this view added to the scene. */
  dispose() {
    for (const v of this.units.values()) this.removeView(v);
    for (const c of this.corpses) this.removeView(c.v);
    this.corpses = [];
    for (const v of this.missiles.values()) this.scene.remove(v.obj);
    this.units.clear();
    this.missiles.clear();
  }

  /** Rendered (interpolated) position of a unit. */
  positionOf(id: number) {
    return this.units.get(id)?.obj.position;
  }

  /** The unit under a screen-space ray, if any. */
  pick(ray: THREE.Raycaster): number | null {
    const objs = [...this.units.values()].filter((v) => v.obj.visible).map((v) => v.obj);
    for (const hit of ray.intersectObjects(objs, true)) {
      let o: THREE.Object3D | null = hit.object;
      while (o && o.userData.unitId == null) o = o.parent;
      if (o) return o.userData.unitId as number;
    }
    return null;
  }
}
