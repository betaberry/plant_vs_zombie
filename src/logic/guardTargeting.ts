// Guard mode zombie target rules (FR7, 需求文档2 §4.6). Pure: no Three.js / Rapier / DOM.
// Priority: aggro (whoever attacked me) → proximity (player ≤ 12 m / plant ≤ 8 m, nearest) →
// blocked by a nut wall with no detour → march on the core. Practice mode keeps chooseZombieTarget (8.3).
import type { Vec3Like } from '../core/events';
import type { ChallengeConfig, ZombieTargetingDef } from '../config/types';
import { distXZ } from './math';
import type { PlantKind } from './targeting';

export interface GuardAggro {
  kind: 'player' | 'plant';
  id: string;
}

export interface GuardPlayer {
  id: string;
  pos: Vec3Like;
  alive: boolean;
  /** Seconds since this zombie last perceived the player. */
  secondsSinceSeen: number;
}

export interface GuardPlant {
  id: string;
  kind: PlantKind;
  pos: Vec3Like;
  alive: boolean;
}

export interface GuardTargetContext {
  zombiePos: Vec3Like;
  players: GuardPlayer[];
  plants: GuardPlant[];
  /** Last attacker of this zombie (set by the entity on damage), or null. */
  aggro: GuardAggro | null;
  /** Nut wall blocking the path when no wall-free detour exists (planRoute choice 'break'). */
  blockingWallId: string | null;
  rules: ZombieTargetingDef;
  radii: ChallengeConfig['targeting'];
}

export type GuardDecision =
  | { action: 'ATTACK_CORE' }
  | { action: 'CHASE_PLAYER'; playerId: string; reason: 'aggro' | 'proximity' }
  | { action: 'ATTACK_PLANT'; plantId: string; reason: 'aggro' | 'proximity' }
  | { action: 'BREAK'; plantId: string };

export interface GuardTargetResult {
  decision: GuardDecision;
  /** Aggro after this evaluation (null once it expired or its source is gone). */
  aggro: GuardAggro | null;
}

/** FR7.2: aggro on a player lasts until they are farther than 40 m or unseen for 8 s (deaggroWhenPlayerLost). */
function aggroHolds(ctx: GuardTargetContext, a: GuardAggro): boolean {
  if (a.kind === 'plant') return ctx.plants.some((p) => p.id === a.id && p.alive);
  const p = ctx.players.find((x) => x.id === a.id);
  if (!p || !p.alive) return false;
  const lost = ctx.rules.deaggroWhenPlayerLost;
  return distXZ(ctx.zombiePos, p.pos) <= lost.distance && p.secondsSinceSeen <= lost.seconds;
}

/**
 * FR7.3: nearest living player within playerApproachRadius or plant within plantApproachRadius.
 * Nut walls are passive blockers: they are handled by the blocked rule (FR7.4), so a zombie that can walk
 * past a wall does not stop to chew on it.
 */
function nearestApproach(ctx: GuardTargetContext): GuardDecision | null {
  let best: GuardDecision | null = null;
  let bestD = Infinity;
  for (const p of ctx.players) {
    const d = distXZ(ctx.zombiePos, p.pos);
    if (p.alive && d <= ctx.radii.playerApproachRadius && d < bestD) {
      best = { action: 'CHASE_PLAYER', playerId: p.id, reason: 'proximity' };
      bestD = d;
    }
  }
  for (const p of ctx.plants) {
    const d = distXZ(ctx.zombiePos, p.pos);
    if (p.alive && p.kind !== 'wall' && d <= ctx.radii.plantApproachRadius && d < bestD) {
      best = { action: 'ATTACK_PLANT', plantId: p.id, reason: 'proximity' };
      bestD = d;
    }
  }
  return best;
}

export function chooseGuardTarget(ctx: GuardTargetContext): GuardTargetResult {
  const aggro = ctx.aggro && aggroHolds(ctx, ctx.aggro) ? ctx.aggro : null;
  if (aggro) {
    const decision: GuardDecision = aggro.kind === 'player'
      ? { action: 'CHASE_PLAYER', playerId: aggro.id, reason: 'aggro' }
      : { action: 'ATTACK_PLANT', plantId: aggro.id, reason: 'aggro' };
    return { decision, aggro };
  }
  const near = nearestApproach(ctx);
  if (near) return { decision: near, aggro: null };
  const wall = ctx.blockingWallId === null ? undefined : ctx.plants.find((p) => p.id === ctx.blockingWallId && p.alive && p.kind === 'wall');
  if (wall && ctx.rules.breakWallWhenBlocked) return { decision: { action: 'BREAK', plantId: wall.id }, aggro: null };
  return { decision: { action: 'ATTACK_CORE' }, aggro: null };
}

/**
 * FR7.5: when a zombie destroys the plant it was attacking, its aggro transfers to that plant's owner
 * (treated as being attacked by them). Other aggro is left untouched.
 */
export function aggroAfterPlantDestroyed(current: GuardAggro | null, targetPlantId: string | null, destroyedPlantId: string, ownerPlayerId: string | null): GuardAggro | null {
  const wasTarget = targetPlantId === destroyedPlantId || (current?.kind === 'plant' && current.id === destroyedPlantId);
  if (!wasTarget) return current;
  return ownerPlayerId === null ? null : { kind: 'player', id: ownerPlayerId };
}

/** FR7.7: guard mode LOD distance = the nearer of the player and the core, so core-bound zombies keep moving. */
export function guardLodDistance(zombiePos: Vec3Like, playerPos: Vec3Like, corePos: Vec3Like): number {
  return Math.min(distXZ(zombiePos, playerPos), distXZ(zombiePos, corePos));
}
