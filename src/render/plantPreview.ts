// Planting preview (green = valid, red = invalid) and 6 m plantable-cell highlight (FR-PLT-01/02, FR-MAP-15).
import * as THREE from 'three';
import type { Vec3Like } from '../core/events';

const OK = new THREE.Color('#66bb6a');
const BAD = new THREE.Color('#ef5350');

export class PlantPreview {
  private readonly group = new THREE.Group();
  private readonly mat = new THREE.MeshBasicMaterial({ color: OK, transparent: true, opacity: 0.45, depthWrite: false });
  private readonly ring: THREE.Mesh;
  private readonly body: THREE.Mesh;
  private readonly cells: THREE.InstancedMesh;
  private flashT = 0;

  constructor(scene: THREE.Scene, private readonly maxCells = 160) {
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 24), this.mat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.05;
    this.body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 1, 12), this.mat);
    this.body.position.y = 0.5;
    this.group.add(this.ring, this.body);
    this.group.visible = false;
    const cellMat = new THREE.MeshBasicMaterial({ color: '#c5e1a5', transparent: true, opacity: 0.28, depthWrite: false });
    this.cells = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 0.9), cellMat, maxCells);
    this.cells.count = 0;
    this.cells.frustumCulled = false;
    scene.add(this.group, this.cells);
  }

  show(pos: Vec3Like, valid: boolean, radius: number, yaw: number, isWall: boolean): void {
    this.group.visible = true;
    this.group.position.set(pos.x, pos.y, pos.z);
    this.group.rotation.y = yaw;
    this.ring.scale.setScalar(radius / 0.5);
    this.body.scale.set(isWall ? 4 : 1, isWall ? 1.4 : 1, isWall ? 1.2 : 1);
    this.body.position.y = isWall ? 0.7 : 0.5;
    const flashing = this.flashT > 0 && Math.floor(this.flashT * 12) % 2 === 0;
    this.mat.color.copy(valid && !flashing ? OK : BAD);
  }

  /** FR-PLT-07: red flash on an invalid click. */
  flashInvalid(): void {
    this.flashT = 0.5;
  }

  hide(): void {
    this.group.visible = false;
    this.cells.count = 0;
  }

  setCells(points: Vec3Like[]): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const n = Math.min(points.length, this.maxCells);
    for (let i = 0; i < n; i++) {
      const p = points[i]!;
      m.compose(new THREE.Vector3(p.x, p.y + 0.04, p.z), q, new THREE.Vector3(1, 1, 1));
      this.cells.setMatrixAt(i, m);
    }
    this.cells.count = n;
    this.cells.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    this.flashT = Math.max(0, this.flashT - dt);
  }
}
