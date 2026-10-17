// Guard mode wave engine (FR4, FR5.2/5.3, FR8.1). Pure: no Three.js / Rapier / DOM.
// createWaveState + stepWave, same shape as the other director-style modules. The session feeds in time,
// the F key, how many zombies of the current wave are still alive and failure events, and spawns what
// stepWave returns (it decides type + entrance only; spawn positions come from the entrance's spawn group).
import type { ChallengeConfig, DifficultyDef } from '../config/types';

export type WaveConfig = ChallengeConfig['waves'];

const COUNTDOWN_EPSILON = 1e-9;

/**
 * intermission: countdown before `wave` starts (F starts it early) · active: `wave` is running ·
 * failed: waiting for restartWave · victory: the last wave was cleared.
 */
export type WavePhase = 'intermission' | 'active' | 'failed' | 'victory';

export interface WaveSpawn {
  type: string;
  /** Index into the ring map's entrance list. */
  entrance: number;
  boss: boolean;
}

export interface WaveState {
  readonly difficulty: DifficultyDef;
  readonly waves: WaveConfig;
  readonly entranceCount: number;
  readonly rng: () => number;
  /** 1-based; during intermission this is the wave about to start. */
  wave: number;
  phase: WavePhase;
  countdown: number;
  queue: WaveSpawn[];
  spawnTimer: number;
  /** Zombies of the current wave spawned so far (boss included). */
  spawned: number;
  bossSpawned: boolean;
}

export interface WaveInput {
  dt: number;
  /** F pressed this tick (only meaningful between waves). */
  startPressed: boolean;
  /** Living zombies that belong to the current wave (boss and thrown imps included). */
  alive: number;
  /** A failure (core destroyed / all players dead) happened this tick. */
  failed: boolean;
}

export type WaveEvent = 'wave_started' | 'wave_cleared' | 'victory' | 'failed';

export interface WaveStep {
  spawns: WaveSpawn[];
  events: WaveEvent[];
}

export interface WaveOptions {
  difficulty: DifficultyDef;
  waves: WaveConfig;
  entranceCount: number;
  rng: () => number;
  /** Resume from a saved wave (FR11.3); default 1. */
  startWave?: number;
}

export function createWaveState(o: WaveOptions): WaveState {
  const wave = Math.min(Math.max(1, Math.floor(o.startWave ?? 1)), o.difficulty.waves);
  return {
    difficulty: o.difficulty, waves: o.waves, entranceCount: o.entranceCount, rng: o.rng,
    wave, phase: 'intermission', countdown: o.difficulty.countdownSeconds, queue: [], spawnTimer: 0, spawned: 0, bossSpawned: false,
  };
}

/** FR4.2: first + (wave − 1) × increment, capped at the difficulty's per-wave cap (boss not included). */
export function waveZombieCount(d: DifficultyDef, wave: number): number {
  return Math.min(d.waveCap, d.firstWaveCount + (wave - 1) * d.waveIncrement);
}

/** FR4.5: open entrances from the curve, limited by the difficulty cap and the map's entrance count. */
export function openEntranceCount(d: DifficultyDef, waves: WaveConfig, wave: number, entranceCount: number): number {
  let open = 1;
  for (const step of waves.entranceCurve) if (wave >= step.fromWave) open = step.open;
  return Math.max(1, Math.min(open, d.entranceCap, entranceCount));
}

/** FR4.4: spawn interval inside a wave, × factor per wave, never below the configured minimum. */
export function spawnInterval(waves: WaveConfig, wave: number): number {
  return Math.max(waves.spawnIntervalMin, waves.spawnIntervalBase * waves.spawnIntervalFactor ** (wave - 1));
}

/** FR4.3: types unlocked by this wave, with their weights. */
export function unlockedTypes(waves: WaveConfig, wave: number): { type: string; weight: number }[] {
  return waves.typeUnlocks.filter((u) => wave >= u.fromWave).map((u) => ({ type: u.type, weight: u.weight }));
}

function pickWeighted(list: { type: string; weight: number }[], roll: number): string {
  const total = list.reduce((s, x) => s + x.weight, 0);
  let acc = 0;
  for (const x of list) {
    acc += x.weight;
    if (roll * total < acc) return x.type;
  }
  return list[list.length - 1]!.type;
}

export function isLastWave(state: WaveState): boolean {
  return state.wave >= state.difficulty.waves;
}

/** The spawn roster of a wave: weighted types over the open entrances; the boss joins the last wave once (FR8.1). */
export function buildWaveRoster(state: WaveState): WaveSpawn[] {
  const types = unlockedTypes(state.waves, state.wave);
  const open = openEntranceCount(state.difficulty, state.waves, state.wave, state.entranceCount);
  const roster: WaveSpawn[] = [];
  const count = waveZombieCount(state.difficulty, state.wave);
  for (let i = 0; i < count; i++) {
    roster.push({ type: pickWeighted(types, state.rng()), entrance: Math.min(open - 1, Math.floor(state.rng() * open)), boss: false });
  }
  if (isLastWave(state)) {
    // Boss arrives mid-wave together with the others.
    const boss: WaveSpawn = { type: state.waves.bossType, entrance: Math.min(open - 1, Math.floor(state.rng() * open)), boss: true };
    roster.splice(Math.floor(roster.length / 2), 0, boss);
  }
  return roster;
}

function startWave(state: WaveState): void {
  state.phase = 'active';
  state.queue = buildWaveRoster(state);
  state.spawnTimer = 0;
  state.spawned = 0;
  state.bossSpawned = false;
}

function stepActive(state: WaveState, input: WaveInput, out: WaveStep): void {
  state.spawnTimer -= input.dt;
  let alive = input.alive;
  // One spawn per interval; the alive cap (FR5.3) holds the queue back without dropping anything.
  if (state.queue.length > 0 && state.spawnTimer <= 0 && alive < state.waves.maxAlive) {
    const s = state.queue.shift()!;
    out.spawns.push(s);
    state.spawned++;
    if (s.boss) state.bossSpawned = true;
    alive++;
    state.spawnTimer = spawnInterval(state.waves, state.wave);
  }
  // FR4.6: cleared once everything was spawned and nothing of this wave is alive.
  if (state.queue.length === 0 && alive === 0 && out.spawns.length === 0) {
    if (isLastWave(state)) {
      state.phase = 'victory';
      out.events.push('wave_cleared', 'victory');
      return;
    }
    state.wave++;
    state.phase = 'intermission';
    state.countdown = state.difficulty.countdownSeconds;
    out.events.push('wave_cleared');
  }
}

export function stepWave(state: WaveState, input: WaveInput): WaveStep {
  const out: WaveStep = { spawns: [], events: [] };
  if (state.phase === 'victory' || state.phase === 'failed') return out;
  if (input.failed) {
    state.phase = 'failed';
    state.queue = [];
    out.events.push('failed');
    return out;
  }
  if (state.phase === 'intermission') {
    // Epsilon: accumulated float dt (e.g. 29.9 + 0.1) must not leave a 1e-15 s remainder.
    state.countdown = state.countdown - input.dt <= COUNTDOWN_EPSILON ? 0 : state.countdown - input.dt;
    if (!input.startPressed && state.countdown > 0) return out;
    startWave(state);
    out.events.push('wave_started');
  }
  stepActive(state, input, out);
  return out;
}

/** FR6.3: after a failure the same wave restarts from its countdown (wave number and difficulty unchanged). */
export function restartWave(state: WaveState): void {
  state.phase = 'intermission';
  state.countdown = state.difficulty.countdownSeconds;
  state.queue = [];
  state.spawnTimer = 0;
  state.spawned = 0;
  state.bossSpawned = false;
}

/** HUD (FR4.7): zombies of the current wave still to deal with (queued + alive). */
export function remainingZombies(state: WaveState, alive: number): number {
  return state.phase === 'active' ? state.queue.length + alive : 0;
}
