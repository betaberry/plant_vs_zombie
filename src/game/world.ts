// One playable map: pure layout → render/physics City → waypoint graph. Built per game mode and disposed
// when the mode changes (plan: never keep both maps' colliders alive at the same time).
import type { AllConfig } from '../config/types';
import { buildNavGraph } from '../nav/build';
import type { NavGraph } from '../nav/graph';
import type { PhysicsWorld } from '../physics/world';
import type { GameRenderer } from '../render/renderer';
import { City } from '../world/cityBuilder';
import { generateLayout, type CityLayout } from '../world/layout';
import { generateRingLayout, type RingLayout } from '../world/ringLayout';

export type GameMode = 'practice' | 'guard';

export interface GameWorld {
  mode: GameMode;
  layout: CityLayout;
  /** Guard mode only: ring-specific layout data (core, entrances, spawn points). */
  ring: RingLayout | null;
  city: City;
  nav: NavGraph;
  dispose(): void;
}

export function buildWorld(mode: GameMode, cfg: AllConfig, renderer: GameRenderer, phys: PhysicsWorld): GameWorld {
  let layout: CityLayout;
  let ring: RingLayout | null = null;
  let nav: NavGraph;
  if (mode === 'guard') {
    ring = generateRingLayout(cfg.maps.ring_01);
    layout = ring;
    nav = buildNavGraph({ grid: null, obstacles: ring.obstacles, extraNodes: ring.navNodes, extraEdges: ring.navEdges, doorLinks: ring.doorLinks });
  } else {
    const map = cfg.maps.city_01;
    layout = generateLayout(map);
    nav = buildNavGraph({
      grid: map.waypointGraph.grid,
      obstacles: layout.obstacles,
      extraNodes: [...layout.navNodes, ...map.waypointGraph.nodes.map((n) => ({ key: n.id, pos: { x: n.pos[0], y: n.pos[1], z: n.pos[2] }, tag: 'outdoor' }))],
      extraEdges: [...layout.navEdges, ...map.waypointGraph.edges],
      doorLinks: layout.doorLinks.map((d) => ({ ...d, radius: map.waypointGraph.doorLinkRadius })),
    });
  }
  const city = new City(renderer.scene, phys, layout);
  const disconnected = nav.findDisconnected();
  if (disconnected.length > 0) console.warn(`[nav] ${mode} 不连通航点：`, disconnected.map((n) => `${n.key} (${n.x.toFixed(1)}, ${n.y.toFixed(1)}, ${n.z.toFixed(1)})`));
  return { mode, layout, ring, city, nav, dispose: () => city.dispose() };
}
