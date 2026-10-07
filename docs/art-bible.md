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

### Pipeline lessons
- **The A-pose step (`pose_mode: a-pose`) strips held props and thin cloth.** The first melee model lost its tabard and sword, and the caster lost its staff. Use `--pose none` when the concept is already close to an A-pose, add a `--texture` prompt naming the key-coloured cloth, or rebuild the prop at runtime (the caster's staff is a three.js mesh on the `RightHand` bone).
- **Check the concept views before modelling.** Drop any view that contradicts the others: a second front view in a different pose, or a back view with the prop in the mirrored hand.
- **Arms held close to the body rig badly.** The melee knight's sword arm and tabard deform in big swings. That's fine at gameplay distance, but for champions use a true A-pose concept.
- **Library clips are made for empty hands.** A prop locked to the wrist flops around, so held props follow the hand's *position* but stay upright (`PROPS` in `src/render/assets.ts`). For an "arms in front" look, use carry clips: the caster idles with **Torch Look Around** (337) and walks with **Spear Walk** (560), both of which hold their object in the **left** hand, so its staff sits there.
- **Check every asset in the model viewer** (`/viewer.html` in dev). It shows each clip, slow motion and the team tint up close, which the game camera is too far away to show.
- **Blender imports at 24 fps.** Clip `start`/`end` in `import.json` are in 24 fps seconds, so measure trims in that time base.
- **Costs (Oct 2026):** a concept sheet 9, image→3D 30, rig 5, animations about 3 each. Two minions cost about 190 credits, including one wasted concept pair, one model regeneration and the two caster carry clips.
