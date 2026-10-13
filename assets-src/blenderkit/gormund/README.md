# Gormund: BlenderKit minotaur on a Meshy skeleton

Source (free, royalty-free licence, from BlenderKit): "Minotaurs GreatSword-Rigged-LowPoly", Rigify rig.
The greatsword was dropped: Gormund fights bare-handed.

How he was built (in `gormund_work.blend`, kept out of git like the other raw sources), the same way as Sable:
1. The body and armour were joined into one mesh and their Rigify deform weights merged onto the 22 Meshy
   bone names (tail and pelvis into Hips, the sword bone into RightHand).
2. His limbs were posed to Tock's rest directions and the pose applied, then his rig was built from Tock's
   armature (Tock's bone rest orientations, moved to his joints).
3. Clips retargeted per frame from Tock, Arlo and Lisha (world direction per bone, hips scaled by hip
   height, ratio 0.847); see `import.json` for which clip plays each action. Bull Rush (`G_Charge`) is
   hand-made from his run: a short wind-up, then a faster stride with the torso pitched ~45° forward, the
   head down so the horns lead, and the arms swept back.
4. Look: hide recoloured brown with the horns masked to stay bone; loincloth recoloured rust; a brass
   nose ring and iron chain wraps on both forearms added. Decimated to ~16k triangles (ring and chains kept).
5. Both hands curl into fists in `import_meshy.py` (`fists`).

Rebuild the game asset: `Blender -b --python tools/blender/import_meshy.py -- assets-src/blenderkit/gormund/import.json`
