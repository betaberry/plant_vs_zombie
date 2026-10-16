// Zombie target priority — the 「顺路」 rules of 8.3 (FR-AGG-01..06). Pure function.
import type { Vec3Like } from '../core/events';
import type { ZombieTargetingDef } from '../config/types';
import { distXZ } from './math';

export type PlantKind = 'sunflower' | 'shooter' | 'wall' | 'temporary';

export interface TargetPlant {
  id: string;
  kind: PlantKind;
  pos: Vec3Like;
  alive: boolean;
  /** Shooter plants: true while this plant is currently shooting at this zombie. */
  attackingThisZombie: boolean;
}

export interface TargetContext {
  zombiePos: Vec3Like;
  /** True once the zombie has aggro on the player (it is chasing). */
  hasAggro: boolean;
  player: {
    pos: Vec3Like;
    alive: boolean;
    /** Currently perceived (seen this tick or within memory). */
    perceivedNow: boolean;
    /** Seconds since the zombie last perceived the player. */
    secondsSinceSeen: number;
    /** A nav path to the player exists. */
    reachable: boolean;
  };
  plants: TargetPlant[];
  /** Nut wall currently blocking the path / bumped into (from nav or stuck detection). */
  blockingWallId: string | null;
  /** Plant the zombie is currently attacking (sticky until destroyed). */
  currentPlantId: string | null;
  rules: ZombieTargetingDef;
}

export type TargetDecision =
  | { action: 'WANDER'; reason: 'no_aggro' | 'player_lost' | 'player_dead' }
  | { action: 'CHASE_PLAYER' }
  | { action: 'BREAK'; plantId: string }
  | { action: 'ATTACK_PLANT'; plantId: string; reason: 'shooter_attacking' | 'shooter_player_unreachable' | 'sunflower_nearby' };

function nearest(plants: TargetPlant[], from: Vec3Like, filter: (p: TargetPlant, d: number) => boolean): TargetPlant | null {
  let best: TargetPlant | null = null;
  let bestD = Infinity;
  for (const p of plants) {
    if (!p.alive) continue;
    const d = distXZ(from, p.pos);
    if (d < bestD && filter(p, d)) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

export function isPlayerLost(ctx: TargetContext): boolean {
  const lost = ctx.rules.deaggroWhenPlayerLost;
  return distXZ(ctx.zombiePos, ctx.player.pos) > lost.distance || ctx.player.secondsSinceSeen > lost.seconds;
}

export function chooseZombieTarget(ctx: TargetContext): TargetDecision {
  if (!ctx.hasAggro) return { action: 'WANDER', reason: 'no_aggro' };
  if (!ctx.player.alive) return { action: 'WANDER', reason: 'player_dead' };
  // FR-AGG-06: player lost → give up any plant and go back to wandering.
  if (isPlayerLost(ctx)) return { action: 'WANDER', reason: 'player_lost' };

  const r = ctx.rules;
  const alivePlant = (id: string | null): TargetPlant | undefined =>
    id === null ? undefined : ctx.plants.find((p) => p.id === id && p.alive);

  // Priority 2: a nut wall blocking the way to the player (FR-AGG-03).
  const wall = alivePlant(ctx.blockingWallId);
  if (r.breakWallWhenBlocked && wall && wall.kind === 'wall') return { action: 'BREAK', plantId: wall.id };

  // Keep finishing a plant already being attacked (re-evaluated every 0.5 s by the caller).
  const current = alivePlant(ctx.currentPlantId);
  if (current && current.kind !== 'wall') {
    const d = distXZ(ctx.zombiePos, current.pos);
    const keepRange = current.kind === 'sunflower' ? r.sunflowerShareKillRange : r.plantKillWhenPlayerUnreachableRange;
    if (d <= keepRange + 1) {
      return { action: 'ATTACK_PLANT', plantId: current.id, reason: current.kind === 'sunflower' ? 'sunflower_nearby' : 'shooter_attacking' };
    }
  }

  // Priority 3: shooter within 8 m that is attacking me; or player not perceivable/unreachable and shooter within 20 m.
  const shooter = nearest(ctx.plants, ctx.zombiePos, (p, d) => p.kind === 'shooter' && d < r.plantShareKillRange && p.attackingThisZombie);
  if (shooter) return { action: 'ATTACK_PLANT', plantId: shooter.id, reason: 'shooter_attacking' };
  if (!ctx.player.perceivedNow || !ctx.player.reachable) {
    const far = nearest(ctx.plants, ctx.zombiePos, (p, d) => p.kind === 'shooter' && d < r.plantKillWhenPlayerUnreachableRange);
    if (far) return { action: 'ATTACK_PLANT', plantId: far.id, reason: 'shooter_player_unreachable' };
  }

  // Priority 4: sunflower plant within 3 m — no "player not perceivable" precondition (v0.3, FR-AGG-05).
  const sunflower = nearest(ctx.plants, ctx.zombiePos, (p, d) => p.kind === 'sunflower' && d < r.sunflowerShareKillRange);
  if (sunflower) return { action: 'ATTACK_PLANT', plantId: sunflower.id, reason: 'sunflower_nearby' };

  // Priority 1 (default): keep chasing the player (FR-AGG-01).
  return { action: 'CHASE_PLAYER' };
}
