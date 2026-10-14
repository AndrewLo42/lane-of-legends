import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorldView } from '../render/views';
import { World } from '../sim/world';
import { DamageNumbers } from './damageNumbers';

/** Just enough of the DOM for the floating numbers: elements that remember their class and text. */
interface FakeEl {
  id: string;
  className: string;
  textContent: string;
  style: Record<string, string>;
  children: FakeEl[];
  appendChild(c: FakeEl): void;
  remove(): void;
}
const fakeEl = (): FakeEl => ({
  id: '', className: '', textContent: '', style: {}, children: [],
  appendChild(c) {
    this.children.push(c);
  },
  remove() {},
});

describe('damage numbers', () => {
  const g = globalThis as Record<string, unknown>;
  beforeEach(() => {
    g.document = { createElement: fakeEl, body: fakeEl() };
    g.innerWidth = 1280;
    g.innerHeight = 720;
  });
  afterEach(() => {
    delete g.document;
    delete g.innerWidth;
    delete g.innerHeight;
  });

  it('shows the killing blow on a minion, though the minion has already left the world', () => {
    const world = new World(1);
    const me = world.spawnChampion('blue', 'arlo', { think: () => [] });
    const minion = world.spawnMinion('red', 'melee', { x: me.pos.x + 2, y: me.pos.y });
    // The view only knows units still in the world, like the real one once a minion's model is gone.
    const view = { positionOf: (id: number) => (world.get(id) ? new THREE.Vector3(world.get(id)!.pos.x, 0, world.get(id)!.pos.y) : undefined) };
    const numbers = new DamageNumbers(world, view as unknown as WorldView, me.id);
    const camera = new THREE.PerspectiveCamera();

    world.dealDamage(me, minion, minion.hp + 25, { attack: true });
    world.step();
    expect(world.get(minion.id)?.dead ?? true).toBe(true);
    numbers.update(camera, 0.016);

    const shown = (document.body as unknown as FakeEl).children[0].children;
    expect(shown).toHaveLength(1);
    expect(shown[0].className).toBe('dmg attack');
    expect(Number(shown[0].textContent)).toBeGreaterThan(0);
  });
});
