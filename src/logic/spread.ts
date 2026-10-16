// Crosshair spread (bloom) and recoil accumulation/recovery (FR-WPN-07/08/09). Pure.
import type { GunDef } from '../config/types';
import type { Rng } from '../core/rng';

type SpreadGun = Pick<
  GunDef,
  | 'baseSpreadDeg' | 'maxSpreadDeg' | 'spreadPerShotDeg' | 'spreadMoveAddDeg' | 'spreadAirAddDeg'
  | 'adsSpreadMultiplier' | 'spreadRecoverTime' | 'recoilVerticalDeg' | 'recoilHorizontalDeg' | 'recoilRecoverTime'
>;

export interface SpreadState {
  bloom: number;
  recoilPitchDeg: number;
  recoverRate: number;
  sinceShot: number;
}

export function createSpread(): SpreadState {
  return { bloom: 0, recoilPitchDeg: 0, recoverRate: 0, sinceShot: 999 };
}

/** Registers a shot; returns the camera kick to apply (degrees). */
export function onShot(s: SpreadState, gun: SpreadGun, rng: Rng): { pitchDeg: number; yawDeg: number } {
  s.bloom = Math.min(gun.maxSpreadDeg - gun.baseSpreadDeg, s.bloom + gun.spreadPerShotDeg);
  s.recoilPitchDeg += gun.recoilVerticalDeg;
  s.recoverRate = 0;
  s.sinceShot = 0;
  return { pitchDeg: gun.recoilVerticalDeg, yawDeg: rng.range(-gun.recoilHorizontalDeg, gun.recoilHorizontalDeg) };
}

/**
 * Recovers bloom continuously and, once firing stops, gives the accumulated recoil back
 * within recoilRecoverTime. Returns the pitch (degrees, ≥ 0) to lower the camera by.
 */
export function tickSpread(s: SpreadState, dt: number, gun: SpreadGun, firingInterval: number): number {
  s.sinceShot += dt;
  const bloomRate = (gun.maxSpreadDeg - gun.baseSpreadDeg) / gun.spreadRecoverTime;
  if (s.sinceShot > firingInterval) s.bloom = Math.max(0, s.bloom - bloomRate * dt);
  if (s.sinceShot <= firingInterval || s.recoilPitchDeg <= 0) return 0;
  if (s.recoverRate === 0) s.recoverRate = s.recoilPitchDeg / gun.recoilRecoverTime;
  const giveBack = Math.min(s.recoilPitchDeg, s.recoverRate * dt);
  s.recoilPitchDeg -= giveBack;
  return giveBack;
}

export function currentSpreadDeg(
  s: SpreadState,
  gun: SpreadGun,
  state: { moving: boolean; airborne: boolean; ads: boolean },
): number {
  let spread = gun.baseSpreadDeg + s.bloom;
  if (state.moving) spread += gun.spreadMoveAddDeg;
  if (state.airborne) spread += gun.spreadAirAddDeg;
  spread = Math.min(gun.maxSpreadDeg, spread);
  return state.ads ? spread * gun.adsSpreadMultiplier : spread;
}
