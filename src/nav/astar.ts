// A* over the waypoint graph, with "detour vs break the wall" costing (TR-NAV-01/04). Pure.
import type { NavEdge, NavGraph } from './graph';

export interface PathResult {
  nodes: number[];
  edges: number[];
  cost: number;
  /** Blockers (nut walls) the path goes through — the zombie must BREAK them. */
  walls: string[];
}

class MinHeap {
  private items: { id: number; f: number }[] = [];
  get size(): number {
    return this.items.length;
  }
  push(id: number, f: number): void {
    const a = this.items;
    a.push({ id, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.f <= a[i]!.f) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.f < a[m]!.f) m = l;
        if (r < a.length && a[r]!.f < a[m]!.f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top.id;
  }
}

function edgeCost(edge: NavEdge, allowBreak: boolean): number {
  if (edge.blockers.size === 0) return edge.length;
  if (!allowBreak) return Infinity;
  let extra = 0;
  for (const c of edge.blockers.values()) extra += c;
  return edge.length + extra;
}

export function findPath(graph: NavGraph, start: number, goal: number, allowBreak = true): PathResult | null {
  if (start < 0 || goal < 0 || start >= graph.nodes.length || goal >= graph.nodes.length) return null;
  const n = graph.nodes.length;
  const g = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const viaEdge = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const goalNode = graph.nodes[goal]!;
  const h = (id: number): number => {
    const node = graph.nodes[id]!;
    return Math.hypot(node.x - goalNode.x, node.y - goalNode.y, node.z - goalNode.z);
  };
  const open = new MinHeap();
  g[start] = 0;
  open.push(start, h(start));
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    if (cur === goal) break;
    closed[cur] = 1;
    for (const e of graph.adj[cur]!) {
      const edge = graph.edges[e]!;
      const next = graph.other(edge, cur);
      if (closed[next]) continue;
      const cost = g[cur]! + edgeCost(edge, allowBreak);
      if (cost < g[next]!) {
        g[next] = cost;
        cameFrom[next] = cur;
        viaEdge[next] = e;
        open.push(next, cost + h(next));
      }
    }
  }
  if (!Number.isFinite(g[goal]!)) return null;
  const nodes: number[] = [];
  const edges: number[] = [];
  const walls = new Set<string>();
  for (let c = goal; c !== -1; c = cameFrom[c]!) {
    nodes.push(c);
    const e = viaEdge[c]!;
    if (e >= 0) {
      edges.push(e);
      for (const w of graph.edges[e]!.blockers.keys()) walls.add(w);
    }
  }
  nodes.reverse();
  edges.reverse();
  return { nodes, edges, cost: g[goal]!, walls: [...walls] };
}

export interface RouteDecision {
  path: PathResult | null;
  /** 'walk' = a wall-free route (direct or detour) is cheapest; 'break' = going through a nut wall is cheaper. */
  choice: 'walk' | 'break' | 'none';
  detourCost: number;
  breakCost: number;
}

/** TR-NAV-04: compare the cheapest wall-free detour with breaking through; break when the detour costs more. */
export function planRoute(graph: NavGraph, start: number, goal: number): RouteDecision {
  const detour = findPath(graph, start, goal, false);
  const best = findPath(graph, start, goal, true);
  const detourCost = detour ? detour.cost : Infinity;
  if (!best) return { path: null, choice: 'none', detourCost, breakCost: Infinity };
  if (best.walls.length > 0 && best.cost < detourCost) {
    return { path: best, choice: 'break', detourCost, breakCost: best.cost };
  }
  return { path: detour, choice: 'walk', detourCost, breakCost: best.walls.length > 0 ? best.cost : Infinity };
}
