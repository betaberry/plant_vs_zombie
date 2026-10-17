import { describe, expect, it } from 'vitest';
import { canPlantAt, type PlantContext } from '../../src/logic/planting';
import { config } from './helpers';

const cfg = config();
// Player stands on the sidewalk, away from the no-plant road centre strip.
const origin = { x: 20, y: 0, z: 20 };
const at = (dx: number, dz = 0) => ({ x: origin.x + dx, y: 0, z: origin.z + dz });
const flat = { normalY: 1 };
const slope30 = { normalY: Math.cos((30 * Math.PI) / 180) };

function ctx(plantId: string, characterId: string, over: Partial<PlantContext> = {}): PlantContext {
  return {
    characterId,
    playerPos: origin,
    plant: cfg.plants.plants[plantId]!,
    rules: cfg.plants.plantingRules,
    aliveOfType: 0,
    ground: flat,
    zones: { plantable: cfg.maps.city_01.plantableZones, blocked: cfg.maps.city_01.nonPlantableZones },
    occupied: [],
    ...over,
  };
}

describe('canPlantAt (FR-MAP-14, FR-PLT-03/04/10)', () => {
  it('accepts flat ground 5 m away (TC-PLT-01)', () => {
    expect(canPlantAt(at(5), ctx('sunflower_plant', 'pea_gunner'))).toEqual({ ok: true });
  });

  it('rejects ground 8 m away (TC-PLT-02)', () => {
    expect(canPlantAt(at(8), ctx('sunflower_plant', 'pea_gunner'))).toEqual({ ok: false, reason: 'too_far' });
  });

  it('rejects a 30° slope with the slope reason (TC-PLT-03)', () => {
    expect(canPlantAt(at(3), ctx('nut_wall', 'pea_gunner', { ground: slope30 }))).toEqual({ ok: false, reason: 'slope' });
  });

  it('rejects the 9th pea shooter (TC-PLT-05)', () => {
    expect(canPlantAt(at(2), ctx('pea_shooter_plant', 'sunflower', { aliveOfType: 8 }))).toEqual({ ok: false, reason: 'limit' });
    expect(canPlantAt(at(2), ctx('pea_shooter_plant', 'sunflower', { aliveOfType: 7 })).ok).toBe(true);
  });

  it('rejects overlap, road centre, missing ground and the wrong character', () => {
    const occupied = [{ pos: at(2.5), radius: 0.6 }];
    expect(canPlantAt(at(2), ctx('nut_wall', 'sunflower', { occupied }))).toEqual({ ok: false, reason: 'overlap' });
    const onRoad = ctx('nut_wall', 'sunflower', { playerPos: { x: 4, y: 0, z: 40 } });
    expect(canPlantAt({ x: 0, y: 0, z: 40 }, onRoad)).toEqual({ ok: false, reason: 'zone', detail: 'road_center' });
    expect(canPlantAt(at(4), ctx('nut_wall', 'sunflower', { ground: null }))).toEqual({ ok: false, reason: 'no_ground' });
    expect(canPlantAt(at(4), ctx('sunflower_plant', 'sunflower'))).toEqual({ ok: false, reason: 'not_allowed' });
  });
});
