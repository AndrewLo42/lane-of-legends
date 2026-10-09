# Lane Rogue

One lane, you against a CPU opponent, League-style, wrapped in a roguelike run. Built with Three.js, TypeScript and Vite.

**The run:** pick a champion (portraits along the top; the selected champion stands on the podium beside their full kit, ←/→ to browse, Enter to start), take a free starting gift (1 of 3 silver augments, then 1 of 3 **relics**: playful passives that are never sold in the shop: Ricochet Charm, Wisp Lantern, Phoenix Feather, Lucky Coin, Echo Bell, Leech Seed), and climb 5 floors (Rookie → Contender → Veteran → Champion → Legend). Each duel uses League's 1v1 rules: the first to **2 kills, 30 CS or a tower** wins (any champion death scores for the other side, tower executes included). Both champions start at level 3 with Q/E/W learned and earn double XP. After each win, pick 1 of 3 **augments** (silver after floor 1, gold after 2 and 3, prismatic before the boss; one reroll per run). Opponents bring their own augments, and their aim and stats scale with the floor.

**Summoner spells:** pick two on the champion select panel (D and F; hold to aim, release to cast) and swap them for free in the shop between floors: **Flash** (blink 4, works while rooted), **Ignite** (burn the enemy champion and halve their healing), **Ghost** (+35% move speed), **Barrier** (a 2.5s shield), **Tether** (a skillshot that tags; cast again to dash to it, a miss costs only 20s), **Rage** (bonus attack damage and +35% attack speed). Cooldowns are 60–75s, so each comes up once or twice a duel. The CPU uses its champion's signature pair (shown on the floor intro). Free play takes `&spells=flash,ghost`. Code: `src/sim/summoners.ts`.

**Shop:** gold you earn in a duel, plus a 250 victory bonus, carries over. After each augment pick, a shop sells 5 seeded items, kept for the rest of the run (max 6). Basic items are 300–400 gold, mid items 900–1000 (e.g. Stormcaller Bow: every third attack calls lightning) and big items 1400–1500 (e.g. Tidebreaker Aegis: a shield when you drop low). It also sells next-duel consumables: Elixir of Wrath, Tome of Insight (start a level higher) and Fortune Token (+1 augment reroll). Opponents carry items from a budget of 800 gold per floor. Items live in `src/sim/items.ts` and share the augment hook system (`Perk`). Floors 2–5 each add a lane modifier (Rush Hour, Glass Towers, Bloodlust, Overcharged, Gold Rush). A loss ends the run. The run saves between floors (a reload resumes at the next intro or the pending augment pick), and best floors per champion are kept. Code: `src/run/run.ts` (floors, offers, saves), `src/sim/augments.ts`, `src/sim/rules.ts`, and `src/duel.ts` (one duel's world, views and input).

```bash
npm install
npm run dev        # http://localhost:5173 (?seed=42 for a fixed seed)
npm test           # sim tests
```

**Controls:** right-click the ground to move or an enemy to attack (hold to steer) · hold Q/W/E/R to aim and release to cast (right-click while aiming cancels) · Alt+Q/W/E/R or the + buttons to level an ability · S stop · Y lock/unlock camera (edge-pan when unlocked) · hold Space to centre the camera · wheel zoom · minimap (bottom right): left-click or drag to look there (unlocks the camera; Y or Space brings it back), right-click or drag to walk there. Free play (no run, nexus to win): `?champ=arlo|tock|maren|lisha|mabel`, `&enemy=…` (defaults to the other one), `&seed=42`.

**Champions** (kits in `src/sim/kits/`):

| | Arlo, the Wayfinder (ranged, Ezreal-like) | Tock, the Unwound (melee time-bender) | Maren, the Tidecaller (ranged control mage) |
|---|---|---|---|
| Passive | **Triangulate**: every attack or ability hit takes a bearing; the 3rd on the same enemy within 4s deals bonus damage and gives +15% attack speed for 2s | **Second Hand**: every 3rd attack echoes 0.4s later for 60% | **Undertow**: abilities Soak champions; the 3rd stack roots for 1s |
| Q | **Sparkshot**: skillshot that hits the first enemy; on hit, all cooldowns -1.5s | **Pendulum**: telegraphed cone sweep; recast within 3s to backswing (+50% to anything hit twice) | **Riptide**: lobbed wave lands after 0.6s (telegraphed) for damage + 30% slow |
| W | **Rune Flare**: passes minions and marks a champion; an attack or ability detonates it for damage + mana | **Stopwatch**: field that slows enemies 35% and freezes enemy skillshots in mid-air (auto-attacks pass through); they crumble when it ends. Standing in his own field shields Tock (once per field), fading 1s after he leaves | **Tide Shield**: absorb shield; bursts around her when it breaks or fades |
| E | **Phase Step**: blink, then a homing bolt at the nearest enemy (marked first) | **Skip**: dash through enemies, leaving an echo; recast within 4s to snap back | **Undertow Hook**: skillshot that drags the first enemy 4 units toward her |
| R | **Skyline Barrage**: 0.75s wind-up, then a wide wave across the whole lane (minions take half) | **Rewind**: plant an anchor; after 3s (or recast) snap back, recover all HP lost since, and replay 50/75% of the damage you dealt to champions | **Maelstrom**: 3s whirlpool that drags enemies inward and damages, then erupts and stuns 1s |

**Lisha, the Blossom Blade** (melee duelist, Irelia-like): **Petal Harvest** passive: consuming a mark with Q heals her · **Q Petal Step**: dash to a clicked enemy and cut it; resets if it was marked (also refunds half the mana) or dies · **W Find Your Center**: 1s meditation (rooted), then 3s of 35–55% damage reduction and 3% max HP/s regeneration · **E Twin Petals**: a pincer: two blades start beside her and close on the aimed point; everything inside the V is cut (outermost first) and marked (minions take 80%) · **R Blossom Storm**: a fan of 9 blades, up to 3 per enemy, marking everything.

**Mabel, the Beekeeper** (a mouse; short-range lane pusher, smallest hitbox): spends **bees** instead of mana (4 rising to 8, one regrows every 4s, last hits give one). **The Swarm** passive: each bee adds damage to her attacks, honeyed enemies take 30% more from her bees, minions that die stung count as her last hits (**Pollinated**), and getting hit by a champion makes her scurry (+30% speed). **Q Sting**: a bee latches on and stings over 3s; stings stack · **W Honey Pot**: a slowing puddle that honeys enemies · **E Hive**: a 10s hive that fires bees, buffs nearby allied minions and doubles her bee regrowth · **R Queen's Fury**: refill the swarm and dive one champion with every bee. Placeholder model for now.

Marked units (Lisha's marks, Arlo's Rune Flare) wear a pulsing ring and a floating petal in the marker's colour.

Crowd control: **root** (no walking, dashing or blinking), **stun** (nothing, and it interrupts wind-ups), **shields** (absorb damage first, shown white on health bars) and **pulls**. A cast pressed during another wind-up or dash is buffered for 0.4s, so combos like E→W don't drop keys.

Levels 1–11 from XP (minions dying within 12 units, champion kills). Each level gives a skill point: basics up to rank ceil(level/2), max 5; ultimate at 6 and 11.

- **Lane rules:** a wave of 3 melee + 3 caster minions every 30 s (first at 0:03). Minions fight minions, then structures, then champions. Towers shoot minions before champions, unless you hit their champion while in range (and nearby enemy minions switch to you too). The tower behind is invulnerable until the one in front falls, and the nexus until both have. Last hits pay gold (melee 21, caster 14, champion 300, tower 150). Champions respawn after 8 s and heal fast at their fountain behind the nexus. Destroy the nexus to win (R to play again). Numbers live in `src/sim/stats.ts`.
- `src/sim/` holds the deterministic game simulation (no three.js). `src/render/` draws it, and `src/main.ts` wires them together.
- `docs/plan.md` covers milestones and the asset list. `docs/art-bible.md` covers the look and the prompt blocks.
- **Asset pipeline** (copied from `threejs-roguelike`): `npm run meshy -- <cmd>` (concept, model, remesh, rig, animate; needs `MESHY_API_KEY` in `.env.local`). Then run `Blender -b --python tools/blender/import_meshy.py -- assets-src/meshy/<name>/import.json` to build the game GLB in `public/assets/meshy/`.
