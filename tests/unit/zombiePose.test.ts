// Step 25: procedural zombie pose logic (FR5.1; FR-AI-08 windup 0.3 s; FR-AI-10 death pose).
import { describe, expect, it } from 'vitest';
import { validateConfig } from '../../src/config/validate';
import { DEG } from '../../src/logic/math';
import {
  POSE_KEYS,
  ZombiePoseAnimator,
  deathDuration,
  defaultInput,
  headCenterHeight,
  hitEnvelope,
  type Pose,
  type PoseInput,
  type PoseState,
  type PoseTraits,
  vaultLift,
} from '../../src/logic/zombiePose';
import { config, rawConfig } from './helpers';

type AnyObj = Record<string, any>;

const cfg = config();
const vis = cfg.game.zombieVisual;
const anim = vis.animation;
const def = cfg.zombies.basic_zombie;
const timing = { attackWindup: def.attackWindup, attackRecover: def.attackRecover, hitReactDuration: def.hitReactDuration };
const TRAITS: PoseTraits = { seed: 7, limpSide: 0, headTilt: 0, gaitOffset: 0 };
const DT = 1 / 120;

function make(state: PoseState, traits: PoseTraits = TRAITS): ZombiePoseAnimator {
  return new ZombiePoseAnimator(anim, vis.proportions, timing, traits, state);
}

/** Run `seconds` of fixed frames; `each` sees the elapsed time after every frame. */
function run(a: ZombiePoseAnimator, input: PoseInput, seconds: number, each?: (t: number, p: Pose) => void): Pose {
  const steps = Math.round(seconds / DT);
  for (let i = 1; i <= steps; i++) {
    const p = a.update(input, DT);
    each?.(i * DT, p);
  }
  return a.pose;
}

const snapshot = (p: Pose): Pose => ({ ...p });

describe('zombiePose: ATTACK windup aligned with attackWindup (FR-AI-08)', () => {
  it('reaches the maximum backward lean at 0.3 s, then lunges forward', () => {
    const a = make('ATTACK');
    let minPitch = Infinity;
    let minAt = -1;
    const samples: { t: number; pitch: number; fwd: number }[] = [];
    run(a, defaultInput('ATTACK'), 0.6, (t, p) => {
      samples.push({ t, pitch: p.spinePitch, fwd: p.rootFwd });
      if (p.spinePitch < minPitch) { minPitch = p.spinePitch; minAt = t; }
    });
    expect(def.attackWindup).toBe(0.3);
    expect(Math.abs(minAt - def.attackWindup)).toBeLessThanOrEqual(DT * 1.5);
    expect(minPitch).toBeCloseTo(anim.attack.windupLeanDeg * DEG, 2);
    expect(minPitch).toBeLessThan(0); // leaning back
    const lunge = samples.find((s) => s.t >= def.attackWindup + anim.attack.lungeTime)!;
    expect(lunge.pitch).toBeGreaterThan(0); // leaning forward into the strike
    expect(lunge.fwd).toBeGreaterThan(0.1);
    // Lean decreases monotonically through the windup (no early peak).
    const windup = samples.filter((s) => s.t > 0.05 && s.t < def.attackWindup - DT);
    for (let i = 1; i < windup.length; i++) expect(windup[i]!.pitch).toBeLessThanOrEqual(windup[i - 1]!.pitch + 1e-9);
  });

  it('follows the gameplay attack clock when one is supplied', () => {
    const a = make('ATTACK');
    const input = defaultInput('ATTACK');
    input.attackClock = def.attackWindup;
    run(a, input, 0.25);
    expect(a.pose.spinePitch).toBeCloseTo(anim.attack.windupLeanDeg * DEG, 5);
    input.attackClock = def.attackWindup + anim.attack.lungeTime;
    a.update(input, DT);
    expect(a.pose.spinePitch).toBeCloseTo(anim.attack.lungeLeanDeg * DEG, 5);
    input.attackClock = 99; // long after recovery: back to the ready stance
    a.update(input, DT);
    expect(a.pose.spinePitch).toBeCloseTo(anim.attack.readyLeanDeg * DEG, 5);
  });
});

describe('zombiePose: state cross-fade', () => {
  it('blend weight rises smoothly from 0 to 1 within blendTime (0.15–0.25 s)', () => {
    expect(anim.blendTime).toBeGreaterThanOrEqual(0.15);
    expect(anim.blendTime).toBeLessThanOrEqual(0.25);
    const a = make('IDLE');
    run(a, defaultInput('IDLE'), 0.5);
    const idleArm = a.pose.shoulderLPitch;
    const chase = defaultInput('CHASE');
    const weights: number[] = [];
    let firstArm = 0;
    run(a, chase, 0.4, (_t, p) => {
      weights.push(a.blendWeight);
      if (weights.length === 1) firstArm = p.shoulderLPitch;
    });
    expect(weights[0]).toBeGreaterThan(0);
    expect(weights[0]).toBeLessThan(0.02);
    for (let i = 1; i < weights.length; i++) expect(weights[i]!).toBeGreaterThanOrEqual(weights[i - 1]!);
    const atHalf = weights[Math.round(anim.blendTime / 2 / DT) - 1]!;
    expect(atHalf).toBeGreaterThan(0.3);
    expect(atHalf).toBeLessThan(0.7);
    expect(weights[Math.round(anim.blendTime / DT) - 3]!).toBeLessThan(1);
    expect(weights[Math.round(anim.blendTime / DT) + 1]).toBe(1);
    // No snap: the first frame is still close to the idle arm, the end is the reaching chase arm.
    expect(Math.abs(firstArm - idleArm)).toBeLessThan(2 * DEG);
    expect(a.pose.shoulderLPitch).toBeGreaterThan(anim.chase.armReachDeg * DEG * 0.8);
  });

  it('HIT_REACT does not restart the cross-fade (the flinch is an additive layer)', () => {
    const a = make('CHASE');
    run(a, defaultInput('CHASE'), 0.5);
    const hit = defaultInput('HIT_REACT');
    hit.hitCount = 1;
    a.update(hit, DT);
    expect(a.blendWeight).toBe(1);
    expect(a.baseState).toBe('CHASE');
  });
});

describe('zombiePose: DEAD (FR-AI-10)', () => {
  it('ends lying on the ground and the pose never changes afterwards', () => {
    const a = make('CHASE');
    const chase = defaultInput('CHASE');
    chase.moveSpeed = def.chaseSpeed;
    run(a, chase, 0.7);
    const dead = defaultInput('DEAD');
    run(a, dead, deathDuration(anim) + 0.05);
    const settled = snapshot(a.pose);
    expect(Math.abs(settled.rootPitch)).toBeCloseTo(Math.PI / 2 - 0.06, 3);
    expect(Math.sign(settled.rootPitch)).toBe(a.fallsForward ? 1 : -1);
    expect(settled.liftY).toBeCloseTo(anim.death.groundLift, 6);
    dead.hitCount = 5; // shots into the corpse
    dead.rooted = true;
    run(a, dead, 1.0);
    for (const k of POSE_KEYS) expect(a.pose[k]).toBe(settled[k]);
    expect(deathDuration(anim)).toBeLessThan(def.deathRemoveDelay);
  });

  it('falls forward for some seeds and backward for others (seeded, deterministic)', () => {
    const dirs = Array.from({ length: 40 }, (_, i) => make('IDLE', { ...TRAITS, seed: i + 1 }).fallsForward);
    expect(dirs).toContain(true);
    expect(dirs).toContain(false);
    expect(make('IDLE', { ...TRAITS, seed: 3 }).fallsForward).toBe(make('IDLE', { ...TRAITS, seed: 3 }).fallsForward);
  });
});

describe('zombiePose: slowed motion', () => {
  it('stride cadence is proportional to speed, so a 50 % slow halves it', () => {
    const normal = make('CHASE');
    const slowed = make('CHASE');
    const a = defaultInput('CHASE');
    a.moveSpeed = def.chaseSpeed;
    const b = defaultInput('CHASE');
    b.moveSpeed = def.chaseSpeed * 0.5;
    b.slowFactor = 0.5;
    run(normal, a, 1);
    run(slowed, b, 1);
    const p0 = normal.stridePhase;
    const s0 = slowed.stridePhase;
    run(normal, a, 1);
    run(slowed, b, 1);
    const normalRate = normal.stridePhase - p0;
    const slowRate = slowed.stridePhase - s0;
    expect(normalRate).toBeCloseTo((def.chaseSpeed / anim.strideLength) * Math.PI * 2, 2);
    expect(slowRate / normalRate).toBeCloseTo(0.5, 3);
  });

  it('idle cycles run at slowFactor speed (2 s slowed = 1 s normal)', () => {
    const normal = make('IDLE');
    const slowed = make('IDLE');
    const b = defaultInput('IDLE');
    b.slowFactor = 0.5;
    run(normal, defaultInput('IDLE'), 1);
    run(slowed, b, 2);
    for (const k of POSE_KEYS) expect(slowed.pose[k]).toBeCloseTo(normal.pose[k], 6);
  });
});

describe('zombiePose: reactions and edge cases', () => {
  it('hit reaction leans back and fully recovers within hitReactDuration (0.15 s)', () => {
    const hitA = make('CHASE');
    const ref = make('CHASE');
    const input = defaultInput('CHASE');
    run(hitA, input, 0.5);
    run(ref, input, 0.5);
    const hit = { ...input, state: 'HIT_REACT' as const, hitCount: 1, hitSide: 1, hitHead: true };
    for (let i = 0; i < 5; i++) { hitA.update(hit, DT); ref.update(input, DT); }
    expect(hitA.pose.spinePitch).toBeLessThan(ref.pose.spinePitch - 5 * DEG);
    expect(hitA.pose.spineYaw).toBeLessThan(ref.pose.spineYaw); // twisted away from a right-side hit
    for (let i = 0; i < 15; i++) { hitA.update(hit, DT); ref.update(input, DT); }
    for (const k of POSE_KEYS) expect(hitA.pose[k]).toBeCloseTo(ref.pose[k], 9);
    expect(hitEnvelope(def.hitReactDuration, def.hitReactDuration, anim.hitReact.peakTime)).toBe(0);
    expect(hitEnvelope(Number.NaN, def.hitReactDuration, anim.hitReact.peakTime)).toBe(0);
    expect(hitEnvelope(anim.hitReact.peakTime, def.hitReactDuration, anim.hitReact.peakTime)).toBe(1);
  });

  it('ALERT turns the head toward the target before the body follows', () => {
    const a = make('IDLE');
    const alert = defaultInput('ALERT');
    alert.lookYaw = 1;
    run(a, alert, 0.12);
    expect(a.pose.headYaw).toBeGreaterThan(0.3);
    expect(Math.abs(a.pose.spineYaw)).toBeLessThan(0.05);
    run(a, alert, 0.8);
    expect(a.pose.spineYaw).toBeGreaterThan(0.25);
    expect(a.pose.jawOpen).toBeGreaterThan(anim.alert.jawOpenDeg * DEG * 0.6); // groan
  });

  it('rooted zombies struggle; zero, negative or NaN dt leaves the pose unchanged', () => {
    const a = make('IDLE');
    const rooted = defaultInput('IDLE');
    rooted.rooted = true;
    let maxTwist = 0;
    run(a, rooted, 1.5, (_t, p) => { maxTwist = Math.max(maxTwist, Math.abs(p.spineYaw)); });
    expect(maxTwist).toBeGreaterThan(anim.rooted.twistDeg * DEG * 0.5);
    const before = snapshot(a.pose);
    a.update(rooted, 0);
    a.update(rooted, -1);
    a.update(rooted, Number.NaN);
    for (const k of POSE_KEYS) expect(a.pose[k]).toBeCloseTo(before[k], 12);
  });

  it('rig proportions keep the head inside headHeightRange for every height variation (TR-HIT-01)', () => {
    const h = headCenterHeight(vis.proportions);
    expect(h * vis.variation.heightScale[0]).toBeGreaterThanOrEqual(def.headHeightRange[0]);
    expect(h * vis.variation.heightScale[1]).toBeLessThanOrEqual(def.headHeightRange[1]);
    expect(vis.variation.heightScale[0]).toBeGreaterThanOrEqual(0.95);
    expect(vis.variation.heightScale[1]).toBeLessThanOrEqual(1.05);
  });

  it('config validation rejects out-of-range blend time and height variation', () => {
    const raw = rawConfig();
    const zv = (raw.game as AnyObj).zombieVisual;
    zv.animation.blendTime = 0.5;
    zv.variation.heightScale = [0.8, 1.2];
    const errors = validateConfig(raw);
    expect(errors.some((e) => e.includes('blendTime'))).toBe(true);
    expect(errors.some((e) => e.includes('heightScale'))).toBe(true);
    const missing = rawConfig();
    delete (missing.game as AnyObj).zombieVisual;
    expect(validateConfig(missing)).toContain('game.zombieVisual: 缺失');
  });
});

// ---------------------------------------------------------------- Step 29: Revision 2 type poses

describe('zombiePose: VAULT (pole vaulter, Step 29)', () => {
  const v = anim.vault;
  const vaultDuration = cfg.zombies.pole_vaulter_zombie!.abilities!.poleVault!.duration;

  it('root height stays on the ground while planting, rises then falls during the flight, and lands back at 0', () => {
    const a = make('CHASE');
    const chase = { ...defaultInput('CHASE'), moveSpeed: 3, style: 'pole' as const };
    run(a, chase, 0.5);
    const vault = { ...defaultInput('VAULT'), moveSpeed: 3 };
    const samples: { u: number; y: number; knee: number }[] = [];
    const steps = Math.round(vaultDuration / DT);
    for (let i = 1; i <= steps; i++) {
      vault.vaultProgress = Math.min(1, (i * DT) / vaultDuration);
      a.update(vault, DT);
      samples.push({ u: vault.vaultProgress, y: a.pose.liftY, knee: a.pose.kneeL });
    }
    for (const s of samples.filter((x) => x.u <= v.plantEnd)) expect(Math.abs(s.y)).toBeLessThan(1e-9);
    const peak = samples.reduce((best, s) => (s.y > best.y ? s : best));
    expect(peak.y).toBeGreaterThan(v.arcHeight * 0.99);
    expect(peak.y).toBeLessThanOrEqual(v.arcHeight + 1e-9);
    expect(Math.abs(peak.u - (v.plantEnd + v.flightEnd) / 2)).toBeLessThan(0.02);
    expect(peak.knee).toBeGreaterThan(v.tuckKneeDeg * DEG * 0.9); // legs tucked over the plant
    const flight = samples.filter((s) => s.u > v.plantEnd && s.u < v.flightEnd);
    for (const s of flight) {
      const prev = samples[samples.indexOf(s) - 1]!;
      if (s.u <= peak.u) expect(s.y).toBeGreaterThanOrEqual(prev.y - 1e-9); // rising
      else expect(s.y).toBeLessThanOrEqual(prev.y + 1e-9); // falling
    }
    for (const s of samples.filter((x) => x.u >= v.flightEnd)) expect(s.y).toBe(0);
    // Landed: back to CHASE without the pole, still on the ground after the cross-fade.
    run(a, { ...defaultInput('CHASE'), moveSpeed: 1.4 }, 0.4);
    expect(a.pose.liftY).toBe(0);
    expect(a.baseState).toBe('CHASE');
  });

  it('vaultLift is 0 outside the flight window and for invalid progress', () => {
    expect(vaultLift(v, 0)).toBe(0);
    expect(vaultLift(v, v.plantEnd)).toBe(0);
    expect(vaultLift(v, v.flightEnd)).toBe(0);
    expect(vaultLift(v, 1.5)).toBe(0);
    expect(vaultLift(v, -0.3)).toBe(0);
    expect(vaultLift(v, Number.NaN)).toBe(0);
    expect(vaultLift(v, (v.plantEnd + v.flightEnd) / 2)).toBeCloseTo(v.arcHeight, 9);
  });
});

describe('zombiePose: RAGE (newspaper zombie, Step 29)', () => {
  const r = anim.rage;
  const rageDuration = cfg.zombies.newspaper_zombie!.abilities!.newspaperRage!.rageDuration;
  const runSpeed = cfg.zombies.newspaper_zombie!.abilities!.newspaperRage!.chaseSpeedAfter;

  it('stomps and roars in place, then the raged run uses the run cadence and pumping arms', () => {
    const a = make('WANDER');
    const reading = { ...defaultInput('WANDER'), moveSpeed: 0.6, style: 'newspaper' as const };
    run(a, reading, 1);
    const readPhase0 = a.stridePhase;
    run(a, reading, rageDuration);
    const readingAdvance = a.stridePhase - readPhase0;

    const rage = defaultInput('RAGE');
    const ragePhase0 = a.stridePhase;
    let maxHip = 0;
    let maxJaw = 0;
    run(a, rage, rageDuration, (_t, p) => {
      maxHip = Math.max(maxHip, p.hipLPitch, p.hipRPitch);
      maxJaw = Math.max(maxJaw, p.jawOpen);
    });
    expect(a.stridePhase - ragePhase0).toBeLessThan(readingAdvance * 0.25); // standing, not walking
    expect(maxHip).toBeGreaterThan(r.stompHipDeg * DEG * 0.8); // stomping
    expect(maxJaw).toBeGreaterThan(r.roarJawDeg * DEG * 0.7); // roaring

    const sprint = { ...defaultInput('CHASE'), moveSpeed: runSpeed, style: 'raged' as const };
    run(a, sprint, 1);
    expect(a.poseStyle).toBe('raged');
    const p0 = a.stridePhase;
    let hipMax = -Infinity;
    let armMin = Infinity;
    let armMax = -Infinity;
    run(a, sprint, 1, (_t, p) => {
      hipMax = Math.max(hipMax, p.hipLPitch);
      armMin = Math.min(armMin, p.shoulderLPitch);
      armMax = Math.max(armMax, p.shoulderLPitch);
    });
    // Run cadence: stride phase advances at speed / strideLength cycles per second (≈ 5× the reading walk).
    expect(a.stridePhase - p0).toBeCloseTo((runSpeed / anim.strideLength) * Math.PI * 2, 2);
    expect(hipMax).toBeCloseTo((anim.idle.kneeBendDeg * 0.5 + anim.chase.hipSwingDeg) * r.runHipScale * DEG, 2);
    expect(armMax - armMin).toBeGreaterThan(2 * r.runArmPumpDeg * DEG * 0.95); // fists pump with the stride
    expect(armMax).toBeLessThan(anim.chase.armReachDeg * DEG * 0.8); // no zombie arm-reach while sprinting
  });

  it('a style change alone cross-fades without resetting the state, and DEAD ignores later style changes', () => {
    const a = make('CHASE');
    run(a, { ...defaultInput('CHASE'), moveSpeed: 1, style: 'screendoor' }, 0.5);
    expect(a.blendWeight).toBe(1);
    a.update({ ...defaultInput('CHASE'), moveSpeed: 1, style: 'normal' }, DT);
    expect(a.baseState).toBe('CHASE');
    expect(a.blendWeight).toBeLessThan(0.05);
    const dead = defaultInput('DEAD');
    run(a, dead, deathDuration(anim) + 0.05);
    const settled = snapshot(a.pose);
    run(a, { ...dead, style: 'raged' }, 0.5);
    for (const k of POSE_KEYS) expect(a.pose[k]).toBe(settled[k]);
  });

  it('hits on armour rattle the head harder than flesh hits (armorHitHeadScale)', () => {
    const flesh = make('WANDER');
    const metal = make('WANDER');
    const input = defaultInput('WANDER');
    run(flesh, input, 0.5);
    run(metal, input, 0.5);
    const hit = { ...input, state: 'HIT_REACT' as const, hitCount: 1, hitHead: true };
    for (let i = 0; i < 5; i++) {
      flesh.update({ ...hit, armorHit: false }, DT);
      metal.update({ ...hit, armorHit: true }, DT);
    }
    expect(anim.armorHitHeadScale).toBeGreaterThan(1);
    expect(metal.pose.headPitch).toBeLessThan(flesh.pose.headPitch - 5 * DEG);
  });
});
