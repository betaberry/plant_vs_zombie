// Guard mode run (FR3, FR4, FR6, FR8.4): drives the pure wave engine from the session tick, spawns at the
// ring entrances through the existing spawn command, detects failure / victory and restarts the current wave.
// The session owns entities; this class only decides and dispatches.
import * as THREE from 'three';
import type { DifficultyDef, DifficultyId } from '../config/types';
import type { CommandBus } from '../core/commands';
import type { Vec3Like } from '../core/events';
import type { Rng } from '../core/rng';
import { store } from '../core/store';
import { applyWaveRestart, checkFailure, guardSpawnAllowed, type FailureReason, type GuardRunSnapshot } from '../logic/guardRules';
import { distXZ, pointInRect } from '../logic/math';
import { createWaveState, isLastWave, openEntranceCount, remainingZombies, restartWave, stepWave, waveZombieCount, type WaveState } from '../logic/waveDirector';
import { probeGround } from '../physics/raycast';
import type { PhysicsWorld } from '../physics/world';
import type { RingLayout } from '../world/ringLayout';
import type { CoreHouse } from '../entities/coreHouse';
import type { Player } from '../entities/player';
import type { ZombieManager } from '../entities/zombieManager';

export interface GuardRunDeps {
  ring: RingLayout;
  difficultyId: DifficultyId;
  core: CoreHouse;
  commands: CommandBus;
  zombies: ZombieManager;
  player: Player;
  rng: Rng;
  phys: PhysicsWorld;
  startWave: number;
  /** Called after a wave is cleared (save point, FR11.2). */
  onWaveCleared(): void;
}

interface PendingImp {
  to: Vec3Like;
  t: number;
}

const WALKABLE_CLEARANCE = 0.6;
const MAX_WALKABLE_Y = 1.0;

export class GuardRun {
  readonly difficulty: DifficultyDef;
  readonly state: WaveState;
  coreAtWaveStart: number;
  failure: FailureReason | null = null;
  victory = false;
  /** Seconds of play in this run (victory screen). */
  elapsed = 0;
  bossId: string | null = null;
  private startPressed = false;
  private pendingImps: PendingImp[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly m = new THREE.Matrix4();

  constructor(private readonly d: GuardRunDeps) {
    const cfg = store.config.challenge;
    this.difficulty = cfg.difficulties[d.difficultyId];
    this.state = createWaveState({ difficulty: this.difficulty, waves: cfg.waves, entranceCount: d.ring.entrances.length, rng: () => d.rng.next(), startWave: d.startWave });
    this.coreAtWaveStart = d.core.health;
  }

  get between(): boolean {
    return this.state.phase === 'intermission';
  }

  get totalWaves(): number {
    return this.difficulty.waves;
  }

  /** FR4.1: F starts the next wave early (ignored unless a countdown is running). */
  requestStart(): boolean {
    if (!this.between) return false;
    this.startPressed = true;
    return true;
  }

  openEntrances(): number {
    return openEntranceCount(this.difficulty, this.state.waves, this.state.wave, this.d.ring.entrances.length);
  }

  /** HUD: zombies of the current wave still to deal with (queued + alive + imps in flight). */
  remaining(): number {
    return remainingZombies(this.state, this.alive());
  }

  /** Count of the upcoming / current wave (boss not included). */
  waveSize(): number {
    return waveZombieCount(this.difficulty, this.state.wave);
  }

  isBossWave(): boolean {
    return isLastWave(this.state);
  }

  private alive(): number {
    return this.d.zombies.aliveCount + this.pendingImps.length;
  }

  update(dt: number, camera: THREE.PerspectiveCamera): void {
    if (this.victory || this.failure) return;
    this.elapsed += dt;
    const reason = checkFailure({ coreHealth: this.d.core.health, playersAlive: this.d.player.isAlive() ? 1 : 0 });
    const step = stepWave(this.state, { dt, startPressed: this.startPressed, alive: this.alive(), failed: reason !== null });
    this.startPressed = false;
    for (const e of step.events) this.onEvent(e, reason);
    if (step.spawns.length > 0) {
      camera.updateMatrixWorld();
      this.frustum.setFromProjectionMatrix(this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    }
    for (const s of step.spawns) {
      const pos = this.spawnPoint(s.entrance);
      this.d.commands.dispatch({ type: 'spawn', spawnerId: null, pos, ambush: false, zombieType: s.type, guardWave: { boss: s.boss } });
    }
    this.updateImps(dt);
  }

  private onEvent(e: string, reason: FailureReason | null): void {
    const total = this.totalWaves;
    if (e === 'wave_started') {
      this.coreAtWaveStart = this.d.core.health;
      store.events.emit('waveStarted', { wave: this.state.wave, total, boss: this.isBossWave() });
    } else if (e === 'wave_cleared') {
      const wave = this.state.phase === 'victory' ? this.state.wave : this.state.wave - 1;
      store.events.emit('waveCleared', { wave, total });
      if (this.state.phase !== 'victory') this.d.onWaveCleared();
    } else if (e === 'victory') {
      this.victory = true;
      store.events.emit('guardVictory', { difficulty: this.d.difficultyId, seconds: this.elapsed, coreHealth: this.d.core.health, coreMax: this.d.core.maxHealth });
    } else if (e === 'failed' && reason) {
      this.failure = reason;
      this.pendingImps = [];
      store.events.emit('guardFailed', { reason, wave: this.state.wave });
    }
  }

  /**
   * FR4.8: a spawn point of the chosen entrance that is outside the view, > 15 m from the player and not
   * in the player→core direction; else any open entrance's allowed point; else the entrance point farthest
   * from the player (spawn points sit outside the outer wall, so the wave never stalls).
   */
  private spawnPoint(entrance: number): Vec3Like {
    const ring = this.d.ring;
    const rule = store.config.challenge.spawnRule;
    const player = this.d.player.position();
    const allowed = (p: Vec3Like): boolean => guardSpawnAllowed({
      spawnPos: p, playerPos: player, corePos: ring.core.center,
      inFrustum: this.frustum.containsPoint(new THREE.Vector3(p.x, p.y + 1.2, p.z)),
    }, rule);
    const own = ring.entrances[entrance] ?? ring.entrances[0]!;
    const pick = (list: Vec3Like[]): Vec3Like | null => {
      const ok = list.filter(allowed);
      return ok.length > 0 ? ok[Math.floor(this.d.rng.next() * ok.length)]! : null;
    };
    const first = pick(own.spawnPoints);
    if (first) return first;
    const open = ring.entrances.slice(0, this.openEntrances()).flatMap((e) => e.spawnPoints);
    const second = pick(open);
    if (second) return second;
    return own.spawnPoints.reduce((best, p) => (distXZ(p, player) > distXZ(best, player) ? p : best), own.spawnPoints[0]!);
  }

  /** FR8.4: the imp lands after its flight time and joins the wave. */
  throwImp(to: Vec3Like): void {
    const def = store.config.zombies[store.config.challenge.waves.bossType]?.abilities?.throwImp;
    this.pendingImps.push({ to: { ...to }, t: def?.flightTime ?? 1 });
  }

  private updateImps(dt: number): void {
    const def = store.config.zombies[store.config.challenge.waves.bossType]?.abilities?.throwImp;
    if (!def) return;
    for (let i = this.pendingImps.length - 1; i >= 0; i--) {
      const imp = this.pendingImps[i]!;
      imp.t -= dt;
      if (imp.t > 0) continue;
      this.pendingImps.splice(i, 1);
      this.d.commands.dispatch({ type: 'spawn', spawnerId: null, pos: imp.to, ambush: false, zombieType: def.impType, guardWave: { boss: false }, jitter: 0 });
    }
  }

  /** Free, flat ground on the lane level: not inside any wall / the core, with ground under it. */
  isWalkable(p: Vec3Like): boolean {
    const ring = this.d.ring;
    const c = WALKABLE_CLEARANCE;
    const half = store.config.maps.ring_01.size[0] / 2 - 2;
    if (Math.abs(p.x) > half || Math.abs(p.z) > half) return false;
    const grown = (r: { minX: number; minZ: number; maxX: number; maxZ: number }) => ({ minX: r.minX - c, minZ: r.minZ - c, maxX: r.maxX + c, maxZ: r.maxZ + c });
    if (ring.obstacles.some((o) => pointInRect(p.x, p.z, grown(o)))) return false;
    const g = probeGround(this.d.phys, p.x, p.z, p.y + 1.5, 3);
    return g !== null && g.normal.y > 0.8 && g.point.y < MAX_WALKABLE_Y;
  }

  /**
   * FR6.3–6.5: restart the current wave. Plants, sun, upgrades, potion and items stay (the session keeps
   * them untouched); zombies of the wave and imps in flight are cleared; core health per FR6.5.
   */
  restart<P>(snapshot: GuardRunSnapshot<P>): GuardRunSnapshot<P> {
    const reason = this.failure ?? 'players_dead';
    const after = applyWaveRestart(snapshot, reason, this.coreAtWaveStart);
    this.d.zombies.clear();
    this.pendingImps = [];
    this.bossId = null;
    this.d.core.setHealth(after.coreHealth);
    restartWave(this.state);
    this.failure = null;
    return after;
  }
}
