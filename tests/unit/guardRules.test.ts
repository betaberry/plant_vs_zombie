// Guard rules (FR3.3, FR4.8, FR5.2, FR6): failure, restart, core health, multipliers, spawn rule.
import { describe, expect, it } from 'vitest';
import {
  applyWaveRestart,
  checkFailure,
  coreDamageStage,
  coreHealthAfterRestart,
  guardSpawnAllowed,
  isCoreLow,
  resolvePlayerDeath,
  scaledCoreDamage,
  scaledPlayerDamage,
  scaledSunIncome,
  scaledZombieHealth,
  type GuardRunSnapshot,
} from '../../src/logic/guardRules';
import { config } from './helpers';

const cfg = config();
const ch = cfg.challenge;
const { easy, standard, hard } = ch.difficulties;
const basic = cfg.zombies.basic_zombie!;

describe('failure (FR6.1 / FR6.2)', () => {
  it('fails when the core reaches 0, checked before the players', () => {
    expect(checkFailure({ coreHealth: 0, playersAlive: 0 })).toBe('core_destroyed');
    expect(checkFailure({ coreHealth: -5, playersAlive: 1 })).toBe('core_destroyed');
  });

  it('fails when every player is dead and keeps going otherwise', () => {
    expect(checkFailure({ coreHealth: 1, playersAlive: 0 })).toBe('players_dead');
    expect(checkFailure({ coreHealth: 1, playersAlive: 1 })).toBeNull();
  });

  it('never revives: a dead player stays dead while someone lives, single player death fails', () => {
    expect(resolvePlayerDeath(1)).toBe('stay_dead');
    expect(resolvePlayerDeath(0)).toBe('fail');
  });
});

describe('wave restart (FR6.4 / FR6.5)', () => {
  const snapshot = (): GuardRunSnapshot<string, string, string> => ({
    wave: 6, difficulty: 'standard', coreHealth: 2100, sun: 480, items: { medkit: 1 }, upgrades: { damageBonus: 0.2, sunBonus: 0.1 },
    ownedEquipment: ['sun_boost'], potion: { itemId: 'ice_potion', remainingSeconds: 9 },
    plants: ['nut_wall#1', 'pea#2'], zombies: ['z1', 'boss', 'imp'], drops: ['cone'],
  });

  it('keeps plants, sun, upgrades, potion, items, wave and difficulty; clears zombies and drops', () => {
    const s = snapshot();
    const r = applyWaveRestart(s, 'players_dead', 3000);
    expect(r.plants).toEqual(['nut_wall#1', 'pea#2']);
    expect([r.sun, r.wave, r.difficulty]).toEqual([480, 6, 'standard']);
    expect(r.upgrades).toEqual({ damageBonus: 0.2, sunBonus: 0.1 });
    expect(r.potion).toEqual({ itemId: 'ice_potion', remainingSeconds: 9 });
    expect(r.items).toEqual({ medkit: 1 });
    expect(r.ownedEquipment).toEqual(['sun_boost']);
    expect(r.zombies).toEqual([]);
    expect(r.drops).toEqual([]);
    // The input snapshot is not mutated.
    expect(s.zombies).toHaveLength(3);
  });

  it('does not repair the core after a player-death failure', () => {
    expect(applyWaveRestart(snapshot(), 'players_dead', 3000).coreHealth).toBe(2100);
    expect(coreHealthAfterRestart('players_dead', 2100, 3000)).toBe(2100);
  });

  it('returns the core to its wave-start health when the core itself was destroyed', () => {
    expect(applyWaveRestart({ ...snapshot(), coreHealth: 0 }, 'core_destroyed', 3000).coreHealth).toBe(3000);
  });
});

describe('difficulty multipliers (FR3 acceptance / FR5.2 / FR8.2)', () => {
  it('a basic zombie deals 10 core damage per second × the core multiplier', () => {
    const perSecond = basic.attackDamage / basic.attackInterval;
    expect(scaledCoreDamage(perSecond, standard)).toBe(10);
    expect(scaledCoreDamage(perSecond, easy)).toBeCloseTo(7, 10);
    expect(scaledCoreDamage(perSecond, hard)).toBeCloseTo(13, 10);
  });

  it('scales zombie health and player damage, but the boss uses its own health table', () => {
    expect(scaledZombieHealth(basic, easy, false)).toBeCloseTo(80, 10);
    expect(scaledZombieHealth(basic, hard, false)).toBeCloseTo(125, 10);
    expect(scaledZombieHealth(cfg.zombies.gargantuar_zombie!, hard, true)).toBe(6000);
    expect(scaledZombieHealth(cfg.zombies.gargantuar_zombie!, easy, true)).toBe(3000);
    expect(scaledPlayerDamage(40, hard)).toBeCloseTo(52, 10);
  });

  it('scales sun income by 1.2 / 1.0 / 0.8', () => {
    expect([easy, standard, hard].map((d) => scaledSunIncome(10, d))).toEqual([12, 10, 8]);
  });
});

describe('core damage stages (FR3.4 / FR3.5)', () => {
  it('maps health fractions to 4 damage stages and the low-health warning', () => {
    const stages = ch.core.damageStages;
    expect([5000, 3751, 3750, 2500, 1250, 1, 0].map((h) => coreDamageStage(h, 5000, stages))).toEqual([0, 0, 1, 2, 3, 3, 4]);
    expect(isCoreLow(2499, 5000, ch.core)).toBe(true);
    expect(isCoreLow(2500, 5000, ch.core)).toBe(false);
  });
});

describe('wave spawn rule (FR4.8)', () => {
  const core = { x: 0, y: 0, z: 0 };
  const player = { x: 0, y: 0, z: 20 };
  const rule = ch.spawnRule;

  it('allows a far spawn outside the view and away from the core direction', () => {
    expect(guardSpawnAllowed({ spawnPos: { x: 0, y: 0, z: 60 }, playerPos: player, corePos: core, inFrustum: false }, rule)).toBe(true);
  });

  it('rejects spawns inside the frustum or within 15 m of the player', () => {
    expect(guardSpawnAllowed({ spawnPos: { x: 0, y: 0, z: 60 }, playerPos: player, corePos: core, inFrustum: true }, rule)).toBe(false);
    expect(guardSpawnAllowed({ spawnPos: { x: 0, y: 0, z: 35 }, playerPos: player, corePos: core, inFrustum: false }, rule)).toBe(false);
    expect(guardSpawnAllowed({ spawnPos: { x: 0, y: 0, z: 35.5 }, playerPos: player, corePos: core, inFrustum: false }, rule)).toBe(true);
  });

  it('rejects spawns within 45° of the player→core direction', () => {
    // Player at z=20 looks toward the core at the origin (−Z). 40° off that line is rejected, 50° is fine.
    const at = (deg: number, d = 40) => ({ x: Math.sin((deg * Math.PI) / 180) * d, y: 0, z: 20 - Math.cos((deg * Math.PI) / 180) * d });
    expect(guardSpawnAllowed({ spawnPos: at(40), playerPos: player, corePos: core, inFrustum: false }, rule)).toBe(false);
    expect(guardSpawnAllowed({ spawnPos: at(50), playerPos: player, corePos: core, inFrustum: false }, rule)).toBe(true);
  });
});
