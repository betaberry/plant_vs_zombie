// Waypoint graph with blockable edges (TR-NAV-01/03/04). Pure.
import type { Vec3Like } from '../core/events';
import { pointSegmentDistXZ } from '../logic/math';

export interface NavNode {
  id: number;
  key: string;
  x: number;
  y: number;
  z: number;
  tag: string | null;
}

export interface NavEdge {
  id: number;
  a: number;
  b: number;
  length: number;
  /** blockerId → extra traversal cost (cost of breaking that wall). */
  blockers: Map<string, number>;
}

export class NavGraph {
  readonly nodes: NavNode[] = [];
  readonly edges: NavEdge[] = [];
  readonly adj: number[][] = [];
  private byKey = new Map<string, number>();
  private blockerEdges = new Map<string, number[]>();

  addNode(key: string, pos: Vec3Like, tag: string | null = null): number {
    const existing = this.byKey.get(key);
    if (existing !== undefined) return existing;
    const id = this.nodes.length;
    this.nodes.push({ id, key, x: pos.x, y: pos.y, z: pos.z, tag });
    this.adj.push([]);
    this.byKey.set(key, id);
    return id;
  }

  nodeId(key: string): number | undefined {
    return this.byKey.get(key);
  }

  addEdge(a: number, b: number): number {
    if (a === b) return -1;
    const dup = this.adj[a]!.find((e) => {
      const edge = this.edges[e]!;
      return edge.a === b || edge.b === b;
    });
    if (dup !== undefined) return dup;
    const na = this.nodes[a]!;
    const nb = this.nodes[b]!;
    const id = this.edges.length;
    this.edges.push({ id, a, b, length: Math.hypot(na.x - nb.x, na.y - nb.y, na.z - nb.z), blockers: new Map() });
    this.adj[a]!.push(id);
    this.adj[b]!.push(id);
    return id;
  }

  other(edge: NavEdge, from: number): number {
    return edge.a === from ? edge.b : edge.a;
  }

  edgeBetween(a: number, b: number): NavEdge | undefined {
    for (const e of this.adj[a] ?? []) {
      const edge = this.edges[e]!;
      if (this.other(edge, a) === b) return edge;
    }
    return undefined;
  }

  /**
   * Marks every edge passing within `radius` of `pos` as blocked by `blockerId`.
   * Traversing it costs `breakCost` extra (the zombie has to break the wall).
   * Returns the affected edge ids so only paths using them are recomputed (local recompute).
   */
  blockNear(blockerId: string, pos: Vec3Like, radius: number, breakCost: number): number[] {
    const affected: number[] = [];
    for (const edge of this.edges) {
      const a = this.nodes[edge.a]!;
      const b = this.nodes[edge.b]!;
      if (Math.abs(pos.y - Math.min(a.y, b.y)) > 2.5 && Math.abs(pos.y - Math.max(a.y, b.y)) > 2.5) continue;
      if (pointSegmentDistXZ(pos, a, b) <= radius) {
        edge.blockers.set(blockerId, breakCost);
        affected.push(edge.id);
      }
    }
    this.blockerEdges.set(blockerId, affected);
    return affected;
  }

  unblock(blockerId: string): number[] {
    const affected = this.blockerEdges.get(blockerId) ?? [];
    for (const e of affected) this.edges[e]!.blockers.delete(blockerId);
    this.blockerEdges.delete(blockerId);
    return affected;
  }

  isBlocked(edge: NavEdge): boolean {
    return edge.blockers.size > 0;
  }

  nearestNode(pos: Vec3Like, accept?: (n: NavNode) => boolean): number {
    let best = -1;
    let bestD = Infinity;
    for (const n of this.nodes) {
      if (accept && !accept(n)) continue;
      const d = (n.x - pos.x) ** 2 + ((n.y - pos.y) * 3) ** 2 + (n.z - pos.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return best;
  }

  /** Connected components ignoring blockers; returns nodes outside the largest component (TR-NAV-03). */
  findDisconnected(): NavNode[] {
    const comp = new Array<number>(this.nodes.length).fill(-1);
    const sizes: number[] = [];
    for (let start = 0; start < this.nodes.length; start++) {
      if (comp[start] !== -1) continue;
      const c = sizes.length;
      sizes.push(0);
      const stack = [start];
      comp[start] = c;
      while (stack.length) {
        const n = stack.pop()!;
        sizes[c]!++;
        for (const e of this.adj[n]!) {
          const m = this.other(this.edges[e]!, n);
          if (comp[m] === -1) {
            comp[m] = c;
            stack.push(m);
          }
        }
      }
    }
    if (sizes.length <= 1) return [];
    const main = sizes.indexOf(Math.max(...sizes));
    return this.nodes.filter((n) => comp[n.id] !== main);
  }
}
