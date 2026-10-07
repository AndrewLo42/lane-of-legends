import type { KitId, Unit } from '../types';
import { ARLO } from './arlo';
import { LISHA } from './lisha';
import { MAREN } from './maren';
import { TOCK } from './tock';
import type { Kit } from './types';

export const KITS: Record<KitId, Kit> = { arlo: ARLO, tock: TOCK, maren: MAREN, lisha: LISHA };
export const KIT_IDS = Object.keys(KITS) as KitId[];

export const kitOf = (u: Unit) => KITS[u.champ!.kit];
