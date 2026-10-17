// Wave engine (FR4, FR5.3, FR8.1): counts, entrance curve, F / countdown, clear + victory, boss, pacing.
import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';
import {
  createWaveState,
  openEntranceCount,
  restartWave,
  spawnInterval,
  stepWave,
  unlockedTypes,
  waveZombieCount,
  type WaveSpawn,
  type WaveState,
} from '../../src/logic/waveDirector';
import type { DifficultyId } from '../../src/config/types';
import { config } from './helpers';

const ch = config().challenge;
const diff = (id: DifficultyId) => ch.difficulties[id];
const make = (id: DifficultyId, startWave = 1): WaveState =>
  createWaveState({ difficulty: diff(id), waves: ch.waves, entranceCount: 4, rng: createRng(7).next, startWave });
const idle = { dt: 0.1, startPressed: false, alive: 0, failed: false };

/** Runs the current wave to completion: spawns everything (killing nothing until the queue is empty), then kills all. */
function playWave(s: WaveState, keepAlive = 0): { spawns: WaveSpawn[]; events: string[] } {
  const spawns: WaveSpawn[] = [];
  const events: string[] = [];
  let alive = 0;
  const first = stepWave(s, { ...idle, startPressed: true, alive });
  spawns.push(...first.spawns);
  events.push(...first.events);
  alive += first.spawns.length;
  for (let i = 0; i < 10000 && s.phase === 'active'; i++) {
    const done = s.queue.length === 0;
    if (done) alive = Math.min(alive, keepAlive);
    const r = stepWave(s, { ...idle, dt: 0.5, alive });
    spawns.push(...r.spawns);
    events.push(...r.events);
    alive += r.spawns.length;
    if (done && keepAlive > 0) break;
  }
  return { spawns, events };
}

describe('wave sizes per difficulty (FR4.2 / FR5.1)', () => {
  it('counts first + (wave − 1) × increment for every difficulty', () => {
    expect([1, 2, 5].map((w) => waveZombieCount(diff('easy'), w))).toEqual([4, 6, 12]);
    expect([1, 2, 8].map((w) => waveZombieCount(diff('standard'), w))).toEqual([6, 9, 27]);
    expect([1, 2, 11].map((w) => waveZombieCount(diff('hard'), w))).toEqual([8, 11, 38]);
    expect([diff('easy').waves, diff('standard').waves, diff('hard').waves]).toEqual([5, 8, 12]);
  });

  it('caps a wave at its difficulty cap (hard wave 12 would be 41 → 40)', () => {
    expect(waveZombieCount(diff('hard'), 12)).toBe(40);
    expect(waveZombieCount(diff('easy'), 9)).toBe(16);
  });
});

describe('entrances and pacing (FR4.4 / FR4.5)', () => {
  it('opens 1/1/2/2/3/3/4 entrances, limited by the difficulty cap', () => {
    const hard = [1, 2, 3, 4, 5, 6, 7, 12].map((w) => openEntranceCount(diff('hard'), ch.waves, w, 4));
    expect(hard).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(openEntranceCount(diff('standard'), ch.waves, 8, 4)).toBe(3);
    expect(openEntranceCount(diff('easy'), ch.waves, 5, 4)).toBe(2);
    // A map with fewer entrances caps it too.
    expect(openEntranceCount(diff('hard'), ch.waves, 9, 2)).toBe(2);
  });

  it('multiplies the spawn interval by 0.9 per wave, never below the minimum', () => {
    expect(spawnInterval(ch.waves, 2) / spawnInterval(ch.waves, 1)).toBeCloseTo(0.9, 10);
    expect(spawnInterval(ch.waves, 4)).toBeCloseTo(ch.waves.spawnIntervalBase * 0.9 ** 3, 10);
    expect(spawnInterval(ch.waves, 100)).toBe(ch.waves.spawnIntervalMin);
  });

  it('introduces types in order and only uses open entrances', () => {
    expect(unlockedTypes(ch.waves, 1).map((t) => t.type)).toEqual(['basic_zombie']);
    expect(unlockedTypes(ch.waves, 3).map((t) => t.type)).toEqual(['basic_zombie', 'conehead_zombie', 'buckethead_zombie']);
    const s = make('hard', 3);
    const { spawns } = playWave(s);
    expect(spawns.every((x) => x.entrance >= 0 && x.entrance < 2)).toBe(true);
    expect(spawns.every((x) => ['basic_zombie', 'conehead_zombie', 'buckethead_zombie'].includes(x.type))).toBe(true);
  });
});

describe('starting a wave (FR4.1)', () => {
  it('starts immediately on F and spawns the first zombie the same tick', () => {
    const s = make('standard');
    expect(s.phase).toBe('intermission');
    const r = stepWave(s, { ...idle, startPressed: true });
    expect(r.events).toEqual(['wave_started']);
    expect(s.phase).toBe('active');
    expect(r.spawns).toHaveLength(1);
  });

  it('starts automatically when the 30 s countdown runs out, not a tick earlier', () => {
    const s = make('standard');
    expect(stepWave(s, { ...idle, dt: 29.9 }).events).toEqual([]);
    expect(s.phase).toBe('intermission');
    expect(s.countdown).toBeCloseTo(0.1, 6);
    expect(stepWave(s, { ...idle, dt: 0.1 }).events).toEqual(['wave_started']);
  });
});

describe('clearing and victory (FR4.6 / FR8.1)', () => {
  it('clears a wave only when every zombie was spawned and none is alive, then counts down again', () => {
    const s = make('easy');
    const { spawns, events } = playWave(s, 1);
    expect(spawns).toHaveLength(4);
    expect(events).not.toContain('wave_cleared');
    expect(s.phase).toBe('active');
    const r = stepWave(s, { ...idle, alive: 0 });
    expect(r.events).toEqual(['wave_cleared']);
    expect(s.wave).toBe(2);
    expect(s.phase).toBe('intermission');
    expect(s.countdown).toBe(30);
  });

  it('adds the boss once, only to the last wave, and the last clear is the victory', () => {
    const s = make('easy');
    for (let w = 1; w < 5; w++) {
      const { spawns } = playWave(s);
      expect(spawns.some((x) => x.boss || x.type === 'gargantuar_zombie'), `wave ${w}`).toBe(false);
    }
    expect(s.wave).toBe(5);
    const last = playWave(s, 1);
    const bosses = last.spawns.filter((x) => x.boss);
    expect(bosses).toHaveLength(1);
    expect(bosses[0]!.type).toBe('gargantuar_zombie');
    expect(last.spawns).toHaveLength(waveZombieCount(diff('easy'), 5) + 1);
    // The boss (still alive) blocks the clear.
    expect(stepWave(s, { ...idle, alive: 1 }).events).toEqual([]);
    expect(stepWave(s, { ...idle, alive: 0 }).events).toEqual(['wave_cleared', 'victory']);
    expect(s.phase).toBe('victory');
  });

  it('holds spawns back at the 40 alive cap without dropping them', () => {
    const s = make('hard', 12);
    stepWave(s, { ...idle, startPressed: true, alive: 0 });
    const before = s.queue.length;
    const r = stepWave(s, { ...idle, dt: 10, alive: 40 });
    expect(r.spawns).toHaveLength(0);
    expect(s.queue.length).toBe(before);
  });

  it('stops on failure and restarts the same wave from its countdown', () => {
    const s = make('standard', 4);
    stepWave(s, { ...idle, startPressed: true });
    expect(stepWave(s, { ...idle, failed: true }).events).toEqual(['failed']);
    expect(s.phase).toBe('failed');
    expect(stepWave(s, { ...idle, startPressed: true }).spawns).toHaveLength(0);
    restartWave(s);
    expect([s.wave, s.phase, s.countdown, s.queue.length]).toEqual([4, 'intermission', 30, 0]);
  });
});
