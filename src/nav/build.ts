// Builds the waypoint graph: outdoor grid + explicit interior nodes + door links (TR-NAV-01). Pure.
import type { Vec3Like } from '../core/events';
import { pointInRect, segmentIntersectsRect, type Rect2 } from '../logic/math';
import { NavGraph } from './graph';

export interface NavBuildInput {
  /**
   * Flat outdoor grid (city). null = no grid: the graph is made only of the explicit extra nodes / edges,
   * which may sit on several levels (guard ring map: lanes, ramps, stairs, elevated walkway).
   */
  grid: { spacing: number; min: [number, number]; max: [number, number]; clearance: number } | null;
  obstacles: Rect2[];
  extraNodes: { key: string; pos: Vec3Like; tag: string | null }[];
  extraEdges: [string, string][];
  doorLinks: { key: string; radius: number }[];
}

function expand(r: Rect2, c: number): Rect2 {
  return { minX: r.minX - c, minZ: r.minZ - c, maxX: r.maxX + c, maxZ: r.maxZ + c };
}

export function isSegmentClear(ax: number, az: number, bx: number, bz: number, obstacles: Rect2[]): boolean {
  for (const o of obstacles) if (segmentIntersectsRect(ax, az, bx, bz, o)) return false;
  return true;
}

export function buildNavGraph(input: NavBuildInput): NavGraph {
  const g = new NavGraph();
  const obstacles = input.obstacles.map((o) => expand(o, input.grid?.clearance ?? 0));
  if (input.grid) addGrid(g, input.grid, obstacles);
  addExplicit(g, input, obstacles);
  return g;
}

function addGrid(g: NavGraph, grid: NonNullable<NavBuildInput['grid']>, obstacles: Rect2[]): void {
  const { spacing, min, max } = grid;
  const cols = Math.floor((max[0] - min[0]) / spacing) + 1;
  const rows = Math.floor((max[1] - min[1]) / spacing) + 1;
  const gridId: number[][] = [];
  for (let i = 0; i < cols; i++) {
    gridId.push([]);
    for (let j = 0; j < rows; j++) {
      const x = min[0] + i * spacing;
      const z = min[1] + j * spacing;
      const blocked = obstacles.some((o) => pointInRect(x, z, o));
      gridId[i]!.push(blocked ? -1 : g.addNode(`g:${i}:${j}`, { x, y: 0, z }, 'outdoor'));
    }
  }
  const link = (a: number, b: number): void => {
    if (a < 0 || b < 0) return;
    const na = g.nodes[a]!;
    const nb = g.nodes[b]!;
    if (isSegmentClear(na.x, na.z, nb.x, nb.z, obstacles)) g.addEdge(a, b);
  };
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const id = gridId[i]![j]!;
      if (id < 0) continue;
      if (i + 1 < cols) link(id, gridId[i + 1]![j]!);
      if (j + 1 < rows) link(id, gridId[i]![j + 1]!);
      if (i + 1 < cols && j + 1 < rows) link(id, gridId[i + 1]![j + 1]!);
      if (i + 1 < cols && j - 1 >= 0) link(id, gridId[i + 1]![j - 1]!);
    }
  }
}

function addExplicit(g: NavGraph, input: NavBuildInput, obstacles: Rect2[]): void {
  for (const n of input.extraNodes) g.addNode(n.key, n.pos, n.tag);
  for (const [a, b] of input.extraEdges) {
    const ia = g.nodeId(a);
    const ib = g.nodeId(b);
    if (ia === undefined || ib === undefined) throw new Error(`nav edge references unknown node ${a} / ${b}`);
    g.addEdge(ia, ib);
  }
  for (const d of input.doorLinks) {
    const id = g.nodeId(d.key);
    if (id === undefined) throw new Error(`door link references unknown node ${d.key}`);
    const door = g.nodes[id]!;
    const candidates = g.nodes
      .filter((n) => n.tag === 'outdoor' && Math.hypot(n.x - door.x, n.z - door.z) <= d.radius)
      .filter((n) => isSegmentClear(door.x, door.z, n.x, n.z, obstacles))
      .sort((a, b) => Math.hypot(a.x - door.x, a.z - door.z) - Math.hypot(b.x - door.x, b.z - door.z))
      .slice(0, 3);
    for (const c of candidates) g.addEdge(id, c.id);
  }
}
