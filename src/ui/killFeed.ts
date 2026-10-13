import { portraitHtml } from '../render/portraits';
import { KITS } from '../sim/kits';
import { rowForHit, type RecapRow } from '../sim/recap';
import type { Hit, Unit } from '../sim/types';
import { TICK_HZ, type World } from '../sim/world';

const BANNER_SECONDS = 2.6;
/** The death recap covers this much damage before the killing blow. */
const RECAP_WINDOW = 10;

/**
 * Champion deaths: a banner across the top (killer's portrait → victim's, "You slew Arlo!"), and,
 * when it's you who died, a death recap above the ability bar for the whole respawn timer: what hit
 * you in the last few seconds, by source.
 */
export class KillFeed {
  private banner = document.createElement('div');
  private recap = document.createElement('div');
  private seen: number;
  private bannerAge = Infinity;
  /** Hits on you over the last RECAP_WINDOW seconds (the sim only keeps a second's worth). */
  private recent: Hit[] = [];
  private seenHit: number;

  constructor(private world: World, private me: Unit, private spectating: boolean) {
    this.banner.id = 'killbanner';
    this.recap.id = 'deathrecap';
    this.banner.style.display = this.recap.style.display = 'none';
    document.body.append(this.banner, this.recap);
    this.seen = world.championKills.length;
    this.seenHit = world.hits.at(-1)?.seq ?? 0;
  }

  update(dt: number) {
    const { world, me } = this;
    for (const h of world.hits) {
      if (h.seq <= this.seenHit) continue;
      this.seenHit = h.seq;
      if (h.targetId === me.id) this.recent.push(h);
    }
    const cutoff = world.tick - RECAP_WINDOW * TICK_HZ;
    while (this.recent.length && this.recent[0].tick < cutoff) this.recent.shift();

    while (this.seen < world.championKills.length) {
      const k = world.championKills[this.seen++];
      this.announce(k.victimId, k.killerId, k.executedBy);
      if (k.victimId === me.id && !this.spectating) this.showRecap(k.killerId);
    }

    this.bannerAge += dt;
    const shown = this.bannerAge < BANNER_SECONDS;
    this.banner.style.display = shown ? '' : 'none';
    if (shown) {
      // Punch in, hold, fade out.
      const a = this.bannerAge;
      const scale = a < 0.15 ? 1.25 - (a / 0.15) * 0.25 : 1;
      this.banner.style.transform = `translateX(-50%) scale(${scale})`;
      this.banner.style.opacity = String(a > BANNER_SECONDS - 0.5 ? (BANNER_SECONDS - a) / 0.5 : 1);
    }
    // The recap stays up until you're back on your feet (the HUD shows the respawn countdown).
    if (!me.dead) this.recap.style.display = 'none';
  }

  private announce(victimId: number, killerId: number | null, executedBy: 'tower' | 'minion' | null) {
    const victim = this.world.get(victimId);
    const killer = this.world.get(killerId);
    if (!victim?.champ) return;
    const name = (u: Unit) => KITS[u.champ!.kit].name;
    const mine = (u: Unit) => u.id === this.me.id && !this.spectating;
    const ally = victim.team === this.me.team;
    let text: string;
    if (killer?.champ) text = mine(killer) ? `You slew ${name(victim)}!` : mine(victim) ? `${name(killer)} slew you` : `${name(killer)} slew ${name(victim)}`;
    else text = `${mine(victim) ? 'You were' : `${name(victim)} was`} executed${executedBy === 'tower' ? ' by a tower' : executedBy === 'minion' ? ' by minions' : ''}`;
    const face = (u: Unit) => `<span class="mini-portrait" style="--accent:${KITS[u.champ!.kit].color}">${portraitHtml(u.champ!.kit)}</span>`;
    const by = killer?.champ ? face(killer) : `<span class="exec">${executedBy === 'minion' ? '🪖' : '🏰'}</span>`;
    this.banner.className = ally ? 'bad' : 'good'; // red when your side lost one
    this.banner.innerHTML = `${by}<span class="arrow">⚔</span>${face(victim)}<b>${text}</b>`;
    this.bannerAge = 0;
  }

  private showRecap(killerId: number | null) {
    const rows = new Map<string, RecapRow>();
    for (const h of this.recent) {
      const row = rowForHit(this.world, h);
      const k = `${row.label}|${row.key ?? ''}`;
      const cur = rows.get(k);
      if (cur) cur.amount += h.effective;
      else rows.set(k, { ...row, amount: h.effective });
    }
    const list = [...rows.values()].filter((r) => r.amount >= 1).sort((a, b) => b.amount - a.amount).slice(0, 6);
    const sum = list.reduce((t, r) => t + r.amount, 0);
    const max = Math.max(1, ...list.map((r) => r.amount));
    const killer = this.world.get(killerId);
    this.recap.innerHTML = `
      <div class="head"><b>${killer?.champ ? `Slain by ${KITS[killer.champ.kit].name}` : 'Executed'}</b>
        <span>${Math.round(sum)} damage in the last ${RECAP_WINDOW}s</span></div>
      ${list.map((r) => `<div class="rrow ${r.kind}"><i>${r.icon}</i><span class="lbl">${r.key ? `<kbd>${r.key}</kbd> ` : ''}${r.label}</span>
        <b>${Math.round(r.amount)}</b><div class="fill" style="width:${(100 * r.amount) / max}%"></div></div>`).join('')}
`;
    this.recap.style.display = '';
    this.recent = [];
  }

  dispose() {
    this.banner.remove();
    this.recap.remove();
  }
}
