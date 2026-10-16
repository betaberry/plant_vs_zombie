// 6-slot hotbar, held-item rules and shovel mode (FR-INV-01..10). Pure.

export interface Inventory {
  slots: (string | null)[];
  counts: Record<string, number>;
  selected: number | null;
  shovel: boolean;
}

export type AddReason = 'ok' | 'full' | 'hotbar_full';

export function createInventory(slotCount: number): Inventory {
  return { slots: new Array<string | null>(slotCount).fill(null), counts: {}, selected: null, shovel: false };
}

export function countOf(inv: Inventory, id: string): number {
  return inv.counts[id] ?? 0;
}

export function canAdd(inv: Inventory, id: string, maxCarry: number | null): AddReason {
  const count = countOf(inv, id);
  if (maxCarry !== null && count >= maxCarry) return 'full';
  if (count === 0 && !inv.slots.includes(null)) return 'hotbar_full';
  return 'ok';
}

/** Adds up to `n` items respecting the carry limit; a new kind takes the first free slot. */
export function addItem(inv: Inventory, id: string, n: number, maxCarry: number | null): { added: number; reason: AddReason } {
  const reason = canAdd(inv, id, maxCarry);
  if (reason !== 'ok') return { added: 0, reason };
  const count = countOf(inv, id);
  const added = maxCarry === null ? n : Math.min(n, maxCarry - count);
  if (count === 0) inv.slots[inv.slots.indexOf(null)] = id;
  inv.counts[id] = count + added;
  return { added, reason: 'ok' };
}

/** Consumes one item; frees its slot (and the selection) when the count reaches zero. */
export function consumeOne(inv: Inventory, id: string): boolean {
  const count = countOf(inv, id);
  if (count <= 0) return false;
  if (count === 1) {
    delete inv.counts[id];
    const idx = inv.slots.indexOf(id);
    if (idx >= 0) {
      inv.slots[idx] = null;
      if (inv.selected === idx) inv.selected = null;
    }
  } else {
    inv.counts[id] = count - 1;
  }
  return true;
}

/** Number key: selects the slot, or deselects when pressing the same key again (FR-INV-05). */
export function selectSlot(inv: Inventory, index: number): 'selected' | 'deselected' | 'empty' {
  if (index < 0 || index >= inv.slots.length || inv.slots[index] === null) return 'empty';
  inv.shovel = false;
  if (inv.selected === index) {
    inv.selected = null;
    return 'deselected';
  }
  inv.selected = index;
  return 'selected';
}

/** Mouse wheel: cycles through non-empty slots. */
export function cycleSlot(inv: Inventory, dir: 1 | -1): number | null {
  const n = inv.slots.length;
  const start = inv.selected ?? (dir === 1 ? -1 : 0);
  for (let step = 1; step <= n; step++) {
    const idx = (((start + dir * step) % n) + n) % n;
    if (inv.slots[idx] !== null) {
      inv.selected = idx;
      inv.shovel = false;
      return idx;
    }
  }
  return null;
}

/** Right click / Esc: back to the default held state. Returns true if something was cancelled. */
export function cancelSelection(inv: Inventory): boolean {
  const had = inv.selected !== null || inv.shovel;
  inv.selected = null;
  inv.shovel = false;
  return had;
}

export function toggleShovel(inv: Inventory): boolean {
  inv.shovel = !inv.shovel;
  if (inv.shovel) inv.selected = null;
  return inv.shovel;
}

export function heldItem(inv: Inventory): string | null {
  return inv.selected === null ? null : inv.slots[inv.selected] ?? null;
}

/** Shovel refund is a config percentage of the seed price (D-27: 0 → no refund). */
export function shovelRefund(seedPrice: number, refundPercent: number): number {
  return Math.floor((seedPrice * Math.max(0, refundPercent)) / 100);
}
