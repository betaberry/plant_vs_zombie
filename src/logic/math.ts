// Small pure vector helpers shared by logic modules (no Three.js dependency).
import type { Vec3Like } from '../core/events';

export function distXZ(a: Vec3Like, b: Vec3Like): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function dist3(a: Vec3Like, b: Vec3Like): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Yaw (radians) looking from a to b in the XZ plane; yaw 0 faces -Z (Three.js camera convention). */
export function yawTo(a: Vec3Like, b: Vec3Like): number {
  return Math.atan2(-(b.x - a.x), -(b.z - a.z));
}

/** Smallest signed difference b - a in (-π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export const DEG = Math.PI / 180;

export function pointInPolygon(x: number, z: number, points: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i]!;
    const [xj, zj] = points[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from point p to segment ab in XZ. */
export function pointSegmentDistXZ(p: Vec3Like, a: Vec3Like, b: Vec3Like): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}

export interface Rect2 {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Segment vs axis-aligned rectangle (slab test) in XZ. */
export function segmentIntersectsRect(ax: number, az: number, bx: number, bz: number, r: Rect2): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, ax - r.minX) && clip(dx, r.maxX - ax) && clip(-dz, az - r.minZ) && clip(dz, r.maxZ - az)
  );
}

export function pointInRect(x: number, z: number, r: Rect2): boolean {
  return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}
