// Pooled point-sprite particles (豌豆汁、血花、阳光、破土、枯萎、爆炸、结霜) — one draw call, no per-frame allocation.
import * as THREE from 'three';
import type { Vec3Like } from '../core/events';
import type { Rng } from '../core/rng';

export type ParticleKind = 'pea_juice' | 'dust' | 'sun' | 'dirt' | 'wither' | 'explosion' | 'frost' | 'shell' | 'soft' | 'muzzle' | 'smoke' | 'impact';

interface Preset {
  colors: string[];
  speed: [number, number];
  up: number;
  gravity: number;
  life: [number, number];
  count: number;
}

const PRESETS: Record<ParticleKind, Preset> = {
  pea_juice: { colors: ['#7cb342', '#9ccc65', '#558b2f'], speed: [1.5, 4], up: 1.5, gravity: -9, life: [0.3, 0.6], count: 14 },
  dust: { colors: ['#9e9e9e', '#bdbdbd'], speed: [0.5, 2], up: 0.8, gravity: -4, life: [0.2, 0.5], count: 6 },
  sun: { colors: ['#ffeb3b', '#ffc107', '#fff176'], speed: [0.2, 0.8], up: 1.6, gravity: 0.5, life: [0.8, 1.3], count: 6 },
  dirt: { colors: ['#6d4c41', '#8d6e63', '#a1887f'], speed: [1, 3], up: 3, gravity: -12, life: [0.4, 0.8], count: 18 },
  wither: { colors: ['#795548', '#9e9d24', '#5d4037'], speed: [0.5, 2], up: 1, gravity: -6, life: [0.6, 1.2], count: 22 },
  explosion: { colors: ['#ff7043', '#ffca28', '#ff5722', '#5d4037'], speed: [4, 10], up: 4, gravity: -6, life: [0.5, 1.0], count: 70 },
  frost: { colors: ['#b3e5fc', '#e1f5fe', '#4fc3f7'], speed: [0.8, 2.5], up: 1, gravity: -3, life: [0.4, 0.8], count: 12 },
  shell: { colors: ['#a1887f', '#d7ccc8'], speed: [1, 3], up: 2, gravity: -10, life: [0.4, 0.7], count: 8 },
  soft: { colors: ['#c5e1a5', '#f1f8e9'], speed: [0.5, 1.5], up: 0.5, gravity: -4, life: [0.2, 0.35], count: 6 },
  muzzle: { colors: ['#dcedc8', '#aed581'], speed: [0.5, 1.2], up: 0, gravity: 0, life: [0.05, 0.1], count: 4 },
  /** Guard mode: smoke rising from a badly damaged core house (FR3.4 stage 3+). */
  smoke: { colors: ['#424242', '#616161', '#757575'], speed: [0.1, 0.5], up: 2.2, gravity: 0.6, life: [1.2, 2.2], count: 5 },
  /** Guard mode: gargantuar pole smash hitting the ground (FR8.3). */
  impact: { colors: ['#6d4c41', '#8d6e63', '#bdbdbd', '#9e9e9e'], speed: [3, 7], up: 3.5, gravity: -12, life: [0.4, 0.9], count: 45 },
};

export class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private grav: Float32Array;
  private next = 0;
  scale = 1;
  private tmp = new THREE.Color();

  constructor(scene: THREE.Scene, private readonly rng: Rng, private readonly capacity = 2000) {
    this.pos = new Float32Array(capacity * 3).fill(-9999);
    this.col = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({ size: 0.14, vertexColors: true, sizeAttenuation: true, depthWrite: false });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(kind: ParticleKind, at: Vec3Like, countScale = 1): void {
    const p = PRESETS[kind];
    const n = Math.max(1, Math.round(p.count * countScale * this.scale));
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.capacity;
      const a = this.rng.range(0, Math.PI * 2);
      const s = this.rng.range(p.speed[0], p.speed[1]);
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([Math.cos(a) * s, p.up * this.rng.range(0.5, 1.2), Math.sin(a) * s], i * 3);
      this.tmp.set(this.rng.pick(p.colors));
      this.col.set([this.tmp.r, this.tmp.g, this.tmp.b], i * 3);
      this.life[i] = this.rng.range(p.life[0], p.life[1]);
      this.grav[i] = p.gravity;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i]! -= dt;
      const j = i * 3;
      if (this.life[i]! <= 0) {
        this.pos[j + 1] = -9999;
        continue;
      }
      this.vel[j + 1]! += this.grav[i]! * dt;
      this.pos[j]! += this.vel[j]! * dt;
      this.pos[j + 1]! += this.vel[j + 1]! * dt;
      this.pos[j + 2]! += this.vel[j + 2]! * dt;
    }
    const geo = this.points.geometry;
    geo.attributes.position!.needsUpdate = true;
    geo.attributes.color!.needsUpdate = true;
  }
}
