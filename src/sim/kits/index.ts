import type { KitId, Unit } from '../types';
import { ARLO } from './arlo';
import { AURELLE } from './aurelle';
import { GORMUND } from './gormund';
import { LISHA } from './lisha';
import { MABEL } from './mabel';
import { MAREN } from './maren';
import { SABLE } from './sable';
import { TOCK } from './tock';
import { GERRIT } from './gerrit';
import { LUMEN } from './lumen';
import { FENNICK } from './fennick';
import { PIP } from './pip';
import { HOLLIS } from './hollis';
import type { AbilityDef, Kit } from './types';

export const KITS: Record<KitId, Kit> = { arlo: ARLO, tock: TOCK, maren: MAREN, lisha: LISHA, mabel: MABEL, aurelle: AURELLE, gormund: GORMUND, sable: SABLE, pip: PIP, gerrit: GERRIT, lumen: LUMEN, fennick: FENNICK, hollis: HOLLIS };
export const KIT_IDS = Object.keys(KITS) as KitId[];
/** Champions bots may play: everyone but the experimental ones (no model yet). */
export const BOT_KIT_IDS = KIT_IDS.filter((k) => !KITS[k].experimental);

export const kitOf = (u: Unit) => KITS[u.champ!.kit];

/** Melee or ranged, for champion select's filters. */
export const reachOf = (id: KitId) => KITS[id].reach ?? (KITS[id].stats.range < 3 ? 'melee' : 'ranged');

/** The abilities a champion has right now (Pip's change when he gets off Thistle). */
export function abilitiesOf(u: Unit): readonly [AbilityDef, AbilityDef, AbilityDef, AbilityDef] {
  const kit = kitOf(u);
  return kit.otherForm?.active(u) ? kit.otherForm.abilities : kit.abilities;
}
