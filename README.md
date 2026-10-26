# Lane League

One lane, you against a CPU opponent, League-style, wrapped in a roguelike run. Built with Three.js, TypeScript and Vite.

**The run:** pick a champion (a portrait grid on the left with All / Melee / Ranged filters, a 🧪 toggle for experimental champions and a search box; the selected champion stands on the podium, with their kit and hero skills in tabs on the right; arrow keys to browse, Enter to start), take a free starting gift (1 of 3 silver augments, then 1 of 3 **relics**: playful passives that are never sold in the shop: Ricochet Charm, Wisp Lantern, Phoenix Feather, Lucky Coin, Echo Bell, Leech Seed), and climb 5 floors (Rookie → Contender → Veteran → Champion → Legend). Each duel uses League's 1v1 rules: the first to **2 kills, 45 CS or a tower** wins (any champion death scores for the other side, tower executes included). Both champions start at level 3 with Q/E/W learned and earn double XP. Towers have their full health on floor 1 and gain 10% per floor after it (+40% on Legend), since both sides hit harder as the run goes on. After each win, pick 1 of 3 **augments** (silver after floor 1, gold after 2 and 3, prismatic before the boss; one reroll per run). Opponents bring their own augments, and their aim and stats scale with the floor.

**How to play:** "❔ How to play" on the home screen opens a guide (`src/ui/howToPlay.ts`): the duel's win conditions, the controls, a few tips and the ways to play.

**Bot vs bot:** "🤖 Watch bots duel" on the home screen picks two champions (or Random) and lets you spectate a duel between two Legend-level bots under the run's duel rules, at 1×, 2× or 4× speed (Esc or Leave to go back).

**Hero skills** (called summoners in the code): pick two on the champion select panel (D and F; hold to aim, release to cast) and swap them for free in the shop between floors: **Blink** (blink 4, works while rooted), **Scorch** (burn the enemy champion and halve their healing), **Ghost** (+35% move speed), **Ward** (a 2.5s shield), **Tether** (a skillshot that tags; cast again to dash to it, a miss costs only 20s), **Rage** (bonus attack damage and +35% attack speed). Cooldowns are 60–75s, so each comes up once or twice a duel. The CPU uses its champion's signature pair (shown on the floor intro). Free play takes `&spells=flash,ghost` (the code ids are older names: `flash` is Blink, `ignite` Scorch, `barrier` Ward). Code: `src/sim/summoners.ts`.

**Bots** (`src/sim/bot.ts`, rule-based): every bot retreats when low, keeps out of enemy tower range without minion cover, plays its champion's kit, trades when healthy and otherwise farms. On top of that: it attack-moves up to the wave when the enemy champion is dead or far away; it steps out of telegraphs and wide missiles, and sometimes (30% of its accuracy, in the last 0.45s) out of a skillshot; and when the enemy champion has hit it for 8% of its health in 3s from out of its reach (direct hits, not burns), while it's below 75% health and not ahead, it plays safe: it walks in only for last hits outside their reach and otherwise waits behind its wave, unless their wave is on its tower. A melee bot facing a ranged champion doesn't do this (it can't out-wait them; it farms through the poke). Once its wave has pushed into their tower with nothing left to farm, it hits the tower while 3 or more of its minions tank it (and their champion isn't close); with only a straggler or two left it goes home if below 55% health or 20% mana and comes back with the next wave, and otherwise waits on its side of mid-lane where the next waves meet (by its own tower if their champion is already there). Aurelle's bot leaves a dropped spear that lies in the enemy's reach or their wave.

**Shop:** gold you earn in a duel, plus a 250 victory bonus, carries over. After each augment pick, a shop sells 5 seeded items, kept for the rest of the run (max 6). Basic items are 300–400 gold, mid items 900–1000 (e.g. Stormcaller Bow: every third attack calls lightning) and big items 1400–1500 (e.g. Tidebreaker Aegis: a shield when you drop low). It also sells next-duel consumables: Elixir of Wrath, Tome of Insight (start a level higher) and Fortune Token (+1 augment reroll). Opponents carry items from a budget of 800 gold per floor. Items live in `src/sim/items.ts` and share the augment hook system (`Perk`). Floors 2–5 each add a lane modifier (Rush Hour, Glass Towers, Bloodlust, Overcharged, Gold Rush). A loss ends the run. The run saves between floors (a reload resumes at the next intro or the pending augment pick), and best floors per champion are kept. Code: `src/run/run.ts` (floors, offers, saves), `src/sim/augments.ts`, `src/sim/rules.ts`, and `src/duel.ts` (one duel's world, views and input).

```bash
npm install
npm run dev        # http://localhost:5173 (?seed=42 for a fixed seed)
npm test           # sim tests
```

**Controls:** right-click the ground to move or an enemy to attack (hold to steer) · A then left-click to attack-move (A shows your attack range; the click attacks the enemy nearest it within 4 units, or walks there attacking the first enemy that comes into reach; it's an `attackMove` command in the sim) · hold Q/W/E/R to aim and release to cast (right-click while aiming cancels) · Alt+Q/W/E/R or the + buttons to level an ability · S stop · Y lock/unlock camera (edge-pan when unlocked) · hold Space to centre the camera · wheel zoom · minimap (bottom right): left-click or drag to look there (unlocks the camera; Y or Space brings it back), right-click or drag to walk there. Free play (no run, nexus to win): the 🎯 **Free play** button on champion select plays the selected champion and hero skills against a bot you choose (or Random); Esc or the Leave button ends it, then the recap. From the URL: `?champ=arlo|tock|maren|lisha|mabel|aurelle|gormund|sable`, `&enemy=…` (defaults to the other one), `&seed=42`, `&augments=brute,haste&items=i.blade` (comma-separated ids) to start with upgrades. Augments and items show as icon rows left of the ability bar, growing outward.

**Online 1v1 (PvP).** Start the server next to the game (`npm run server`, port 8787), then pick **⚔ Play online** on the home screen: one player creates a room and shares its 4-letter code, the other joins, both pick a champion and hero skills and ready up. The duel uses the normal duel rules (first to 2 kills, 45 CS or the first tower), both players get the recap, and the room stays open for a rematch. Leaving mid-duel forfeits. Tick **Relics** in the room and, once both players are ready, each chooses 1 of 3 random relics (the run's starting gifts) to carry into the duel; after 20 seconds one is picked for you. Either player can toggle it, and it applies to every rematch in the room.
- The server runs the only simulation at 30 Hz; clients send their commands and draw from a snapshot of the world each tick (`src/net/protocol.ts`). A snapshot carries only what changed since that player's previous one (fields rounded to 3 decimals): about 1 KB, or 20–30 KB/s a player. A command that arrives mid-tick may pull the next tick up to 15 ms early, so it's applied and acknowledged sooner. A room (`server/room.ts`) is hosted either by the Node server (`server/main.ts`) or on Cloudflare (`worker/index.ts`, one Durable Object per room). Players connect to `/room/new` to create a room or `/room/CODE` to join; `/health` answers `ok`.
- By default the game looks for the server on the machine serving it (LAN: whoever runs `npm run dev` also runs `npm run server`). Point it elsewhere with `?server=wss://host:port` or `VITE_PVP_SERVER` at build time, for a hosted server.
- Your own walking is predicted (`src/net/predict.ts`): it moves the moment you click, and each snapshot reconciles it (commands are numbered and acknowledged; unacknowledged ones are replayed over one round trip). Casts, dashes and the other player come straight from the server. A network readout shows top-left: ping (command to acknowledgement), jitter (how unevenly snapshots arrive), frames per second and download rate, each coloured by its own health (hover it for an explanation). If the server goes quiet for 2 seconds a "Connection unstable" banner shows.
- **Drops:** if your connection closes (or nothing arrives for 6 seconds) the game reconnects to the same duel with the seat token it was given on joining. The server pauses the duel and holds the seat for 30 seconds, showing the other player "Opponent disconnected" with a countdown; back in time, the duel picks up where it paused. Otherwise it's a forfeit: a "Connection lost" screen for you, a win for them. The seat is also kept in the tab's session storage, so refreshing the page mid-duel rejoins it too (closing the tab doesn't).
- To feel lag on one machine: `LATENCY=100 npm run server` holds every message 100 ms each way.
- **Cloudflare:** one Worker serves both the game (the built `dist/`) and the PvP server, at https://lane-league.crevice.workers.dev. `npm run deploy` builds and deploys both (`npx wrangler login` once first). A build looks for its server on the site that served it; set `VITE_PVP_SERVER` to host the game somewhere else. `npm run server:cf` runs the Worker locally on port 8787 (run `npm run build` first for the game). Local `wrangler dev` logs "Network connection lost" whenever a player disconnects; the room handles it normally.
- Not yet: augments and items in PvP, matchmaking (it would pair players into a room instead of trading a code), and reconnecting after a dropped connection.

**Champions** (kits in `src/sim/kits/`):

Champions without a Meshy model yet are **experimental** (`experimental: true` on the kit; a test keeps the flag in step with `public/assets/meshy/`). They play as placeholders, appear on the select screen only with the 🧪 *Experimental champions* toggle, and bots never play them (run opponents, free-play enemies, bot vs bot). Right now: **Lumen**, **Fennick** and **Hollis** (below).

Each champion's **Bot vs bot** row is its bot's win rate against every other bot champion (both sides, several seeds, the run's duel rules): a balance guide, not a promise.

### Arlo, the Wayfinder

Ranged skillshot marksman (Ezreal-like).

| | |
|---|---|
| **Passive: Triangulate** | Every attack or ability hit takes a bearing; the 3rd on the same enemy within 4s deals bonus damage and gives +15% attack speed for 2s. |
| **Q: Sparkshot** | Skillshot that hits the first enemy; on hit, all his cooldowns drop by 1.5s. |
| **W: Rune Flare** | Passes through minions and marks a champion; an attack or ability detonates the mark for damage and mana. |
| **E: Phase Step** | Blink, then a homing bolt at the nearest enemy (marked ones first). |
| **R: Skyline Barrage** | 0.75s wind-up, then a wide wave across the whole lane (minions take half). |
| **Bot** | Pokes with Sparkshot and Rune Flare, last-hits out of range with Sparkshot when it has mana to spare, Phase Steps in for a kill and out when losing up close, and fires Skyline Barrage from anywhere when it would kill. |
| **Bot vs bot** | About 44%. Strong into Tock, Pip and Gormund; weak into Sable, Maren and Aurelle. |
| **Code** | `src/sim/kits/arlo.ts` |

### Tock, the Unwound

Melee time-bender who trades, then undoes the damage.

| | |
|---|---|
| **Passive: Second Hand** | Every 3rd attack echoes 0.4s later for 60%. |
| **Q: Pendulum** | Telegraphed cone sweep; recast within 3s to backswing (+50% to anything hit by both swings). |
| **W: Stopwatch** | A field that slows enemies 35% and freezes enemy skillshots in mid-air (auto-attacks pass through); they crumble when it ends. Standing in his own field shields Tock (once per field), fading 1s after he leaves. |
| **E: Skip** | Dash through enemies, leaving an echo; recast within 4s to snap back to it. |
| **R: Rewind** | Plant an anchor; after 3s (or on recast) snap back to it, recover all health lost since, and every champion he damaged takes 50/75% of that damage again. |
| **Bot** | Opens good fights with Rewind: plants the anchor with the enemy in reach, then Stopwatch, Skip, both Pendulum swings and attacks, snapping back with its health restored and the echo on them (still a panic button when low). Freezes skillshots flying at it with Stopwatch, and against ranged champions drops Stopwatch on them and Skips in. |
| **Bot vs bot** | About 65%, the strongest on the roster (left strong on purpose; a 120/100s Rewind cooldown would bring him to about 53%). Strong into Lisha, Aurelle and Sable; weak into Mabel and Arlo. |
| **Code** | `src/sim/kits/tock.ts` |

### Maren, the Tidecaller

Ranged control mage.

| | |
|---|---|
| **Passive: Undertow** | Her abilities Soak champions; the 3rd stack roots for 1s. |
| **Q: Riptide** | A lobbed wave that lands after 0.6s (telegraphed) for damage and a 30% slow. |
| **W: Tide Shield** | An absorb shield that bursts around her when it breaks or fades. |
| **E: Undertow Hook** | Skillshot that drags the first enemy 4 units toward her. |
| **R: Maelstrom** | A 3s whirlpool that drags enemies inward and damages, then erupts and stuns for 1s. |
| **Bot** | Riptides where the enemy will be, hooks them in when healthy, drops Maelstrom on a slowed, rooted or hurt target, shields when they commit or a tower is about to hit, and farms with Riptide on minion clumps. |
| **Bot vs bot** | About 60%. Strong into Arlo, Mabel and Lisha; weak into Sable and Tock. |
| **Code** | `src/sim/kits/maren.ts` |

### Lisha, the Blossom Blade

Melee duelist (Irelia-like): mark enemies, then dash from target to target.

| | |
|---|---|
| **Passive: Petal Harvest** | Consuming a mark with Petal Step heals her. |
| **Q: Petal Step** | Dash to a clicked enemy and cut it; the cooldown resets if it was marked (also refunding half the mana) or dies. |
| **W: Find Your Center** | 1s meditation (rooted), then 3s of 35–55% damage reduction and 3% max health per second. |
| **E: Twin Petals** | A pincer: two blades start beside her and close on the aimed point; everything inside the V is cut (outermost first) and marked (minions take 80%). |
| **R: Blossom Storm** | A fan of 9 blades, up to 3 per enemy, marking everything. |
| **Bot** | Hit and run: Twin Petals to mark, Petal Step in (it can't be dodged, and a mark resets it and heals her), swing while a blade is up, and step out of their reach once both are down. Won't fight inside their wave or an unstoppable champion, gets out early when a fight turns, and only meditates out of their reach. |
| **Bot vs bot** | About 45%. Strong into Aurelle and Arlo; weak into Sable, Gormund and Mabel. |
| **Code** | `src/sim/kits/lisha.ts` |

### Mabel, the Beekeeper

A mouse; short-range lane pusher with the smallest hitbox. Spends **bees** instead of mana (4 rising to 8; one regrows every 4s, and last hits give one).

| | |
|---|---|
| **Passive: The Swarm** | Each bee adds damage to her attacks, honeyed enemies take 30% more from her bees, minions that die stung count as her last hits (Pollinated), and getting hit by a champion makes her scurry (+30% speed). |
| **Q: Sting** | A bee latches on and stings over 3s; stings stack. |
| **W: Honey Pot** | A slowing puddle that honeys enemies. |
| **E: Hive** | A 10s hive that fires bees, buffs nearby allied minions and doubles her bee regrowth. |
| **R: Queen's Fury** | Refill the swarm and dive one champion with every bee. |
| **Bot** | Kites melee champions (honey on the chaser, the hive behind her, a step back between shots), honeys first, keeps a bee in reserve for the hive, plants the hive between her and a fight or by her wave to siege, honeys minion clumps, stings minions so they count as hers, and calls Queen's Fury on a hurt or honeyed champion. |
| **Bot vs bot** | About 64%. Strong into Pip, Gormund and Aurelle; weak into Maren and Sable. |
| **Code** | `src/sim/kits/mabel.ts` |

### Aurelle, the Spellspear

Floating battle mage with a spear she throws and recalls.

| | |
|---|---|
| **Passive: Bound Weapon** | Holding her spear she attacks with 2.6-range thrusts; without it, arcane bolts (range 5, 70% damage). Picking it up empowers her next thrust, and a dropped spear flies back after 6s. |
| **Q: Arcane Lance** | Throw the spear through minions; if it impales a champion it stops in them, and she can recast within 3s to rip it back through everything (60% damage). A miss lands at max range and can't be recalled. |
| **W: Glyph Step** | Blink, leaving a glyph that detonates and slows. |
| **E: Sweep / Arcane Nova** | With the spear, a knockback sweep; without it, a bigger burst. |
| **R: Arsenal Ascendant** | For 6s, Arcane Lance throws three returning spectral lances (2s cooldown) and her attacks cleave; then they crash down around her. |
| **Bot** | Throws the lance at the champion (never into a Stopwatch field), rips it back the moment it impales, sweeps or novas when they're inside it, calls Arsenal Ascendant when a fight is on, and fetches a dropped spear only when it isn't in the enemy's reach, their wave or under their tower. |
| **Bot vs bot** | About 42%. Strong into Pip and Maren; weak into Lisha, Mabel and Tock. |
| **Code** | `src/sim/kits/aurelle.ts` |

### Gormund, Lord of the Labyrinth

A minotaur; melee juggernaut, bare-handed. No mana: **abilities cost a share of his current health** (never lethal).

| | |
|---|---|
| **Passive: Thick Hide and Fury** | After 3s without trading with the enemy champion or taking tower shots (minions don't count), he regenerates 5% max health per second. Fury: up to +30% damage as his health drops, maxed at 30% health. |
| **Q: Hurl Stone (7%)** | A rock skillshot that slows 35% and shatters for 60% splash; hitting the champion refunds its cost. |
| **W: Bellow (5%)** | A roar that slows nearby enemies 35%, gives him 25% speed for 2s and 25% damage reduction for 3s. |
| **E: Bull Rush (10%)** | A straight 6-unit charge; the first champion in the way is carried to the end and stunned for 0.75s, and minions are shoved aside. |
| **R: Labyrinth Rage** | For 7s he grows huge, is unstoppable (sheds and ignores slows, roots, stuns and pulls), casts for free and heals for 20% of his damage. |
| **Bot** | Aggressive: Bull Rush in, Bellow when they're in reach, and swing; commits on even trades (Fury) and takes some minion hits for it. Stones cost health, so it throws them only where they'll land (the target slowed, stunned or close, or a kill), plus into minion clumps to clear. |
| **Bot vs bot** | About 45%. Strong into Lisha and Aurelle; weak into Pip, Mabel and Maren. |
| **Code** | `src/sim/kits/gormund.ts` |

### Sable, the Silent

A quiet harvest reaper; melee catcher with a chained scythe.

| | |
|---|---|
| **Passive: Gleaning** | Hooked enemies are Gleaned for 4s: she reaches 1.2 further against them, and her damage to them heals her 25%. Her attacks sweep, hitting others in a short arc for 50%. |
| **Q: Reaping Hook** | A skillshot that yanks the first enemy to her and opens a 2.5s **Reaping window** for one follow-up (autos in the window are ordinary, so weave some in first): **Q again** to *Reap* (an empowered cone swing, up to 75% stronger the lower they are), **W** to *Bind* (root 1.25s), or **E** to *Vault* (leap over them to their far side and slow them). The follow-ups glow as recasts while the window is open, and using one closes it. |
| **W: Wide Swath** | A slowing spin (extra damage to minions). |
| **E: Drift** | A short dash; she takes 25% less damage for 2s. |
| **R: Last Harvest** | After a 0.5s wind-up (telegraphed), a great crescent drags everything in it to her and opens the window on all of them. |
| **Bot** | Aggressive, maxing Wide Swath first: Drifts in beside the enemy (the damage reduction carries the trade), then swaths and swings, Drifts into their casters to swath the back of the wave, hooks from range, and spends the Reaping window. |
| **Bot vs bot** | About 54%. Strong into Arlo, Gormund and Lisha; weak into Tock and Aurelle. |
| **Code** | `src/sim/kits/sable.ts` |

### Pip & Thistle, the Odd Couple

A tiny sprout-knight riding a giant, anxious toad. Pip is a BlenderKit model; Thistle is a custom static toad, hopped and squashed in code.

| | |
|---|---|
| **Passive: Best Friends** | Thistle is a second unit (a *pet*) with his own health that grows with Pip's level. While Pip rides, damage hits Thistle first, and he takes only 80% of it. He regenerates 2% of his health a second after 4s without being hit, and heals at the fountain. At 0 Thistle panics, throws Pip off and bounds home (untargetable) for 12s, coming back at half health. On foot, Thistle bites whatever Pip attacks, snaps at a champion attacking Pip, stops skillshots with his body, and minions and towers go for him before Pip. His kills are Pip's; only Pip's death counts. |
| **Riding** | Melee and faster, +20% auto damage and 40% more damage to minions (Thistle eats waves). |
| **Q: Gulp (riding)** | Tongue skillshot (a pink tongue stretches from Thistle's mouth and snaps back). Minions take 150%; one it finishes is swallowed, heals Thistle and halves the remaining cooldown; the enemy champion is yanked in. |
| **W: Hop (riding)** | A leap with a slowing splash. |
| **E: Hop Off (riding)** | Vault off (+20% move speed for 2s) and fight on foot. |
| **On foot** | A 5-range slingshot. Each form keeps its own Q/W cooldowns. |
| **Q: Pebble Burst (on foot)** | Three pebbles in a spread (repeat hits on one target deal 50%). |
| **W: Puff Up (on foot)** | Thistle hops to a spot and puffs up for 3s: 40% less damage taken, heals 30 + 6% of his max health over it, and slows enemies around him (he doesn't grow). |
| **E: Saddle Up (on foot)** | Dash to Thistle and climb on. |
| **R: Big Leap (both forms)** | Thistle crashes onto an area, damaging and knocking up (0.8s stun) everyone there; riding, Pip comes along. |
| **Bot** | Rides by default, Gulps any minion it would finish out of reach (a sure last hit that feeds Thistle), Hops onto minion clumps, steps out of reach when Thistle wears thin unless it's winning the fight, and fights on foot only while Thistle recovers, puffing him up in the enemy's path. |
| **Bot vs bot** | About 49%. Strong into Gormund, Tock and Sable; weak into Mabel, Arlo and Lisha. |
| **Code** | `src/sim/kits/pip.ts` |

### Sir Gerrit, the Grounded

An old knight of a fallen order who plants standards and thrusts himself into them, with a halberd. A BlenderKit knight with a hand-made halberd (see `assets-src/blenderkit/gerrit/`).

| | |
|---|---|
| **Passive: Hold the Ground** | Within 4 units of any of his standards he takes 25% less damage, attacks 20% faster and restores 2% of his max health a second. |
| **Q: Halberd Thrust** | A 7-unit line thrust that damages and slows; if it crosses one of his standards he's pulled to it, knocking up (0.5s) everyone he passes (each enemy at most once every 2s), and the standard stays. |
| **W: Bulwark** | A shield for 3s that slows champions who hit him; recast while it holds to slam it down, giving up the rest of it, and root enemies within 1 unit for 0.75s. |
| **E: Plant the Standard** | Thrown up to 7 units (the thrust's reach, so a standard at full range can always be thrusted to); damages and slows where it lands and stands 8s (one at a time, can't be attacked). |
| **R: Fallen Standards** | Click an enemy champion within 6 units; he leaps onto them, three old banners fly out and plant behind the target for 4s (they count as standards; enemies passing close are slowed), and Halberd Thrust comes off cooldown, so he can thrust through them to cut off the retreat. |
| **Bot** | Plants a standard at his feet when a fight starts, engages with a standard past the enemy and a thrust through them, and escapes by planting toward his tower and thrusting to it. Every bot steps off the line between an enemy Gerrit and his standards while his thrust is up. |
| **Bot vs bot** | About 34%. Strong into Gormund and Pip; weak into ranged poke (Arlo, Maren) and Sable. |
| **Code** | `src/sim/kits/gerrit.ts` |

### Lumen, the Kindly (experimental)

A ranged sustain caster whose light heals and whose heat burns. Placeholder candle-saint.

| | |
|---|---|
| **Passive: Devotion** | Her healing fills a 0–100 meter (shown under her mana). Healing beyond 3% of her max health a second becomes Devotion instead of health (the healing cap), and healing past full health becomes an Afterglow shield (up to 20% of her max health, 3s). At 100 she's **Radiant**: 20% more damage and 10% move speed, until she spends it. |
| **Q: Candleflame** | A skillshot that burns the first enemy hit and heals her for 30% of it (15% off minions, more for a minion kill). |
| **W: Sanctuary** | A ring of light for 3s; she heals inside, and enemies inside burn and are slowed 20%. |
| **E: Warm Embrace** | A dash that shields her and burns enemies she passes through. |
| **R: Sunrise** | Needs 50 Devotion and spends it all; she becomes a burning sun for 4–8s (longer with more Devotion), burning everything near her and healing off it. |
| **Bot** | Pokes with Candleflame, lays Sanctuary under trades, dashes through when winning, and saves Devotion (Radiant) unless Sunrise wins the fight. |
| **Bot vs bot** | About 46%. Strong into Gormund, Maren and Arlo; weak into Aurelle, Mabel and Tock. |
| **Code** | `src/sim/kits/lumen.ts` |

### Fennick, the Tinker-Archer (experimental)

A ranged auto-attack carry with no dash. Placeholder archer.

| | |
|---|---|
| **Passive: Quiver** | His attacks turn through frost (slows), fire (burns) and spark (jumps to the nearest other enemy) arrows; the HUD's meter shows the next one. |
| **Q: Longshot** | The game's first *press-and-hold* ability: the key going down starts the draw (he slows and can't attack), and letting go sends a `release` command that looses it. It reaches 6 to 12 units over 1.25s; a full draw hits for 125%, pierces, and carries his next arrow. It looses itself after 3s. It's a *poke*: minions only answer the call for help if he's within their aggro range, so a full draw from outside the wave doesn't drag it across the lane. |
| **W: Volley** | His next attack looses all three arrows in quick succession, then the quiver skips ahead one. |
| **E: Snare Shot** | A net arrow; enemies in the net are slowed, and anyone still in it after 0.75s is rooted. |
| **R: Overcharge** | For 5s every attack carries all three arrows, plus 25–35% move speed that fades. |
| **Bot** | Maxes Longshot and fires it fully drawn down the longest line of minions to clear the wave (catching the champion in it when it can), pokes with attacks and Volley when the trade is safe, and goes all in (Snare Shot, Overcharge, attacks) when they're low and he isn't, keeping the net for divers against melee champions. Kites melee champions throughout. |
| **Bot vs bot** | About 44%. Strong into Pip, Aurelle and Arlo; weak into divers (Tock, Gormund, Lisha). |
| **Code** | `src/sim/kits/fennick.ts` |

### Hollis, the Shepherd (experimental)

A melee wave controller: he wins on CS and towers rather than kills. Placeholder shepherd and sheepdog.

| | |
|---|---|
| **Passive: The Flock** | Allied minions within 6 units move 15% faster and take 15% less damage, and so does Hollis while 2 or more are with him. Bramble, his sheepdog, follows at heel and bites what Hollis attacks (20 + 30% AD, once a second). Bramble is a pet that can never be targeted. |
| **Q: Whistle** | Every allied minion within 7 units goes for the enemy nearest the cursor (champion or minion), attacking 30% faster and dealing 50% more damage to it for 3s. Whistled minions glow gold. Needs minions nearby. |
| **W: Crook** | A hook (8 units) that catches the first enemy. A minion is pulled to Hollis and *herded*: it changes sides for 5s with at most half its health, then wanders off and dies. However it dies, it's Hollis's last hit (CS, gold, XP). A champion takes damage, is pulled 2.5 units toward him and slowed. |
| **E: Bramble** | Bramble bounds to a spot (7 units): enemy minions there are herded 3 units back toward their tower, and an enemy champion is nipped and slowed. |
| **R: Stampede** | Spectral sheep thunder 20 units down the lane in a band 6 wide: enemies take damage, are shoved aside and slowed, and his own minions they pass charge with them (40% faster, 30% less damage, 6s). |
| **Bot** | A first pass: Bramble a wave that's about to reach his tower, crook minions he can't reach (and the champion when nothing blocks), whistle the wave onto a champion standing in it while he's healthy, and stampede for a kill or to carry a big wave into the tower. |
| **Bot vs bot** | About 35%, every win on CS. Strong into Arlo and Sable; loses to the melee bruisers (Tock, Gormund). |
| **Code** | `src/sim/kits/hollis.ts`; herding, whistled targets and intangible pets in `src/sim/world.ts` |

Marked units (Lisha's marks, Arlo's Rune Flare) wear a pulsing ring and a floating petal in the marker's colour.

Crowd control: **root** (no walking, dashing or blinking), **stun** (nothing, and it interrupts wind-ups), **shields** (absorb damage first, shown white on health bars) and **pulls**. **Unstoppable** units ignore all of it. A cast pressed during another wind-up or dash is buffered for 0.4s, so combos like E→W don't drop keys.

Levels 1–11 from XP (minions dying within 12 units, champion kills). Each level gives a skill point: basics up to rank ceil(level/2), max 5; ultimate at 6 and 11.

- **Lane rules:** a wave of 3 melee + 3 caster minions every 30 s (first at 0:03). Minions fight minions, then structures, then champions. Towers shoot minions before champions, unless you hit their champion while in range (and nearby enemy minions switch to you too). The tower behind is invulnerable until the one in front falls, and the nexus until both have. Last hits pay gold (melee 21, caster 14, champion 300, tower 150). Champions respawn after 8 s and heal fast at their fountain behind the nexus. Destroy the nexus to win (R to play again). Numbers live in `src/sim/stats.ts`.
- `src/sim/` holds the deterministic game simulation (no three.js). `src/render/` draws it, and `src/main.ts` wires them together.
- `docs/plan.md` covers milestones and the asset list. `docs/art-bible.md` covers the look and the prompt blocks.
- **Asset pipeline** (copied from `threejs-roguelike`): `npm run meshy -- <cmd>` (concept, model, remesh, rig, animate; needs `MESHY_API_KEY` in `.env.local`). Then run `Blender -b --python tools/blender/import_meshy.py -- assets-src/meshy/<name>/import.json` to build the game GLB in `public/assets/meshy/`.
