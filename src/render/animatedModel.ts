import * as THREE from 'three';
import { type RigProfile, RIGS } from './rigs';

type Part = 'full' | 'upper' | 'lower';

const FADE = 0.12;

/** "upperarm.l.quaternion" -> "upperarm.l" */
const boneOf = (trackName: string) => trackName.slice(0, trackName.lastIndexOf('.'));

/**
 * Wraps an AnimationMixer with two layers:
 *   base    — looping locomotion (idle/run/strafe)
 *   overlay — one-shot actions (attacks, dodges, death)
 * An overlay can be full-body, or upper-body only so the legs keep running underneath
 * (cast-while-moving). Every transition crossfades so per-bone weights always sum to 1,
 * which avoids blending toward the bind (T) pose.
 */
export class AnimatedModel {
  readonly mixer: THREE.AnimationMixer;
  private clips = new Map<string, THREE.AnimationClip>();
  private actions = new Map<string, THREE.AnimationAction>();
  private baseName = '';
  private baseKey = '';
  private baseAction: THREE.AnimationAction | null = null;
  private overlay: { action: THREE.AnimationAction; part: 'full' | 'upper'; endsAt: number; persistent: boolean; name: string } | null = null;
  private time = 0;

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[], readonly rig: RigProfile = RIGS.meshy) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const c of clips) this.clips.set(c.name, c);
  }

  /** Canonical clip name -> the clip this model actually plays (via the rig's aliases). */
  private resolve(name: string) {
    return this.clips.has(name) ? name : this.rig.aliases[name] ?? name;
  }

  has(name: string) {
    return this.clips.has(this.resolve(name));
  }

  clip(name: string) {
    return this.clips.get(this.resolve(name));
  }

  /** Where the hit lands in this model's version of the clip, if the rig knows better than the skill data. */
  impactOf(name: string): number | undefined {
    return this.rig.impact[this.resolve(name)];
  }

  get overlayName() {
    return this.overlay?.name ?? null;
  }

  /** Clip variant restricted to a body part, with horizontal root motion removed. */
  private action(name: string, part: Part): THREE.AnimationAction {
    name = this.resolve(name);
    const key = `${name}|${part}`;
    let a = this.actions.get(key);
    if (a) return a;
    const src = this.clips.get(name)!;
    const { root, hips, upper } = this.rig;
    const tracks = src.tracks
      .filter((t) => {
        const bone = boneOf(t.name);
        if (bone === root && t.name.endsWith('.position')) return false; // in-place only
        return part === 'full' || upper.test(bone) === (part === 'upper');
      })
      .map((t) => {
        // Pin hips X/Z so dodges/attacks don't drift away from the simulated position.
        if (boneOf(t.name) !== hips || !t.name.endsWith('.position')) return t;
        const c = t.clone();
        const v = c.values;
        for (let i = 0; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }
        return c;
      });
    a = this.mixer.clipAction(new THREE.AnimationClip(key, src.duration, tracks));
    this.actions.set(key, a);
    return a;
  }

  /** Set the looping locomotion clip (no-op if unchanged). */
  setBase(name: string, timeScale = 1) {
    if (!this.has(name)) return;
    this.baseName = this.resolve(name);
    this.refreshBase();
    if (this.baseAction) this.baseAction.timeScale = timeScale;
  }

  private refreshBase() {
    const part: Part | 'none' = !this.overlay ? 'full' : this.overlay.part === 'full' ? 'none' : 'lower';
    const key = part === 'none' || !this.baseName ? '' : `${this.baseName}|${part}`;
    if (key === this.baseKey) return;
    const old = this.baseAction;
    old?.fadeOut(FADE);
    this.baseKey = key;
    if (!key) { this.baseAction = null; return; }
    const next = this.action(this.baseName, part as Part);
    next.reset();
    next.setLoop(THREE.LoopRepeat, Infinity);
    // Switching full <-> lower of the same clip keeps the gait phase.
    if (old && old.getClip().name.startsWith(`${this.baseName}|`)) next.time = old.time;
    next.fadeIn(FADE).play();
    this.baseAction = next;
  }

  /**
   * Play a one-shot over the base. `persistent` holds the last frame (death).
   * Returns false if the clip doesn't exist on this model.
   */
  playOnce(name: string, opts: { timeScale?: number; part?: 'full' | 'upper'; persistent?: boolean } = {}): boolean {
    if (!this.has(name)) return false;
    name = this.resolve(name);
    const { timeScale = 1, part = 'full', persistent = false } = opts;
    this.overlay?.action.fadeOut(FADE);
    const a = this.action(name, part);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = timeScale;
    a.fadeIn(FADE).play();
    this.overlay = {
      action: a, part, persistent, name,
      endsAt: this.time + Math.max(FADE, a.getClip().duration / timeScale - FADE),
    };
    this.refreshBase();
    return true;
  }

  stopOverlay() {
    if (!this.overlay) return;
    this.overlay.action.fadeOut(FADE);
    this.overlay = null;
    this.refreshBase();
  }

  update(dt: number) {
    this.time += dt;
    if (this.overlay && !this.overlay.persistent && this.time >= this.overlay.endsAt) this.stopOverlay();
    this.mixer.update(dt);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}

/** Playback speed so the clip's impact frame lands when the cast completes. */
export function impactTimeScale(clip: THREE.AnimationClip | undefined, impact: number, castTime: number, instant = 1.4) {
  if (!clip) return 1;
  if (castTime <= 0) return instant;
  return THREE.MathUtils.clamp((clip.duration * impact) / castTime, 0.6, 4);
}
