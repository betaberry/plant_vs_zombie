// Seedable PRNG (TR-LOOP-04): mulberry32.

export interface Rng {
  next(): number;
  range(min: number, max: number): number;
  int(minInclusive: number, maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  readonly seed: number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed,
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min)),
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('rng.pick on empty list');
      return items[Math.floor(next() * items.length)] as T;
    },
  };
}
