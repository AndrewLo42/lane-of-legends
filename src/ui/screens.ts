import { portraitHtml } from '../render/portraits';
import { FLOORS, cantBuy, runSummoners, shopStock, validSummoners, type FloorPlan, type Meta, type RunState } from '../run/run';
import { AUGMENTS } from '../sim/augments';
import { CONSUMABLES, ITEMS, MAX_ITEMS } from '../sim/items';
import { BOT_KIT_IDS, KITS, KIT_IDS } from '../sim/kits';
import type { WinReason } from '../sim/rules';
import { DEFAULT_SUMMONERS, SUMMONERS, SUMMONER_IDS } from '../sim/summoners';
import type { AugmentId, KitId, SummonerId, Unit } from '../sim/types';
import { World } from '../sim/world';
import { total, type DuelRecap, type RecapRow } from '../sim/recap';
import type { NetClient } from '../net/client';
import type { LobbyPlayer, ServerMsg } from '../net/protocol';
import { augmentChips, spellChips } from './chips';

const KEYS = ['Q', 'W', 'E', 'R'];
const REASON: Record<WinReason, string> = { kills: 'kills', cs: 'CS', tower: 'first tower', nexus: 'nexus' };

/** The full-screen overlay all menus render into. */
const root = () => document.getElementById('screen')!;

function show(html: string) {
  const el = root();
  el.innerHTML = html;
  el.style.display = '';
  return el;
}

function hide() {
  root().style.display = 'none';
  root().innerHTML = '';
}

/** Resolve when one of the `[data-action]` buttons is clicked, with its action name. */
function waitFor(el: HTMLElement): Promise<string> {
  return new Promise((resolve) => {
    el.addEventListener('click', function onClick(e) {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!b) return;
      el.removeEventListener('click', onClick);
      resolve(b.dataset.action!);
    });
  });
}

function ladder(run: RunState) {
  return `<ol class="ladder">${FLOORS.map((f, i) => {
    const cls = i < run.floor ? 'done' : i === run.floor ? 'now' : '';
    return `<li class="${cls}"><span>${i < run.floor ? '✓' : i + 1}</span>${f.title}</li>`;
  }).join('')}</ol>`;
}

const CONTROLS = `<p class="controls"><kbd>Right-click</kbd> move / attack · hold <kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd> to aim,
  release to cast (right-click cancels) · <kbd>D</kbd><kbd>F</kbd> summoner spells · <kbd>Alt</kbd>+key or <kbd>+</kbd> level up · <kbd>S</kbd> stop · <kbd>Y</kbd> camera lock ·
  hold <kbd>Space</kbd> centre camera · wheel zoom · minimap: left-click to look, right-click to walk</p>`;

const kitName = (id: KitId) => `<b style="color:${KITS[id].color}">${KITS[id].name}</b> <small>${KITS[id].title}</small>`;
/** Portrait and name, for the floor intro's versus panel. */
const kitBadge = (id: KitId) =>
  `<div class="badge"><span class="mini-portrait big" style="--accent:${KITS[id].color}">${portraitHtml(id)}</span><div>${kitName(id)}</div></div>`;

// ---------- summoner spell picker (champion select and shop) ----------

type SpellPair = [SummonerId, SummonerId];
const SPELL_KEYS = ['D', 'F'];

/**
 * Two slots (D, F) over a grid of every spell. Clicking a spell puts it in the highlighted slot and
 * moves the highlight to the other one; picking the spell that's already in the other slot swaps
 * them. Lives inside `host`, re-rendering itself; `onChange` gets each new pair.
 */
function spellPicker(host: HTMLElement, pair: SpellPair, sample: Unit, onChange: (p: SpellPair) => void) {
  let active = 0;
  let shown: SummonerId = pair[0];
  const describe = (id: SummonerId) => `<b>${SUMMONERS[id].name}</b> <small>${SUMMONERS[id].cooldown}s cooldown</small><br>${SUMMONERS[id].describe(sample)}`;
  /**
   * Reserve room for the longest description, so hovering spells never resizes the picker: a box that
   * grows and shrinks moves the buttons under the cursor, which then hovers a different spell.
   */
  const fitDescription = () => {
    const p = host.querySelector<HTMLElement>('.spelldesc');
    if (!p) return;
    const keep = p.innerHTML;
    p.style.minHeight = '';
    let tallest = 0;
    for (const id of SUMMONER_IDS) {
      p.innerHTML = describe(id);
      tallest = Math.max(tallest, p.offsetHeight);
    }
    p.innerHTML = keep;
    p.style.minHeight = `${tallest}px`;
  };
  const render = () => {
    const d = SUMMONERS[shown];
    host.innerHTML = `
      <div class="spellslots">${pair.map((id, i) => `
        <button class="sslot${i === active ? ' on' : ''}" data-sslot="${i}"><kbd>${SPELL_KEYS[i]}</kbd><i>${SUMMONERS[id].icon}</i>${SUMMONERS[id].name}</button>`).join('')}
      </div>
      <div class="spellgrid">${SUMMONER_IDS.map((id) => {
        const at = pair.indexOf(id);
        return `<button class="spell${at >= 0 ? ' in' : ''}${id === shown ? ' shown' : ''}" data-spell="${id}" title="${SUMMONERS[id].name}">
          <i>${SUMMONERS[id].icon}</i>${at >= 0 ? `<kbd>${SPELL_KEYS[at]}</kbd>` : ''}</button>`;
      }).join('')}</div>
      <p class="spelldesc">${describe(d.id)}</p>`;
    fitDescription();
  };
  host.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const slot = t.closest<HTMLElement>('[data-sslot]');
    if (slot) {
      active = Number(slot.dataset.sslot);
      shown = pair[active];
    }
    const spell = t.closest<HTMLElement>('[data-spell]');
    if (spell) {
      const id = spell.dataset.spell as SummonerId;
      const other = 1 - active;
      if (pair[other] === id) pair = active === 0 ? [id, pair[0]] : [pair[1], id]; // swap
      else pair = (active === 0 ? [id, pair[1]] : [pair[0], id]) as SpellPair;
      shown = id;
      active = other;
      onChange([...pair] as SpellPair);
    }
    if (slot || spell) render();
  });
  host.addEventListener('mouseover', (e) => {
    const spell = (e.target as HTMLElement).closest<HTMLElement>('[data-spell]');
    if (spell && spell.dataset.spell !== shown) {
      shown = spell.dataset.spell as SummonerId;
      host.querySelector('.spelldesc')!.innerHTML = describe(shown);
    }
  });
  render();
}

// ---------- champion select ----------

const LAST_KIT = 'lane-rogue.lastKit';
const LAST_SPELLS = 'lane-rogue.lastSpells';
const EXPERIMENTAL = 'lane-rogue.experimental';

/**
 * Champion select: portraits along the top, the chosen champion on the 3D stage (via `onFocus`),
 * and their full kit in the panel beside it. Click a portrait to look, double-click it or press
 * Start (or Enter) to begin; the arrow keys step through the roster.
 */
/** What the home screen chose: start a run, or watch two bots duel. */
export type HomeChoice = { mode: 'run'; kit: KitId; summoners: SpellPair } | { mode: 'watch' } | { mode: 'online' };

export async function pickChampion(meta: Meta, onFocus: (kit: KitId | null) => void = () => {}): Promise<HomeChoice> {
  let current: KitId = KIT_IDS[0];
  let spells: SpellPair = [...DEFAULT_SUMMONERS];
  /** Show champions without a model yet (placeholders) for testing. */
  let experimental = false;
  try {
    experimental = localStorage.getItem(EXPERIMENTAL) === '1';
    const last = localStorage.getItem(LAST_KIT) as KitId | null;
    if (last && KIT_IDS.includes(last) && (experimental || !KITS[last].experimental)) current = last;
    const lastSpells = JSON.parse(localStorage.getItem(LAST_SPELLS) ?? 'null');
    if (validSummoners(lastSpells)) spells = lastSpells;
  } catch {
    /* storage unavailable: start on the first champion */
  }

  const el = show(`
    <div class="selecthead"><h1>Lane League</h1>
      <p class="sub">Five duels. One lane. Pick augments as you climb, and the run ends at your first loss.</p>
      <div class="homelinks"><button class="link watch" data-online>⚔ Play online</button><button class="link watch" data-watch>🤖 Watch bots duel</button>
        <label class="exptoggle" title="Champions without a model yet, as placeholders. Bots never play them."><input type="checkbox" data-experimental${experimental ? ' checked' : ''}> 🧪 Experimental champions</label></div></div>
    <div class="roster">
      ${KIT_IDS.map((id) => `
        <button class="pick${KITS[id].experimental ? ' experimental' : ''}" data-kit="${id}" style="--accent:${KITS[id].color}"
          title="${KITS[id].name}${KITS[id].experimental ? ' (experimental: no model yet, bots never pick them)' : ''}">
          <span class="mini-portrait">${portraitHtml(id)}</span><span class="pname">${KITS[id].name}</span>
        </button>`).join('')}
    </div>
    <div class="selectmain"><div class="stagegap"></div><div class="champinfo"></div></div>
    <p class="hint">${meta.runs ? `${meta.runs} run${meta.runs === 1 ? '' : 's'} · ${meta.wins} won · ` : ''}←/→ to browse · Enter to start ·
      Free play: add <code>?champ=arlo&amp;enemy=tock</code> to the URL.</p>`);
  el.classList.add('select');
  el.classList.toggle('show-experimental', experimental);
  const info = el.querySelector<HTMLElement>('.champinfo')!;
  const roster = () => KIT_IDS.filter((k) => experimental || !KITS[k].experimental);

  const select = (kit: KitId) => {
    current = kit;
    onFocus(kit);
    el.querySelectorAll<HTMLElement>('.pick').forEach((b) => b.classList.toggle('on', b.dataset.kit === kit));
    const k = KITS[kit];
    // Ability numbers come from a real level-1 champion in a throwaway world.
    const sample = new World(1).spawnChampion('blue', kit, { think: () => [] });
    const best = meta.best[kit];
    info.style.setProperty('--accent', k.color);
    info.innerHTML = `
      <div class="name">${k.name} <span>${k.title}</span></div>
      <p class="blurb">${k.blurb}</p>
      <ul class="abilities">
        <li><i>${k.passive.icon}</i><div><b>${k.passive.name}</b> <small>Passive</small><p>${k.passive.describe(sample)}</p></div></li>
        ${k.abilities.map((a, s) => `<li><i>${a.icon}</i><div><b>${a.name}</b> <kbd>${KEYS[s]}</kbd><p>${a.describe(1, sample)}</p></div></li>`).join('')}
      </ul>
      <h4>Summoner spells <small>swappable in the shop between floors</small></h4>
      <div class="spellpick"></div>
      <div class="best">${best ? `Best: floor ${best} of ${FLOORS.length}` : 'Not played yet'}</div>
      <div class="actions"><button class="go" data-start>Start run as ${k.name}</button></div>`;
    spellPicker(info.querySelector('.spellpick')!, spells, sample, (p) => (spells = p));
  };

  const kit = await new Promise<KitId | 'watch' | 'online'>((resolve) => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      const pick = t.closest<HTMLElement>('[data-kit]');
      if (pick) select(pick.dataset.kit as KitId);
      const toggle = t.closest<HTMLInputElement>('[data-experimental]');
      if (toggle) {
        experimental = toggle.checked;
        el.classList.toggle('show-experimental', experimental);
        try {
          localStorage.setItem(EXPERIMENTAL, experimental ? '1' : '0');
        } catch {
          /* ignore */
        }
        if (!roster().includes(current)) select(roster()[0]);
      }
      if (t.closest('[data-start]')) done();
      if (t.closest('[data-watch]')) finish('watch');
      if (t.closest('[data-online]')) finish('online');
    };
    const onDouble = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-kit]')) done();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input')) return;
      const ids = roster();
      const i = ids.indexOf(current);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') select(ids[(i + 1) % ids.length]);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') select(ids[(i - 1 + ids.length) % ids.length]);
      else if (e.key === 'Enter') {
        // A focused button (the last spell clicked) would otherwise take the Enter as a click too.
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        done();
      } else return;
      e.preventDefault();
    };
    const finish = (choice: KitId | 'watch' | 'online') => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('dblclick', onDouble);
      removeEventListener('keydown', onKey);
      resolve(choice);
    };
    const done = () => finish(current);
    el.addEventListener('click', onClick);
    el.addEventListener('dblclick', onDouble);
    addEventListener('keydown', onKey);
    select(current);
  });
  el.classList.remove('select', 'show-experimental');
  hide();
  if (kit === 'watch') return { mode: 'watch' };
  if (kit === 'online') return { mode: 'online' };
  try {
    localStorage.setItem(LAST_KIT, kit);
    localStorage.setItem(LAST_SPELLS, JSON.stringify(spells));
  } catch {
    /* ignore */
  }
  return { mode: 'run', kit, summoners: spells };
}

// ---------- bot vs bot ----------

/** Pick the two champions to watch (Random allowed); null goes back to the home screen. */
export async function pickBots(): Promise<{ blue: KitId; red: KitId } | null> {
  const pick: Record<'blue' | 'red', KitId | 'random'> = { blue: 'random', red: 'random' };
  for (;;) {
    const row = (side: 'blue' | 'red') => `
      <div class="botrow ${side}"><small>${side === 'blue' ? 'Blue side' : 'Red side'}</small>
        <div class="roster">
          ${BOT_KIT_IDS.map((id) => `
            <button class="pick${pick[side] === id ? ' on' : ''}" data-action="${side}:${id}" style="--accent:${KITS[id].color}" title="${KITS[id].name}">
              <span class="mini-portrait">${portraitHtml(id)}</span><span class="pname">${KITS[id].name}</span>
            </button>`).join('')}
          <button class="pick${pick[side] === 'random' ? ' on' : ''}" data-action="${side}:random" style="--accent:#e8e6df" title="Random">
            <span class="mini-portrait"><b>?</b></span><span class="pname">Random</span>
          </button>
        </div>
      </div>`;
    const el = show(`
      <div class="floorhead"><small>Just for fun</small><h1>Bot vs bot</h1></div>
      ${row('blue')}
      <div class="vs">VS</div>
      ${row('red')}
      <p class="hint">Both sides play at Legend-level aim with their signature summoner spells. Speed it up to 2× or 4× while watching.</p>
      <div class="actions"><button class="go" data-action="go">Watch</button><button class="link" data-action="back">Back</button></div>`);
    const action = await waitFor(el);
    if (action === 'back') {
      hide();
      return null;
    }
    if (action === 'go') {
      hide();
      const roll = (k: KitId | 'random') => (k === 'random' ? BOT_KIT_IDS[Math.floor(Math.random() * BOT_KIT_IDS.length)] : k);
      return { blue: roll(pick.blue), red: roll(pick.red) };
    }
    const [side, id] = action.split(':') as ['blue' | 'red', KitId | 'random'];
    pick[side] = id;
  }
}

// ---------- before each duel ----------

/** Resolves 'fight' or 'abandon'. */
export async function floorIntro(run: RunState, plan: FloorPlan): Promise<'fight' | 'abandon'> {
  const r = plan.rules;
  const goals = [
    Number.isFinite(r.killsToWin) ? `${r.killsToWin} kill${r.killsToWin === 1 ? '' : 's'}` : '',
    Number.isFinite(r.csToWin) ? `${r.csToWin} CS` : '',
    r.firstTowerWins ? 'first tower' : '',
  ].filter(Boolean);
  const boss = run.floor === FLOORS.length - 1;
  const el = show(`
    <div class="floorhead"><small>Floor ${run.floor + 1} of ${FLOORS.length}${boss ? ' · Boss' : ''}</small><h1>${plan.title}</h1></div>
    ${ladder(run)}
    <div class="versus">
      <div class="side"><small>You</small>${kitBadge(run.kit)}<div class="chips">${spellChips(runSummoners(run))}</div><div class="chips">${augmentChips(run.augments)}</div>
        ${run.items.length || run.consumables.length ? `<div class="chips">${augmentChips([...run.items, ...run.consumables])}</div>` : ''}</div>
      <div class="vs">VS</div>
      <div class="side"><small>Opponent</small>${kitBadge(plan.opponent)}<div class="chips">${spellChips(plan.opponentSummoners)}</div>
        <div class="chips">${augmentChips(plan.opponentAugments)}</div>
        ${plan.opponentItems.length ? `<div class="chips">${augmentChips(plan.opponentItems)}</div>` : ''}
        ${plan.statMult > 1 ? `<div class="scaling">+${Math.round((plan.statMult - 1) * 100)}% health and damage</div>` : ''}</div>
    </div>
    <div class="rules">
      ${plan.modifier ? `<div class="mod"><i>${plan.modifier.icon}</i><b>${plan.modifier.name}</b> ${plan.modifier.describe}</div>` : ''}
      <div>Win by reaching any goal first: <b>${goals.join(' · ')}</b></div>
    </div>
    <div class="actions">
      <button class="go" data-action="fight">Fight</button>
      <button class="link" data-action="abandon">Abandon run</button>
    </div>
    ${CONTROLS}`);
  const action = await waitFor(el);
  hide();
  return action as 'fight' | 'abandon';
}

// ---------- after a win ----------

export async function augmentPick(
  run: RunState, offers: () => AugmentId[], onReroll: () => boolean, heading = `Floor ${run.floor + 1} cleared`,
): Promise<AugmentId> {
  for (;;) {
    const ids = offers();
    const tier = AUGMENTS[ids[0]].tier;
    const el = show(`
      <div class="floorhead"><small>${heading}</small><h1>Choose an augment</h1></div>
      <div class="cards">
        ${ids.map((id) => {
          const a = AUGMENTS[id];
          return `<button class="card augcard tier-${a.tier}" data-action="pick:${id}">
            <div class="icon">${a.icon}</div><div class="name">${a.name}</div><small class="tier">${a.tier}</small><p>${a.describe}</p></button>`;
        }).join('')}
      </div>
      <div class="actions">
        <button class="link" data-action="reroll" ${run.rerolls > 0 ? '' : 'disabled'}>↻ Reroll (${run.rerolls} left)</button>
      </div>
      <p class="hint">${tier === 'prismatic' ? 'Prismatic augments are build-defining. The boss is next.' : `Your augments: ${run.augments.length ? run.augments.map((a) => AUGMENTS[a].icon).join(' ') : 'none yet'}`}</p>`);
    const action = await waitFor(el);
    if (action === 'reroll') {
      onReroll();
      continue;
    }
    hide();
    return action.slice('pick:'.length);
  }
}

// ---------- free starting relic ----------

export async function starterItem(run: RunState, ids: AugmentId[]): Promise<AugmentId> {
  const el = show(`
    <div class="floorhead"><small>Starting gift · ${KITS[run.kit].name}</small><h1>Choose a relic</h1></div>
    <div class="cards">
      ${ids.map((id) => {
        const it = ITEMS[id];
        return `<button class="card itemcard" data-action="pick:${id}">
          <div class="icon">${it.icon}</div><div class="name">${it.name}</div><p>${it.describe}</p><div class="price">Free</div></button>`;
      }).join('')}
    </div>
    <p class="hint">Relics are free, kept for the whole run, and never sold in the shop. Your augments: ${run.augments.map((a) => AUGMENTS[a].icon).join(' ') || 'none yet'}</p>`);
  const action = await waitFor(el);
  hide();
  return action.slice('pick:'.length);
}

// ---------- shop between floors ----------

/**
 * Buy items until "Next floor" is clicked. `onBuy` performs (and saves) the purchase; `onSpells`
 * swaps (and saves) the summoner spells, which are free to change here.
 */
export async function shop(run: RunState, onBuy: (id: AugmentId) => void, onSpells: (pair: SpellPair) => void = () => {}): Promise<void> {
  for (;;) {
    const card = (id: AugmentId) => {
      const it = ITEMS[id];
      const why = cantBuy(run, id);
      const sold = why === 'Sold out' || why === 'Owned';
      return `<button class="card itemcard${sold ? ' sold' : ''}" data-action="buy:${id}" ${why ? 'disabled' : ''}>
        <div class="icon">${it.icon}</div><div class="name">${it.name}</div>
        <p>${it.describe}</p><div class="price${why === 'Not enough gold' ? ' short' : ''}">${sold ? why : `● ${it.cost}`}</div></button>`;
    };
    const el = show(`
      <div class="floorhead"><small>Before floor ${run.floor + 1} · ${FLOORS[run.floor].title}</small><h1>Shop</h1></div>
      <div class="purse">● ${run.gold} gold</div>
      <h3>Items <small>kept for the rest of the run · ${run.items.length}/${MAX_ITEMS} slots</small></h3>
      <div class="cards shelf">${shopStock(run).map(card).join('')}</div>
      <h3>Consumables <small>next duel only</small></h3>
      <div class="cards shelf">${CONSUMABLES.map(card).join('')}</div>
      <div class="chips">${augmentChips([...run.items, ...run.consumables], true, 'Nothing bought yet')}</div>
      <h3>Summoner spells <small>free to swap</small></h3>
      <div class="spellpick"></div>
      <div class="actions"><button class="go" data-action="leave">Next floor →</button></div>`);
    const sample = new World(1).spawnChampion('blue', run.kit, { think: () => [] });
    spellPicker(el.querySelector('.spellpick')!, runSummoners(run), sample, onSpells);
    const action = await waitFor(el);
    if (action === 'leave') break;
    onBuy(action.slice('buy:'.length));
  }
  hide();
}

// ---------- end of run ----------

// ---------- online PvP ----------

type StartMsg = Extract<ServerMsg, { t: 'start' }>;

/** Shown when the PvP server can't be reached. */
export async function onlineUnavailable(url: string): Promise<void> {
  const el = show(`
    <div class="floorhead"><small>Online</small><h1>Can't reach the server</h1></div>
    <p class="hint">No PvP server answered at <code>${url}</code>.<br>
      On the machine running the game, start it with <code>npm run server</code>, then try again.</p>
    <div class="actions"><button class="go" data-action="back">Back</button></div>`);
  await waitFor(el);
  hide();
}

/**
 * Online lobby: create a room (and share its code) or join one, pick a champion and summoner spells,
 * and ready up. Resolves with the server's start message once both players are ready, or null if
 * the player leaves. Re-entered after each duel: the room is still there for a rematch.
 */
export function onlineLobby(net: NetClient): Promise<StartMsg | null> {
  return new Promise((resolve) => {
    let error = '';
    let spells: SpellPair = [...DEFAULT_SUMMONERS];
    const finish = (r: StartMsg | null) => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('keydown', onKey);
      net.onMessage = () => {};
      net.onClose = () => {};
      hide();
      resolve(r);
    };

    const entry = () => `
      <div class="floorhead"><small>Online · 1v1</small><h1>Play a friend</h1></div>
      <div class="netentry">
        <button class="go" data-net="create">Create a room</button>
        <div class="joinrow"><input class="code" maxlength="4" placeholder="CODE" autocomplete="off" spellcheck="false">
          <button class="go" data-net="join">Join</button></div>
        ${error ? `<p class="neterr">${error}</p>` : ''}
      </div>
      <div class="actions"><button class="link" data-net="back">Back</button></div>`;

    const card = (p: LobbyPlayer | undefined, label: string) => p
      ? `<div class="netplayer${p.ready ? ' ready' : ''}" style="--accent:${KITS[p.kit].color}"><small>${label}</small>
          <span class="mini-portrait big">${portraitHtml(p.kit)}</span>${kitName(p.kit)}
          <div class="chips">${spellChips(p.summoners)}</div><b class="state">${p.ready ? 'Ready' : 'Picking…'}</b></div>`
      : `<div class="netplayer waiting"><small>${label}</small><p>Waiting for someone to join…</p></div>`;

    const room = () => {
      const lobby = net.lobby!;
      const me = lobby.players.find((p) => p.team === lobby.you)!;
      const them = lobby.players.find((p) => p.team !== lobby.you);
      spells = [...me.summoners] as SpellPair;
      return `
        <div class="floorhead"><small>Online · share this code with your opponent</small><h1 class="roomcode">${lobby.code}</h1></div>
        <div class="netplayers">${card(me, 'You')}<span class="vs">VS</span>${card(them, 'Opponent')}</div>
        <div class="roster">${KIT_IDS.map((id) => `
          <button class="pick${me.kit === id ? ' on' : ''}" data-kit="${id}" style="--accent:${KITS[id].color}" title="${KITS[id].name}">
            <span class="mini-portrait">${portraitHtml(id)}</span><span class="pname">${KITS[id].name}</span></button>`).join('')}
        </div>
        <div class="spellpick"></div>
        <div class="actions">
          <button class="go" data-net="ready" ${them ? '' : 'disabled'}>${me.ready ? 'Not ready' : 'Ready'}</button>
          <button class="link" data-net="leave">Leave room</button></div>
        ${error ? `<p class="neterr">${error}</p>` : ''}`;
    };

    const el = show('');
    el.classList.add('online');
    const render = () => {
      const fresh = !el.querySelector('.roomcode') !== !net.lobby; // switched between entry and room
      el.innerHTML = net.lobby ? room() : entry();
      if (fresh) el.scrollTop = 0;
      if (!net.lobby) return;
      const me = net.lobby.players.find((p) => p.team === net.lobby!.you)!;
      const sample = new World(1).spawnChampion('blue', me.kit, { think: () => [] });
      spellPicker(el.querySelector('.spellpick')!, spells, sample, (p) => {
        spells = p;
        net.send({ t: 'pick', kit: me.kit, summoners: p });
      });
    };

    net.onMessage = (msg) => {
      if (msg.t === 'lobby') {
        error = '';
        render();
      } else if (msg.t === 'error') {
        error = msg.message;
        render();
      } else if (msg.t === 'start') {
        el.classList.remove('online');
        finish(msg);
      }
    };
    net.onClose = () => {
      net.lobby = null;
      error = 'Lost the connection to the server.';
      render();
    };

    const join = () => {
      const code = el.querySelector<HTMLInputElement>('input.code')?.value.trim().toUpperCase() ?? '';
      if (code.length !== 4) {
        error = 'Room codes are 4 letters.';
        return render();
      }
      net.enter(code);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.target as HTMLElement).matches('input.code')) join();
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      const kit = t.closest<HTMLElement>('[data-kit]')?.dataset.kit as KitId | undefined;
      if (kit && net.lobby) return net.send({ t: 'pick', kit, summoners: spells });
      const action = t.closest<HTMLElement>('[data-net]')?.dataset.net;
      if (action === 'create') net.enter(null);
      else if (action === 'join') join();
      else if (action === 'ready' && net.lobby) {
        const me = net.lobby.players.find((p) => p.team === net.lobby!.you)!;
        net.send({ t: 'ready', ready: !me.ready });
      } else if (action === 'leave') {
        net.leave();
        render();
      } else if (action === 'back') {
        el.classList.remove('online');
        finish(null);
      }
    };
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    render();
    if (!net.lobby) el.querySelector<HTMLInputElement>('input.code')?.focus();
  });
}

// ---------- after each duel ----------

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** A damage breakdown: one bar per source, scaled to the largest. */
function breakdown(title: string, rs: RecapRow[], empty: string) {
  const sum = total(rs);
  const max = Math.max(1, ...rs.map((r) => r.amount));
  return `<div class="recapcol"><h4>${title} <span>${Math.round(sum)}</span></h4>
    ${rs.length ? rs.map((r) => `
      <div class="rrow ${r.kind}" title="${Math.round(r.amount)} damage (${Math.round((100 * r.amount) / Math.max(1, sum))}%)">
        <i>${r.icon}</i><span class="lbl">${r.key ? `<kbd>${r.key}</kbd> ` : ''}${r.label}</span><b>${Math.round(r.amount)}</b>
        <div class="fill" style="width:${(100 * r.amount) / max}%"></div>
      </div>`).join('') : `<p class="none">${empty}</p>`}</div>`;
}

/**
 * The recap after every duel, won or lost: damage you dealt to the opponent and everything that hit
 * you, by source, with kills, deaths and CS. `subtitle` says which floor (or bot match) it was.
 */
export async function duelRecap(recap: DuelRecap, won: boolean, reason: WinReason | null, subtitle: string): Promise<void> {
  const { me, foe } = recap;
  const stat = (side: typeof me) => `<span class="mini-portrait" style="--accent:${KITS[side.kit].color}">${portraitHtml(side.kit)}</span>
    <div>${kitName(side.kit)}<br><small>Level ${side.level} · ${side.kills} kill${side.kills === 1 ? '' : 's'} · ${side.deaths} death${side.deaths === 1 ? '' : 's'} · ${side.cs} CS</small></div>`;
  const el = show(`
    <div class="floorhead"><small>${subtitle} · ${fmtTime(recap.seconds)}${reason ? ` · ${won ? 'won' : 'lost'} on ${REASON[reason]}` : ''}</small>
      ${reason || won ? `<h1 class="${won ? 'gold' : 'red'}">${won ? 'Victory' : 'Defeat'}</h1>` : '<h1>Match over</h1>' /* left a bot match early */}</div>
    <div class="recap">
      <div class="recapside"><div class="who">${stat(me)}</div>
        ${breakdown(`You dealt to ${foe.name}`, me.dealt, `No damage to ${foe.name}.`)}</div>
      <div class="recapside"><div class="who">${stat(foe)}</div>
        ${breakdown('What hit you', me.taken, 'Untouched.')}</div>
    </div>
    <div class="actions"><button class="go" data-action="next">Continue</button></div>`);
  await waitFor(el);
  hide();
}

export async function runEnd(run: RunState, won: boolean, meta: Meta): Promise<void> {
  const reached = won ? FLOORS.length : run.floor + 1;
  const el = show(`
    <div class="floorhead"><small>${KITS[run.kit].name} · ${won ? 'all floors cleared' : `fell on floor ${reached}`}</small>
      <h1 class="${won ? 'gold' : 'red'}">${won ? 'Legend!' : 'Run over'}</h1></div>
    <ol class="results">
      ${run.results.map((r) => `<li class="${r.won ? 'won' : 'lost'}"><b>${FLOORS[r.floor].title}</b> vs ${KITS[r.opponent].name}
        <span>${r.won ? 'won' : 'lost'}${r.reason ? ` (${REASON[r.reason]})` : ''} · ${Math.floor(r.seconds / 60)}:${String(r.seconds % 60).padStart(2, '0')}</span></li>`).join('')}
    </ol>
    <div class="chips">${augmentChips([...run.augments, ...run.items], true, 'No augments or items')}</div>
    <p class="hint">Best with ${KITS[run.kit].name}: floor ${meta.best[run.kit] ?? reached} · ${meta.runs} run${meta.runs === 1 ? '' : 's'}, ${meta.wins} won</p>
    <div class="actions"><button class="go" data-action="again">New run</button></div>`);
  await waitFor(el);
  hide();
}
