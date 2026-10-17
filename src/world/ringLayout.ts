// Pure ring-map layout generator (guard mode, FR2.1–FR2.4): turns map_ring_01.json into the same CityLayout
// shape the city uses (boxes, obstacles, nav nodes / edges, no-plant zones) plus ring-specific data.
// No Three.js / Rapier / DOM. Polar convention: x = r·cos θ, z = r·sin θ (θ in degrees).
//
// Geometry: each ring id is a lane centre-line; lanes are laneWidth wide. Solid wall bands fill the space
// between neighbouring lanes, approximated by short rotated boxes; ramps are gaps through a band (2 per
// ring link). The outer wall has the 4 entrance gaps. The inner lane opens onto the plaza around the core.
// The elevated layer is the top of one wall band over an arc, reached by 2 stairs from the outer lane.
// Navigation is explicit (no flat grid): lane centre-line loops, ramp / stair / entrance chains, the
// elevated walkway, and approach nodes just outside the core walls — never inside the core house.
import type { RingId, RingMapConfig, ZoneDef } from '../config/types';
import type { Vec3Like } from '../core/events';
import type { Rect2 } from '../logic/math';
import type { BoxSpec, CityLayout } from './layout';

export interface RingEntranceInfo {
  id: string;
  angleDeg: number;
  /** Nav node key at the entrance gap. */
  gateKey: string;
  spawnPoints: Vec3Like[];
}

export interface RingLayout extends CityLayout {
  kind: 'ring';
  plantableZones: ZoneDef[];
  core: { rect: Rect2; center: Vec3Like; height: number };
  /** Nav nodes just outside the core walls: where zombies stand to attack the house. */
  coreApproachKeys: string[];
  entrances: RingEntranceInfo[];
  playerSpawns: Vec3Like[];
  /** Points on every lane centre-line, the elevated walkway and the ramp passages (tests, minimap). */
  walkSamples: { where: string; pos: Vec3Like }[];
  landmarks: { id: string; kind: string; pos: Vec3Like }[];
}

const DEG = Math.PI / 180;
const ARC_POINTS = 96;
const STEP_RISE = 0.25;
const STEP_RUN = 0.35;
const RAIL = 0.2;
const CORE_NO_PLANT_MARGIN = 0.5;

export function polar(radius: number, angleDeg: number, y = 0): Vec3Like {
  return { x: radius * Math.cos(angleDeg * DEG), y, z: radius * Math.sin(angleDeg * DEG) };
}

/** Smallest absolute difference between two angles in degrees (0..180). */
export function angleDistDeg(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

function inArc(a: number, from: number, to: number): boolean {
  const span = (((to - from) % 360) + 360) % 360;
  return (((a - from) % 360) + 360) % 360 <= span;
}

// ---------- zone polygons ----------

function arcPoints(r: number, from: number, to: number, n: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const p = polar(r, from + ((to - from) * i) / n);
    pts.push([p.x, p.z]);
  }
  return pts;
}

/** Annulus as one keyhole polygon (outer loop, then inner loop reversed); even-odd point tests cancel the seam. */
export function annulusZone(id: string, type: string, rIn: number, rOut: number): ZoneDef {
  return { id, type, points: [...arcPoints(rOut, 0, 360, ARC_POINTS), ...arcPoints(rIn, 360, 0, ARC_POINTS)] };
}

function sectorZone(id: string, type: string, rIn: number, rOut: number, from: number, to: number): ZoneDef {
  const span = (((to - from) % 360) + 360) % 360;
  const n = Math.max(2, Math.ceil((span / 360) * ARC_POINTS));
  return { id, type, points: [...arcPoints(rOut, from, from + span, n), ...arcPoints(rIn, from + span, from, n)] };
}

function diskZone(id: string, type: string, r: number): ZoneDef {
  return { id, type, points: arcPoints(r, 0, 360, ARC_POINTS).slice(0, -1) };
}

function rectZone(id: string, type: string, r: Rect2): ZoneDef {
  return { id, type, points: [[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ]] };
}

// ---------- builder ----------

class RingBuilder {
  readonly out: RingLayout;
  readonly half: number;
  private laneCount = new Map<RingId, number>();

  constructor(readonly map: RingMapConfig) {
    this.half = map.laneWidth / 2;
    const [cx, cz] = map.core.center;
    const [sx, sz] = map.core.size;
    this.out = {
      kind: 'ring', boxes: [], signs: [], doors: [], obstacles: [], buildings: [], navNodes: [], navEdges: [], doorLinks: [],
      extraNoPlantZones: [], plantableZones: [], coreApproachKeys: [], entrances: [], playerSpawns: [], walkSamples: [], landmarks: [],
      core: { rect: { minX: cx - sx / 2, minZ: cz - sz / 2, maxX: cx + sx / 2, maxZ: cz + sz / 2 }, center: { x: cx, y: 0, z: cz }, height: map.core.height },
    };
  }

  radius(id: RingId): number {
    return this.map.rings.find((r) => r.id === id)!.radius;
  }

  node(key: string, pos: Vec3Like): string {
    this.out.navNodes.push({ key, pos, tag: 'outdoor' });
    return key;
  }

  edge(a: string, b: string): void {
    this.out.navEdges.push([a, b]);
  }

  /** Rotated box spanning [rIn, rOut] radially and [a0, a1] degrees; also records its axis-aligned obstacle. */
  arcBox(rIn: number, rOut: number, a0: number, a1: number, y0: number, y1: number, color: string, opts: Partial<BoxSpec> = {}): void {
    const mid = (a0 + a1) / 2;
    const c = polar((rIn + rOut) / 2, mid, (y0 + y1) / 2);
    const chord = 2 * rOut * Math.sin(((a1 - a0) / 2) * DEG) + 0.05;
    const depth = rOut - rIn;
    this.out.boxes.push({ center: c, size: { x: chord, y: y1 - y0, z: depth }, rotY: -mid * DEG - Math.PI / 2, color, collide: true, surface: 'concrete', layer: 'solid', shadow: true, ...opts });
    if (opts.collide === false) return;
    const corners = [polar(rIn, a0), polar(rIn, a1), polar(rOut, a0), polar(rOut, a1), polar(rOut, mid)];
    this.out.obstacles.push({
      minX: Math.min(...corners.map((p) => p.x)), maxX: Math.max(...corners.map((p) => p.x)),
      minZ: Math.min(...corners.map((p) => p.z)), maxZ: Math.max(...corners.map((p) => p.z)),
    });
  }

  // ----- lanes -----

  lanes(): void {
    const spacing = this.map.nav.laneNodeSpacing;
    for (const ring of this.map.rings) {
      const n = Math.max(8, Math.round((2 * Math.PI * ring.radius) / spacing));
      this.laneCount.set(ring.id, n);
      for (let k = 0; k < n; k++) {
        this.node(this.laneKey(ring.id, k), polar(ring.radius, (k * 360) / n));
        if (k > 0) this.edge(this.laneKey(ring.id, k - 1), this.laneKey(ring.id, k));
      }
      this.edge(this.laneKey(ring.id, n - 1), this.laneKey(ring.id, 0));
      for (let a = 0; a < 360; a += 15) this.out.walkSamples.push({ where: `lane:${ring.id}`, pos: polar(ring.radius, a) });
    }
  }

  laneKey(id: RingId, k: number): string {
    return `lane:${id}:${k}`;
  }

  /** Lane node closest to an angle. */
  laneAt(id: RingId, angleDeg: number): string {
    const n = this.laneCount.get(id)!;
    const k = ((Math.round(((((angleDeg % 360) + 360) % 360) / 360) * n) % n) + n) % n;
    return this.laneKey(id, k);
  }

  // ----- walls -----

  /** Gap half-angles (deg) cut into the band / wall at radius r. */
  private gaps(list: { angleDeg: number; width: number }[], r: number): { angle: number; half: number }[] {
    return list.map((g) => ({ angle: g.angleDeg, half: (g.width / 2 / r) / DEG }));
  }

  private band(rIn: number, rOut: number, gaps: { angle: number; half: number }[], heightAt: (a: number) => number, color: string): void {
    const step = this.map.wallSegmentDeg;
    for (let a0 = 0; a0 < 360 - 1e-9; a0 += step) {
      const a1 = a0 + step;
      const mid = (a0 + a1) / 2;
      if (gaps.some((g) => angleDistDeg(mid, g.angle) < g.half + step / 2)) continue;
      this.arcBox(rIn, rOut, a0, a1, 0, heightAt(mid), color);
    }
  }

  walls(): void {
    const m = this.map;
    const h = this.half;
    for (let i = 0; i + 1 < m.rings.length; i++) {
      const a = m.rings[i]!;
      const b = m.rings[i + 1]!;
      const rIn = b.radius + h;
      const rOut = a.radius - h;
      const ramps = m.ramps.filter((r) => r.from === a.id && r.to === b.id);
      const elevatedHere = m.elevated.between[0] === a.id && m.elevated.between[1] === b.id;
      const heightAt = (ang: number): number => (elevatedHere && inArc(ang, m.elevated.fromDeg, m.elevated.toDeg) ? m.elevated.height : m.wallHeight);
      this.band(rIn, rOut, this.gaps(ramps, (rIn + rOut) / 2), heightAt, '#8d8d8d');
    }
    const outer = m.rings[0]!.radius + h;
    this.band(outer, outer + m.outerWallThickness, this.gaps(m.entrances, outer), () => m.wallHeight, '#6d6d6d');
    const S = m.size[0] / 2;
    this.out.boxes.push({ center: { x: 0, y: -0.5, z: 0 }, size: { x: m.size[0] + 40, y: 1, z: m.size[1] + 40 }, color: '#7cb342', collide: true, surface: 'concrete', layer: 'ground', shadow: false });
    for (const [cx, cz, sx, sz] of [[0, -S, 2 * S, 2], [0, S, 2 * S, 2], [-S, 0, 2, 2 * S], [S, 0, 2, 2 * S]] as const) {
      this.out.boxes.push({ center: { x: cx, y: m.wallHeight / 2, z: cz }, size: { x: sx, y: m.wallHeight, z: sz }, color: '#6d6d6d', collide: true, surface: 'concrete', layer: 'solid', shadow: true });
    }
  }

  // ----- ramps (passages through a wall band) -----

  ramps(): void {
    const spacing = this.map.nav.laneNodeSpacing;
    for (const r of this.map.ramps) {
      const rf = this.radius(r.from);
      const rt = this.radius(r.to);
      const segs = Math.max(2, Math.ceil((rf - rt) / spacing));
      let prev = this.laneAt(r.from, r.angleDeg);
      for (let i = 1; i < segs; i++) {
        const key = this.node(`ramp:${r.id}:${i}`, polar(rf - ((rf - rt) * i) / segs, r.angleDeg));
        this.edge(prev, key);
        prev = key;
      }
      this.edge(prev, this.laneAt(r.to, r.angleDeg));
      const rIn = rt + this.half;
      const rOut = rf - this.half;
      const halfDeg = (r.width / 2 / ((rIn + rOut) / 2)) / DEG;
      this.out.plantableZones.push(sectorZone(`plant_${r.id}`, 'ramp', rIn - 0.5, rOut + 0.5, r.angleDeg - halfDeg, r.angleDeg + halfDeg));
      this.out.walkSamples.push({ where: `ramp:${r.id}`, pos: polar((rIn + rOut) / 2, r.angleDeg) });
    }
  }

  // ----- elevated walkway + stairs -----

  elevated(): void {
    const el = this.map.elevated;
    const rOut = this.radius(el.between[0]) - this.half;
    const rIn = this.radius(el.between[1]) + this.half;
    const rMid = (rIn + rOut) / 2;
    const span = (((el.toDeg - el.fromDeg) % 360) + 360) % 360;
    const n = Math.max(2, Math.round((span * DEG * rMid) / this.map.nav.laneNodeSpacing));
    for (let k = 0; k <= n; k++) {
      this.node(`elev:${k}`, polar(rMid, el.fromDeg + (span * k) / n, el.height));
      if (k > 0) this.edge(`elev:${k - 1}`, `elev:${k}`);
    }
    for (let a = 10; a < span; a += 20) this.out.walkSamples.push({ where: 'elevated', pos: polar(rMid, el.fromDeg + a, el.height) });
    this.out.plantableZones.push(sectorZone('plant_elevated', 'elevated', rIn + RAIL, rOut - RAIL, el.fromDeg, el.toDeg));
    const stairAngles = this.map.stairs.map((s) => s.angleDeg);
    const step = this.map.wallSegmentDeg;
    for (let a0 = el.fromDeg; a0 < el.fromDeg + span - 1e-9; a0 += step) {
      const a1 = Math.min(a0 + step, el.fromDeg + span);
      this.arcBox(rIn, rIn + RAIL, a0, a1, el.height, el.height + el.railHeight, '#5d4037');
      if (!stairAngles.some((s) => angleDistDeg((a0 + a1) / 2, s) < step)) this.arcBox(rOut - RAIL, rOut, a0, a1, el.height, el.height + el.railHeight, '#5d4037');
    }
    for (const s of this.map.stairs) this.stair(s, rOut, span, n);
  }

  /** Steps along the outer lane's inner edge, rising toward the stair angle where they meet the walkway. */
  private stair(s: RingMapConfig['stairs'][number], bandEdge: number, span: number, n: number): void {
    const el = this.map.elevated;
    const steps = Math.ceil(el.height / STEP_RISE);
    const rise = el.height / steps;
    const r0 = bandEdge;
    const r1 = bandEdge + s.width;
    const rS = (r0 + r1) / 2;
    const stepDeg = (STEP_RUN / rS) / DEG;
    const startDeg = s.angleDeg - steps * stepDeg;
    for (let i = 0; i < steps; i++) {
      this.arcBox(r0, r1, startDeg + i * stepDeg, startDeg + (i + 1) * stepDeg, 0, (i + 1) * rise, '#8d6e63', { surface: 'wood' });
    }
    this.out.extraNoPlantZones.push(sectorZone(`np_${s.id}`, 'stairs', r0 - 0.3, r1 + 0.3, startDeg - 1, s.angleDeg + 1));
    const bottom = this.node(`stair:${s.id}:bottom`, polar(rS, startDeg - (1 / rS) / DEG));
    const top = this.node(`stair:${s.id}:top`, polar(r0 - 1, s.angleDeg, el.height));
    this.edge(this.laneAt(this.map.elevated.between[0], startDeg), bottom);
    this.edge(bottom, top);
    const k = Math.round(((((s.angleDeg - el.fromDeg) % 360) + 360) % 360) / span * n);
    this.edge(top, `elev:${Math.min(n, Math.max(0, k))}`);
  }

  // ----- core, entrances, spawns, zones -----

  core(): void {
    const c = this.out.core;
    const d = this.map.nav.coreApproachDistance;
    const { minX, minZ, maxX, maxZ } = c.rect;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const pts: [number, number][] = [[maxX + d, cz], [maxX + d, maxZ + d], [cx, maxZ + d], [minX - d, maxZ + d], [minX - d, cz], [minX - d, minZ - d], [cx, minZ - d], [maxX + d, minZ - d]];
    pts.forEach(([x, z], i) => this.out.coreApproachKeys.push(this.node(`core:${i}`, { x, y: 0, z })));
    this.out.coreApproachKeys.forEach((k, i, all) => this.edge(k, all[(i + 1) % all.length]!));
    // The inner lane opens onto the plaza: every inner lane node links to its nearest approach node.
    const inner = this.map.rings[this.map.rings.length - 1]!;
    const n = this.laneCount.get(inner.id)!;
    for (let k = 0; k < n; k++) {
      const p = polar(inner.radius, (k * 360) / n);
      let best = 0;
      pts.forEach(([x, z], i) => { if (Math.hypot(x - p.x, z - p.z) < Math.hypot(pts[best]![0] - p.x, pts[best]![1] - p.z)) best = i; });
      this.edge(this.laneKey(inner.id, k), this.out.coreApproachKeys[best]!);
    }
    this.out.obstacles.push({ ...c.rect });
    const m = CORE_NO_PLANT_MARGIN;
    this.out.extraNoPlantZones.push(rectZone('np_core', 'core', { minX: minX - m, minZ: minZ - m, maxX: maxX + m, maxZ: maxZ + m }));
  }

  entrances(): void {
    const outer = this.map.rings[0]!;
    const wallMid = outer.radius + this.half + this.map.outerWallThickness / 2;
    for (const e of this.map.entrances) {
      const gate = this.node(`gate:${e.id}`, polar(wallMid, e.angleDeg));
      const yard = this.node(`gate:${e.id}:out`, polar(wallMid + 4, e.angleDeg));
      this.edge(this.laneAt(outer.id, e.angleDeg), gate);
      this.edge(gate, yard);
      const spawns = e.spawnPoints.map((p, i) => {
        const pos = polar(p.radius, p.angleDeg);
        this.edge(yard, this.node(`spawn:${e.id}:${i}`, pos));
        return pos;
      });
      this.out.entrances.push({ id: e.id, angleDeg: e.angleDeg, gateKey: gate, spawnPoints: spawns });
    }
  }

  zones(): void {
    const rings = this.map.rings;
    const h = this.half;
    rings.forEach((r, i) => {
      const last = i === rings.length - 1;
      // The innermost lane and the plaza around the core form one plantable disk (the core is a no-plant zone).
      this.out.plantableZones.push(last ? diskZone(`plant_${r.id}`, 'lane', r.radius + h) : annulusZone(`plant_${r.id}`, 'lane', r.radius - h, r.radius + h));
    });
    this.out.playerSpawns = this.map.playerSpawns.map((s) => ({ x: s.pos[0], y: s.pos[1], z: s.pos[2] }));
    this.out.landmarks = this.map.landmarks.map((l) => ({ id: l.id, kind: l.kind, pos: polar(l.pos.radius, l.pos.angleDeg) }));
    for (const l of this.map.landmarks) this.landmark(l.kind, l.pos.radius, l.pos.angleDeg);
  }

  /**
   * Orientation landmarks standing on a wall band (FR2.5): placeholder blocks, seen from every lane.
   * They sit on top of the band (already an obstacle), so they add no nav obstacle of their own.
   */
  private landmark(kind: RingMapConfig['landmarks'][number]['kind'], r: number, deg: number): void {
    const base = this.map.wallHeight;
    const rot = -deg * DEG - Math.PI / 2;
    const at = (dr: number, dt: number, y: number): Vec3Like => {
      const c = polar(r + dr, deg, y);
      // dt: offset along the tangent (perpendicular to the radius).
      return { x: c.x - Math.sin(deg * DEG) * dt, y, z: c.z + Math.cos(deg * DEG) * dt };
    };
    const box = (center: Vec3Like, size: Vec3Like, color: string): void => {
      this.out.boxes.push({ center, size, rotY: rot, color, collide: true, surface: 'metal', layer: 'solid', shadow: true });
    };
    if (kind === 'tower') {
      box(at(0, 0, base + 6), { x: 3.5, y: 12, z: 3.5 }, '#b0bec5');
      box(at(0, 0, base + 13), { x: 5, y: 2.5, z: 5 }, '#d84315');
      box(at(0, 0, base + 15), { x: 0.4, y: 3, z: 0.4 }, '#eceff1');
    } else if (kind === 'water_tower') {
      for (const [dr, dt] of [[-1.6, -1.6], [-1.6, 1.6], [1.6, -1.6], [1.6, 1.6]] as const) box(at(dr, dt, base + 3.5), { x: 0.4, y: 7, z: 0.4 }, '#5d4037');
      box(at(0, 0, base + 9), { x: 4.6, y: 4, z: 4.6 }, '#4fc3f7');
      box(at(0, 0, base + 11.3), { x: 3.4, y: 0.6, z: 3.4 }, '#0277bd');
    } else {
      const colors = ['#e65100', '#1565c0', '#2e7d32', '#c62828', '#f9a825'];
      [[-2, -4, 0], [-2, 3, 0], [2.2, -1, 0], [-2, -0.5, 1], [2.2, 4, 0]].forEach(([dr, dt, level], i) => {
        box(at(dr!, dt!, base + 1.3 + level! * 2.6), { x: 6, y: 2.6, z: 2.4 }, colors[i % colors.length]!);
      });
    }
  }
}

export function generateRingLayout(map: RingMapConfig): RingLayout {
  const b = new RingBuilder(map);
  b.lanes();
  b.walls();
  b.ramps();
  b.elevated();
  b.core();
  b.entrances();
  b.zones();
  return b.out;
}
