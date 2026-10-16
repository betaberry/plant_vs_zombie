// Map pickups: auto-collected sun packs (FR-SUN-08) and supply crates opened with F (FR-MOV-08, FR-MAP-03).
import * as THREE from 'three';
import type { PickupPointDef } from '../config/types';
import type { Vec3Like } from '../core/events';
import { distXZ } from '../logic/math';
import { InstancePool } from '../render/instancing';
import { toonMaterial } from '../render/renderer';

export interface Pickup {
  id: string;
  item: string;
  pos: Vec3Like;
  respawn: number;
  active: boolean;
  timer: number;
  lifetime: number;
  inst: number;
}

export class PickupManager {
  readonly items: Pickup[] = [];
  private readonly sun: InstancePool;
  private readonly crate: InstancePool;
  private t = 0;

  constructor(scene: THREE.Scene, defs: { def: PickupPointDef; pos: Vec3Like }[], sunLifetime: number) {
    this.sun = new InstancePool(new THREE.SphereGeometry(0.3, 12, 8), toonMaterial('#ffffff', { emissive: '#ffb300', emissiveIntensity: 0.6 }), 32);
    this.crate = new InstancePool(new THREE.BoxGeometry(0.6, 0.45, 0.45), toonMaterial('#ffffff'), 32);
    scene.add(this.sun.mesh, this.crate.mesh);
    for (const { def, pos } of defs) {
      const isSun = def.item === 'sun_pack';
      const inst = isSun ? this.sun.acquire('#ffeb3b') : this.crate.acquire('#e53935');
      this.items.push({ id: def.id, item: def.item, pos: { x: pos.x, y: pos.y + 0.5, z: pos.z }, respawn: def.respawn, active: true, timer: 0, lifetime: isSun ? sunLifetime : Infinity, inst });
    }
  }

  /** Advances timers; returns sun packs collected automatically by walking over them. */
  update(dt: number, playerPos: Vec3Like, autoRadius: number): Pickup[] {
    this.t += dt;
    const collected: Pickup[] = [];
    for (const p of this.items) {
      p.timer += dt;
      if (!p.active) {
        if (p.timer >= p.respawn) this.setActive(p, true);
        continue;
      }
      if (p.timer >= p.lifetime) {
        this.setActive(p, false);
        continue;
      }
      if (p.item === 'sun_pack' && distXZ(p.pos, playerPos) < autoRadius && Math.abs(p.pos.y - 0.5 - playerPos.y) < 1.5) {
        collected.push(p);
        this.setActive(p, false);
      }
    }
    return collected;
  }

  /** Nearest active supply crate within range (for the [F] prompt). */
  nearestCrate(pos: Vec3Like, range: number): Pickup | null {
    let best: Pickup | null = null;
    let bestD = range;
    for (const p of this.items) {
      if (!p.active || p.item === 'sun_pack') continue;
      const d = Math.hypot(p.pos.x - pos.x, p.pos.y - 0.5 - pos.y, p.pos.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  take(id: string): Pickup | null {
    const p = this.items.find((x) => x.id === id && x.active);
    if (!p) return null;
    this.setActive(p, false);
    return p;
  }

  private setActive(p: Pickup, active: boolean): void {
    p.active = active;
    p.timer = 0;
  }

  render(): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (const p of this.items) {
      const pool = p.item === 'sun_pack' ? this.sun : this.crate;
      if (!p.active) {
        pool.setMatrix(p.inst, m.makeScale(0, 0, 0));
        continue;
      }
      const bobY = Math.sin(this.t * 2 + p.pos.x) * 0.1;
      q.setFromEuler(new THREE.Euler(0, this.t * 1.5, 0));
      pool.setMatrix(p.inst, m.compose(new THREE.Vector3(p.pos.x, p.pos.y + bobY, p.pos.z), q, new THREE.Vector3(1, 1, 1)));
    }
  }
}
