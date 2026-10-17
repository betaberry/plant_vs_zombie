// Gargantuar abilities (FR8.3 / FR8.4): smash wind-up, area, one-hit plants, half-health imp throw.
import { describe, expect, it } from 'vitest';
import {
  createBossState,
  impLandingPoint,
  shouldThrowImp,
  startSmash,
  stepSmash,
  type SmashTarget,
} from '../../src/logic/bossAbilities';
import { config } from './helpers';

const cfg = config();
const boss = cfg.zombies.gargantuar_zombie!;
const smash = boss.abilities!.smash!;
const throwImp = boss.abilities!.throwImp!;
const hard = cfg.challenge.difficulties.hard;
const mult = { core: hard.coreDamageMultiplier, player: hard.playerDamageMultiplier };
const at = (x: number, z = 0) => ({ x, y: 0, z });

const targets = (): SmashTarget[] => [
  { id: 'wall', kind: 'plant', pos: at(1), health: 4000, extent: 0 },
  { id: 'pea', kind: 'plant', pos: at(smash.radius + 0.5), health: 300, extent: 0 },
  { id: 'core', kind: 'core', pos: at(-8), health: 7000, extent: 6 },
  { id: 'p1', kind: 'player', pos: at(0, 2), health: 100, extent: 0 },
];

describe('smash (FR8.3)', () => {
  it('destroys a nut wall in one hit and damages the core and player with difficulty multipliers', () => {
    const s = createBossState();
    expect(startSmash(s, at(0))).toBe(true);
    const hits = stepSmash(s, smash, smash.windup, targets(), mult);
    const byId = Object.fromEntries(hits.map((h) => [h.id, h]));
    expect(byId.wall).toEqual({ id: 'wall', kind: 'plant', damage: 4000, destroyed: true });
    expect(byId.core!.damage).toBeCloseTo(200 * 1.3, 10);
    expect(byId.p1!.damage).toBeCloseTo(40 * 1.3, 10);
  });

  it('does not hurt targets outside the radius', () => {
    const s = createBossState();
    startSmash(s, at(0));
    const hits = stepSmash(s, smash, smash.windup, targets(), mult);
    expect(hits.map((h) => h.id)).not.toContain('pea');
    // The core is 8 m away but its wall (extent 6) is inside the 3.5 m radius.
    expect(hits.map((h) => h.id)).toContain('core');
  });

  it('deals no damage during the 1 s wind-up and hits only once per swing', () => {
    const s = createBossState();
    startSmash(s, at(0));
    expect(stepSmash(s, smash, 0.5, targets(), mult)).toEqual([]);
    expect(stepSmash(s, smash, 0.49, targets(), mult)).toEqual([]);
    expect(stepSmash(s, smash, 0.02, targets(), mult)).toHaveLength(3);
    expect(stepSmash(s, smash, 0.1, targets(), mult)).toEqual([]);
    // Cooling down: a new swing cannot start until the cooldown has passed.
    expect(startSmash(s, at(0))).toBe(false);
    stepSmash(s, smash, smash.cooldown, targets(), mult);
    expect(startSmash(s, at(0))).toBe(true);
  });
});

describe('imp throw (FR8.4)', () => {
  it('throws exactly once when health falls to half', () => {
    const s = createBossState();
    expect(shouldThrowImp(s, throwImp, 2001, 4000)).toBe(false);
    expect(shouldThrowImp(s, throwImp, 2000, 4000)).toBe(true);
    expect(shouldThrowImp(s, throwImp, 1500, 4000)).toBe(false);
    expect(shouldThrowImp(s, throwImp, 100, 4000)).toBe(false);
  });

  it('does not throw from a dead boss', () => {
    expect(shouldThrowImp(createBossState(), throwImp, 0, 4000)).toBe(false);
  });

  it('lands the imp toward the core, short of it, on walkable ground', () => {
    const bossPos = at(40);
    const core = at(0);
    expect(impLandingPoint(bossPos, core, throwImp, 8, () => true)).toEqual(at(40 - throwImp.throwDistance));
    // Close to the core: stops minCoreDistance short.
    expect(impLandingPoint(at(15), core, throwImp, 8, () => true).x).toBeCloseTo(8, 10);
    // Not walkable at full reach: steps back toward the boss.
    const landing = impLandingPoint(bossPos, core, throwImp, 8, (p) => p.x >= 31);
    expect(landing.x).toBeCloseTo(31, 10);
    expect(impLandingPoint(bossPos, core, throwImp, 8, () => false)).toEqual(bossPos);
  });
});
