// Pooled dropped armour props (Revision 2, plan Step 28). They reuse the rig's accessory InstancedMeshes,
// so a falling bucket costs no extra draw call. Fade-out = shrink and sink (the shared opaque material
// has no per-instance alpha).
import * as THREE from 'three';
import type { DroppedPropConfig } from '../config/types';
import { store } from '../core/store';
import { launchDroppedProp, stepDroppedProp, type DroppedPropState } from '../logic/droppedProp';
import type { AccessoryPart } from './zombieGeometry';
import type { ZombieRig } from './zombieRig';

interface Active {
  part: AccessoryPart;
  id: number;
  state: DroppedPropState;
  /** Orientation and offset of the accessory relative to its own position at the moment of the drop. */
  baseQuat: THREE.Quaternion;
  baseScale: THREE.Vector3;
  /** Geometry centre in the part's local frame (pivot of the tumble). */
  center: THREE.Vector3;
  metal: boolean;
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class DroppedProps {
  private readonly active: Active[] = [];
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly offset = new THREE.Matrix4();

  constructor(private readonly rig: ZombieRig, private readonly cfg: DroppedPropConfig) {}

  get count(): number {
    return this.active.length;
  }

  /** Spawn a prop from the accessory's last world matrix; recycles the oldest prop when the pool is full. */
  spawn(part: AccessoryPart, world: THREE.Matrix4, groundY: number, zombieYaw: number, metal: boolean): void {
    if (this.active.length >= this.cfg.maxActive) this.retire(0);
    const id = this.rig.pool(part).acquire('#ffffff');
    if (id < 0) return;
    const baseQuat = new THREE.Quaternion();
    const baseScale = new THREE.Vector3();
    world.decompose(this.p, baseQuat, baseScale);
    // Tumble about the prop's own centre, not the joint it hung from.
    const geo = this.rig.pool(part).mesh.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const sphere = geo.boundingSphere;
    const center = sphere ? sphere.center.clone() : new THREE.Vector3();
    const origin = center.clone().applyMatrix4(world);
    const rest = Math.min(0.15, (sphere?.radius ?? 0.2) * 0.3);
    const state = launchDroppedProp(origin, groundY + rest, zombieYaw, this.cfg, Math.random);
    this.active.push({ part, id, state, baseQuat, baseScale, center, metal });
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i]!;
      const step = stepDroppedProp(a.state, this.cfg, dt);
      if (step.landedNow) store.events.emit('propLanded', { pos: { ...a.state.pos }, metal: a.metal });
      if (step.done) {
        this.retire(i);
        continue;
      }
      const st = a.state;
      this.q.setFromEuler(this.e.set(st.rot.x, st.rot.y, st.rot.z)).multiply(a.baseQuat);
      this.p.set(st.pos.x, st.pos.y - (1 - step.scale) * 0.15, st.pos.z);
      this.s.copy(a.baseScale).multiplyScalar(step.scale);
      this.m.compose(this.p, this.q, this.s).multiply(this.offset.makeTranslation(-a.center.x, -a.center.y, -a.center.z));
      this.rig.pool(a.part).setMatrix(a.id, this.m);
    }
  }

  clear(): void {
    while (this.active.length > 0) this.retire(this.active.length - 1);
  }

  private retire(index: number): void {
    const a = this.active[index]!;
    const pool = this.rig.pool(a.part);
    pool.setMatrix(a.id, HIDDEN);
    pool.release(a.id);
    this.active.splice(index, 1);
  }
}
