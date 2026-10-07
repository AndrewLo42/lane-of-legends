/**
 * Skeleton conventions per asset family, so gameplay data (skill `anim` names, class/enemy visuals)
 * stays the same whichever rig a model uses. Clip names are the KayKit ones the data already refers
 * to; a rig without a clip can alias it to the closest one it has.
 */
export interface RigProfile {
  id: RigId;
  /** Bones driven by upper-body overlays (cast-while-moving). */
  upper: RegExp;
  /** Bone whose position track carries root motion (pinned on X/Z so clips play in place). */
  hips: string;
  /** Extra root bone whose position track is dropped entirely (KayKit has one; Meshy doesn't). */
  root?: string;
  /** Parents of optional hand props (weapons), toggled per equipped weapon. */
  propParent: RegExp;
  /** Missing clip -> clip to play instead. */
  aliases: Record<string, string>;
  /** Fraction of the clip where the hit lands, overriding the skill's `animImpact` (tuned to KayKit). */
  impact: Record<string, number>;
}

export type RigId = 'kaykit' | 'meshy';

export const RIGS: Record<RigId, RigProfile> = {
  kaykit: {
    id: 'kaykit',
    upper: /^(spine|chest|head|upperarm|lowerarm|wrist|hand|handslot|elbowIK|handIK)/,
    hips: 'hips',
    root: 'root',
    propParent: /^handslot/,
    aliases: {},
    impact: {},
  },
  // Meshy auto-rig (biped): Mixamo-style names without the prefix, no fingers. Clips come from
  // tools/blender/import_meshy.py, already renamed to our canonical names.
  meshy: {
    id: 'meshy',
    upper: /^(Spine|neck|Head|head|Left(Shoulder|Arm|ForeArm|Hand)|Right(Shoulder|Arm|ForeArm|Hand))/,
    hips: 'Hips',
    propParent: /^(Left|Right)Hand$/,
    aliases: {
      // No strafe clips in Meshy's library yet (Mixamo has them).
      Running_Strafe_Left: 'Running_A',
      Running_Strafe_Right: 'Running_A',
      '2H_Melee_Idle': 'Idle',
      Block_Attack: 'Block',
      Spellcast_Shoot: 'Throw',
      Spellcast_Raise: 'Cheer',
      Spellcast_Long: 'Cheer',
      '2H_Ranged_Shoot': 'Throw',
      '1H_Ranged_Shoot': 'Throw',
      '1H_Ranged_Shooting': 'Throw',
      '1H_Melee_Attack_Slice_Horizontal': '1H_Melee_Attack_Slice_Diagonal',
      '1H_Melee_Attack_Chop': '2H_Melee_Attack_Chop',
      Dualwield_Melee_Attack_Slice: '1H_Melee_Attack_Slice_Diagonal',
      Dualwield_Melee_Attack_Stab: '1H_Melee_Attack_Stab',
      Dualwield_Melee_Attack_Chop: '2H_Melee_Attack_Chop',
    },
    // Measured from peak hand speed in each clip (see the import notes in assets-src/meshy/warrior).
    impact: {
      '2H_Melee_Attack_Slice': 0.54,
      '2H_Melee_Attack_Chop': 0.59,
      '2H_Melee_Attack_Spin': 0.37,
      Leap_Attack: 0.6,
      '1H_Melee_Attack_Slice_Diagonal': 0.48,
      '1H_Melee_Attack_Stab': 0.49,
      Throw: 0.7,
      Cheer: 0.47,
      Block: 0.3,
      Use_Item: 0.5,
    },
  },
};

export const rigOf = (id: RigId | undefined) => RIGS[id ?? 'meshy'];
