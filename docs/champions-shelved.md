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
