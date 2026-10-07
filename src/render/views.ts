import * as THREE from 'three';
import type { Missile, MissileStyle, Unit, Vec2 } from '../sim/types';
import type { World } from '../sim/world';
import { TEAM_COLOR, placeholderFor } from './scene';

interface UnitView {
  obj: THREE.Object3D;
  prev: Vec2;
  prevFacing: number;
  /** Materials with their resting emissive, for the hit flash. */
  mats: { m: THREE.MeshStandardMaterial; emissive: THREE.Color; intensity: number }[];
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
      const obj = placeholderFor(u);
      obj.userData.unitId = u.id;
      const mats: UnitView['mats'] = [];
      obj.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m?.isMeshStandardMaterial) mats.push({ m, emissive: m.emissive.clone(), intensity: m.emissiveIntensity });
      });
      this.scene.add(obj);
      this.units.set(u.id, { obj, prev: { ...u.pos }, prevFacing: u.facing, mats });
    }
    for (const [id, v] of this.units) {
      if (live.has(id)) continue;
      this.scene.remove(v.obj);
      v.obj.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.units.delete(id);
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

  /** Place everything at `alpha` (0..1) of the way from the previous tick to the current one. */
  update(alpha: number, dt: number) {
    this.sync();
    const tick = this.world.tick;
    for (const u of this.world.units) {
      const v = this.units.get(u.id)!;
      v.obj.visible = !u.dead;
      v.obj.position.set(v.prev.x + (u.pos.x - v.prev.x) * alpha, 0, v.prev.y + (u.pos.y - v.prev.y) * alpha);
      // Blinks and rewinds teleport: don't smear them across the lane.
      if (Math.hypot(u.pos.x - v.prev.x, u.pos.y - v.prev.y) > 3) v.obj.position.set(u.pos.x, 0, u.pos.y);
      if (u.speed > 0) v.obj.rotation.y = -lerpAngle(v.prevFacing, u.facing, alpha); // sim angle runs the other way round +Y

      // Attack lunge: a quick lean toward the target that springs back. Casting leans back a little.
      const sinceAttack = (tick - u.lastAttackTick + alpha) / u.windupTicks;
      const lunge = u.speed > 0 && sinceAttack < 2 ? Math.sin(Math.min(1, sinceAttack / 2) * Math.PI) * 0.25 : 0;
      v.obj.rotation.z = u.champ?.casting ? 0.15 : -lunge;

      // Hit flash.
      const flash = Math.max(0, 1 - (tick - u.lastHurtTick + alpha) / 4);
      for (const { m, emissive, intensity } of v.mats) {
        m.emissive.copy(emissive).lerp(new THREE.Color(0xffffff), flash * 0.7);
        m.emissiveIntensity = Math.max(intensity, flash);
      }

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

  /** Remove everything this view added to the scene. */
  dispose() {
    for (const v of this.units.values()) {
      this.scene.remove(v.obj);
      v.obj.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
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
