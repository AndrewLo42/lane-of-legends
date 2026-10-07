import { FLOORS, type FloorPlan, type Meta, type RunState } from '../run/run';
import { AUGMENTS } from '../sim/augments';
import { KITS, KIT_IDS } from '../sim/kits';
import type { WinReason } from '../sim/rules';
import type { AugmentId, KitId } from '../sim/types';
import { augmentChips } from './chips';

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
  release to cast (right-click cancels) · <kbd>Alt</kbd>+key or <kbd>+</kbd> level up · <kbd>S</kbd> stop · <kbd>Y</kbd> camera lock ·
  hold <kbd>Space</kbd> centre camera · wheel zoom</p>`;

const kitName = (id: KitId) => `<b style="color:${KITS[id].color}">${KITS[id].name}</b> <small>${KITS[id].title}</small>`;

// ---------- champion select ----------

export async function pickChampion(meta: Meta): Promise<KitId> {
  const el = show(`
    <h1>Lane Rogue</h1>
    <p class="sub">Five duels. One lane. Pick augments as you climb, and the run ends at your first loss.</p>
    <div class="cards">
      ${KIT_IDS.map((id) => {
        const k = KITS[id];
        const best = meta.best[id];
        return `
          <button class="card champ" data-action="${id}" style="--accent:${k.color}">
            <div class="name">${k.name} <span>${k.title}</span></div>
            <p class="blurb">${k.blurb}</p>
            <ul>
              <li><i>${k.passive.icon}</i><b>${k.passive.name}</b><small>Passive</small></li>
              ${k.abilities.map((a, s) => `<li><i>${a.icon}</i><b>${a.name}</b><small>${KEYS[s]}</small></li>`).join('')}
            </ul>
            <div class="best">${best ? `Best: floor ${best} of ${FLOORS.length}` : 'Not played yet'}</div>
          </button>`;
      }).join('')}
    </div>
    ${CONTROLS}
    <p class="hint">${meta.runs ? `${meta.runs} run${meta.runs === 1 ? '' : 's'} · ${meta.wins} won · ` : ''}Free play: add <code>?champ=arlo&amp;enemy=tock</code> to the URL.</p>`);
  const kit = (await waitFor(el)) as KitId;
  hide();
  return kit;
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
      <div class="side"><small>You</small><div>${kitName(run.kit)}</div><div class="chips">${augmentChips(run.augments)}</div></div>
      <div class="vs">VS</div>
      <div class="side"><small>Opponent</small><div>${kitName(plan.opponent)}</div>
        <div class="chips">${augmentChips(plan.opponentAugments)}</div>
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

export async function augmentPick(run: RunState, offers: () => AugmentId[], onReroll: () => boolean): Promise<AugmentId> {
  for (;;) {
    const ids = offers();
    const tier = AUGMENTS[ids[0]].tier;
    const el = show(`
      <div class="floorhead"><small>Floor ${run.floor + 1} cleared</small><h1>Choose an augment</h1></div>
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

// ---------- end of run ----------

export async function runEnd(run: RunState, won: boolean, meta: Meta): Promise<void> {
  const reached = won ? FLOORS.length : run.floor + 1;
  const el = show(`
    <div class="floorhead"><small>${KITS[run.kit].name} · ${won ? 'all floors cleared' : `fell on floor ${reached}`}</small>
      <h1 class="${won ? 'gold' : 'red'}">${won ? 'Legend!' : 'Run over'}</h1></div>
    <ol class="results">
      ${run.results.map((r) => `<li class="${r.won ? 'won' : 'lost'}"><b>${FLOORS[r.floor].title}</b> vs ${KITS[r.opponent].name}
        <span>${r.won ? 'won' : 'lost'}${r.reason ? ` (${REASON[r.reason]})` : ''} · ${Math.floor(r.seconds / 60)}:${String(r.seconds % 60).padStart(2, '0')}</span></li>`).join('')}
    </ol>
    <div class="chips">${augmentChips(run.augments)}</div>
    <p class="hint">Best with ${KITS[run.kit].name}: floor ${meta.best[run.kit] ?? reached} · ${meta.runs} run${meta.runs === 1 ? '' : 's'}, ${meta.wins} won</p>
    <div class="actions"><button class="go" data-action="again">New run</button></div>`);
  await waitFor(el);
  hide();
}
