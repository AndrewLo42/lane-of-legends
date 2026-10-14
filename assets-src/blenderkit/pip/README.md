# Pip: BlenderKit kid on a Meshy skeleton

Source (free, royalty-free licence, from BlenderKit): "Stylized little prince" by Arman Khachatryan
(asset base id 4496411b-77e9-472e-bbca-5e6f161ff6fc), Rigify rig.

How he was built (in `pip_work.blend`, kept out of git like the other raw sources), the same way as Sable and Gormund:
1. Kept the skin, green coat and trousers, buttons, scarf, eyes and eyebrows; dropped the cape (it would hang
   stiff and clip the legs) and the inner mouth. The hands' UVs (a separate "map1") were merged into the body's.
2. Hair: the hair curves (Blender hair, which glTF can't carry) were turned into tubes, voxel-remeshed into one
   solid clump and decimated to ~3.5k triangles, in a flat ginger material.
3. Rigify deform weights merged onto the 22 Meshy bone names; limbs posed to Tock's rest directions and applied;
   rig built from Tock's armature at his joints (hips ratio 0.534).
4. Clips retargeted from Arlo and Tock: Idle, Run, Jab, Uppercut, spell cast (Q), big wave (W, Select), roll (E),
   ground slam (R), hit, death (see `import.json` for trims).
5. Props, weighted to their bones: a leaf sprout on his head, a pot-lid shield on the left forearm, and a slingshot
   in the right hand. The right fist was curled in Blender (skin only, so the slingshot isn't bent); the left fist is
   curled by `import_meshy.py` (`fists`).
6. Decimated to ~14k triangles (eyes, eyebrows and props kept).
7. Eyes: the original shaders (a diffuse iris, and a see-through cornea mixed by a mask) don't survive glTF, so the
   eyes exported closed-looking. The shell's see-through faces (black in the sclera mask) were cut out so the iris
   shows through a real hole, the sclera became a plain textured material, and the iris a solid dark brown.

Thistle is a separate model: see `../thistle/`.

Rebuild the game asset: `Blender -b --python tools/blender/import_meshy.py -- assets-src/blenderkit/pip/import.json`
