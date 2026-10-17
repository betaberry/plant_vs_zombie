import { describe, expect, it } from 'vitest';
import { buildNavGraph } from '../../src/nav/build';
import { findPath } from '../../src/nav/astar';
import { buildingAt, districtAt, generateLayout, resolvePlace } from '../../src/world/layout';
import { config } from './helpers';

const cfg = config();
const layout = generateLayout(cfg.maps.city_01);
const nav = buildNavGraph({
  grid: cfg.maps.city_01.waypointGraph.grid,
  obstacles: layout.obstacles,
  extraNodes: layout.navNodes,
  extraEdges: layout.navEdges,
  doorLinks: layout.doorLinks,
});

describe('city layout & waypoint graph (FR-MAP, TR-NAV-03)', () => {
  it('has ≥ 4 enterable buildings with rooms and doors', () => {
    const enterable = layout.buildings.filter((b) => b.enterable);
    expect(enterable.length).toBeGreaterThanOrEqual(4);
    expect(layout.doors).toHaveLength(enterable.length);
    for (const b of enterable) expect(Object.keys(b.rooms!)).toEqual(['hall', 'backLeft', 'backRight', 'upstairs', 'upstairsBack']);
  });

  it('builds a fully connected waypoint graph (no stranded nodes)', () => {
    expect(nav.nodes.length).toBeGreaterThan(500);
    expect(nav.findDisconnected().map((n) => n.key)).toEqual([]);
  });

  it('reaches every building upstairs room from the start district', () => {
    const start = nav.nearestNode(resolvePlace(layout, { pos: cfg.maps.city_01.playerSpawns[0]!.pos }), (n) => n.tag === 'outdoor');
    for (const b of layout.buildings.filter((x) => x.enterable)) {
      const goal = nav.nodeId(`${b.id}:upstairsBack`)!;
      const path = findPath(nav, start, goal, false);
      expect(path, b.id).not.toBeNull();
    }
  });

  it('places spawns outside buildings and ambushers inside their building', () => {
    for (const s of cfg.maps.city_01.playerSpawns) {
      const p = resolvePlace(layout, { pos: s.pos });
      expect(layout.buildings.some((b) => p.x > b.rect.minX && p.x < b.rect.maxX && p.z > b.rect.minZ && p.z < b.rect.maxZ), s.id).toBe(false);
    }
    for (const a of cfg.maps.city_01.ambushPoints) expect(buildingAt(layout, resolvePlace(layout, a))?.id).toBe(a.building);
    expect(districtAt(cfg.maps.city_01, { x: -55, y: 0, z: 25 })).toBe('start');
    expect(districtAt(cfg.maps.city_01, { x: 500, y: 0, z: 0 })).toBeNull();
    expect(() => resolvePlace(layout, { building: 'nope', room: 'hall' })).toThrow();
  });
});
