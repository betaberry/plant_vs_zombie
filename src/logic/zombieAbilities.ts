// Zombie special abilities (Revision 2, plan Step 26): pole vault, newspaper rage, football charge.
// Pure: no Three.js / DOM. The entity owns one AbilityState and asks these functions what to do.
import type { Vec3Like } from '../core/events';
import type { ZombieAbilitiesDef, ZombieDef } from '../config/types';
import { angleDiff, DEG, distXZ, yawTo } from './math';

export type VaultPhase = 'carrying' | 'vaulting' | 'done';
export type RagePhase = 'reading' | 'raging' | 'raged';

export interface VaultState {
  phase: VaultPhase;
  t: number;
  from: Vec3Like | null;
  to: Vec3Like | null;
  plantId: string | null;
}

export interface RageState {
  phase: RagePhase;
  t: number;
}

export interface AbilityState {
  vault: VaultState | null;
  rage: RageState | null;
}

export function createAbilityState(abilities: ZombieAbilitiesDef | undefined): AbilityState {
  return {
    vault: abilities?.poleVault ? { phase: 'carrying', t: 0, from: null, to: null, plantId: null } : null,
    rage: abilities?.newspaperRage ? { phase: 'reading', t: 0 } : null,
  };
}

// ---------- pole vault ----------

export interface VaultCandidate {
  id: string;
  pos: Vec3Like;
  alive: boolean;
}

/**
 * The first (nearest) living plant within triggerRange and ±triggerAngleDeg of the facing direction,
 * or null. Only while still carrying the pole — the vault happens once.
 */
export function findVaultTarget(state: AbilityState, abilities: ZombieAbilitiesDef | undefined, pos: Vec3Like, yaw: number, plants: VaultCandidate[]): VaultCandidate | null {
  const pv = abilities?.poleVault;
  if (!pv || state.vault?.phase !== 'carrying') return null;
  let best: VaultCandidate | null = null;
  let bestD = Infinity;
  for (const p of plants) {
    if (!p.alive) continue;
    const d = distXZ(pos, p.pos);
    if (d > pv.triggerRange || d >= bestD) continue;
    if (Math.abs(angleDiff(yaw, yawTo(pos, p.pos))) > pv.triggerAngleDeg * DEG) continue;
    best = p;
    bestD = d;
  }
  return best;
}

/** Starts the vault: landing point lies landingDistance beyond the plant along the approach line. */
export function startVault(state: AbilityState, abilities: ZombieAbilitiesDef | undefined, from: Vec3Like, plant: VaultCandidate): boolean {
  const pv = abilities?.poleVault;
  const v = state.vault;
  if (!pv || !v || v.phase !== 'carrying') return false;
  const dx = plant.pos.x - from.x;
  const dz = plant.pos.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  v.phase = 'vaulting';
  v.t = 0;
  v.from = { ...from };
  v.to = { x: plant.pos.x + (dx / len) * pv.landingDistance, y: plant.pos.y, z: plant.pos.z + (dz / len) * pv.landingDistance };
  v.plantId = plant.id;
  return true;
}

export interface VaultStep {
  /** Ground position along the vault (the visual arc height is added by the pose layer). */
  pos: Vec3Like;
  /** 0..1 progress through the vault. */
  progress: number;
  landed: boolean;
}

/** Advances a running vault; returns null when not vaulting. */
export function stepVault(state: AbilityState, abilities: ZombieAbilitiesDef | undefined, dt: number): VaultStep | null {
  const pv = abilities?.poleVault;
  const v = state.vault;
  if (!pv || !v || v.phase !== 'vaulting' || !v.from || !v.to) return null;
  v.t += dt;
  const progress = Math.min(1, v.t / pv.duration);
  const pos = {
    x: v.from.x + (v.to.x - v.from.x) * progress,
    y: v.from.y + (v.to.y - v.from.y) * progress,
    z: v.from.z + (v.to.z - v.from.z) * progress,
  };
  const landed = progress >= 1;
  if (landed) v.phase = 'done';
  return { pos, progress, landed };
}

export function isVaulting(state: AbilityState): boolean {
  return state.vault?.phase === 'vaulting';
}

/** Vine traps cannot root a zombie in mid-vault. */
export function canBeRooted(state: AbilityState): boolean {
  return !isVaulting(state);
}

// ---------- newspaper rage ----------

/** Called when the armour breaks: a newspaper zombie starts stomping / roaring. */
export function onArmorBroken(state: AbilityState): boolean {
  if (!state.rage || state.rage.phase !== 'reading') return false;
  state.rage.phase = 'raging';
  state.rage.t = 0;
  return true;
}

/** Returns true on the step the rage ends and the zombie starts running. */
export function stepRage(state: AbilityState, abilities: ZombieAbilitiesDef | undefined, dt: number): boolean {
  const nr = abilities?.newspaperRage;
  const r = state.rage;
  if (!nr || !r || r.phase !== 'raging') return false;
  r.t += dt;
  if (r.t < nr.rageDuration) return false;
  r.phase = 'raged';
  return true;
}

export function isRaging(state: AbilityState): boolean {
  return state.rage?.phase === 'raging';
}

// ---------- speeds (pole / rage / charge) ----------

export type MoveMode = 'wander' | 'chase';

/**
 * Base movement speed (before speed variance / slow / root) for this type and ability state.
 * @param goalDistance distance to the chase goal; used by the football charge.
 */
export function abilityMoveSpeed(def: Pick<ZombieDef, 'wanderSpeed' | 'chaseSpeed' | 'abilities'>, state: AbilityState, mode: MoveMode, goalDistance = Infinity): number {
  const ab = def.abilities;
  if (state.rage?.phase === 'raging') return 0;
  if (state.rage?.phase === 'raged' && ab?.newspaperRage) {
    return mode === 'chase' ? ab.newspaperRage.chaseSpeedAfter : ab.newspaperRage.wanderSpeedAfter;
  }
  if (mode === 'wander') return def.wanderSpeed;
  if (state.vault?.phase === 'done' && ab?.poleVault) return ab.poleVault.speedAfter;
  if (ab?.charge && goalDistance <= ab.charge.minDistance) return ab.charge.approachSpeed;
  return def.chaseSpeed;
}

/** Football zombie: charging (lowered-head sprint) while farther than minDistance from its goal. */
export function isCharging(def: Pick<ZombieDef, 'abilities'>, mode: MoveMode, goalDistance: number): boolean {
  const c = def.abilities?.charge;
  return !!c && mode === 'chase' && goalDistance > c.minDistance;
}

/** Every speed a type can ever move at (validation: all must stay below the player's walk speed, D-29). */
export function allMoveSpeeds(def: Pick<ZombieDef, 'wanderSpeed' | 'chaseSpeed' | 'abilities'>): number[] {
  const ab = def.abilities;
  const out = [def.wanderSpeed, def.chaseSpeed];
  if (ab?.poleVault) out.push(ab.poleVault.speedAfter);
  if (ab?.newspaperRage) out.push(ab.newspaperRage.chaseSpeedAfter, ab.newspaperRage.wanderSpeedAfter);
  if (ab?.charge) out.push(ab.charge.approachSpeed);
  return out;
}
