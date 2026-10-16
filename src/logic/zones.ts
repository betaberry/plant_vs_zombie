// Plantable-zone queries (FR-MAP-13). Pure.
import type { ZoneDef } from '../config/types';
import { pointInPolygon } from './math';

export interface ZoneQuery {
  plantable: ZoneDef[];
  blocked: ZoneDef[];
}

/** Returns null when plantable, otherwise the blocking zone type (or 'outside'). */
export function zoneBlockReason(q: ZoneQuery, x: number, z: number): string | null {
  const inside = q.plantable.some((zone) => pointInPolygon(x, z, zone.points));
  if (!inside) return 'outside';
  const blocked = q.blocked.find((zone) => pointInPolygon(x, z, zone.points));
  return blocked ? blocked.type : null;
}
