// Ring map layout + waypoints (FR2.1–FR2.4): connectivity, entrance → core path lengths, no nodes in the core,
// no edge through a wall band, plantable lanes.
import { describe, expect, it } from 'vitest';
import { buildNavGraph } from '../../src/nav/build';
import { findPath } from '../../src/nav/astar';
import type { NavGraph } from '../../src/nav/graph';
import { canPlantAt, type PlantContext } from '../../src/logic/planting';
import { pointInRect } from '../../src/logic/math';
import { angleDistDeg, generateRingLayout, type RingLayout } from '../../src/world/ringLayout';
import type { RingMapConfig } from '../../src/config/types';
import { config } from './helpers';

const cfg = config();
const map = cfg.maps.ring_01;

function navFor(layout: RingLayout): NavGraph {
  return buildNavGraph({ grid: null, obstacles: layout.obstacles, extraNodes: layout.navNodes, extraEdges: layout.navEdges, doorLinks: layout.doorLinks });
}

const layout = generateRingLayout(map);
const nav = navFor(layout);

/** Shortest path cost from a spawn point of the entrance to any node next to the core walls. */
function entranceToCore(entranceIdx: number): number {
  const spawn = layout.entrances[entranceIdx]!.spawnPoints[0]!;
  const start = nav.nearestNode(spawn);
  let best = Infinity;
  for (const key of layout.coreApproachKeys) {
    const p = findPath(nav, start, nav.nodeId(key)!, false);
    if (p) best = Math.min(best, p.cost);
  }
  return best;
}

describe('ring waypoint graph (FR2.4)', () => {
  it('has 0 disconnected waypoints and covers both levels', () => {
    expect(nav.findDisconnected()).toEqual([]);
    const elevated = cfg.maps.ring_01.elevated.height;
    expect(nav.nodes.some((n) => n.y === elevated)).toBe(true);
    expect(nav.nodes.filter((n) => n.key.startsWith('stair:'))).toHaveLength(4);
  });

  it('places no waypoint inside the core house', () => {
    const inside = nav.nodes.filter((n) => pointInRect(n.x, n.z, layout.core.rect));
    expect(inside).toEqual([]);
    expect(layout.coreApproachKeys.length).toBeGreaterThanOrEqual(4);
  });

  it('never routes through a wall band: ground edges cross bands only at ramp / entrance gaps', () => {
    const h = map.laneWidth / 2;
    const [o, m, i] = map.rings.map((r) => r.radius) as [number, number, number];
    const bands = [
      { rIn: m + h, rOut: o - h, gaps: map.ramps.filter((r) => r.from === 'outer') },
      { rIn: i + h, rOut: m - h, gaps: map.ramps.filter((r) => r.from === 'middle') },
      { rIn: o + h, rOut: o + h + map.outerWallThickness, gaps: map.entrances },
    ];
    const elevNodes = new Set(nav.nodes.filter((n) => n.y > 0).map((n) => n.id));
    for (const e of nav.edges) {
      if (elevNodes.has(e.a) || elevNodes.has(e.b)) continue;
      const a = nav.nodes[e.a]!;
      const b = nav.nodes[e.b]!;
      for (let s = 0; s <= 10; s++) {
        const x = a.x + ((b.x - a.x) * s) / 10;
        const z = a.z + ((b.z - a.z) * s) / 10;
        const r = Math.hypot(x, z);
        const ang = (Math.atan2(z, x) * 180) / Math.PI;
        for (const band of bands) {
          if (r <= band.rIn + 0.01 || r >= band.rOut - 0.01) continue;
          const inGap = band.gaps.some((g) => angleDistDeg(ang, g.angleDeg) * (Math.PI / 180) * r <= g.width / 2);
          expect(inGap, `${a.key} → ${b.key} crosses a wall at r=${r.toFixed(1)}`).toBe(true);
        }
      }
    }
  });
});

describe('entrance → core routes (FR2.2)', () => {
  const costs = map.entrances.map((_, i) => entranceToCore(i));

  it('reaches the core walls from every entrance', () => {
    for (const c of costs) expect(Number.isFinite(c)).toBe(true);
  });

  it('keeps the shortest route ≈ 95 m and the longest ≈ 190 m (±20 %)', () => {
    const shortest = Math.min(...costs);
    const longest = Math.max(...costs);
    expect(shortest).toBeGreaterThanOrEqual(95 * 0.8);
    expect(shortest).toBeLessThanOrEqual(95 * 1.2);
    expect(longest).toBeGreaterThanOrEqual(190 * 0.8);
    expect(longest).toBeLessThanOrEqual(190 * 1.2);
  });

  it('loses the core route when a ring link has no ramp (walls really block)', () => {
    const noRamps: RingMapConfig = { ...structuredClone(map), ramps: map.ramps.filter((r) => r.from !== 'middle') };
    const l = generateRingLayout(noRamps);
    const g = navFor(l);
    const start = g.nearestNode(l.entrances[0]!.spawnPoints[0]!);
    const reached = l.coreApproachKeys.some((k) => findPath(g, start, g.nodeId(k)!, false) !== null);
    expect(reached).toBe(false);
  });
});

describe('ring lanes are plantable (FR2.3)', () => {
  const plantCtx = (pos: { x: number; y: number; z: number }): PlantContext => ({
    characterId: 'pea_gunner',
    playerPos: pos,
    plant: cfg.plants.plants.nut_wall!,
    rules: cfg.plants.plantingRules,
    aliveOfType: 0,
    ground: { normalY: 1 },
    zones: { plantable: layout.plantableZones, blocked: layout.extraNoPlantZones },
    occupied: [],
  });

  it('accepts every lane, ramp and elevated sample point', () => {
    expect(layout.walkSamples.length).toBeGreaterThan(70);
    for (const s of layout.walkSamples) expect(canPlantAt(s.pos, plantCtx(s.pos)), `${s.where} @ ${s.pos.x.toFixed(1)},${s.pos.z.toFixed(1)}`).toEqual({ ok: true });
    // Ramps are within the 15° planting slope.
    for (const r of map.ramps) expect(r.slopeDeg).toBeLessThanOrEqual(cfg.plants.plantingRules.maxSlopeDeg);
  });

  it('rejects the core footprint and the inside of a wall band', () => {
    const core = layout.core.center;
    expect(canPlantAt(core, plantCtx(core))).toEqual({ ok: false, reason: 'zone', detail: 'core' });
    const inWall = { x: 41, y: 0, z: 0 };
    expect(canPlantAt(inWall, plantCtx(inWall))).toEqual({ ok: false, reason: 'zone', detail: 'outside' });
  });

  it('rejects the stairs', () => {
    const z = layout.extraNoPlantZones.find((x) => x.type === 'stairs')!;
    const [sx, sz] = z.points.reduce(([ax, az], [x, y]) => [ax + x / z.points.length, az + y / z.points.length], [0, 0]);
    const p = { x: sx, y: 0, z: sz };
    expect(canPlantAt(p, plantCtx(p))).toEqual({ ok: false, reason: 'zone', detail: 'stairs' });
  });
});
