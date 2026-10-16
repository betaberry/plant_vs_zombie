// First-person view models rendered in a separate overlay pass (no wall clipping):
// 豌豆枪 for the gunner, seed-holding hands for the sunflower, plus shovel / held item (FR-CHR-02).
import * as THREE from 'three';
import { toonMaterial } from './renderer';

export type HeldVisual = 'gun' | 'hands' | 'shovel' | 'item';

function box(w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toonMaterial(color));
  m.position.set(x, y, z);
  return m;
}

function cyl(r: number, len: number, color: string, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), toonMaterial(color));
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(65, 1, 0.01, 10);
  private readonly root = new THREE.Group();
  private readonly gun = new THREE.Group();
  private readonly hands = new THREE.Group();
  private readonly shovel = new THREE.Group();
  private readonly item = new THREE.Group();
  private readonly itemMesh: THREE.Mesh;
  private kick = 0;
  private reloadDip = 0;
  private actionDip = 0;
  private swayT = 0;
  private adsT = 0;
  current: HeldVisual = 'hands';

  constructor() {
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#556b2f', 2.2));
    const d = new THREE.DirectionalLight('#ffffff', 1.4);
    d.position.set(1, 2, 1);
    this.scene.add(d);
    // Pea gun: green barrel with a pod magazine.
    this.gun.add(box(0.09, 0.11, 0.42, '#558b2f', 0, 0, -0.1));
    this.gun.add(cyl(0.035, 0.36, '#7cb342', 0, 0.03, -0.45));
    this.gun.add(cyl(0.05, 0.05, '#33691e', 0, 0.03, -0.64));
    this.gun.add(box(0.05, 0.12, 0.06, '#827717', 0, -0.1, 0.02));
    this.gun.add(box(0.06, 0.07, 0.14, '#9ccc65', 0, -0.06, -0.22));
    this.gun.add(box(0.07, 0.07, 0.2, '#ffccbc', 0.02, -0.12, 0.12));
    this.gun.position.set(0.22, -0.2, -0.35);
    // Sunflower hands cupping a seed (no weapon).
    this.hands.add(box(0.08, 0.06, 0.22, '#ffd54f', -0.07, 0, 0));
    this.hands.add(box(0.08, 0.06, 0.22, '#ffd54f', 0.07, 0, 0));
    const seed = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), toonMaterial('#6d4c41'));
    seed.position.set(0, 0.05, -0.04);
    this.hands.add(seed);
    this.hands.position.set(0, -0.24, -0.4);
    // Shovel.
    this.shovel.add(box(0.03, 0.03, 0.5, '#8d6e63', 0, 0, -0.1));
    this.shovel.add(box(0.14, 0.02, 0.16, '#90a4ae', 0, 0, -0.42));
    this.shovel.position.set(0.2, -0.22, -0.3);
    this.shovel.rotation.x = -0.4;
    // Generic held item (seed packet / potion / medkit) tinted per item.
    this.itemMesh = box(0.12, 0.16, 0.04, '#ffffff');
    this.item.add(this.itemMesh);
    this.item.add(box(0.07, 0.06, 0.18, '#ffccbc', 0, -0.1, 0.06));
    this.item.position.set(0.18, -0.2, -0.38);
    this.root.add(this.gun, this.hands, this.shovel, this.item);
    this.scene.add(this.root);
    this.show('hands');
  }

  show(v: HeldVisual, itemColor?: string): void {
    this.current = v;
    this.gun.visible = v === 'gun';
    this.hands.visible = v === 'hands';
    this.shovel.visible = v === 'shovel';
    this.item.visible = v === 'item';
    if (itemColor) ((this.itemMesh.material as THREE.MeshToonMaterial).color as THREE.Color).set(itemColor);
  }

  fireKick(): void {
    this.kick = 1;
  }

  actionKick(): void {
    this.actionDip = 1;
  }

  update(dt: number, s: { moving: boolean; sprinting: boolean; ads: boolean; reloading: boolean; aspect: number }): void {
    this.camera.aspect = s.aspect;
    this.camera.updateProjectionMatrix();
    this.kick = Math.max(0, this.kick - dt * 10);
    this.actionDip = Math.max(0, this.actionDip - dt * 3);
    this.reloadDip += ((s.reloading ? 1 : 0) - this.reloadDip) * Math.min(1, dt * 10);
    this.adsT += ((s.ads ? 1 : 0) - this.adsT) * Math.min(1, dt * 14);
    if (s.moving) this.swayT += dt * (s.sprinting ? 12 : 8);
    const sway = s.moving ? 1 : 0.2;
    this.root.position.set(Math.cos(this.swayT * 0.5) * 0.012 * sway, Math.abs(Math.sin(this.swayT * 0.5)) * 0.012 * sway, 0);
    this.gun.position.set(0.22 * (1 - this.adsT), -0.2 + 0.1 * this.adsT - this.reloadDip * 0.15, -0.35 + this.kick * 0.05);
    this.gun.rotation.set(this.kick * 0.12 + this.reloadDip * 0.6, 0, this.reloadDip * 0.3);
    this.hands.position.y = -0.24 - this.actionDip * 0.08;
    this.shovel.rotation.x = -0.4 - this.actionDip * 0.8;
    this.item.position.y = -0.2 - this.actionDip * 0.1;
  }

  render(renderer: THREE.WebGLRenderer): void {
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }
}
