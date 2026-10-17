// Step 28/29: rig part geometry (body + accessories) and the zombie main-pass draw-call budget.
import { describe, expect, it } from 'vitest';
import { ACCESSORY_PART_TYPES, buildZombieGeometries, PART_TYPES } from '../../src/render/zombieGeometry';
import { config, rawConfig } from './helpers';
import { validateConfig } from '../../src/config/validate';

type AnyObj = Record<string, any>;

const vis = config().game.zombieVisual;

describe('zombie rig geometry', () => {
  it('stays within the 24 zombie draw calls (one InstancedMesh per part type)', () => {
    expect(PART_TYPES.length).toBeLessThanOrEqual(24);
    expect(new Set(PART_TYPES).size).toBe(PART_TYPES.length);
  });

  it('builds every part (accessories included) with finite positions and baked vertex colours', () => {
    const geos = buildZombieGeometries(vis);
    for (const part of PART_TYPES) {
      const g = geos[part];
      const pos = g.getAttribute('position');
      const col = g.getAttribute('color');
      expect(pos.count, part).toBeGreaterThan(0);
      expect(col.count, part).toBe(pos.count);
      for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i]), part).toBe(true);
      for (let i = 0; i < col.array.length; i++) expect(col.array[i]! >= 0 && col.array[i]! <= 1.0001, part).toBe(true);
    }
    // The dented cone differs from the intact one; hats sit above the head joint.
    const a = geos.cone.getAttribute('position').array;
    const b = geos.coneDented.getAttribute('position').array;
    let diff = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff = Math.max(diff, Math.abs(a[i]! - b[i]!));
    expect(diff).toBeGreaterThan(0.01);
    for (const hat of ['cone', 'bucket'] as const) {
      geos[hat].computeBoundingBox();
      expect(geos[hat].boundingBox!.min.y).toBeGreaterThan(vis.proportions.headCenterOffset);
    }
    expect(ACCESSORY_PART_TYPES).toContain('coneDented');
  });

  it('config validation rejects a missing accessory colour, a bad vault phase order and a type missing its armour part', () => {
    const raw = rawConfig();
    const zv = (raw.game as AnyObj).zombieVisual;
    delete zv.accessoryColors.bucket;
    zv.animation.vault.plantEnd = 0.9;
    (raw.zombies as AnyObj).buckethead_zombie.visual.accessories = [];
    (raw.zombies as AnyObj).football_zombie.visual.poseStyle = 'moonwalk';
    const errors = validateConfig(raw);
    expect(errors).toContain('game.zombieVisual.accessoryColors.bucket: 需要颜色字符串');
    expect(errors).toContain('game.zombieVisual.animation.vault: 需要 0 < plantEnd < flightEnd < 1');
    expect(errors).toContain('zombies.buckethead_zombie.visual.accessories: 缺少护甲部件 "bucket"');
    expect(errors.some((e) => e.includes('zombies.football_zombie.visual.poseStyle'))).toBe(true);
  });
});
