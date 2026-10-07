# Lane Rogue: plan

A single-lane, League-style duel against a CPU opponent, wrapped in a roguelike run.

## Architecture
- **`src/sim/`**: the game itself, in pure TypeScript with no three.js or DOM imports. It runs a fixed 30 Hz tick on a 2D plane (`x` along the lane, `y` across it) and uses circle collisions instead of a physics engine. It's deterministic for a given seed and unit-tested with Vitest. Later it can run unchanged on a server for PvP.
- **Controllers**: a champion is driven by a `Controller` that returns `Command`s each tick. The human (`PlayerController` in `main.ts`) and the CPU (`sim/bot.ts`) use the same interface, and so would a network peer.
- **`src/render/`**: reads the sim state and interpolates between ticks. It never writes back to the sim. There are placeholder meshes now, and Meshy models come later through `animatedModel.ts` and `rigs.ts`.
- **`src/ui/`**: an HTML/CSS overlay for the HUD, ability bar, shop and augment picks.

## Milestones
1. **Lane sandbox** *(done)*: camera, right-click move and attack, structures with protection rules, minion waves, auto-attacks with windup and projectiles, tower targeting and call-for-help, gold from last hits, death, respawn, fountain healing, health bars, win/loss. The placeholder bot farms, avoids towers, trades and retreats.
2. **Champion kits** *(done)*: Arlo (Ezreal-like) and Tock (time-bender), with mana, cooldowns, recasts, levels and skill points, line and homing missiles, stasis zones that freeze projectiles, dashes, blinks, telegraphs, champion select, an ability bar with tooltips, and kit-aware bots. Kits are code (`src/sim/kits/*.ts`) using world helpers (`fireLine`, `addZone`, `dash`, `after`, ...), so new champions are mostly one file.
3. **CPU opponent**: a utility AI that scores last-hit, trade, retreat, all-in and avoid-tower. It wins or loses when a nexus falls.
4. **Roguelike run** *(done)*: a 5-floor ladder with 1v1 win goals (2 kills, 30 CS, first tower). There are 18 augments in three tiers, applied through stat mods plus hooks, and opponents get augments too. Lane modifiers, run saves and lifetime stats are in. Still open: meta-progression unlocks, more champions so opponents vary more, and a gold shop between floors (gold currently only shows in the HUD).
5. **Art pass**: Meshy champions and minions, effects, sound.
6. **Later**: online PvP using the sim on a server.

## Asset list
| Asset | Count | Source | Budget |
|---|---|---|---|
| Champions (idle, run, auto-attack ×2, cast ×2, hit, death, recall) | 1 player + 3–4 opponents | Meshy (`npm run meshy`) → `tools/blender/import_meshy.py` | ~12k tris, 2K textures |
| Minions: melee, caster | 2 models, team-tinted by material | Meshy, or CC0 (Quaternius / Kenney) | ~3k tris, 512–1K textures |
| Tower, nexus | 1 each, team-tinted crystal | Meshy, or a low-poly kit | ~5k tris |
| Lane kit: ground, cliff walls, brush, rocks, trees | ~10 pieces | CC0 low-poly kit plus a ground shader | instanced |
| Effects: projectiles, hit sparks, AoE and skillshot telegraphs, level-up, recall | ~15 | Code: shaders and particles, no files | — |
| Ability and augment icons | ~30 | Pixel Engine or an image model, framed consistently | 128 px |
| Sound effects and music | ~25 | Kenney audio, jsfxr; music later | — |

Everything starts as primitives. Art is the last step of each milestone, so it never blocks gameplay work.
