// Finite ammo, reload and interruption (FR-WPN-05/06/15..17). Pure.

export interface AmmoState {
  mag: number;
  reserve: number;
  magSize: number;
  reserveMax: number;
  reloading: boolean;
  reloadTimer: number;
}

export type FireResult = 'fired' | 'empty_mag' | 'no_ammo' | 'reloading';
export type ReloadResult = 'started' | 'full' | 'no_reserve' | 'already';

export function createAmmo(magSize: number, reserveMax: number, reserve: number, mag = magSize): AmmoState {
  return {
    mag: Math.max(0, Math.min(mag, magSize)),
    reserve: Math.max(0, Math.min(reserve, reserveMax)),
    magSize,
    reserveMax,
    reloading: false,
    reloadTimer: 0,
  };
}

export function tryFire(a: AmmoState): FireResult {
  if (a.reloading) return 'reloading';
  if (a.mag <= 0) return a.reserve <= 0 ? 'no_ammo' : 'empty_mag';
  a.mag -= 1;
  return 'fired';
}

export function startReload(a: AmmoState, reloadTime: number): ReloadResult {
  if (a.reloading) return 'already';
  if (a.mag >= a.magSize) return 'full';
  if (a.reserve <= 0) return 'no_reserve';
  a.reloading = true;
  a.reloadTimer = reloadTime;
  return 'started';
}

/** Returns true on the tick the reload completes. Rounds move from reserve only on completion. */
export function tickReload(a: AmmoState, dt: number): boolean {
  if (!a.reloading) return false;
  a.reloadTimer -= dt;
  if (a.reloadTimer > 1e-9) return false;
  const moved = Math.min(a.magSize - a.mag, a.reserve);
  a.mag += moved;
  a.reserve -= moved;
  a.reloading = false;
  a.reloadTimer = 0;
  return true;
}

/** Switching items / sprinting interrupts the reload; nothing is consumed. */
export function cancelReload(a: AmmoState): boolean {
  if (!a.reloading) return false;
  a.reloading = false;
  a.reloadTimer = 0;
  return true;
}

/** Ammo pack refill: overflow above reserveMax is discarded (「备弹已满」). */
export function addReserve(a: AmmoState, rounds: number): { added: number; discarded: number } {
  const added = Math.max(0, Math.min(rounds, a.reserveMax - a.reserve));
  a.reserve += added;
  return { added, discarded: rounds - added };
}

export function reserveEmpty(a: AmmoState): boolean {
  return a.reserve <= 0;
}

export function reloadProgress(a: AmmoState, reloadTime: number): number {
  return a.reloading ? 1 - a.reloadTimer / reloadTime : 0;
}
