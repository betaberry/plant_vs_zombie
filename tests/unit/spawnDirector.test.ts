import { describe, expect, it } from 'vitest';
import {
  chooseZombieType, createDirectorState, spawnBlockReason, spawnRate, spawnerCap, stepDirector, typeUnderCap, zombieTypeWeights,
  type DirectorContext, type SpawnerInfo,
} from '../../src/logic/spawnDirector';
import { config } from './helpers';

const all = config();
const cfg = all.game.spawnDirector;
const table = all.maps.city_01.districtZombieTypes;
const ROLLS = Array.from({ length: 200 }, (_, i) => (i + 0.5) / 200);
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

describe('spawn director zombie types (Revision 2)', () => {
  it('the start district never spawns buckethead or football zombies, at any pressure', () => {
    for (let level = 0; level <= cfg.maxPressureLevel; level++) {
      const picked = new Set(ROLLS.map((r) => chooseZombieType('start', level, {}, table, cfg, r)));
      expect(picked.has('buckethead_zombie')).toBe(false);
      expect(picked.has('football_zombie')).toBe(false);
      expect([...picked].sort()).toEqual(['basic_zombie', 'conehead_zombie']);
    }
    // The industrial district does field the heavy types.
    const industrial = new Set(ROLLS.map((r) => chooseZombieType('industrial', 0, {}, table, cfg, r)));
    expect(industrial.has('buckethead_zombie')).toBe(true);
    expect(industrial.has('football_zombie')).toBe(true);
  });

  it('enforces per-type alive caps (football ≤ 4, buckethead ≤ 6)', () => {
    expect(cfg.zombieTypeCaps.football_zombie).toBe(4);
    expect(cfg.zombieTypeCaps.buckethead_zombie).toBe(6);
    expect(typeUnderCap('football_zombie', { football_zombie: 3 }, cfg)).toBe(true);
    expect(typeUnderCap('football_zombie', { football_zombie: 4 }, cfg)).toBe(false);
    // Uncapped types are only limited by the global cap.
    expect(typeUnderCap('basic_zombie', { basic_zombie: 39 }, cfg)).toBe(true);
    const capped = { football_zombie: 4, buckethead_zombie: 6 };
    const picked = new Set(ROLLS.map((r) => chooseZombieType('industrial', 5, capped, table, cfg, r)));
    expect(picked.has('football_zombie')).toBe(false);
    expect(picked.has('buckethead_zombie')).toBe(false);
    expect(picked.has('basic_zombie')).toBe(true);
  });

  it('returns null when every candidate is capped, and falls back to the default type without a table', () => {
    const tiny = { ...cfg, zombieTypeCaps: { basic_zombie: 1, conehead_zombie: 1 } };
    expect(chooseZombieType('start', 0, { basic_zombie: 1, conehead_zombie: 1 }, table, tiny, 0.3)).toBeNull();
    expect(chooseZombieType(null, 3, {}, table, cfg, 0.7)).toBe(cfg.defaultZombieType);
    expect(chooseZombieType('nowhere', 0, {}, table, cfg, 0.1)).toBe(cfg.defaultZombieType);
  });

  it('raises the weight of heavy types as pressure rises', () => {
    const w0 = zombieTypeWeights('industrial', 0, table, cfg);
    const w4 = zombieTypeWeights('industrial', 4, table, cfg);
    expect(w4.buckethead_zombie!).toBeCloseTo(w0.buckethead_zombie! * (1 + cfg.heavyWeightStep * 4), 6);
    expect(w4.football_zombie!).toBeGreaterThan(w0.football_zombie!);
    // Light types keep their weight.
    expect(w4.basic_zombie).toBe(w0.basic_zombie);
    const share = (w: Record<string, number>) => {
      const total = Object.values(w).reduce((a, b) => a + b, 0);
      return (w.buckethead_zombie! + w.football_zombie!) / total;
    };
    expect(share(w4)).toBeGreaterThan(share(w0));
    const heavyPicks = (level: number) => ROLLS.filter((r) => cfg.heavyZombieTypes.includes(chooseZombieType('industrial', level, {}, table, cfg, r)!)).length;
    expect(heavyPicks(5)).toBeGreaterThan(heavyPicks(0));
  });
});
