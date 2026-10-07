import * as THREE from 'three';
import type { Aim } from '../sim/kits/types';
import type { Fx, Team, Telegraph, Vec2, Zone } from '../sim/types';
import { TICK_HZ, type World } from '../sim/world';
import { TEAM_COLOR } from './scene';

const TIME = 0x5fd0c4; // Tock's teal
const flat = (m: THREE.Mesh) => {
  m.rotation.x = -Math.PI / 2;
  return m;
};
const basic = (color: THREE.ColorRepresentation, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });

/**
 * Flat shapes lying on the ground, built along +x from the origin so a parent group's yaw
 * (`-angle`, matching unit facing) points them.
 */
function lineShape(length: number, width: number, mat: THREE.Material) {
  const geo = new THREE.PlaneGeometry(length, width);
  geo.translate(length / 2, 0, 0);
  return flat(new THREE.Mesh(geo, mat));
}
function coneShape(radius: number, angle: number, mat: THREE.Material) {
  return flat(new THREE.Mesh(new THREE.CircleGeometry(radius, 40, -angle / 2, angle), mat));
}
function ringShape(radius: number, width: number, mat: THREE.Material) {
  return flat(new THREE.Mesh(new THREE.RingGeometry(Math.max(0, radius - width), radius, 48), mat));
}

/** Ground telegraphs, persistent zones and one-shot effects, mirrored from the sim each frame. */
export class EffectsView {
  private telegraphs = new Map<number, { g: THREE.Group; fill: THREE.Object3D; t: Telegraph }>();
  private zones = new Map<number, { g: THREE.Group; z: Zone }>();
  private bursts: { obj: THREE.Object3D; age: number; life: number; tick: (k: number) => void }[] = [];
  private seenFx = -1;

  constructor(private scene: THREE.Scene, private world: World, private myTeam: Team) {}

  update(dt: number) {
    this.syncTelegraphs();
    this.syncZones(dt);
    this.spawnFx();
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      const k = b.age / b.life;
      if (k >= 1) {
        this.scene.remove(b.obj);
        this.bursts.splice(i, 1);
      } else {
        b.tick(k);
      }
    }
  }

  /** Remove everything this view added to the scene. */
  dispose() {
    for (const v of this.telegraphs.values()) this.scene.remove(v.g);
    for (const v of this.zones.values()) this.scene.remove(v.g);
    for (const b of this.bursts) this.scene.remove(b.obj);
    this.telegraphs.clear();
    this.zones.clear();
    this.bursts = [];
  }

  // ---------- telegraphs ----------

  private syncTelegraphs() {
    const live = new Set<number>();
    for (const t of this.world.telegraphs) {
      live.add(t.id);
      let v = this.telegraphs.get(t.id);
      if (!v) {
        const color = t.team === this.myTeam ? 0xbfe3ff : 0xff3b30;
        const g = new THREE.Group();
        g.position.set(t.pos.x, 0.04, t.pos.y);
        g.rotation.y = -t.dir;
        const shape = (mat: THREE.Material) => (t.shape === 'cone' ? coneShape(t.length, t.width, mat) : t.shape === 'line' ? lineShape(t.length, t.width, mat) : ringShape(t.length, t.length, mat));
        g.add(shape(basic(color, 0.18)));
        const fill = new THREE.Group();
        fill.add(shape(basic(color, 0.3)));
        g.add(fill);
        this.scene.add(g);
        v = { g, fill, t };
        this.telegraphs.set(t.id, v);
      }
      // The inner fill grows until the ability goes off.
      const k = Math.min(1, (this.world.tick - t.start) / Math.max(1, t.end - t.start));
      if (t.shape === 'line') v.fill.scale.set(k, 1, 1);
      else v.fill.scale.setScalar(Math.max(0.01, k));
    }
    for (const [id, v] of this.telegraphs) {
      if (live.has(id)) continue;
      this.scene.remove(v.g);
      this.telegraphs.delete(id);
    }
  }

  // ---------- zones ----------

  private syncZones(dt: number) {
    const live = new Set<number>();
    for (const z of this.world.zones) {
      live.add(z.id);
      let v = this.zones.get(z.id);
      if (!v) {
        v = { g: this.buildZone(z), z };
        v.g.position.set(z.pos.x, 0, z.pos.y);
        this.scene.add(v.g);
        this.zones.set(z.id, v);
      }
      const left = (z.until - this.world.tick) / TICK_HZ;
      const total = (z.until - z.start) / TICK_HZ;
      const hand = v.g.getObjectByName('hand');
      if (hand) hand.rotation.y -= dt * (z.kind === 'stasis' ? 1.2 : 4);
      const timer = v.g.getObjectByName('timer') as THREE.Mesh | undefined;
      if (timer) {
        timer.geometry.dispose();
        timer.geometry = new THREE.RingGeometry(z.radius + 0.15, z.radius + 0.35, 48, 1, Math.PI / 2, Math.PI * 2 * Math.max(0, left / total));
      }
      v.g.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        if (m?.userData.base != null) m.opacity = m.userData.base * Math.min(1, left / 0.3);
      });
    }
    for (const [id, v] of this.zones) {
      if (live.has(id)) continue;
      this.scene.remove(v.g);
      this.zones.delete(id);
    }
  }

  private buildZone(z: Zone): THREE.Group {
    const g = new THREE.Group();
    const mat = (color: THREE.ColorRepresentation, opacity: number) => {
      const m = basic(color, opacity);
      m.userData.base = opacity;
      return m;
    };
    const team = TEAM_COLOR[z.team];
    if (z.kind === 'stasis') {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(z.radius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat(TIME, 0.13));
      const floor = ringShape(z.radius, z.radius, mat(TIME, 0.12));
      const rim = ringShape(z.radius, 0.12, mat(team, 0.8));
      const hand = new THREE.Group();
      hand.name = 'hand';
      hand.add(lineShape(z.radius * 0.9, 0.12, mat(TIME, 0.7)));
      hand.position.y = 0.05;
      for (let i = 0; i < 12; i++) {
        const tick = lineShape(0.4, 0.08, mat(TIME, 0.6));
        tick.position.set(Math.cos((i / 12) * Math.PI * 2) * (z.radius - 0.5), 0.05, Math.sin((i / 12) * Math.PI * 2) * (z.radius - 0.5));
        tick.rotation.z = -(i / 12) * Math.PI * 2; // flat shapes turn the opposite way to sim angles
        g.add(tick);
      }
      floor.position.y = rim.position.y = 0.03;
      g.add(dome, floor, rim, hand);
    } else {
      // Echo / anchor: a ghost of Tock plus a ring (the anchor's ring counts down).
      const ghost = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 1.3, 8), mat(TIME, z.kind === 'anchor' ? 0.4 : 0.28));
      ghost.position.y = 0.85;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat(TIME, z.kind === 'anchor' ? 0.4 : 0.28));
      head.position.y = 1.8;
      const ring = ringShape(z.radius + 0.1, 0.1, mat(team, 0.7));
      ring.position.y = 0.03;
      g.add(ghost, head, ring);
      if (z.kind === 'anchor') {
        const timer = flat(new THREE.Mesh(new THREE.RingGeometry(z.radius + 0.15, z.radius + 0.35, 48), mat(TIME, 0.9)));
        timer.name = 'timer';
        timer.position.y = 0.04;
        g.add(timer);
      }
    }
    return g;
  }

  // ---------- one-shot effects ----------

  private spawnFx() {
    for (const fx of this.world.fx) {
      if (fx.tick <= this.seenFx) continue;
      this.burst(fx);
    }
    if (this.world.fx.length) this.seenFx = this.world.fx[this.world.fx.length - 1].tick;
  }

  private burst(fx: Fx) {
    const at = new THREE.Vector3(fx.pos.x, 0.06, fx.pos.y);
    const add = (obj: THREE.Object3D, life: number, tick: (k: number) => void) => {
      obj.position.add(at);
      this.scene.add(obj);
      this.bursts.push({ obj, age: 0, life, tick });
      tick(0);
    };
    const fade = (m: THREE.Mesh, from: number) => (k: number) => ((m.material as THREE.MeshBasicMaterial).opacity = from * (1 - k));
    switch (fx.kind) {
      case 'swing': {
        const g = new THREE.Group();
        g.rotation.y = -(fx.dir ?? 0);
        const m = coneShape(fx.radius ?? 3, fx.angle ?? 1.5, basic(0xffffff, 0.6));
        g.add(m);
        add(g, 0.25, (k) => {
          fade(m, 0.6)(k);
          g.scale.setScalar(0.85 + k * 0.2);
        });
        break;
      }
      case 'blink':
      case 'echoHit':
      case 'dashHit':
      case 'levelUp': {
        const color = fx.kind === 'blink' ? 0xfff1b0 : fx.kind === 'levelUp' ? 0xffd76a : TIME;
        const r = ringShape(fx.kind === 'levelUp' ? 1.2 : 0.8, 0.18, basic(color, 0.9));
        add(r, fx.kind === 'levelUp' ? 0.8 : 0.35, (k) => {
          fade(r, 0.9)(k);
          r.scale.setScalar(0.4 + k * 1.4);
          if (fx.kind === 'levelUp') r.position.y = 0.06 + k * 2;
        });
        break;
      }
      case 'detonate': {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 12), basic(0xb36bff, 0.7));
        s.position.y = 1;
        add(s, 0.35, (k) => {
          fade(s, 0.7)(k);
          s.scale.setScalar(0.5 + k * 1.3);
        });
        break;
      }
      case 'rewind': {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 3, 20, 1, true), basic(TIME, 0.6));
        c.position.y = 1.5;
        add(c, 0.45, (k) => {
          fade(c, 0.6)(k);
          c.scale.set(1.6 - k, 1, 1.6 - k);
        });
        break;
      }
    }
  }
}

/** The shape you're about to cast, drawn under your champion while the key is held. */
export class AimIndicator {
  private group = new THREE.Group();
  private ok = basic(0xffffff, 0.22);
  private bad = basic(0xff6b5e, 0.22);
  private key = '';

  constructor(scene: THREE.Scene) {
    this.group.visible = false;
    this.group.position.y = 0.05;
    scene.add(this.group);
  }

  hide() {
    this.group.visible = false;
  }

  show(aim: Aim, from: THREE.Vector3, cursor: Vec2, castable: boolean) {
    const key = `${JSON.stringify(aim)}|${castable}`;
    if (key !== this.key) {
      this.key = key;
      this.group.clear();
      const mat = castable ? this.ok : this.bad;
      if (aim.shape === 'line') this.group.add(lineShape(aim.length, aim.width, mat));
      if (aim.shape === 'cone') this.group.add(coneShape(aim.radius, aim.angle, mat));
      if (aim.shape === 'dash') {
        this.group.add(ringShape(aim.range, 0.08, mat));
        const arrow = lineShape(aim.range, 0.5, mat);
        arrow.name = 'dash';
        this.group.add(arrow);
      }
      if (aim.shape === 'circle') {
        if (aim.range > 0) this.group.add(ringShape(aim.range, 0.08, mat));
        const target = ringShape(aim.radius, aim.radius, mat);
        target.name = 'target';
        this.group.add(target);
      }
    }
    const dx = cursor.x - from.x;
    const dz = cursor.y - from.z;
    const d = Math.hypot(dx, dz);
    this.group.position.set(from.x, 0.05, from.z);
    this.group.rotation.y = 0;
    const target = this.group.getObjectByName('target');
    if (target && aim.shape === 'circle') {
      const k = d > aim.range ? aim.range / d : 1;
      target.position.set(dx * k, 0, dz * k);
    } else {
      this.group.rotation.y = -Math.atan2(dz, dx);
      const dash = this.group.getObjectByName('dash');
      if (dash && aim.shape === 'dash') dash.scale.x = Math.max(0.05, Math.min(1, d / aim.range));
    }
    this.group.visible = true;
  }
}
