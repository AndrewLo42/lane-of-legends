import { kitOf } from './kits';
import type { Kit } from './kits/types';

/** An ability slot's name, both forms' for a champion with two ability sets (Pip: "Gulp / Pebble Burst"). */
function slotLabel(kit: Kit, slot: number) {
  const a = kit.abilities[slot];
  const b = kit.otherForm?.abilities[slot];
  return { name: b && b.name !== a.name ? `${a.name} / ${b.name}` : a.name, icon: a.icon };
}
import type { KitId, Unit } from './types';
import { TICK_HZ } from './util';
import type { World } from './world';

/** One line of a damage breakdown. */
export interface RecapRow {
  label: string;
  /** The key it's cast with (Q/W/E/R), for abilities. */
  key?: string;
  icon: string;
  amount: number;
  kind: 'attack' | 'ability' | 'effect' | 'minion' | 'tower';
}

export interface RecapSide {
  kit: KitId;
  name: string;
  kills: number;
  deaths: number;
  cs: number;
  level: number;
  /** Damage this champion dealt to the other champion, biggest first. */
  dealt: RecapRow[];
  /** Damage this champion took from everything, biggest first. */
  taken: RecapRow[];
}

/** End-of-duel damage recap for both champions. */
export interface DuelRecap {
  seconds: number;
  me: RecapSide;
  foe: RecapSide;
}

const KEYS = ['Q', 'W', 'E', 'R'];

/** Rows for damage `target` took, from `from` only (a champion) or from everything. */
function rows(world: World, target: Unit, from?: Unit): RecapRow[] {
  const out = new Map<string, RecapRow>();
  for (const t of world.damageTaken(target.id)) {
    let row: Omit<RecapRow, 'amount'>;
    if (t.source.startsWith('c')) {
      const src = world.get(Number(t.source.slice(1)));
      if (from && src !== from) continue;
      if (!src?.champ) continue;
      const kit = kitOf(src);
      if (t.category === 'attack') row = { label: 'Attacks', icon: '⚔', kind: 'attack' };
      else if (t.category === 'pet') row = { label: 'Thistle', icon: '🐸', kind: 'attack' };
      else if (t.category.startsWith('slot')) {
        const slot = Number(t.category.slice(4));
        const l = slotLabel(kit, slot);
        row = { label: l.name, key: KEYS[slot], icon: l.icon, kind: 'ability' };
      } else row = { label: 'Passives, items & burns', icon: '✦', kind: 'effect' };
      if (!from) row = { ...row, label: `${kit.name} · ${row.label}` };
    } else {
      if (from) continue;
      if (t.source === 'minion') row = { label: 'Minions', icon: '🪖', kind: 'minion' };
      else if (t.source === 'tower') row = { label: 'Towers', icon: '🏰', kind: 'tower' };
      else row = { label: 'Other', icon: '✦', kind: 'effect' };
    }
    const k = `${row.label}|${row.key ?? ''}`;
    const cur = out.get(k);
    if (cur) cur.amount += t.amount;
    else out.set(k, { ...row, amount: t.amount });
  }
  return [...out.values()].filter((r) => r.amount >= 1).sort((a, b) => b.amount - a.amount);
}

/** A recap row for one hit's source: whose ability (or attacks), or minions / towers. */
export function rowForHit(world: World, h: { sourceId: number | null; sourceKind: string | null; attack: boolean; slot?: number }): Omit<RecapRow, 'amount'> {
  const src = world.get(h.sourceId);
  const owner = src?.pet ? world.get(src.pet.ownerId) : undefined;
  if (owner?.champ) return { label: `${kitOf(owner).name} · Thistle`, icon: '🐸', kind: 'attack' };
  if (src?.champ) {
    const kit = kitOf(src);
    if (h.attack) return { label: `${kit.name} · Attacks`, icon: '⚔', kind: 'attack' };
    if (h.slot != null) {
      const l = slotLabel(kit, h.slot);
      return { label: `${kit.name} · ${l.name}`, key: KEYS[h.slot], icon: l.icon, kind: 'ability' };
    }
    return { label: `${kit.name} · Passives, items & burns`, icon: '✦', kind: 'effect' };
  }
  const kind = src?.kind ?? h.sourceKind;
  if (kind === 'minion') return { label: 'Minions', icon: '🪖', kind: 'minion' };
  if (kind === 'tower') return { label: 'Towers', icon: '🏰', kind: 'tower' };
  return { label: 'Other', icon: '✦', kind: 'effect' };
}

function side(world: World, u: Unit, other: Unit): RecapSide {
  const c = u.champ!;
  return {
    kit: c.kit, name: kitOf(u).name, kills: c.kills, deaths: c.deaths, cs: c.cs, level: c.level,
    dealt: rows(world, other, u),
    taken: rows(world, u),
  };
}

export function duelRecap(world: World, me: Unit, foe: Unit): DuelRecap {
  return { seconds: Math.round(world.tick / TICK_HZ), me: side(world, me, foe), foe: side(world, foe, me) };
}

export const total = (rs: RecapRow[]) => rs.reduce((t, r) => t + r.amount, 0);
