// Rapier world wrapper: init with explicit error, collider tagging, helpers for static boxes / kinematic capsules.
import RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3Like } from '../core/events';

/** core: guard-mode core house walls · barrier: invisible zombie-only blocker (core house doorway). */
export type ColliderTeam = 'world' | 'player' | 'zombie' | 'plant' | 'door' | 'core' | 'barrier';

/**
 * Rapier collision groups (membership << 16 | filter). Zombie-only barriers belong to their own group;
 * the player's character controller queries with a filter that leaves that group out, so the player walks
 * through the core doorway while zombie controllers (default groups) are stopped by it.
 */
const BARRIER_GROUP = 0x0002;
export const ZOMBIE_BARRIER_GROUPS = ((BARRIER_GROUP << 16) | 0xffff) >>> 0;
export const PLAYER_QUERY_GROUPS = ((0xffff << 16) | (0xffff & ~BARRIER_GROUP)) >>> 0;
export type SurfaceMaterial = 'concrete' | 'metal' | 'wood' | 'glass' | 'flesh' | 'plant';

export interface ColliderTag {
  team: ColliderTeam;
  entityId: string | null;
  material: SurfaceMaterial;
}

export class PhysicsInitError extends Error {}

export class PhysicsWorld {
  readonly R = RAPIER;
  readonly world: RAPIER.World;
  private tags = new Map<number, ColliderTag>();
  lastStepMs = 0;

  private constructor(gravityY: number) {
    this.world = new RAPIER.World({ x: 0, y: gravityY, z: 0 });
  }

  /** Loads the Rapier WASM module. Throws PhysicsInitError with a readable message on failure. */
  static async create(gravityY: number): Promise<PhysicsWorld> {
    try {
      await RAPIER.init();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new PhysicsInitError(`物理引擎（Rapier WASM）初始化失败：${msg}`);
    }
    return new PhysicsWorld(gravityY);
  }

  tagOf(collider: RAPIER.Collider): ColliderTag | undefined {
    return this.tags.get(collider.handle);
  }

  setTag(collider: RAPIER.Collider, tag: ColliderTag): void {
    this.tags.set(collider.handle, tag);
  }

  addStaticBox(center: Vec3Like, half: Vec3Like, rotation: { x: number; y: number; z: number; w: number } | null, tag: ColliderTag): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(center.x, center.y, center.z);
    if (rotation) desc.setRotation(rotation);
    const c = this.world.createCollider(desc);
    this.setTag(c, tag);
    return c;
  }

  /** Static box that only blocks zombies (and other default-group queries); the player passes through. */
  addZombieBarrier(center: Vec3Like, half: Vec3Like, tag: ColliderTag): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(center.x, center.y, center.z).setCollisionGroups(ZOMBIE_BARRIER_GROUPS);
    const c = this.world.createCollider(desc);
    this.setTag(c, tag);
    return c;
  }

  addStaticCylinder(center: Vec3Like, halfHeight: number, radius: number, tag: ColliderTag): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius).setTranslation(center.x, center.y, center.z);
    const c = this.world.createCollider(desc);
    this.setTag(c, tag);
    return c;
  }

  /** Kinematic capsule positioned by its center. */
  addKinematicCapsule(center: Vec3Like, halfHeight: number, radius: number, tag: ColliderTag): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(center.x, center.y, center.z),
    );
    const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius), body);
    this.setTag(collider, tag);
    return { body, collider };
  }

  removeCollider(c: RAPIER.Collider): void {
    this.tags.delete(c.handle);
    this.world.removeCollider(c, false);
  }

  removeBody(body: RAPIER.RigidBody): void {
    for (let i = 0; i < body.numColliders(); i++) this.tags.delete(body.collider(i).handle);
    this.world.removeRigidBody(body);
  }

  createCharacterController(stepHeight: number, maxSlopeDeg: number): RAPIER.KinematicCharacterController {
    const cc = this.world.createCharacterController(0.02);
    cc.enableAutostep(stepHeight, 0.15, false);
    cc.enableSnapToGround(0.3);
    cc.setMaxSlopeClimbAngle((maxSlopeDeg * Math.PI) / 180);
    cc.setSlideEnabled(true);
    return cc;
  }

  step(dt: number): void {
    const t0 = performance.now();
    this.world.timestep = dt;
    this.world.step();
    this.lastStepMs = performance.now() - t0;
  }
}
