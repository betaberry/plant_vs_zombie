// Shop filtering, status and purchase rules (FR-SHP-01..15, D-21). Pure.
import type { ShopCategory, ShopConfig, ShopItem } from '../config/types';
import { isItemEnabled } from '../config/validate';
import { addReserve, type AmmoState } from './ammo';
import { spendSun, type SunWallet } from './economy';
import { addItem, canAdd, countOf, type Inventory } from './inventory';

export const SHOP_TABS: ShopCategory[] = ['ammo', 'potion', 'seed', 'consumable', 'equipment'];

export type PurchaseFailure = 'not_available' | 'insufficient_sun' | 'full' | 'hotbar_full' | 'reserve_full';

export interface ShopContext {
  characterId: string;
  wallet: SunWallet;
  inventory: Inventory;
  ammo: AmmoState | null;
  ownedEquipment: Set<string>;
  upgrades: { damageBonus: number; sunBonus: number };
  ammoPackRounds: number;
}

export type PurchaseResult =
  | { ok: true; item: ShopItem; discarded: number }
  | { ok: false; item: ShopItem | null; reason: PurchaseFailure };

/** Items the character may buy; others are not listed at all (FR-SHP-04). */
export function visibleItems(shop: ShopConfig, characterId: string, category?: ShopCategory): ShopItem[] {
  return shop.items.filter(
    (i) => isItemEnabled(i) && i.availableTo.includes(characterId) && (category === undefined || i.category === category),
  );
}

export function ownedCount(item: ShopItem, ctx: ShopContext): number {
  if (item.category === 'ammo') return ctx.ammo?.reserve ?? 0;
  if (item.category === 'equipment') return ctx.ownedEquipment.has(item.id) ? 1 : 0;
  return countOf(ctx.inventory, item.id);
}

function fullReason(item: ShopItem, ctx: ShopContext): PurchaseFailure | null {
  if (item.category === 'ammo') {
    if (!ctx.ammo) return 'not_available';
    return ctx.ammo.reserve >= ctx.ammo.reserveMax ? 'reserve_full' : null;
  }
  if (item.category === 'equipment') return ctx.ownedEquipment.has(item.id) ? 'full' : null;
  const r = canAdd(ctx.inventory, item.id, item.maxCarry);
  return r === 'ok' ? null : r;
}

/** Why an item is greyed out right now (null = purchasable). */
export function itemBlockReason(item: ShopItem, ctx: ShopContext): PurchaseFailure | null {
  if (!isItemEnabled(item) || !item.availableTo.includes(ctx.characterId)) return 'not_available';
  const full = fullReason(item, ctx);
  if (full) return full;
  if (ctx.wallet.sun + 1e-6 < item.price) return 'insufficient_sun';
  return null;
}

function applyItem(item: ShopItem, ctx: ShopContext): number {
  if (item.category === 'ammo') return addReserve(ctx.ammo as AmmoState, ctx.ammoPackRounds).discarded;
  if (item.category === 'equipment') {
    ctx.ownedEquipment.add(item.id);
    if (item.effect?.type === 'permanentDamage') ctx.upgrades.damageBonus += item.effect.bonus;
    if (item.effect?.type === 'permanentSun') ctx.upgrades.sunBonus += item.effect.bonus;
    return 0;
  }
  addItem(ctx.inventory, item.id, 1, item.maxCarry);
  return 0;
}

export function purchase(shop: ShopConfig, ctx: ShopContext, itemId: string): PurchaseResult {
  const item = shop.items.find((i) => i.id === itemId) ?? null;
  if (!item) return { ok: false, item: null, reason: 'not_available' };
  const reason = itemBlockReason(item, ctx);
  if (reason) return { ok: false, item, reason };
  if (!spendSun(ctx.wallet, item.price)) return { ok: false, item, reason: 'insufficient_sun' };
  const discarded = applyItem(item, ctx);
  return { ok: true, item, discarded };
}

/** FR-SHP-13: show the persistent out-of-ammo banner in the shop. */
export function showOutOfAmmoBanner(ctx: ShopContext): boolean {
  return ctx.ammo !== null && ctx.ammo.reserve <= 0;
}
