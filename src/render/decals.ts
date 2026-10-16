// Bullet-hole decals: max 100, recycled in a ring (FR-WPN-04). One instanced draw call.
import * as THREE from 'three';
import type { Vec3Like } from '../core/events';

function holeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable for decal texture');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(40,60,20,1)');
  grad.addColorStop(0.5, 'rgba(85,139,47,0.9)');
  grad.addColorStop(1, 'rgba(85,139,47,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Decals {
  private readonly mesh: THREE.InstancedMesh;
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly z = new THREE.Vector3(0, 0, 1);

  constructor(scene: THREE.Scene, readonly max = 100) {
    const mat = new THREE.MeshBasicMaterial({ map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.22, 0.22), mat, max);
    this.mesh.frustumCulled = false;
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, this.m);
    scene.add(this.mesh);
  }

  add(point: Vec3Like, normal: Vec3Like): void {
    const n = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
    this.q.setFromUnitVectors(this.z, n);
    const p = new THREE.Vector3(point.x, point.y, point.z).addScaledVector(n, 0.01);
    this.m.compose(p, this.q, new THREE.Vector3(1, 1, 1));
    this.mesh.setMatrixAt(this.next, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.next = (this.next + 1) % this.max;
  }
}
