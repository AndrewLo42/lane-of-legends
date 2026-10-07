"""
Turn a Meshy static model (no rig) into a game-ready GLB: downscale its textures and export.

    Blender -b --python tools/blender/import_static.py -- assets-src/meshy/tower/import.json

The JSON config lists:
  src         the Meshy model GLB (assets-src/..., gitignored)
  out         the game GLB (public/assets/meshy/...)
  maxTexture  longest side for every texture, in pixels (Meshy's non-PBR models only have base colour)
"""
import bpy, sys, json, os

argv = sys.argv[sys.argv.index('--') + 1:]
cfg = json.load(open(argv[0]))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=cfg['src'])

cap = cfg.get('maxTexture')
for img in bpy.data.images:
    if cap and max(img.size) > cap:
        print(f'TEXTURE {img.name} {tuple(img.size)} -> {cap}')
        img.scale(cap, cap)

tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH')
os.makedirs(os.path.dirname(cfg['out']), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=cfg['out'], export_format='GLB')
print('EXPORTED', cfg['out'], f'{os.path.getsize(cfg["out"]) / 1e6:.1f} MB', tris, 'tris')
