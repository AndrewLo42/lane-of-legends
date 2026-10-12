import type { KitId, Unit } from '../types';
import { ARLO } from './arlo';
import { AURELLE } from './aurelle';
import { GORMUND } from './gormund';
import { LISHA } from './lisha';
import { MABEL } from './mabel';
import { MAREN } from './maren';
import { TOCK } from './tock';
import type { Kit } from './types';

export const KITS: Record<KitId, Kit> = { arlo: ARLO, tock: TOCK, maren: MAREN, lisha: LISHA, mabel: MABEL, aurelle: AURELLE, gormund: GORMUND };
export const KIT_IDS = Object.keys(KITS) as KitId[];
/** Champions bots may play: everyone but the experimental ones (no model yet). */
export const BOT_KIT_IDS = KIT_IDS.filter((k) => !KITS[k].experimental);

export const kitOf = (u: Unit) => KITS[u.champ!.kit];
