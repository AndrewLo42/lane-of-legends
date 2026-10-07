import * as THREE from 'three';
import type { Input } from '../core/input';
import { LANE } from '../sim/lane';

/**
 * MOBA camera: fixed pitch looking down at the lane, unlocked by default with edge panning.
 * Y toggles lock-on, holding Space snaps to the champion, the wheel zooms, the minimap jumps it.
 */
export class MobaCamera {
  readonly camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.5, 300);
  locked = true;
  private focus = new THREE.Vector3();
  private zoom = 30;
  private readonly pitch = THREE.MathUtils.degToRad(56);

  constructor(start: THREE.Vector3) {
    this.focus.copy(start);
  }

  update(dt: number, input: Input, champion: THREE.Vector3) {
    if (input.wasPressed('KeyY')) this.locked = !this.locked;
    this.zoom = THREE.MathUtils.clamp(this.zoom + input.wheel * 2.5, 18, 42);

    if (this.locked || input.isDown('Space')) {
      this.focus.lerp(champion, 1 - Math.exp(-dt * 12));
    } else if (input.inside && !input.overUi) {
      const edge = 24;
      const speed = 40 * dt;
      const { x, y } = input.mouse;
      if (x < edge) this.focus.x -= speed;
      if (x > innerWidth - edge) this.focus.x += speed;
      if (y < edge) this.focus.z -= speed;
      if (y > innerHeight - edge) this.focus.z += speed;
    }
    this.focus.x = THREE.MathUtils.clamp(this.focus.x, -LANE.halfLength, LANE.halfLength);
    this.focus.z = THREE.MathUtils.clamp(this.focus.z, -LANE.halfWidth * 2, LANE.halfWidth * 2);

    this.camera.position.set(this.focus.x, this.focus.y + Math.sin(this.pitch) * this.zoom, this.focus.z + Math.cos(this.pitch) * this.zoom);
    this.camera.lookAt(this.focus);
  }

  /** Jump the camera to a ground point (minimap left-click) and unlock it so it stays there. */
  lookAt(x: number, z: number) {
    this.locked = false;
    this.focus.set(x, 0, z);
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  /** A ray from the camera through a screen point. */
  rayAt(clientX: number, clientY: number) {
    const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray;
  }

  /** Where the cursor ray meets the ground plane, or null if it points at the sky. */
  groundAt(clientX: number, clientY: number): THREE.Vector3 | null {
    return this.rayAt(clientX, clientY).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  }
}
