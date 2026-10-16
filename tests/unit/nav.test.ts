import { describe, expect, it } from 'vitest';
import { findPath, planRoute } from '../../src/nav/astar';
import { buildNavGraph } from '../../src/nav/build';
import { NavGraph } from '../../src/nav/graph';

const p = (x: number, z: number) => ({ x, y: 0, z });

/** A–B–C straight corridor plus a long detour A–D–E–C. */
function corridor(): { g: NavGraph; a: number; b: number; c: number } {
  const g = new NavGraph();
  const a = g.addNode('a', p(0, 0));
  const b = g.addNode('b', p(5, 0));
  const c = g.addNode('c', p(10, 0));
  const d = g.addNode('d', p(0, 20));
  const e = g.addNode('e', p(10, 20));
  g.addEdge(a, b);
  g.addEdge(b, c);
  g.addEdge(a, d);
  g.addEdge(d, e);
  g.addEdge(e, c);
  return { g, a, b, c };
}

describe('waypoint navigation (TR-NAV-01..04)', () => {
  it('A* finds the shortest path', () => {
    const { g, a, b, c } = corridor();
    const path = findPath(g, a, c)!;
    expect(path.nodes).toEqual([a, b, c]);
    expect(path.cost).toBeCloseTo(10, 6);
  });

  it('detours around a cheap-to-avoid wall but breaks it when the detour is longer', () => {
    const { g, a, c } = corridor();
    const affected = g.blockNear('wall_1', p(7.5, 0), 1, 100);
    expect(affected).toHaveLength(1);
    const detour = planRoute(g, a, c);
    expect(detour.choice).toBe('walk');
    expect(detour.path!.nodes).not.toContain(g.nodeId('b'));
    expect(detour.detourCost).toBeCloseTo(50, 6);
    g.unblock('wall_1');
    g.blockNear('wall_1', p(7.5, 0), 1, 20);
    const broken = planRoute(g, a, c);
    expect(broken.choice).toBe('break');
    expect(broken.path!.walls).toEqual(['wall_1']);
    expect(findPath(g, a, c, false)!.cost).toBeCloseTo(50, 6);
  });

  it('detects disconnected nodes and returns null for unreachable goals', () => {
    const { g, a } = corridor();
    const island = g.addNode('island', p(100, 100));
    expect(g.findDisconnected().map((n) => n.key)).toEqual(['island']);
    expect(findPath(g, a, island)).toBeNull();
  });

  it('builds a grid that avoids obstacles and links door nodes', () => {
    const g = buildNavGraph({
      grid: { spacing: 10, min: [0, 0], max: [40, 40], clearance: 0.5 },
      obstacles: [{ minX: 15, minZ: -5, maxX: 25, maxZ: 45 }],
      extraNodes: [{ key: 'door', pos: p(10, 20), tag: 'door' }],
      extraEdges: [],
      doorLinks: [{ key: 'door', radius: 12 }],
    });
    expect(g.nodeId('g:2:2')).toBeUndefined(); // (20,20) lies inside the obstacle
    const left = g.nodeId('g:0:0')!;
    const right = g.nodeId('g:4:0')!;
    expect(findPath(g, left, right)).toBeNull(); // the wall spans the whole map
    expect(g.adj[g.nodeId('door')!]!.length).toBeGreaterThan(0);
  });
});
