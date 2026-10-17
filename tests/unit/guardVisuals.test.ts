// Guard mode Step 14: gargantuar / imp look and poses (FR8.2, FR8.6) — pure parts only (rig look + animator).
import { describe, expect, it } from 'vitest';
import { defaultInput, ZombiePoseAnimator, type PoseTraits } from '../../src/logic/zombiePose';
import { DEG } from '../../src/logic/math';
import { rollZombieLook } from '../../src/render/zombieRig';
import { generateRingLayout } from '../../src/world/ringLayout';
import { config } from './helpers';

const cfg = config();
const vis = cfg.game.zombieVisual;
const TRAITS: PoseTraits = { seed: 3, limpSide: 0, headTilt: 0, gaitOffset: 0 };
const DT = 1 / 120;

describe('guard mode zombie visuals', () => {
  it('scales the rig by bodyScale (gargantuar ≈ ×2, imp ≈ ×0.6) and gives the gargantuar its pole and imp', () => {
    const basic = rollZombieLook(42, vis, cfg.zombies.basic_zombie!.visual);
    const garg = rollZombieLook(42, vis, cfg.zombies.gargantuar_zombie!.visual);
    const imp = rollZombieLook(42, vis, cfg.zombies.imp_zombie!.visual);
    expect(garg.height / basic.height).toBeCloseTo(2, 5);
    expect(imp.height / basic.height).toBeCloseTo(0.6, 5);
    expect(garg.accessories).toEqual(['telephonePole', 'impRider']);
  });

  it('gargantuar smash: arms overhead at the end of the 1 s wind-up, slammed down right after', () => {
    const def = cfg.zombies.gargantuar_zombie!;
    const timing = { attackWindup: def.attackWindup, attackRecover: def.attackRecover, hitReactDuration: def.hitReactDuration };
    const a = new ZombiePoseAnimator(vis.animation, vis.proportions, timing, TRAITS, 'ATTACK');
    const input = { ...defaultInput('ATTACK'), style: 'heavy' as const };
    let raised = 0;
    for (let t = 0; t < def.attackWindup - 1e-9; t += DT) {
      input.attackClock = t;
      raised = a.update(input, DT).shoulderRPitch;
    }
    const g = vis.animation.gargantuar;
    expect(raised / DEG).toBeGreaterThan(g.smashRaiseDeg - 15);
    let slammed = 0;
    for (let t = def.attackWindup; t < def.attackWindup + vis.animation.attack.lungeTime + 0.05; t += DT) {
      input.attackClock = t;
      slammed = a.update(input, DT).shoulderRPitch;
    }
    expect(slammed).toBeLessThan(raised);
    expect(slammed / DEG).toBeLessThan(g.smashRaiseDeg - 60);
  });

  it('imp style leans further forward than a plain chase', () => {
    const timing = { attackWindup: 0.2, attackRecover: 0.4, hitReactDuration: 0.15 };
    const plain = new ZombiePoseAnimator(vis.animation, vis.proportions, timing, TRAITS, 'CHASE');
    const imp = new ZombiePoseAnimator(vis.animation, vis.proportions, timing, TRAITS, 'CHASE');
    const base = { ...defaultInput('CHASE'), moveSpeed: 2 };
    let p0 = 0;
    let p1 = 0;
    for (let i = 0; i < 60; i++) {
      p0 = plain.update(base, DT).spinePitch;
      p1 = imp.update({ ...base, style: 'imp' }, DT).spinePitch;
    }
    expect(p1).toBeGreaterThan(p0);
  });

  it('ring map places the three landmarks as boxes on the wall bands (orientation, FR2.5)', () => {
    const ring = generateRingLayout(cfg.maps.ring_01);
    expect(ring.landmarks.map((l) => l.kind).sort()).toEqual(['container_yard', 'tower', 'water_tower']);
    const above = ring.boxes.filter((b) => b.center.y - b.size.y / 2 >= cfg.maps.ring_01.wallHeight - 1e-6);
    expect(above.length).toBeGreaterThanOrEqual(3 + 6 + 5);
  });
});
