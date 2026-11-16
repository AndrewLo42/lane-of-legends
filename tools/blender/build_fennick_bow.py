"""
Fennick's mechanical bow, built in his left hand's bone frame (metres) with the grip centre at the origin,
for `import_meshy.py` props with "at": "fist". Run inside Blender (it works in its own scene):

    exec(open('tools/blender/build_fennick_bow.py').read())

Bone frame: +Y wrist -> fingertips (toward the target when he aims), +Z thumb (up when he aims), so the
limbs run along Z through the fist and the string sits behind the hand (-Y). The whole bow is turned
BOW_YAW about Z so the string clears his forearm on the side his drawing hand comes from.
Exports two GLBs: the bow (one mesh, several materials) and the nocked arrowhead `arrowtip`, kept
separate because the game recolours its material with the next arrow's element (views.ts).
"""
import bpy, bmesh, math, os
from mathutils import Matrix, Vector

OUT = 'assets-src/meshy/fennick'
ROOT = '/Users/crevice/Projects/lane-rogue'
BOW_YAW = math.radians(20)
TIP_Z, TIP_Y = 0.50, -0.10  # limb tip (pulley centre)
PULLEY_R = 0.032
STRING_Y = TIP_Y - PULLEY_R

scn = bpy.data.scenes.get('FennickBow') or bpy.data.scenes.new('FennickBow')
bpy.context.window.scene = scn
for o in list(scn.collection.all_objects):
    bpy.data.objects.remove(o, do_unlink=True)


def mat(name, rgb, metal=0.0, rough=0.7, emit=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = 2.0
    return m


WOOD = mat('fb_wood', (0.42, 0.24, 0.12), rough=0.6)
DARK = mat('fb_darkwood', (0.22, 0.12, 0.07), rough=0.65)
BRASS = mat('fb_brass', (0.86, 0.62, 0.26), metal=0.85, rough=0.35)
LEATHER = mat('fb_leather', (0.30, 0.17, 0.09), rough=0.8)
STRING = mat('fb_string', (0.92, 0.88, 0.78), rough=0.6)
STEEL = mat('fb_steel', (0.62, 0.64, 0.68), metal=0.8, rough=0.4)
TIP = mat('arrowtip', (0.56, 0.85, 1.0), metal=0.3, rough=0.3, emit=(0.56, 0.85, 1.0))
parts = []


def add(obj, m):
    obj.data.materials.clear()
    obj.data.materials.append(m)
    parts.append(obj)
    return obj


def box(size, at, m, rot=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    o = bpy.context.object
    o.scale = size
    if rot:
        o.rotation_euler = rot
    return add(o, m)


def cyl(r, depth, at, m, axis='Z', verts=16):
    rot = {'Z': (0, 0, 0), 'X': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=at, rotation=rot, vertices=verts)
    return add(bpy.context.object, m)


def gear(r, depth, at, teeth, m):
    """A brass cog, axle along X (it faces out of the bow's side)."""
    g = cyl(r * 0.82, depth, at, m, 'X', verts=teeth * 2)
    for i in range(teeth):
        a = 2 * math.pi * i / teeth
        box((depth, r * 0.32, r * 0.3), (at[0], at[1] + math.cos(a) * r * 0.9, at[2] + math.sin(a) * r * 0.9), m, rot=(a, 0, 0))
    cyl(r * 0.28, depth * 1.6, at, STEEL, 'X', verts=10)  # hub
    return g


def limb(sign):
    """A flat wooden limb from the riser to the tip, curving back toward the string, as a beveled curve."""
    cu = bpy.data.curves.new('limb', 'CURVE')
    cu.dimensions = '3D'
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(1)
    p0, p1 = sp.bezier_points
    p0.co = (0, 0.012, sign * 0.15)
    p0.handle_left = (0, 0.02, sign * 0.10)
    p0.handle_right = (0, 0.005, sign * 0.26)
    p1.co = (0, TIP_Y, sign * TIP_Z)
    p1.handle_left = (0, TIP_Y + 0.07, sign * (TIP_Z - 0.12))
    p1.handle_right = (0, TIP_Y - 0.02, sign * (TIP_Z + 0.03))
    cu.bevel_depth = 0.014
    cu.bevel_resolution = 2
    cu.resolution_u = 10
    # Taper toward the tip.
    p0.radius, p1.radius = 1.25, 0.8
    o = bpy.data.objects.new('limb', cu)
    scn.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o = bpy.context.object
    o.data.transform(Matrix.Diagonal((2.2, 1, 1, 1)))  # wider across (X) than thick
    add(o, WOOD)
    # Brass bands along the limb.
    for t, z in ((0.35, 0.25), (0.7, 0.38)):
        y = 0.012 + (TIP_Y - 0.012) * (t ** 1.6)
        cyl(0.019, 0.018, (0, y, sign * z), BRASS, 'Z', verts=12).scale = (1.5, 1, 1)


# Riser: dark wood with a leather grip through the fist (radius ~ the fist's 3 cm) and brass caps.
box((0.032, 0.045, 0.30), (0, 0.008, 0), DARK)
cyl(0.026, 0.11, (0, 0, 0), LEATHER, 'Z', verts=14).scale = (1, 1.15, 1)
for s in (1, -1):
    cyl(0.03, 0.025, (0, 0.01, s * 0.15), BRASS, 'Z', verts=14).scale = (1.2, 1.2, 1)
    limb(s)
    # Pulley cam at the tip, axle across the bow (X), with brass side plates.
    cyl(PULLEY_R, 0.016, (0, TIP_Y, s * TIP_Z), BRASS, 'X', verts=20)
    cyl(PULLEY_R * 0.45, 0.03, (0, TIP_Y, s * TIP_Z), STEEL, 'X', verts=10)
# Gears on the riser above the grip (the tinker's touch), both faces.
for side in (1, -1):
    gear(0.04, 0.012, (side * 0.022, 0.03, 0.10), 10, BRASS)
    gear(0.026, 0.012, (side * 0.022, -0.012, 0.155), 8, BRASS)
# Little scope on top of the riser: a brass tube with a lens toward the target.
cyl(0.012, 0.09, (0.03, 0.03, 0.16), BRASS, 'Y', verts=12)
# Arrow rest: a steel shelf on the +X side just above the fist.
box((0.02, 0.03, 0.008), (0.022, 0.012, 0.055), STEEL)
# The string: straight from cam to cam behind the hand.
cyl(0.0035, 2 * TIP_Z, (0, STRING_Y, 0), STRING, 'Z', verts=6)
# Nocked arrow: shaft from the string, past the rest, toward the target (+Y); fletching at the nock.
ARROW_Z, ARROW_X = 0.065, 0.022
shaft_len = 0.36
cyl(0.0045, shaft_len, (ARROW_X, STRING_Y + shaft_len / 2, ARROW_Z), WOOD, 'Y', verts=6)
for i, rgb in enumerate(((0.56, 0.85, 1.0), (1.0, 0.54, 0.24), (1.0, 0.88, 0.29))):
    a = 2 * math.pi * i / 3
    f = box((0.002, 0.05, 0.016), (ARROW_X + math.sin(a) * 0.009, STRING_Y + 0.04, ARROW_Z + math.cos(a) * 0.009),
            mat(f'fb_fletch{i}', rgb, rough=0.8), rot=(0, a, 0))

# Turn the bow so the string clears his forearm, then join.
bpy.ops.object.select_all(action='DESELECT')
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
bow = bpy.context.object
bow.name = 'Bow'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bow.data.transform(Matrix.Rotation(BOW_YAW, 4, 'Z'))

# The arrowhead: a four-sided point at the shaft's tip, its own object and material.
bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.016, radius2=0, depth=0.05,
                                location=(ARROW_X, STRING_Y + shaft_len + 0.022, ARROW_Z), rotation=(-math.pi / 2, 0, 0))
tip = bpy.context.object
tip.name = 'arrowtip'
tip.data.materials.append(TIP)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
tip.data.transform(Matrix.Rotation(BOW_YAW, 4, 'Z'))


def export(obj, name):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    path = os.path.join(ROOT, OUT, name)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, use_active_scene=True)
    bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    ext = [max(v[i] for v in bb) - min(v[i] for v in bb) for i in range(3)]
    return {'file': path, 'extent': [round(e, 4) for e in ext], 'length': round(max(ext), 4)}


result = {'bow': export(bow, 'bow_hand.glb'), 'tip': export(tip, 'arrowtip_hand.glb'),
          'tris': sum(len(p.vertices) - 2 for p in bow.data.polygons)}
