/**
 * Meshy API client for the asset pipeline. No dependencies; runs on Node 22 with type stripping:
 *   npm run meshy -- <command> [flags]
 *
 * The API key is read from MESHY_API_KEY (environment or the gitignored .env.local).
 * Anything that spends credits is a dry run unless --yes is passed, so every spend is explicit.
 * Each task's request, id, cost and downloaded files are appended to
 * assets-src/meshy/<asset>/manifest.json so results are reproducible and spend is traceable.
 *
 * Commands:
 *   balance                                   credit balance (free)
 *   library [--search run] [--category Fighting]   animation library (free)
 *   concept --asset <name> --prompt "..." [--count 3] [--model nano-banana-pro] [--single [--aspect 9:16]] [--pose none]
 *   model   --asset <name> --images a.png,b.png [--polycount 15000] [--type standard|smart-topology] [--texture "..."] [--pose none]
 *   remesh  --asset <name> --task <model task id> [--polycount 15000] [--height 1.85]
 *   rig     --asset <name> (--task <image-to-3d task id> | --glb <url>) [--height 1.85]
 *   animate --asset <name> --rig <rig task id> --actions 12,40,77 [--name batch1]
 *   task    --kind rigging --id <task id>      re-fetch a task (free)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const BASE = 'https://api.meshy.ai/openapi';
const ROOT = new URL('../../', import.meta.url).pathname;
const SRC = join(ROOT, 'assets-src/meshy');

// ---------- args / env ----------
const [cmd = 'help', ...rest] = process.argv.slice(2);
const flags: Record<string, string> = {};
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith('--')) continue;
  const k = rest[i].slice(2);
  const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : 'true';
  flags[k] = v;
}
const yes = flags.yes === 'true';

if (existsSync(join(ROOT, '.env.local'))) process.loadEnvFile(join(ROOT, '.env.local'));
function key() {
  const k = process.env.MESHY_API_KEY;
  if (!k) fail('MESHY_API_KEY is not set. Add it to .env.local (gitignored): MESHY_API_KEY=msy_...');
  return k!;
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
const need = (name: string) => flags[name] ?? fail(`--${name} is required`);

// ---------- HTTP ----------
async function api(method: 'GET' | 'POST', path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) fail(`${method} ${path} → ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

type Task = {
  id: string; status: string; progress?: number; consumed_credits?: number | null;
  task_error?: { message?: string } | null;
  [k: string]: unknown;
};

async function waitFor(kindPath: string, id: string): Promise<Task> {
  let last = '';
  for (;;) {
    const t: Task = await api('GET', `${kindPath}/${id}`);
    const line = `${t.status} ${t.progress ?? 0}%`;
    if (line !== last) { process.stdout.write(`  ${kindPath.split('/').pop()} ${id.slice(-8)}… ${line}\n`); last = line; }
    if (t.status === 'SUCCEEDED') return t;
    if (t.status === 'FAILED' || t.status === 'CANCELED') fail(`task ${id} ${t.status}: ${t.task_error?.message ?? ''}`);
    await new Promise((r) => setTimeout(r, 4000));
  }
}

async function download(url: string, file: string) {
  const res = await fetch(url);
  if (!res.ok) fail(`download ${url} → ${res.status}`);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`  ↓ ${file.replace(ROOT, '')}`);
  return file.replace(ROOT, '');
}

// ---------- manifest ----------
function assetDir() {
  const a = need('asset');
  if (!/^[a-z0-9_-]+$/.test(a)) fail('--asset must be lowercase letters, digits, - or _');
  const dir = join(SRC, a);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function record(dir: string, entry: Record<string, unknown>) {
  const file = join(dir, 'manifest.json');
  const list = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  list.push({ at: new Date().toISOString(), ...entry });
  writeFileSync(file, JSON.stringify(list, null, 2) + '\n');
}

/** Local image → data URI (the image endpoints accept them directly). */
function dataUri(path: string) {
  const ext = extname(path).slice(1).toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}

/** Print what would be spent and stop, unless --yes. */
function confirmSpend(what: string, body: unknown) {
  const shown = JSON.stringify(body, (k, v) => (typeof v === 'string' && v.startsWith('data:') ? `<${v.length} byte data URI>` : v), 2);
  console.log(`\n${what}\n${shown}\n`);
  if (!yes) {
    console.log('Dry run — nothing sent, no credits spent. Re-run with --yes to submit.');
    process.exit(0);
  }
}

// ---------- commands ----------
const commands: Record<string, () => Promise<void>> = {
  async balance() {
    const b = await api('GET', '/v1/balance');
    console.log(`Credits available: ${b.balance}`);
  },

  async library() {
    const q = new URLSearchParams();
    if (flags.search) q.set('search', flags.search);
    if (flags.category) q.set('category', flags.category);
    const items: { action_id: number; name: string; key: string; category: string; sub_category: string; preview_url: string }[] =
      await api('GET', `/v1/animations/library${q.size ? `?${q}` : ''}`);
    for (const a of items) console.log(`${String(a.action_id).padStart(5)}  ${a.name.padEnd(32)} ${a.category}/${a.sub_category}  ${a.preview_url}`);
    console.log(`${items.length} animations`);
    if (flags.json) writeFileSync(flags.json, JSON.stringify(items, null, 2));
  },

  /**
   * Concept art: text-to-image, one task per variation. Characters: A-pose 4-view sheet (default).
   * Props: --pose none, plus --single [--aspect 9:16] for one view or a multi-view sheet without --single.
   */
  async concept() {
    const dir = assetDir();
    const prompt = need('prompt');
    const count = Number(flags.count ?? 1);
    const body = {
      ai_model: flags.model ?? 'nano-banana-pro',
      prompt,
      ...(flags.pose === 'none' ? {} : { pose_mode: flags.pose ?? 'a-pose' }),
      ...(flags.single ? { aspect_ratio: flags.aspect ?? '3:4' } : { generate_multi_view: true }),
    };
    confirmSpend(`Create ${count} text-to-image task(s):`, body);
    const ids: string[] = [];
    for (let i = 0; i < count; i++) ids.push((await api('POST', '/v1/text-to-image', body)).result);
    for (const [i, id] of ids.entries()) {
      const t = await waitFor('/v1/text-to-image', id);
      const urls = (t.image_urls as string[]) ?? [];
      const files: string[] = [];
      for (const [j, u] of urls.entries()) files.push(await download(u, join(dir, 'concepts', `${id.slice(-8)}_${j}.png`)));
      record(dir, { cmd: 'concept', taskId: id, variation: i + 1, request: body, credits: t.consumed_credits, files });
    }
  },

  /** 3D model from 1–4 images of the same subject (front/side/back views). */
  async model() {
    const dir = assetDir();
    const images = need('images').split(',');
    for (const p of images) if (!existsSync(p)) fail(`no such image: ${p}`);
    const body = {
      image_urls: images.map(dataUri),
      model_type: flags.type ?? 'standard', // 'lowpoly' is retired by Meshy on 2026-10-30
      // Without should_remesh the polycount target is ignored (we got 1.7M triangles once).
      should_remesh: true,
      target_polycount: Number(flags.polycount ?? 15000),
      ...(flags.pose === 'none' ? {} : { pose_mode: flags.pose ?? 'a-pose' }),
      should_texture: true,
      enable_pbr: flags.pbr === 'true',
      texture_resolution: flags.tex ?? '2k',
      origin_at: 'bottom',
      ...(flags.texture ? { texture_prompt: flags.texture } : {}),
    };
    confirmSpend('Create a multi-image-to-3D task:', body);
    const id = (await api('POST', '/v1/multi-image-to-3d', body)).result;
    const t = await waitFor('/v1/multi-image-to-3d', id);
    const glb = (t.model_urls as Record<string, string>)?.glb;
    const files = glb ? [await download(glb, join(dir, `model_${id.slice(-8)}.glb`))] : [];
    record(dir, { cmd: 'model', taskId: id, request: { ...body, image_urls: images.map((p) => basename(p)) }, credits: t.consumed_credits, files });
  },

  /** Reduce an existing model's polycount (keeps its textures) — 5 credits. */
  async remesh() {
    const dir = assetDir();
    const body = {
      input_task_id: need('task'),
      topology: flags.topology ?? 'triangle',
      target_polycount: Number(flags.polycount ?? 15000),
      resize_height: Number(flags.height ?? 1.85),
      origin_at: 'bottom',
    };
    confirmSpend('Create a remesh task:', body);
    const id = (await api('POST', '/v1/remesh', body)).result;
    const t = await waitFor('/v1/remesh', id);
    const glb = (t.model_urls as Record<string, string>)?.glb;
    const files = glb ? [await download(glb, join(dir, `remesh_${id.slice(-8)}.glb`))] : [];
    record(dir, { cmd: 'remesh', taskId: id, request: body, credits: t.consumed_credits, files });
    console.log(`Remesh task id (for rig --task): ${id}`);
  },

  async rig() {
    const dir = assetDir();
    const body = {
      ...(flags.task ? { input_task_id: flags.task } : { model_url: need('glb') }),
      animation_type: 'biped',
      height_meters: Number(flags.height ?? 1.85),
    };
    confirmSpend('Create a rigging task:', body);
    const id = (await api('POST', '/v1/rigging', body)).result;
    const t = await waitFor('/v1/rigging', id);
    const r = t.result as { rigged_character_glb_url?: string };
    const files = r?.rigged_character_glb_url ? [await download(r.rigged_character_glb_url, join(dir, `rigged_${id.slice(-8)}.glb`))] : [];
    record(dir, { cmd: 'rig', taskId: id, request: body, credits: t.consumed_credits, files });
    console.log(`Rig task id (for animate --rig): ${id}`);
  },

  /** Apply up to 10 library animations in one task; returns one GLB with a clip per action. */
  async animate() {
    const dir = assetDir();
    const actions = need('actions').split(',').map(Number);
    if (actions.length > 10 || actions.some((n) => !Number.isInteger(n))) fail('--actions: 1–10 comma-separated integer ids');
    const body = { rig_task_id: need('rig'), action_ids: actions, post_process: { operation_type: 'change_fps', fps: 30 } };
    confirmSpend(`Create an animation task (${actions.length} actions ≈ ${actions.length * 3} credits):`, body);
    const id = (await api('POST', '/v1/animations', body)).result;
    const t = await waitFor('/v1/animations', id);
    const r = t.result as { animation_glb_url?: string };
    const name = flags.name ?? id.slice(-8);
    const files = r?.animation_glb_url ? [await download(r.animation_glb_url, join(dir, `anims_${name}.glb`))] : [];
    record(dir, { cmd: 'animate', taskId: id, request: body, credits: t.consumed_credits, files });
  },

  async task() {
    const kinds: Record<string, string> = {
      remesh: '/v1/remesh', image: '/v1/text-to-image', model: '/v1/multi-image-to-3d', 'image-to-3d': '/v1/image-to-3d', rigging: '/v1/rigging', animation: '/v1/animations',
    };
    const path = kinds[need('kind')] ?? fail(`--kind: one of ${Object.keys(kinds).join(', ')}`);
    console.log(JSON.stringify(await api('GET', `${path}/${need('id')}`), null, 2));
  },

  async help() {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
  },
};

await (commands[cmd] ?? (() => fail(`unknown command "${cmd}" — try: npm run meshy -- help`)))();
