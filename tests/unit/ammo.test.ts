import { describe, expect, it } from 'vitest';
import { addReserve, cancelReload, createAmmo, startReload, tickReload, tryFire } from '../../src/logic/ammo';
import { config } from './helpers';

const gun = config().weapons.pea_gun;
const pack = config().weapons.ammo_pack;

function emptyMag(a: ReturnType<typeof createAmmo>): number {
  let shots = 0;
  while (tryFire(a) === 'fired') shots++;
  return shots;
}

describe('ammo (FR-WPN-05/06/15..17)', () => {
  it('emptying the magazine requires a reload before firing again (TC-WPN-01)', () => {
    const a = createAmmo(gun.magazineSize, gun.reserveAmmoMax, 240);
    expect(emptyMag(a)).toBe(24);
    expect(tryFire(a)).toBe('empty_mag');
    expect(startReload(a, gun.reloadTime)).toBe('started');
    expect(tryFire(a)).toBe('reloading');
    expect(tickReload(a, 1.0)).toBe(false);
    expect(tickReload(a, 1.0)).toBe(true);
    expect(a.mag).toBe(24);
    expect(a.reserve).toBe(216);
  });

  it('240 reserve rounds allow exactly 10 reloads, then ammo is depleted (TC-WPN-05)', () => {
    const a = createAmmo(gun.magazineSize, gun.reserveAmmoMax, 240);
    let reloads = 0;
    for (;;) {
      emptyMag(a);
      if (startReload(a, gun.reloadTime) !== 'started') break;
      tickReload(a, gun.reloadTime);
      reloads++;
    }
    expect(reloads).toBe(10);
    expect(startReload(a, gun.reloadTime)).toBe('no_reserve');
    expect(tryFire(a)).toBe('no_ammo');
  });

  it('ammo pack overflow above 240 is discarded (FR-WPN-17)', () => {
    const a = createAmmo(gun.magazineSize, gun.reserveAmmoMax, 220);
    expect(addReserve(a, pack.rounds)).toEqual({ added: 20, discarded: 28 });
    expect(a.reserve).toBe(240);
  });

  it('an interrupted reload consumes nothing and a full magazine cannot reload', () => {
    const a = createAmmo(gun.magazineSize, gun.reserveAmmoMax, 100, 10);
    expect(startReload(a, gun.reloadTime)).toBe('started');
    expect(cancelReload(a)).toBe(true);
    expect(tickReload(a, 5)).toBe(false);
    expect(a.mag).toBe(10);
    expect(a.reserve).toBe(100);
    expect(startReload(createAmmo(24, 240, 100), gun.reloadTime)).toBe('full');
  });
});
