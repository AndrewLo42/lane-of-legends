import * as THREE from 'three';
import { holdingSpear } from '../sim/kits/aurelle';
import type { KitId, Missile, MissileStyle, Unit, Vec2 } from '../sim/types';
import { TICK_HZ, type World } from '../sim/world';
import { AnimatedModel } from './animatedModel';
import { hasModel, instantiate, type ModelName } from './assets';
import { RIGS } from './rigs';
import { KITS } from '../sim/kits';
import { TEAM_COLOR, placeholderFor } from './scene';

/** Unit → Meshy model and its in-game height (metres); placeholders are used when none is loaded. */
function modelFor(u: Unit): { name: ModelName; height: number } | undefined {
  if (u.kind === 'minion') return u.role === 'melee' ? { name: 'minion_melee', height: 1.25 } : { name: 'minion_caster', height: 1.5 };
  if (u.kind === 'tower') return { name: 'tower', height: 7.2 };
  if (u.kind === 'nexus') return { name: 'nexus', height: 6.2 };
  // Champions are oversized next to structures, as in League, so they read from the MOBA camera.
  // Tock is a big clockwork knight, Gormund a hulking minotaur; Mabel a small mouse.
  if (u.champ) return { name: `champ_${u.champ.kit}`, height: CHAMP_HEIGHT[u.champ.kit] ?? 2.5 };
  return undefined;
}
const CHAMP_HEIGHT: Partial<Record<KitId, number>> = { tock: 2.8, gormund: 3.1, sable: 2.7, mabel: 2.0 };
/** Gormund's Labyrinth Rage: he grows this much while it lasts. */
const RAGE_GROWTH = 1.3;
const SLOT_CLIP = ['CastQ', 'CastW', 'CastE', 'CastR'];
/** A dead champion's body stays visible this long (its death clip), then hides until respawn. */
const CHAMP_CORPSE_SECONDS = 2.5;
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
  /** Rage (red) or Ghost (pale) aura at the feet. */
  aura?: THREE.Mesh;
  /** Ignite: a flame over the head. */
  flame?: THREE.Mesh;
  /** Tagged by a Tether: a line back to the caster. */
  tether?: THREE.Line;
  /** Mabel's stings: bees buzzing around the target, one per sting (up to five). */
  stings?: THREE.Group;
  /** Honeyed: an amber ring at the feet. */
  honey?: THREE.Mesh;
  /** Arlo's Triangulate bearings: gold rune pips, one per stack. */
  bearings?: THREE.Group;
  /** Aurelle's Arsenal Ascendant: spectral lances circling her. */
  lances?: THREE.Group;
  /** Aurelle's spear stuck in this unit. */
  impaled?: THREE.Mesh;
  /** Sable's Reaping window on this unit: a gold crescent overhead and a chain ring at the feet. */
  reaping?: THREE.Group;
  /** Mark indicator: a ring at the feet and a petal overhead, in the marker's colour. */
  mark?: { ring: THREE.Mesh; petal: THREE.Mesh; color: string };
  prev: Vec2;
  prevFacing: number;
  /** Materials with their resting emissive, for the hit flash. */
  mats: { m: THREE.MeshStandardMaterial; emissive: THREE.Color; intensity: number }[];
  /** Skeletal animation, when the unit uses a Meshy model instead of a placeholder. */
  anim?: AnimatedModel;
  /** Moves props after the animation updates (the caster's staff to its hand; Tock's pendulum floats). */
  syncProps?: (dt?: number) => void;
  /** Swings a floating prop (Tock's pendulum) on attacks and casts. */
  swingProp?: () => void;
  lastAttackSeen?: number;
  /** Alternates Attack / Attack2 so swings don't look identical. */
  attacks?: number;
  lastCastSeen?: number;
  /** Seconds since a champion died (null while alive). */
  deadFor?: number | null;
}

interface MissileView {
  obj: THREE.Object3D;
  prev: Vec2;
  mat: THREE.MeshBasicMaterial;
  color: THREE.Color;
}

const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/** Height of a unit's health bar anchor above its feet. */
export const BAR_HEIGHT: Record<Unit['kind'], number> = { champion: 3.0, minion: 1.6, tower: 7.6, nexus: 6.6 };

const FROZEN = new THREE.Color(0xd8fffb);
/** Champions that float instead of walking, and how high (Aurelle). */
const FLOAT_HEIGHT: Partial<Record<KitId, number>> = { aurelle: 0.35 };
/** How fast a floater's idle plays while she glides (1 = normal). */
const GLIDE_IDLE_SPEED = 0.3;

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
    petal: () => ({ geo: new THREE.ConeGeometry(0.16, 0.9, 4).rotateZ(-Math.PI / 2).scale(1, 0.35, 1), color: 0xf7a8c8, height: 1.2 }),
    // Bee: a small striped body (Mabel's autos, stings, hive and Queen's Fury).
    bee: () => ({ geo: new THREE.SphereGeometry(0.13, 8, 6).scale(1.5, 1, 1), color: 0xf2b632, height: 1.0 }),
    // Aurelle's spear: a long glowing shaft with a leaf blade, point forward; Arsenal's lances are ghostly copies.
    spear: () => ({ geo: new THREE.CylinderGeometry(0.03, 0.12, 1.6, 6).rotateZ(-Math.PI / 2), color: 0xc9b6ff, height: 1.2 }),
    lance: () => ({ geo: new THREE.CylinderGeometry(0.03, 0.12, 1.6, 6).rotateZ(-Math.PI / 2), color: 0xe6dcff, height: 1.3, opacity: 0.55 }),
    // Tether: a glowing hook, open end forward.
    // Gormund's Hurl Stone: a tumbling chunk of labyrinth floor.
    stone: () => ({ geo: new THREE.DodecahedronGeometry(0.42), color: 0x8f877b, height: 1.3 }),
    // Sable's Reaping Hook: the scythe's crescent blade, flying point-first on its chain.
    hook: () => ({ geo: new THREE.TorusGeometry(0.42, 0.06, 6, 18, Math.PI * 1.1).rotateZ(-Math.PI * 0.55).rotateX(Math.PI / 2), color: 0xe6dcb0, height: 1.2 }),
    tether: () => ({ geo: new THREE.TorusGeometry(0.22, 0.05, 6, 16, Math.PI * 1.4).rotateZ(Math.PI * 0.3).rotateX(Math.PI / 2), color: 0xc9f2ff, height: 1.1 }),
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
      // Champions keep their own colours (health bars show the team); everything else wears it.
      const tint = u.champ ? null : new THREE.Color(TEAM_COLOR[u.team]);
      const built = model && hasModel(model.name) ? instantiate(model.name, model.height, tint) : null;
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
      this.units.set(u.id, { obj, prev: { ...u.pos }, prevFacing: u.facing, mats, anim, syncProps: built?.syncProps, swingProp: built?.swingProp, lastAttackSeen: u.lastAttackTick });
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
    if (v.tether) {
      this.scene.remove(v.tether);
      v.tether.geometry.dispose();
    }
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
      c.v.syncProps?.(dt);
      const sink = c.age - (CORPSE_SECONDS - SINK_SECONDS);
      if (sink > 0) c.v.obj.position.y = -sink * 1.2;
      if (c.age >= CORPSE_SECONDS) {
        this.removeView(c.v);
        this.corpses.splice(i, 1);
      }
    }
    for (const u of this.world.units) {
      const v = this.units.get(u.id)!;
      if (v.anim && u.champ) {
        // Champions play their death clip, stay down briefly, then hide until they respawn.
        if (u.dead && v.deadFor == null) {
          v.deadFor = 0;
          v.anim.playOnce('Death', { persistent: true });
        } else if (!u.dead && v.deadFor != null) {
          v.deadFor = null;
          v.anim.stopOverlay();
        }
        if (v.deadFor != null) v.deadFor += dt;
        v.obj.visible = !u.dead || (v.deadFor ?? 0) < CHAMP_CORPSE_SECONDS;
      } else {
        v.obj.visible = !u.dead;
      }
      v.obj.position.set(v.prev.x + (u.pos.x - v.prev.x) * alpha, 0, v.prev.y + (u.pos.y - v.prev.y) * alpha);
      // Blinks and rewinds teleport: don't smear them across the lane.
      if (Math.hypot(u.pos.x - v.prev.x, u.pos.y - v.prev.y) > 3) v.obj.position.set(u.pos.x, 0, u.pos.y);
      if (u.speed > 0) v.obj.rotation.y = -lerpAngle(v.prevFacing, u.facing, alpha); // sim angle runs the other way round +Y
      // Floaters (Aurelle) hover off the ground with a slow bob and glide instead of running.
      const hover = u.champ && !u.dead ? FLOAT_HEIGHT[u.champ.kit] : undefined;
      if (hover != null) v.obj.position.y = hover + Math.sin(performance.now() / 600 + u.id) * 0.08;
      if (u.champ?.kit === 'aurelle') this.aurelleVisuals(u, v);
      if (u.champ?.kit === 'gormund') {
        // Labyrinth Rage: swell up over a fifth of a second, shrink back when it ends.
        const goal = !u.dead && u.statuses.some((s) => s.kind === 'unstoppable' && s.until > tick) ? RAGE_GROWTH : 1;
        const s = v.obj.scale.x + (goal - v.obj.scale.x) * Math.min(1, dt * 10);
        v.obj.scale.setScalar(s);
      }

      if (v.anim) {
        // Skeletal: run/walk while moving, idle otherwise, one-shot clips for attacks and casts.
        const moving = !u.dead && Math.hypot(u.pos.x - v.prev.x, u.pos.y - v.prev.y) > 1e-3;
        // Library cycles are paced for a ~1.8 m human (walk ≈ 3.2 m/s, run ≈ 5.8 m/s); match the unit's pace.
        const gait = v.anim.has('Run') ? 'Run' : 'Walk';
        const glides = hover != null; // floaters keep their idle pose while they move, slowed right down so its
        // hand gestures come round rarely and she reads as calmly gliding
        v.anim.setBase(moving && !glides ? gait : 'Idle', moving ? (glides ? GLIDE_IDLE_SPEED : u.speed / (gait === 'Run' ? 5.8 : 3.2)) : 1);
        const cast = u.champ?.lastCast;
        if (cast && cast.tick !== v.lastCastSeen && !u.dead) {
          v.lastCastSeen = cast.tick;
          const name = SLOT_CLIP[cast.slot];
          const clip = v.anim.clip(name);
          // Trimmed cast clips peak mid-way: land that peak when the ability fires.
          const timeScale = clip ? THREE.MathUtils.clamp((clip.duration * 0.5) / Math.max(cast.time, 0.25), 0.8, 2.5) : 1;
          v.anim.playOnce(name, { timeScale });
          v.swingProp?.();
          v.lastAttackSeen = u.lastAttackTick;
        } else if (u.lastAttackTick !== v.lastAttackSeen && !u.dead) {
          v.lastAttackSeen = u.lastAttackTick;
          v.attacks = (v.attacks ?? 0) + 1;
          const name = v.attacks % 2 === 0 && v.anim.has('Attack2') ? 'Attack2' : 'Attack';
          const clip = v.anim.clip(name);
          const interval = u.attackInterval * 0.9;
          v.anim.playOnce(name, { timeScale: clip ? Math.max(1, clip.duration / interval) : 1 });
          v.swingProp?.();
        }
        v.anim.update(dt);
        v.syncProps?.(dt);
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

  /** Mabel's stings (orbiting bees) and honey (an amber ring). */
  private beeVisuals(u: Unit, v: UnitView) {
    const now = performance.now() / 1000;
    const stings = u.statuses.filter((s) => s.kind === 'sting' && s.until > this.world.tick).length;
    if (stings && !v.stings) {
      v.stings = new THREE.Group();
      const body = new THREE.MeshBasicMaterial({ color: 0xf2b632 });
      for (let i = 0; i < 5; i++) {
        const bee = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6).scale(1.5, 1, 1), body);
        bee.name = `bee${i}`;
        v.stings.add(bee);
      }
      v.stings.position.y = 1.3;
      v.obj.add(v.stings);
    }
    if (v.stings) {
      v.stings.visible = stings > 0;
      v.stings.children.forEach((bee, i) => {
        bee.visible = i < stings;
        const a = now * 6 + (i / 5) * Math.PI * 2;
        const r = u.radius + 0.25;
        bee.position.set(Math.cos(a) * r, Math.sin(now * 11 + i) * 0.2, Math.sin(a) * r);
        bee.rotation.y = -a;
      });
    }
    const honeyed = u.statuses.some((s) => s.kind === 'honey' && s.until > this.world.tick);
    if (honeyed && !v.honey) {
      v.honey = new THREE.Mesh(new THREE.RingGeometry(u.radius, u.radius + 0.3, 24), new THREE.MeshBasicMaterial({ color: 0xf2a516, transparent: true, opacity: 0.75, depthWrite: false }));
      v.honey.rotation.x = -Math.PI / 2;
      v.honey.position.y = 0.07;
      v.obj.add(v.honey);
    }
    if (v.honey) v.honey.visible = honeyed;

    const bearings = u.statuses.find((s) => s.kind === 'bearing' && s.until > this.world.tick)?.value ?? 0;
    if (bearings && !v.bearings) {
      v.bearings = new THREE.Group();
      const gold = new THREE.MeshBasicMaterial({ color: 0xffd76a });
      for (let i = 0; i < 2; i++) v.bearings.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.11), gold));
      v.bearings.position.y = 1.6;
      v.obj.add(v.bearings);
    }
    if (v.bearings) {
      v.bearings.visible = bearings > 0;
      v.bearings.children.forEach((pip, i) => {
        pip.visible = i < bearings;
        const a = now * 3 + i * Math.PI;
        pip.position.set(Math.cos(a) * (u.radius + 0.3), 0, Math.sin(a) * (u.radius + 0.3));
      });
    }
  }

  /**
   * Aurelle: her floating spear (hidden while it's thrown), a ring of spectral lances during Arsenal
   * Ascendant, and a spear stuck in whoever she impaled (drawn on them, below).
   */
  private aurelleVisuals(u: Unit, v: UnitView) {
    const held = v.obj.getObjectByName('heldSpear');
    if (held) held.visible = holdingSpear(u) && !u.statuses.some((s) => s.kind === 'arsenal');
    const arsenal = u.statuses.some((s) => s.kind === 'arsenal' && s.until > this.world.tick);
    if (arsenal && !v.lances) {
      v.lances = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0xe6dcff, transparent: true, opacity: 0.6 });
      for (let i = 0; i < 6; i++) {
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.09, 1.3, 6), mat);
        l.rotation.z = Math.PI; // points down
        v.lances.add(l);
      }
      v.lances.position.y = 1.6;
      v.obj.add(v.lances);
    }
    if (v.lances) {
      v.lances.visible = arsenal;
      const t = performance.now() / 1000;
      v.lances.children.forEach((l, i) => {
        const a = t * 1.5 + (i / 6) * Math.PI * 2;
        l.position.set(Math.cos(a) * 1.2, Math.sin(t * 3 + i) * 0.1, Math.sin(a) * 1.2);
      });
    }
  }

  /** A spear stuck in a unit Aurelle impaled. */
  private impaleVisual(u: Unit, v: UnitView) {
    const on = u.statuses.some((s) => s.kind === 'impale' && s.until > this.world.tick);
    if (on && !v.impaled) {
      v.impaled = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.1, 1.5, 6), new THREE.MeshBasicMaterial({ color: 0xc9b6ff }));
      v.impaled.position.set(-0.2, 1.3, 0.1);
      v.impaled.rotation.z = 1.1;
      v.obj.add(v.impaled);
    }
    if (v.impaled) v.impaled.visible = on;
  }

  /** Sable's Reaping window: a crescent over the head and a ring at the feet, so both sides see the follow-up coming. */
  private reapingVisual(u: Unit, v: UnitView) {
    const on = u.statuses.some((s) => s.kind === 'reaping' && s.until > this.world.tick);
    if (on && !v.reaping) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xe6c86b, transparent: true, opacity: 0.9, depthWrite: false });
      v.reaping = new THREE.Group();
      const moon = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.07, 6, 18, Math.PI * 1.2), mat);
      moon.position.y = BAR_HEIGHT[u.kind] + 0.9;
      moon.rotation.z = Math.PI * 0.9;
      moon.name = 'moon';
      const ring = new THREE.Mesh(new THREE.TorusGeometry(u.radius + 0.3, 0.05, 6, 28), mat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.1;
      v.reaping.add(moon, ring);
      v.obj.add(v.reaping);
    }
    if (!v.reaping) return;
    v.reaping.visible = on;
    const moon = v.reaping.getObjectByName('moon');
    if (moon) moon.position.y = BAR_HEIGHT[u.kind] + 0.9 + Math.sin(performance.now() / 250) * 0.08;
  }

  /** Rage/Ghost aura, Ignite's flame, and the Tether line. */
  private summonerVisuals(u: Unit, v: UnitView) {
    const now = performance.now() / 1000;
    const rage = u.statuses.some((s) => s.kind === 'rage');
    const haste = u.statuses.some((s) => s.kind === 'haste');
    if ((rage || haste) && !v.aura) {
      v.aura = new THREE.Mesh(new THREE.RingGeometry(u.radius + 0.1, u.radius + 0.45, 32), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      v.aura.rotation.x = -Math.PI / 2;
      v.aura.position.y = 0.06;
      v.obj.add(v.aura);
    }
    if (v.aura) {
      v.aura.visible = rage || haste;
      const m = v.aura.material as THREE.MeshBasicMaterial;
      m.color.set(rage ? 0xff4a3d : 0xd9f4ff);
      m.opacity = 0.45 + Math.sin(now * 8) * 0.15;
    }

    const burning = u.statuses.some((s) => s.kind === 'grievous');
    if (burning && !v.flame) {
      v.flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 8), new THREE.MeshBasicMaterial({ color: 0xff7a2e, transparent: true, opacity: 0.85 }));
      v.flame.position.y = 2.6;
      v.obj.add(v.flame);
    }
    if (v.flame) {
      v.flame.visible = burning;
      v.flame.scale.set(1, 0.8 + Math.sin(now * 14) * 0.25, 1);
    }

    const tag = u.statuses.find((s) => s.kind === 'tether' && s.until > this.world.tick);
    const caster = tag && this.units.get(tag.sourceId);
    if (tag && caster && !v.tether) {
      v.tether = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xc9f2ff }));
      this.scene.add(v.tether);
    }
    if (v.tether) {
      v.tether.visible = !!(tag && caster);
      if (tag && caster) {
        const a = v.obj.position;
        const b = caster.obj.position;
        v.tether.geometry.setFromPoints([new THREE.Vector3(a.x, 1.1, a.z), new THREE.Vector3(b.x, 1.1, b.z)]);
      }
    }
  }

  /** Shield bubble, a ring of water while rooted, circling stars while stunned, and summoner spell effects. */
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
    this.markVisual(u, v, dt);
    this.summonerVisuals(u, v);
    this.beeVisuals(u, v);
    this.impaleVisual(u, v);
    this.reapingVisual(u, v);
    if (v.bubble) v.bubble.visible = shielded;
    if (v.root) v.root.visible = rooted;
    if (v.stun) {
      v.stun.visible = stunned;
      v.stun.rotation.y += dt * 5;
    }
  }

  /**
   * Marked units (Lisha's E/R, Arlo's W) wear a pulsing ring at their feet and a spinning petal
   * overhead, coloured for whoever marked them, fading out over the mark's last second.
   */
  private markVisual(u: Unit, v: UnitView, dt: number) {
    const st = u.statuses.find((x) => x.kind === 'mark' && x.until > this.world.tick);
    const marker = st && this.world.get(st.sourceId);
    const color = marker?.champ ? KITS[marker.champ.kit].color : '#ffffff';
    if (st && (!v.mark || v.mark.color !== color)) {
      if (v.mark) v.obj.remove(v.mark.ring, v.mark.petal);
      const mat = () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(u.radius + 0.35, 0.07, 6, 28), mat());
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.08;
      // A four-pointed petal (a flattened octahedron) floating above the head.
      const petal = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), mat());
      petal.scale.set(1, 1.5, 0.35);
      petal.position.y = BAR_HEIGHT[u.kind] + 0.9;
      v.obj.add(ring, petal);
      v.mark = { ring, petal, color };
    }
    if (!v.mark) return;
    v.mark.ring.visible = v.mark.petal.visible = !!st;
    if (!st) return;
    const left = (st.until - this.world.tick) / TICK_HZ;
    const fade = Math.min(1, left); // fade over the last second
    const pulse = 1 + Math.sin(performance.now() / 120) * 0.08;
    v.mark.ring.scale.setScalar(pulse);
    (v.mark.ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * fade;
    (v.mark.petal.material as THREE.MeshBasicMaterial).opacity = 0.95 * fade;
    v.mark.petal.rotation.y += dt * 3;
    // Bob gently above the health bar (which is drawn at BAR_HEIGHT and would hide anything lower).
    v.mark.petal.position.y = BAR_HEIGHT[u.kind] + 0.9 + Math.sin(performance.now() / 300) * 0.08;
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
