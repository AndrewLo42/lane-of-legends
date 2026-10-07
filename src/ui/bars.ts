import * as THREE from 'three';
import type { Unit } from '../sim/types';
import type { World } from '../sim/world';
import { BAR_HEIGHT, type WorldView } from '../render/views';

const WIDTH: Record<Unit['kind'], number> = { champion: 74, minion: 34, tower: 96, nexus: 120 };

interface Bar {
  el: HTMLDivElement;
  fill: HTMLDivElement;
  shield: HTMLDivElement;
  mana?: HTMLDivElement;
  lvl?: HTMLSpanElement;
  cc?: HTMLSpanElement;
}

/**
 * HTML health bars that follow units on screen. Colours follow League's convention: you are green,
 * allies blue, enemies red. Untargetable structures show a lock.
 */
export class HealthBars {
  private root = document.getElementById('bars')!;
  private bars = new Map<number, Bar>();
  private v = new THREE.Vector3();

  constructor(private world: World, private view: WorldView, private meId: number, private myTeam: Unit['team']) {}

  update(camera: THREE.Camera) {
    const live = new Set<number>();
    for (const u of this.world.units) {
      const pos = this.view.positionOf(u.id);
      if (u.dead || !pos) continue;
      live.add(u.id);
      let bar = this.bars.get(u.id);
      if (!bar) bar = this.create(u);

      this.v.set(pos.x, BAR_HEIGHT[u.kind], pos.z).project(camera);
      const x = (this.v.x * 0.5 + 0.5) * innerWidth;
      const y = (-this.v.y * 0.5 + 0.5) * innerHeight;
      bar.el.style.transform = `translate(${x - WIDTH[u.kind] / 2}px, ${y}px)`;
      bar.el.style.display = this.v.z > 1 ? 'none' : '';
      const hpPct = (100 * u.hp) / u.maxHp;
      bar.fill.style.width = `${hpPct}%`;
      // Shields show as a white extension past the health (League-style), capped at the bar's end.
      const shield = u.statuses.reduce((t, st) => (st.kind === 'shield' ? t + st.value : t), 0);
      bar.shield.style.left = `${hpPct}%`;
      bar.shield.style.width = `${Math.min(100 - hpPct, (100 * shield) / u.maxHp)}%`;
      if (bar.cc) {
        const cc = this.world.isStunned(u) ? 'STUNNED' : this.world.isRooted(u) ? 'ROOTED' : '';
        if (bar.cc.textContent !== cc) bar.cc.textContent = cc;
      }
      if (u.champ && bar.mana && bar.lvl) {
        bar.mana.style.width = `${(100 * u.champ.mana) / u.champ.maxMana}%`;
        bar.lvl.textContent = String(u.champ.level);
        bar.el.classList.toggle('marked', !!this.world.status(u, 'mark'));
      }
      bar.el.classList.toggle('locked', (u.kind === 'tower' || u.kind === 'nexus') && !this.world.isTargetable(u));
    }
    for (const [id, bar] of this.bars) {
      if (live.has(id)) continue;
      bar.el.remove();
      this.bars.delete(id);
    }
  }

  dispose() {
    for (const bar of this.bars.values()) bar.el.remove();
    this.bars.clear();
  }

  private create(u: Unit) {
    const el = document.createElement('div');
    const side = u.id === this.meId ? 'me' : u.team === this.myTeam ? 'ally' : 'enemy';
    el.className = `hb ${u.kind} ${side}`;
    el.style.width = `${WIDTH[u.kind]}px`;
    const fill = document.createElement('div');
    el.appendChild(fill);
    const shield = document.createElement('div');
    shield.className = 'sh';
    el.appendChild(shield);
    const bar: Bar = { el, fill, shield };
    if (u.champ) {
      bar.cc = document.createElement('span');
      bar.cc.className = 'cc';
      el.append(bar.cc);
      const mana = document.createElement('div');
      mana.className = 'mp';
      mana.appendChild((bar.mana = document.createElement('div')));
      bar.lvl = document.createElement('span');
      bar.lvl.className = 'lvl';
      el.append(mana, bar.lvl);
    }
    this.root.appendChild(el);
    this.bars.set(u.id, bar);
    return bar;
  }
}
