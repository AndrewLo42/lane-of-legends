import * as THREE from 'three';
import type { Aim } from '../sim/kits/types';
import type { Fx, Team, Telegraph, Vec2, Zone } from '../sim/types';
import { pincerShape } from '../sim/util';
import { TICK_HZ, type World } from '../sim/world';
import { TEAM_COLOR } from './scene';

const TIME = 0x5fd0c4; // Tock's teal
const WATER = 0x7fe0ff; // Maren's tides
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
  private zones = new Map<number, { g: THREE.Group; z: Zone; from?: Vec2 }>();
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
      const flag = v.g.getObjectByName('flag');
      if (flag) {
        // Thrown from its owner: an arc from his hands to where it plants, then a flutter in the wind.
        const age = (this.world.tick - z.start) / TICK_HZ;
        const k = Math.min(1, age / 0.35);
        const owner = this.world.get(z.ownerId);
        const from = v.from ?? (v.from = owner ? { x: owner.pos.x - z.pos.x, y: owner.pos.y - z.pos.y } : { x: 0, y: 0 });
        flag.position.set(from.x * (1 - k), 1.2 * (1 - k) + Math.sin(Math.PI * k) * 1.6, from.y * (1 - k));
        flag.rotation.z = (1 - k) * 0.9;
        const cloth = flag.getObjectByName('cloth') as THREE.Mesh | undefined;
        if (cloth) cloth.rotation.y = Math.sin(performance.now() / 260 + z.id) * 0.25;
      }
      const hand = v.g.getObjectByName('hand');
      if (hand) hand.rotation.y -= dt * (z.kind === 'stasis' ? 1.2 : z.kind === 'maelstrom' ? 2.5 : 4);
      const timer = v.g.getObjectByName('timer') as THREE.Mesh | undefined;
      if (timer) {
        timer.geometry.dispose();
        const [r0, r1] = z.kind === 'hive' ? [0.9, 1.05] : [z.radius + 0.15, z.radius + 0.35];
        timer.geometry = new THREE.RingGeometry(r0, r1, 48, 1, Math.PI / 2, Math.PI * 2 * Math.max(0, left / total));
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
    } else if (z.kind === 'maelstrom') {
      const floor = ringShape(z.radius, z.radius, mat(0x1d5f86, 0.35));
      floor.position.y = 0.03;
      const rim = ringShape(z.radius, 0.14, mat(team, 0.8));
      rim.position.y = 0.04;
      // Spiral arms, spun by the 'hand' rotation in syncZones.
      const hand = new THREE.Group();
      hand.name = 'hand';
      hand.position.y = 0.06;
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          const r = z.radius * (0.25 + j * 0.2);
          const arc = flat(new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 24, 1, (i / 4) * Math.PI * 2 + j * 0.5, Math.PI / 3), mat(WATER, 0.6)));
          hand.add(arc);
        }
      }
      g.add(floor, rim, hand);
    } else if (z.kind === 'glyph') {
      // Aurelle's Glyph Step: a violet rune circle with a six-point star, about to detonate.
      const ring = ringShape(z.radius, 0.12, mat(0xa98bff, 0.9));
      ring.position.y = 0.04;
      const floor = ringShape(z.radius, z.radius, mat(0xa98bff, 0.15));
      floor.position.y = 0.03;
      const hand = new THREE.Group();
      hand.name = 'hand';
      hand.position.y = 0.05;
      for (const off of [0, Math.PI / 3]) {
        const tri = flat(new THREE.Mesh(new THREE.RingGeometry(z.radius * 0.7, z.radius * 0.78, 3, 1, off), mat(0xd9ccff, 0.8)));
        hand.add(tri);
      }
      g.add(floor, ring, hand);
    } else if (z.kind === 'spear') {
      // Aurelle's spear stuck point-down in the lane, with a soft glow ring so it's easy to spot.
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 6), new THREE.MeshStandardMaterial({ color: 0xe9e4ea, metalness: 0.7, roughness: 0.3 }));
      shaft.position.y = 0.75;
      shaft.rotation.z = 0.25;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.35, 6), basic(0xa98bff, 1));
      tip.position.set(0.05, -0.1, 0);
      tip.rotation.x = Math.PI;
      const glowRing = ringShape(0.6, 0.08, mat(0xa98bff, 0.7));
      glowRing.position.y = 0.04;
      g.add(shaft, tip, glowRing);
    } else if (z.kind === 'standard' || z.kind === 'banner') {
      // Gerrit's standard (E) or one of his old banners (R): a pole with a cloth in his team's colour and a
      // faint ring showing where Hold the Ground applies. It flies in from him (see syncZones), then stands.
      const big = z.kind === 'standard';
      const flag = new THREE.Group();
      flag.name = 'flag';
      const wood = new THREE.MeshStandardMaterial({ color: big ? 0x5b3a1e : 0x6e6a62, roughness: 0.8 });
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, big ? 2.6 : 2.0, 6), wood);
      pole.position.y = big ? 1.3 : 1.0;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 6), new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.7, roughness: 0.35 }));
      cap.position.y = (big ? 2.6 : 2.0) + 0.1;
      const clothMat = new THREE.MeshStandardMaterial({ color: team, side: THREE.DoubleSide, roughness: 0.7, transparent: !big, opacity: big ? 1 : 0.75 });
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(big ? 0.9 : 0.6, big ? 1.1 : 0.8, 6, 1), clothMat);
      cloth.name = 'cloth';
      cloth.position.set((big ? 0.9 : 0.6) / 2 + 0.05, (big ? 2.6 : 2.0) - (big ? 0.6 : 0.45), 0);
      const emblem = new THREE.Mesh(new THREE.CircleGeometry(big ? 0.2 : 0.14, 12), new THREE.MeshBasicMaterial({ color: 0xe8cf7a, side: THREE.DoubleSide }));
      emblem.position.set(0, 0, 0.01);
      cloth.add(emblem);
      flag.add(pole, cap, cloth);
      const ring = ringShape(big ? 0.75 : 0.55, 0.08, mat(team, 0.7));
      ring.position.y = 0.04;
      g.add(flag, ring);
      if (big) {
        const hold = ringShape(4, 0.06, mat(0xc9a24a, 0.22)); // Hold the Ground's reach
        hold.position.y = 0.03;
        g.add(hold);
      }
    } else if (z.kind === 'sanctuary') {
      // Lumen's Sanctuary: a soft gold floor with a bright rim, a slowly turning rune, and pillars of light.
      const floor = ringShape(z.radius, z.radius, mat(0xffe6a0, 0.18));
      floor.position.y = 0.03;
      const rim = ringShape(z.radius, 0.14, mat(0xffd46a, 0.85));
      rim.position.y = 0.04;
      const hand = new THREE.Group();
      hand.name = 'hand';
      hand.position.y = 0.05;
      const rune = flat(new THREE.Mesh(new THREE.RingGeometry(z.radius * 0.55, z.radius * 0.62, 6), mat(0xfff1c2, 0.6)));
      hand.add(rune);
      g.add(floor, rim, hand);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 1.6, 6, 1, true), mat(0xffe39a, 0.35));
        pillar.position.set(Math.cos(a) * z.radius * 0.9, 0.8, Math.sin(a) * z.radius * 0.9);
        g.add(pillar);
      }
    } else if (z.kind === 'net') {
      // Fennick's Snare Shot: a rope net spread on the ground, weighted at the edge, with a ring
      // counting down to the root.
      const rope = mat(0xd8c89a, 0.85);
      const floor = ringShape(z.radius, z.radius, mat(0xd8c89a, 0.12));
      floor.position.y = 0.03;
      const rim = ringShape(z.radius, 0.08, rope);
      rim.position.y = 0.05;
      g.add(floor, rim);
      for (let i = 0; i < 3; i++) {
        const r = ringShape(z.radius * (0.3 + i * 0.22), 0.04, rope);
        r.position.y = 0.05;
        g.add(r);
      }
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI;
        const strand = flat(new THREE.Mesh(new THREE.PlaneGeometry(z.radius * 2, 0.04), rope));
        strand.rotation.z = a;
        strand.position.y = 0.05;
        g.add(strand);
        const weight = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), new THREE.MeshStandardMaterial({ color: 0x55504a, metalness: 0.6 }));
        weight.position.set(Math.cos(a * 2) * z.radius, 0.09, Math.sin(a * 2) * z.radius);
        g.add(weight);
      }
      const timer = flat(new THREE.Mesh(new THREE.RingGeometry(z.radius + 0.15, z.radius + 0.35, 48), mat(0xc9e8d8, 0.9)));
      timer.name = 'timer';
      timer.position.y = 0.06;
      g.add(timer);
    } else if (z.kind === 'honey') {
      // A glossy amber puddle with a few darker drips.
      const puddle = ringShape(z.radius, z.radius, mat(0xf2a516, 0.55));
      puddle.position.y = 0.03;
      const rim = ringShape(z.radius, 0.1, mat(0xc97a00, 0.8));
      rim.position.y = 0.04;
      g.add(puddle, rim);
      for (let i = 0; i < 5; i++) {
        const blob = flat(new THREE.Mesh(new THREE.CircleGeometry(0.25 + (i % 2) * 0.15, 12), mat(0xd98a00, 0.7)));
        const a = i * 2.4;
        blob.position.set(Math.cos(a) * z.radius * 0.55, 0.05, Math.sin(a) * z.radius * 0.45);
        g.add(blob);
      }
    } else if (z.kind === 'hive') {
      // A stacked straw skep with a dark entrance, a faint range ring, and a countdown ring.
      const straw = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.9, flatShading: true });
      for (let i = 0; i < 4; i++) {
        const r = 0.62 - i * 0.12;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.13, 6, 16), straw);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.15 + i * 0.24;
        g.add(ring);
      }
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), straw);
      cap.position.y = 0.95;
      const door = new THREE.Mesh(new THREE.CircleGeometry(0.13, 10), new THREE.MeshBasicMaterial({ color: 0x2a1a08 }));
      door.position.set(0.66, 0.2, 0);
      door.rotation.y = Math.PI / 2;
      const range = ringShape(z.radius, 0.08, mat(team, 0.35));
      range.position.y = 0.03;
      const timer = flat(new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 48), mat(0xf2b632, 0.9)));
      timer.name = 'timer';
      timer.position.y = 0.04;
      g.add(cap, door, range, timer);
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
      case 'bloom': {
        // Find Your Center / Petal Harvest: a soft ring of blossom pink rising around her.
        const r = ringShape(fx.radius ?? 1, 0.2, basic(0xf7a8c8, 0.9));
        add(r, 0.7, (k) => {
          fade(r, 0.9)(k);
          r.scale.setScalar(0.6 + k * 0.8);
          r.position.y = 0.06 + k * 1.2;
        });
        break;
      }
      case 'splash':
      case 'erupt': {
        const big = fx.kind === 'erupt';
        const r = ringShape(fx.radius ?? 2, 0.3, basic(WATER, 0.9));
        add(r, big ? 0.6 : 0.4, (k) => {
          fade(r, 0.9)(k);
          r.scale.setScalar(0.5 + k * 0.7);
        });
        const dome = new THREE.Mesh(new THREE.SphereGeometry(fx.radius ?? 2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), basic(WATER, 0.45));
        add(dome, big ? 0.6 : 0.35, (k) => {
          fade(dome, 0.45)(k);
          dome.scale.set(0.6 + k * 0.5, (big ? 1.4 : 0.6) * (1 - k * 0.6), 0.6 + k * 0.5);
        });
        break;
      }
      case 'triangulate': {
        // Arlo's Triangulate: a gold triangle that flashes out from the target.
        const tri = flat(new THREE.Mesh(new THREE.RingGeometry(0.75, 1, 3), basic(0xffd76a, 0.95)));
        tri.position.set(0, 0.08, 0);
        add(tri, 0.45, (k) => {
          fade(tri, 0.95)(k);
          tri.scale.setScalar(0.6 + k * 1.4);
          tri.rotation.z = k * 1.2;
        });
        break;
      }
      // ---- Fennick ----
      case 'zap': {
        // Spark arrow: a bolt of yellow lightning jumping to the next enemy.
        const g = new THREE.Group();
        g.rotation.y = -(fx.dir ?? 0);
        g.position.y = 1;
        const bolt = lineShape(fx.radius ?? 2, 0.12, basic(0xfff1a0, 0.95));
        g.add(bolt);
        add(g, 0.22, (k) => {
          fade(bolt, 0.95)(k);
          bolt.position.y = Math.sin(k * 40) * 0.05;
        });
        break;
      }
      case 'volley': {
        // Volley readied: three rings, frost, fire and spark, spinning up around him.
        [0x8fd8ff, 0xff8a3d, 0xffe14a].forEach((color, i) => {
          const r = ringShape(0.7 + i * 0.12, 0.08, basic(color, 0.9));
          add(r, 0.5, (k) => {
            fade(r, 0.9)(k);
            r.position.y = 0.3 + i * 0.5 + k * 0.4;
          });
        });
        break;
      }
      // ---- summoner spells ----
      case 'ignite': {
        // A flare of fire on the target.
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.7, 14, 10), basic(0xff7a2e, 0.75));
        s.position.y = 1.2;
        add(s, 0.45, (k) => {
          fade(s, 0.75)(k);
          s.scale.set(0.5 + k, 0.5 + k * 1.8, 0.5 + k);
          s.position.y = 1.2 + k * 0.8;
        });
        break;
      }
      case 'ghost':
      case 'barrier':
      case 'rage': {
        // A ring that sweeps up the body: pale for Ghost, gold for Barrier, red for Rage.
        const color = fx.kind === 'ghost' ? 0xd9f4ff : fx.kind === 'barrier' ? 0xffd76a : 0xff4a3d;
        const r = ringShape(0.9, 0.16, basic(color, 0.9));
        add(r, 0.6, (k) => {
          fade(r, 0.9)(k);
          r.scale.setScalar(1.3 - k * 0.4);
          r.position.y = 0.06 + k * 2.2;
        });
        break;
      }
      // ---- Gormund ----
      case 'bellow': {
        // Labyrinth roar: two rust-red shockwave rings racing out to the edge of its reach.
        for (const [delay, opacity] of [[0, 0.85], [0.25, 0.5]] as const) {
          const r = ringShape(fx.radius ?? 3, 0.25, basic(0xd0603a, opacity));
          add(r, 0.55, (k) => {
            const t = Math.max(0, (k - delay) / (1 - delay));
            (r.material as THREE.MeshBasicMaterial).opacity = t > 0 ? opacity * (1 - t) : 0;
            r.scale.setScalar(0.2 + t * 0.85);
          });
        }
        break;
      }
      // ---- Hollis ----
      case 'whistle': {
        // Whistle: soft green notes rising round him, and a ring sweeping out over the flock it calls.
        const r = ringShape(fx.radius ?? 7, 0.12, basic(0xd8f0b0, 0.7));
        add(r, 0.5, (k) => {
          fade(r, 0.7)(k);
          r.scale.setScalar(0.15 + k * 0.85);
        });
        for (let i = 0; i < 3; i++) {
          const note = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), basic(0xeaffc8, 0.95));
          const a = (i / 3) * Math.PI * 2;
          add(note, 0.7, (k) => {
            fade(note, 0.95)(k);
            note.position.set(Math.cos(a + k * 2) * 0.7, 1.8 + k * 1.4, Math.sin(a + k * 2) * 0.7);
          });
        }
        break;
      }
      case 'herd': {
        // Crook and Bramble: a ring of dust where the flock is turned.
        const r = ringShape(fx.radius ?? 1, 0.2, basic(0xc8b48a, 0.85));
        add(r, 0.45, (k) => {
          fade(r, 0.85)(k);
          r.scale.setScalar(0.4 + k * 0.8);
        });
        break;
      }
      case 'bind': {
        // Sable's Bind: a gold chain ring that cinches in around the target.
        const r = ringShape((fx.radius ?? 1) + 0.6, 0.12, basic(0xe6c86b, 0.95));
        r.position.y = 0.8;
        add(r, 0.4, (k) => {
          fade(r, 0.95)(k);
          r.scale.setScalar(1.6 - k * 0.7);
        });
        break;
      }
      case 'thrust': {
        // Halberd Thrust: a bright streak along the line, fading forward.
        const g = new THREE.Group();
        g.rotation.y = -(fx.dir ?? 0);
        const streak = lineShape(fx.radius ?? 6, 0.5, basic(0xf3e2a0, 0.8));
        const core = lineShape(fx.radius ?? 6, 0.16, basic(0xffffff, 0.95));
        core.position.y = 0.01;
        g.add(streak, core);
        add(g, 0.3, (k) => {
          fade(streak, 0.8)(k);
          fade(core, 0.95)(k);
          g.scale.set(0.6 + 0.4 * Math.min(1, k * 3), 1, 1 - k * 0.6);
        });
        break;
      }
      case 'slam': {
        // Bull Rush's impact: a dust ring and a low brown dome.
        const r = ringShape(fx.radius ?? 1.4, 0.35, basic(0xb89a72, 0.9));
        add(r, 0.45, (k) => {
          fade(r, 0.9)(k);
          r.scale.setScalar(0.5 + k * 1.1);
        });
        const dome = new THREE.Mesh(new THREE.SphereGeometry(fx.radius ?? 1.4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), basic(0x8a7458, 0.5));
        add(dome, 0.4, (k) => {
          fade(dome, 0.5)(k);
          dome.scale.set(0.6 + k * 0.6, 0.5 * (1 - k), 0.6 + k * 0.6);
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
      if (aim.shape === 'target') {
        // Range ring plus a pick marker that follows the cursor.
        this.group.add(ringShape(aim.range, 0.08, mat));
        const target = ringShape(0.7, 0.18, mat);
        target.name = 'target';
        this.group.add(target);
      }
      if (aim.shape === 'ring') this.group.add(ringShape(aim.radius, 0.1, castable ? basic(0xff8a7a, 0.6) : mat));
      if (aim.shape === 'dash') {
        this.group.add(ringShape(aim.range, 0.08, mat));
        const arrow = lineShape(aim.range, 0.5, mat);
        arrow.name = 'dash';
        this.group.add(arrow);
      }
      if (aim.shape === 'pincer') {
        // Faint fill over the V, a blade line per arm (start → point) and a marker on the point.
        const fill = new THREE.Mesh(new THREE.BufferGeometry(), mat);
        fill.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
        fill.name = 'fill';
        this.group.add(fill);
        for (const name of ['armA', 'armB']) {
          const arm = new THREE.Group();
          arm.name = name;
          arm.add(lineShape(1, 0.35, castable ? basic(0xffffff, 0.55) : basic(0xff6b5e, 0.55)));
          this.group.add(arm);
        }
        const tip = ringShape(0.55, 0.16, castable ? basic(0xffffff, 0.7) : basic(0xff6b5e, 0.7));
        tip.name = 'tip';
        this.group.add(tip);
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
    if (aim.shape === 'pincer') {
      // Same geometry the ability uses, relative to the champion (sim y is three.js z).
      const p = pincerShape({ x: from.x, y: from.z }, cursor, aim.range, aim.minRange, aim.spread);
      const local = (v: Vec2) => new THREE.Vector3(v.x - from.x, 0, v.y - from.z);
      const tipAt = local(p.point);
      (['armA', 'armB'] as const).forEach((name, i) => {
        const arm = this.group.getObjectByName(name)!;
        const start = local(p.starts[i]);
        arm.position.copy(start);
        arm.rotation.y = -Math.atan2(tipAt.z - start.z, tipAt.x - start.x);
        arm.scale.x = start.distanceTo(tipAt);
      });
      this.group.getObjectByName('tip')!.position.copy(tipAt);
      const fill = this.group.getObjectByName('fill') as THREE.Mesh;
      const pos = fill.geometry.getAttribute('position') as THREE.BufferAttribute;
      [local(p.starts[0]), tipAt, local(p.starts[1])].forEach((v, i) => pos.setXYZ(i, v.x, 0, v.z));
      pos.needsUpdate = true;
      fill.geometry.computeBoundingSphere();
    } else if (target && (aim.shape === 'circle' || aim.shape === 'target')) {
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
