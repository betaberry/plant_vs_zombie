// Instanced part pools: one draw call per part type for zombies, plants, pickups (NFR1 Draw Call budget).
import * as THREE from 'three';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class InstancePool {
  readonly mesh: THREE.InstancedMesh;
  private free: number[] = [];
  private baseColors: THREE.Color[] = [];

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, readonly capacity: number, castShadow = true) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = capacity - 1; i >= 0; i--) {
      this.free.push(i);
      this.mesh.setMatrixAt(i, HIDDEN);
      this.mesh.setColorAt(i, new THREE.Color('#ffffff'));
      this.baseColors[i] = new THREE.Color('#ffffff');
    }
    this.mesh.count = capacity;
  }

  acquire(color: THREE.ColorRepresentation = '#ffffff'): number {
    const id = this.free.pop();
    if (id === undefined) return -1;
    this.baseColors[id]!.set(color);
    this.mesh.setColorAt(id, this.baseColors[id]!);
    this.markColors();
    return id;
  }

  release(id: number): void {
    if (id < 0) return;
    this.mesh.setMatrixAt(id, HIDDEN);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.free.push(id);
  }

  setMatrix(id: number, m: THREE.Matrix4): void {
    if (id < 0) return;
    this.mesh.setMatrixAt(id, m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Tint toward `flash` by t (0..1) — used for the white hit flash and frost tint. */
  tint(id: number, flash: THREE.Color | null, t: number): void {
    if (id < 0) return;
    const c = this.baseColors[id]!.clone();
    if (flash && t > 0) c.lerp(flash, Math.min(1, t));
    this.mesh.setColorAt(id, c);
    this.markColors();
  }

  setBaseColor(id: number, color: THREE.ColorRepresentation): void {
    if (id < 0) return;
    this.baseColors[id]!.set(color);
    this.mesh.setColorAt(id, this.baseColors[id]!);
    this.markColors();
  }

  get used(): number {
    return this.capacity - this.free.length;
  }

  private markColors(): void {
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
