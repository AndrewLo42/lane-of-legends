import * as THREE from 'three';
import type { Input } from '../core/input';
import type { MobaCamera } from '../render/camera';
import type { ClickMarker } from '../render/scene';
import { KITS } from '../sim/kits';
import { LANE } from '../sim/lane';
import type { Command, Team, Unit, Vec2 } from '../sim/types';
import type { World } from '../sim/world';

/** World area the minimap covers: the lane plus the camera's pan range around it. */
const VIEW = { halfX: LANE.halfLength + 2, halfY: LANE.halfWidth * 2 };
const WIDTH = 300; // CSS pixels; the height follows the lane's proportions
const SCALE = WIDTH / (VIEW.halfX * 2);
const HEIGHT = Math.round(VIEW.halfY * 2 * SCALE);
const TEAM: Record<Team, string> = { blue: '#3d8bff', red: '#ff4a3d' };

/**
 * League-style minimap in the bottom-right corner. Left-click (or drag) moves the camera there and
 * unlocks it; right-click (or drag) sends the champion there. Shows structures, minions, both
 * champions, the camera's view of the ground and the player's current move path.
 */
export class Minimap {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private panning = false;
  private steering = false;
  private ping: { at: Vec2; t: number } | null = null;
  private onUp = (e: MouseEvent) => {
    if (e.button === 0) this.panning = false;
    if (e.button === 2) this.steering = false;
  };

  constructor(
    private world: World,
    private me: Unit,
    private cam: MobaCamera,
    private input: Input,
    private marker: ClickMarker,
    private command: (c: Command) => void,
  ) {
    const c = this.canvas;
    c.id = 'minimap';
    const dpr = Math.min(devicePixelRatio, 2);
    c.width = WIDTH * dpr;
    c.height = HEIGHT * dpr;
    // CSS sizes it (it shrinks on narrow screens); clicks map through its on-screen rect.
    this.ctx = c.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    document.body.appendChild(c);

    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.button === 0) this.panning = true;
      if (e.button === 2) this.steering = true;
      this.act(e, true);
    });
    c.addEventListener('mousemove', (e) => this.act(e, false));
    // Over the minimap the cursor sits at the screen edge; don't let that edge-pan the camera.
    c.addEventListener('mouseenter', () => (input.overUi = true));
    c.addEventListener('mouseleave', () => (input.overUi = false));
    window.addEventListener('mouseup', this.onUp);
  }

  dispose() {
    window.removeEventListener('mouseup', this.onUp);
    this.input.overUi = false;
    this.canvas.remove();
  }

  /** Canvas pixel → world point (sim coordinates), kept inside the lane. */
  private toWorld(e: MouseEvent): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * VIEW.halfX * 2 - VIEW.halfX;
    const y = ((e.clientY - r.top) / r.height) * VIEW.halfY * 2 - VIEW.halfY;
    return { x: THREE.MathUtils.clamp(x, -LANE.halfLength, LANE.halfLength), y: THREE.MathUtils.clamp(y, -LANE.halfWidth, LANE.halfWidth) };
  }

  private act(e: MouseEvent, click: boolean) {
    const p = this.toWorld(e);
    if (this.panning) this.cam.lookAt(p.x, p.y);
    if (this.steering && !this.me.dead && !this.world.winner) {
      this.command({ type: 'move', to: p });
      if (click) {
        this.marker.show(new THREE.Vector3(p.x, 0, p.y));
        this.ping = { at: p, t: 0 };
      }
    }
  }

  update(dt: number) {
    const { ctx, world, me } = this;
    const px = (x: number) => (x + VIEW.halfX) * SCALE;
    const py = (y: number) => (y + VIEW.halfY) * SCALE;

    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#1d2a1c';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#5a4a33';
    ctx.fillRect(px(-LANE.halfLength), py(-LANE.halfWidth), LANE.halfLength * 2 * SCALE, LANE.halfWidth * 2 * SCALE);

    // Structures, then minions, then champions on top.
    const order = { nexus: 0, tower: 1, minion: 2, champion: 3 } as const;
    const units = world.units.filter((u) => !u.dead).sort((a, b) => order[a.kind] - order[b.kind]);
    for (const u of units) {
      const x = px(u.pos.x);
      const y = py(u.pos.y);
      if (u.kind === 'tower' || u.kind === 'nexus') {
        const s = u.kind === 'nexus' ? 7 : 5;
        ctx.fillStyle = TEAM[u.team];
        ctx.strokeStyle = '#000a';
        ctx.lineWidth = 1;
        ctx.fillRect(x - s, y - s, s * 2, s * 2);
        ctx.strokeRect(x - s, y - s, s * 2, s * 2);
      } else if (u.kind === 'minion') {
        ctx.fillStyle = TEAM[u.team];
        ctx.beginPath();
        ctx.arc(x, y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      } else if (u.champ) {
        ctx.fillStyle = KITS[u.champ.kit].color;
        ctx.strokeStyle = u === me ? '#fff' : TEAM[u.team];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // The player's path: a dashed line to where they're walking.
    if (!me.dead && me.moveTarget) {
      ctx.strokeStyle = '#ffffffcc';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px(me.pos.x), py(me.pos.y));
      ctx.lineTo(px(me.moveTarget.x), py(me.moveTarget.y));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // A ring that shrinks where the player last right-clicked the minimap.
    if (this.ping) {
      this.ping.t += dt;
      const k = this.ping.t / 0.5;
      if (k >= 1) this.ping = null;
      else {
        ctx.strokeStyle = `rgba(120, 255, 140, ${1 - k})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px(this.ping.at.x), py(this.ping.at.y), 8 * (1 - k) + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // The camera's footprint: where the screen's corners meet the ground, kept on the map (the top of
    // the screen looks far past the lane's edge).
    const corners = [[0, 0], [innerWidth, 0], [innerWidth, innerHeight], [0, innerHeight]]
      .map(([sx, sy]) => this.cam.groundAt(sx, sy))
      .filter((g): g is THREE.Vector3 => g != null)
      .map((g) => g.set(THREE.MathUtils.clamp(g.x, -VIEW.halfX, VIEW.halfX), 0, THREE.MathUtils.clamp(g.z, -VIEW.halfY, VIEW.halfY)));
    if (corners.length === 4) {
      ctx.strokeStyle = '#ffffffb0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      corners.forEach((g, i) => (i ? ctx.lineTo(px(g.x), py(g.z)) : ctx.moveTo(px(g.x), py(g.z))));
      ctx.closePath();
      ctx.stroke();
    }
  }
}
