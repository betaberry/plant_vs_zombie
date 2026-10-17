// Guard mode core house (FR3): the thing every zombie marches on. IAttackable with team 'core'.
// Own colliders: concrete walls + roof (team 'core'); the doorway holds a zombie-only barrier, so the
// player can walk in and out while zombies have to stand outside and hit the walls.
// Visual damage stages (FR3.4): 1 windows broken · 2 wall cracks · 3 smoke · 4 collapse; flashes red below 50 %.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { ChallengeConfig } from '../config/types';
import type { Vec3Like } from '../core/events';
import { store } from '../core/store';
import { applyHealthDamage, type DamageInfo, type DamageResult, type IAttackable } from '../logic/attackable';
import { coreDamageStage, isCoreLow } from '../logic/guardRules';
import type { Rect2 } from '../logic/math';
import type { PhysicsWorld } from '../physics/world';
import type { Particles } from '../render/particles';
import { toonMaterial } from '../render/renderer';

const WALL = 0.4;
const DOOR_H = 2.6;
const ROOF = 0.3;
const WALL_COLOR = '#d7ccc8';
const WINDOW_OK = '#4fc3f7';
const WINDOW_BROKEN = '#263238';
const SMOKE_INTERVAL = 0.15;

export interface CoreHouseSpec {
  rect: Rect2;
  height: number;
  doorWidth: number;
  maxHealth: number;
  /** Start health (a resumed run or a restart keeps the damaged value, FR6.5). */
  health: number;
  stages: ChallengeConfig['core'];
}

interface Piece {
  center: Vec3Like;
  size: Vec3Like;
}

export class CoreHouse implements IAttackable {
  readonly attackableId = 'core';
  readonly team = 'core' as const;
  readonly maxHealth: number;
  health: number;
  readonly rect: Rect2;
  readonly center: Vec3Like;
  /** Half of the larger footprint side: smash / range checks measure to the wall, not the centre. */
  readonly extent: number;
  stage = 0;
  private readonly group = new THREE.Group();
  private readonly colliders: RAPIER.Collider[] = [];
  private readonly wallMat: THREE.MeshToonMaterial;
  private readonly windows: THREE.InstancedMesh;
  private readonly cracks: THREE.Mesh;
  private readonly roof: THREE.Mesh;
  private readonly walls: THREE.InstancedMesh;
  private smokeTimer = 0;
  private clock = 0;
  /** 0..1 red flash after a hit (on top of the low-health pulse). */
  private hitFlash = 0;

  constructor(scene: THREE.Scene, private readonly phys: PhysicsWorld, private readonly particles: Particles, private readonly spec: CoreHouseSpec) {
    this.rect = spec.rect;
    this.maxHealth = spec.maxHealth;
    this.health = Math.min(spec.maxHealth, Math.max(1, spec.health));
    const { minX, minZ, maxX, maxZ } = spec.rect;
    this.center = { x: (minX + maxX) / 2, y: 0, z: (minZ + maxZ) / 2 };
    this.extent = Math.max(maxX - minX, maxZ - minZ) / 2;
    this.wallMat = toonMaterial('#ffffff');
    const pieces = this.wallPieces();
    this.walls = this.instanced(pieces, this.wallMat, WALL_COLOR);
    for (const p of pieces) this.colliders.push(this.phys.addStaticBox(p.center, half(p.size), null, { team: 'core', entityId: 'core', material: 'concrete' }));
    const roofPiece = { center: { x: this.center.x, y: spec.height + ROOF / 2, z: this.center.z }, size: { x: maxX - minX + 0.6, y: ROOF, z: maxZ - minZ + 0.6 } };
    this.roof = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), toonMaterial('#8d6e63'));
    this.roof.position.set(roofPiece.center.x, roofPiece.center.y, roofPiece.center.z);
    this.roof.scale.set(roofPiece.size.x, roofPiece.size.y, roofPiece.size.z);
    this.roof.castShadow = true;
    this.group.add(this.roof);
    this.colliders.push(this.phys.addStaticBox(roofPiece.center, half(roofPiece.size), null, { team: 'core', entityId: 'core', material: 'wood' }));
    // Doorway: zombies are stopped here, the player is not (collision groups, see PhysicsWorld).
    const doorZ = maxZ - WALL / 2;
    this.colliders.push(this.phys.addZombieBarrier({ x: this.center.x, y: DOOR_H / 2, z: doorZ }, { x: spec.doorWidth / 2, y: DOOR_H / 2, z: WALL / 2 + 0.3 }, { team: 'barrier', entityId: 'core', material: 'concrete' }));
    this.windows = this.instanced(this.windowPieces(), new THREE.MeshLambertMaterial({ color: '#ffffff' }), WINDOW_OK);
    this.windows.castShadow = false;
    this.cracks = this.crackMesh();
    this.cracks.visible = false;
    this.group.add(this.walls, this.windows, this.cracks);
    scene.add(this.group);
    this.applyStage(coreDamageStage(this.health, this.maxHealth, spec.stages.damageStages));
  }

  position(): Vec3Like {
    return this.center;
  }

  isAlive(): boolean {
    return this.health > 0;
  }

  fraction(): number {
    return this.maxHealth > 0 ? this.health / this.maxHealth : 0;
  }

  isLow(): boolean {
    return isCoreLow(this.health, this.maxHealth, this.spec.stages);
  }

  /** Distance in XZ from `p` to the house footprint (0 inside). */
  distanceTo(p: Vec3Like): number {
    const dx = Math.max(this.rect.minX - p.x, 0, p.x - this.rect.maxX);
    const dz = Math.max(this.rect.minZ - p.z, 0, p.z - this.rect.maxZ);
    return Math.hypot(dx, dz);
  }

  /** Point `out` metres outside the wall nearest to `from` (where an attacker stands). */
  approachPoint(from: Vec3Like, out: number): Vec3Like {
    const r = this.rect;
    const x = Math.min(r.maxX, Math.max(r.minX, from.x));
    const z = Math.min(r.maxZ, Math.max(r.minZ, from.z));
    const toMin = [x - r.minX, r.maxX - x, z - r.minZ, r.maxZ - z];
    const inside = from.x > r.minX && from.x < r.maxX && from.z > r.minZ && from.z < r.maxZ;
    if (!inside && (x !== from.x || z !== from.z)) {
      const dx = from.x - x;
      const dz = from.z - z;
      const len = Math.hypot(dx, dz) || 1;
      return { x: x + (dx / len) * out, y: 0, z: z + (dz / len) * out };
    }
    const side = toMin.indexOf(Math.min(...toMin));
    if (side === 0) return { x: r.minX - out, y: 0, z };
    if (side === 1) return { x: r.maxX + out, y: 0, z };
    if (side === 2) return { x, y: 0, z: r.minZ - out };
    return { x, y: 0, z: r.maxZ + out };
  }

  applyDamage(amount: number, info: DamageInfo): DamageResult {
    // Only zombies hurt the core; friendly fire and explosions never do (FR3.2).
    if (info.source !== 'zombie') return { applied: 0, killed: false };
    const state = { health: this.health };
    const res = applyHealthDamage(state, amount);
    this.health = state.health;
    if (res.applied <= 0) return res;
    this.hitFlash = 1;
    store.events.emit('coreHurt', { amount: res.applied, health: this.health, maxHealth: this.maxHealth, pos: info.from ?? this.center });
    const stage = coreDamageStage(this.health, this.maxHealth, this.spec.stages.damageStages);
    if (stage !== this.stage) {
      this.applyStage(stage);
      store.events.emit('coreStage', { stage });
    }
    return res;
  }

  /** Restart / resume: set the health directly (no events, FR6.5). */
  setHealth(h: number): void {
    this.health = Math.min(this.maxHealth, Math.max(0, h));
    this.applyStage(coreDamageStage(this.health, this.maxHealth, this.spec.stages.damageStages));
  }

  /** Render-time: low-health red pulse, hit flash, smoke. */
  render(frameDt: number): void {
    this.clock += frameDt;
    this.hitFlash = Math.max(0, this.hitFlash - frameDt * 4);
    const pulse = this.isLow() && this.isAlive() ? 0.5 + 0.5 * Math.sin(this.clock * Math.PI * 2 * 1.5) : 0;
    const red = Math.min(1, Math.max(pulse * 0.6, this.hitFlash * 0.8));
    this.wallMat.emissive.setRGB(red * 0.9, 0, 0);
    if (this.stage >= 3) {
      this.smokeTimer -= frameDt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = SMOKE_INTERVAL;
        const r = this.rect;
        const y = this.stage >= 4 ? this.spec.height * 0.5 : this.spec.height + 0.5;
        this.particles.emit('smoke', { x: r.minX + (r.maxX - r.minX) * Math.random(), y, z: r.minZ + (r.maxZ - r.minZ) * Math.random() });
      }
    }
  }

  private applyStage(stage: number): void {
    this.stage = stage;
    const c = new THREE.Color(stage >= 1 ? WINDOW_BROKEN : WINDOW_OK);
    for (let i = 0; i < this.windows.count; i++) this.windows.setColorAt(i, c);
    if (this.windows.instanceColor) this.windows.instanceColor.needsUpdate = true;
    this.cracks.visible = stage >= 2;
    // Collapse: the roof caves in and tilts; walls sag (visual only, colliders stay so nobody falls in).
    const h = this.spec.height;
    if (stage >= 4) {
      this.roof.position.y = h * 0.55;
      this.roof.rotation.set(0.18, 0, -0.22);
      this.walls.scale.y = 0.7;
    } else {
      this.roof.position.y = h + ROOF / 2;
      this.roof.rotation.set(0, 0, 0);
      this.walls.scale.y = 1;
    }
  }

  private wallPieces(): Piece[] {
    const { minX, minZ, maxX, maxZ } = this.spec.rect;
    const h = this.spec.height;
    const w = maxX - minX;
    const cx = this.center.x;
    const dw = this.spec.doorWidth;
    const side = (w - dw) / 2;
    return [
      { center: { x: cx, y: h / 2, z: minZ + WALL / 2 }, size: { x: w, y: h, z: WALL } },
      { center: { x: minX + WALL / 2, y: h / 2, z: (minZ + maxZ) / 2 }, size: { x: WALL, y: h, z: maxZ - minZ } },
      { center: { x: maxX - WALL / 2, y: h / 2, z: (minZ + maxZ) / 2 }, size: { x: WALL, y: h, z: maxZ - minZ } },
      // South wall with the doorway (FR3.1: the player can enter).
      { center: { x: minX + side / 2, y: h / 2, z: maxZ - WALL / 2 }, size: { x: side, y: h, z: WALL } },
      { center: { x: maxX - side / 2, y: h / 2, z: maxZ - WALL / 2 }, size: { x: side, y: h, z: WALL } },
      { center: { x: cx, y: (h + DOOR_H) / 2, z: maxZ - WALL / 2 }, size: { x: dw, y: h - DOOR_H, z: WALL } },
    ];
  }

  private windowPieces(): Piece[] {
    const { minX, minZ, maxX, maxZ } = this.spec.rect;
    const y = this.spec.height * 0.55;
    const out: Piece[] = [];
    for (const t of [0.3, 0.7]) {
      out.push({ center: { x: minX + (maxX - minX) * t, y, z: minZ - 0.03 }, size: { x: 1.6, y: 1.2, z: 0.08 } });
      out.push({ center: { x: minX - 0.03, y, z: minZ + (maxZ - minZ) * t }, size: { x: 0.08, y: 1.2, z: 1.6 } });
      out.push({ center: { x: maxX + 0.03, y, z: minZ + (maxZ - minZ) * t }, size: { x: 0.08, y: 1.2, z: 1.6 } });
    }
    return out;
  }

  /** Zig-zag crack strips on the outer faces, merged into one mesh. */
  private crackMesh(): THREE.Mesh {
    const { minX, minZ, maxX, maxZ } = this.spec.rect;
    const h = this.spec.height;
    const geos: THREE.BufferGeometry[] = [];
    const strip = (x: number, z: number, rotY: number): void => {
      let y = h * 0.95;
      let off = 0;
      for (let i = 0; i < 5; i++) {
        const len = h * 0.16;
        const tilt = i % 2 === 0 ? 0.5 : -0.5;
        const g = new THREE.BoxGeometry(0.08, len, 0.06);
        g.rotateZ(tilt);
        g.translate(off, y - len / 2, 0);
        g.rotateY(rotY);
        g.translate(x, 0, z);
        geos.push(g);
        y -= len * 0.9;
        off += Math.sin(tilt) * len * 0.9 * -1;
      }
    };
    strip(minX + (maxX - minX) * 0.5, minZ - 0.06, 0);
    strip(minX - 0.06, minZ + (maxZ - minZ) * 0.45, Math.PI / 2);
    strip(maxX + 0.06, minZ + (maxZ - minZ) * 0.6, Math.PI / 2);
    strip(minX + (maxX - minX) * 0.2, maxZ + 0.06, 0);
    const merged = mergeBoxes(geos);
    return new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ color: '#3e2723' }));
  }

  private instanced(pieces: Piece[], mat: THREE.Material, color: string): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, pieces.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color(color);
    pieces.forEach((p, i) => {
      m.compose(new THREE.Vector3(p.center.x, p.center.y, p.center.z), new THREE.Quaternion(), new THREE.Vector3(p.size.x, p.size.y, p.size.z));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    return mesh;
  }

  dispose(): void {
    for (const c of this.colliders) this.phys.removeCollider(c);
    this.colliders.length = 0;
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
    this.group.removeFromParent();
  }
}

function half(s: Vec3Like): Vec3Like {
  return { x: s.x / 2, y: s.y / 2, z: s.z / 2 };
}

/** Concatenates non-indexed copies of box geometries (positions + normals) into one geometry. */
function mergeBoxes(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = geos.map((g) => g.toNonIndexed());
  const total = parts.reduce((s, g) => s + g.getAttribute('position').count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
    o += g.getAttribute('position').count;
    g.dispose();
  }
  for (const g of geos) g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
