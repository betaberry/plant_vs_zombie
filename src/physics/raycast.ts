// Ray queries with team filtering (TR-HIT-01..05, FR-AI-03, TR-PLT-01).
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3Like } from '../core/events';
import type { ColliderTag, PhysicsWorld } from './world';

export interface RayHit {
  point: Vec3Like;
  normal: Vec3Like;
  distance: number;
  tag: ColliderTag;
  collider: RAPIER.Collider;
}

export interface RayOptions {
  exclude?: RAPIER.Collider | null;
  /** Return true to ignore a collider (e.g. the shooter, dead zombies). */
  skip?: (tag: ColliderTag, collider: RAPIER.Collider) => boolean;
}

const UNTAGGED: ColliderTag = { team: 'world', entityId: null, material: 'concrete' };

export function castRay(phys: PhysicsWorld, origin: Vec3Like, dir: Vec3Like, maxDist: number, opts: RayOptions = {}): RayHit | null {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len === 0) return null;
  const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
  const ray = new phys.R.Ray(origin, d);
  // Zombie-only barriers (core doorway) are invisible to every ray: shots, sight, aiming and ground probes.
  const predicate = (c: RAPIER.Collider): boolean => {
    const tag = phys.tagOf(c) ?? UNTAGGED;
    if (tag.team === 'barrier') return false;
    return opts.skip ? !opts.skip(tag, c) : true;
  };
  const hit = phys.world.castRayAndGetNormal(
    ray, maxDist, true, phys.R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, opts.exclude ?? undefined, undefined, predicate,
  );
  if (!hit) return null;
  const t = hit.timeOfImpact;
  return {
    point: { x: origin.x + d.x * t, y: origin.y + d.y * t, z: origin.z + d.z * t },
    normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
    distance: t,
    tag: phys.tagOf(hit.collider) ?? UNTAGGED,
    collider: hit.collider,
  };
}

/** True when nothing static (walls, doors, nut walls) blocks the segment. Actors never block sight. */
export function hasLineOfSight(phys: PhysicsWorld, from: Vec3Like, to: Vec3Like): boolean {
  const dir = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const dist = Math.hypot(dir.x, dir.y, dir.z);
  if (dist < 1e-3) return true;
  const hit = castRay(phys, from, dir, dist, { skip: (tag) => tag.team === 'zombie' || tag.team === 'player' || (tag.team === 'plant' && tag.material !== 'wood') });
  return hit === null;
}

/** Downward probe used for planting: returns ground hit point and normal. */
export function probeGround(phys: PhysicsWorld, x: number, z: number, fromY: number, maxDrop: number): RayHit | null {
  return castRay(phys, { x, y: fromY, z }, { x: 0, y: -1, z: 0 }, maxDrop, {
    skip: (tag) => tag.team !== 'world',
  });
}
