import type { Unit } from '../types';

/** Per-rank value (rank 1 = first entry); rank 0 reads as rank 1 so tooltips can preview it. */
export const at = (values: number[], rank: number) => values[Math.max(0, Math.min(values.length, rank) - 1)];

/** What skillshots stop on: champions, minions and pets (Thistle body-blocks for Pip). */
export const champsAndMinions = (u: Unit) => u.kind === 'champion' || u.kind === 'minion' || u.kind === 'pet';
