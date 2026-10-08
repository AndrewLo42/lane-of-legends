import { AUGMENTS } from '../sim/augments';
import { ITEMS } from '../sim/items';
import { SUMMONERS } from '../sim/summoners';
import type { AugmentId, SummonerId } from '../sim/types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** A small badge for an augment (coloured by tier) or a shop item; the description shows on hover. */
export const augmentChip = (id: AugmentId, withName = true) => {
  const a = AUGMENTS[id] ?? ITEMS[id];
  const tier = 'tier' in a ? a.tier : 'item';
  return `<span class="aug tier-${tier}" title="${esc(`${a.name}: ${a.describe}`)}"><i>${a.icon}</i>${withName ? esc(a.name) : ''}</span>`;
};

export const augmentChips = (ids: AugmentId[], withName = true, none = 'No augments') =>
  ids.length ? ids.map((id) => augmentChip(id, withName)).join('') : `<span class="none">${none}</span>`;

/** Badges for a pair of summoner spells (described on hover, for a level-1 champion). */
export const spellChips = (ids: SummonerId[], keys = ['D', 'F']) =>
  ids.map((id, i) => `<span class="aug tier-spell" title="${esc(`${SUMMONERS[id].name} (${keys[i]}): ${SUMMONERS[id].cooldown}s cooldown`)}"><i>${SUMMONERS[id].icon}</i>${esc(SUMMONERS[id].name)}</span>`).join('');

