import * as THREE from 'three';
import { KITS, KIT_IDS } from '../sim/kits';
import type { KitId } from '../sim/types';
import { AnimatedModel } from './animatedModel';
import { hasModel, instantiate, type ModelName } from './assets';
import { World } from '../sim/world';
import { RIGS } from './rigs';
import { placeholderFor } from './scene';

const SPACING = 3.0;

/**
 * The champion select backdrop: every champion idling on a podium. Focusing one spotlights it and
 * plays its Select flourish. Rendered by main.ts instead of the lane while the select screen is up.
 */
export class SelectStage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 100);
  active = false;
  private champs = new Map<KitId, { root: THREE.Object3D; anim?: AnimatedModel; ring: THREE.Mesh; light: THREE.SpotLight; syncProps?: (dt?: number) => void; swingProp?: () => void }>();
  private focused: KitId | null = null;
  private t = 0;

  constructor() {
    const s = this.scene;
    s.background = new THREE.Color(0x0d1016);
    s.fog = new THREE.Fog(0x0d1016, 12, 26);
    s.add(new THREE.HemisphereLight(0xbfd6ff, 0x2a2118, 0.9));
    const key = new THREE.DirectionalLight(0xfff0dc, 1.6);
    key.position.set(3, 7, 6);
    s.add(key);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshStandardMaterial({ color: 0x1c2029, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);

    KIT_IDS.forEach((kit, i) => {
      const x = (i - (KIT_IDS.length - 1) / 2) * SPACING;
      const accent = new THREE.Color(KITS[kit].color);
      const podium = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.3, 40), new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.6, metalness: 0.3 }));
      podium.position.set(x, 0.15, 0);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.16, 0.035, 8, 64),
        new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.35 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, 0.31, 0);
      const light = new THREE.SpotLight(accent, 0, 12, 0.45, 0.6);
      light.position.set(x, 7, 3);
      light.target.position.set(x, 1, 0);
      s.add(podium, ring, light, light.target);

      const model: ModelName = `champ_${kit}`;
      const built = hasModel(model) ? instantiate(model, kit === 'tock' ? 2.3 : 2.1, null) : null;
      if (!built) {
        // No Meshy model yet: stand the placeholder figure on the podium instead.
        const stand = placeholderFor(new World(1).spawnChampion('blue', kit, { think: () => [] }));
        stand.position.set(x, 0.3, 0);
        stand.rotation.y = -Math.PI / 2;
        stand.scale.setScalar(0.95);
        s.add(stand);
        this.champs.set(kit, { root: stand, ring, light });
        return;
      }
      built.root.position.set(x, 0.3, 0);
      built.root.rotation.y = -Math.PI / 2; // face the camera (+z)
      s.add(built.root);
      const anim = new AnimatedModel(built.model, built.clips, RIGS.meshy);
      anim.setBase('Idle');
      anim.mixer.setTime(i * 0.7); // don't idle in lockstep
      this.champs.set(kit, { root: built.root, anim, ring, light, syncProps: built.syncProps, swingProp: built.swingProp });
    });

    // Pull back as the roster grows so every podium fits.
    this.camera.position.set(0, 2.4, 3.5 * KIT_IDS.length - 1);
    this.camera.lookAt(0, 0.95, 0);
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  /** Spotlight a champion and play its flourish (null clears the focus). */
  focus(kit: KitId | null) {
    if (kit === this.focused) return;
    this.focused = kit;
    if (!kit) return;
    const c = this.champs.get(kit);
    c?.anim?.playOnce('Select');
    c?.swingProp?.();
  }

  update(dt: number) {
    this.t += dt;
    for (const [kit, c] of this.champs) {
      const on = kit === this.focused;
      c.light.intensity += ((on ? 60 : 0) - c.light.intensity) * Math.min(1, dt * 8);
      (c.ring.material as THREE.MeshBasicMaterial).opacity = on ? 0.9 : 0.3;
      c.ring.scale.setScalar(on ? 1 + Math.sin(this.t * 4) * 0.03 : 1);
      // The focused champion turns a little toward the camera; the rest settle back.
      const yaw = -Math.PI / 2 + (on ? Math.sin(this.t * 0.6) * 0.25 : 0);
      c.root.rotation.y += (yaw - c.root.rotation.y) * Math.min(1, dt * 3);
      c.anim?.update(dt);
      c.syncProps?.(dt);
    }
  }

  render(renderer: THREE.WebGLRenderer) {
    renderer.render(this.scene, this.camera);
  }
}
