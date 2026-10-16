import { describe, expect, it } from 'vitest';
import { createWallet } from '../../src/logic/economy';
import {
  addItem, cancelSelection, consumeOne, createInventory, cycleSlot, heldItem, selectSlot, shovelRefund, toggleShovel,
} from '../../src/logic/inventory';
import { config } from './helpers';

const cfg = config();

describe('hotbar & shovel (FR-INV)', () => {
  it('selects a slot and deselects when the same key is pressed again', () => {
    const inv = createInventory(6);
    addItem(inv, 'medkit', 2, 3);
    addItem(inv, 'nut_wall_seed', 1, 4);
    expect(selectSlot(inv, 1)).toBe('selected');
    expect(heldItem(inv)).toBe('nut_wall_seed');
    expect(selectSlot(inv, 1)).toBe('deselected');
    expect(heldItem(inv)).toBeNull();
    expect(selectSlot(inv, 4)).toBe('empty');
  });

  it('consuming the last item frees the slot and the selection', () => {
    const inv = createInventory(6);
    addItem(inv, 'pea_shooter_seed', 1, 3);
    selectSlot(inv, 0);
    expect(consumeOne(inv, 'pea_shooter_seed')).toBe(true);
    expect(inv.slots[0]).toBeNull();
    expect(heldItem(inv)).toBeNull();
    expect(consumeOne(inv, 'pea_shooter_seed')).toBe(false);
  });

  it('respects carry limits and cycles over non-empty slots', () => {
    const inv = createInventory(6);
    expect(addItem(inv, 'medkit', 5, 3)).toEqual({ added: 3, reason: 'ok' });
    expect(addItem(inv, 'medkit', 1, 3)).toEqual({ added: 0, reason: 'full' });
    addItem(inv, 'nut_wall_seed', 1, 4);
    expect(cycleSlot(inv, 1)).toBe(0);
    expect(cycleSlot(inv, 1)).toBe(1);
    expect(cycleSlot(inv, 1)).toBe(0);
  });

  it('shovel mode cancels selection and shoveling returns no sun (TC-PLT-08)', () => {
    const inv = createInventory(6);
    addItem(inv, 'sunflower_seed', 1, 3);
    selectSlot(inv, 0);
    expect(toggleShovel(inv)).toBe(true);
    expect(heldItem(inv)).toBeNull();
    const wallet = createWallet(120, 999);
    const seed = cfg.shop.items.find((i) => i.id === 'sunflower_seed')!;
    const plants = ['p1', 'p2', 'p3'];
    const refund = shovelRefund(seed.price, cfg.plants.plantingRules.refundPercentOnShovel);
    plants.splice(plants.indexOf('p2'), 1);
    wallet.sun += refund;
    expect(refund).toBe(0);
    expect(wallet.sun).toBe(120);
    expect(plants).toHaveLength(2);
    expect(cancelSelection(inv)).toBe(true);
    expect(inv.shovel).toBe(false);
  });
});
