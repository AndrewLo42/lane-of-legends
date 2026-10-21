# Sir Gerrit: BlenderKit knight on a Meshy skeleton

Source (free, CC0, from BlenderKit): "The Armored Adventurer" by AnonmalyFound
(asset base id 4d71b492-be49-4748-b159-6ec337aefa50), with its own custom rig (65 bones, IK on the limbs).
The halberd is hand-made in Blender (130 triangles: a wooden shaft, a spear point, an axe blade, a back spike, a
brass collar and a steel butt cap).

How he was built (in `gerrit_work.blend`, kept out of git like the other raw sources), the same way as Sable, Gormund and Pip:
1. Dropped the round shield, the sword and scabbard, the long cape and the cloth hanging from the helm (they'd hang
   stiff and clip the legs); kept the plate, the blue tabard, the belts and the pouch at the back (the two front pouches were removed later). A small separate chest piece was
   joined into the body.
2. The source rig's constraints (IK on arms, legs and hips, copy-rotation on the fingers) were muted; arms and legs
   were posed to Tock's rest directions (the feet kept flat) and the pose applied to the mesh. Note the source names
   its left limbs "R" (they sit on +x, the character's left).
3. Weights merged onto the 22 Meshy bone names (fingers into the hands; the hip plates split 50/50 between the hips
   and the thigh so they follow the legs); his rig built from Tock's armature (Tock's bone rest orientations, moved
   to his joints).
4. Clips retargeted per frame (each bone copies the source bone's world rotation relative to its rest, aligned to the
   target's rest direction; hips travel scaled by hip height), then adjusted for the halberd, whose shaft runs through
   his right fist (head on the thumb side):
   - Idle (`GR_IdleKnight`): hand-made, a knight at ease: square to the front, feet flat and a little apart, legs
     nearly straight, a slow 4s breath through the spine with a slight sway and a drift of the helm; the right forearm
     forward and level with the thumb up, so the halberd stands upright and planted; the left arm relaxed. (Retargeted
     idles didn't fit: Arlo's turns the hips through ~90° as he looks around, Tock's is a crouch.)
   - Run (`GR_RunKnight`): Tock's run with the right arm carrying the halberd upright the same way (the left arm swings).
   - Attacks, Bulwark (W), Fallen Standards (R), hit and death: Tock's attacks, ground slam, hit and death.
   - Two hands on the halberd (both attacks, the thrust and the slam): per frame, the halberd keeps the angle the
     one-handed clip gives it but is pulled in toward the shoulders until both hands can reach it, and both arms are
     solved onto the shaft (the left fist 45 cm from the right, toward the butt, or toward the head in the thrust; the
     elbows bend the way the clip had them). The one-handed versions are kept in the work file as `*_onehand`.
   - Halberd Thrust (Q, `GR_ThrustHalberd`): Lisha's thrust, with the right hand turned during the lunge (measured
     per frame) so the head points along the forearm: the polearm drives forward at the target, then eases back.
   - Plant the Standard (E): Lisha's crouch-and-throw.
   - Select (`GR_Salute`, from the same stance): standing at attention (straight legs, feet flat, hips and shoulders
     squared, the hips lifted so the soles stay on the ground), the halberd planted upright, the left fist to the
     chest and a nod of the helm, then back to the idle.
   - Grounding: the game stands a model on the ground by its body in the rest pose, and Gerrit's rest pose has
     the feet 8.6 cm up, so every clip's hips were raised afterwards (by 4–11 cm, measured per clip) until its
     lowest point meets the rest pose's. Re-run that if a clip is remade.
   - Broader shoulders: the arms (mesh and bones) were moved 3.5 cm out on each side, with the pauldrons and the
     edges of the upper chest plate blended out to match (the bones only moved, not turned, so the clips still fit).
5. Materials: the source's procedural "old paint" shaders don't survive glTF, so they're flat colours chosen to match
   (brushed steel, brown leather, a navy tabard, dark gloves). Decimated to ~15k triangles.
6. Hands: the gauntlets' palms face +X (right) and -X (left) in the hand bone frame, and the fingers start about 10 cm
   from the wrist (the thumb along -Z), so the `fists` are set to that. The poses point the right palm inward with the
   thumb up when holding, and the left palm toward the thigh at rest (both hands grip the shaft: radius = shaft radius + finger thickness). The fingers were drawn a little closer together in the work file so a
   closed hand doesn't look splayed. The halberd (`halberd_hand.glb`, exported with the grip at the origin and the butt
   1 m below it, so it reaches the ground when planted; shaft slimmed to 3.6 cm across so the gauntlet can close
   round it) is baked on at the right fist, turned (`rot` +90° about X) so the shaft runs through the fist with the
   head on the thumb side (the mesh spun about the shaft so the axe blade faces forward), and nudged
   (`offset`) onto the centre of the curled fingers (fitted so they wrap the shaft without cutting into it).

Rebuild the game asset: `Blender -b --python tools/blender/import_meshy.py -- assets-src/blenderkit/gerrit/import.json`
