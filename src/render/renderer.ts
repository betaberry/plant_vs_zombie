// Scene, lights, toon materials and quality presets (13.8-A cartoon low-poly; FR-UI-07).
import * as THREE from 'three';
import type { QualityPreset } from '../config/types';

let gradient: THREE.DataTexture | null = null;

/** 3-step gradient for MeshToonMaterial. */
export function toonGradient(): THREE.DataTexture {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

export function toonMaterial(color: THREE.ColorRepresentation, opts: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  private quality: QualityPreset | null = null;

  constructor(canvas: HTMLCanvasElement) {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      throw new Error(`无法创建 WebGL2 渲染器，请使用最新版 Chrome / Edge：${err instanceof Error ? err.message : String(err)}`);
    }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Count draw calls across the world pass and the view-model pass (F3 panel, NFR1).
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color('#9fd6ff');
    this.scene.fog = new THREE.Fog('#bfe3ff', 80, 260);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#7a8b5a', 1.6));
    this.sun = new THREE.DirectionalLight('#fff4d6', 2.2);
    this.sun.position.set(60, 120, 40);
    const cam = this.sun.shadow.camera;
    cam.left = -70;
    cam.right = 70;
    cam.top = 70;
    cam.bottom = -70;
    cam.near = 10;
    cam.far = 300;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);
  }

  applyQuality(q: QualityPreset): void {
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatioCap));
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    if (q.shadows && this.sun.shadow.mapSize.x !== q.shadowMapSize) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    const fog = this.scene.fog as THREE.Fog;
    fog.far = q.drawDistance;
    fog.near = q.drawDistance * 0.35;
    // Materials must recompile when the shadow map is toggled.
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else if (m) m.needsUpdate = true;
    });
  }

  get particleScale(): number {
    return this.quality?.particleScale ?? 1;
  }

  resize(camera: THREE.PerspectiveCamera): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /** Shadow frustum follows the player so a small map covers the visible area. */
  followShadows(x: number, z: number): void {
    this.sun.position.set(x + 60, 120, z + 40);
    this.sun.target.position.set(x, 0, z);
  }

  render(camera: THREE.Camera): void {
    this.renderer.info.reset();
    this.renderer.render(this.scene, camera);
  }

  stats(): { drawCalls: number; triangles: number } {
    const info = this.renderer.info.render;
    return { drawCalls: info.calls, triangles: info.triangles };
  }
}
