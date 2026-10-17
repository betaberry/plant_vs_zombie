// Owns all zombies: spawning, noise propagation, update, instanced rendering and debug labels (FR-AI-01, NFR1).
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3Like } from '../core/events';
import { store } from '../core/store';
import { hears, type NoiseKind } from '../logic/perception';
import { angleDiff, distXZ, yawTo } from '../logic/math';
import { defaultInput, ZombiePoseAnimator, type PoseInput, type PoseStyle } from '../logic/zombiePose';
import { DroppedProps } from '../render/droppedProps';
import type { AccessoryPart } from '../render/zombieGeometry';
import { accessoryParts, rollZombieLook, ZombieRig, type RigInstance } from '../render/zombieRig';
import { Zombie, type ZombieWorld } from './zombie';

const CAPACITY = 64;
const WHITE = new THREE.Color('#ffffff');
const FROST = new THREE.Color('#81d4fa');
const ROOTED = new THREE.Color('#689f38');
/** Head armour hides the hair spikes that would poke through it. */
const HEAD_ARMOR = new Set(['cone', 'bucket', 'helmet']);
/** Below this armour fraction the cone is swapped for its dented twin. */
const CONE_DENT_FRACTION = 0.5;

interface ZombieVisual {
  rig: RigInstance;
  anim: ZombiePoseAnimator;
  input: PoseInput;
  written: boolean;
  /** Pole vaulter still holds the pole (dropped as a prop after landing). */
  hasPole: boolean;
}

export interface ZombieLabel {
  pos: Vec3Like;
  /** Gameplay state id (F4 shows it with the type name). */
  text: string;
  typeName: string;
  kind: 'state' | 'break';
}

export class ZombieManager {
  readonly zombies: Zombie[] = [];
  private byId = new Map<string, Zombie>();
  private visuals = new Map<string, ZombieVisual>();
  private seq = 0;
  private readonly rig: ZombieRig;
  private readonly spawnerOf = new Map<string, string | null>();
  private readonly world: Omit<ZombieWorld, 'neighbors'>;

  private readonly props: DroppedProps;
  private readonly unsubscribe: () => void;

  constructor(scene: THREE.Scene, world: Omit<ZombieWorld, 'neighbors' | 'controller'>) {
    const controller: RAPIER.KinematicCharacterController = world.phys.createCharacterController(0.35, 50);
    this.world = { ...world, controller };
    const vis = store.config.game.zombieVisual;
    this.rig = new ZombieRig(scene, vis, CAPACITY);
    this.props = new DroppedProps(this.rig, vis.droppedProps);
    this.unsubscribe = store.events.on('armorBroken', (e) => this.dropArmor(e.zombieId, e.dropProp, e.metal));
  }

  get aliveCount(): number {
    return this.zombies.filter((z) => z.isAlive()).length;
  }

  /** Zombie draw calls in the main pass (constant: one per rig part type, accessories and dropped props included). */
  get drawCalls(): number {
    return this.rig.drawCalls;
  }

  /** Dropped armour props currently tumbling / resting / fading. */
  get droppedPropCount(): number {
    return this.props.count;
  }

  aliveFromSpawner(spawnerId: string): number {
    let n = 0;
    for (const z of this.zombies) if (z.isAlive() && this.spawnerOf.get(z.attackableId) === spawnerId) n++;
    return n;
  }

  get(id: string): Zombie | undefined {
    return this.byId.get(id);
  }

  /** Living zombies per type id (spawn director per-type caps, Revision 2). */
  aliveByType(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const z of this.zombies) if (z.isAlive()) out[z.typeId] = (out[z.typeId] ?? 0) + 1;
    return out;
  }

  /** `jitter` overrides the random spawn offset (0 = exactly at `pos`, e.g. a thrown imp's checked landing point). */
  spawn(pos: Vec3Like, opts: { ambush: boolean; spawnerId: string | null; patrol: Vec3Like[] | null; typeId?: string; jitter?: number }): Zombie | null {
    if (this.zombies.length >= CAPACITY) return null;
    const zombies = store.config.zombies;
    const def = zombies[opts.typeId ?? ''] ?? zombies[store.config.game.spawnDirector.defaultZombieType]!;
    const id = `zombie_${++this.seq}`;
    const jitter = opts.jitter ?? (opts.ambush ? 0.8 : 2);
    const spawn = { x: pos.x + this.world.rng.range(-jitter, jitter), y: pos.y + 0.05, z: pos.z + this.world.rng.range(-jitter, jitter) };
    const z = new Zombie(id, def, spawn, pos, opts.ambush, opts.patrol, { ...this.world, neighbors: (self) => this.neighbors(self) });
    // Two draws from the seeded world PRNG (same count as the old shirt/skin picks) seed the look.
    const seed = ((Math.floor(this.world.rng.next() * 0x10000) << 16) | Math.floor(this.world.rng.next() * 0x10000)) >>> 0;
    const vis = store.config.game.zombieVisual;
    const look = rollZombieLook(seed, vis, def.visual);
    const rig = this.rig.acquire(look);
    if (!rig) {
      z.dispose();
      return null;
    }
    const anim = new ZombiePoseAnimator(vis.animation, vis.proportions,
      { attackWindup: def.attackWindup, attackRecover: def.attackRecover, hitReactDuration: def.hitReactDuration }, look.traits, z.state);
    this.zombies.push(z);
    this.byId.set(id, z);
    this.spawnerOf.set(id, opts.spawnerId);
    this.visuals.set(id, { rig, anim, input: defaultInput(z.state), written: false, hasPole: look.accessories.includes('pole') });
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
    for (const z of this.zombies) {
      if (z.isAlive() && hears(z.pos, { kind, pos }, z.def.hearingRadius)) z.aggro();
    }
  }

  /** Local path recompute after a nut wall changed the graph (TR-NAV-04). */
  invalidatePaths(edges: number[]): void {
    const set = new Set(edges);
    for (const z of this.zombies) z.invalidatePathIfUses(set);
  }

  update(dt: number): void {
    for (const z of this.zombies) z.update(dt);
    this.props.update(dt);
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i]!;
      if (!z.removable) continue;
      this.remove(z);
      this.zombies.splice(i, 1);
    }
  }

  private remove(z: Zombie): void {
    const v = this.visuals.get(z.attackableId);
    if (v) this.rig.release(v.rig);
    this.visuals.delete(z.attackableId);
    this.byId.delete(z.attackableId);
    this.spawnerOf.delete(z.attackableId);
    z.dispose();
  }

  clear(): void {
    for (const z of this.zombies) this.remove(z);
    this.zombies.length = 0;
    this.props.clear();
  }

  dispose(): void {
    this.clear();
    this.unsubscribe();
  }

  /** Armour broke: the worn part (cone / dented cone, bucket, door, helmet) tumbles off as a pooled prop. */
  private dropArmor(zombieId: string, dropProp: string | null, metal: boolean): void {
    const z = this.byId.get(zombieId);
    const v = this.visuals.get(zombieId);
    if (!z || !v || !v.written || !dropProp) return;
    const parts = accessoryParts(dropProp as Parameters<typeof accessoryParts>[0]) as AccessoryPart[];
    const part = parts.find((p) => v.rig.accShown.has(p)) ?? parts[0];
    const world = part ? v.rig.accWorld[part] : undefined;
    if (part && world) this.props.spawn(part, world, z.pos.y, z.yaw, metal);
  }

  /** Per-frame accessory visibility: armour intact, cone dent, pole carried; hair hidden under head armour. */
  private syncAccessories(z: Zombie, v: ZombieVisual): void {
    const armorParts: readonly string[] = z.def.armor?.parts ?? [];
    const intact = z.armorIntact();
    const vault = z.abilities.vault;
    const dented = z.armorFraction() < CONE_DENT_FRACTION;
    for (const a of v.rig.look.accessories) {
      let shown = armorParts.includes(a) ? intact : true;
      if (a === 'pole') shown = vault?.phase !== 'done';
      // Guard mode: the imp leaves the gargantuar's back when it is thrown (FR8.4).
      if (a === 'impRider') shown = z.impCarried;
      for (const part of accessoryParts(a)) {
        const variant = a !== 'cone' || (part === 'coneDented') === dented;
        this.rig.setAccessoryShown(v.rig, part, shown && variant);
      }
    }
    v.rig.hairShown = !(intact && armorParts.some((p) => HEAD_ARMOR.has(p)));
    if (v.hasPole && vault?.phase === 'done' && v.written) {
      v.hasPole = false;
      const world = v.rig.accWorld.pole;
      if (world) this.props.spawn('pole', world, z.pos.y, z.yaw, false);
    }
  }

  /** Body style for the animator from the type and the props it still holds. */
  private poseStyle(z: Zombie): PoseStyle {
    switch (z.def.visual.poseStyle) {
      case 'newspaper': return z.armorIntact() ? 'newspaper' : z.abilities.rage?.phase === 'raged' ? 'raged' : 'normal';
      case 'screendoor': return z.armorIntact() ? 'screendoor' : 'normal';
      case 'football': return z.charging ? 'charge' : 'normal';
      case 'pole': return z.abilities.vault?.phase === 'carrying' ? 'pole' : 'normal';
      case 'gargantuar': return 'heavy';
      case 'imp': return 'imp';
      default: return 'normal';
    }
  }

  /**
   * Procedural animation (Step 24): gameplay state → ZombiePoseAnimator → instanced rig matrices.
   * LOD (FR-AI-20): beyond lodMidDistance a simplified pose, beyond lodFarDistance living zombies
   * keep their last pose (frozen), beyond cullDistance they are hidden.
   */
  render(alpha: number, camPos: THREE.Vector3, frameDt: number): void {
    const cull = store.config.game.zombieVisual.cullDistance;
    const playerPos = this.world.player.position();
    for (const z of this.zombies) {
      const v = this.visuals.get(z.attackableId);
      if (!v) continue;
      const x = z.prevPos.x + (z.pos.x - z.prevPos.x) * alpha;
      const y = z.prevPos.y + (z.pos.y - z.prevPos.y) * alpha;
      const zz = z.prevPos.z + (z.pos.z - z.prevPos.z) * alpha;
      const dist = Math.hypot(x - camPos.x, y - camPos.y, zz - camPos.z);
      if (dist > cull) {
        this.rig.hide(v.rig);
        v.written = false;
        continue;
      }
      const frozen = z.isAlive() && dist > z.def.lodFarDistance && v.written;
      if (!frozen) {
        this.syncAccessories(z, v);
        const pose = v.anim.update(this.poseInput(z, v.input, playerPos, dist > z.def.lodMidDistance), frameDt);
        this.rig.write(v.rig, x, y, zz, z.yaw, pose);
        v.written = true;
      }
      const tint = z.flash > 0 ? WHITE : z.rootTimer > 0 ? ROOTED : z.slowTimer > 0 ? FROST : null;
      this.rig.tint(v.rig, tint, z.flash > 0 ? z.flash : tint ? 0.45 : 0);
    }
  }

  private poseInput(z: Zombie, input: PoseInput, playerPos: Vec3Like, simple: boolean): PoseInput {
    input.state = z.state;
    // Stride cadence is per rig unit: a ×2 gargantuar takes half as many steps, a ×0.6 imp scurries.
    input.moveSpeed = z.moveSpeed / (z.def.visual.bodyScale ?? 1);
    input.throwClock = z.throwClock;
    input.slowFactor = z.slowTimer > 0 ? 1 - z.slowPercent / 100 : 1;
    input.rooted = z.rootTimer > 0;
    const tracking = (z.state === 'ALERT' || z.state === 'CHASE' || z.state === 'ATTACK') && !z.currentPlantId;
    input.lookYaw = tracking ? angleDiff(z.yaw, yawTo(z.pos, playerPos)) : 0;
    input.attackClock = z.attackClock();
    input.hitCount = z.hitCount;
    input.hitSide = z.lastHitSide;
    input.hitHead = z.lastHitHead;
    input.detail = simple ? 'simple' : 'full';
    input.style = this.poseStyle(z);
    input.vaultProgress = z.vaultProgress;
    input.armorHit = z.lastHitArmor;
    return input;
  }

  /** F4 labels: type name + state above heads, plus the BREAK icon (FR-AI-01, FR-AGG-08). */
  labels(camPos: Vec3Like, all: boolean): ZombieLabel[] {
    const out: ZombieLabel[] = [];
    for (const z of this.zombies) {
      if (distXZ(z.pos, camPos) > 40) continue;
      const pos = { x: z.pos.x, y: z.pos.y + 2.1 + (z.def.armor?.protects === 'head' && z.armorIntact() ? 0.35 : 0), z: z.pos.z };
      if (all) out.push({ pos, text: z.state, typeName: z.def.displayName, kind: 'state' });
      else if (z.state === 'BREAK' || (z.state === 'ATTACK' && z.blockingWallId)) out.push({ pos, text: 'BREAK', typeName: z.def.displayName, kind: 'break' });
    }
    return out;
  }
}
