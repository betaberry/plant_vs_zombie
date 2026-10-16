// Sun economy (FR-SUN-01..11). Pure.

export interface SunWallet {
  sun: number;
  cap: number;
  totalEarned: number;
}

const EPS = 1e-6;

export function createWallet(start: number, cap: number): SunWallet {
  return { sun: Math.min(start, cap), cap, totalEarned: 0 };
}

/** Adds sun up to the cap. `capped` is true when anything was discarded (HUD shows 「阳光已满」). */
export function addSun(w: SunWallet, amount: number): { applied: number; capped: boolean } {
  if (!(amount > 0)) return { applied: 0, capped: false };
  const applied = Math.min(amount, w.cap - w.sun);
  w.sun += applied;
  w.totalEarned += applied;
  return { applied, capped: applied < amount };
}

export function spendSun(w: SunWallet, amount: number): boolean {
  if (amount < 0 || w.sun + EPS < amount) return false;
  w.sun = Math.max(0, w.sun - amount);
  return true;
}

/** Display value (fractions from +20% boosts are kept internally). */
export function displaySun(w: SunWallet): number {
  return Math.floor(w.sun + EPS);
}

export interface IntervalTicker {
  acc: number;
}

export function createTicker(): IntervalTicker {
  return { acc: 0 };
}

/**
 * Settles a per-second rate in discrete intervals (FR-SUN-03: every 0.2 s; FR-SUN-04: every 0.5 s).
 * When inactive (player dead, FR-SUN-11) nothing accumulates. Returns the amount produced.
 */
export function tickInterval(t: IntervalTicker, dt: number, interval: number, perSecond: number, active: boolean): number {
  if (!active || !(perSecond > 0) || !(interval > 0)) return 0;
  t.acc += dt;
  let produced = 0;
  while (t.acc >= interval - EPS) {
    t.acc -= interval;
    produced += perSecond * interval;
  }
  return produced;
}

export function killReward(killReward: number, headshotBonus: number, headshot: boolean): number {
  return killReward + (headshot ? headshotBonus : 0);
}

/** Passive rate including the permanent 「阳光增效」 bonus. */
export function passiveRate(base: number, sunBonus: number): number {
  return base * (1 + sunBonus);
}
