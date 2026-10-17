// Minimap (FR-MAP-10): north-up, explored-area fog, buildings, high-value areas, supply crates, player arrow.
import type { MapConfig, RingMapConfig } from '../config/types';
import type { Vec3Like } from '../core/events';
import type { CityLayout } from '../world/layout';
import type { RingLayout } from '../world/ringLayout';
import { el } from './dom';

const FOG_CELLS = 30;

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private readonly bg: HTMLCanvasElement;
  private readonly explored = new Uint8Array(FOG_CELLS * FOG_CELLS);
  private readonly size = 220;

  constructor(private readonly map: MapConfig, layout: CityLayout) {
    this.canvas = el('canvas', { class: 'minimap', width: this.size, height: this.size, testid: 'hud-minimap' });
    this.bg = document.createElement('canvas');
    this.bg.width = this.bg.height = this.size;
    const g = this.bg.getContext('2d');
    if (!g) throw new Error('2D canvas unavailable for minimap');
    const k = this.size / map.size[0];
    const tx = (x: number): number => (x + map.size[0] / 2) * k;
    const tz = (z: number): number => (z + map.size[1] / 2) * k;
    g.fillStyle = '#6b8e3a';
    g.fillRect(0, 0, this.size, this.size);
    g.fillStyle = '#546e7a';
    const rw = map.roads.halfWidth;
    g.fillRect(tx(-rw), 0, rw * 2 * k, this.size);
    g.fillRect(0, tz(-rw), this.size, rw * 2 * k);
    g.fillStyle = 'rgba(255,82,82,0.35)';
    for (const h of map.highValueAreas) g.fillRect(tx(h.rect[0]), tz(h.rect[1]), (h.rect[2] - h.rect[0]) * k, (h.rect[3] - h.rect[1]) * k);
    for (const b of layout.buildings) {
      g.fillStyle = b.enterable ? '#ffe0b2' : '#bdbdbd';
      g.fillRect(tx(b.rect.minX), tz(b.rect.minZ), (b.rect.maxX - b.rect.minX) * k, (b.rect.maxZ - b.rect.minZ) * k);
    }
  }

  update(player: Vec3Like, yaw: number, crates: Vec3Like[]): void {
    const g = this.canvas.getContext('2d');
    if (!g) return;
    const [W, D] = this.map.size;
    const cx = Math.floor(((player.x + W / 2) / W) * FOG_CELLS);
    const cz = Math.floor(((player.z + D / 2) / D) * FOG_CELLS);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const x = cx + dx;
      const z = cz + dz;
      if (x >= 0 && z >= 0 && x < FOG_CELLS && z < FOG_CELLS) this.explored[z * FOG_CELLS + x] = 1;
    }
    g.drawImage(this.bg, 0, 0);
    const cell = this.size / FOG_CELLS;
    g.fillStyle = 'rgba(10,15,10,0.75)';
    for (let z = 0; z < FOG_CELLS; z++) for (let x = 0; x < FOG_CELLS; x++) if (!this.explored[z * FOG_CELLS + x]) g.fillRect(x * cell, z * cell, cell + 0.5, cell + 0.5);
    const k = this.size / W;
    g.fillStyle = '#e53935';
    for (const c of crates) g.fillRect((c.x + W / 2) * k - 2, (c.z + D / 2) * k - 2, 4, 4);
    const px = (player.x + W / 2) * k;
    const pz = (player.z + D / 2) * k;
    g.save();
    g.translate(px, pz);
    g.rotate(-yaw);
    g.fillStyle = '#ffeb3b';
    g.beginPath();
    g.moveTo(0, -7);
    g.lineTo(5, 5);
    g.lineTo(0, 2);
    g.lineTo(-5, 5);
    g.closePath();
    g.fill();
    g.restore();
  }
}

/**
 * Guard mode minimap (FR12.3): north-up ring map — lanes, wall bands, the core, entrances (open ones
 * highlighted), the boss and the player's facing. No fog: the arena is small and fully known.
 */
export class RingMinimap {
  readonly canvas: HTMLCanvasElement;
  private readonly bg: HTMLCanvasElement;
  private readonly size = 220;
  private readonly k: number;

  constructor(private readonly map: RingMapConfig, private readonly ring: RingLayout) {
    this.canvas = el('canvas', { class: 'minimap', width: this.size, height: this.size, testid: 'hud-minimap' });
    this.bg = document.createElement('canvas');
    this.bg.width = this.bg.height = this.size;
    const g = this.bg.getContext('2d');
    if (!g) throw new Error('2D canvas unavailable for minimap');
    this.k = this.size / map.size[0];
    const c = this.size / 2;
    g.fillStyle = '#4e5d3a';
    g.fillRect(0, 0, this.size, this.size);
    const half = map.laneWidth / 2;
    // Wall bands: fill the whole disc grey, then paint the lanes green over it.
    g.fillStyle = '#8d8d8d';
    g.beginPath();
    g.arc(c, c, (map.rings[0]!.radius + half + map.outerWallThickness) * this.k, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#7cb342';
    g.lineWidth = map.laneWidth * this.k;
    for (const r of map.rings) {
      g.beginPath();
      g.arc(c, c, r.radius * this.k, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = '#7cb342';
    g.beginPath();
    g.arc(c, c, (map.rings[map.rings.length - 1]!.radius + half) * this.k, 0, Math.PI * 2);
    g.fill();
    // Ramps and the elevated walkway.
    g.fillStyle = '#9ccc65';
    for (const s of ring.walkSamples) if (s.where.startsWith('ramp')) g.fillRect(this.tx(s.pos.x) - 3, this.tz(s.pos.z) - 3, 6, 6);
    g.fillStyle = '#a1887f';
    for (const s of ring.walkSamples) if (s.where === 'elevated') g.fillRect(this.tx(s.pos.x) - 2, this.tz(s.pos.z) - 2, 4, 4);
    const r = ring.core.rect;
    g.fillStyle = '#ffe082';
    g.fillRect(this.tx(r.minX), this.tz(r.minZ), (r.maxX - r.minX) * this.k, (r.maxZ - r.minZ) * this.k);
  }

  private tx(x: number): number {
    return (x + this.map.size[0] / 2) * this.k;
  }

  private tz(z: number): number {
    return (z + this.map.size[1] / 2) * this.k;
  }

  update(player: Vec3Like, yaw: number, openEntrances: number, coreLow: boolean, boss: Vec3Like | null, time: number): void {
    const g = this.canvas.getContext('2d');
    if (!g) return;
    g.drawImage(this.bg, 0, 0);
    this.ring.entrances.forEach((e, i) => {
      const gate = e.spawnPoints[0]!;
      const open = i < openEntrances;
      g.fillStyle = open ? '#ff5252' : '#616161';
      g.beginPath();
      g.arc(this.tx(gate.x), this.tz(gate.z), open ? 6 : 4, 0, Math.PI * 2);
      g.fill();
    });
    if (coreLow && Math.sin(time * Math.PI * 3) > 0) {
      const r = this.ring.core.rect;
      g.fillStyle = 'rgba(229,57,53,0.85)';
      g.fillRect(this.tx(r.minX), this.tz(r.minZ), (r.maxX - r.minX) * this.k, (r.maxZ - r.minZ) * this.k);
    }
    if (boss) {
      g.fillStyle = '#d50000';
      g.fillRect(this.tx(boss.x) - 4, this.tz(boss.z) - 4, 8, 8);
    }
    g.save();
    g.translate(this.tx(player.x), this.tz(player.z));
    g.rotate(-yaw);
    g.fillStyle = '#ffeb3b';
    g.beginPath();
    g.moveTo(0, -7);
    g.lineTo(5, 5);
    g.lineTo(0, 2);
    g.lineTo(-5, 5);
    g.closePath();
    g.fill();
    g.restore();
  }
}
