"""
Turn Meshy downloads (rigged mesh + animation GLBs) into one game-ready GLB.

    Blender -b --python tools/blender/import_meshy.py -- assets-src/meshy/<name>/import.json [--preview DIR]

The JSON config (see assets-src/meshy/<name>/import.json) lists:
  rigged    the rigged character GLB (mesh + skeleton)
  anims     GLBs whose actions we take clips from (Meshy names, e.g. "Charged_Slash")
  clips     canonical clip name -> {src, start?, end? (seconds), reverse?, mirror?, hold?}
            hold: freeze the pose at that time (static loop, e.g. an in-air pose); hold_root: time
            whose hips location to keep (0 = standing height, so the game's physics owns the jump);
            hold_upper / hold_upper_t: take spine, arms and head from another clip (keep the weapon guard)
            Canonical names are the KayKit-style names the game already uses (Idle, Dodge_Forward,
            2H_Melee_Attack_Slice, ...); src matches a Meshy action name.
  textures  max size per texture role (baseColor / normal / metallicRoughness)
  props     weapon meshes borrowed from another GLB, parented to hand bones, scaled to `length`
            metres; optional per-item `rot` (deg, bone space) and `offset` (m, bone space)
Everything is exported with one animation per canonical clip; non-canonical actions are dropped.
"""
import bpy, sys, json, math, os, re
from mathutils import Matrix, Vector, Euler

argv = sys.argv[sys.argv.index('--') + 1:]
cfg_path = argv[0]
preview = argv[argv.index('--preview') + 1] if '--preview' in argv else None
cfg = json.load(open(cfg_path))

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
FPS = sc.render.fps / sc.render.fps_base


def fcurves(act):
    """All F-curves of a (Blender 4.4+ layered) action."""
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                out.extend(cb.fcurves)
    return out


def assign(arm, act):
    arm.animation_data.action = act
    if act.slots:
        arm.animation_data.action_slot = act.slots[0]


def new_objects(before):
    return [o for o in bpy.data.objects if o.name not in before]


# ---------------- character ----------------
before = {o.name for o in bpy.data.objects}
bpy.ops.import_scene.gltf(filepath=cfg['rigged'])
char_objs = new_objects(before)
arm = next(o for o in char_objs if o.type == 'ARMATURE')
mesh = next(o for o in char_objs if o.type == 'MESH')
if not arm.animation_data:
    arm.animation_data_create()
for a in list(bpy.data.actions):  # the rig's bind-pose clip
    bpy.data.actions.remove(a)

# ---------------- source clips ----------------
for path in cfg['anims']:
    before = {o.name for o in bpy.data.objects}
    bpy.ops.import_scene.gltf(filepath=path)
    for o in new_objects(before):
        bpy.data.objects.remove(o, do_unlink=True)
for a in bpy.data.actions:
    a.use_fake_user = True


def find_src(name):
    for a in bpy.data.actions:
        parts = a.name.split('|')
        if a.name == name or name in parts:
            return a
    raise SystemExit(f'no source action "{name}" in {[a.name for a in bpy.data.actions]}')


def rebuild(fc, pts):
    """Replace an F-curve's keys with (frame, value) pairs, linearly interpolated (Meshy clips are densely sampled)."""
    fc.keyframe_points.clear()
    fc.keyframe_points.add(len(pts))
    for kp, (x, y) in zip(fc.keyframe_points, pts):
        kp.co = (x, y)
        kp.interpolation = 'LINEAR'
    fc.update()


def trim(act, start, end):
    a, b = start * FPS, end * FPS
    for fc in fcurves(act):
        inner = [(k.co.x, k.co.y) for k in fc.keyframe_points if a + 1e-4 < k.co.x < b - 1e-4]
        pts = [(a, fc.evaluate(a)), *inner, (b, fc.evaluate(b))]
        rebuild(fc, [(x - a, y) for x, y in pts])
    act.frame_range = (0, b - a)


def reverse(act):
    f0, f1 = act.frame_range
    for fc in fcurves(act):
        pts = [(f0 + f1 - k.co.x, k.co.y) for k in fc.keyframe_points]
        rebuild(fc, sorted(pts))


UPPER = re.compile(r'^(Spine|neck|Head|head|Left(Shoulder|Arm|ForeArm|Hand)|Right(Shoulder|Arm|ForeArm|Hand))')


def hold(act, t, root_t, root_bone, upper_src=None, upper_t=0):
    """Turn a clip into a static 1s pose: every channel frozen at `t` seconds, except the root bone's
    location, frozen at `root_t` (e.g. standing height) so in-air poses don't add their own jump height
    on top of the game's physics. With `upper_src`, spine/arms/head come from that action at `upper_t`
    (e.g. keep the weapon guard while the legs tuck)."""
    root_path = f'pose.bones["{root_bone}"].location'
    upper_fc = {}
    if upper_src:
        upper_fc = {(fc.data_path, fc.array_index): fc for fc in fcurves(upper_src)}
    for fc in fcurves(act):
        bone = fc.data_path.split('"')[1] if '"' in fc.data_path else ''
        src = upper_fc.get((fc.data_path, fc.array_index)) if UPPER.match(bone) else None
        if src:
            v = src.evaluate(upper_t * FPS)
        else:
            v = fc.evaluate((root_t if fc.data_path == root_path else t) * FPS)
        rebuild(fc, [(0, v), (FPS, v)])
    act.frame_range = (0, FPS)


def flip_name(n):
    return n.replace('Left', '\0').replace('Right', 'Left').replace('\0', 'Right')


def mirror(act, name):
    """Bake a left/right mirrored copy (mirror across the armature's X axis)."""
    assign(arm, act)
    f0, f1 = (int(round(x)) for x in act.frame_range)
    S = Matrix.Scale(-1, 4, Vector((1, 0, 0)))
    frames = {}
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        frames[f] = {pb.name: pb.matrix.copy() for pb in arm.pose.bones}
    out = bpy.data.actions.new(name)
    out.use_fake_user = True
    assign(arm, out)
    order = sorted(arm.pose.bones, key=lambda pb: len(pb.parent_recursive))
    for f, mats in frames.items():
        for pb in order:
            src = mats.get(flip_name(pb.name), mats[pb.name])
            pb.matrix = S @ src @ S
            bpy.context.view_layer.update()
        for pb in order:
            pb.keyframe_insert('location', frame=f)
            pb.keyframe_insert('rotation_quaternion', frame=f)
    return out


canon = []
for cname, spec in cfg['clips'].items():
    src = find_src(spec['src'])
    act = src.copy()
    act.name = cname
    act.use_fake_user = True
    if 'hold' in spec:
        hold(act, spec['hold'], spec.get('hold_root', 0), spec.get('root_bone', 'Hips'),
             find_src(spec['hold_upper']) if spec.get('hold_upper') else None, spec.get('hold_upper_t', 0))
    elif 'start' in spec or 'end' in spec:
        trim(act, spec.get('start', 0), spec.get('end', (src.frame_range[1]) / FPS))
    if spec.get('reverse'):
        reverse(act)
    if spec.get('mirror'):
        m = mirror(act, cname + '_m')
        bpy.data.actions.remove(act)
        m.name = cname
        act = m
    canon.append(act)
    print(f'CLIP {cname:32s} <- {spec["src"]:26s} {(act.frame_range[1] - act.frame_range[0]) / FPS:.2f}s')

keep = {a.name for a in canon}
for a in list(bpy.data.actions):
    if a.name not in keep:
        bpy.data.actions.remove(a)

# ---------------- textures ----------------
for img in bpy.data.images:
    n = img.name.lower()
    role = 'normal' if 'normal' in n else 'metallicRoughness' if 'metal' in n or 'rough' in n else 'baseColor'
    cap = cfg.get('textures', {}).get(role)
    if cap and img.size[0] > cap:
        print(f'TEX {img.name} {tuple(img.size)} -> {cap}')
        img.scale(cap, cap)

# ---------------- props (weapons) ----------------
props = []
arm.animation_data.action = None  # rest pose for placing props
for pb in arm.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()


def hand_frame(name):
    """World transform of a hand bone at rest, without the rig's centimetre scale (metres, bone axes)."""
    t, r, _ = (arm.matrix_world @ arm.data.bones[name].matrix_local).decompose()
    return Matrix.LocRotScale(t, r, None)


# ---------------- fists ----------------
# Meshy rigs have no finger bones and A-pose concepts give open hands, so weapons can't be gripped.
# Bend the finger vertices (past the knuckle line, thumb excluded) along an arc toward the palm, wrapping
# a grip of `radius` metres. Bone space: +Y wrist->fingertips, palm on -X (right) / +X (left), thumb on +Z
# (it points forward in the A-pose). The thumb curls too, which reads as a thumb wrapped over the fingers.
# Records each fist's grip axis centre (bone space) for placing weapons.
fists = {}
for hand, spec in (cfg.get('fists') or {}).items():
    H = hand_frame(hand); Hi = H.inverted()
    Mw, Mwi = mesh.matrix_world, mesh.matrix_world.inverted()
    gi = mesh.vertex_groups[hand].index
    palm = Vector(spec['palm'])  # unit vector toward the palm, bone space
    y0, R, wrap = spec['knuckle'], spec['radius'], math.radians(spec.get('wrap', 230))
    verts = [(v, Hi @ (Mw @ v.co)) for v in mesh.data.vertices
             if next((g.weight for g in v.groups if g.group == gi), 0) > 0.5]
    fingers = [(v, p) for v, p in verts if p.y > y0]
    s_c = sum(p.dot(palm) for _, p in fingers) / len(fingers)  # finger centreline depth along the palm axis
    z_c = sum(p.z for _, p in fingers) / len(fingers)
    axis_s = s_c + R  # grip axis sits R inside the palm from the finger centreline
    for v, p in fingers:
        s = p.dot(palm)  # depth toward the palm (palm is ±X, so this is ±p.x)
        rho = axis_s - s  # distance from the grip axis
        phi = min((p.y - y0) / R, wrap)  # arc length past the knuckle -> wrap angle
        q = palm * (axis_s - rho * math.cos(phi)) + Vector((0, y0 + rho * math.sin(phi), p.z))
        v.co = Mwi @ (H @ q)
    mesh.data.update()
    fists[hand] = palm * axis_s + Vector((0, y0, z_c))
    print(f'FIST {hand}: curled {len(fingers)} verts, grip centre {tuple(round(x, 3) for x in fists[hand])}')

def import_glb(path):
    """Import a GLB, dropping any actions it brings. Returns the new objects."""
    before = {o.name for o in bpy.data.objects}
    acts_before = {a.name for a in bpy.data.actions}
    bpy.ops.import_scene.gltf(filepath=path)
    for a in list(bpy.data.actions):
        if a.name not in acts_before:
            bpy.data.actions.remove(a)
    return new_objects(before)


if cfg.get('props'):
    # Props come from a shared GLB (`props.from`, e.g. KayKit's Knight, looked up by node name) or
    # from their own file (`file`, e.g. a Meshy weapon: its single mesh is used).
    imported = import_glb(cfg['props']['from']) if cfg['props'].get('from') else []
    for pname, spec in cfg['props']['items'].items():
        if spec.get('file'):
            objs = import_glb(spec['file'])
            imported += objs
            src = next(o for o in objs if o.type == 'MESH')
            for img in {n.image for m in src.data.materials if m and m.use_nodes
                        for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image}:
                cap = spec.get('tex', 1024)
                if img.size[0] > cap:
                    img.scale(cap, cap)
        else:
            src = next(o for o in imported if o.name == pname or o.name.startswith(pname + '.'))
        o = src.copy()
        o.data = src.data.copy()
        o.data.transform(src.matrix_world)  # bake any import rotation so local axes = what we measured
        bpy.context.collection.objects.link(o)
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
        # Blade/long axis is the mesh's largest local extent; scale to the target length.
        bb = [Vector(c) for c in o.bound_box]
        ext = Vector((max(v[i] for v in bb) - min(v[i] for v in bb) for i in range(3)))
        k = spec['length'] / max(ext)
        o.data.transform(Matrix.Scale(k, 4))
        # Meshy rigs are in centimetres (armature scale 0.01), so place in world space from the hand
        # bone's rest transform with scale removed, then parent keeping that world transform.
        H = hand_frame(spec['hand'])
        if spec.get('grip') == 'fist':
            # Handle through the fist: blade out of the thumb side (+Z), crossguard along the knuckles (Y).
            # Weapon local axes: Z = blade, X = crossguard. The grip centre is midway between the pommel
            # and the crossguard (the widest slice of the mesh along Z).
            vs = [v.co for v in o.data.vertices]
            zmin, zmax = min(v.z for v in vs), max(v.z for v in vs)
            slices = {}
            for v in vs:
                b = round((v.z - zmin) / (zmax - zmin) * 40)
                slices[b] = max(slices.get(b, 0), abs(v.x))
            guard_z = zmin + max(slices, key=slices.get) / 40 * (zmax - zmin)
            grip_z = (zmin + guard_z) / 2
            # Columns = weapon axes in bone space: X (crossguard) -> +Y knuckles, Y -> -X, Z (blade) -> +Z thumb.
            Rb = Matrix(((0, -1, 0, 0), (1, 0, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)))
            twist = Euler([math.radians(x) for x in spec.get('rot', (0, 0, 0))]).to_matrix().to_4x4()
            o.matrix_world = H @ Matrix.Translation(fists[spec['hand']]) @ Rb @ twist @ Matrix.Translation((0, 0, -grip_z))
            print(f'  grip {pname}: pommel {zmin:.3f} guard {guard_z:.3f} -> grip centre z {grip_z:.3f}')
        elif spec.get('grip') == 'shield':
            # Centre-grip shield: the handle is the small cluster sticking out furthest from the back
            # (along the thin axis, local Y). Handle -> through the fist (Z), face -> past the knuckles (+Y).
            vs = [v.co.copy() for v in o.data.vertices]
            ymin, ymax = min(v.y for v in vs), max(v.y for v in vs)
            def cluster(at_max):
                edge = ymax - 0.15 * (ymax - ymin) if at_max else ymin + 0.15 * (ymax - ymin)
                return [v for v in vs if (v.y >= edge if at_max else v.y <= edge)]
            def elongation(c):
                ex, ez = max(v.x for v in c) - min(v.x for v in c), max(v.z for v in c) - min(v.z for v in c)
                return max(ex, ez) / max(1e-6, min(ex, ez))
            hi, lo = cluster(True), cluster(False)
            for tag, c in (('+y', hi), ('-y', lo)):
                cc = sum(c, Vector()) / len(c)
                print(f'  {pname} {tag} cluster: {len(c)} verts, centre {tuple(round(x, 3) for x in cc)}, '
                      f'x-extent {max(v.x for v in c) - min(v.x for v in c):.3f}, z-extent {max(v.z for v in c) - min(v.z for v in c):.3f}')
            # The handle is a bar (elongated); a front boss is round. "handle_side": "+y" | "-y" overrides.
            side = spec.get('handle_side')
            if side:
                handle, back_sign = (hi, 1) if side == '+y' else (lo, -1)
            else:
                handle, back_sign = (hi, 1) if elongation(hi) > elongation(lo) else (lo, -1)
            hc = sum(handle, Vector()) / len(handle)
            along_x = (max(v.x for v in handle) - min(v.x for v in handle)) >= (max(v.z for v in handle) - min(v.z for v in handle))
            h_axis = Vector((1, 0, 0)) if along_x else Vector((0, 0, 1))
            front = Vector((0, -back_sign, 0))  # face normal, away from the handle
            # Bone-space targets for the weapon's local axes. "face": "back" (default) points the shield out from
            # the back of the hand/forearm, like a strapped shield: blocks then raise it in front of the face.
            # "knuckles" is a true centre grip (face past the knuckles), which reads oddly in our block clip.
            palm = Vector(cfg['fists'][spec['hand']]['palm'])
            face = -palm if spec.get('face', 'back') == 'back' else Vector((0, 1, 0))
            tgt = {'h': Vector((0, 0, 1)), 'front': face}
            src_m = Matrix((h_axis, front, h_axis.cross(front))).transposed()
            dst_m = Matrix((tgt['h'], tgt['front'], tgt['h'].cross(tgt['front']))).transposed()
            Rb = (dst_m @ src_m.inverted()).to_4x4()
            twist = Euler([math.radians(x) for x in spec.get('rot', (0, 0, 0))]).to_matrix().to_4x4()
            # "standoff": extra metres along the face direction so the forearm armour doesn't poke through.
            stand = Matrix.Translation(face * spec.get('standoff', 0.05))
            o.matrix_world = H @ Matrix.Translation(fists[spec['hand']]) @ stand @ twist @ Rb @ Matrix.Translation(-hc)
            print(f'  grip {pname}: handle at {tuple(round(x, 3) for x in hc)} axis {"X" if along_x else "Z"}, back side {"+" if back_sign > 0 else "-"}Y')
        else:
            o.matrix_world = (H
                              @ Matrix.Translation(Vector(spec.get('offset', (0, 0.08, 0))))
                              @ Euler([math.radians(x) for x in spec.get('rot', (0, 0, 0))]).to_matrix().to_4x4())
        world = o.matrix_world.copy()
        o.parent = arm
        o.parent_type = 'BONE'
        o.parent_bone = spec['hand']
        o.matrix_world = world
        props.append((pname, o))
        print(f'PROP {pname} scale {k:.3f} -> {spec["hand"]}')
    for o in imported:
        bpy.data.objects.remove(o, do_unlink=True)
    # Name only after the originals are gone, so the game finds them by exact name (no ".001").
    for pname, o in props:
        o.name = pname
    props = [o for _, o in props]

# ---------------- preview ----------------
if preview:
    os.makedirs(preview, exist_ok=True)
    sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 360, 420
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.35, 0.37, 0.4, 1)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
    sun.data.energy = 3; sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 3.2
    a = math.radians(35)
    cam.location = Vector((math.sin(a) * 8, -math.cos(a) * 8, 1.2))
    cam.rotation_euler = (Vector((0, 0, 0.95)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    for pname in [p.name for p in props]:
        for p in props:
            p.hide_render = p.name != pname
        hand_name = next(s['hand'] for n, s in cfg['props']['items'].items() if n == pname)
        for clip, t in [('Idle', 0.3), ('2H_Melee_Attack_Slice', 0.5), ('Block', 0.5)]:
            act = bpy.data.actions[clip]
            assign(arm, act)
            sc.frame_set(int(act.frame_range[0] + (act.frame_range[1] - act.frame_range[0]) * t))
            # Close-up of the gripping hand from two sides, then the full body.
            hb = arm.pose.bones[hand_name]
            hm = arm.matrix_world @ hb.matrix
            hc = hm @ Vector((0, 10.5, 0))  # knuckle area (bone space is in centimetres)
            cam.data.ortho_scale = 0.6
            for vi, d in enumerate([Vector((0, 0, -1)), Vector((-1, 0, 0))]):
                dw = (hm.to_3x3() @ d).normalized()
                cam.location = hc + dw * 3
                cam.rotation_euler = (hc - cam.location).to_track_quat('-Z', 'Y').to_euler()
                sc.render.filepath = os.path.join(preview, f'{pname}_{clip}_hand{vi}.png')
                bpy.ops.render.render(write_still=True)
            cam.data.ortho_scale = 3.2
            cam.location = Vector((math.sin(a) * 8, -math.cos(a) * 8, 1.2))
            cam.rotation_euler = (Vector((0, 0, 0.95)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = os.path.join(preview, f'{pname}_{clip}.png')
            bpy.ops.render.render(write_still=True)
    for p in props:
        p.hide_render = False

# ---------------- export ----------------
arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
os.makedirs(os.path.dirname(cfg['out']), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(
    filepath=cfg['out'], export_format='GLB', export_animation_mode='ACTIONS',
    export_image_format='WEBP', export_optimize_animation_size=True,
)
print('EXPORTED', cfg['out'], f'{os.path.getsize(cfg["out"]) / 1e6:.1f} MB', len(canon), 'clips')
