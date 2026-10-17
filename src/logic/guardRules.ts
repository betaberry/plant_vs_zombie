// Guard mode rules (FR3.3, FR4.8, FR5.2, FR6): failure, wave restart, core health, difficulty multipliers,
// and the wave spawn-point rule. Pure: no Three.js / Rapier / DOM.
import type { Vec3Like } from '../core/events';
import type { ChallengeConfig, DifficultyDef, ZombieDef } from '../config/types';
import { DEG, distXZ } from './math';

export type FailureReason = 'core_destroyed' | 'players_dead';

/** FR6.1: the core reaching 0 or every player being dead ends the wave (core is checked first). */
export function checkFailure(s: { coreHealth: number; playersAlive: number }): FailureReason | null {
  if (s.coreHealth <= 0) return 'core_destroyed';
  if (s.playersAlive <= 0) return 'players_dead';
  return null;
}

/**
 * FR6.2: a dead player is never revived in guard mode. While somebody is still alive the dead player
 * stays dead (multiplayer reserve); when nobody is left the wave fails.
 */
export function resolvePlayerDeath(playersAliveAfter: number): 'stay_dead' | 'fail' {
  return playersAliveAfter > 0 ? 'stay_dead' : 'fail';
}

/**
 * FR6.5: the core is never repaired, so a restart keeps its current health — except when the core itself
 * reached 0: then it returns to its health at the start of that wave, otherwise the run could not continue.
 */
export function coreHealthAfterRestart(reason: FailureReason, current: number, atWaveStart: number): number {
  return reason === 'core_destroyed' ? atWaveStart : current;
}

/** Everything a wave restart has to decide about (entity lists are opaque to this module). */
export interface GuardRunSnapshot<P = unknown, Z = unknown, D = unknown> {
  wave: number;
  difficulty: string;
  coreHealth: number;
  sun: number;
  items: Record<string, number>;
  upgrades: { damageBonus: number; sunBonus: number };
  ownedEquipment: string[];
  potion: { itemId: string; remainingSeconds: number } | null;
  plants: P[];
  zombies: Z[];
  drops: D[];
}

/**
 * FR6.4: restart the current wave. Kept: plants, sun, permanent upgrades, timed potion, bought items and
 * equipment, wave number and difficulty. Cleared: every zombie of the wave (boss and imps included) and drops.
 */
export function applyWaveRestart<P, Z, D>(s: GuardRunSnapshot<P, Z, D>, reason: FailureReason, coreAtWaveStart: number): GuardRunSnapshot<P, Z, D> {
  return {
    ...s,
    items: { ...s.items },
    upgrades: { ...s.upgrades },
    ownedEquipment: [...s.ownedEquipment],
    potion: s.potion ? { ...s.potion } : null,
    plants: [...s.plants],
    zombies: [],
    drops: [],
    coreHealth: coreHealthAfterRestart(reason, s.coreHealth, coreAtWaveStart),
  };
}

// ---------- difficulty multipliers (FR5.1 / FR5.2, FR8.2) ----------

/** Zombie body health for this difficulty; the boss uses its own per-difficulty value with no extra multiplier. */
export function scaledZombieHealth(def: Pick<ZombieDef, 'health'>, d: DifficultyDef, isBoss: boolean): number {
  return isBoss ? d.bossHealth : def.health * d.zombieHealthMultiplier;
}

export function scaledPlayerDamage(base: number, d: DifficultyDef): number {
  return base * d.playerDamageMultiplier;
}

/** e.g. a basic zombie (10 per 1 s hit) deals 10 × multiplier per second to the core (FR3 acceptance). */
export function scaledCoreDamage(base: number, d: DifficultyDef): number {
  return base * d.coreDamageMultiplier;
}

/** FR5.2: kill rewards and sunflower output; the 999 cap is still applied by the wallet. */
export function scaledSunIncome(amount: number, d: DifficultyDef): number {
  return amount * d.sunIncomeMultiplier;
}

// ---------- core damage stages (FR3.4 / FR3.5) ----------

/** 0 = intact; 1..n = damage stage n (window → cracks → smoke → collapse with the default stages). */
export function coreDamageStage(health: number, maxHealth: number, stages: readonly number[]): number {
  const f = maxHealth > 0 ? Math.max(0, health) / maxHealth : 0;
  let stage = 0;
  stages.forEach((threshold, i) => {
    if (threshold === 0 ? f <= 0 : f <= threshold) stage = i + 1;
  });
  return stage;
}

export function isCoreLow(health: number, maxHealth: number, core: ChallengeConfig['core']): boolean {
  return maxHealth > 0 && health / maxHealth < core.lowHealthFraction;
}

// ---------- wave spawn point rule (FR4.8) ----------

export interface SpawnCheck {
  spawnPos: Vec3Like;
  playerPos: Vec3Like;
  corePos: Vec3Like;
  /** Spawn point inside the player's camera frustum. */
  inFrustum: boolean;
}

/**
 * A wave spawn point may be used when it is outside the view frustum AND farther than minPlayerDistance from
 * the player AND not within ±coreDirectionHalfAngleDeg of the player→core direction. A player standing on the
 * core has no core direction, so only the first two conditions apply.
 */
export function guardSpawnAllowed(c: SpawnCheck, rule: ChallengeConfig['spawnRule']): boolean {
  if (c.inFrustum) return false;
  if (!(distXZ(c.spawnPos, c.playerPos) > rule.minPlayerDistance)) return false;
  const cx = c.corePos.x - c.playerPos.x;
  const cz = c.corePos.z - c.playerPos.z;
  const sx = c.spawnPos.x - c.playerPos.x;
  const sz = c.spawnPos.z - c.playerPos.z;
  const lc = Math.hypot(cx, cz);
  if (lc < 1e-6) return true;
  const cos = (cx * sx + cz * sz) / (lc * Math.hypot(sx, sz));
  return Math.acos(Math.max(-1, Math.min(1, cos))) > rule.coreDirectionHalfAngleDeg * DEG;
}
