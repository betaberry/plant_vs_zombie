// Single tick manager for every facility (TR-PLT-04): no per-plant setInterval / timers.

export type Tickable = (dt: number) => void;

export class TickManager {
  private items = new Map<string, Tickable>();
  private pendingRemoval = new Set<string>();
  private iterating = false;

  add(id: string, fn: Tickable): void {
    this.items.set(id, fn);
    this.pendingRemoval.delete(id);
  }

  remove(id: string): void {
    if (this.iterating) this.pendingRemoval.add(id);
    else this.items.delete(id);
  }

  get size(): number {
    return this.items.size;
  }

  update(dt: number): void {
    this.iterating = true;
    for (const [id, fn] of this.items) {
      if (this.pendingRemoval.has(id)) continue;
      try {
        fn(dt);
      } catch (err) {
        console.error(`[tick] "${id}" failed and was removed:`, err);
        this.pendingRemoval.add(id);
      }
    }
    this.iterating = false;
    for (const id of this.pendingRemoval) this.items.delete(id);
    this.pendingRemoval.clear();
  }

  clear(): void {
    this.items.clear();
    this.pendingRemoval.clear();
  }
}
