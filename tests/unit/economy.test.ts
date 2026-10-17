import { describe, expect, it } from 'vitest';
import { addSun, createTicker, createWallet, displaySun, killReward, passiveRate, spendSun, tickInterval } from '../../src/logic/economy';
import { config } from './helpers';

const cfg = config();
const STEP = cfg.game.loop.fixedDt;

function simulate(seconds: number, perSecond: number, interval: number, alive: (t: number) => boolean): number {
  const wallet = createWallet(0, cfg.game.economy.sunCap);
  const ticker = createTicker();
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) addSun(wallet, tickInterval(ticker, STEP, interval, perSecond, alive(i * STEP)));
  return wallet.sun;
}

describe('sun economy (FR-SUN)', () => {
  it('sunflower character standing still for 20 s earns +300 (TC-SUN-01)', () => {
    const rate = cfg.characters.sunflower.passiveSunPerSecond;
    expect(simulate(20, rate, cfg.game.economy.passiveTickInterval, () => true)).toBeCloseTo(300, 6);
  });

  it('stops passive income while the player is dead (FR-SUN-11)', () => {
    const rate = cfg.characters.sunflower.passiveSunPerSecond;
    // Dead between 5 s and 10 s → only 15 s of income.
    const sun = simulate(20, rate, cfg.game.economy.passiveTickInterval, (t) => t < 5 || t >= 10);
    expect(sun).toBeCloseTo(225, 6);
  });

  it('a sunflower plant produces 4/s settled every 0.5 s (FR-SUN-04)', () => {
    const p = cfg.plants.plants.sunflower_plant;
    const ticker = createTicker();
    expect(tickInterval(ticker, 0.4, p.sunTickInterval!, p.sunPerSecond!, true)).toBe(0);
    expect(tickInterval(ticker, 0.1, p.sunTickInterval!, p.sunPerSecond!, true)).toBeCloseTo(2, 6);
  });

  it('caps sun at 999 and reports overflow (FR-SUN-05)', () => {
    const wallet = createWallet(990, cfg.game.economy.sunCap);
    const res = addSun(wallet, 25);
    expect(wallet.sun).toBe(999);
    expect(res).toEqual({ applied: 9, capped: true });
  });

  it('rejects spending more than owned and applies kill/headshot rewards', () => {
    const wallet = createWallet(30, 999);
    expect(spendSun(wallet, 40)).toBe(false);
    expect(wallet.sun).toBe(30);
    const basic = cfg.zombies.basic_zombie!.sunDrop;
    expect(killReward(basic, cfg.game.economy.headshotBonus, true)).toBe(15);
    expect(killReward(basic, cfg.game.economy.headshotBonus, false)).toBe(10);
    expect(passiveRate(15, 0.2)).toBeCloseTo(18, 6);
    expect(displaySun(createWallet(12.6, 999))).toBe(12);
  });

  it('pays each zombie type its own sunDrop: a buckethead kill earns 25 (Revision 2)', () => {
    const bonus = cfg.game.economy.headshotBonus;
    expect(killReward(cfg.zombies.buckethead_zombie!.sunDrop, bonus, false)).toBe(25);
    // Gun headshot bonus stacks on top of the type reward.
    expect(killReward(cfg.zombies.buckethead_zombie!.sunDrop, bonus, true)).toBe(30);
    // Plant kills (never headshots) still pay the type reward.
    expect(killReward(cfg.zombies.football_zombie!.sunDrop, bonus, false)).toBe(35);
    // A negative (mis-tuned) drop never takes sun away.
    expect(killReward(-5, bonus, false)).toBe(0);
  });
});
