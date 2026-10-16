// Rapier world wrapper: init with explicit error, collider tagging, helpers for static boxes / kinematic capsules.
import RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3Like } from '../core/events';

export type ColliderTeam = 'world' | 'player' | 'zombie' | 'plant' | 'door';
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
