// Static training dummy for target practice (M2 acceptance: KPI-01 three torso shots).
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3Like } from '../core/events';
import { store } from '../core/store';
import { applyHealthDamage, type DamageInfo, type DamageResult } from '../logic/attackable';
import type { HitZoneDef } from '../logic/hitzone';
import type { PhysicsWorld } from '../physics/world';
import { toonMaterial } from '../render/renderer';
import type { ShootTarget } from './weapon';

export class TrainingDummy implements ShootTarget {
  readonly attackableId = 'dummy';
  readonly team = 'zombie' as const;
  private health: number;
  private resetTimer = 0;
  private flash = 0;
  private readonly group = new THREE.Group();
  private readonly mats: THREE.MeshToonMaterial[] = [];
  readonly body: RAPIER.RigidBody;

  constructor(scene: THREE.Scene, phys: PhysicsWorld, private readonly feet: Vec3Like) {
    const z = store.config.zombies.basic_zombie;
    this.health = z.health;
    const part = (w: number, h: number, d: number, y: number, color: string): void => {
      const mat = toonMaterial(color);
      this.mats.push(mat);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.y = y;
      m.castShadow = true;
      this.group.add(m);
    };
    part(0.12, 0.85, 0.12, 0.42, '#8d6e63');
    part(0.5, 0.65, 0.3, 1.18, '#d7ccc8');
    part(0.34, 0.3, 0.3, 1.65, '#ffccbc');
    part(0.9, 0.08, 0.08, 1.3, '#8d6e63');
    this.group.position.set(feet.x, feet.y, feet.z);
    scene.add(this.group);
    const half = z.colliderHeight / 2 - z.colliderRadius;
    const { body } = phys.addKinematicCapsule({ x: feet.x, y: feet.y + z.colliderHeight / 2, z: feet.z }, half, z.colliderRadius, {
      team: 'zombie', entityId: 'dummy', material: 'wood',
    });
    this.body = body;
  }

  position(): Vec3Like {
    return { ...this.feet };
  }

  isAlive(): boolean {
    return this.health > 0;
  }

  ignoresRays(): boolean {
    return this.health <= 0;
  }

  hitZoneDef(): HitZoneDef {
    return store.config.zombies.basic_zombie;
  }

  localHit(point: Vec3Like): { localY: number; lateral: number } {
    return { localY: point.y - this.feet.y, lateral: point.x - this.feet.x };
  }

  applyDamage(amount: number, _info: DamageInfo): DamageResult {
    const state = { health: this.health };
    const res = applyHealthDamage(state, amount);
    this.health = state.health;
    this.flash = 1;
    if (res.applied > 0) store.events.emit('floatText', { text: `-${Math.round(res.applied)}`, kind: 'info' });
    if (res.killed) {
      this.resetTimer = 2;
      store.events.emit('banner', { text: '假人被击倒！', kind: 'info' });
    }
    return res;
  }

  update(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 8);
    this.mats.forEach((m) => m.emissive.setScalar(this.flash * 0.8));
    if (this.health <= 0) {
      this.resetTimer -= dt;
      this.group.rotation.x = Math.min(Math.PI / 2, this.group.rotation.x + dt * 4);
      if (this.resetTimer <= 0) {
        this.health = store.config.zombies.basic_zombie.health;
        this.group.rotation.x = 0;
      }
    }
  }
}
