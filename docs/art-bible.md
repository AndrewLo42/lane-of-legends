# Art bible

The look: **bright, stylized fantasy with chunky, readable silhouettes**, built to read from a high MOBA camera at about 30 m. We describe the style in our own words and never feed Riot artwork into generation tools, so every asset is an original design.

## Style pillars
1. **Readability first.** At gameplay zoom a champion is about 60 px tall. Shapes must read in silhouette: oversized weapons, heads, shoulders and hands, and slightly heroic-cartoon proportions (about 6 heads tall).
2. **Hand-painted textures.** Soft painted gradients and baked highlights, with minimal fine detail or noise. Detail that disappears at 60 px is wasted triangles.
3. **Team colour is sacred.** Blue (#3d8bff) and red (#ff4a3d) belong only to team markers: minion trim, tower crystals, the nexus, rings under champions. Champions' own palettes avoid pure saturated blue and red.
4. **Value contrast with the ground.** The lane is a mid-value warm dirt, so units are lighter or darker than it and never the same mid-brown.

## Prompt blocks (reused verbatim so assets match)
**Style:**
> stylized fantasy MOBA champion, hand-painted textures, chunky readable silhouette, slightly exaggerated heroic proportions, oversized weapon and shoulders, bright but controlled colors, clean shapes, game-ready character concept

**Sheet** (for image-to-3D input):
> full-body character turnaround sheet, front view, side view and back view, standing in a relaxed A-pose, arms away from the body, plain light grey background, even soft studio lighting, no cast shadows, entire figure visible head to toe

**Avoid:** photorealism, fine noisy detail, pure red or pure blue as a main colour, cropped feet, busy background, text, logos.

## Technical
- Origin at the feet. Champion height is about 1.8 m (the sim's champion radius is 0.6).
- Meshy rig, with clips renamed to canonical names by `import_meshy.py` (see `src/render/rigs.ts`).
- Weapons are baked into the champion mesh. Champions don't swap weapons, unlike the roguelike project.

## Minions (done, Meshy)
Clockwork faction, slim set: a brass bucket-helm knight with a sword and shield (`assets-src/meshy/minion_melee`) and a hooded lantern-headed mage (`minion_caster`). About 3.1k triangles each, 1K textures, with the clips Idle, Walk, Attack, Attack2 and Death. Team colour comes from **magenta key cloth**, which a shader in `src/render/assets.ts` swaps for team blue or red (diffuse and emissive).

## Structures (done, Meshy)
The same clockwork faction. The **tower** (`assets-src/meshy/tower`) is riveted brass on a stone base, with a side gear and wind-up key, magenta banners and a crystal. The **nexus** (`nexus`) is a stone plinth with pistons and pipes, and a toothed brass gear ring around a crystal heart. About 6.2k triangles each, 1K textures, static: built with `tools/blender/import_static.py` (no rig). They face the camera rather than down the lane, and when destroyed they shake, lean and sink.

## Champions (done, Meshy)
**Arlo** (a cartographer with a golden rune gauntlet), **Tock** (a clockwork knight with a chest clock) and **Maren** (a tidecaller in coral and sea-green robes). About 12.4k triangles each, 1K textures, built with `--pose none` from true A-pose concepts, so accessories survive. They are not team-tinted; health bars show the team. Clips: Idle, Run, Attack/Attack2, CastQ/W/E/R, Death, Hit and Select (a flourish for the select screen). Attacks and casts are trimmed to about 0.9 s around their peak hand speed, so the hit lands mid-clip. They're shown at 2.5 m (Tock 2.8 m), oversized next to the 7 m towers as in League. Tock's pendulum blade is a three.js prop (`PROPS` in `src/render/assets.ts`): gear pommel and crossguard, brass shaft, and a bob ringed by a crescent with a teal edge. His gauntlets are open hands in every clip, so it can't be convincingly held. Instead it **floats** (`float` mode), hanging from a spinning teal gear halo ahead of him and to his right. It sways on its own and strikes forward on each attack and cast. The float position was measured clear of his mesh in every clip through the whole sway and strike; anything closer gets hit by his arms when he runs or casts. (A `held` mode, locked to a hand bone perpendicular to the forearm, is there for props held by a hand that can grip.)

### Pipeline lessons
- **The A-pose step (`pose_mode: a-pose`) strips held props and thin cloth.** The first melee model lost its tabard and sword, and the caster lost its staff. Use `--pose none` when the concept is already close to an A-pose, add a `--texture` prompt naming the key-coloured cloth, or rebuild the prop at runtime (the caster's staff is a three.js mesh on the `RightHand` bone).
- **Check the concept views before modelling.** Drop any view that contradicts the others: a second front view in a different pose, or a back view with the prop in the mirrored hand.
- **Arms held close to the body rig badly.** The melee knight's sword arm and tabard deform in big swings. That's fine at gameplay distance, but for champions use a true A-pose concept.
- **Library clips are made for empty hands.** A prop locked to the wrist flops around, so held props follow the hand's *position* but stay upright (`PROPS` in `src/render/assets.ts`). For an "arms in front" look, use carry clips: the caster idles with **Torch Look Around** (337) and walks with **Spear Walk** (560), both of which hold their object in the **left** hand, so its staff sits there.
- **Check every asset in the model viewer** (`/viewer.html` in dev). It shows each clip, slow motion and the team tint up close, which the game camera is too far away to show.
- **Don't trust a model's origin.** The structures came back centred on their origin, not standing on it, despite `origin_at: bottom`. `instantiate()` now grounds and centres every model from its bounding box.
- **Use `--pose none` for props and structures.** Use only the concept views that agree (the nexus's side view showed its rings crossed, so only front and back were used).
- **Blender imports at 24 fps.** Clip `start`/`end` in `import.json` are in 24 fps seconds, so measure trims in that time base.
- **Costs (Oct 2026):** a concept sheet 9, image→3D 30, rig 5, animations about 3 each. Two minions cost about 190 credits, including one wasted concept pair, one model regeneration and the two caster carry clips. The tower and nexus cost 96 (4 concept sheets, 2 models). The three champions cost about 250 (6 concept sheets, 3 models, 3 rigs, 30 animations).
