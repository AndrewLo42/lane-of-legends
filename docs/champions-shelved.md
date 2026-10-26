# Shelved champion designs

Kits we've agreed on but haven't built yet, with the reason each one is waiting.

## Pip & Thistle, the Odd Couple

**Status:** built and in the roster. Pip has a model (a BlenderKit kid, see `assets-src/blenderkit/pip/`), and Thistle a custom toad (`assets-src/blenderkit/thistle/`). See `src/sim/kits/pip.ts`. Changes from the design below: the dismounted W is **Puff Up** instead of the taunt (Thistle hops to a spot and puffs up: damage reduction and a slow around him, no size change), and Thistle is a *pet* unit for the whole duel (carried, untargetable, while Pip rides). Since then: Thistle regenerates out of combat and takes 80% of the damage he soaks for Pip, and a bot plays him (about 47% bot vs bot). Still to do: nothing outstanding (Pip via the BlenderKit rig swap; Thistle rigged or animated in code).

**Pitch.** Pip is a tiny sprout-knight child with a pot-lid shield and a slingshot. Thistle is a giant, anxious, spiky toad who would rather be anywhere else. On Thistle, Pip fights as a fast melee bruiser. On foot, Pip is a fragile ranged poker while Thistle stays nearby and soaks hits. They'd be the roster's first front-liner: everyone else wins by dodging, kiting or bursting.

### Passive: Best Friends
- Thistle has his own health bar. While Pip is riding, damage hits Thistle first.
- If Thistle reaches 0, he panics: he throws Pip off and bounds away. He then recovers for about 12s before Pip can ride him again.
- Only Pip's death counts as a champion death. Breaking the toad and then catching the kid is the opponent's win path.

### Mounted (melee, fast, tanky)
- **Auto:** tongue slaps.
- **Q, Gulp:** a tongue skillshot.
  - On a minion: Thistle swallows it, which counts as Pip's last hit, and heals Thistle.
  - On the enemy champion: yanks them a few units in.
- **W, Hop:** a short leap to a point, with a small splash on landing.
- **E, Hop Off:** Pip vaults backward off Thistle and switches to the on-foot kit.

### Dismounted (ranged, squishy)
- **Auto:** slingshot pebbles, at about 5 range.
- **Thistle while Pip is on foot:** he hops after whatever Pip attacks, and minions and turrets prefer to hit him. He acts as a bodyguard.
- **Q, Pebble Burst:** a short cone of three pebbles.
- **W, Hey, Over Here!:** Thistle croaks, and the enemy champion is forced to attack him for 1.5s. This is Pip's peel.
- **E, Saddle Up:** Pip runs to Thistle and climbs back on. Only works while Thistle isn't panicking.

### R: Big Leap
Thistle jumps high and crashes onto a target area, knocking up everyone there.
- **Mounted:** Pip rides along, so it's an engage.
- **Dismounted:** Thistle jumps alone, so Pip can set up the knock-up from safety.

### Intended duel flow
1. Ride in and trade.
2. When Thistle runs low, hop off and poke from behind him while he soaks hits.
3. Saddle back up for the all-in and finish with Big Leap.

The opponent's choice is whether to burn down the toad or dive past him onto the kid.

### Notes for building it
- **Comparison to Kled:** his mount also has its own health, but he only dismounts when it breaks. Here, dismounting is a choice, and the on-foot kit uses the toad as a bodyguard.
- **Model:** the open problem.
  - Current idea: leave Thistle unrigged and animate him in code. Toads move in squash-and-stretch hops anyway: crouch, launch, land, wobble.
  - Only Pip needs a Meshy rig and animations. While mounted, Pip stands on Thistle's back like a tiny surfer, so no riding pose is needed.
  - Alternatives: a quadruped rig from elsewhere, or a CC0 toad model.
- **Sim work, the biggest lift since summoner spells:**
  - Thistle becomes a second unit while Pip is on foot.
  - Minions and turrets need to prefer targeting him.
  - The forced-attack croak needs a status.
  - Mounted damage needs a routing rule: Thistle's health absorbs it first.
  - The bot needs judgement for when to mount and dismount.
- **Open questions:**
  - Should Pip be stronger on foot?
  - Should Thistle be able to die for good in a fight, rather than only panicking?

## Vesper, the Veiled

**Status:** a concept we liked, shelved while we build others. Not workshopped in detail yet.

**Pitch.** A masked stage magician who fights with misdirection. Fragile; she wins by making you swing at the wrong target.

- **Passive, Encore:** after reappearing from stealth, her next attack or ability crits for bonus damage.
- **Q, Card Fan:** a narrow cone of three cards; several cards on the same target stack bonus damage.
- **W, Vanish:** invisible for 2s, leaving a decoy where she stood that repeats her last command (keeps walking, or "attacks" her target for no damage). Taking damage ends the stealth early.
- **E, Switcheroo:** swap places with her decoy (within range): the escape, or the ambush.
- **R, Grand Illusion:** three decoys burst out around her and scatter; she's invisible for 1.5s among them, and her first hit out of it roots for 1s.

**The duel:** guess which Vesper is real; guess wrong and she swaps in behind you.

**Counterplay:** short stealth that damage breaks, revealed near towers, decoys die in one hit (area damage clears them).

**Notes for building it:**
- Invisibility: enemies can't target her and their clients don't draw her. Online, the server must leave her position out of the opponent's snapshots, or players could cheat.
- Decoys: pet-like units with no brain (like Thistle without the riding).
- The bot has to guess which one is real.
- Model: a BlenderKit humanoid with a cape and mask; decoys reuse it, ghostly.
- **Open question:** should decoys deal any damage, or be pure illusions?

## Kestrel, the Twin Fang

**Status:** a concept we liked, shelved while we build others. Not workshopped in detail yet.

**Pitch.** A duelist with two weapons and no mana: the highest skill ceiling on the roster.

- **Passive, Flow:** switching stance within 2s of casting an ability empowers the next ability in the new stance (a cross-stance combo).
- **Spear stance** (reach 3, slower, harder hits): Q Lunge Thrust (a long line stab), W Sweep (a cone that knocks back), E Vault (a short pole-vault).
- **Twin dagger stance** (melee, fast attacks): Q Flurry (several quick strikes on one target), W Parry (block the next hit; counter if one lands within 1s), E Shadow Step (a short dash that resets on a kill).
- **R, Swap Stance:** a 3s cooldown; it ranks up at 6 and 11, improving his stats in both stances instead of unlocking a big ultimate.

**The duel:** poke with spear reach, then swap in for a dagger all-in, with Flow bonuses between swaps.

**Counterplay:** his stance is readable (you see which weapon he holds), and he has no ultimate burst.

**Notes for building it:**
- Pip's two-ability-set system (`otherForm`, each form keeping its own Q/W cooldowns) already does most of the work; Parry is a new status.
- The bot needs a combo plan.
- Model: a BlenderKit humanoid with two weapon props that swap visibility.
- **Open question:** keep R as just the stance swap, or give him a real ultimate and move the swap to a passive cooldown?

## Corvin, the Collector

**Status:** a concept we liked, shelved while we build others. Not workshopped in detail yet. One of two ranged auto-attack hyper carry ideas (with Fennick); the roster has no true one yet (Arlo comes closest).

**Pitch.** A crow-masked bounty hunter who takes a trophy from everything he kills. Weak early, a monster late: the roguelike run itself is his scaling.

- **Passive, Trophies:** last hits give a feather, champion takedowns give five. Every 10 feathers: permanent bonus attack damage and a little range. **In a run, trophies carry over between duels**, so he's weak in duel 1 and a monster by duel 5. Online 1v1 is a single duel, so there they only scale within it.
- **Q, Ricochet:** an empowered attack that bounces to a second target (farms waves, pokes over them).
- **W, Snare:** a hidden trap that roots; his only peel.
- **E, Reload Roll:** a short roll that resets his attack timer.
- **R, Deadeye:** a long-range shot after a short channel; more damage the lower the target's health, and kills grant bonus trophies.

**The duel:** survive, farm, outscale. The opponent has to punish him early.

**Counterplay:** all-in him before the stacks add up; his only peel is a trap you can see coming.

**Notes for building it:**
- Trophies need to persist in the run state between duels (like relics and augments), plus a cap or diminishing returns so duel 5 isn't hopeless.
- The bot needs kiting (attack, step back, attack), which no bot does well yet; other ranged champions would benefit too.
- Model: a BlenderKit humanoid with a long coat, a crow mask and a crossbow or long rifle.
- **Open question:** should feathers also come from relics or augments, or only from kills?

## Fennick, the Tinker-Archer

**Status:** built, experimental (placeholder model, no BlenderKit model yet). See `src/sim/kits/fennick.ts`. Changes from the sketch below: **Q Longshot** is press-and-hold (draws from 6 to 12 range over 1.25s; a full draw pierces, hits harder and carries his next arrow), **W Volley** fires all three arrows on his next attack and skips the quiver ahead one, **E Snare Shot** is a net arrow (slow, then a root if they're still in it) instead of a dash, since most of the roster already has movement, and **R Overcharge** adds a fading burst of move speed. The original sketch:

**Pitch.** A gadgeteer whose quiver rotates through frost, fire and spark arrows. He wins by timing which arrow lands when it matters.

- **Passive, Quiver:** each attack uses the next arrow in the rotation: frost slows, fire burns, spark chains to a nearby minion. The HUD shows which arrow is next.
- **Q:** fires the next arrow, overcharged.
- **W:** skips ahead in the rotation.
- **E:** a dash that leaves a trail of the current element.
- **R:** for a few seconds, every attack applies all three effects.

**The duel:** count the rotation and line up frost for the chase, fire for the trade.

**Counterplay:** the rotation is readable (the next arrow shows on his bow), so trade when a weak arrow is up.

**Notes for building it:**
- Uses only existing statuses (slow, burn), so it's the cheapest of the hyper carry ideas to build. The arrow indicator could reuse Lumen's meter bar or a small icon.
- Spark's chain needs a short bounce helper (Corvin's Ricochet could share it).
- The bot needs kiting, as with Corvin, plus a rule for skipping to the right arrow.
- Model: a BlenderKit humanoid with goggles, a satchel and a mechanical bow; the arrow tips change color.
- **Open question:** is the R too similar to the passive? An alternative is a turret that fires the current arrow type.

## Hollis, the Shepherd

**Status:** built, experimental (placeholder shepherd and sheepdog, no BlenderKit model yet). See `src/sim/kits/hollis.ts` and the README. Herded minions do count as his CS. Changes from the sketch below, from a first balance pass (his bot won 3% at first): health 760 (+110) and AD 68 (+4.5); whistled minions also deal 50% more damage to their target; Crook 70–210 (+60% AD), Bramble's nip 60–200 (+50% AD), the bite 20 (+30% AD) once a second; Hollis himself takes 15% less damage with 2+ minions near him; Stampede has two ranks like every ultimate (175 / 300 (+60% AD), 90 / 70s cooldown). The Flock's 15% applies to all damage, not just champions'. Bot vs bot now about 35%, every win on CS.

**Pitch.** A gentle old shepherd with a crook, a weathered smock and a sheepdog called Bramble at his heel. He's the roster's only **wave controller**: he decides whether the lane freezes, slow-pushes or crashes into a tower. Every other champion fights *alongside* the minions; Hollis fights *through* them. That matters here more than in League, because 45 CS and a tower are two of the three ways to win a duel.

**Stats (melee, a reach of 2.4 with the crook):** health 720 (+105 per level), mana 300 (+40), mana regen 2.4, attack damage 62 (+4), attack interval 0.85s (+2% attack speed per level), move speed 6.3.

### Passive: The Flock
- Allied minions within 6 units of Hollis move 15% faster and take 15% less damage from champions, so his wave is hard to shove while he stands with it.
- Bramble, his sheepdog, follows him and bites whatever Hollis attacks, for 12 (+20% AD) damage every 1.2s. Bramble is a pet that can't be targeted, like Thistle while Pip rides him.

### Q: Whistle
- **Cost / cooldown:** 30 mana; 7 / 6.5 / 6 / 5.5 / 5s.
- Every allied minion within 7 units switches to the enemy nearest the cursor, champion or minion, and attacks 30% faster for 3s.
- Whistled at a champion, the wave becomes a real threat: a full wave is about 2 melee and 3 casters (14 and 24 damage per hit).
- **Telegraph:** the minions' eyes glow, so the target sees it coming.

### W: Crook
- **Cost / cooldown:** 55 mana; 13 / 12 / 11 / 10 / 9s.
- A hook along a line (range 8, width 0.8) that catches the first enemy it touches.
- **A minion:** yanked to Hollis and *herded*: it joins his side for 5s with half its health, then wanders off and dies. When it dies or the time runs out, it counts as Hollis's last hit (CS and gold). One guaranteed CS each cooldown, and one the enemy loses.
- **A champion:** pulled 2.5 units toward Hollis (`world.pull`) for 60 / 90 / 120 / 150 / 180 (+50% AD) damage, and slowed 30% for 1s.

### E: Bramble
- **Cost / cooldown:** 40 mana; 14 / 13 / 12 / 11 / 10s.
- Bramble bounds to a target area (range 7, radius 2.5).
- **Enemy minions there** are herded 3 units back toward their own tower. That stops a wave crashing into Hollis's tower, or holds a freeze in place.
- **An enemy champion there** is nipped for 50 / 80 / 110 / 140 / 170 (+40% AD) damage and slowed 25% for 1.5s.
- Bramble trots back to Hollis afterwards.

### R: Stampede
- **Cost / cooldown:** 100 mana; 90 / 75 / 60s.
- After a 0.4s wind-up, a herd of spectral sheep thunders from Hollis down the lane in a band 6 wide, travelling 20 units at 12 per second.
- **Enemies hit:** 150 / 250 / 350 (+60% AD) damage, shoved aside toward the lane's edge, and slowed 40% for 1.5s.
- **Allied minions the herd passes:** they charge with it, gaining 40% move speed and 30% damage reduction for 6s.
- It clears the enemy wave and sends his own crashing into the tower. It's his tower-taking button, not just a damage spell.

### How the duel plays
- **Early:** freeze the wave near his tower with Bramble and steal CS with Crook. The enemy has to walk up into his minions to farm.
- **When he's ahead:** Whistle his wave onto the enemy champion whenever they step in to last-hit. Each trade is several minion hits plus Hollis.
- **To close:** Stampede clears their wave and charges his own minions into the tower, so he wins on CS or the tower rather than kills.

### Counterplay
- **His power is his wave:** clear his minions and he's a modest melee champion with one hook. Champions that push fast (Mabel, Maren) shut him down.
- **Crook:** it's a skillshot that stops at the first thing it hits, so standing behind your own minions blocks it. A minion caught that way still counts against you, though.
- **Whistle:** its glowing eyes give you time to step back out of the wave's range.
- **Stampede:** it runs straight down the lane, so it can be sidestepped toward the walls.

### Notes for building it
- **Whistle:** needs a minion target override, a forced target with an expiry that minion AI in `world.ts` respects over its usual aggro (the same hook would serve a future taunt).
- **Herding a minion:** a temporary team change with an owner for the kill credit. Check the online snapshot carries `team` per unit; it does for champions and minions. Also check the 45-CS win rule counts the credited kill.
- **Bramble:** reuses the pet system (`spawnPet`, as for Thistle) with a follow-and-bite brain. E is a short dash for the pet, not for Hollis.
- **Stampede:** a wide projectile that moves down the lane (`spawnProjectile` with a `canHit` that also boosts allies). Arlo's Skyline Barrage is the closest existing effect.
- **Bot:** a first pass can use simple rules:
  - Bramble an enemy wave that's about to reach his tower.
  - Crook a minion that's on low health, or a champion who's in range and unshielded.
  - Whistle when the enemy is within 5 of his wave and Hollis has more than 50% health.
  - Stampede when the tower is within 20 and his wave has at least 3 minions.
  - Wave-state play (freeze or push on purpose) is a stretch goal.
- **Model:** a BlenderKit elderly humanoid with a smock, a satchel and a crook (as a hand prop, like Gerrit's halberd), plus a quadruped dog for Bramble. A BlenderKit dog, rigged, would be new work: Thistle was animated in code.
- **Open questions:**
  - Should herded minions count as Hollis's CS? It's the most distinctive part of the kit, but strong in a CS race. The fallback: they give gold, but not CS.
  - Is Whistle onto a champion too strong early? Alternative: at ranks 1–2 it works only on minions.
