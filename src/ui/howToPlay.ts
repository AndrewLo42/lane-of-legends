import { DUEL_RULES } from '../sim/rules';

/**
 * "How to play": the goal of a duel, the controls and the modes, in a modal over the home screen.
 * Closes on Esc, the close button or a click outside the panel.
 */
export function openHowToPlay() {
  if (document.getElementById('howto')) return;
  const k = (...keys: string[]) => keys.map((key) => `<kbd>${key}</kbd>`).join('');
  const row = (keys: string, what: string) => `<tr><td>${keys}</td><td>${what}</td></tr>`;
  const el = document.createElement('div');
  el.id = 'howto';
  el.innerHTML = `
    <div class="panel" role="dialog" aria-modal="true" aria-labelledby="howto-title">
      <button class="close" data-close title="Close (Esc)">✕</button>
      <h2 id="howto-title">How to play</h2>

      <h3>Win the lane</h3>
      <p>Every duel is one lane: you, your opponent, waves of minions and a tower on each side. The first to reach any one of these wins:</p>
      <ul class="goals">
        <li><b>${DUEL_RULES.killsToWin} kills</b> on the enemy champion</li>
        <li><b>${DUEL_RULES.csToWin} CS</b>: land the killing blow on ${DUEL_RULES.csToWin} enemy minions (only the last hit counts, and it earns gold)</li>
        <li><b>The first tower</b>: destroy the enemy's tower</li>
      </ul>

      <h3>Controls</h3>
      <table class="keys">
        ${row(k('Right-click'), 'Move, or attack the enemy under the cursor (hold to keep moving)')}
        ${row(`${k('A')} + ${k('Left-click')}`, 'Attack-move: A shows your attack range; click to attack the enemy nearest the click, or walk there attacking whatever comes into reach')}
        ${row(k('Q', 'W', 'E', 'R'), 'Hold to aim an ability, release to cast. Right-click while aiming cancels.')}
        ${row(k('D', 'F'), 'Hero skills (Blink, Ghost…): aim and cast the same way')}
        ${row(`${k('Alt')} + ${k('Q')}…`, 'Level up an ability when you have a point (or click its <b>+</b>)')}
        ${row(k('S'), 'Stop')}
        ${row(k('Y'), 'Lock or unlock the camera on your champion')}
        ${row(k('Space'), 'Hold to centre the camera on your champion')}
        ${row(k('Wheel'), 'Zoom')}
        ${row('Minimap', 'Left-click to look there, right-click to walk there')}
      </table>

      <h3>Tips</h3>
      <ul>
        <li>Champions start at level 3 with Q, W and E. Your ultimate (R) unlocks at level 6.</li>
        <li>Towers hit hard. Stay out of the enemy tower's range unless your minions are there to take the hits.</li>
        <li>Hover anything (abilities, items, augments) for its details.</li>
      </ul>

      <h3>Ways to play</h3>
      <ul>
        <li><b>Run</b>: pick a champion and climb 5 floors of CPU opponents. Take a free starting augment and relic, choose a new augment after each win, and spend your gold in the shop between floors. One loss ends the run.</li>
        <li><b>⚔ Play online</b>: create a room and share its 4-letter code with a friend, or join theirs, for a 1v1 duel (relics optional).</li>
        <li><b>🤖 Watch bots duel</b>: two CPU champions fight while you watch.</li>
      </ul>
    </div>`;
  const close = () => {
    el.remove();
    removeEventListener('keydown', onKey, true);
  };
  // Captured first, so Esc and arrow keys don't also reach the home screen underneath.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    if (['Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === el || t.closest('[data-close]')) close();
  });
  addEventListener('keydown', onKey, true);
  document.body.appendChild(el);
  el.querySelector<HTMLButtonElement>('[data-close]')!.focus();
}
