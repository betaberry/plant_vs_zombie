// Pure city layout generator: turns map_city_01.json into boxes, nav nodes, rooms, doors and zones.
// No Three.js / Rapier here so it can be reused by the nav builder and the renderer alike.
import type { BuildingDef, DoorSide, MapConfig, PlaceRef, PropDef, RoomId, Vec3Tuple, ZoneDef } from '../config/types';
import type { Vec3Like } from '../core/events';
import type { Rect2 } from '../logic/math';
import type { SurfaceMaterial } from '../physics/world';
import { createRng } from '../core/rng';

export interface BoxSpec {
  center: Vec3Like;
  size: Vec3Like;
  rotY?: number;
  rotZ?: number;
  color: string;
  collide: boolean;
  surface: SurfaceMaterial;
  layer: 'solid' | 'ground' | 'water';
  shadow?: boolean;
}

export interface SignSpec {
  pos: Vec3Like;
  rotY: number;
  width: number;
  height: number;
  text: string;
  kind: 'text' | 'clock';
  bg: string;
  fg: string;
}

export interface DoorSpec {
  id: string;
  buildingId: string;
  open: { center: Vec3Like; size: Vec3Like };
  closed: { center: Vec3Like; size: Vec3Like };
  handle: Vec3Like;
}

export interface BuildingInfo {
  id: string;
  name: string;
  district: string;
  rect: Rect2;
  enterable: boolean;
  floorHeight: number;
  rooms: Record<RoomId, Vec3Like> | null;
}

export interface CityLayout {
  boxes: BoxSpec[];
  signs: SignSpec[];
  doors: DoorSpec[];
  obstacles: Rect2[];
  buildings: BuildingInfo[];
  navNodes: { key: string; pos: Vec3Like; tag: string | null }[];
  navEdges: [string, string][];
  doorLinks: { key: string; radius: number }[];
  extraNoPlantZones: ZoneDef[];
}

const WALL = 0.3;
const DOOR_W = 2;
const DOOR_H = 2.6;
const STEP_RUN = 0.35;
const STAIR_W = 1.6;

type Xf = (lx: number, lz: number) => { x: number; z: number };

function transformFor(cx: number, cz: number, side: DoorSide): { xf: Xf; swap: boolean } {
  switch (side) {
    case 'south': return { xf: (lx, lz) => ({ x: cx + lx, z: cz + lz }), swap: false };
    case 'north': return { xf: (lx, lz) => ({ x: cx - lx, z: cz - lz }), swap: false };
    case 'east': return { xf: (lx, lz) => ({ x: cx - lz, z: cz + lx }), swap: true };
    case 'west': return { xf: (lx, lz) => ({ x: cx + lz, z: cz - lx }), swap: true };
  }
}

function rectOf(cx: number, cz: number, sx: number, sz: number): Rect2 {
  return { minX: cx - sx / 2, minZ: cz - sz / 2, maxX: cx + sx / 2, maxZ: cz + sz / 2 };
}

function rectZone(id: string, type: string, r: Rect2): ZoneDef {
  return { id, type, points: [[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ]] };
}

class Builder {
  out: CityLayout = {
    boxes: [], signs: [], doors: [], obstacles: [], buildings: [], navNodes: [], navEdges: [], doorLinks: [], extraNoPlantZones: [],
  };

  box(center: Vec3Like, size: Vec3Like, color: string, opts: Partial<BoxSpec> = {}): void {
    this.out.boxes.push({ center, size, color, collide: true, surface: 'concrete', layer: 'solid', shadow: true, ...opts });
  }

  /** Box between two corners in a building's local frame (x0..x1, y0..y1, z0..z1). */
  localBox(xf: Xf, swap: boolean, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string, opts: Partial<BoxSpec> = {}): void {
    const c = xf((x0 + x1) / 2, (z0 + z1) / 2);
    const sx = Math.abs(x1 - x0);
    const sz = Math.abs(z1 - z0);
    this.box({ x: c.x, y: (y0 + y1) / 2, z: c.z }, { x: swap ? sz : sx, y: y1 - y0, z: swap ? sx : sz }, color, opts);
  }
}

function buildEnterable(b: Builder, def: BuildingDef): void {
  const side = def.doorSide as DoorSide;
  const { xf, swap } = transformFor(def.center[0], def.center[1], side);
  const W = swap ? def.size[1] : def.size[0];
  const D = swap ? def.size[0] : def.size[1];
  const H = (def.height - 0.3) / 2;
  const top = 2 * H;
  const hw = W / 2;
  const hd = D / 2;
  const zi = -hd + Math.max(6.6, D * 0.55);
  const lb = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color = def.color, opts: Partial<BoxSpec> = {}): void =>
    b.localBox(xf, swap, x0, x1, y0, y1, z0, z1, color, opts);
  const inner = '#f3efe6';
  // Outer walls with a front door gap.
  lb(-hw, -DOOR_W / 2, 0, top, -hd, -hd + WALL);
  lb(DOOR_W / 2, hw, 0, top, -hd, -hd + WALL);
  lb(-DOOR_W / 2, DOOR_W / 2, DOOR_H, top, -hd, -hd + WALL);
  lb(-hw, hw, 0, top, hd - WALL, hd);
  lb(-hw, -hw + WALL, 0, top, -hd + WALL, hd - WALL);
  lb(hw - WALL, hw, 0, top, -hd + WALL, hd - WALL);
  // Ground floor: inner wall with two doorways + divider between the back rooms.
  const gaps = [-W / 4, W / 4];
  lb(-hw + WALL, gaps[0]! - 0.8, 0, H, zi, zi + WALL, inner);
  lb(gaps[0]! + 0.8, gaps[1]! - 0.8, 0, H, zi, zi + WALL, inner);
  lb(gaps[1]! + 0.8, hw - WALL, 0, H, zi, zi + WALL, inner);
  for (const g of gaps) lb(g - 0.8, g + 0.8, 2.4, H, zi, zi + WALL, inner);
  lb(-WALL / 2, WALL / 2, 0, H, zi + WALL, hd - WALL, inner);
  lb(-hw + WALL, hw - WALL, 0, 0.03, -hd + WALL, hd - WALL, '#b9a48a', { collide: false, layer: 'ground', shadow: false });
  // Stairs along the left wall, rising toward the back.
  const sx0 = -hw + WALL + 0.05;
  const sx1 = sx0 + STAIR_W - 0.1;
  const z0 = -hd + 1.3;
  const steps = Math.ceil(H / 0.26);
  const rise = H / steps;
  for (let i = 0; i < steps; i++) {
    lb(sx0, sx1, 0, (i + 1) * rise, z0 + i * STEP_RUN, z0 + (i + 1) * STEP_RUN, '#8d6e63', { surface: 'wood' });
  }
  const stairEnd = z0 + steps * STEP_RUN;
  // Second floor slab with a hole above the stairs, upstairs partition, roof.
  const holeX = -hw + WALL + STAIR_W;
  lb(holeX, hw - WALL, H - 0.2, H, -hd + WALL, hd - WALL, '#c8b79e', { surface: 'wood' });
  lb(-hw + WALL, holeX, H - 0.2, H, stairEnd, hd - WALL, '#c8b79e', { surface: 'wood' });
  const ub = D / 4;
  lb(-hw + WALL, W / 4 - 0.8, H, top, ub, ub + WALL, inner);
  lb(W / 4 + 0.8, hw - WALL, H, top, ub, ub + WALL, inner);
  lb(-hw, hw, top, top + 0.3, -hd, hd, '#6d4c41');
  // Door (open by default, swung outward) hinged at the left edge of the doorway.
  const hinge = -DOOR_W / 2;
  const openC = xf(hinge - 0.05, -hd - DOOR_W / 2);
  const closedC = xf(0, -hd + WALL / 2);
  const panel = (sx: number, sz: number) => ({ x: swap ? sz : sx, y: DOOR_H - 0.05, z: swap ? sx : sz });
  b.out.doors.push({
    id: `door_${def.id}`,
    buildingId: def.id,
    open: { center: { x: openC.x, y: (DOOR_H - 0.05) / 2, z: openC.z }, size: panel(0.1, DOOR_W) },
    closed: { center: { x: closedC.x, y: (DOOR_H - 0.05) / 2, z: closedC.z }, size: panel(DOOR_W, 0.1) },
    handle: { ...(() => { const h = xf(0, -hd - 0.6); return { x: h.x, z: h.z }; })(), y: 1 },
  });
  // Rooms, nav nodes and no-plant stairs zone.
  const P = (lx: number, y: number, lz: number): Vec3Like => { const p = xf(lx, lz); return { x: p.x, y, z: p.z }; };
  const rooms: Record<RoomId, Vec3Like> = {
    hall: P(W / 4, 0, (-hd + zi) / 2),
    backLeft: P(-W / 4, 0, (zi + hd) / 2),
    backRight: P(W / 4, 0, (zi + hd) / 2),
    upstairs: P(W / 4, H, (-hd + ub) / 2),
    upstairsBack: P(0, H, (ub + hd) / 2),
  };
  const k = (n: string): string => `${def.id}:${n}`;
  const nodes: [string, Vec3Like][] = [
    ['out', P(0, 0, -hd - 1.5)], ['in', P(0, 0, -hd + 1.2)], ['hall', rooms.hall],
    ['gapL', P(gaps[0]!, 0, zi + WALL / 2)], ['gapR', P(gaps[1]!, 0, zi + WALL / 2)],
    ['backLeft', rooms.backLeft], ['backRight', rooms.backRight],
    ['stairBottom', P(sx0 + 0.75, 0, -hd + 0.8)], ['stairTop', P(sx0 + 0.75, H, stairEnd + 0.4)],
    ['upstairs', rooms.upstairs], ['upGap', P(W / 4, H, ub + WALL / 2)], ['upstairsBack', rooms.upstairsBack],
  ];
  for (const [n, pos] of nodes) b.out.navNodes.push({ key: k(n), pos, tag: n === 'out' ? 'door' : `in:${def.id}` });
  const edges: [string, string][] = [
    ['out', 'in'], ['in', 'hall'], ['in', 'stairBottom'], ['hall', 'stairBottom'], ['hall', 'gapL'], ['hall', 'gapR'],
    ['gapL', 'backLeft'], ['gapR', 'backRight'], ['stairBottom', 'stairTop'], ['stairTop', 'upstairs'],
    ['upstairs', 'upGap'], ['upGap', 'upstairsBack'],
  ];
  for (const [a, c] of edges) b.out.navEdges.push([k(a), k(c)]);
  b.out.doorLinks.push({ key: k('out'), radius: 16 });
  const s0 = xf(sx0, z0);
  const s1 = xf(sx1, stairEnd);
  b.out.extraNoPlantZones.push(rectZone(`np_stairs_${def.id}`, 'stairs', {
    minX: Math.min(s0.x, s1.x), minZ: Math.min(s0.z, s1.z), maxX: Math.max(s0.x, s1.x), maxZ: Math.max(s0.z, s1.z),
  }));
  if (def.landmark === 'supermarket') {
    const s = xf(0, -hd - 0.05);
    const rotY = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 }[side];
    b.out.signs.push({ pos: { x: s.x, y: top - 0.8, z: s.z }, rotY: rotY + Math.PI, width: 8, height: 1.6, text: '超市', kind: 'text', bg: '#d32f2f', fg: '#ffffff' });
  }
  b.out.buildings.push({ id: def.id, name: def.name, district: def.district, rect: rectOf(def.center[0], def.center[1], def.size[0], def.size[1]), enterable: true, floorHeight: H, rooms });
}

function buildSolid(b: Builder, def: BuildingDef): void {
  const [cx, cz] = def.center;
  const [sx, sz] = def.size;
  b.box({ x: cx, y: def.height / 2, z: cz }, { x: sx, y: def.height, z: sz }, def.color);
  b.box({ x: cx, y: def.height + 0.15, z: cz }, { x: sx + 0.4, y: 0.3, z: sz + 0.4 }, '#5d4037');
  if (def.landmark === 'clock') {
    b.box({ x: cx, y: def.height + 2, z: cz }, { x: sx * 0.7, y: 3.4, z: sz * 0.7 }, '#8d6e63');
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const off = sx / 2 + 0.06;
      b.out.signs.push({ pos: { x: cx + Math.sin(a) * off, y: def.height - 3, z: cz + Math.cos(a) * off }, rotY: a, width: 4, height: 4, text: '', kind: 'clock', bg: '#fffde7', fg: '#3e2723' });
    }
  }
  b.out.buildings.push({ id: def.id, name: def.name, district: def.district, rect: rectOf(cx, cz, sx, sz), enterable: false, floorHeight: def.height, rooms: null });
}

function buildProp(b: Builder, p: PropDef, colorIdx: number): void {
  const [x, , z] = p.pos;
  const rot = ((p.rotYDeg ?? 0) * Math.PI) / 180;
  const swap = Math.abs(Math.sin(rot)) > 0.5;
  const sized = (sx: number, sz: number) => (swap ? { sx: sz, sz: sx } : { sx, sz });
  switch (p.kind) {
    case 'container': {
      const colors = ['#c62828', '#1565c0', '#2e7d32', '#ef6c00'];
      const { sx, sz } = sized(6.1, 2.44);
      b.box({ x, y: 1.3, z }, { x: sx, y: 2.6, z: sz }, colors[colorIdx % colors.length]!, { surface: 'metal' });
      break;
    }
    case 'car': {
      const { sx, sz } = sized(4.2, 1.8);
      const c = sized(2.2, 1.6);
      b.box({ x, y: 0.55, z }, { x: sx, y: 1.0, z: sz }, ['#e53935', '#fdd835', '#42a5f5', '#8e24aa'][colorIdx % 4]!, { surface: 'metal' });
      b.box({ x, y: 1.4, z }, { x: c.sx, y: 0.7, z: c.sz }, '#90caf9', { surface: 'glass' });
      break;
    }
    case 'barricade': {
      const { sx, sz } = sized(3, 0.5);
      b.box({ x, y: 0.55, z }, { x: sx, y: 1.1, z: sz }, '#ff9800', { surface: 'wood' });
      break;
    }
    case 'trashbin':
      b.box({ x, y: 0.55, z }, { x: 0.8, y: 1.1, z: 0.8 }, '#388e3c', { surface: 'metal' });
      break;
    case 'lamp':
      b.box({ x, y: 2.5, z }, { x: 0.15, y: 5, z: 0.15 }, '#455a64', { surface: 'metal' });
      b.box({ x, y: 5, z }, { x: 0.8, y: 0.15, z: 0.35 }, '#fff59d', { collide: false });
      return;
    case 'ramp': {
      const L = p.size?.[0] ?? 6;
      const T = p.size?.[1] ?? 0.3;
      const Wd = p.size?.[2] ?? 4;
      const a = ((p.slopeDeg ?? 20) * Math.PI) / 180;
      const h = Math.sin(a) * L;
      const run = Math.cos(a) * L;
      b.box({ x: x + Math.sin(a) * T * 0.5, y: h / 2 - Math.cos(a) * T * 0.5, z }, { x: L, y: T, z: Wd }, '#a1887f', { rotZ: a });
      b.box({ x: x + run / 2 + 1, y: h / 2, z }, { x: 2, y: h, z: Wd }, '#8d6e63');
      b.out.obstacles.push(rectOf(x + 1, z, run + 2, Wd));
      return;
    }
    case 'gas_station': {
      b.box({ x, y: 5.2, z }, { x: 14, y: 0.4, z: 10 }, '#eeeeee', { surface: 'metal' });
      for (const [ox, oz] of [[-6, -4], [6, -4], [-6, 4], [6, 4]] as const) {
        b.box({ x: x + ox, y: 2.5, z: z + oz }, { x: 0.4, y: 5, z: 0.4 }, '#d32f2f', { surface: 'metal' });
        b.out.obstacles.push(rectOf(x + ox, z + oz, 0.4, 0.4));
      }
      for (const ox of [-2.5, 2.5]) {
        b.box({ x: x + ox, y: 0.8, z }, { x: 0.8, y: 1.6, z: 0.5 }, '#fbc02d', { surface: 'metal' });
        b.out.obstacles.push(rectOf(x + ox, z, 0.8, 0.5));
      }
      b.out.signs.push({ pos: { x, y: 5.2, z: z - 5.05 }, rotY: Math.PI, width: 6, height: 0.9, text: '加油站', kind: 'text', bg: '#d32f2f', fg: '#ffffff' });
      return;
    }
    case 'fountain': {
      const s = 12;
      for (const [ox, oz, w, d] of [[0, -s / 2, s, 0.5], [0, s / 2, s, 0.5], [-s / 2, 0, 0.5, s], [s / 2, 0, 0.5, s]] as const) {
        b.box({ x: x + ox, y: 0.3, z: z + oz }, { x: w, y: 0.6, z: d }, '#bdbdbd');
      }
      b.box({ x, y: 0.15, z }, { x: s - 0.5, y: 0.06, z: s - 0.5 }, '#4fc3f7', { collide: false, layer: 'water', shadow: false });
      b.box({ x, y: 1.2, z }, { x: 1, y: 2.4, z: 1 }, '#e0e0e0');
      b.out.obstacles.push(rectOf(x, z, 1, 1));
      return;
    }
  }
  const fp = p.kind === 'container' ? sized(6.1, 2.44) : p.kind === 'car' ? sized(4.2, 1.8) : p.kind === 'barricade' ? sized(3, 0.5) : { sx: 0.8, sz: 0.8 };
  b.out.obstacles.push(rectOf(x, z, fp.sx, fp.sz));
}

function buildGround(b: Builder, map: MapConfig): void {
  const [W, D] = map.size;
  const rw = map.roads.halfWidth;
  b.box({ x: 0, y: -0.5, z: 0 }, { x: W + 40, y: 1, z: D + 40 }, '#7cb342', { layer: 'ground', shadow: false });
  const tint: Record<string, string> = { start: '#8bc34a', commercial: '#d7ccc8', residential: '#9ccc65', industrial: '#9e9e9e' };
  for (const d of map.districts) {
    const [x0, z0, x1, z1] = d.rect;
    b.box({ x: (x0 + x1) / 2, y: 0.005, z: (z0 + z1) / 2 }, { x: x1 - x0, y: 0.01, z: z1 - z0 }, tint[d.id] ?? '#8bc34a', { collide: false, layer: 'ground', shadow: false });
  }
  const g = { collide: false, layer: 'ground' as const, shadow: false };
  b.box({ x: 0, y: 0.035, z: 0 }, { x: rw * 2, y: 0.01, z: D }, '#546e7a', g);
  b.box({ x: 0, y: 0.035, z: 0 }, { x: W, y: 0.01, z: rw * 2 }, '#546e7a', g);
  for (const s of [-1, 1]) {
    b.box({ x: s * (rw + 1), y: 0.065, z: 0 }, { x: 2, y: 0.01, z: D }, '#cfd8dc', g);
    b.box({ x: 0, y: 0.065, z: s * (rw + 1) }, { x: W, y: 0.01, z: 2 }, '#cfd8dc', g);
  }
  for (let t = -W / 2 + 4; t < W / 2; t += 8) {
    if (Math.abs(t) < rw + 2) continue;
    b.box({ x: 0, y: 0.065, z: t }, { x: 0.25, y: 0.01, z: 3 }, '#fff9c4', g);
    b.box({ x: t, y: 0.065, z: 0 }, { x: 3, y: 0.01, z: 0.25 }, '#fff9c4', g);
  }
  // Boundary: blockade walls + rubble (FR-MAP-07).
  const h = map.boundaryWallHeight;
  const e = W / 2;
  for (const [cx, cz, sx, sz] of [[0, -e, W, 2], [0, e, W, 2], [-e, 0, 2, D], [e, 0, 2, D]] as const) {
    b.box({ x: cx, y: h / 2, z: cz }, { x: sx, y: h, z: sz }, '#6d6d6d');
  }
  const rng = createRng(1337);
  for (let i = 0; i < 48; i++) {
    const t = rng.range(-e + 6, e - 6);
    const side = i % 4;
    const off = e - 2.5 - rng.range(0, 1.5);
    const pos = side === 0 ? { x: t, z: -off } : side === 1 ? { x: t, z: off } : side === 2 ? { x: -off, z: t } : { x: off, z: t };
    const s = rng.range(1, 2.4);
    b.box({ x: pos.x, y: s / 2, z: pos.z }, { x: s * 1.4, y: s, z: s }, '#8d8d8d', { rotY: rng.range(0, Math.PI) });
  }
}

export function generateLayout(map: MapConfig): CityLayout {
  const b = new Builder();
  buildGround(b, map);
  for (const def of map.buildings) {
    b.out.obstacles.push(rectOf(def.center[0], def.center[1], def.size[0], def.size[1]));
    if (def.enterable) buildEnterable(b, def);
    else buildSolid(b, def);
  }
  map.props.forEach((p, i) => buildProp(b, p, i));
  return b.out;
}

/** Resolves a {pos} or {building, room} reference to a world position (feet). */
export function resolvePlace(layout: CityLayout, ref: PlaceRef): Vec3Like {
  if (ref.building) {
    const room = layout.buildings.find((x) => x.id === ref.building)?.rooms?.[ref.room as RoomId];
    if (!room) throw new Error(`unknown room ${ref.building}/${ref.room}`);
    return { ...room };
  }
  const p = ref.pos as Vec3Tuple;
  return { x: p[0], y: p[1], z: p[2] };
}

/** Enterable building containing the position (inside its walls), if any. */
export function buildingAt(layout: CityLayout, pos: Vec3Like): BuildingInfo | null {
  for (const bld of layout.buildings) {
    if (!bld.enterable) continue;
    const r = bld.rect;
    if (pos.x > r.minX + WALL && pos.x < r.maxX - WALL && pos.z > r.minZ + WALL && pos.z < r.maxZ - WALL) return bld;
  }
  return null;
}

export function districtAt(map: MapConfig, pos: Vec3Like): string | null {
  for (const d of map.districts) {
    const [x0, z0, x1, z1] = d.rect;
    if (pos.x >= x0 && pos.x <= x1 && pos.z >= z0 && pos.z <= z1) return d.id;
  }
  return null;
}
