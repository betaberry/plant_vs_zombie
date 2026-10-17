// Dropped armour props (Revision 2, plan Step 28): a broken cone / bucket / helmet / door or the
// discarded pole tumbles to the ground, bounces, rests for restSeconds and then fades out.
// Pure: no Three.js / DOM. Rotation is kept as accumulated Euler angles applied on top of the
// prop's orientation at the moment it was dropped.
import type { DroppedPropConfig } from '../config/types';
import type { Vec3Like } from '../core/events';

export interface DroppedPropState {
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  rot: { x: number; y: number; z: number };
  spin: { x: number; y: number; z: number };
  groundY: number;
  /** Seconds since it came to rest (−1 while still tumbling). */
  restT: number;
  hitGround: boolean;
}

export interface DroppedPropStep {
  /** True on the step of the first ground contact (metal clang). */
  landedNow: boolean;
  /** 1 while visible, shrinks to 0 during the fade. */
  scale: number;
  /** True when fully faded: the instance can be released. */
  done: boolean;
}

/**
 * Launch a prop from `origin` (world position of the accessory) away from `awayYaw` (the zombie's
 * facing: props fly backwards / sideways, like being knocked off). `rand` returns 0..1.
 */
export function launchDroppedProp(origin: Vec3Like, groundY: number, awayYaw: number, cfg: DroppedPropConfig, rand: () => number): DroppedPropState {
  const yaw = awayYaw + Math.PI + (rand() - 0.5) * 1.6;
  const speed = cfg.launchSpeed * (0.6 + 0.4 * rand());
  const s = (): number => (rand() * 2 - 1) * cfg.spinSpeed;
  return {
    pos: { x: origin.x, y: Math.max(origin.y, groundY), z: origin.z },
    // yaw 0 faces −Z: forward = (−sin yaw, 0, −cos yaw).
    vel: { x: -Math.sin(yaw) * speed, y: cfg.launchSpeed * (0.8 + 0.4 * rand()), z: -Math.cos(yaw) * speed },
    rot: { x: 0, y: 0, z: 0 },
    spin: { x: s(), y: s() * 0.5, z: s() },
    groundY,
    restT: -1,
    hitGround: false,
  };
}

const SETTLE_SPEED = 0.6;

export function stepDroppedProp(s: DroppedPropState, cfg: DroppedPropConfig, dtIn: number): DroppedPropStep {
  const dt = Number.isFinite(dtIn) && dtIn > 0 ? dtIn : 0;
  let landedNow = false;
  if (s.restT < 0) {
    s.vel.y += cfg.gravity * dt;
    s.pos.x += s.vel.x * dt;
    s.pos.y += s.vel.y * dt;
    s.pos.z += s.vel.z * dt;
    s.rot.x += s.spin.x * dt;
    s.rot.y += s.spin.y * dt;
    s.rot.z += s.spin.z * dt;
    if (s.pos.y <= s.groundY && s.vel.y < 0) {
      s.pos.y = s.groundY;
      if (!s.hitGround) landedNow = true;
      s.hitGround = true;
      s.vel.y = -s.vel.y * cfg.bounce;
      s.vel.x *= 0.55;
      s.vel.z *= 0.55;
      s.spin.x *= 0.5;
      s.spin.y *= 0.5;
      s.spin.z *= 0.5;
      if (s.vel.y < SETTLE_SPEED) s.restT = 0;
    }
  } else {
    s.restT += dt;
  }
  const fadeT = s.restT - cfg.restSeconds;
  const scale = s.restT < 0 || fadeT <= 0 ? 1 : Math.max(0, 1 - fadeT / cfg.fadeSeconds);
  return { landedNow, scale, done: scale <= 0 };
}
