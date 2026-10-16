// Spawn director: pressure curve, global cap, out-of-sight & distance rules, defense discount (FR-SPD). Pure.
import type { Vec3Like } from '../core/events';
import type { GameConfig } from '../config/types';
import { distXZ } from './math';

type DirectorCfg = GameConfig['spawnDirector'];

export interface SpawnerInfo {
  id: string;
  pos: Vec3Like;
  district: string;
  maxAlive: number;
  respawnCooldown: number;
  activationRadius: number;
  alive: number;
}

export interface DirectorState {
  elapsed: number;
  cooldowns: Map<string, number>;
  evalTimer: number;
  district: string | null;
  districtTime: number;
}

export interface DirectorContext {
  playerPos: Vec3Like;
  playerDistrict: string | null;
  spawners: SpawnerInfo[];
  totalAlive: number;
  plantPositions: Vec3Like[];
  /** True when the spawn position is visible to the player (frustum + line of sight). */
  isVisibleToPlayer: (pos: Vec3Like) => boolean;
}

export function createDirectorState(): DirectorState {
  return { elapsed: 0, cooldowns: new Map(), evalTimer: 0, district: null, districtTime: 0 };
}

export function pressureLevel(elapsed: number, cfg: DirectorCfg): number {
  return Math.min(cfg.maxPressureLevel, Math.floor(elapsed / cfg.pressureInterval));
}

/** Per-spawner alive cap after pressure (+20% per level). The global cap still applies. */
export function spawnerCap(maxAlive: number, level: number, cfg: DirectorCfg): number {
  return Math.floor(maxAlive * (1 + cfg.pressureCapStep * level) + 1e-9);
}

export function isDefended(pos: Vec3Like, plants: Vec3Like[], cfg: DirectorCfg): boolean {
  let n = 0;
  for (const p of plants) if (distXZ(pos, p) <= cfg.defenseRadius) n++;
  return n >= cfg.defenseThreshold;
}

/** Spawn-rate multiplier for one spawner: pressure × defense (−30%) × linger. */
export function spawnRate(sp: SpawnerInfo, state: DirectorState, ctx: DirectorContext, cfg: DirectorCfg): number {
  let rate = 1 + cfg.pressureRateStep * pressureLevel(state.elapsed, cfg);
  if (isDefended(sp.pos, ctx.plantPositions, cfg)) rate *= cfg.defenseRateMultiplier;
  if (ctx.playerDistrict !== null && sp.district === ctx.playerDistrict && state.districtTime >= cfg.lingerSeconds) {
    rate *= cfg.lingerRateMultiplier;
  }
  return rate;
}

export type SpawnBlock = 'global_cap' | 'inactive' | 'too_close' | 'visible' | 'spawner_cap' | null;

export function spawnBlockReason(sp: SpawnerInfo, totalAlive: number, state: DirectorState, ctx: DirectorContext, cfg: DirectorCfg): SpawnBlock {
  if (totalAlive >= cfg.globalMaxAlive) return 'global_cap';
  const d = distXZ(sp.pos, ctx.playerPos);
  if (d > sp.activationRadius) return 'inactive';
  if (d < cfg.minSpawnDistance) return 'too_close';
  if (sp.alive >= spawnerCap(sp.maxAlive, pressureLevel(state.elapsed, cfg), cfg)) return 'spawner_cap';
  if (ctx.isVisibleToPlayer(sp.pos)) return 'visible';
  return null;
}

/** Advances the director; returns the ids of spawners that should spawn one zombie now. */
export function stepDirector(state: DirectorState, ctx: DirectorContext, cfg: DirectorCfg, dt: number): string[] {
  state.elapsed += dt;
  if (ctx.playerDistrict !== state.district) {
    state.district = ctx.playerDistrict;
    state.districtTime = 0;
  } else {
    state.districtTime += dt;
  }
  for (const sp of ctx.spawners) {
    const cd = state.cooldowns.get(sp.id) ?? 0;
    state.cooldowns.set(sp.id, cd - dt * spawnRate(sp, state, ctx, cfg));
  }
  state.evalTimer -= dt;
  if (state.evalTimer > 0) return [];
  state.evalTimer = cfg.evalInterval;
  const out: string[] = [];
  let total = ctx.totalAlive;
  for (const sp of ctx.spawners) {
    if ((state.cooldowns.get(sp.id) ?? 0) > 0) continue;
    if (spawnBlockReason(sp, total, state, ctx, cfg) !== null) continue;
    out.push(sp.id);
    total++;
    state.cooldowns.set(sp.id, sp.respawnCooldown);
  }
  return out;
}
