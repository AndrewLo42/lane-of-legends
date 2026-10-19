/** How a duel is won and what lane it's played on. */
export interface DuelRules {
  /** Champion kills needed to win. */
  killsToWin: number;
  /** Minion last hits needed to win. */
  csToWin: number;
  /** Destroying any enemy tower wins. */
  firstTowerWins: boolean;
  /** Seconds between minion waves. */
  waveInterval: number;
  towerHpMult: number;
  xpMult: number;
  goldMult: number;
  /** Both champions start at this level, with their first points in Q, E and W. */
  startLevel: number;
  /** Ability haste for everyone. */
  haste: number;
}

/** Free play: only a fallen nexus ends the game. */
export const SANDBOX_RULES: DuelRules = {
  killsToWin: Infinity, csToWin: Infinity, firstTowerWins: false, waveInterval: 30, towerHpMult: 1, xpMult: 1, goldMult: 1, startLevel: 1, haste: 0,
};

/** League's 1v1 rules, tuned so a duel takes a few minutes: first to 2 kills, first tower or 45 CS. */
export const DUEL_RULES: DuelRules = {
  killsToWin: 2, csToWin: 45, firstTowerWins: true, waveInterval: 25, towerHpMult: 1, xpMult: 2, goldMult: 1, startLevel: 3, haste: 0,
};

export type WinReason = 'nexus' | 'kills' | 'cs' | 'tower';
