// Guard mode config: challenge.json difficulties (FR5.1 / FR5.4), ring map validation (FR2.6), boss / imp (FR8.7).
import { describe, expect, it } from 'vitest';
import { validateConfig } from '../../src/config/validate';
import { config, rawConfig, rawMaps } from './helpers';

type AnyObj = Record<string, any>;

describe('challenge.json difficulties (FR5.1)', () => {
  const d = config().challenge.difficulties;

  it('ships the three difficulty columns from 需求文档2 §4.3', () => {
    const pick = (k: keyof typeof d.easy) => [d.easy[k], d.standard[k], d.hard[k]];
    expect(pick('waves')).toEqual([5, 8, 12]);
    expect(pick('firstWaveCount')).toEqual([4, 6, 8]);
    expect(pick('waveIncrement')).toEqual([2, 3, 3]);
    expect(pick('waveCap')).toEqual([16, 30, 40]);
    expect(pick('zombieHealthMultiplier')).toEqual([0.8, 1.0, 1.25]);
    expect(pick('playerDamageMultiplier')).toEqual([0.7, 1.0, 1.3]);
    expect(pick('coreDamageMultiplier')).toEqual([0.7, 1.0, 1.3]);
    expect(pick('countdownSeconds')).toEqual([30, 30, 30]);
    expect(pick('entranceCap')).toEqual([2, 3, 4]);
    expect(pick('sunIncomeMultiplier')).toEqual([1.2, 1.0, 0.8]);
    expect(pick('coreHealth')).toEqual([4000, 5000, 7000]);
    expect(pick('bossHealth')).toEqual([3000, 4000, 6000]);
  });

  it('rejects a wave cap above the 40 alive budget and a missing / non-positive field (FR5.4)', () => {
    const raw = rawConfig();
    const diffs = (raw.challenge as AnyObj).difficulties;
    diffs.hard.waveCap = 41;
    delete diffs.easy.coreHealth;
    diffs.standard.waves = 0;
    const errors = validateConfig(raw);
    expect(errors.some((e) => e.includes('challenge.difficulties.hard.waveCap') && e.includes('40'))).toBe(true);
    expect(errors).toContain('challenge.difficulties.easy.coreHealth: 应为正数');
    expect(errors).toContain('challenge.difficulties.standard.waves: 应为正数');
  });

  it('rejects a missing difficulty and a boss type inside the normal wave pool', () => {
    const raw = rawConfig();
    const ch = raw.challenge as AnyObj;
    delete ch.difficulties.hard;
    ch.waves.typeUnlocks.push({ type: 'gargantuar_zombie', fromWave: 3, weight: 1 });
    const errors = validateConfig(raw);
    expect(errors).toContain('challenge.difficulties.hard: 缺失');
    expect(errors.some((e) => e.includes('typeUnlocks') && e.includes('gargantuar_zombie'))).toBe(true);
  });
});

describe('ring map validation (FR2.6)', () => {
  it('accepts the shipped ring map with its 4 entrances and 3 decreasing radii', () => {
    const ring = config().maps.ring_01;
    expect(ring.entrances).toHaveLength(4);
    expect(ring.rings.map((r) => r.radius)).toEqual([50, 32, 16]);
    expect(ring.laneWidth).toBeGreaterThanOrEqual(8);
  });

  it('rejects a ring map with a missing entrance', () => {
    const raw = rawConfig();
    rawMaps(raw).ring_01.entrances.pop();
    expect(validateConfig(raw)).toContain('maps.ring_01.entrances: 需要 4 个外圈入口（当前 3）');
  });

  it('rejects a lane narrower than 8 m, an empty spawn group and a core outside the inner ring', () => {
    const raw = rawConfig();
    const ring = rawMaps(raw).ring_01;
    ring.laneWidth = 7.5;
    ring.entrances[1].spawnPoints = [];
    ring.core.center = [10, 0];
    const errors = validateConfig(raw);
    expect(errors).toContain('maps.ring_01.laneWidth: 环道宽度至少 8 m');
    expect(errors).toContain(`maps.ring_01.entrances.${ring.entrances[1].id}.spawnPoints: 刷怪点组不能为空`);
    expect(errors).toContain('maps.ring_01.core: 核心房必须完整位于内圈环道之内');
  });

  it('rejects radii that do not decrease and a third ramp between two rings', () => {
    const raw = rawConfig();
    const ring = rawMaps(raw).ring_01;
    ring.rings[1].radius = 52;
    ring.ramps.push({ id: 'extra', from: 'outer', to: 'middle', angleDeg: 90, width: 6, slopeDeg: 0 });
    const errors = validateConfig(raw);
    expect(errors.some((e) => e.startsWith('maps.ring_01.rings: 半径必须递减'))).toBe(true);
    expect(errors).toContain('maps.ring_01.ramps: outer → middle 之间需要 2 个坡道（当前 3）');
  });

  it('keeps the city rules unchanged: the ring map is not checked against city minimums', () => {
    const errors = validateConfig(rawConfig());
    expect(errors).toEqual([]);
    const raw = rawConfig();
    rawMaps(raw).city_01.playerSpawns.splice(1);
    expect(validateConfig(raw)).toContain('maps.city_01: 玩家重生点至少 6 个');
  });
});

describe('boss and imp zombies (FR8.2 / FR8.5 / FR8.7)', () => {
  const z = config().zombies;

  it('ships the gargantuar and the imp with the requirement numbers', () => {
    const g = z.gargantuar_zombie!;
    expect(g.chaseSpeed).toBe(0.6);
    expect(g.abilities?.smash).toMatchObject({ windup: 1.0, damageVsCore: 200, damageVsPlayer: 40, destroysPlants: true });
    expect(g.abilities?.throwImp).toMatchObject({ healthFraction: 0.5, impType: 'imp_zombie' });
    expect(g.visual.bodyScale).toBe(2);
    const imp = z.imp_zombie!;
    expect([imp.health, imp.chaseSpeed, imp.wanderSpeed]).toEqual([50, 2.5, 2.5]);
    expect(g.guardOnly && imp.guardOnly).toBe(true);
  });

  it('rejects an imp at or above the 4.5 m/s player walk speed (D-29)', () => {
    const raw = rawConfig();
    (raw.zombies as AnyObj).imp_zombie.chaseSpeed = 4.5;
    const errors = validateConfig(raw);
    expect(errors.some((e) => e.includes('imp_zombie') && e.includes('D-29'))).toBe(true);
  });

  it('rejects a boss imp-throw threshold outside (0, 1) and an unknown imp type', () => {
    const raw = rawConfig();
    const ti = (raw.zombies as AnyObj).gargantuar_zombie.abilities.throwImp;
    ti.healthFraction = 1.2;
    ti.impType = 'ghost_imp';
    const errors = validateConfig(raw);
    expect(errors).toContain('zombies.gargantuar_zombie.abilities.throwImp.healthFraction: 应在 0～1 之间（不含端点）');
    expect(errors.some((e) => e.includes('throwImp.impType') && e.includes('ghost_imp'))).toBe(true);
  });
});
