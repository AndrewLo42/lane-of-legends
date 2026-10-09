import { portraitHtml } from '../render/portraits';
import { kitOf } from '../sim/kits';
import { SUMMONERS } from '../sim/summoners';
import { augmentChips } from './chips';
import type { Slot, Unit } from '../sim/types';
import { TICK_HZ, type World, xpToNext } from '../sim/world';

const KEYS = ['Q', 'W', 'E', 'R'];
const SLOTS: Slot[] = [0, 1, 2, 3];
const SPELL_KEYS = ['D', 'F'];
/** "40 mana", or for Mabel "1 bee" / "No bees". */
const costText = (n: number, resource: 'mana' | 'bees' = 'mana') =>
  resource === 'bees' ? (n ? `${n} bee${n === 1 ? '' : 's'}` : 'No bees') : `${n} mana`;
/** Tooltip ids at or above this are summoner spells (SPELL_TIP + slot). */
const SPELL_TIP = 10;

interface SlotEls {
  root: HTMLDivElement;
  cd: HTMLDivElement;
  cdText: HTMLSpanElement;
  pips: HTMLDivElement;
  plus: HTMLButtonElement;
}

/**
 * League-style bottom bar: portrait with level, passive + Q/W/E/R (cooldown sweep, rank pips,
 * level-up buttons, recast glow), the D/F summoner spells, health/mana/XP bars, and tooltips.
 */
export class AbilityBar {
  private root = document.getElementById('abilities')!;
  private slots: SlotEls[] = [];
  private spells: { root: HTMLDivElement; cd: HTMLDivElement; cdText: HTMLSpanElement }[] = [];
  private hp: HTMLDivElement;
  private hpText: HTMLSpanElement;
  private mana: HTMLDivElement;
  private manaText: HTMLSpanElement;
  private xp: HTMLDivElement;
  private level: HTMLSpanElement;
  private tip = document.getElementById('tip')!;
  private tipFor: number | null = null;

  constructor(private world: World, private me: Unit, onLevel: (slot: Slot) => void) {
    const kit = kitOf(me);
    this.root.style.setProperty('--accent', kit.color);
    this.root.innerHTML = `
      <div class="portrait">${portraitHtml(me.champ!.kit)}<span class="lvl"></span></div>
      ${me.champ!.augments.length + me.champ!.items.length ? `<div class="augs">${augmentChips([...me.champ!.augments, ...me.champ!.items], false)}</div>` : ''}
      <div class="core">
        <div class="slots">
          <div class="slot passive" data-tip="-1"><i>${kit.passive.icon}</i></div>
          ${SLOTS.map((s) => `
            <div class="slot" data-tip="${s}">
              <button class="plus" title="Level up (Alt+${KEYS[s]})">+</button>
              <i>${kit.abilities[s].icon}</i>
              <div class="cd"></div><span class="cdtext"></span>
              <span class="key">${KEYS[s]}</span>
              <div class="pips"></div>
            </div>`).join('')}
          <div class="spells">
            ${me.champ!.summoners.map((sp, i) => `
              <div class="slot spell" data-tip="${SPELL_TIP + i}">
                <i>${SUMMONERS[sp.id].icon}</i><div class="cd"></div><span class="cdtext"></span><span class="key">${SPELL_KEYS[i]}</span>
              </div>`).join('')}
          </div>
        </div>
        <div class="bar hp"><div></div><span></span></div>
        <div class="bar mana${kit.resource === 'bees' ? ' bees' : ''}"><div></div><span></span></div>
        <div class="bar xp"><div></div></div>
      </div>`;
    const q = <T extends Element>(sel: string, el: ParentNode = this.root) => el.querySelector(sel) as T;
    this.hp = q('.hp > div');
    this.hpText = q('.hp > span');
    this.mana = q('.mana > div');
    this.manaText = q('.mana > span');
    this.xp = q('.xp > div');
    this.level = q('.portrait .lvl');
    this.root.querySelectorAll<HTMLDivElement>('.slot:not(.passive):not(.spell)').forEach((root, i) => {
      const plus = q<HTMLButtonElement>('.plus', root);
      plus.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        onLevel(i as Slot);
      });
      this.slots.push({ root, plus, cd: q('.cd', root), cdText: q('.cdtext', root), pips: q('.pips', root) });
    });
    this.root.querySelectorAll<HTMLDivElement>('.slot.spell').forEach((root) => {
      this.spells.push({ root, cd: q('.cd', root), cdText: q('.cdtext', root) });
    });
    this.root.querySelectorAll<HTMLDivElement>('.slot').forEach((el) => {
      el.addEventListener('mouseenter', () => (this.tipFor = Number(el.dataset.tip)));
      el.addEventListener('mouseleave', () => (this.tipFor = null));
    });
    this.root.style.display = '';
  }

  dispose() {
    this.root.innerHTML = '';
    this.root.style.display = 'none';
    this.tip.style.display = 'none';
  }

  update() {
    const { world, me } = this;
    const c = me.champ!;
    const kit = kitOf(me);
    this.level.textContent = String(c.level);
    this.hp.style.width = `${(100 * me.hp) / me.maxHp}%`;
    this.hpText.textContent = `${Math.ceil(me.hp)} / ${Math.round(me.maxHp)}`;
    this.mana.style.width = `${(100 * c.mana) / c.maxMana}%`;
    this.manaText.textContent = kit.resource === 'bees'
      ? `🐝 ${Math.floor(c.mana)} / ${Math.floor(c.maxMana)}`
      : `${Math.floor(c.mana)} / ${Math.round(c.maxMana)}`;
    this.xp.style.width = c.level >= 11 ? '100%' : `${(100 * c.xp) / xpToNext(c.level)}%`;

    SLOTS.forEach((s) => {
      const el = this.slots[s];
      const st = c.abilities[s];
      const def = kit.abilities[s];
      const left = Math.max(0, st.readyAt - world.tick) / TICK_HZ;
      const recast = st.recastUntil > world.tick;
      const total = def.cooldown(Math.max(1, st.rank));
      const frac = recast ? 0 : Math.min(1, left / total);
      el.cd.style.background = frac > 0 ? `conic-gradient(#000a ${frac * 360}deg, transparent 0)` : 'none';
      el.cdText.textContent = !recast && left > 0 ? (left < 1 ? left.toFixed(1) : String(Math.ceil(left))) : '';
      el.root.classList.toggle('oncd', el.cdText.textContent !== '');
      el.root.classList.toggle('locked', st.rank === 0);
      el.root.classList.toggle('nomana', st.rank > 0 && !recast && c.mana < def.cost(st.rank));
      el.root.classList.toggle('recast', recast);
      el.root.classList.toggle('casting', c.casting?.slot === s);
      el.plus.style.visibility = world.canLevel(me, s) ? 'visible' : 'hidden';
      const pips = `${'●'.repeat(st.rank)}${'○'.repeat(def.maxRank - st.rank)}`;
      if (el.pips.textContent !== pips) el.pips.textContent = pips;
    });

    c.summoners.forEach((sp, i) => {
      const el = this.spells[i];
      if (!el) return;
      const recast = sp.recastUntil > world.tick;
      const left = Math.max(0, sp.readyAt - world.tick) / TICK_HZ;
      const frac = recast ? 0 : Math.min(1, left / SUMMONERS[sp.id].cooldown);
      el.cd.style.background = frac > 0 ? `conic-gradient(#000a ${frac * 360}deg, transparent 0)` : 'none';
      el.cdText.textContent = !recast && left > 0 ? String(Math.ceil(left)) : '';
      el.root.classList.toggle('oncd', el.cdText.textContent !== '');
      el.root.classList.toggle('recast', recast);
    });

    if (this.tipFor == null) {
      this.tip.style.display = 'none';
    } else {
      this.tip.innerHTML = this.tipHtml(this.tipFor);
      this.tip.style.display = 'block';
    }
  }

  private tipHtml(i: number) {
    const kit = kitOf(this.me);
    if (i < 0) return `<b>${kit.passive.name}</b> <small>Passive</small><p>${kit.passive.describe(this.me)}</p>`;
    if (i >= SPELL_TIP) {
      const sp = SUMMONERS[this.me.champ!.summoners[i - SPELL_TIP].id];
      return `<b>${sp.name}</b> <small>${SPELL_KEYS[i - SPELL_TIP]} · summoner spell</small><p>${sp.describe(this.me)}</p>
        <small class="cost">${sp.cooldown}s cooldown</small>`;
    }
    const def = kit.abilities[i];
    const rank = this.me.champ!.abilities[i].rank;
    const r = Math.max(1, rank);
    return `<b>${def.name}</b> <small>${KEYS[i]} · rank ${rank}/${def.maxRank}</small>
      <p>${def.describe(r, this.me)}</p>
      <small class="cost">${costText(def.cost(r), kit.resource)} · ${def.cooldown(r)}s cooldown${def.recastWindow ? ` · recast within ${def.recastWindow}s` : ''}</small>`;
  }
}
