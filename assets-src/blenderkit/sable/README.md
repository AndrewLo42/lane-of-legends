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
   from Lisha, the rest from Tock (see `import.json`); plus a hand-built Select (see 11).
4. Decimated to ~15k triangles; the scythe is exported in the right hand's bone frame
   (`scythe_hand.glb`, its shaft slimmed to 62% about the centreline and
   lengthened to 2.37 m (35% grip-to-blade, 20% grip-to-butt; blade and lantern kept rigid), grip at the origin) and baked on by
   `import_meshy.py` as a prop at the curled right fist (`fists` + `"at": "fist"`).
5. Harvester pass: a dusty plum field cloak hangs from under the feather mantle past her knees, open at the
   front, with a ragged hem; it was built around her rest-pose body (kept 2 cm off it) and weighted up the spine,
   and below the waist it splits at the back into two halves that blend from the hips onto each thigh, so it
   swings with her legs instead of stretching. The feathers that stuck out sideways past her shoulders were
   shortened and drooped. Her clothes were recoloured from the black textures, keeping their detail: a linen
   shirt (`sweater_harvest`), earth-brown trousers (`pants_harvest`) and brown leather shoes (`shoe_harvest`).
   The mesh before all this is kept in the work file as `SableMesh_before_cloak`.
6. Eyes: the iris texture (a photographic iris whose transparency came from a second image, which glTF can't
   carry) rendered as see-through holes, so the original eyeballs were rejoined undecimated and the iris given a
   painted, opaque texture (`sable_iris`: amber, a dark limbal ring, a big pupil and two catchlights) on planar
   UVs facing forward; the whites were warmed. The mesh before this is kept as `SableMesh_before_eyes`.
7. Painted shading: her skin texture was flat pink, so ambient occlusion and object-space normals were baked
   (Cycles, rest pose; the hair on its own `UVMap`) and painted into new 1024 textures: `base_painted` (a soft
   light from above and in front with a band at the terminator, softly warm shadows and occlusion, a faint
   highlight on top; half strength on the hands and forearms, masked from their UV islands, since palms and
   curled fingers face away from the light and went red at full strength) and `hair_painted` (stronger light and dark, deeper occlusion, a warm sheen band
   round the crown). The bakes are kept in the work file as `bk_*`.
8. Boots and belt: the cropped trousers and city shoes became olive trousers (`pants_harvest`, retinted) tucked
   into leather boots: shafts built from her shins (rings measured off the leg, eased toward round, no narrower
   going up) from inside the shoe to below the knee with a folded cuff, the colour of the shoes, weighted to the
   shin (and the foot at the bottom); the trouser hems were drawn in so they stay inside. The flat gold band was
   replaced by a brown leather belt right round her waist (over the shirt hem, following the hips and lower spine) with a small brass buckle. The mesh before this is kept
   as `SableMesh_before_boots`.
9. Two hands on the scythe (a left `fists` grip mirrors the right): both attacks, W (`S_Reap`) and R (`S_Slam`)
   keep the angle the one-handed clip gives the scythe, pulled in toward the shoulders until both hands reach, and
   both arms are solved onto the shaft with the hands 42 cm apart (the left toward the butt, or toward the blade
   in the reap). The run carries it across the chest, fixed to the upper body: right hand low at the front, left
   hand 45 cm up the shaft, the blade up behind the left shoulder. Q (the hook throw) and E (the roll) stay
   one-handed. The one-handed clips are kept in the work file as `*_onehand`.
10. Feather mantle: the 66 flat black cards were replaced, card for card in the same layout and with the same
    weights, by three modelled feathers each (198 in all: a main one and two smaller ones fanned out beside it):
    tapered with a raised quill ridge and the tips curling in, all hanging at least ~35 degrees below level, with
    a painted texture (`crow_feather`: black-blue, a pale quill, fine barbs, a blue-violet oil sheen, lighter
    edges). The mesh before this is kept as `SableMesh_before_feathers`.
11. Select (`S_Select`, 3.5 s): a hand-built two-handed swipe off to her right side (the path is turned ~23°
    that way and her chest turns with it). From the idle she raises the
    scythe before her (blade up over her right side), draws it back a little with a turn of the chest, cuts down
    across her front to her left, follows through, returns to the ready pose for a beat and eases back to the
    idle. The scythe's path is set relative to her shoulders (her idle stands back from the origin) and both arms
    are solved onto it every frame (the left fist 30 cm up the shaft, elbows down and out); the right hand stays on
    her right side at the end so the arm doesn't cross the chest. Checked for clipping: at most ~16 arm vertices
    inside the torso on any frame (her idle has 3), against 200+ when the slash was borrowed from Attack2. This
    replaced the select screen's scythe twirl.
12. The left grip: the left fist mirrors the right (`palm` +X, grip centre (0.031, 0.1, 0); -X curls the fingers
    backwards), and the scythe's snath is curved (its centreline bows ~10 cm off the grip axis by 30 cm up),
    so the left hand goes on the measured centreline and lines up with it there. The two-handed clips were
    rebuilt as fresh actions from the `*_onehand` ones (keying into the copies didn't stick) and checked by
    reading them back: the left fist is within a few mm of the shaft on average (exactly on it in the run and the
    swipe).

Rebuild the game asset: `Blender -b --python tools/blender/import_meshy.py -- assets-src/blenderkit/sable/import.json`
