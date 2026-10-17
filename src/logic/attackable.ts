// Unified attack target interface (FR-AGG-07 / AR-04): player, zombies and plants all implement it.
import type { Vec3Like } from '../core/events';
import type { HitZone } from './hitzone';

/** core: the guard-mode core house (FR3). */
export type Team = 'player' | 'zombie' | 'plant' | 'core';

export interface DamageInfo {
  source: 'gun' | 'plant' | 'zombie' | 'explosion';
  zone?: HitZone;
  from?: Vec3Like | null;
  slow?: { percent: number; duration: number } | null;
  byPlant?: boolean;
  /** Zone multiplier already included in the amount (gun hits); armour removes it (Revision 2). */
  zoneMultiplier?: number;
  /** Attacking plant id (guard mode aggro, FR7.2). */
  attackerId?: string;
}

export interface DamageResult {
  applied: number;
  killed: boolean;
}

export interface IAttackable {
  readonly attackableId: string;
  readonly team: Team;
  position(): Vec3Like;
  isAlive(): boolean;
  applyDamage(amount: number, info: DamageInfo): DamageResult;
}

/** Shared health bookkeeping used by every IAttackable implementation. */
export function applyHealthDamage(
  state: { health: number; invulnerable?: boolean },
  amount: number,
): DamageResult {
  if (state.health <= 0 || state.invulnerable || !(amount > 0)) return { applied: 0, killed: false };
  const applied = Math.min(state.health, amount);
  state.health -= applied;
  return { applied, killed: state.health <= 0 };
}
