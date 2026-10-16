// Owns all zombies: spawning, noise propagation, update, instanced rendering and debug labels (FR-AI-01, NFR1).
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3Like } from '../core/events';
import { store } from '../core/store';
import { hears, type NoiseKind } from '../logic/perception';
import { distXZ } from '../logic/math';
import { InstancePool } from '../render/instancing';
import { toonMaterial } from '../render/renderer';
import { Zombie, type ZombieWorld } from './zombie';

const CAPACITY = 64;
const WHITE = new THREE.Color('#ffffff');
const FROST = new THREE.Color('#81d4fa');
const ROOTED = new THREE.Color('#689f38');

interface PartSet {
  torso: number;
  head: number;
  armL: number;
  armR: number;
  legL: number;
  legR: number;
}

export class ZombieManager {
  readonly zombies: Zombie[] = [];
  private byId = new Map<string, Zombie>();
  private parts = new Map<string, PartSet>();
  private seq = 0;
  private readonly torso: InstancePool;
  private readonly head: InstancePool;
  private readonly arm: InstancePool;
  private readonly leg: InstancePool;
  private readonly spawnerOf = new Map<string, string | null>();
  private readonly m = new THREE.Matrix4();
  private readonly world: Omit<ZombieWorld, 'neighbors'>;

  constructor(scene: THREE.Scene, world: Omit<ZombieWorld, 'neighbors' | 'controller'>) {
    const controller: RAPIER.KinematicCharacterController = world.phys.createCharacterController(0.35, 50);
    this.world = { ...world, controller };
    const mk = (w: number, h: number, d: number): THREE.BoxGeometry => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(0, -h / 2, 0); // pivot at the top (shoulder / hip)
      return g;
    };
    this.torso = new InstancePool(new THREE.BoxGeometry(0.46, 0.62, 0.28), toonMaterial('#ffffff'), CAPACITY);
    this.head = new InstancePool(new THREE.BoxGeometry(0.32, 0.32, 0.32), toonMaterial('#ffffff'), CAPACITY);
    this.arm = new InstancePool(mk(0.13, 0.62, 0.13), toonMaterial('#ffffff'), CAPACITY * 2);
    this.leg = new InstancePool(mk(0.17, 0.85, 0.17), toonMaterial('#ffffff'), CAPACITY * 2);
    scene.add(this.torso.mesh, this.head.mesh, this.arm.mesh, this.leg.mesh);
  }

  get aliveCount(): number {
    return this.zombies.filter((z) => z.isAlive()).length;
  }

  aliveFromSpawner(spawnerId: string): number {
    let n = 0;
    for (const z of this.zombies) if (z.isAlive() && this.spawnerOf.get(z.attackableId) === spawnerId) n++;
    return n;
  }

  get(id: string): Zombie | undefined {
    return this.byId.get(id);
  }

  spawn(pos: Vec3Like, opts: { ambush: boolean; spawnerId: string | null; patrol: Vec3Like[] | null }): Zombie | null {
    if (this.zombies.length >= CAPACITY) return null;
    const def = store.config.zombies.basic_zombie;
    const id = `zombie_${++this.seq}`;
    const jitter = opts.ambush ? 0.8 : 2;
    const spawn = { x: pos.x + this.world.rng.range(-jitter, jitter), y: pos.y + 0.05, z: pos.z + this.world.rng.range(-jitter, jitter) };
    const z = new Zombie(id, def, spawn, pos, opts.ambush, opts.patrol, { ...this.world, neighbors: (self) => this.neighbors(self) });
    this.zombies.push(z);
    this.byId.set(id, z);
    this.spawnerOf.set(id, opts.spawnerId);
    const shirt = this.world.rng.pick(['#795548', '#5c6bc0', '#8d6e63', '#607d8b']);
    const skin = this.world.rng.pick(['#9ccc65', '#aed581', '#8bc34a']);
    this.parts.set(id, {
      torso: this.torso.acquire(shirt),
      head: this.head.acquire(skin),
      armL: this.arm.acquire(skin),
      armR: this.arm.acquire(skin),
      legL: this.leg.acquire('#4e342e'),
      legR: this.leg.acquire('#4e342e'),
    });
    return z;
  }

  private neighbors(self: Zombie): Zombie[] {
    const out: Zombie[] = [];
    for (const z of this.zombies) {
      if (z !== self && z.isAlive() && Math.abs(z.pos.x - self.pos.x) < 1.2 && Math.abs(z.pos.z - self.pos.z) < 1.2) out.push(z);
    }
    return out;
  }

  /** Hearing events wake zombies within the noise radius (FR-AI-04). */
  noise(kind: NoiseKind, pos: Vec3Like): void {
    const def = store.config.zombies.basic_zombie;
    for (const z of this.zombies) {
      if (z.isAlive() && hears(z.pos, { kind, pos }, def.hearingRadius)) z.aggro();
    }
  }

  /** Local path recompute after a nut wall changed the graph (TR-NAV-04). */
  invalidatePaths(edges: number[]): void {
    const set = new Set(edges);
    for (const z of this.zombies) z.invalidatePathIfUses(set);
  }

  update(dt: number): void {
    for (const z of this.zombies) z.update(dt);
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i]!;
      if (!z.removable) continue;
      this.remove(z);
      this.zombies.splice(i, 1);
    }
  }

  private remove(z: Zombie): void {
    const p = this.parts.get(z.attackableId);
    if (p) {
      this.torso.release(p.torso);
      this.head.release(p.head);
      this.arm.release(p.armL);
      this.arm.release(p.armR);
      this.leg.release(p.legL);
      this.leg.release(p.legR);
    }
    this.parts.delete(z.attackableId);
    this.byId.delete(z.attackableId);
    this.spawnerOf.delete(z.attackableId);
    z.dispose();
  }

  clear(): void {
    for (const z of this.zombies) this.remove(z);
    this.zombies.length = 0;
  }

  /** Procedural animation of the instanced body parts (walk, attack, break, hit, death). */
  render(alpha: number, camPos: THREE.Vector3): void {
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);
    for (const z of this.zombies) {
      const p = this.parts.get(z.attackableId);
      if (!p) continue;
      const x = z.prevPos.x + (z.pos.x - z.prevPos.x) * alpha;
      const y = z.prevPos.y + (z.pos.y - z.prevPos.y) * alpha;
      const zz = z.prevPos.z + (z.pos.z - z.prevPos.z) * alpha;
      if (camPos.distanceToSquared(new THREE.Vector3(x, y, zz)) > 200 * 200) {
        for (const [pool, id] of [[this.torso, p.torso], [this.head, p.head], [this.arm, p.armL], [this.arm, p.armR], [this.leg, p.legL], [this.leg, p.legR]] as const) {
          pool.setMatrix(id, this.m.makeScale(0, 0, 0));
        }
        continue;
      }
      const dead = z.state === 'DEAD';
      const fall = dead ? Math.min(1, z.deathTime * 2.5) : 0;
      const lean = z.state === 'HIT_REACT' ? -0.35 : z.state === 'ATTACK' || z.state === 'BREAK' ? 0.15 : 0.08;
      const root = new THREE.Matrix4().compose(
        new THREE.Vector3(x, y - fall * 0.2, zz),
        q.setFromEuler(e.set(-fall * (Math.PI / 2 - 0.1) + lean * (1 - fall), z.yaw, 0, 'YXZ')),
        one,
      );
      const swing = Math.sin(z.walkPhase) * Math.min(1, z.moveSpeed) * 0.7;
      const attacking = z.state === 'ATTACK' || z.state === 'BREAK';
      const armPitch = attacking ? -1.4 + Math.sin(performance.now() / 120) * 0.4 : -1.3 + swing * 0.2;
      const local = (px: number, py: number, pz: number, rx: number): THREE.Matrix4 =>
        new THREE.Matrix4().multiplyMatrices(root, new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), q.setFromEuler(e.set(rx, 0, 0)), one));
      this.torso.setMatrix(p.torso, local(0, 1.16, 0, 0));
      this.head.setMatrix(p.head, local(0, 1.64, -0.03, 0));
      this.arm.setMatrix(p.armL, local(-0.3, 1.42, 0, armPitch));
      this.arm.setMatrix(p.armR, local(0.3, 1.42, 0, armPitch + (attacking ? 0.5 : 0)));
      this.leg.setMatrix(p.legL, local(-0.11, 0.85, 0, swing));
      this.leg.setMatrix(p.legR, local(0.11, 0.85, 0, -swing));
      const tint = z.flash > 0 ? WHITE : z.rootTimer > 0 ? ROOTED : z.slowTimer > 0 ? FROST : null;
      const t = z.flash > 0 ? z.flash : tint ? 0.45 : 0;
      for (const [pool, id] of [[this.torso, p.torso], [this.head, p.head], [this.arm, p.armL], [this.arm, p.armR]] as const) pool.tint(id, tint, t);
    }
  }

  /** F4 labels: state names above heads, plus the BREAK icon (FR-AI-01, FR-AGG-08). */
  labels(camPos: Vec3Like, all: boolean): { pos: Vec3Like; text: string; kind: 'state' | 'break' }[] {
    const out: { pos: Vec3Like; text: string; kind: 'state' | 'break' }[] = [];
    for (const z of this.zombies) {
      if (distXZ(z.pos, camPos) > 40) continue;
      const pos = { x: z.pos.x, y: z.pos.y + 2.1, z: z.pos.z };
      if (all) out.push({ pos, text: z.state, kind: 'state' });
      else if (z.state === 'BREAK' || (z.state === 'ATTACK' && z.blockingWallId)) out.push({ pos, text: 'BREAK', kind: 'break' });
    }
    return out;
  }
}
