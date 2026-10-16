// Pea shooter plant auto-targeting (7.8.4, FR-PLT-13/14, TR-PLT-01). Pure.
import type { Vec3Like } from '../core/events';
import { DEG, angleDiff, dist3, distXZ, yawTo } from './math';

export interface ShooterParams {
  attackRange: number;
  attackDropRange: number;
  attackInterval: number;
  turnSpeedDegPerSec: number;
  fireAngleToleranceDeg: number;
  targetEvalInterval: number;
}

export interface ShooterState {
  yaw: number;
  targetId: string | null;
  cooldown: number;
  evalTimer: number;
  mode: 'IDLE' | 'TURNING' | 'FIRING';
  idleTime: number;
}

export interface ShooterTarget {
  id: string;
  pos: Vec3Like;
  alive: boolean;
}

export interface ShooterContext {
  pos: Vec3Like;
  targets: ShooterTarget[];
  hasLineOfSight: (from: Vec3Like, to: Vec3Like) => boolean;
}

export function createShooterState(yaw: number): ShooterState {
  return { yaw, targetId: null, cooldown: 0, evalTimer: 0, mode: 'IDLE', idleTime: 0 };
}

function acquire(ctx: ShooterContext, p: ShooterParams): string | null {
  let best: ShooterTarget | null = null;
  let bestD = Infinity;
  for (const t of ctx.targets) {
    if (!t.alive) continue;
    const d = dist3(ctx.pos, t.pos);
    if (d <= p.attackRange && d < bestD && ctx.hasLineOfSight(ctx.pos, t.pos)) {
      best = t;
      bestD = d;
    }
  }
  return best ? best.id : null;
}

/** Advances the shooter; returns the id of the zombie fired upon this tick (or null). */
export function stepShooter(s: ShooterState, ctx: ShooterContext, p: ShooterParams, dt: number): string | null {
  s.cooldown = Math.max(0, s.cooldown - dt);
  s.evalTimer -= dt;
  let target = ctx.targets.find((t) => t.id === s.targetId) ?? null;
  if (s.evalTimer <= 0) {
    s.evalTimer = p.targetEvalInterval;
    const lost = !target || !target.alive || distXZ(ctx.pos, target.pos) > p.attackDropRange || !ctx.hasLineOfSight(ctx.pos, target.pos);
    if (lost) {
      s.targetId = acquire(ctx, p);
      target = ctx.targets.find((t) => t.id === s.targetId) ?? null;
    }
  }
  if (!target || !target.alive) {
    s.targetId = null;
    s.mode = 'IDLE';
    s.idleTime += dt;
    return null;
  }
  const desired = yawTo(ctx.pos, target.pos);
  const diff = angleDiff(s.yaw, desired);
  const maxTurn = p.turnSpeedDegPerSec * DEG * dt;
  s.yaw += Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn;
  const remaining = Math.abs(angleDiff(s.yaw, desired));
  if (remaining > p.fireAngleToleranceDeg * DEG) {
    s.mode = 'TURNING';
    return null;
  }
  s.mode = 'FIRING';
  if (s.cooldown > 0) return null;
  s.cooldown = p.attackInterval;
  return target.id;
}
