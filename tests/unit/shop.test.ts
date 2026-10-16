import { describe, expect, it } from 'vitest';
import { createAmmo } from '../../src/logic/ammo';
import { createWallet } from '../../src/logic/economy';
import { addItem, createInventory } from '../../src/logic/inventory';
import { itemBlockReason, purchase, showOutOfAmmoBanner, visibleItems, type ShopContext } from '../../src/logic/shop';
import { config } from './helpers';

const cfg = config();

function ctx(characterId: string, sun: number, withAmmo: boolean, reserve = 0): ShopContext {
  return {
    characterId,
    wallet: createWallet(sun, cfg.game.economy.sunCap),
    inventory: createInventory(cfg.game.inventory.hotbarSlots),
    ammo: withAmmo ? createAmmo(24, 240, reserve) : null,
    ownedEquipment: new Set(),
    upgrades: { damageBonus: 0, sunBonus: 0 },
    ammoPackRounds: cfg.weapons.ammo_pack.rounds,
  };
}

describe('shop (FR-SHP, D-21)', () => {
  it('sunflower does not see ammo, potions or sunflower seeds (TC-SHP-04, TC-PLT-04)', () => {
    const ids = visibleItems(cfg.shop, 'sunflower').map((i) => i.id);
    for (const hidden of ['ammo_pack', 'ice_potion', 'power_potion', 'sunflower_seed']) expect(ids).not.toContain(hidden);
    expect(ids).toContain('pea_shooter_seed');
    expect(visibleItems(cfg.shop, 'pea_gunner').map((i) => i.id)).not.toContain('pea_shooter_seed');
  });

  it('30 sun cannot buy a 40-sun item (TC-SHP-01)', () => {
    const c = ctx('pea_gunner', 30, true, 100);
    const nut = cfg.shop.items.find((i) => i.id === 'nut_wall_seed')!;
    expect(itemBlockReason(nut, c)).toBe('insufficient_sun');
    const res = purchase(cfg.shop, c, 'nut_wall_seed');
    expect(res.ok).toBe(false);
    expect(c.wallet.sun).toBe(30);
  });

  it('rejects purchases at the carry limit and buys the right item otherwise', () => {
    const c = ctx('sunflower', 999, false);
    for (let i = 0; i < 3; i++) expect(purchase(cfg.shop, c, 'pea_shooter_seed').ok).toBe(true);
    const fourth = purchase(cfg.shop, c, 'pea_shooter_seed');
    expect(fourth).toMatchObject({ ok: false, reason: 'full' });
    expect(c.wallet.sun).toBe(999 - 3 * 75);
    expect(c.inventory.counts.pea_shooter_seed).toBe(3);
  });

  it('ammo pack refills reserve immediately, discards overflow, and refuses when full', () => {
    const c = ctx('pea_gunner', 100, true, 220);
    const res = purchase(cfg.shop, c, 'ammo_pack');
    expect(res).toMatchObject({ ok: true, discarded: 28 });
    expect(c.ammo!.reserve).toBe(240);
    expect(purchase(cfg.shop, c, 'ammo_pack')).toMatchObject({ ok: false, reason: 'reserve_full' });
    expect(c.wallet.sun).toBe(75);
  });

  it('flags the out-of-ammo banner, refuses unavailable items and applies permanent upgrades', () => {
    const c = ctx('pea_gunner', 500, true, 0);
    expect(showOutOfAmmoBanner(c)).toBe(true);
    expect(purchase(cfg.shop, c, 'pea_shooter_seed')).toMatchObject({ ok: false, reason: 'not_available' });
    expect(purchase(cfg.shop, c, 'pea_gun_upgrade').ok).toBe(true);
    expect(c.upgrades.damageBonus).toBeCloseTo(0.2, 6);
    expect(purchase(cfg.shop, c, 'pea_gun_upgrade')).toMatchObject({ ok: false, reason: 'full' });
  });

  it('reports a full hotbar when all 6 slots hold other kinds', () => {
    const c = ctx('sunflower', 999, false);
    ['a', 'b', 'c', 'd', 'e', 'f'].forEach((id) => addItem(c.inventory, id, 1, null));
    expect(purchase(cfg.shop, c, 'medkit')).toMatchObject({ ok: false, reason: 'hotbar_full' });
  });
});
