// Zombie armour resolution (Revision 2, plan Step 26): cone / bucket / newspaper / screen door / helmet.
// Pure: no Three.js / DOM. The caller emits the `armorBroken` event when `brokeNow` is true.
import type { ArmorProtects, ZombieArmorDef } from '../config/types';
import type { DamageInfo } from './attackable';
import type { HitZone } from './hitzone';

export interface ArmorState {
  health: number;
  broken: boolean;
}

export interface ArmorHit {
  /** Damage as computed by the attacker (already including the zone multiplier for gun hits). */
  amount: number;
  source: DamageInfo['source'];
  /** Hit zone; undefined (plant peas) counts as a torso hit. */
  zone?: HitZone;
  /** Zone multiplier baked into `amount` (headshot ×2 etc.); armour always takes damage at ×1. */
  zoneMultiplier?: number;
  /**
   * Angle (deg, 0 = straight ahead) between the zombie's facing and the direction to the attacker,
   * or null when the attacker position is unknown (treated as frontal).
   */
  hitAngleDeg?: number | null;
}

export interface ArmorResult {
  armorDamage: number;
  bodyDamage: number;
  /** True when the hit landed on the armour (for metal impact feedback). */
  hitArmor: boolean;
  /** True only on the hit that destroyed the armour. */
  brokeNow: boolean;
}

export function createArmorState(def: ZombieArmorDef | null | undefined): ArmorState | null {
  return def ? { health: def.health, broken: false } : null;
}

/** Does this armour cover a hit in `zone` arriving from `hitAngleDeg`? */
export function armorCovers(protects: ArmorProtects, frontAngleDeg: number, zone: HitZone, hitAngleDeg: number | null): boolean {
  if (protects === 'head') return zone === 'head';
  if (protects === 'body') return zone === 'head' || zone === 'torso';
  return hitAngleDeg === null || Math.abs(hitAngleDeg) <= frontAngleDeg;
}

/**
 * Splits one hit between armour and body:
 * - explosions hit armour and body with the full amount;
 * - covered hits are absorbed by the armour at ×1 (the head multiplier is removed), the overflow
 *   carries over to the body with the zone multiplier re-applied;
 * - uncovered hits (or broken / no armour) go straight to the body.
 */
export function resolveArmorHit(def: ZombieArmorDef | null | undefined, state: ArmorState | null, hit: ArmorHit): ArmorResult {
  const amount = Math.max(0, hit.amount);
  if (!def || !state || state.broken || amount === 0) return { armorDamage: 0, bodyDamage: amount, hitArmor: false, brokeNow: false };
  if (hit.source === 'explosion') {
    const armorDamage = Math.min(state.health, amount);
    return { armorDamage, bodyDamage: amount, hitArmor: true, brokeNow: damageArmor(state, armorDamage) };
  }
  const zone = hit.zone ?? 'torso';
  if (!armorCovers(def.protects, def.frontAngleDeg, zone, hit.hitAngleDeg ?? null)) {
    return { armorDamage: 0, bodyDamage: amount, hitArmor: false, brokeNow: false };
  }
  const mult = hit.zoneMultiplier && hit.zoneMultiplier > 0 ? hit.zoneMultiplier : 1;
  const base = amount / mult;
  const armorDamage = Math.min(state.health, base);
  const brokeNow = damageArmor(state, armorDamage);
  return { armorDamage, bodyDamage: (base - armorDamage) * mult, hitArmor: true, brokeNow };
}

function damageArmor(state: ArmorState, amount: number): boolean {
  state.health -= amount;
  if (state.health > 1e-9) return false;
  state.health = 0;
  state.broken = true;
  return true;
}
