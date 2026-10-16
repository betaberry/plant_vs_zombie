// Body-part classification from the hit point in the zombie's local frame (TR-HIT-01).

export type HitZone = 'head' | 'torso' | 'limb';

export interface HitZoneDef {
  headHeightRange: [number, number];
  legHeight: number;
  torsoHalfWidth: number;
}

/**
 * @param localY   hit height above the zombie's feet (m)
 * @param lateral  signed sideways offset from the body axis in the zombie's local frame (m)
 */
export function classifyHitZone(localY: number, lateral: number, def: HitZoneDef): HitZone {
  if (localY >= def.headHeightRange[0]) return 'head';
  if (localY < def.legHeight) return 'limb';
  if (Math.abs(lateral) > def.torsoHalfWidth) return 'limb';
  return 'torso';
}
