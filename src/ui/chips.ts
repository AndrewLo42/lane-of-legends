import { AUGMENTS } from '../sim/augments';
import type { AugmentId } from '../sim/types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** A small tier-coloured augment badge; the description shows on hover. */
export const augmentChip = (id: AugmentId, withName = true) => {
  const a = AUGMENTS[id];
  return `<span class="aug tier-${a.tier}" title="${esc(`${a.name}: ${a.describe}`)}"><i>${a.icon}</i>${withName ? esc(a.name) : ''}</span>`;
};

export const augmentChips = (ids: AugmentId[], withName = true) =>
  ids.length ? ids.map((id) => augmentChip(id, withName)).join('') : '<span class="none">No augments</span>';
