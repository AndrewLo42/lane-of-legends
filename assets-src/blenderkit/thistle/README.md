# Thistle: a custom toad, built in Blender

Modelled from scratch (no downloaded asset), in `thistle_work.blend` (kept out of git like the other raw sources).

1. Body: overlapping scaled spheres (body, head, wide snout, eye bulges, folded thighs, front legs, webbed feet
   and toes), voxel-remeshed into one skin, smoothed and decimated (~4k triangles). Faces underneath and on the
   throat are coloured pale (the belly).
2. Details: warts scattered over the back and flanks, big pale eyes with small pupils and tilted lids (inner
   corners raised, so he looks worried), a wide downturned mouth line, and purple thistle spikes on the rump
   and shoulders. The middle of his back is kept clear: a saddle blanket sits there, where Pip stands.
3. A girth strap painted magenta (1, 0, 1): the game swaps magenta for the team colour.
4. No rig: `src/render/views.ts` animates him in code (hops with squash and stretch while moving, breathing
   while still, a lunge when he bites, trembling while he panics) and keeps Pip on the saddle.

Faces -Y, origin at the ground. Exported straight to the game (no `import_meshy.py` step): select ThistleMesh in
`thistle_work.blend` and export glTF binary to `public/assets/meshy/Thistle.glb` (selected only, apply modifiers).
The saddle top is at 87.3% of his height (`RIDE_HEIGHT` in views.ts).
