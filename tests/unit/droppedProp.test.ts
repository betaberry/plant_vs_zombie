// Step 28/29: dropped armour props tumble, land once, rest for restSeconds, then fade out.
import { describe, expect, it } from 'vitest';
import { launchDroppedProp, stepDroppedProp } from '../../src/logic/droppedProp';
import { config } from './helpers';

const cfg = config().game.zombieVisual.droppedProps;
const DT = 1 / 60;

/** Deterministic 0..1 sequence instead of Math.random. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe('dropped armour props', () => {
  it('falls to the ground, signals the landing once, rests for restSeconds and then fades to nothing', () => {
    const s = launchDroppedProp({ x: 0, y: 1.8, z: 0 }, 0, 0, cfg, seq([0.5, 0.3, 0.7, 0.2, 0.9, 0.4]));
    expect(s.vel.y).toBeGreaterThan(0); // knocked upward first
    let landings = 0;
    let t = 0;
    let restStartedAt = -1;
    let doneAt = -1;
    while (t < 10 && doneAt < 0) {
      const step = stepDroppedProp(s, cfg, DT);
      t += DT;
      if (step.landedNow) landings++;
      expect(s.pos.y).toBeGreaterThanOrEqual(s.groundY - 1e-9);
      if (restStartedAt < 0 && s.restT >= 0) restStartedAt = t;
      if (restStartedAt >= 0 && t - restStartedAt < cfg.restSeconds - DT) expect(step.scale).toBe(1);
      if (step.done) doneAt = t;
    }
    expect(landings).toBe(1);
    expect(restStartedAt).toBeGreaterThan(0);
    expect(doneAt - restStartedAt).toBeCloseTo(cfg.restSeconds + cfg.fadeSeconds, 1);
  });

  it('flies away from the zombie facing, and zero / NaN dt leaves it unchanged', () => {
    // yaw 0 faces −Z, so the prop is knocked toward +Z (behind the zombie).
    const s = launchDroppedProp({ x: 0, y: 1, z: 0 }, 0, 0, cfg, seq([0.5]));
    expect(s.vel.z).toBeGreaterThan(0);
    expect(Math.abs(s.vel.x)).toBeLessThan(1e-9);
    const before = JSON.stringify(s);
    stepDroppedProp(s, cfg, 0);
    stepDroppedProp(s, cfg, Number.NaN);
    stepDroppedProp(s, cfg, -1);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('never starts below the ground even when the accessory was under it', () => {
    const s = launchDroppedProp({ x: 0, y: -0.5, z: 0 }, 0.2, 1, cfg, seq([0.1, 0.9]));
    expect(s.pos.y).toBe(0.2);
  });
});
