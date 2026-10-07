import type { KitId, Unit } from '../types';
import { ARLO } from './arlo';
import { MAREN } from './maren';
import { TOCK } from './tock';
import type { Kit } from './types';

export const KITS: Record<KitId, Kit> = { arlo: ARLO, tock: TOCK, maren: MAREN };
export const KIT_IDS = Object.keys(KITS) as KitId[];

export const kitOf = (u: Unit) => KITS[u.champ!.kit];
