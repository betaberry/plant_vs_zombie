// Builds the procedural city (render + physics) from the pure layout (FR-MAP-01..07).
// All boxes are batched into a few InstancedMeshes (per-instance colors) to stay within the Draw Call budget.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3Like } from '../core/events';
import type { PhysicsWorld } from '../physics/world';
import { toonMaterial } from '../render/renderer';
import type { BoxSpec, CityLayout, DoorSpec, SignSpec } from './layout';

interface DoorRuntime {
  spec: DoorSpec;
  mesh: THREE.Mesh;
  collider: RAPIER.Collider;
  open: boolean;
}

function quatFor(b: BoxSpec): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(0, b.rotY ?? 0, b.rotZ ?? 0));
}

function signTexture(s: SignSpec): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  const aspect = s.width / s.height;
  canvas.width = Math.round(128 * aspect);
  canvas.height = 128;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable for sign textures');
  g.fillStyle = s.bg;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = s.fg;
  if (s.kind === 'clock') {
    const c = canvas.height / 2;
    g.strokeStyle = s.fg;
    g.lineWidth = 6;
    g.beginPath();
    g.arc(c, c, c - 8, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.fillRect(c + Math.sin(a) * (c - 22) - 3, c - Math.cos(a) * (c - 22) - 3, 6, 6);
    }
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(c, c);
    g.lineTo(c + 28, c - 18);
    g.moveTo(c, c);
    g.lineTo(c - 6, c - 46);
    g.stroke();
  } else {
    g.font = 'bold 88px "Microsoft YaHei", "PingFang SC", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s.text, canvas.width / 2, canvas.height / 2 + 4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class City {
  readonly group = new THREE.Group();
  private doors = new Map<string, DoorRuntime>();
  readonly batches: THREE.InstancedMesh[] = [];

  constructor(scene: THREE.Scene, private readonly phys: PhysicsWorld, readonly layout: CityLayout) {
    this.buildBatches();
    for (const s of layout.signs) this.addSign(s);
    for (const d of layout.doors) this.addDoor(d);
    scene.add(this.group);
  }

  private buildBatches(): void {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const layers: Record<BoxSpec['layer'], THREE.Material> = {
      solid: toonMaterial('#ffffff'),
      ground: toonMaterial('#ffffff'),
      water: new THREE.MeshPhongMaterial({ color: '#4fc3f7', transparent: true, opacity: 0.75, shininess: 80 }),
    };
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (const layer of Object.keys(layers) as BoxSpec['layer'][]) {
      for (const shadow of [true, false]) {
        const boxes = this.layout.boxes.filter((b) => b.layer === layer && (b.shadow ?? true) === shadow);
        if (boxes.length === 0) continue;
        const mesh = new THREE.InstancedMesh(geo, layers[layer], boxes.length);
        mesh.castShadow = shadow;
        mesh.receiveShadow = true;
        boxes.forEach((b, i) => {
          m.compose(new THREE.Vector3(b.center.x, b.center.y, b.center.z), quatFor(b), new THREE.Vector3(b.size.x, b.size.y, b.size.z));
          mesh.setMatrixAt(i, m);
          mesh.setColorAt(i, color.set(b.color));
        });
        mesh.computeBoundingSphere();
        this.group.add(mesh);
        this.batches.push(mesh);
      }
    }
    for (const b of this.layout.boxes) {
      if (!b.collide) continue;
      const q = quatFor(b);
      this.phys.addStaticBox(b.center, { x: b.size.x / 2, y: b.size.y / 2, z: b.size.z / 2 }, { x: q.x, y: q.y, z: q.z, w: q.w }, { team: 'world', entityId: null, material: b.surface });
    }
  }

  private addSign(s: SignSpec): void {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.width, s.height), new THREE.MeshBasicMaterial({ map: signTexture(s) }));
    mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
    mesh.rotation.y = s.rotY;
    this.group.add(mesh);
  }

  private addDoor(spec: DoorSpec): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), toonMaterial('#8d5524'));
    mesh.castShadow = true;
    this.group.add(mesh);
    const runtime: DoorRuntime = { spec, mesh, collider: null as unknown as RAPIER.Collider, open: true };
    this.doors.set(spec.id, runtime);
    this.applyDoor(runtime);
  }

  private applyDoor(d: DoorRuntime): void {
    const t = d.open ? d.spec.open : d.spec.closed;
    d.mesh.position.set(t.center.x, t.center.y, t.center.z);
    d.mesh.scale.set(t.size.x, t.size.y, t.size.z);
    if (d.collider) this.phys.removeCollider(d.collider);
    d.collider = this.phys.addStaticBox(t.center, { x: t.size.x / 2, y: t.size.y / 2, z: t.size.z / 2 }, null, { team: 'door', entityId: d.spec.id, material: 'wood' });
  }

  /** Nearest door handle within range of `pos` (FR-MOV-08). */
  nearestDoor(pos: Vec3Like, range: number): string | null {
    let best: string | null = null;
    let bestD = range;
    for (const d of this.doors.values()) {
      const c = d.open ? d.spec.open.center : d.spec.closed.center;
      const dist = Math.min(Math.hypot(pos.x - c.x, pos.z - c.z), Math.hypot(pos.x - d.spec.handle.x, pos.z - d.spec.handle.z));
      if (dist < bestD) {
        bestD = dist;
        best = d.spec.id;
      }
    }
    return best;
  }

  isDoorOpen(id: string): boolean {
    return this.doors.get(id)?.open ?? true;
  }

  setDoor(id: string, open: boolean): void {
    const d = this.doors.get(id);
    if (!d || d.open === open) return;
    d.open = open;
    this.applyDoor(d);
  }

  /** Zombies push closed doors open when they reach them. */
  openDoorsNear(pos: Vec3Like, radius: number): void {
    for (const d of this.doors.values()) {
      if (d.open) continue;
      const c = d.spec.closed.center;
      if (Math.hypot(pos.x - c.x, pos.z - c.z) < radius) this.setDoor(d.spec.id, true);
    }
  }
}
