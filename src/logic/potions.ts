// Timed potions (FR-SHP-14, D-24, D-25): one active at a time, a new one replaces the old one.
import type { ShopItem } from '../config/types';

export interface ActivePotion {
  id: string;
  type: 'ice' | 'power';
  remaining: number;
  duration: number;
  slowPercent: number;
  slowDuration: number;
  damageMultiplier: number;
}

export interface PotionState {
  active: ActivePotion | null;
}

export function createPotionState(): PotionState {
  return { active: null };
}

export function drinkPotion(state: PotionState, item: ShopItem): { replaced: boolean; previous: string | null } {
  const effect = item.effect;
  if (item.category !== 'potion' || !effect || (effect.type !== 'ice' && effect.type !== 'power')) {
    throw new Error(`item "${item.id}" is not a potion`);
  }
  const previous = state.active?.id ?? null;
  const duration = item.durationSeconds ?? 0;
  state.active = {
    id: item.id,
    type: effect.type,
    remaining: duration,
    duration,
    slowPercent: effect.type === 'ice' ? effect.slowPercent : 0,
    slowDuration: effect.type === 'ice' ? effect.slowDuration : 0,
    damageMultiplier: effect.type === 'power' ? effect.damageMultiplier : 1,
  };
  return { replaced: previous !== null, previous };
}

export function tickPotion(state: PotionState, dt: number): boolean {
  if (!state.active) return false;
  state.active.remaining -= dt;
  if (state.active.remaining > 1e-9) return false;
  state.active = null;
  return true;
}

export function potionDamageMultiplier(state: PotionState): number {
  return state.active?.type === 'power' ? state.active.damageMultiplier : 1;
}

export function potionSlow(state: PotionState): { percent: number; duration: number } | null {
  if (state.active?.type !== 'ice') return null;
  return { percent: state.active.slowPercent, duration: state.active.slowDuration };
}
