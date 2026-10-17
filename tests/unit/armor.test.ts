import { describe, expect, it } from 'vitest';
import { armorCovers, createArmorState, resolveArmorHit } from '../../src/logic/armor';
import { zoneMultiplier } from '../../src/logic/damage';
import { config } from './helpers';

const cfg = config();
const gun = cfg.weapons.pea_gun;
const armorOf = (id: string) => cfg.zombies[id]!.armor!;

describe('zombie armour (Revision 2, plan Step 27)', () => {
  it('a cone absorbs 200 damage before the body is hurt, and overflow carries over', () => {
    const def = armorOf('conehead_zombie');
    const state = createArmorState(def)!;
    expect(state.health).toBe(200);
    // 150 to the head (×1 multiplier given explicitly): all absorbed by the cone.
    const first = resolveArmorHit(def, state, { amount: 150, source: 'gun', zone: 'head', zoneMultiplier: 1 });
    expect(first).toEqual({ armorDamage: 150, bodyDamage: 0, hitArmor: true, brokeNow: false });
    // 80 more: the cone has 50 left, the remaining 30 reaches the body.
    const second = resolveArmorHit(def, state, { amount: 80, source: 'gun', zone: 'head', zoneMultiplier: 1 });
    expect(second.armorDamage).toBeCloseTo(50, 6);
    expect(second.bodyDamage).toBeCloseTo(30, 6);
    expect(second.brokeNow).toBe(true);
    expect(state.broken).toBe(true);
    // Broken armour no longer absorbs anything.
    expect(resolveArmorHit(def, state, { amount: 40, source: 'gun', zone: 'head' }).bodyDamage).toBe(40);
  });

  it('a cone worn on the head does not stop torso hits', () => {
    const def = armorOf('conehead_zombie');
    const state = createArmorState(def)!;
    const res = resolveArmorHit(def, state, { amount: 34, source: 'gun', zone: 'torso', zoneMultiplier: 1 });
    expect(res).toEqual({ armorDamage: 0, bodyDamage: 34, hitArmor: false, brokeNow: false });
    expect(state.health).toBe(200);
  });

  it('a headshot on a bucket is not doubled: the bucket takes ×1 damage', () => {
    const def = armorOf('buckethead_zombie');
    const state = createArmorState(def)!;
    const mult = zoneMultiplier('head', gun);
    expect(mult).toBe(2);
    const res = resolveArmorHit(def, state, { amount: gun.damage * mult, source: 'gun', zone: 'head', zoneMultiplier: mult });
    expect(res.armorDamage).toBeCloseTo(gun.damage, 6);
    expect(res.bodyDamage).toBe(0);
    expect(state.health).toBeCloseTo(500 - gun.damage, 6);
  });

  it('headshot overflow through a breaking bucket hits the body with the head multiplier', () => {
    const def = armorOf('buckethead_zombie');
    const state = { health: 10, broken: false };
    const res = resolveArmorHit(def, state, { amount: 68, source: 'gun', zone: 'head', zoneMultiplier: 2 });
    expect(res.armorDamage).toBeCloseTo(10, 6);
    expect(res.bodyDamage).toBeCloseTo((34 - 10) * 2, 6);
    expect(res.brokeNow).toBe(true);
  });

  it('a screen door blocks frontal shots but side and back shots reach the body', () => {
    const def = armorOf('screendoor_zombie');
    expect(def.frontAngleDeg).toBe(60);
    const state = createArmorState(def)!;
    const front = resolveArmorHit(def, state, { amount: 34, source: 'gun', zone: 'torso', hitAngleDeg: 30 });
    expect(front).toMatchObject({ armorDamage: 34, bodyDamage: 0, hitArmor: true });
    const edge = resolveArmorHit(def, state, { amount: 10, source: 'gun', zone: 'limb', hitAngleDeg: -60 });
    expect(edge.armorDamage).toBe(10);
    const side = resolveArmorHit(def, state, { amount: 34, source: 'gun', zone: 'torso', hitAngleDeg: 90 });
    expect(side).toEqual({ armorDamage: 0, bodyDamage: 34, hitArmor: false, brokeNow: false });
    const back = resolveArmorHit(def, state, { amount: 68, source: 'gun', zone: 'head', zoneMultiplier: 2, hitAngleDeg: 180 });
    expect(back.bodyDamage).toBe(68);
    expect(state.health).toBe(550 - 44);
  });

  it('an explosion damages both the screen door and the body', () => {
    const def = armorOf('screendoor_zombie');
    const state = createArmorState(def)!;
    const res = resolveArmorHit(def, state, { amount: 120, source: 'explosion', hitAngleDeg: 0 });
    expect(res.armorDamage).toBe(120);
    expect(res.bodyDamage).toBe(120);
    expect(state.health).toBe(430);
    // A blast bigger than the remaining door breaks it and still hits the body in full.
    const big = resolveArmorHit(def, state, { amount: 500, source: 'explosion' });
    expect(big.armorDamage).toBe(430);
    expect(big.bodyDamage).toBe(500);
    expect(big.brokeNow).toBe(true);
  });

  it('the football helmet covers head and torso but not limbs; no armour passes damage through', () => {
    const def = armorOf('football_zombie');
    expect(armorCovers(def.protects, def.frontAngleDeg, 'head', 180)).toBe(true);
    expect(armorCovers(def.protects, def.frontAngleDeg, 'torso', 0)).toBe(true);
    expect(armorCovers(def.protects, def.frontAngleDeg, 'limb', 0)).toBe(false);
    expect(createArmorState(cfg.zombies.basic_zombie!.armor)).toBeNull();
    expect(resolveArmorHit(null, null, { amount: 34, source: 'gun', zone: 'head' }).bodyDamage).toBe(34);
    // Unknown attacker direction counts as frontal for front-only armour.
    expect(armorCovers('front', 60, 'torso', null)).toBe(true);
  });
});
