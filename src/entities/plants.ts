// Six plant facilities (7.8): 太阳花苗 / 豌豆射手 / 寒冰射手 / 坚果墙 / 炸弹花 / 藤蔓陷阱.
// Instanced rendering, physics colliders, nav blocking for nut walls, all updates via the TickManager.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PlantDef } from '../config/types';
import type { CommandBus } from '../core/commands';
import type { Vec3Like } from '../core/events';
import { store } from '../core/store';
import { applyHealthDamage, type DamageInfo, type DamageResult } from '../logic/attackable';
import { explosionDamage } from '../logic/damage';
import { createTicker, tickInterval, type IntervalTicker } from '../logic/economy';
import { dist3, distXZ } from '../logic/math';
import { createShooterState, stepShooter, type ShooterParams, type ShooterState } from '../logic/peashooterAI';
import type { PlantKind, TargetPlant } from '../logic/targeting';
import type { SavedPlant } from '../logic/save';
import type { NavGraph } from '../nav/graph';
import type { PhysicsWorld } from '../physics/world';
import { InstancePool } from '../render/instancing';
import type { Particles } from '../render/particles';
import { toonMaterial } from '../render/renderer';
import { TickManager } from './tickManager';
import type { PlantHandle } from './zombie';
import type { ZombieManager } from './zombieManager';

type PoolName = 'box' | 'cyl' | 'sphere';

interface PartDef {
  pool: PoolName;
  pos: [number, number, number];
  scale: [number, number, number];
  color: string;
  /** Turret parts rotate with the shooter's aim instead of the base yaw. */
  aim?: boolean;
}

const PARTS: Record<string, PartDef[]> = {
  sunflower_plant: [
    { pool: 'box', pos: [0, 0.15, 0], scale: [0.45, 0.3, 0.45], color: '#8d6e63' },
    { pool: 'cyl', pos: [0, 0.6, 0], scale: [0.06, 0.7, 0.06], color: '#558b2f' },
    { pool: 'sphere', pos: [0, 1.0, 0], scale: [0.42, 0.42, 0.14], color: '#fdd835' },
    { pool: 'sphere', pos: [0, 1.0, -0.06], scale: [0.2, 0.2, 0.1], color: '#6d4c41' },
  ],
  pea_shooter_plant: [
    { pool: 'cyl', pos: [0, 0.4, 0], scale: [0.08, 0.8, 0.08], color: '#558b2f' },
    { pool: 'sphere', pos: [0, 0.9, 0], scale: [0.32, 0.32, 0.32], color: '#7cb342', aim: true },
    { pool: 'cyl', pos: [0, 0.92, -0.32], scale: [0.11, 0.25, 0.11], color: '#689f38', aim: true },
    { pool: 'sphere', pos: [0, 0.05, 0], scale: [0.35, 0.08, 0.35], color: '#33691e' },
  ],
  ice_shooter_plant: [
    { pool: 'cyl', pos: [0, 0.4, 0], scale: [0.08, 0.8, 0.08], color: '#4fc3f7' },
    { pool: 'sphere', pos: [0, 0.9, 0], scale: [0.32, 0.32, 0.32], color: '#81d4fa', aim: true },
    { pool: 'cyl', pos: [0, 0.92, -0.32], scale: [0.11, 0.25, 0.11], color: '#29b6f6', aim: true },
    { pool: 'sphere', pos: [0, 0.05, 0], scale: [0.35, 0.08, 0.35], color: '#0277bd' },
  ],
  nut_wall: [
    { pool: 'box', pos: [0, 0.7, 0], scale: [1.6, 1.4, 0.6], color: '#a1887f' },
    { pool: 'sphere', pos: [-0.3, 1.0, -0.31], scale: [0.1, 0.12, 0.04], color: '#3e2723' },
    { pool: 'sphere', pos: [0.3, 1.0, -0.31], scale: [0.1, 0.12, 0.04], color: '#3e2723' },
  ],
  bomb_flower: [
    { pool: 'sphere', pos: [0, 0.35, 0], scale: [0.34, 0.34, 0.34], color: '#e53935' },
    { pool: 'cyl', pos: [0, 0.75, 0], scale: [0.03, 0.25, 0.03], color: '#212121' },
  ],
  vine_trap: [
    { pool: 'cyl', pos: [0, 0.03, 0], scale: [0.8, 0.06, 0.8], color: '#2e7d32' },
    { pool: 'box', pos: [0, 0.08, 0], scale: [1.1, 0.06, 0.12], color: '#43a047' },
    { pool: 'box', pos: [0, 0.08, 0], scale: [0.12, 0.06, 1.1], color: '#43a047' },
  ],
};

const KIND: Record<string, PlantKind> = {
  sunflower_plant: 'sunflower', pea_shooter_plant: 'shooter', ice_shooter_plant: 'shooter', nut_wall: 'wall',
  bomb_flower: 'temporary', vine_trap: 'temporary',
};

export class Plant implements PlantHandle {
  readonly team = 'plant' as const;
  health: number;
  alive = true;
  growT = 0;
  witherT = -1;
  shooter: ShooterState | null = null;
  sunTicker: IntervalTicker = createTicker();
  fuse = 0;
  despawnT = -1;
  triggered = new Set<string>();
  firedAt = new Map<string, number>();
  partIds: number[] = [];
  collider: RAPIER.Collider | null = null;

  constructor(readonly attackableId: string, readonly type: string, readonly def: PlantDef, readonly pos: Vec3Like, readonly yaw: number, health: number) {
    this.health = health;
    if (KIND[type] === 'shooter') this.shooter = createShooterState(yaw);
    this.fuse = def.fuseSeconds ?? 0;
  }

  get kind(): PlantKind {
    return KIND[this.type] ?? 'temporary';
  }

  position(): Vec3Like {
    return this.pos;
  }

  isAlive(): boolean {
    return this.alive;
  }

  applyDamage(amount: number, _info: DamageInfo): DamageResult {
    if (!this.alive) return { applied: 0, killed: false };
    const state = { health: this.health };
    const res = applyHealthDamage(state, amount);
    this.health = state.health;
    if (res.applied > 0) store.events.emit('plantHurt', { type: this.type, pos: this.pos });
    if (res.killed) this.alive = false;
    return res;
  }
}

export interface PlantManagerDeps {
  scene: THREE.Scene;
  phys: PhysicsWorld;
  nav: NavGraph;
  commands: CommandBus;
  zombies: ZombieManager;
  particles: Particles;
  hasLOS(a: Vec3Like, b: Vec3Like): boolean;
  onSun(amount: number, pos: Vec3Like): void;
}

export class PlantManager {
  readonly tick = new TickManager();
  readonly plants = new Map<string, Plant>();
  private pools: Record<PoolName, InstancePool>;
  private seq = 0;
  private time = 0;
  private readonly m = new THREE.Matrix4();

  constructor(private readonly d: PlantManagerDeps) {
    const mat = (): THREE.Material => toonMaterial('#ffffff');
    this.pools = {
      box: new InstancePool(new THREE.BoxGeometry(1, 1, 1), mat(), 160),
      cyl: new InstancePool(new THREE.CylinderGeometry(1, 1, 1, 12), mat(), 160),
      sphere: new InstancePool(new THREE.SphereGeometry(1, 14, 10), mat(), 160),
    };
    for (const p of Object.values(this.pools)) d.scene.add(p.mesh);
  }

  countOf(type: string): number {
    let n = 0;
    for (const p of this.plants.values()) if (p.type === type && p.alive) n++;
    return n;
  }

  get total(): number {
    return [...this.plants.values()].filter((p) => p.alive).length;
  }

  byId(id: string): Plant | undefined {
    return this.plants.get(id);
  }

  occupancy(): { pos: Vec3Like; radius: number }[] {
    return [...this.plants.values()].filter((p) => p.alive).map((p) => ({ pos: p.pos, radius: p.def.footprintRadius }));
  }

  positions(): Vec3Like[] {
    return [...this.plants.values()].filter((p) => p.alive).map((p) => p.pos);
  }

  targetPlants(zombieId: string): TargetPlant[] {
    const out: TargetPlant[] = [];
    for (const p of this.plants.values()) {
      if (!p.alive) continue;
      const fired = p.firedAt.get(zombieId);
      out.push({ id: p.attackableId, kind: p.kind, pos: p.pos, alive: true, attackingThisZombie: fired !== undefined && this.time - fired < 3 });
    }
    return out;
  }

  nutWallNear(pos: Vec3Like, radius: number): string | null {
    for (const p of this.plants.values()) {
      if (p.alive && p.type === 'nut_wall' && distXZ(p.pos, pos) <= radius + p.def.footprintRadius) return p.attackableId;
    }
    return null;
  }

  place(type: string, pos: Vec3Like, yaw: number, health?: number): Plant {
    const def = store.config.plants.plants[type];
    if (!def) throw new Error(`unknown plant type ${type}`);
    const plant = new Plant(`plant_${++this.seq}`, type, def, { ...pos }, yaw, health ?? def.health);
    this.plants.set(plant.attackableId, plant);
    for (const part of PARTS[type] ?? []) plant.partIds.push(this.pools[part.pool].acquire(part.color));
    this.addCollider(plant);
    if (def.isPhysicalBlocker) {
      // Nav break cost is a graph-wide value: priced against the director's default (basic) type.
      const z = store.config.zombies[store.config.game.spawnDirector.defaultZombieType]!;
      const breakCost = (def.health / ((z.attackDamageVsPlant[type] ?? z.attackDamage) / z.attackInterval)) * z.chaseSpeed * z.breakCostMultiplier;
      const affected = this.d.nav.blockNear(plant.attackableId, pos, def.footprintRadius + z.colliderRadius, breakCost);
      this.d.zombies.invalidatePaths(affected);
    }
    this.tick.add(plant.attackableId, (dt) => this.updatePlant(plant, dt));
    return plant;
  }

  private addCollider(p: Plant): void {
    if (p.type === 'vine_trap') return;
    const tag = { team: 'plant' as const, entityId: p.attackableId, material: p.type === 'nut_wall' ? ('wood' as const) : ('plant' as const) };
    if (p.type === 'nut_wall') {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.yaw, 0));
      p.collider = this.d.phys.addStaticBox({ x: p.pos.x, y: p.pos.y + 0.7, z: p.pos.z }, { x: 0.8, y: 0.7, z: 0.3 }, { x: q.x, y: q.y, z: q.z, w: q.w }, tag);
    } else {
      p.collider = this.d.phys.addStaticCylinder({ x: p.pos.x, y: p.pos.y + 0.55, z: p.pos.z }, 0.55, p.def.footprintRadius * 0.7, tag);
    }
  }

  private updatePlant(p: Plant, dt: number): void {
    p.growT = Math.min(1, p.growT + dt / store.config.plants.plantingRules.plantAnimationTime);
    if (p.witherT >= 0) {
      p.witherT += dt;
      if (p.witherT > 0.6) this.removeNow(p);
      return;
    }
    if (!p.alive) {
      this.destroy(p);
      return;
    }
    if (p.kind === 'sunflower') this.updateSunflower(p, dt);
    else if (p.shooter) this.updateShooter(p, dt);
    else if (p.type === 'bomb_flower') this.updateBomb(p, dt);
    else if (p.type === 'vine_trap') this.updateVine(p, dt);
  }

  private updateSunflower(p: Plant, dt: number): void {
    const amount = tickInterval(p.sunTicker, dt, p.def.sunTickInterval ?? 0.5, p.def.sunPerSecond ?? 0, true);
    if (amount > 0) {
      this.d.onSun(amount, p.pos);
      this.d.particles.emit('sun', { x: p.pos.x, y: p.pos.y + 1.3, z: p.pos.z }, 0.5);
    }
  }

  private updateShooter(p: Plant, dt: number): void {
    const def = p.def;
    const params: ShooterParams = {
      attackRange: def.attackRange ?? 15,
      attackDropRange: def.attackDropRange ?? (def.attackRange ?? 15) + 3,
      attackInterval: def.attackInterval ?? 1.5,
      turnSpeedDegPerSec: def.turnSpeedDegPerSec ?? 180,
      fireAngleToleranceDeg: def.fireAngleToleranceDeg ?? 8,
      targetEvalInterval: def.targetEvalInterval ?? 0.1,
    };
    const head = { x: p.pos.x, y: p.pos.y + 0.9, z: p.pos.z };
    const targets = this.d.zombies.zombies
      .filter((z) => z.isAlive() && dist3(z.pos, p.pos) <= params.attackDropRange + 1)
      .map((z) => ({ id: z.attackableId, pos: { x: z.pos.x, y: z.pos.y + 1.2, z: z.pos.z }, alive: z.isAlive() }));
    const firedAt = stepShooter(p.shooter!, { pos: head, targets, hasLineOfSight: this.d.hasLOS }, params, dt);
    if (!firedAt) return;
    const zombie = this.d.zombies.get(firedAt);
    if (!zombie) return;
    p.firedAt.set(firedAt, this.time);
    const ice = p.type === 'ice_shooter_plant' ? { percent: def.slowPercent ?? 0, duration: def.slowDuration ?? 0 } : null;
    this.d.commands.dispatch({ type: 'damage', target: zombie, amount: def.attackDamage ?? 0, info: { source: 'plant', byPlant: true, from: p.pos, slow: ice } });
    store.events.emit('plantFired', { pos: head, ice: ice !== null });
    this.d.zombies.noise('plantFire', p.pos);
    // Pea trail so the player can see the plant working (TR-PLT-02).
    const to = { x: zombie.pos.x, y: zombie.pos.y + 1.2, z: zombie.pos.z };
    for (let i = 1; i <= 6; i++) {
      const t = i / 7;
      this.d.particles.emit('muzzle', { x: head.x + (to.x - head.x) * t, y: head.y + (to.y - head.y) * t, z: head.z + (to.z - head.z) * t }, 0.3);
    }
    this.d.particles.emit(ice ? 'frost' : 'pea_juice', to, 0.6);
  }

  private updateBomb(p: Plant, dt: number): void {
    p.fuse -= dt;
    if (p.fuse > 0) return;
    const def = p.def;
    const radius = def.explosionRadius ?? 0;
    for (const z of this.d.zombies.zombies) {
      if (!z.isAlive()) continue;
      const dmg = explosionDamage(def.explosionDamageCenter ?? 0, def.explosionDamageEdge ?? 0, radius, distXZ(z.pos, p.pos));
      if (dmg > 0) this.d.commands.dispatch({ type: 'damage', target: z, amount: dmg, info: { source: 'explosion', byPlant: true, from: p.pos } });
    }
    store.events.emit('explosion', { pos: p.pos, radius });
    this.d.particles.emit('explosion', { x: p.pos.x, y: p.pos.y + 0.5, z: p.pos.z });
    this.d.zombies.noise('gunshot', p.pos);
    this.removeNow(p);
  }

  private updateVine(p: Plant, dt: number): void {
    if (p.despawnT >= 0) {
      p.despawnT -= dt;
      if (p.despawnT <= 0) this.removeNow(p);
      return;
    }
    const r = p.def.triggerRadius ?? 0.8;
    let fired = false;
    for (const z of this.d.zombies.zombies) {
      if (!z.isAlive() || p.triggered.has(z.attackableId) || distXZ(z.pos, p.pos) > r + z.def.colliderRadius) continue;
      // A pole vaulter in mid-vault sails over the vine (Revision 2); the trap stays armed.
      if (!z.root(p.def.rootDuration ?? 0)) continue;
      p.triggered.add(z.attackableId);
      fired = true;
    }
    if (fired) {
      p.despawnT = p.def.rootDuration ?? 0;
      store.events.emit('vineRoot', { pos: p.pos });
    }
  }

  private destroy(p: Plant): void {
    if (p.witherT >= 0) return;
    p.witherT = 0;
    this.releasePhysics(p);
    this.d.particles.emit(p.type === 'nut_wall' ? 'shell' : 'wither', { x: p.pos.x, y: p.pos.y + 0.6, z: p.pos.z }, 1.5);
    store.events.emit('plantDestroyed', { type: p.type, pos: p.pos });
  }

  /** Shovel (FR-INV-08/09): removed immediately, no refund. */
  shovel(id: string): boolean {
    const p = this.plants.get(id);
    if (!p || !p.alive) return false;
    p.alive = false;
    this.d.particles.emit('dirt', p.pos);
    store.events.emit('plantShoveled', { type: p.type, pos: p.pos });
    this.removeNow(p);
    return true;
  }

  private releasePhysics(p: Plant): void {
    if (p.collider) {
      this.d.phys.removeCollider(p.collider);
      p.collider = null;
    }
    if (p.def.isPhysicalBlocker) this.d.zombies.invalidatePaths(this.d.nav.unblock(p.attackableId));
  }

  private removeNow(p: Plant): void {
    p.alive = false;
    this.releasePhysics(p);
    const parts = PARTS[p.type] ?? [];
    p.partIds.forEach((id, i) => this.pools[parts[i]!.pool].release(id));
    p.partIds = [];
    this.plants.delete(p.attackableId);
    this.tick.remove(p.attackableId);
  }

  /** Plant whose footprint the ray point lies in (shovel targeting). */
  plantAt(pos: Vec3Like, slack = 0.4): Plant | null {
    let best: Plant | null = null;
    let bestD = Infinity;
    for (const p of this.plants.values()) {
      if (!p.alive) continue;
      const d = distXZ(p.pos, pos);
      if (d < p.def.footprintRadius + slack && d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  update(dt: number): void {
    this.time += dt;
    this.tick.update(dt);
  }

  render(): void {
    const q = new THREE.Quaternion();
    for (const p of this.plants.values()) {
      const parts = PARTS[p.type] ?? [];
      const grow = 0.2 + 0.8 * p.growT;
      const wither = p.witherT >= 0 ? Math.max(0, 1 - p.witherT / 0.6) : 1;
      const pulse = p.type === 'bomb_flower' ? 1 + Math.max(0, Math.sin(this.time * (12 - p.fuse * 3))) * 0.15 : 1;
      const s = grow * wither * pulse;
      const base = new THREE.Matrix4().compose(new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z), q.setFromEuler(new THREE.Euler(0, p.yaw, 0)), new THREE.Vector3(s, s, s));
      const aimed = new THREE.Matrix4().compose(new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.shooter?.yaw ?? p.yaw, 0)), new THREE.Vector3(s, s, s));
      parts.forEach((part, i) => {
        const local = new THREE.Matrix4().compose(new THREE.Vector3(...part.pos), new THREE.Quaternion(), new THREE.Vector3(...part.scale));
        this.m.multiplyMatrices(part.aim ? aimed : base, local);
        this.pools[part.pool].setMatrix(p.partIds[i]!, this.m);
      });
    }
  }

  serialize(): SavedPlant[] {
    return [...this.plants.values()]
      .filter((p) => p.alive && !p.def.isTemporary)
      .map((p) => ({ type: p.type, pos: [p.pos.x, p.pos.y, p.pos.z], yaw: p.yaw, health: p.health }));
  }

  clear(): void {
    for (const p of [...this.plants.values()]) this.removeNow(p);
    this.tick.clear();
  }
}
