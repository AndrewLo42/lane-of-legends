import * as THREE from 'three';
import type { Hit } from '../sim/types';
import type { World } from '../sim/world';
import { BAR_HEIGHT, type WorldView } from '../render/views';

type Kind = 'attack' | 'ability' | 'dot';

interface Floater {
  el: HTMLDivElement;
  /** Where it popped (world space); it rises from here on screen. */
  at: THREE.Vector3;
  age: number;
  /** Sideways scatter in pixels, so numbers landing together don't stack. */
  dx: number;
}

const LIFE = 0.9;
/** Damage over time (burns, stings) is summed per target and shown at most this often. */
const DOT_FLUSH = 0.4;

/**
 * Floating damage numbers for the damage you deal: white for attacks, gold for abilities, orange for
 * damage over time. Bigger on champions. They pop above the target, rise and fade.
 */
export class DamageNumbers {
  private root = document.createElement('div');
  private floaters: Floater[] = [];
  private seen = 0;
  /** Damage over time building up per target: amount, seconds since the first tick, and the latest hit. */
  private dots = new Map<number, { amount: number; age: number; hit: Hit }>();
  private v = new THREE.Vector3();

  constructor(private world: World, private view: WorldView, private meId: number) {
    this.root.id = 'dmgnums';
    document.body.appendChild(this.root);
    this.seen = world.hits.at(-1)?.seq ?? 0;
  }

  update(camera: THREE.Camera, dt: number) {
    for (const h of this.world.hits) {
      if (h.seq <= this.seen) continue;
      this.seen = h.seq;
      if (h.sourceId !== this.meId || h.amount < 0.5) continue;
      if (h.proc && !h.attack) {
        const d = this.dots.get(h.targetId) ?? { amount: 0, age: 0, hit: h };
        d.amount += h.amount;
        d.hit = h;
        this.dots.set(h.targetId, d);
      } else {
        this.spawn(h, h.amount, h.attack ? 'attack' : 'ability');
      }
    }
    for (const [id, d] of this.dots) {
      d.age += dt;
      if (d.age < DOT_FLUSH) continue;
      if (d.amount >= 1) this.spawn(d.hit, d.amount, 'dot');
      this.dots.delete(id);
    }

    this.floaters = this.floaters.filter((f) => {
      f.age += dt;
      if (f.age >= LIFE) {
        f.el.remove();
        return false;
      }
      this.v.copy(f.at).project(camera);
      const x = (this.v.x * 0.5 + 0.5) * innerWidth + f.dx;
      const y = (-this.v.y * 0.5 + 0.5) * innerHeight - f.age * 55;
      const pop = f.age < 0.12 ? 1.35 - (f.age / 0.12) * 0.35 : 1; // a quick punch, then settle
      f.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${pop})`;
      f.el.style.opacity = String(f.age < LIFE - 0.35 ? 1 : (LIFE - f.age) / 0.35);
      return true;
    });
  }

  /** A number over the hit's target: where it's drawn now, or where it stood if the hit killed it (minions leave the world). */
  private spawn(hit: Hit, amount: number, kind: Kind) {
    const pos = this.view.positionOf(hit.targetId) ?? { x: hit.at.x, z: hit.at.y };
    const el = document.createElement('div');
    el.className = `dmg ${kind}${hit.targetKind === 'champion' ? ' champ' : ''}`;
    el.textContent = String(Math.round(amount));
    this.root.appendChild(el);
    const at = new THREE.Vector3(pos.x, BAR_HEIGHT[hit.targetKind] + 0.6, pos.z); // just above the health bar
    this.floaters.push({ el, at, age: 0, dx: (Math.random() * 2 - 1) * 18 });
  }

  dispose() {
    this.root.remove();
    this.floaters = [];
    this.dots.clear();
  }
}
