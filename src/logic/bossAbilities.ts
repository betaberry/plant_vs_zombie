// Gargantuar boss abilities (FR8.3 / FR8.4): pole smash with a wind-up + area damage, and the one-time
// imp throw at half health. Pure: no Three.js / Rapier / DOM.
import type { Vec3Like } from '../core/events';
import type { SmashDef, ThrowImpDef } from '../config/types';
import { distXZ } from './math';

export type SmashPhase = 'ready' | 'windup' | 'cooldown';

export interface BossState {
  smash: { phase: SmashPhase; t: number; impact: Vec3Like | null };
  impThrown: boolean;
}

export function createBossState(): BossState {
  return { smash: { phase: 'ready', t: 0, impact: null }, impThrown: false };
}

export type SmashTargetKind = 'plant' | 'core' | 'player';

export interface SmashTarget {
  id: string;
  kind: SmashTargetKind;
  pos: Vec3Like;
  /** Current health (plants are destroyed outright, so their damage equals this). */
  health: number;
  /** Half-size of the target in XZ (e.g. the core house); 0 for point-like targets. */
  extent: number;
}

export interface SmashHit {
  id: string;
  kind: SmashTargetKind;
  damage: number;
  destroyed: boolean;
}

export interface SmashMultipliers {
  core: number;
  player: number;
}

/** Starts a swing at `impact` (only when ready). No damage is dealt until the wind-up has elapsed. */
export function startSmash(state: BossState, impact: Vec3Like): boolean {
  if (state.smash.phase !== 'ready') return false;
  state.smash = { phase: 'windup', t: 0, impact: { ...impact } };
  return true;
}

export function isWindingUp(state: BossState): boolean {
  return state.smash.phase === 'windup';
}

/** Targets inside the smash radius (measured to their surface) around the impact point. */
export function smashTargetsInRange(def: SmashDef, impact: Vec3Like, targets: SmashTarget[]): SmashTarget[] {
  return targets.filter((t) => t.health > 0 && distXZ(impact, t.pos) - t.extent <= def.radius);
}

function hitFor(def: SmashDef, t: SmashTarget, mult: SmashMultipliers): SmashHit {
  if (t.kind === 'plant') {
    const damage = def.destroysPlants ? t.health : 0;
    return { id: t.id, kind: t.kind, damage, destroyed: def.destroysPlants };
  }
  const damage = t.kind === 'core' ? def.damageVsCore * mult.core : def.damageVsPlayer * mult.player;
  return { id: t.id, kind: t.kind, damage, destroyed: damage >= t.health };
}

/**
 * Advances the swing. Returns the hits on the step the wind-up completes (once per swing), otherwise [].
 * After the hit the smash cools down and becomes ready again.
 */
export function stepSmash(state: BossState, def: SmashDef, dt: number, targets: SmashTarget[], mult: SmashMultipliers): SmashHit[] {
  const s = state.smash;
  if (s.phase === 'ready') return [];
  s.t += dt;
  if (s.phase === 'cooldown') {
    if (s.t >= def.cooldown) state.smash = { phase: 'ready', t: 0, impact: null };
    return [];
  }
  if (s.t < def.windup || !s.impact) return [];
  const hits = smashTargetsInRange(def, s.impact, targets).map((t) => hitFor(def, t, mult));
  state.smash = { phase: 'cooldown', t: 0, impact: null };
  return hits;
}

/** FR8.4: true exactly once, on the first check where health has fallen to the threshold fraction. */
export function shouldThrowImp(state: BossState, def: ThrowImpDef, health: number, maxHealth: number): boolean {
  if (state.impThrown || health <= 0 || maxHealth <= 0) return false;
  if (health / maxHealth > def.healthFraction) return false;
  state.impThrown = true;
  return true;
}

/**
 * Landing point of the imp: throwDistance ahead of the boss toward the core (the defence line), never closer
 * to the core than minCoreDistance. If that spot is not walkable, step back toward the boss 1 m at a time;
 * the boss position is the last resort.
 */
export function impLandingPoint(bossPos: Vec3Like, corePos: Vec3Like, def: ThrowImpDef, minCoreDistance: number, isWalkable: (p: Vec3Like) => boolean): Vec3Like {
  const dx = corePos.x - bossPos.x;
  const dz = corePos.z - bossPos.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return { ...bossPos };
  const reach = Math.min(def.throwDistance, Math.max(0, len - minCoreDistance));
  for (let d = reach; d > 0; d -= 1) {
    const p = { x: bossPos.x + (dx / len) * d, y: bossPos.y, z: bossPos.z + (dz / len) * d };
    if (isWalkable(p)) return p;
  }
  return { ...bossPos };
}
