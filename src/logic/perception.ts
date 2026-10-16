// Zombie perception: vision cone + line of sight, hearing radius (FR-AI-03/04). Pure.
import type { Vec3Like } from '../core/events';
import { DEG, angleDiff, dist3, yawTo } from './math';

export interface VisionParams {
  range: number;
  angleDeg: number;
}

/** Vision: inside range and the cone around `facingYaw`; LOS checked by the injected raycast. */
export function canSee(
  eye: Vec3Like,
  facingYaw: number,
  target: Vec3Like,
  vision: VisionParams,
  hasLineOfSight: (from: Vec3Like, to: Vec3Like) => boolean,
): boolean {
  if (dist3(eye, target) > vision.range) return false;
  const off = Math.abs(angleDiff(facingYaw, yawTo(eye, target)));
  if (off > (vision.angleDeg * DEG) / 2) return false;
  return hasLineOfSight(eye, target);
}

export type NoiseKind = 'gunshot' | 'plantFire' | 'running' | 'playerHurt';

export interface Noise {
  kind: NoiseKind;
  pos: Vec3Like;
}

/** Hearing ignores walls on purpose: this is how indoor ambushers get woken up. */
export function hears(listener: Vec3Like, noise: Noise, radius: Record<NoiseKind, number>): boolean {
  return dist3(listener, noise.pos) <= radius[noise.kind];
}
