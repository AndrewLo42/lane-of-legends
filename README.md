# Lane Rogue

One lane, you against a CPU opponent, League-style, wrapped in a roguelike run. Built with Three.js, TypeScript and Vite.

**The run:** pick a champion and climb 5 floors (Rookie → Contender → Veteran → Champion → Legend). Each duel uses League's 1v1 rules: the first to **2 kills, 30 CS or a tower** wins (any champion death scores for the other side, tower executes included). Both champions start at level 3 with Q/E/W learned and earn double XP. After each win, pick 1 of 3 **augments** (silver after floor 1, gold after 2 and 3, prismatic before the boss; one reroll per run). Opponents bring their own augments, and their aim and stats scale with the floor. Floors 2–5 each add a lane modifier (Rush Hour, Glass Towers, Bloodlust, Overcharged, Gold Rush). A loss ends the run. The run saves between floors (a reload resumes at the next intro or the pending augment pick), and best floors per champion are kept. Code: `src/run/run.ts` (floors, offers, saves), `src/sim/augments.ts`, `src/sim/rules.ts`, and `src/duel.ts` (one duel's world, views and input).

```bash
npm install
npm run dev        # http://localhost:5173 (?seed=42 for a fixed seed)
npm test           # sim tests
```

**Controls:** right-click the ground to move or an enemy to attack (hold to steer) · hold Q/W/E/R to aim and release to cast (right-click while aiming cancels) · Alt+Q/W/E/R or the + buttons to level an ability · S stop · Y lock/unlock camera (edge-pan when unlocked) · hold Space to centre the camera · wheel zoom. Free play (no run, nexus to win): `?champ=arlo|tock`, `&enemy=…` (defaults to the other one), `&seed=42`.

**Champions** (kits in `src/sim/kits/`):

| | Arlo, the Wayfinder (ranged, Ezreal-like) | Tock, the Unwound (melee time-bender) |
|---|---|---|
| Passive | **Momentum**: ability hits grant +10% attack speed, up to 5 stacks | **Second Hand**: every 3rd attack echoes 0.4s later for 60% |
| Q | **Sparkshot**: skillshot that hits the first enemy; on hit, all cooldowns -1.5s | **Pendulum**: telegraphed cone sweep; recast within 3s to backswing (+50% to anything hit twice) |
| W | **Rune Flare**: passes minions and marks a champion; an attack or ability detonates it for damage + mana | **Stopwatch**: field that slows enemies 50% and freezes enemy projectiles in mid-air; they crumble when it ends |
| E | **Phase Step**: blink, then a homing bolt at the nearest enemy (marked first) | **Skip**: dash through enemies, leaving an echo; recast within 4s to snap back |
| R | **Skyline Barrage**: 1s wind-up, then a wave across the whole lane (minions take half) | **Rewind**: plant an anchor; after 3s (or recast) snap back, recover all HP lost since, and replay 50/75% of the damage you dealt to champions |

Levels 1–11 from XP (minions dying within 12 units, champion kills). Each level gives a skill point: basics up to rank ceil(level/2), max 5; ultimate at 6 and 11.

- **Lane rules:** a wave of 3 melee + 3 caster minions every 30 s (first at 0:03). Minions fight minions, then structures, then champions. Towers shoot minions before champions, unless you hit their champion while in range (and nearby enemy minions switch to you too). The tower behind is invulnerable until the one in front falls, and the nexus until both have. Last hits pay gold (melee 21, caster 14, champion 300, tower 150). Champions respawn after 8 s and heal fast at their fountain behind the nexus. Destroy the nexus to win (R to play again). Numbers live in `src/sim/stats.ts`.
- `src/sim/` holds the deterministic game simulation (no three.js). `src/render/` draws it, and `src/main.ts` wires them together.
- `docs/plan.md` covers milestones and the asset list. `docs/art-bible.md` covers the look and the prompt blocks.
- **Asset pipeline** (copied from `threejs-roguelike`): `npm run meshy -- <cmd>` (concept, model, remesh, rig, animate; needs `MESHY_API_KEY` in `.env.local`). Then run `Blender -b --python tools/blender/import_meshy.py -- assets-src/meshy/<name>/import.json` to build the game GLB in `public/assets/meshy/`.
