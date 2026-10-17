// Procedural zombie body animation (plan Step 24; FR5.1, FR-AI-08 windup, FR-AI-10 death).
// Pure logic: no Three.js / Rapier / DOM. Produces per-joint angles for the render rig.
//
// Angle conventions (radians, in the zombie's local frame, facing −Z, right = +X):
//   *Pitch  > 0 : the far end of the segment moves forward (spine leans forward, arm/leg raises forward)
//   *Roll   > 0 : spine/head lean to the zombie's right; for shoulders/hips: limb moves outward (abduction)
//   *Yaw    > 0 : turn to the zombie's left (same sense as the entity yaw)
//   knee/elbow > 0 : flexion; ankle > 0 : toes point down; jawOpen > 0 : mouth opens
//   rootPitch  : whole body pivots about the feet (death fall), forward > 0
//   rootY      : pelvis offset along the body axis (crouch / bob), liftY : world-vertical lift
import type { ZombieAnimationConfig, ZombieProportions } from '../config/types';
import { createRng } from '../core/rng';
import { DEG } from './math';

export type PoseState = 'IDLE' | 'WANDER' | 'ALERT' | 'CHASE' | 'ATTACK' | 'AMBUSH' | 'BREAK' | 'HIT_REACT' | 'DEAD' | 'VAULT' | 'RAGE';

/**
 * Revision 2 body style layered on IDLE / WANDER / ALERT / CHASE, chosen by the render layer from the
 * zombie type and the props it still holds: reading a newspaper, raged run, holding a screen door,
 * football charge, carrying a vaulting pole. Changing style cross-fades like a state change.
 */
export type PoseStyle = 'normal' | 'newspaper' | 'raged' | 'screendoor' | 'charge' | 'pole';
const STYLED_STATES = new Set<PoseState>(['IDLE', 'WANDER', 'ALERT', 'CHASE']);

export const POSE_KEYS = [
  'rootY', 'rootFwd', 'rootPitch', 'rootRoll', 'rootYaw', 'liftY',
  'pelvisPitch', 'pelvisRoll', 'pelvisYaw',
  'spinePitch', 'spineRoll', 'spineYaw',
  'neckPitch', 'headPitch', 'headYaw', 'headRoll', 'jawOpen', 'tieSwing',
  'shoulderLPitch', 'shoulderLRoll', 'shoulderRPitch', 'shoulderRRoll', 'elbowL', 'elbowR',
  'hipLPitch', 'hipLRoll', 'hipRPitch', 'hipRRoll', 'kneeL', 'kneeR', 'ankleL', 'ankleR',
] as const;

export type PoseKey = (typeof POSE_KEYS)[number];
export type Pose = Record<PoseKey, number>;

export function restPose(): Pose {
  const p = {} as Pose;
  for (const k of POSE_KEYS) p[k] = 0;
  return p;
}

export function copyPose(src: Pose, out: Pose): Pose {
  for (const k of POSE_KEYS) out[k] = src[k];
  return out;
}

/** out = a + (b − a)·w for every joint. */
export function blendPose(a: Pose, b: Pose, w: number, out: Pose): Pose {
  for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * w;
  return out;
}

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);
/** Smoothstep 0→1 (zero slope at both ends) used for every cross-fade and phase ease. */
export function smooth01(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clampAbs = (x: number, max: number): number => Math.max(-max, Math.min(max, x));
const TAU = Math.PI * 2;

/** Height of the head centre above the feet at body scale 1 (keeps the rig consistent with TR-HIT-01). */
export function headCenterHeight(p: ZombieProportions): number {
  return p.ankleHeight + p.shinLength + p.thighLength + p.spineOffset + p.torsoLength + p.neckLength + p.headCenterOffset;
}

export function hipHeight(p: ZombieProportions): number {
  return p.ankleHeight + p.shinLength + p.thighLength;
}

/** Total duration of the death motion (buckle → fall → settle). */
export function deathDuration(cfg: ZombieAnimationConfig): number {
  return cfg.death.buckleTime + cfg.death.fallTime + cfg.death.settleTime;
}

export interface PoseInput {
  state: PoseState;
  /** Actual horizontal speed (m/s, already includes slow / root effects). Drives the stride cadence. */
  moveSpeed: number;
  /** 1 = normal, 0.5 = slowed by 50 %. Scales all non-locomotion cycles (idle, chew, pounding, struggle). */
  slowFactor: number;
  rooted: boolean;
  /** Yaw from the zombie's facing to its target (rad, + = left). Used for head tracking. */
  lookYaw: number;
  /** Seconds since the current attack windup started (gameplay clock); null → animator's own state clock. */
  attackClock: number | null;
  /** Increments on every non-lethal hit; a change starts the hit reaction. */
  hitCount: number;
  /** Sideways component of the last hit direction, −1..1 (+ = from the zombie's right). */
  hitSide: number;
  hitHead: boolean;
  /** 'simple' (> LOD mid distance): secondary motion (jaw, twitch, tie, head tracking) is dropped. */
  detail: 'full' | 'simple';
  /** Revision 2: type / prop body style (see PoseStyle). */
  style: PoseStyle;
  /** Revision 2: 0..1 progress through the pole vault (gameplay clock), read in VAULT. */
  vaultProgress: number;
  /** Revision 2: the last hit landed on armour (stronger head wobble). */
  armorHit: boolean;
}

export interface PoseTiming {
  attackWindup: number;
  attackRecover: number;
  hitReactDuration: number;
}

export interface PoseTraits {
  seed: number;
  /** −1 left leg drags, +1 right leg drags, 0 no limp. */
  limpSide: -1 | 0 | 1;
  /** Constant head roll (rad) — per-zombie variation. */
  headTilt: number;
  /** Stride phase offset so a crowd does not walk in lock-step. */
  gaitOffset: number;
}

export function defaultInput(state: PoseState): PoseInput {
  return {
    state, moveSpeed: 0, slowFactor: 1, rooted: false, lookYaw: 0, attackClock: null, hitCount: 0, hitSide: 0, hitHead: false, detail: 'full',
    style: 'normal', vaultProgress: 0, armorHit: false,
  };
}

/**
 * Root lift (m) of the pole vault at progress u (0..1): zero while running in and planting the pole,
 * a sine arc of height arcHeight during the flight, zero again from the landing on.
 */
export function vaultLift(v: ZombieAnimationConfig['vault'], u: number): number {
  if (!(u > v.plantEnd) || u >= v.flightEnd) return 0;
  return v.arcHeight * Math.sin((Math.PI * (u - v.plantEnd)) / (v.flightEnd - v.plantEnd));
}

interface Ctx {
  a: ZombieAnimationConfig;
  props: ZombieProportions;
  clock: number;
  t: number;
  rawT: number;
  stride: number;
  loco: number;
  input: PoseInput;
  limp: -1 | 0 | 1;
}

/**
 * Per-zombie animator. Feed it the gameplay state every rendered frame; it keeps its own clocks,
 * cross-fades 0.15–0.25 s between states and layers hit / rooted reactions on top.
 */
export class ZombiePoseAnimator {
  readonly pose: Pose = restPose();
  private readonly blended: Pose = restPose();
  private readonly from: Pose = restPose();
  private readonly target: Pose = restPose();
  private base: PoseState;
  private prevBase: PoseState;
  private stateTime = 0;
  private rawStateTime = 0;
  private clock = 0;
  private stride: number;
  private speed = 0;
  private blendT = 0;
  private blendDur: number;
  private hitT = Number.POSITIVE_INFINITY;
  private lastHitCount = 0;
  private hitSide = 0;
  private hitHead = false;
  private hitArmor = false;
  private style: PoseStyle = 'normal';
  private rootedW = 0;
  readonly fallsForward: boolean;

  constructor(
    private readonly cfg: ZombieAnimationConfig,
    private readonly props: ZombieProportions,
    private readonly timing: PoseTiming,
    private readonly traits: PoseTraits,
    initial: PoseState = 'IDLE',
  ) {
    this.base = initial === 'HIT_REACT' ? 'IDLE' : initial;
    this.prevBase = this.base;
    this.blendDur = cfg.blendTime;
    this.blendT = this.blendDur; // no fade on the very first pose
    this.stride = traits.gaitOffset;
    this.fallsForward = createRng(traits.seed).next() < cfg.death.forwardChance;
  }

  /** Cross-fade weight of the current state (0 = previous pose, 1 = fully in the new state). */
  get blendWeight(): number {
    return smooth01(this.blendDur > 0 ? this.blendT / this.blendDur : 1);
  }

  /** Accumulated stride phase (rad). Cadence = speed / strideLength cycles per second. */
  get stridePhase(): number {
    return this.stride;
  }

  get baseState(): PoseState {
    return this.base;
  }

  get poseStyle(): PoseStyle {
    return this.style;
  }

  update(input: PoseInput, dtIn: number): Pose {
    const dt = Number.isFinite(dtIn) && dtIn > 0 ? dtIn : 0;
    // HIT_REACT keeps the previous body motion; the flinch is an additive layer (recovers in 0.15 s).
    const state = input.state === 'HIT_REACT' ? this.base : input.state;
    const style = input.style ?? 'normal';
    if (state !== this.base || (style !== this.style && this.base !== 'DEAD')) this.enter(state, style);
    const slow = Math.min(1, Math.max(0.05, Number.isFinite(input.slowFactor) ? input.slowFactor : 1));
    this.stateTime += dt * slow;
    this.rawStateTime += dt;
    this.clock += dt * slow;
    const speed = Number.isFinite(input.moveSpeed) ? Math.max(0, input.moveSpeed) : 0;
    this.speed += (speed - this.speed) * Math.min(1, dt * this.cfg.speedSmoothing);
    this.stride += (dt * this.speed * TAU) / this.cfg.strideLength;
    this.trackHit(input, dt);
    const rootGoal = input.rooted && this.base !== 'DEAD' ? 1 : 0;
    this.rootedW += (rootGoal - this.rootedW) * Math.min(1, dt * this.cfg.rooted.fadeRate);
    if (rootGoal === 0 && this.rootedW < 1e-3) this.rootedW = 0;

    const ctx: Ctx = {
      a: this.cfg, props: this.props, clock: this.clock, t: this.stateTime, rawT: this.rawStateTime,
      stride: this.stride, loco: clamp01(this.speed / this.cfg.fullLocomotionSpeed), input, limp: this.traits.limpSide,
    };
    this.evaluateTarget(ctx);
    this.blendT += dt;
    blendPose(this.from, this.target, this.blendWeight, this.blended);
    copyPose(this.blended, this.pose);
    this.applyOverlays(ctx);
    if (input.detail === 'simple') {
      this.pose.jawOpen = 0;
      this.pose.tieSwing = 0;
      this.pose.headYaw = 0;
    }
    this.pose.headRoll += this.traits.headTilt;
    return this.pose;
  }

  private enter(state: PoseState, style: PoseStyle): void {
    this.style = style;
    if (state === this.base) {
      // Style change only (prop lost, charge started): cross-fade, keep the state clocks running.
      copyPose(this.blended, this.from);
      this.blendT = 0;
      this.blendDur = this.cfg.blendTime;
      return;
    }
    if (state === 'DEAD') {
      // Overlays end at death, so fade from what was actually visible (minus the constant tilt).
      copyPose(this.pose, this.from);
      this.from.headRoll -= this.traits.headTilt;
    } else {
      copyPose(this.blended, this.from);
    }
    this.prevBase = this.base;
    this.base = state;
    this.stateTime = 0;
    this.rawStateTime = 0;
    this.blendT = 0;
    this.blendDur = state === 'DEAD' ? this.cfg.deathBlendTime : this.cfg.blendTime;
    if (state === 'DEAD') {
      // The struggle / flinch layers stop at death; the cross-fade starts from the blended body pose.
      this.hitT = Number.POSITIVE_INFINITY;
      this.rootedW = 0;
    }
  }

  private trackHit(input: PoseInput, dt: number): void {
    if (input.hitCount !== this.lastHitCount) {
      this.lastHitCount = input.hitCount;
      if (this.base !== 'DEAD') {
        this.hitT = 0;
        this.hitSide = clampAbs(Number.isFinite(input.hitSide) ? input.hitSide : 0, 1);
        this.hitHead = input.hitHead;
        this.hitArmor = input.armorHit === true;
        return;
      }
    }
    this.hitT += dt;
  }

  private evaluateTarget(c: Ctx): void {
    const p = copyPose(REST, this.target);
    switch (this.base) {
      case 'IDLE': idlePose(p, c); break;
      case 'WANDER': wanderPose(p, c); break;
      case 'ALERT': alertPose(p, c, this.prevBase === 'AMBUSH'); break;
      case 'CHASE': chasePose(p, c); break;
      case 'ATTACK': attackPose(p, c, this.timing); break;
      case 'BREAK': breakPose(p, c); break;
      case 'AMBUSH': ambushPose(p, c, 1); break;
      case 'DEAD': deathPose(p, c, this.fallsForward); return;
      case 'VAULT': vaultPose(p, c); return;
      case 'RAGE': ragePose(p, c); break;
      default: idlePose(p, c);
    }
    if (STYLED_STATES.has(this.base)) applyStyle(p, c, this.style);
    plantFeet(p, c.props);
  }

  private applyOverlays(c: Ctx): void {
    const p = this.pose;
    if (this.rootedW > 0) struggle(p, c, this.rootedW);
    const e = hitEnvelope(this.hitT, this.timing.hitReactDuration, this.cfg.hitReact.peakTime);
    if (e > 0) {
      const h = this.cfg.hitReact;
      const s = this.hitSide;
      // Shots ringing off a cone / bucket / helmet rattle the head harder (Revision 2).
      const armor = this.hitArmor ? this.cfg.armorHitHeadScale : 1;
      p.spinePitch -= h.leanBackDeg * DEG * e;
      p.pelvisPitch -= h.leanBackDeg * 0.3 * DEG * e;
      p.headPitch -= h.headWhipDeg * DEG * e * (this.hitHead ? 1.4 : 0.6) * armor;
      p.headRoll -= s * h.headWhipDeg * 0.6 * DEG * e * armor;
      if (this.hitArmor) p.headYaw += Math.sin(this.hitT * 70) * h.headWhipDeg * 0.3 * DEG * e * armor;
      p.spineYaw -= s * h.twistDeg * DEG * e;
      p.shoulderLPitch -= h.armFlingDeg * DEG * e;
      p.shoulderRPitch -= h.armFlingDeg * DEG * e;
      p.rootFwd -= h.pushBack * e;
      p.jawOpen += 14 * DEG * e;
    }
  }
}

const REST: Pose = restPose();

/** Hit flinch envelope: fast rise to 1 at `peak`, smooth return to exactly 0 at `duration`. */
export function hitEnvelope(t: number, duration: number, peak: number): number {
  if (!(t >= 0) || t >= duration) return 0;
  const pk = Math.min(peak, duration * 0.5);
  if (t < pk) return smooth01(t / pk);
  return 1 - smooth01((t - pk) / (duration - pk));
}

/** Keep planted feet flat and the pelvis on the ground when knees/hips bend (simple 2-bone leg). */
function plantFeet(p: Pose, props: ZombieProportions): void {
  const drop = (hip: number, knee: number): number =>
    props.thighLength * (1 - Math.cos(hip)) + props.shinLength * (1 - Math.cos(hip - knee));
  p.rootY -= Math.min(drop(p.hipLPitch, p.kneeL), drop(p.hipRPitch, p.kneeR));
  // ankle (toe-down +) so that the shoe ends parallel to the ground, plus any authored toe drag.
  p.ankleL += p.hipLPitch - p.kneeL;
  p.ankleR += p.hipRPitch - p.kneeR;
}

function stance(p: Pose, c: Ctx): void {
  const i = c.a.idle;
  const sway = Math.sin(TAU * i.swayHz * c.clock);
  p.rootRoll = sway * i.swayRollDeg * DEG;
  p.pelvisRoll = -sway * i.swayRollDeg * 0.5 * DEG;
  p.spineRoll = sway * i.swayRollDeg * 0.6 * DEG;
  p.spinePitch = i.slouchDeg * DEG;
  p.neckPitch = i.slouchDeg * 0.6 * DEG;
  p.headPitch = -i.slouchDeg * 0.4 * DEG;
  const armSway = Math.sin(TAU * i.swayHz * c.clock + 1.3) * 3 * DEG;
  p.shoulderLPitch = i.armHangDeg * DEG + armSway;
  p.shoulderRPitch = i.armHangDeg * DEG - armSway;
  p.shoulderLRoll = 5 * DEG;
  p.shoulderRRoll = 5 * DEG;
  p.elbowL = i.elbowBendDeg * DEG;
  p.elbowR = i.elbowBendDeg * 1.2 * DEG;
  p.hipLPitch = i.kneeBendDeg * 0.5 * DEG;
  p.hipRPitch = i.kneeBendDeg * 0.5 * DEG;
  p.kneeL = i.kneeBendDeg * DEG;
  p.kneeR = i.kneeBendDeg * DEG;
  p.hipLRoll = 3 * DEG;
  p.hipRRoll = 3 * DEG;
  p.tieSwing = sway * 3 * DEG;
}

function idlePose(p: Pose, c: Ctx): void {
  const i = c.a.idle;
  stance(p, c);
  // Spiky twitch: sin^9 stays near zero and jerks briefly.
  const tw = Math.pow(Math.sin(TAU * i.twitchHz * c.clock), 9);
  p.headRoll += tw * i.twitchDeg * DEG;
  p.headYaw += Math.pow(Math.sin(TAU * i.twitchHz * 0.63 * c.clock + 2), 9) * i.twitchDeg * 0.8 * DEG;
  p.jawOpen = (0.5 + 0.5 * Math.sin(TAU * i.chewHz * c.clock)) * i.chewOpenDeg * DEG;
}

/** Leg swing for one side; `ph` is the side's stride phase. Returns nothing, writes the side's joints. */
function legGait(p: Pose, side: 'L' | 'R', ph: number, swing: number, knee: number, dragged: boolean, c: Ctx): void {
  const s = c.a.wander;
  const hip = Math.sin(ph) * swing * (dragged ? s.dragHipScale : 1);
  const kneeF = Math.max(0, Math.cos(ph)) * knee * (dragged ? 0.3 : 1);
  if (side === 'L') {
    p.hipLPitch += hip * c.loco;
    p.kneeL += kneeF * c.loco;
    if (dragged) p.ankleL += s.dragAnkleDeg * DEG * c.loco;
  } else {
    p.hipRPitch += hip * c.loco;
    p.kneeR += kneeF * c.loco;
    if (dragged) p.ankleR += s.dragAnkleDeg * DEG * c.loco;
  }
}

function wanderPose(p: Pose, c: Ctx): void {
  const w = c.a.wander;
  stance(p, c);
  const phi = c.stride;
  const L = c.loco;
  legGait(p, 'L', phi, w.hipSwingDeg * DEG, w.kneeBendDeg * DEG, c.limp === -1, c);
  legGait(p, 'R', phi + Math.PI, w.hipSwingDeg * DEG, w.kneeBendDeg * DEG, c.limp === 1, c);
  const tilt = (c.limp === 0 ? 1 : c.limp) * w.shoulderTiltDeg * DEG;
  p.spinePitch = lerp(p.spinePitch, w.leanDeg * DEG, L);
  p.spineRoll += tilt * L + Math.sin(phi) * 3 * DEG * L;
  p.pelvisYaw = Math.sin(phi) * w.pelvisTwistDeg * DEG * L;
  p.spineYaw = -p.pelvisYaw * 0.8;
  // Limp: the body dips when weight goes onto the dragged leg.
  const dragPhase = c.limp === 1 ? phi + Math.PI : phi;
  if (c.limp !== 0) p.rootY -= Math.max(0, Math.sin(dragPhase + Math.PI / 2)) * w.limpDip * L;
  p.rootRoll += (c.limp === 0 ? 0 : c.limp * Math.max(0, Math.sin(dragPhase + Math.PI / 2)) * 4 * DEG) * L;
  // Loose, lagging arm swing opposite to the legs.
  const lag = 0.5;
  p.shoulderLPitch += Math.sin(phi + Math.PI - lag) * w.armSwingDeg * DEG * L;
  p.shoulderRPitch += Math.sin(phi - lag) * w.armSwingDeg * DEG * L;
  p.elbowL = lerp(p.elbowL, w.elbowBendDeg * DEG + Math.max(0, Math.sin(phi + Math.PI - lag)) * 15 * DEG, L);
  p.elbowR = lerp(p.elbowR, w.elbowBendDeg * DEG + Math.max(0, Math.sin(phi - lag)) * 15 * DEG, L);
  p.headRoll += Math.sin(phi) * 4 * DEG * L;
  p.tieSwing += Math.sin(phi * 2) * 4 * DEG * L;
  p.jawOpen = (0.5 + 0.5 * Math.sin(TAU * c.a.idle.chewHz * 0.6 * c.clock)) * c.a.idle.chewOpenDeg * 0.6 * DEG;
}

function alertPose(p: Pose, c: Ctx, risingFromAmbush: boolean): void {
  const a = c.a.alert;
  stance(p, c);
  const look = clampAbs(c.input.lookYaw, a.headTurnMaxDeg * DEG);
  // Head turns first, the upper body follows after bodyDelay.
  const bodyW = smooth01((c.t - a.bodyDelay) / Math.max(0.05, a.bodyDelay));
  p.headYaw = look * (1 - a.bodyFollow * bodyW);
  p.spineYaw = look * a.bodyFollow * bodyW;
  p.pelvisYaw = look * a.bodyFollow * 0.4 * bodyW;
  const raise = smooth01((c.t - 0.1) / 0.4);
  const tremor = Math.sin(TAU * a.tremorHz * c.clock) * a.tremorDeg * DEG;
  p.shoulderLPitch = lerp(p.shoulderLPitch, a.armRaiseDeg * DEG, raise) + tremor;
  p.shoulderRPitch = lerp(p.shoulderRPitch, a.armRaiseDeg * 0.9 * DEG, raise) - tremor;
  p.elbowL = lerp(p.elbowL, 25 * DEG, raise);
  p.elbowR = lerp(p.elbowR, 30 * DEG, raise);
  // Groan: jaw wide with a tremble, head thrown slightly back.
  p.jawOpen = a.jawOpenDeg * DEG * (0.85 + 0.15 * Math.sin(TAU * a.tremorHz * 0.7 * c.clock));
  p.headPitch -= a.headBackDeg * DEG * smooth01(c.t / 0.2);
  p.spinePitch -= 4 * DEG * raise;
  if (risingFromAmbush) {
    const crouch = 1 - smooth01(c.t / c.a.ambush.riseTime);
    if (crouch > 0) {
      const stand = copyPose(p, scratch);
      ambushPose(p, c, crouch);
      blendPose(stand, p, crouch, p);
    }
  }
}

const scratch: Pose = restPose();

function chasePose(p: Pose, c: Ctx): void {
  const ch = c.a.chase;
  stance(p, c);
  const phi = c.stride;
  const L = c.loco;
  const limpScaled = c.limp;
  legGait(p, 'L', phi, ch.hipSwingDeg * DEG, ch.kneeBendDeg * DEG, false, c);
  legGait(p, 'R', phi + Math.PI, ch.hipSwingDeg * DEG, ch.kneeBendDeg * DEG, false, c);
  if (limpScaled === -1) p.hipLPitch *= ch.limpScale;
  if (limpScaled === 1) p.hipRPitch *= ch.limpScale;
  const lean = ch.leanDeg * DEG * (0.6 + 0.4 * L);
  p.spinePitch = lean;
  p.pelvisPitch = lean * 0.25;
  p.neckPitch = -lean * 0.35;
  p.headPitch = -lean * 0.35;
  p.rootRoll += Math.sin(phi) * ch.lurchRollDeg * DEG * L;
  p.spineRoll += Math.sin(phi) * ch.lurchRollDeg * 0.7 * DEG * L;
  p.pelvisYaw = Math.sin(phi) * 8 * DEG * L;
  p.spineYaw = -p.pelvisYaw * 0.6;
  // Arms reach for the target, bobbing out of phase with the steps.
  p.shoulderLPitch = ch.armReachDeg * DEG + Math.sin(phi + 0.6) * ch.armBobDeg * DEG * L;
  p.shoulderRPitch = ch.armReachDeg * 0.95 * DEG + Math.sin(phi + Math.PI + 0.6) * ch.armBobDeg * DEG * L;
  p.shoulderLRoll = -3 * DEG;
  p.shoulderRRoll = -3 * DEG;
  p.elbowL = ch.elbowBendDeg * DEG;
  p.elbowR = ch.elbowBendDeg * 1.3 * DEG;
  p.headYaw = clampAbs(c.input.lookYaw * 0.6, ch.headTrackDeg * DEG);
  p.jawOpen = (0.4 + 0.6 * Math.abs(Math.sin(Math.PI * ch.jawHz * c.clock))) * ch.jawOpenDeg * DEG;
  p.tieSwing = lean * 0.8 + Math.sin(phi * 2) * 6 * DEG * L;
}

/**
 * Attack: windup (lean back, claws raised) for exactly `attackWindup` seconds — maximum backward lean
 * at the end of the windup (FR-AI-08) — then a quick lunge, then recovery back to the ready stance.
 */
function attackPose(p: Pose, c: Ctx, timing: PoseTiming): void {
  const k = c.a.attack;
  stance(p, c);
  const t = c.input.attackClock ?? c.rawT;
  const W = timing.attackWindup;
  const Lg = k.lungeTime;
  const R = Math.max(0.05, timing.attackRecover);
  let lean = k.readyLeanDeg;
  let arm = k.readyArmDeg;
  let elbow = 30;
  let fwd = 0;
  let jaw = 0.4;
  if (t < W) {
    const e = smooth01(t / W);
    lean = lerp(k.readyLeanDeg, k.windupLeanDeg, e);
    arm = lerp(k.readyArmDeg, k.windupArmDeg, e);
    elbow = lerp(30, k.windupElbowDeg, e);
    fwd = -0.05 * e;
    jaw = lerp(0.4, 1, e);
  } else if (t < W + Lg) {
    const e = 1 - Math.pow(1 - (t - W) / Lg, 2); // ease-out: fast strike
    lean = lerp(k.windupLeanDeg, k.lungeLeanDeg, e);
    arm = lerp(k.windupArmDeg, k.lungeArmDeg, e);
    elbow = lerp(k.windupElbowDeg, k.lungeElbowDeg, e);
    fwd = lerp(-0.05, k.lungeDistance, e);
    jaw = 1;
  } else if (t < W + Lg + R) {
    const e = smooth01((t - W - Lg) / R);
    lean = lerp(k.lungeLeanDeg, k.readyLeanDeg, e);
    arm = lerp(k.lungeArmDeg, k.readyArmDeg, e);
    elbow = lerp(k.lungeElbowDeg, 30, e);
    fwd = lerp(k.lungeDistance, 0, e);
    jaw = lerp(1, 0.4, e);
  }
  p.spinePitch = lean * DEG;
  p.pelvisPitch = lean * 0.2 * DEG;
  p.neckPitch = -lean * 0.3 * DEG;
  p.shoulderRPitch = arm * DEG;
  p.shoulderLPitch = arm * 0.88 * DEG;
  p.shoulderLRoll = 8 * DEG;
  p.shoulderRRoll = 8 * DEG;
  p.elbowR = elbow * DEG;
  p.elbowL = elbow * 0.9 * DEG;
  p.rootFwd = fwd;
  p.jawOpen = jaw * k.jawOpenDeg * DEG;
  // Weight shift: back leg loads during windup, front leg during the lunge.
  p.hipLPitch += Math.max(0, fwd) * 1.2;
  p.kneeL += Math.max(0, fwd) * 1.6;
  p.hipRPitch -= Math.max(0, -fwd) * 2;
  p.tieSwing = lean * 0.6 * DEG;
}

/** Break: alternating overhead pounding on a nut wall; slow raise, fast slam. */
function breakPose(p: Pose, c: Ctx): void {
  const b = c.a.break;
  stance(p, c);
  const stroke = (u: number): number => (u < 0.65 ? smooth01(u / 0.65) : 1 - Math.pow((u - 0.65) / 0.35, 2));
  const uL = (c.clock * b.poundHz) % 1;
  const uR = (c.clock * b.poundHz + 0.5) % 1;
  const sL = stroke(uL);
  const sR = stroke(uR);
  p.shoulderLPitch = lerp(b.armLowDeg, b.armHighDeg, sL) * DEG;
  p.shoulderRPitch = lerp(b.armLowDeg, b.armHighDeg, sR) * DEG;
  p.elbowL = lerp(b.elbowLowDeg, b.elbowHighDeg, sL) * DEG;
  p.elbowR = lerp(b.elbowLowDeg, b.elbowHighDeg, sR) * DEG;
  const slam = Math.max(1 - sL, 1 - sR);
  p.spinePitch = (b.leanDeg + slam * 6) * DEG;
  p.spineRoll = (sL - sR) * 6 * DEG;
  p.spineYaw = (sR - sL) * 8 * DEG;
  p.rootY -= slam * b.slamDip;
  p.jawOpen = (0.3 + 0.7 * slam) * b.jawOpenDeg * DEG;
  p.tieSwing = slam * 10 * DEG;
}

/** Ambush crouch (weight 0..1 so ALERT can rise out of it). */
function ambushPose(p: Pose, c: Ctx, weight: number): void {
  const m = c.a.ambush;
  if (weight >= 1) stance(p, c);
  const breath = Math.sin(TAU * m.breathHz * c.clock) * m.breathDeg * DEG;
  p.hipLPitch = m.crouchHipDeg * DEG;
  p.hipRPitch = m.crouchHipDeg * 0.9 * DEG;
  p.kneeL = m.crouchKneeDeg * DEG;
  p.kneeR = m.crouchKneeDeg * 0.95 * DEG;
  p.hipLRoll = 10 * DEG;
  p.hipRRoll = 10 * DEG;
  p.spinePitch = m.crouchLeanDeg * DEG + breath;
  p.pelvisPitch = 10 * DEG;
  p.neckPitch = -m.crouchLeanDeg * 0.5 * DEG;
  p.headPitch = -10 * DEG;
  p.shoulderLPitch = 35 * DEG;
  p.shoulderRPitch = 30 * DEG;
  p.elbowL = 40 * DEG;
  p.elbowR = 45 * DEG;
  p.jawOpen = 0;
}

/**
 * Death: knees buckle, then the body falls forward or backward (seeded), arms flung by inertia,
 * a small bounce on impact, then a fixed lying pose that never changes again (FR-AI-10).
 */
function deathPose(p: Pose, c: Ctx, forward: boolean): void {
  const d = c.a.death;
  const total = d.buckleTime + d.fallTime + d.settleTime;
  const t = Math.min(c.rawT, total);
  const dir = forward ? 1 : -1;
  const buckle = smooth01(t / d.buckleTime);
  const fallU = clamp01((t - d.buckleTime) / d.fallTime);
  const fall = fallU * fallU; // gravity: accelerating
  const settleU = clamp01((t - d.buckleTime - d.fallTime) / d.settleTime);
  const bounce = Math.sin(Math.PI * settleU) * (1 - settleU) * d.bounceDeg * DEG;
  const knee = d.kneeBuckleDeg * DEG * buckle;
  const kneeEnd = forward ? knee * 0.55 : knee * 0.15;
  p.kneeL = lerp(knee, kneeEnd, fall);
  p.kneeR = lerp(knee * 0.85, kneeEnd * 0.8, fall);
  p.hipLPitch = lerp(knee * 0.55, forward ? 0.1 : 0.15, fall);
  p.hipRPitch = lerp(knee * 0.45, forward ? 0.05 : 0.25, fall);
  const legDrop = (hip: number, k: number): number =>
    c.props.thighLength * (1 - Math.cos(hip)) + c.props.shinLength * (1 - Math.cos(hip - k));
  p.rootY = -Math.min(legDrop(p.hipLPitch, p.kneeL), legDrop(p.hipRPitch, p.kneeR)) * (1 - fall);
  p.rootPitch = dir * (Math.PI / 2 - 0.06) * fall - dir * bounce;
  p.liftY = d.groundLift * fall;
  p.spinePitch = lerp(18 * DEG * buckle * dir, 0, fall);
  p.neckPitch = 20 * DEG * buckle * (1 - fall);
  p.headPitch = 15 * DEG * buckle;
  p.headYaw = forward ? 65 * DEG * fall : 0;
  p.headRoll = forward ? 0 : 22 * DEG * fall;
  p.jawOpen = (12 + 18 * fall) * DEG;
  // Arms lag behind the fall (inertia), then land in their resting spots.
  const fling = Math.sin(Math.PI * fallU) * d.armFlingDeg * DEG;
  const armEndPitch = forward ? 160 * DEG : 15 * DEG;
  const armEndRoll = forward ? 25 * DEG : 70 * DEG;
  const limp = 12 * DEG * buckle;
  p.shoulderLPitch = lerp(limp, armEndPitch, fall) - dir * fling;
  p.shoulderRPitch = lerp(limp * 0.7, armEndPitch * 0.9, fall) - dir * fling * 0.8;
  p.shoulderLRoll = lerp(8 * DEG, armEndRoll, fall) + fling * 0.4;
  p.shoulderRRoll = lerp(8 * DEG, armEndRoll * 1.1, fall) + fling * 0.3;
  p.elbowL = lerp(15 * DEG, 25 * DEG, fall) + bounce * 2;
  p.elbowR = lerp(20 * DEG, 40 * DEG, fall) + bounce * 2;
  p.ankleL = 0.4 * fall;
  p.ankleR = 0.3 * fall;
  p.tieSwing = -dir * 20 * DEG * fall;
}

/** Rooted by a vine trap: legs stay put, torso twists and arms flail (weight 0..1). */
function struggle(p: Pose, c: Ctx, w: number): void {
  const r = c.a.rooted;
  const s = Math.sin(TAU * r.struggleHz * c.clock);
  const s2 = Math.sin(TAU * r.struggleHz * 1.37 * c.clock + 1.1);
  p.spineYaw += s * r.twistDeg * DEG * w;
  p.pelvisYaw -= s * r.twistDeg * 0.4 * DEG * w;
  p.spinePitch += (r.leanDeg + Math.abs(s2) * 6) * DEG * w;
  p.shoulderLPitch += s2 * r.armFlailDeg * DEG * w;
  p.shoulderRPitch -= s * r.armFlailDeg * DEG * w;
  p.shoulderLRoll += Math.abs(s) * 20 * DEG * w;
  p.shoulderRRoll += Math.abs(s2) * 20 * DEG * w;
  p.headRoll += s2 * 10 * DEG * w;
  p.jawOpen += Math.abs(s) * 18 * DEG * w;
}

// ---------------------------------------------------------------- Revision 2: type poses

/** Layers the type / prop style on an already evaluated IDLE / WANDER / ALERT / CHASE pose. */
function applyStyle(p: Pose, c: Ctx, style: PoseStyle): void {
  switch (style) {
    case 'newspaper': newspaperStyle(p, c); break;
    case 'raged': ragedRunStyle(p, c); break;
    case 'screendoor': screendoorStyle(p, c); break;
    case 'charge': chargeStyle(p, c); break;
    case 'pole': poleCarryStyle(p, c); break;
    default: break;
  }
}

/** Reading while walking: both hands hold the paper in front of the face, head bowed, slow page turns. */
function newspaperStyle(p: Pose, c: Ctx): void {
  const n = c.a.newspaper;
  const turn = Math.pow(Math.max(0, Math.sin(TAU * n.pageTurnHz * c.clock)), 8) * n.pageTurnDeg * DEG;
  p.shoulderLPitch = n.armDeg * DEG;
  p.shoulderRPitch = n.armDeg * DEG - turn * 0.5;
  p.shoulderLRoll = -14 * DEG;
  p.shoulderRRoll = -14 * DEG + turn;
  p.elbowL = n.elbowDeg * DEG;
  p.elbowR = n.elbowDeg * DEG;
  p.headPitch += n.headDownDeg * DEG;
  p.headYaw = turn * 0.6;
  p.jawOpen *= 0.4;
}

/** Holding the screen door out in front with both hands. */
function screendoorStyle(p: Pose, c: Ctx): void {
  const d = c.a.screendoor;
  const bob = Math.sin(c.stride) * 2 * DEG * c.loco;
  p.shoulderLPitch = d.armDeg * DEG + bob;
  p.shoulderRPitch = d.armDeg * DEG - bob;
  p.shoulderLRoll = -6 * DEG;
  p.shoulderRRoll = -6 * DEG;
  p.elbowL = d.elbowDeg * DEG;
  p.elbowR = d.elbowDeg * DEG;
  p.spinePitch = d.leanDeg * DEG;
  p.spineYaw *= 0.3; // the door keeps the shoulders square
}

/** Football charge: low forward lean, head down behind the helmet, elbows tucked, long strides. */
function chargeStyle(p: Pose, c: Ctx): void {
  const f = c.a.charge;
  const lean = f.leanDeg * DEG;
  const L = c.loco;
  p.hipLPitch *= f.hipSwingScale;
  p.hipRPitch *= f.hipSwingScale;
  p.spinePitch = lean;
  p.pelvisPitch = lean * 0.3;
  p.neckPitch = -lean * 0.3;
  p.headPitch = f.headDownDeg * DEG - lean * 0.5;
  p.headYaw *= 0.3;
  p.shoulderLPitch = f.armDeg * DEG + Math.sin(c.stride + Math.PI) * 15 * DEG * L;
  p.shoulderRPitch = f.armDeg * DEG + Math.sin(c.stride) * 15 * DEG * L;
  p.shoulderLRoll = 12 * DEG;
  p.shoulderRRoll = 12 * DEG;
  p.elbowL = f.elbowDeg * DEG;
  p.elbowR = f.elbowDeg * DEG;
  p.jawOpen *= 0.5;
}

/** Pole vaulter before the vault: the pole is carried forward with both hands. */
function poleCarryStyle(p: Pose, c: Ctx): void {
  const v = c.a.vault;
  const bob = Math.sin(c.stride * 2) * 3 * DEG * c.loco;
  p.shoulderLPitch = v.carryArmDeg * DEG + bob;
  p.shoulderRPitch = v.carryArmDeg * DEG + bob;
  p.shoulderLRoll = -10 * DEG;
  p.shoulderRRoll = -6 * DEG;
  p.elbowL = v.carryElbowDeg * DEG;
  p.elbowR = v.carryElbowDeg * DEG;
}

/** Newspaper zombie after the rage: sprinting with longer strides and pumping fists (run cadence). */
function ragedRunStyle(p: Pose, c: Ctx): void {
  const r = c.a.rage;
  const phi = c.stride;
  const L = c.loco;
  p.hipLPitch *= r.runHipScale;
  p.hipRPitch *= r.runHipScale;
  p.spinePitch = (c.a.chase.leanDeg + 6) * DEG;
  p.shoulderLPitch = 10 * DEG + Math.sin(phi + Math.PI) * r.runArmPumpDeg * DEG * L;
  p.shoulderRPitch = 10 * DEG + Math.sin(phi) * r.runArmPumpDeg * DEG * L;
  p.shoulderLRoll = 8 * DEG;
  p.shoulderRRoll = 8 * DEG;
  p.elbowL = 85 * DEG;
  p.elbowR = 85 * DEG;
  p.jawOpen = r.roarJawDeg * 0.6 * DEG;
}

/** Newspaper torn: stomping in place, roaring with the head thrown back, fists shaking at the sides. */
function ragePose(p: Pose, c: Ctx): void {
  const r = c.a.rage;
  stance(p, c);
  const s = Math.sin(TAU * r.stompHz * c.clock);
  p.hipLPitch += Math.max(0, s) * r.stompHipDeg * DEG;
  p.kneeL += Math.max(0, s) * r.stompKneeDeg * DEG;
  p.hipRPitch += Math.max(0, -s) * r.stompHipDeg * DEG;
  p.kneeR += Math.max(0, -s) * r.stompKneeDeg * DEG;
  const roar = smooth01(c.rawT / 0.15);
  p.jawOpen = r.roarJawDeg * DEG * roar * (0.85 + 0.15 * Math.sin(TAU * 9 * c.clock));
  p.headPitch -= r.roarBackDeg * DEG * roar;
  p.spinePitch -= 6 * DEG * roar;
  const shake = Math.sin(TAU * r.fistShakeHz * c.clock) * r.fistShakeDeg * DEG;
  p.shoulderLPitch = r.armDownDeg * DEG + shake;
  p.shoulderRPitch = r.armDownDeg * DEG - shake;
  p.shoulderLRoll = 25 * DEG;
  p.shoulderRRoll = 25 * DEG;
  p.elbowL = r.elbowDeg * DEG;
  p.elbowR = r.elbowDeg * DEG;
  p.rootY -= Math.abs(s) * 0.02;
}

/**
 * Pole vault driven by the gameplay progress u: run in with the pole → plant it (lean, arms drop) →
 * arc over with tucked legs (root lifts by vaultLift, rises then falls) → stumbling, knee-bent landing.
 */
function vaultPose(p: Pose, c: Ctx): void {
  const v = c.a.vault;
  const u = clamp01(Number.isFinite(c.input.vaultProgress) ? c.input.vaultProgress : 0);
  chasePose(p, c);
  if (u < v.plantEnd) {
    const e = smooth01(u / v.plantEnd);
    p.spinePitch = lerp(p.spinePitch, v.plantLeanDeg * DEG, e);
    p.shoulderLPitch = lerp(v.carryArmDeg, v.plantArmDeg, e) * DEG;
    p.shoulderRPitch = lerp(v.carryArmDeg, v.plantArmDeg, e) * DEG;
    p.elbowL = lerp(v.carryElbowDeg, 10, e) * DEG;
    p.elbowR = lerp(v.carryElbowDeg, 10, e) * DEG;
    plantFeet(p, c.props);
    return;
  }
  if (u < v.flightEnd) {
    const f = (u - v.plantEnd) / (v.flightEnd - v.plantEnd);
    const tuck = Math.sin(Math.PI * f);
    p.liftY = vaultLift(v, u);
    p.rootPitch = -v.flightPitchDeg * DEG * tuck;
    p.hipLPitch = v.tuckHipDeg * DEG * tuck;
    p.hipRPitch = v.tuckHipDeg * 0.9 * DEG * tuck;
    p.kneeL = v.tuckKneeDeg * DEG * tuck;
    p.kneeR = v.tuckKneeDeg * 0.95 * DEG * tuck;
    p.ankleL = 0.3 * tuck;
    p.ankleR = 0.3 * tuck;
    p.shoulderLPitch = lerp(v.plantArmDeg, 170, smooth01(f)) * DEG;
    p.shoulderRPitch = lerp(v.plantArmDeg, 165, smooth01(f)) * DEG;
    p.elbowL = 10 * DEG;
    p.elbowR = 10 * DEG;
    p.spinePitch = lerp(v.plantLeanDeg, 0, smooth01(f)) * DEG;
    p.jawOpen = 28 * DEG;
    return;
  }
  const l = (u - v.flightEnd) / (1 - v.flightEnd);
  const absorb = 1 - 0.6 * smooth01(l);
  p.kneeL = v.landKneeDeg * DEG * absorb;
  p.kneeR = v.landKneeDeg * 0.8 * DEG * absorb;
  p.hipLPitch = p.kneeL * 0.6;
  p.hipRPitch = p.kneeR * 0.4;
  p.spinePitch = v.landLeanDeg * DEG * absorb;
  p.rootRoll = Math.sin(l * Math.PI * 2) * 6 * DEG * (1 - l);
  p.shoulderLPitch = 60 * DEG + Math.sin(l * Math.PI * 3) * 20 * DEG;
  p.shoulderRPitch = 45 * DEG - Math.sin(l * Math.PI * 3) * 20 * DEG;
  p.shoulderLRoll = 30 * DEG;
  p.shoulderRRoll = 30 * DEG;
  plantFeet(p, c.props);
}
