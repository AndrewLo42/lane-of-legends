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

## Fennick (Meshy, with a Blender bow)
A **fennec-fox tinker-archer**, so he doesn't read as Arlo's twin (his placeholder's green coat, goggles and satchel are Arlo's look). Huge upright fennec ears are his silhouette.
- **Concept prompt** (2 sheets, `npm run meshy -- concept --asset fennick --count 2 --prompt "..." --yes`): *a nimble young fennec-fox-folk tinker-archer, a humanoid fox with very large upright fennec ears, sandy cream fur, a short bushy cream-tipped tail, bright amber eyes, a brass scope-monocle with a small glowing lens over his right eye, a rust-orange padded tinker's vest with brass rivets over a slate-grey shirt with rolled sleeves, a leather tool belt with small pouches and a tiny wrench, a leather bracer on his left forearm, a cylindrical leather quiver on his back holding arrows with pale icy-cyan, ember-orange and sun-yellow fletchings, dark brown trousers tucked into wrapped boots*, then the Style and Sheet blocks with "empty open hands, no weapons, no bow", then Avoid. (The fletchings are his three arrows: frost, fire, spark.)
- **The bow** is not in the concept (Meshy strips held props). Build a mechanical bow in Blender (brass gears and pulleys, wooden limbs) and bake it onto his bow hand with `import_meshy.py`'s props, as for Gerrit's halberd; the nocked arrowhead keeps its glow in the next arrow's colour (`fennickVisuals` in `views.ts`).
- **Clips** (11): Idle 0, Run 14 (as Arlo), Attack Archery Shot 224, Attack2 Archery Shot 2 226, CastQ (Longshot, held) Female Bow Charge 514, CastW (Volley) Archery Shot 3 227, CastE (Snare Shot) Draw and Shoot Left 236, CastR (Overcharge) Archery Aim with Lateral Scan 231, Death 189, Hit Reaction with Bow 150, Select Formal Bow 41. Check which hand each archery clip holds the bow in before baking the bow on.
- **Watch for:** the tail may not rig well (Meshy's biped rig has no tail bones); the ears must survive the A-pose step.
- **Cost:** 2 concept sheets 18, model 30, rig 5, 11 clips 33 = 86 credits (2026-11-06).
- **Done (2026-11-06):** concept B `ba8a80bc` (views 1 and 2), model `model_3a216d58.glb` (12.5k tris), rig `rigged_8f296efa.glb` (rig task 01a1b2b4-2897-73c7-92e4-8ded8f296efa, height 1.8), clips `anims_batch1.glb` (10) and `anims_batch2.glb` (Formal Bow; the API takes at most 10 ids a batch).
- **Bow hand is the LEFT** in every archery clip (left arm extends, right draws to the cheek).
- **Tail:** Meshy weighted it to the legs (it tore in Run). `import.json`'s `reweight` binds the loose pieces behind the legs rigidly to Hips and lifts the tail 28° so the run's back kick clears it. It moves with the hips but doesn't sway.
- **Bow:** `tools/blender/build_fennick_bow.py` builds it (wooden limbs, a dark riser with a leather grip, brass gears, scope and pulley cams, a string and a nocked arrow) in the left hand's bone frame and exports `bow_hand.glb` and `arrowtip_hand.glb`. The left hand is curled into a fist around the grip. The arrowhead is its own object named `arrowtip`, which `fennickVisuals` recolours with the next arrow's element.
- **Clip trims:** attacks start just before the release (Archery Shot 3.7–4.9 s, release at about 4.0; Archery Shot 3 0.15–0.67 s). Casts centre their release (Longshot: Archery Shot 3.0–5.0 s; Snare Shot: Draw and Shoot Left 1.5–3.5 s, release at about 2.5).

## Lumen (Meshy, with Blender flames and a keyed prayer)
A candle-saint: concept A `c36c7649` (views 1 and 2, `--pose none`), model `model_86d975ce.glb` (12.2k tris), rig `rigged_75ea55b9.glb` (height 1.75), clips `anims_batch1.glb`.
- **Crown flames:** Meshy turned them into pale wax points. `flames_head.glb` is five teardrop flames on the candle tips, built in the Head bone's frame and baked on as a prop on `Head`. `lumenVisuals` (views.ts) flickers their emissive and makes them blaze white-gold while she's Radiant (brightness only: scaling the mesh would slide it off the candles). The placeholder's halo is only used without the model.
- **Select (custom prayer, keyed in Blender, `anims_select.glb` on an NLA track named `Lumen_Select`):** palms together under her chin with her head bowed, then opening out palms-up, back to idle (3.5 s). Lessons:
  - **This rig's hands: palm = +Z, thumb = −X, fingers = +Y** (Fennick's fist code uses ±X palms for the curl; check with a side render before trusting either).
  - Blend the hand's rotation **relative to the forearm**, not in world space, or the wrists spin on their own mid-move.
  - Put most of the hand's roll into the **forearm** (about 85%), leaving a natural wrist bend; her idle palms face forward, so facing them together needs about 175°.
  - Swing the hands out in front on the way up, or they pass through the sash; keep the prayer clear of the bowed chin and braid. Check by testing hand vertices against the torso's front surface each frame.
  - Keep keyed quaternions sign-continuous.
- **Clips:** Idle 4, Run 2, Soell casts 4/6 (attacks), 7 (Candleflame), 5 at 3.5–4.5 s (Sanctuary), Charged Spell Cast (Warm Embrace), Soell cast 8 with both arms to the sky (Sunrise), Shot and Slow Fall Backward, Hit Reaction.
- **Cost:** 2 concept sheets 18, model 30, rig 5, 10 clips 30 = 83 credits (2026-11-16).
