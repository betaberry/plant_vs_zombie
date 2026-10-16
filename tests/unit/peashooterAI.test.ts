import { describe, expect, it } from 'vitest';
import { createShooterState, stepShooter, type ShooterContext, type ShooterParams } from '../../src/logic/peashooterAI';
import { config } from './helpers';

const def = config().plants.plants.pea_shooter_plant;
const params = def as Required<typeof def> as ShooterParams;
const clear = () => true;

function ctx(x: number, z: number, los = clear): ShooterContext {
  return { pos: { x: 0, y: 0, z: 0 }, targets: [{ id: 'z1', pos: { x, y: 0, z }, alive: true }], hasLineOfSight: los };
}

describe('pea shooter AI (7.8.4)', () => {
  it('turns without firing while the angle is above 8°, then fires once aligned', () => {
    // Target straight behind (+Z) while facing -Z (yaw 0): 180° away.
    const s = createShooterState(0);
    const c = ctx(0, 10);
    expect(stepShooter(s, c, params, 0.1)).toBeNull();
    expect(s.mode).toBe('TURNING');
    let fired: string | null = null;
    let t = 0.1;
    while (!fired && t < 2) {
      fired = stepShooter(s, c, params, 0.1);
      t += 0.1;
    }
    expect(fired).toBe('z1');
    // 180° at 180°/s needs ~1 s minus the 8° tolerance.
    expect(t).toBeGreaterThanOrEqual(0.9);
  });

  it('drops a target beyond 18 m and does not acquire beyond 15 m', () => {
    const s = createShooterState(0);
    const near = ctx(0, -10);
    expect(stepShooter(s, near, params, 0.1)).toBe('z1');
    near.targets[0]!.pos = { x: 0, y: 0, z: -19 };
    stepShooter(s, near, params, 0.1);
    expect(s.targetId).toBeNull();
    const s2 = createShooterState(0);
    expect(stepShooter(s2, ctx(0, -16), params, 0.1)).toBeNull();
    expect(s2.targetId).toBeNull();
  });

  it('never fires through walls and respects the 1.5 s attack interval (TR-PLT-01)', () => {
    const blocked = createShooterState(0);
    expect(stepShooter(blocked, ctx(0, -10, () => false), params, 0.1)).toBeNull();
    const s = createShooterState(0);
    const c = ctx(0, -10);
    expect(stepShooter(s, c, params, 0.1)).toBe('z1');
    expect(stepShooter(s, c, params, 1.0)).toBeNull();
    expect(stepShooter(s, c, params, 0.6)).toBe('z1');
  });
});
