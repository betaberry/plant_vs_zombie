// Unified planting legality query canPlantAt(pos) → {ok, reason} (FR-MAP-14, FR-PLT-03/04/10). Pure.
import type { Vec3Like } from '../core/events';
import type { PlantDef, PlantingRules } from '../config/types';
import { distXZ } from './math';
import { zoneBlockReason, type ZoneQuery } from './zones';

export type PlantRejectReason = 'limit' | 'too_far' | 'no_ground' | 'slope' | 'zone' | 'overlap' | 'not_allowed';

export interface Circle {
  pos: Vec3Like;
  radius: number;
}

export interface PlantContext {
  characterId: string;
  playerPos: Vec3Like;
  plant: PlantDef;
  rules: PlantingRules;
  aliveOfType: number;
  /** Ground probe at the target: null when no supporting walkable ground was hit. */
  ground: { normalY: number } | null;
  zones: ZoneQuery;
  /** Existing plants, zombies and the player as circles in XZ. */
  occupied: Circle[];
}

export type PlantCheck = { ok: true } | { ok: false; reason: PlantRejectReason; detail?: string };

export function slopeDegFromNormalY(normalY: number): number {
  return (Math.acos(Math.max(-1, Math.min(1, normalY))) * 180) / Math.PI;
}

export function canPlantAt(pos: Vec3Like, ctx: PlantContext): PlantCheck {
  const { plant, rules } = ctx;
  if (plant.onlyByCharacter !== null && plant.onlyByCharacter !== ctx.characterId) return { ok: false, reason: 'not_allowed' };
  if (ctx.aliveOfType >= plant.maxAlive) return { ok: false, reason: 'limit' };
  if (distXZ(pos, ctx.playerPos) > rules.maxPlacementDistance) return { ok: false, reason: 'too_far' };
  if (!ctx.ground) return { ok: false, reason: 'no_ground' };
  if (slopeDegFromNormalY(ctx.ground.normalY) > rules.maxSlopeDeg + 1e-6) return { ok: false, reason: 'slope' };
  const zone = zoneBlockReason(ctx.zones, pos.x, pos.z);
  if (zone) return { ok: false, reason: 'zone', detail: zone };
  for (const c of ctx.occupied) {
    if (distXZ(pos, c.pos) < c.radius + plant.footprintRadius) return { ok: false, reason: 'overlap' };
  }
  return { ok: true };
}
