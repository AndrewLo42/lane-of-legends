import * as THREE from 'three';
import { KITS, KIT_IDS } from '../sim/kits';
import type { KitId } from '../sim/types';
import { AnimatedModel } from './animatedModel';
import { hasModel, instantiate, type ModelName } from './assets';
import { World } from '../sim/world';
import { RIGS } from './rigs';
import { placeholderFor } from './scene';

/**
 * The champion select backdrop: the selected champion alone on a podium, spotlit in their colour,
 * playing their Select flourish when chosen. The select screen's info panel covers the right side,
 * so on wide screens the view is shifted to stand the champion left of centre. Rendered by main.ts
 * instead of the lane while the select screen is up.
 */
export class SelectStage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 100);
  active = false;
  private champs = new Map<KitId, { root: THREE.Object3D; anim?: AnimatedModel; syncProps?: (dt?: number) => void; swingProp?: () => void }>();
  private ring: THREE.Mesh;
  private light: THREE.SpotLight;
  private focused: KitId | null = null;
  /** Seconds since the focus changed: the new champion rises onto the podium. */
  private shown = 0;
  private t = 0;

  constructor() {
    const s = this.scene;
    s.background = new THREE.Color(0x0d1016);
    s.fog = new THREE.Fog(0x0d1016, 9, 20);
    s.add(new THREE.HemisphereLight(0xbfd6ff, 0x2a2118, 0.9));
    const key = new THREE.DirectionalLight(0xfff0dc, 1.6);
    key.position.set(3, 7, 6);
    s.add(key);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshStandardMaterial({ color: 0x1c2029, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);

    const podium = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.3, 40), new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.6, metalness: 0.3 }));
    podium.position.y = 0.15;
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.16, 0.035, 8, 64), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 }));
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.31;
    this.light = new THREE.SpotLight(0xffffff, 60, 12, 0.45, 0.6);
    this.light.position.set(0, 7, 3);
    this.light.target.position.set(0, 1, 0);
    s.add(podium, this.ring, this.light, this.light.target);

    KIT_IDS.forEach((kit, i) => {
      const model: ModelName = `champ_${kit}`;
      const built = hasModel(model) ? instantiate(model, kit === 'tock' ? 2.3 : kit === 'mabel' ? 1.7 : 2.1, null) : null;
      if (!built) {
        // No Meshy model yet: stand the placeholder figure on the podium instead.
        const stand = placeholderFor(new World(1).spawnChampion('blue', kit, { think: () => [] }));
        stand.scale.setScalar(0.95);
        this.place(stand);
        this.champs.set(kit, { root: stand });
        return;
      }
      this.place(built.root);
      const anim = new AnimatedModel(built.model, built.clips, RIGS.meshy);
      anim.setBase('Idle');
      anim.mixer.setTime(i * 0.7);
      this.champs.set(kit, { root: built.root, anim, syncProps: built.syncProps, swingProp: built.swingProp });
    });

    this.camera.position.set(0, 1.9, 9);
    this.camera.lookAt(0, 1.15, 0);
    this.resize();
  }

  private place(root: THREE.Object3D) {
    root.position.set(0, 0.3, 0);
    root.rotation.y = -Math.PI / 2; // face the camera (+z)
    root.visible = false;
    this.scene.add(root);
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.camera.aspect = w / h;
    // Wide screens: shift the view so the champion stands left of centre, clear of the info panel.
    // Narrow screens stack the panel underneath: zoom out and stand the champion between the
    // portraits and the panel.
    if (w >= 820) {
      this.camera.zoom = 1;
      this.camera.setViewOffset(w, h, w * 0.2, 0, w, h);
    } else {
      this.camera.zoom = 0.62;
      this.camera.setViewOffset(w, h, 0, h * 0.08, w, h);
    }
    this.camera.updateProjectionMatrix();
  }

  /** Show a champion and play its flourish (null hides everyone). */
  focus(kit: KitId | null) {
    if (kit === this.focused) return;
    this.focused = kit;
    this.shown = 0;
    for (const [k, c] of this.champs) c.root.visible = k === kit;
    if (!kit) return;
    const color = new THREE.Color(KITS[kit].color);
    (this.ring.material as THREE.MeshBasicMaterial).color.copy(color);
    this.light.color.copy(color);
    const c = this.champs.get(kit);
    c?.anim?.playOnce('Select');
    c?.swingProp?.();
  }

  update(dt: number) {
    this.t += dt;
    this.shown += dt;
    this.ring.scale.setScalar(1 + Math.sin(this.t * 4) * 0.03);
    const c = this.focused ? this.champs.get(this.focused) : undefined;
    if (!c) return;
    // Rise onto the podium over a quarter second, then turn gently toward the camera and back.
    const k = Math.min(1, this.shown / 0.25);
    c.root.position.y = 0.3 - (1 - k) * (1 - k) * 0.35;
    c.root.rotation.y = -Math.PI / 2 + Math.sin(this.t * 0.6) * 0.25;
    c.anim?.update(dt);
    c.syncProps?.(dt);
  }

  render(renderer: THREE.WebGLRenderer) {
    renderer.render(this.scene, this.camera);
  }
}
