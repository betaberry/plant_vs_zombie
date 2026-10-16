// Damage formulas (7.3.2, 7.6.1). Pure.
import type { GunDef } from '../config/types';
import type { HitZone } from './hitzone';

export function zoneMultiplier(zone: HitZone, gun: Pick<GunDef, 'headshotMultiplier' | 'limbMultiplier'>): number {
  if (zone === 'head') return gun.headshotMultiplier;
  if (zone === 'limb') return gun.limbMultiplier;
  return 1;
}

export interface GunDamageInput {
  gun: Pick<GunDef, 'damage' | 'headshotMultiplier' | 'limbMultiplier' | 'range' | 'falloffMultiplier'>;
  zone: HitZone;
  distance: number;
  potionMultiplier: number;
  permanentBonus: number;
}

/** base × zone × range falloff × potion × (1 + permanent upgrade). */
export function computeGunDamage(i: GunDamageInput): number {
  const falloff = i.distance > i.gun.range ? i.gun.falloffMultiplier : 1;
  return i.gun.damage * zoneMultiplier(i.zone, i.gun) * falloff * i.potionMultiplier * (1 + i.permanentBonus);
}

/** Linear falloff from center to edge; zero outside the radius. */
export function explosionDamage(center: number, edge: number, radius: number, distance: number): number {
  if (distance > radius || radius <= 0) return 0;
  return center - (center - edge) * (Math.max(0, distance) / radius);
}

/** Incoming damage to the player: character multiplier, zero while invulnerable. */
export function incomingDamage(amount: number, multiplier: number, invulnerable: boolean): number {
  if (invulnerable || amount <= 0) return 0;
  return amount * multiplier;
}

/** Number of hits needed to kill `health` with `perHit` damage. */
export function hitsToKill(health: number, perHit: number): number {
  if (perHit <= 0) return Infinity;
  return Math.ceil(health / perHit - 1e-9);
}
