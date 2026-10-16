import { describe, expect, it } from 'vitest';
import { createPotionState, drinkPotion, potionDamageMultiplier, potionSlow, tickPotion } from '../../src/logic/potions';
import { config } from './helpers';

const items = config().shop.items;
const ice = items.find((i) => i.id === 'ice_potion')!;
const power = items.find((i) => i.id === 'power_potion')!;

describe('potions (FR-SHP-14, D-25)', () => {
  it('drinking power while ice is active replaces it immediately (TC-WPN-07)', () => {
    const s = createPotionState();
    expect(drinkPotion(s, ice)).toEqual({ replaced: false, previous: null });
    expect(potionSlow(s)).toEqual({ percent: 50, duration: 3 });
    tickPotion(s, 10);
    expect(drinkPotion(s, power)).toEqual({ replaced: true, previous: 'ice_potion' });
    expect(potionSlow(s)).toBeNull();
    expect(potionDamageMultiplier(s)).toBe(1.5);
    expect(s.active!.remaining).toBe(30);
  });

  it('expires after 30 seconds', () => {
    const s = createPotionState();
    drinkPotion(s, power);
    expect(tickPotion(s, 29.9)).toBe(false);
    expect(potionDamageMultiplier(s)).toBe(1.5);
    expect(tickPotion(s, 0.1)).toBe(true);
    expect(s.active).toBeNull();
    expect(potionDamageMultiplier(s)).toBe(1);
  });

  it('rejects non-potion items and does nothing without an active potion', () => {
    const s = createPotionState();
    const medkit = items.find((i) => i.id === 'medkit')!;
    expect(() => drinkPotion(s, medkit)).toThrow();
    expect(tickPotion(s, 1)).toBe(false);
    expect(potionSlow(s)).toBeNull();
  });
});
