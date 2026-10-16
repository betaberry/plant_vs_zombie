import { describe, expect, it } from 'vitest';
import {
  createDirectorState, spawnBlockReason, spawnRate, spawnerCap, stepDirector, type DirectorContext, type SpawnerInfo,
} from '../../src/logic/spawnDirector';
import { config } from './helpers';

const cfg = config().game.spawnDirector;
const at = (x: number, z: number) => ({ x, y: 0, z });

function spawner(over: Partial<SpawnerInfo> = {}): SpawnerInfo {
  return { id: 'zs', pos: at(30, 0), district: 'start', maxAlive: 4, respawnCooldown: 8, activationRadius: 60, alive: 0, ...over };
}

function ctx(over: Partial<DirectorContext> = {}): DirectorContext {
  return { playerPos: at(0, 0), playerDistrict: 'start', spawners: [spawner()], totalAlive: 0, plantPositions: [], isVisibleToPlayer: () => false, ...over };
}

describe('spawn director (FR-SPD)', () => {
  it('spawns from an eligible spawner', () => {
    const s = createDirectorState();
    expect(stepDirector(s, ctx(), cfg, 0.5)).toEqual(['zs']);
  });

  it('stops spawning at the global cap of 40', () => {
    const s = createDirectorState();
    expect(stepDirector(s, ctx({ totalAlive: 40 }), cfg, 0.5)).toEqual([]);
    expect(spawnBlockReason(spawner(), 40, s, ctx(), cfg)).toBe('global_cap');
  });

  it('never spawns within 15 m of the player or in view', () => {
    const s = createDirectorState();
    expect(stepDirector(s, ctx({ spawners: [spawner({ pos: at(14, 0) })] }), cfg, 0.5)).toEqual([]);
    expect(spawnBlockReason(spawner(), 0, s, ctx({ isVisibleToPlayer: () => true }), cfg)).toBe('visible');
  });

  it('reduces the spawn rate by 30% near a defensive position of ≥ 3 plants', () => {
    const s = createDirectorState();
    const plants = [at(31, 0), at(29, 2), at(30, -3)];
    expect(spawnRate(spawner(), s, ctx(), cfg)).toBeCloseTo(1, 6);
    expect(spawnRate(spawner(), s, ctx({ plantPositions: plants }), cfg)).toBeCloseTo(0.7, 6);
    expect(spawnRate(spawner(), s, ctx({ plantPositions: plants.slice(0, 2) }), cfg)).toBeCloseTo(1, 6);
  });

  it('raises rate +15% and per-spawner cap +20% every 3 minutes', () => {
    const s = createDirectorState();
    s.elapsed = 360;
    expect(spawnRate(spawner({ district: 'other' }), s, ctx(), cfg)).toBeCloseTo(1.3, 6);
    expect(spawnerCap(5, 2, cfg)).toBe(7);
  });
});
