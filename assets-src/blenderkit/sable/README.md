# Sable: BlenderKit body on a Meshy skeleton

Sources (both free, royalty-free licence, from BlenderKit):
- Body: "Stylized Female Character" (asset base id 220840fe-bb47-4617-b0b7-48372acb5661), Rigify rig.
- Weapon: "Low Poly Scythe" (asset base id bb9ea439-e3fa-4c04-bbb8-b5f7c5b0da32), recoloured.

How she was built (in `sable_work.blend`, kept out of git like the other raw sources):
1. Her Rigify deform weights were merged onto the 22 Meshy bone names (face bones into Head, fingers
   into Hand); the inner mouth (jaws, tongue) was dropped and the rest joined into one mesh.
2. Her arms and legs were posed to Tock's rest directions and the pose applied to the mesh, then her
   final rig was built from Tock's armature: Tock's exact bone rest orientations, moved to her joints.
   So Tock's clips play on her directly.
3. Clips from other champions' batches were retargeted per frame: each bone copies the source bone's
   world direction with the target's own roll, and the hips' travel is scaled by hip height. Idle comes
   from Lisha, the rest from Tock (see `import.json`); no Select flourish, so she idles on the podium.
4. Decimated to ~15k triangles; the scythe is exported in the right hand's bone frame
   (`scythe_hand.glb`, its shaft slimmed to 62% about the centreline and
   lengthened to 2.37 m (35% grip-to-blade, 20% grip-to-butt; blade and lantern kept rigid), grip at the origin) and baked on by
   `import_meshy.py` as a prop at the curled right fist (`fists` + `"at": "fist"`).

Rebuild the game asset: `Blender -b --python tools/blender/import_meshy.py -- assets-src/blenderkit/sable/import.json`
