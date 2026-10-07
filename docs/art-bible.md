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
