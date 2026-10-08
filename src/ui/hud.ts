import { portraitHtml } from '../render/portraits';
import { KITS } from '../sim/kits';
import type { WinReason } from '../sim/rules';
import type { Unit } from '../sim/types';
import { TICK_HZ, type World } from '../sim/world';
import { augmentChips } from './chips';

const REASON: Record<WinReason, string> = { kills: 'the kill goal', cs: 'the CS goal', tower: 'a tower first', nexus: 'the nexus' };

/** Top bar (floor, clock, duel score, gold), the opponent strip, the respawn timer and the end-of-duel banner. */
export class Hud {
  private floor = document.getElementById('floor')!;
  private clock = document.getElementById('clock')!;
  private score = document.getElementById('score')!;
  private gold = document.getElementById('gold')!;
  private foeStrip = document.getElementById('foe')!;
  private banner = document.getElementById('banner')!;
  private topbar = document.getElementById('topbar')!;

  constructor(private world: World, private me: Unit, private foe: Unit, label: string, private sandbox: boolean) {
    this.floor.textContent = label;
    const k = KITS[foe.champ!.kit];
    this.foeStrip.innerHTML = `<span class="mini-portrait" style="--accent:${k.color}">${portraitHtml(foe.champ!.kit)}</span><b style="color:${k.color}">${k.name}</b> ${augmentChips([...foe.champ!.augments, ...foe.champ!.items], false)}`;
    this.foeStrip.style.display = '';
    this.topbar.style.display = '';
  }

  update() {
    const { world, me, foe } = this;
    const s = Math.floor(world.tick / TICK_HZ);
    this.clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.gold.textContent = `${me.gold}`;

    const r = world.rules;
    const goals: string[] = [];
    const side = (u: Unit) => {
      const parts: string[] = [];
      if (Number.isFinite(r.killsToWin)) parts.push(`⚔ ${u.champ!.kills}/${r.killsToWin}`);
      if (Number.isFinite(r.csToWin)) parts.push(`CS ${u.champ!.cs}/${r.csToWin}`);
      return parts.join(' · ');
    };
    if (Number.isFinite(r.killsToWin) || Number.isFinite(r.csToWin)) {
      goals.push(`<span class="you">You ${side(me)}</span>`, `<span class="them">Foe ${side(foe)}</span>`);
    }
    if (r.firstTowerWins) goals.push('<span class="note" title="Destroying a tower wins">🏰</span>');
    const html = goals.join('');
    if (this.score.innerHTML !== html) this.score.innerHTML = html;

    const b = this.banner;
    if (world.winner) {
      const won = world.winner === me.team;
      b.textContent = won ? 'VICTORY' : 'DEFEAT';
      b.dataset.result = won ? 'win' : 'loss';
      b.dataset.sub = `${world.winReason ? `${won ? 'You' : 'They'} reached ${REASON[world.winReason]}` : ''}${this.sandbox ? ' · press R to play again' : ''}`;
      b.style.opacity = '1';
    } else if (me.dead) {
      b.textContent = `Respawning in ${Math.ceil((me.respawnTick - world.tick) / TICK_HZ)}`;
      b.dataset.result = '';
      b.dataset.sub = '';
      b.style.opacity = '1';
    } else {
      b.style.opacity = '0';
    }
  }

  dispose() {
    this.banner.style.opacity = '0';
    this.banner.textContent = '';
    this.banner.dataset.result = '';
    this.foeStrip.style.display = 'none';
    this.topbar.style.display = 'none';
    this.score.innerHTML = '';
  }
}
