import { describe, expect, it } from 'vitest';
import { hotbarKindsFor, validateConfig } from '../../src/config/validate';
import type { ShopItem } from '../../src/config/types';
import { rawConfig } from './helpers';

type AnyObj = Record<string, any>;

describe('validateConfig (TR-CFG-01/02/05)', () => {
  it('accepts the shipped configuration', () => {
    expect(validateConfig(rawConfig())).toEqual([]);
  });

  it('reports a seedItemId that does not exist in shop.json', () => {
    const raw = rawConfig();
    (raw.plants as AnyObj).nut_wall.seedItemId = 'missing_seed';
    const errors = validateConfig(raw);
    expect(errors.some((e) => e.includes('nut_wall') && e.includes('missing_seed'))).toBe(true);
  });

  it('reports availableTo inconsistent with onlyByCharacter (TC-SUN-02 abnormal config)', () => {
    const raw = rawConfig();
    const seed = (raw.shop as AnyObj).items.find((i: AnyObj) => i.id === 'sunflower_seed');
    seed.availableTo = ['pea_gunner', 'sunflower'];
    const errors = validateConfig(raw);
    expect(errors.some((e) => e.includes('sunflower_plant') && e.includes('不一致'))).toBe(true);
  });

  it('reports more than 6 simultaneously holdable hotbar kinds (TR-CFG-05 / TC-SUN-02)', () => {
    const raw = rawConfig();
    const items = (raw.shop as AnyObj).items as AnyObj[];
    // Enabling the grenade gives the sunflower character 7 hotbar kinds.
    items.find((i) => i.id === 'grenade')!.enabled = true;
    const errors = validateConfig(raw);
    expect(errors.some((e) => e.includes('"sunflower"') && e.includes('超过快捷栏 6 格'))).toBe(true);
  });

  it('reports a missing required field and an unknown character reference', () => {
    const raw = rawConfig();
    delete (raw.characters as AnyObj).pea_gunner.maxHealth;
    (raw.shop as AnyObj).items[0].availableTo = ['ghost'];
    const errors = validateConfig(raw);
    expect(errors).toContain('characters.pea_gunner: 缺少字段 "maxHealth"');
    expect(errors.some((e) => e.includes('ghost'))).toBe(true);
  });

  it('counts only enabled hotbar categories per character', () => {
    const items = (rawConfig().shop as AnyObj).items as ShopItem[];
    expect(hotbarKindsFor('pea_gunner', items).sort()).toEqual(
      ['ice_potion', 'medkit', 'nut_wall_seed', 'power_potion', 'sunflower_seed'].sort(),
    );
    expect(hotbarKindsFor('sunflower', items)).toHaveLength(6);
  });
});
