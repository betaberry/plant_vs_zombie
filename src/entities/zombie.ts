// Basic zombie: state machine IDLE/WANDER/ALERT/CHASE/ATTACK/AMBUSH/BREAK/HIT_REACT/DEAD (8.2),
// perception (FR-AI-03/04), 「顺路」 target priority (8.3) and waypoint navigation (TR-NAV).
import type RAPIER from '@dimforge/rapier3d-compat';
import type { ZombieDef } from '../config/types';
import type { CommandBus } from '../core/commands';
import type { Vec3Like } from '../core/events';
import type { Rng } from '../core/rng';
import { store } from '../core/store';
import { createArmorState, resolveArmorHit, type ArmorState } from '../logic/armor';
import { applyHealthDamage, type DamageInfo, type DamageResult, type IAttackable } from '../logic/attackable';
import type { HitZoneDef } from '../logic/hitzone';
import { angleDiff, DEG, distXZ, yawTo } from '../logic/math';
import {
  abilityMoveSpeed, canBeRooted, createAbilityState, findVaultTarget, isCharging, isVaulting, onArmorBroken, startVault, stepRage, stepVault,
  type AbilityState,
} from '../logic/zombieAbilities';
import { canSee } from '../logic/perception';
import { chooseZombieTarget, type TargetPlant } from '../logic/targeting';
import { findPath } from '../nav/astar';
import type { NavGraph } from '../nav/graph';
import type { PhysicsWorld } from '../physics/world';
import { buildingAt, type CityLayout } from '../world/layout';
import type { Player } from './player';
import type { ShootTarget } from './weapon';

/** VAULT (pole vaulter in mid-air) and RAGE (newspaper torn, stomping) are Revision 2 type states. */
export type ZombieState = 'IDLE' | 'WANDER' | 'ALERT' | 'CHASE' | 'ATTACK' | 'AMBUSH' | 'BREAK' | 'HIT_REACT' | 'DEAD' | 'VAULT' | 'RAGE';

export interface PlantHandle extends IAttackable {
  readonly type: string;
}

export interface ZombieWorld {
  phys: PhysicsWorld;
  nav: NavGraph;
  layout: CityLayout;
  rng: Rng;
  commands: CommandBus;
  player: Player;
  controller: RAPIER.KinematicCharacterController;
  targetPlants(zombieId: string): TargetPlant[];
  plantById(id: string): PlantHandle | undefined;
  nutWallNear(pos: Vec3Like, radius: number): string | null;
  openDoorsNear(pos: Vec3Like, radius: number): void;
  hasLOS(a: Vec3Like, b: Vec3Like): boolean;
  neighbors(z: Zombie): Zombie[];
}

const EYE = 1.6;

export class Zombie implements ShootTarget {
  readonly team = 'zombie' as const;
  health: number;
  state: ZombieState;
  private resumeState: ZombieState = 'CHASE';
  pos: Vec3Like;
  prevPos: Vec3Like;
  yaw: number;
  vy = 0;
  hasAggro = false;
  perceivedNow = false;
  secondsSinceSeen = 999;
  playerReachable = true;
  private unreachableTimer = 0;
  stateTimer = 0;
  private attackCooldown = 0;
  private windup = -1;
  private attackTargetId: string | null = null;
  currentPlantId: string | null = null;
  blockingWallId: string | null = null;
  private decisionTimer = 0;
  private perceptionTimer = 0;
  private path: number[] = [];
  private pathEdges: number[] = [];
  private pathIndex = 0;
  private repathTimer = 0;
  private wanderTarget: Vec3Like | null = null;
  private patrolIndex = 0;
  private stuckTimer = 0;
  private stuckRef: Vec3Like;
  slowTimer = 0;
  slowPercent = 0;
  rootTimer = 0;
  hitReactTimer = 0;
  flash = 0;
  deathTime = 0;
  private colliderDisabled = false;
  private lodAccum = 0;
  walkPhase = 0;
  lastHitHeadshot = false;
  killedByPlant = false;
  /** Render-only bookkeeping for the pose animator (no gameplay effect). */
  hitCount = 0;
  lastHitSide = 0;
  lastHitHead = false;
  sinceStrike = 999;
  /** Render-only: football zombie charging this tick (lowered-head pose). */
  charging = false;
  readonly speedFactor: number;
  readonly reactionDelay: number;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  moveSpeed = 0;
  /** Revision 2: zombie type id (zombies.json key), armour and special-ability state. */
  readonly typeId: string;
  readonly armor: ArmorState | null;
  readonly abilities: AbilityState;
  /** 0..1 while pole vaulting (render-only arc input for Step 28), 0 otherwise. */
  vaultProgress = 0;
  /** Render-only: the last hit landed on armour (metal clank / stronger head flinch in Step 28). */
  lastHitArmor = false;

  constructor(
    readonly attackableId: string,
    readonly def: ZombieDef,
    spawn: Vec3Like,
    readonly anchor: Vec3Like,
    readonly ambush: boolean,
    readonly patrol: Vec3Like[] | null,
    private readonly w: ZombieWorld,
  ) {
    this.health = def.health;
    this.typeId = def.id;
    this.armor = createArmorState(def.armor);
    this.abilities = createAbilityState(def.abilities);
    this.state = ambush ? 'AMBUSH' : 'IDLE';
    this.pos = { ...spawn };
    this.prevPos = { ...spawn };
    this.stuckRef = { ...spawn };
    this.yaw = w.rng.range(-Math.PI, Math.PI);
    this.speedFactor = 1 + w.rng.range(-def.speedVariance, def.speedVariance);
    this.reactionDelay = w.rng.range(0, def.reactionVariance);
    const half = def.colliderHeight / 2 - def.colliderRadius;
    const r = w.phys.addKinematicCapsule({ x: spawn.x, y: spawn.y + def.colliderHeight / 2, z: spawn.z }, half, def.colliderRadius, {
      team: 'zombie', entityId: attackableId, material: 'flesh',
    });
    this.body = r.body;
    this.collider = r.collider;
    this.stateTimer = w.rng.range(0.5, 2);
  }

  position(): Vec3Like {
    return this.pos;
  }

  isAlive(): boolean {
    return this.state !== 'DEAD';
  }

  ignoresRays(): boolean {
    return this.state === 'DEAD';
  }

  hitZoneDef(): HitZoneDef {
    return this.def;
  }

  localHit(point: Vec3Like): { localY: number; lateral: number } {
    const dx = point.x - this.pos.x;
    const dz = point.z - this.pos.z;
    // Right vector for yaw (yaw 0 faces -Z): (cos yaw, 0, -sin yaw).
    return { localY: point.y - this.pos.y, lateral: dx * Math.cos(this.yaw) - dz * Math.sin(this.yaw) };
  }

  applyDamage(amount: number, info: DamageInfo): DamageResult {
    if (this.state === 'DEAD') return { applied: 0, killed: false };
    // Armour first (Revision 2): measured before the zombie turns to face the attacker.
    const hitAngleDeg = info.from ? angleDiff(this.yaw, yawTo(this.pos, info.from)) / DEG : null;
    const split = resolveArmorHit(this.def.armor, this.armor, {
      amount, source: info.source, zone: info.zone, zoneMultiplier: info.zoneMultiplier, hitAngleDeg,
    });
    this.lastHitArmor = split.hitArmor;
    if (split.hitArmor && this.def.armor) {
      store.events.emit('armorHit', { pos: { ...this.pos }, kind: this.def.armor.kind, metal: this.def.armor.metal, source: info.source });
    }
    if (split.brokeNow) this.breakArmor();
    const state = { health: this.health };
    const body = applyHealthDamage(state, split.bodyDamage);
    const res: DamageResult = { applied: body.applied + split.armorDamage, killed: body.killed };
    this.health = state.health;
    this.flash = 1;
    if (info.slow) {
      // No stacking: keep the strongest slow and refresh its duration.
      this.slowPercent = Math.max(this.slowTimer > 0 ? this.slowPercent : 0, info.slow.percent);
      this.slowTimer = info.slow.duration;
      store.events.emit('frost', { pos: this.pos });
    }
    if (res.killed) {
      this.lastHitHeadshot = info.zone === 'head';
      this.killedByPlant = info.byPlant === true || info.source === 'plant';
      this.die();
      return res;
    }
    this.hitCount++;
    this.lastHitHead = info.zone === 'head';
    // + = hit came from the zombie's right (yaw > 0 is a left turn), measured before turning to face it.
    this.lastHitSide = info.from ? -Math.sin(angleDiff(this.yaw, yawTo(this.pos, info.from))) : 0;
    if (info.from) {
      this.yaw = yawTo(this.pos, info.from);
      if (!this.hasAggro) this.aggro();
    }
    // Mid-vault zombies keep flying and a raging newspaper zombie keeps stomping; no flinch interrupts them.
    if (isVaulting(this.abilities) || this.state === 'RAGE') return res;
    if (this.state !== 'HIT_REACT' && this.state !== 'AMBUSH') this.resumeState = this.state;
    if (this.state === 'AMBUSH') this.resumeState = 'ALERT';
    this.state = 'HIT_REACT';
    this.hitReactTimer = this.def.hitReactDuration;
    return res;
  }

  /** Returns false when the zombie cannot be rooted right now (pole vaulter in mid-vault). */
  root(seconds: number): boolean {
    if (!canBeRooted(this.abilities)) return false;
    this.rootTimer = Math.max(this.rootTimer, seconds);
    return true;
  }

  private breakArmor(): void {
    const a = this.def.armor;
    if (!a) return;
    store.events.emit('armorBroken', {
      pos: { ...this.pos }, zombieId: this.attackableId, typeId: this.typeId, kind: a.kind, dropProp: a.dropProp, metal: a.metal,
    });
    // Newspaper zombie: losing the paper starts the rage (stomp + roar, then run).
    if (onArmorBroken(this.abilities)) {
      this.state = 'RAGE';
      this.hitReactTimer = 0;
      store.events.emit('zombieRage', { pos: { ...this.pos } });
    }
  }

  /** Render-only: the last hit's armour material ('metal' clank, 'soft' cone / paper, null = flesh). */
  lastArmorHit(): 'metal' | 'soft' | null {
    if (!this.lastHitArmor || !this.def.armor) return null;
    return this.def.armor.metal ? 'metal' : 'soft';
  }

  /** Armour still worn (false for types without armour). */
  armorIntact(): boolean {
    return !!this.armor && !this.armor.broken;
  }

  /** Remaining armour fraction 0..1 (0 without armour); drives the dented-cone swap. */
  armorFraction(): number {
    return this.armor && this.def.armor ? this.armor.health / this.def.armor.health : 0;
  }

  private die(): void {
    this.state = 'DEAD';
    this.deathTime = 0;
    this.vaultProgress = 0;
    store.events.emit('zombieKilled', {
      pos: { ...this.pos }, headshot: this.lastHitHeadshot, byPlant: this.killedByPlant, typeId: this.typeId, sunDrop: this.def.sunDrop,
    });
  }

  /** Wake up toward the player (perceived or heard). */
  aggro(): void {
    if (this.state === 'DEAD') return;
    this.hasAggro = true;
    this.secondsSinceSeen = 0;
    if (this.state === 'IDLE' || this.state === 'WANDER' || this.state === 'AMBUSH') {
      this.state = 'ALERT';
      this.stateTimer = this.def.alertDuration + this.reactionDelay;
      store.events.emit('zombieGroan', { pos: this.pos });
    }
  }

  /** Called by the manager when the path graph changed under one of our edges (local recompute). */
  invalidatePathIfUses(edges: Set<number>): void {
    if (this.pathEdges.some((e) => edges.has(e))) this.repathTimer = 0;
  }

  /**
   * Seconds since the current attack windup began (windup lasts def.attackWindup), continuing through
   * the strike and recovery; null when no attack cycle is running. Read by the pose animator only.
   */
  attackClock(): number | null {
    if (this.state !== 'ATTACK') return null;
    if (this.windup >= 0) return this.def.attackWindup - this.windup;
    return this.def.attackWindup + this.sinceStrike;
  }

  get removable(): boolean {
    return this.state === 'DEAD' && this.deathTime >= this.def.deathRemoveDelay;
  }

  update(dt: number): void {
    const playerDist = distXZ(this.pos, this.w.player.position());
    if (this.state === 'DEAD') {
      this.deathTime += dt;
      if (!this.colliderDisabled && this.deathTime >= this.def.colliderDisableDelay) {
        this.collider.setEnabled(false);
        this.colliderDisabled = true;
      }
      return;
    }
    // LOD throttling (FR-AI-20): >120 m frozen, >60 m at 5 Hz.
    if (playerDist > this.def.lodFarDistance) return;
    if (playerDist > this.def.lodMidDistance) {
      this.lodAccum += dt;
      if (this.lodAccum < 1 / this.def.lodMidHz) return;
      dt = this.lodAccum;
    }
    this.lodAccum = 0;
    this.tickTimers(dt);
    if (this.vaultMotion(dt)) return;
    this.perceive(dt);
    this.think(dt);
    this.act(dt);
  }

  private tickTimers(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 6);
    this.slowTimer = Math.max(0, this.slowTimer - dt);
    this.rootTimer = Math.max(0, this.rootTimer - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.sinceStrike += dt;
    this.secondsSinceSeen += dt;
    if (stepRage(this.abilities, this.def.abilities, dt) && this.state === 'RAGE') {
      // Rage over: sprint at the player (or roam faster when nobody is around).
      this.state = this.hasAggro ? 'CHASE' : 'WANDER';
      this.decisionTimer = 0;
      this.repathTimer = 0;
    }
    if (this.state === 'HIT_REACT') {
      this.hitReactTimer -= dt;
      if (this.hitReactTimer <= 0) this.state = this.resumeState === 'HIT_REACT' ? 'CHASE' : this.resumeState;
    }
  }

  private perceive(dt: number): void {
    this.perceptionTimer -= dt;
    if (this.perceptionTimer > 0) return;
    this.perceptionTimer = 0.1;
    const player = this.w.player;
    if (!player.isAlive()) {
      this.perceivedNow = false;
      return;
    }
    const pp = player.position();
    const eye = { x: this.pos.x, y: this.pos.y + EYE, z: this.pos.z };
    const target = { x: pp.x, y: pp.y + 1.4, z: pp.z };
    const d = distXZ(this.pos, pp);
    const seen = canSee(eye, this.yaw, target, { range: this.def.visionRange, angleDeg: this.def.visionAngleDeg }, this.w.hasLOS)
      || (d < 2.2 && Math.abs(pp.y - this.pos.y) < 1.5);
    this.perceivedNow = seen;
    if (seen) this.secondsSinceSeen = 0;
    if (this.state === 'AMBUSH') {
      const myBuilding = buildingAt(this.w.layout, this.pos);
      const playerBuilding = buildingAt(this.w.layout, pp);
      if (seen || d <= this.def.ambushTriggerRange || (myBuilding && playerBuilding && myBuilding.id === playerBuilding.id)) this.aggro();
      return;
    }
    if (seen && !this.hasAggro) this.aggro();
  }

  private think(dt: number): void {
    if (this.state === 'ALERT') {
      this.stateTimer -= dt;
      this.yaw += angleDiff(this.yaw, yawTo(this.pos, this.w.player.position())) * Math.min(1, dt * 6);
      if (this.stateTimer <= 0) this.state = 'CHASE';
      return;
    }
    if (!this.hasAggro || this.state === 'HIT_REACT' || this.state === 'AMBUSH' || this.state === 'RAGE') return;
    this.decisionTimer -= dt;
    if (this.decisionTimer > 0) return;
    this.decisionTimer = this.def.targeting.reevaluateInterval;
    const p = this.w.player;
    const decision = chooseZombieTarget({
      zombiePos: this.pos,
      hasAggro: this.hasAggro,
      player: { pos: p.position(), alive: p.isAlive(), perceivedNow: this.perceivedNow, secondsSinceSeen: this.secondsSinceSeen, reachable: this.playerReachable },
      plants: this.w.targetPlants(this.attackableId),
      blockingWallId: this.blockingWallId,
      currentPlantId: this.currentPlantId,
      rules: this.def.targeting,
    });
    switch (decision.action) {
      case 'WANDER':
        this.hasAggro = false;
        this.currentPlantId = null;
        this.blockingWallId = null;
        this.state = 'WANDER';
        this.wanderTarget = null;
        break;
      case 'CHASE_PLAYER':
        this.currentPlantId = null;
        if (this.state !== 'ATTACK' || this.attackTargetId !== 'player') this.state = 'CHASE';
        break;
      case 'BREAK':
        this.currentPlantId = decision.plantId;
        this.state = 'BREAK';
        break;
      case 'ATTACK_PLANT':
        if (this.currentPlantId !== decision.plantId) this.repathTimer = 0;
        this.currentPlantId = decision.plantId;
        if (this.state !== 'ATTACK') this.state = 'CHASE';
        break;
    }
  }

  private currentGoal(): { pos: Vec3Like; targetId: string } | null {
    if (this.currentPlantId) {
      const plant = this.w.plantById(this.currentPlantId);
      if (plant && plant.isAlive()) return { pos: plant.position(), targetId: plant.attackableId };
      this.currentPlantId = null;
      if (this.blockingWallId && !this.w.plantById(this.blockingWallId)?.isAlive()) this.blockingWallId = null;
      this.state = 'CHASE';
    }
    return { pos: this.w.player.position(), targetId: 'player' };
  }

  private act(dt: number): void {
    this.charging = false;
    this.w.openDoorsNear(this.pos, 1.6);
    switch (this.state) {
      case 'AMBUSH':
      case 'ALERT':
      case 'HIT_REACT':
      case 'RAGE':
        this.move(dt, null, 0);
        return;
      case 'IDLE':
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) this.state = 'WANDER';
        this.move(dt, null, 0);
        return;
      case 'WANDER':
        this.wander(dt);
        return;
      default:
        this.engage(dt);
    }
  }

  private wander(dt: number): void {
    if (this.patrol && this.patrol.length > 0) {
      const wp = this.patrol[this.patrolIndex % this.patrol.length]!;
      if (distXZ(this.pos, wp) < 1.5) this.patrolIndex++;
      this.navigateTo(dt, wp, abilityMoveSpeed(this.def, this.abilities, 'wander'));
      return;
    }
    if (!this.wanderTarget) {
      const r = this.def.wanderRadius;
      const inside = buildingAt(this.w.layout, this.anchor);
      const candidates = this.w.nav.nodes.filter((n) =>
        Math.hypot(n.x - this.anchor.x, n.z - this.anchor.z) <= r && (inside ? n.tag === `in:${inside.id}` : n.tag === 'outdoor'));
      const pick = candidates.length > 0 ? this.w.rng.pick(candidates) : null;
      this.wanderTarget = pick ? { x: pick.x, y: pick.y, z: pick.z } : { ...this.anchor };
      this.repathTimer = 0;
    }
    if (distXZ(this.pos, this.wanderTarget) < 1.2) {
      this.wanderTarget = null;
      this.state = 'IDLE';
      this.stateTimer = this.w.rng.range(1, 3);
      return;
    }
    this.navigateTo(dt, this.wanderTarget, abilityMoveSpeed(this.def, this.abilities, 'wander'));
  }

  private engage(dt: number): void {
    const goal = this.currentGoal();
    if (!goal) return;
    const d = distXZ(this.pos, goal.pos);
    const dy = Math.abs(goal.pos.y - this.pos.y);
    const plant = this.currentPlantId ? this.w.plantById(this.currentPlantId) : undefined;
    const reach = this.def.attackRange + (plant ? 0.6 : 0);
    if (this.tryStartVault()) return;
    if (this.state === 'ATTACK' || (d <= reach && dy < 1.6)) {
      this.attack(dt, goal, d <= reach + 0.4 && dy < 1.6);
      return;
    }
    this.charging = this.state === 'CHASE' && isCharging(this.def, 'chase', d);
    this.navigateTo(dt, goal.pos, abilityMoveSpeed(this.def, this.abilities, 'chase', d));
    this.trackReachability(dt, d, dy);
  }

  /** Pole vaulter: the first plant within reach ahead while chasing triggers the one-time vault. */
  private tryStartVault(): boolean {
    if ((this.state !== 'CHASE' && this.state !== 'BREAK') || this.abilities.vault?.phase !== 'carrying' || this.rootTimer > 0) return false;
    const plants = this.w.targetPlants(this.attackableId);
    const target = findVaultTarget(this.abilities, this.def.abilities, this.pos, this.yaw, plants);
    if (!target || !startVault(this.abilities, this.def.abilities, this.pos, target)) return false;
    const to = this.abilities.vault!.to!;
    this.yaw = yawTo(this.pos, to);
    this.blockingWallId = null;
    if (this.currentPlantId === target.id) this.currentPlantId = null;
    this.state = 'VAULT';
    this.path = [];
    this.pathEdges = [];
    return true;
  }

  /** Moves a vaulting zombie along its arc (kinematic, ignores plant colliders). True while vaulting. */
  private vaultMotion(dt: number): boolean {
    const step = stepVault(this.abilities, this.def.abilities, dt);
    if (!step) return false;
    const next = { x: step.pos.x, y: step.pos.y + this.def.colliderHeight / 2, z: step.pos.z };
    this.body.setNextKinematicTranslation(next);
    this.body.setTranslation(next, false);
    this.moveSpeed = dt > 0 ? distXZ(this.pos, step.pos) / dt : 0;
    this.prevPos = this.pos;
    this.pos = { ...step.pos };
    this.vaultProgress = step.landed ? 0 : step.progress;
    if (step.landed) {
      if (this.state === 'VAULT') this.state = 'CHASE';
      this.vy = 0;
      this.repathTimer = 0;
      this.stuckRef = { ...this.pos };
      this.decisionTimer = 0;
    }
    return true;
  }

  private trackReachability(dt: number, d: number, dy: number): void {
    if (this.currentPlantId) return;
    const stalled = this.path.length > 0 && this.pathIndex >= this.path.length - 1 && (d > this.def.attackRange + 0.5 || dy > 1.6);
    this.unreachableTimer = stalled ? this.unreachableTimer + dt : Math.max(0, this.unreachableTimer - dt);
    this.playerReachable = this.unreachableTimer < 2;
  }

  private attack(dt: number, goal: { pos: Vec3Like; targetId: string }, inRange: boolean): void {
    this.state = 'ATTACK';
    this.yaw += angleDiff(this.yaw, yawTo(this.pos, goal.pos)) * Math.min(1, dt * 8);
    this.move(dt, null, 0);
    if (this.windup < 0 && this.attackCooldown <= 0) {
      if (!inRange) {
        this.state = 'CHASE';
        return;
      }
      this.windup = this.def.attackWindup;
      this.attackTargetId = goal.targetId;
    }
    if (this.windup >= 0) {
      this.windup -= dt;
      if (this.windup < 0) {
        this.sinceStrike = 0;
        this.strike(goal, inRange);
        this.attackCooldown = this.def.attackInterval;
        this.stateTimer = this.def.attackRecover;
      }
      return;
    }
    this.stateTimer -= dt;
    if (this.stateTimer <= 0 && !inRange) this.state = this.currentPlantId && this.blockingWallId === this.currentPlantId ? 'BREAK' : 'CHASE';
  }

  private strike(goal: { pos: Vec3Like; targetId: string }, inRange: boolean): void {
    if (!inRange) return;
    store.events.emit('zombieAttack', { pos: this.pos });
    if (goal.targetId === 'player') {
      this.w.commands.dispatch({ type: 'damage', target: this.w.player, amount: this.def.attackDamage, info: { source: 'zombie', from: this.pos } });
      return;
    }
    const plant = this.w.plantById(goal.targetId);
    if (!plant) return;
    const dmg = this.def.attackDamageVsPlant[plant.type] ?? this.def.attackDamageVsPlant.default ?? this.def.attackDamage;
    const res = this.w.commands.dispatch({ type: 'damage', target: plant, amount: dmg, info: { source: 'zombie', from: this.pos } });
    if (res.killed) {
      if (this.blockingWallId === plant.attackableId) this.blockingWallId = null;
      this.currentPlantId = null;
      this.state = 'CHASE';
      this.repathTimer = 0;
    }
  }

  private nodeFor(pos: Vec3Like): number {
    const inside = buildingAt(this.w.layout, pos);
    const tagOk = (tag: string | null): boolean => (inside ? tag === `in:${inside.id}` : tag === 'outdoor' || tag === 'door');
    return this.w.nav.nearestNode(pos, (n) => tagOk(n.tag));
  }

  private navigateTo(dt: number, target: Vec3Like, speed: number): void {
    const direct = distXZ(this.pos, target) < 18 && Math.abs(target.y - this.pos.y) < 1 &&
      this.w.hasLOS({ x: this.pos.x, y: this.pos.y + 0.9, z: this.pos.z }, { x: target.x, y: target.y + 0.9, z: target.z });
    let aim = target;
    if (!direct) {
      this.repathTimer -= dt;
      if (this.repathTimer <= 0 || this.path.length === 0) this.repath(target);
      const node = this.path[this.pathIndex];
      if (node !== undefined) {
        const n = this.w.nav.nodes[node]!;
        aim = { x: n.x, y: n.y, z: n.z };
        if (Math.hypot(n.x - this.pos.x, n.z - this.pos.z) < 1.0 && Math.abs(n.y - this.pos.y) < 1.2) this.pathIndex = Math.min(this.path.length - 1, this.pathIndex + 1);
        this.checkWallOnPath();
      }
    } else {
      this.path = [];
      this.pathEdges = [];
    }
    this.move(dt, aim, speed);
    this.checkStuck(dt);
  }

  private repath(target: Vec3Like): void {
    this.repathTimer = 1.0 + this.w.rng.range(0, 0.3);
    const start = this.nodeFor(this.pos);
    const goal = this.nodeFor(target);
    const res = findPath(this.w.nav, start, goal, true);
    if (!res) {
      this.path = [];
      this.pathEdges = [];
      if (this.state === 'CHASE' && !this.currentPlantId) this.playerReachable = false;
      return;
    }
    this.path = res.nodes;
    this.pathEdges = res.edges;
    this.pathIndex = this.path.length > 1 ? 1 : 0;
  }

  /** When the cheapest path goes through a nut wall and we are next to it, break it (TR-NAV-04, FR-AGG-03). */
  private checkWallOnPath(): void {
    for (let i = Math.max(0, this.pathIndex - 1); i < Math.min(this.pathEdges.length, this.pathIndex + 1); i++) {
      const edge = this.w.nav.edges[this.pathEdges[i]!];
      if (!edge || edge.blockers.size === 0) continue;
      for (const wallId of edge.blockers.keys()) {
        const wall = this.w.plantById(wallId);
        if (wall && wall.isAlive() && distXZ(this.pos, wall.position()) < 2.6) {
          this.blockingWallId = wallId;
          this.decisionTimer = 0;
          return;
        }
      }
    }
  }

  private checkStuck(dt: number): void {
    this.stuckTimer += dt;
    if (this.stuckTimer < this.def.stuckSeconds) return;
    const moved = distXZ(this.pos, this.stuckRef);
    this.stuckTimer = 0;
    this.stuckRef = { ...this.pos };
    if (moved > 0.25 || this.rootTimer > 0) return;
    const wall = this.w.nutWallNear(this.pos, 1.8);
    if (wall && this.hasAggro) {
      this.blockingWallId = wall;
      this.decisionTimer = 0;
      return;
    }
    // Not a wall: nudge sideways and force a repath (no jittering against walls, FR-AI-06).
    this.yaw += this.w.rng.range(-1.2, 1.2);
    this.repathTimer = 0;
  }

  private move(dt: number, aim: Vec3Like | null, speed: number): void {
    let vx = 0;
    let vz = 0;
    const slow = this.slowTimer > 0 ? 1 - this.slowPercent / 100 : 1;
    const effective = this.rootTimer > 0 ? 0 : speed * this.speedFactor * slow * (this.state === 'HIT_REACT' ? 0.2 : 1);
    if (aim && effective > 0) {
      const dx = aim.x - this.pos.x;
      const dz = aim.z - this.pos.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.05) {
        vx = (dx / len) * effective;
        vz = (dz / len) * effective;
        this.yaw += angleDiff(this.yaw, Math.atan2(-dx, -dz)) * Math.min(1, dt * 8);
      }
    }
    // Separation keeps zombies from stacking (FR-AI-07).
    for (const o of this.w.neighbors(this)) {
      const dx = this.pos.x - o.pos.x;
      const dz = this.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.001 && d < this.def.separationRadius) {
        const push = ((this.def.separationRadius - d) / this.def.separationRadius) * this.def.separationStrength;
        vx += (dx / d) * push;
        vz += (dz / d) * push;
      }
    }
    this.moveSpeed = Math.hypot(vx, vz);
    this.walkPhase += dt * this.moveSpeed * 3.2;
    this.vy = Math.max(-20, this.vy + store.config.game.movement.gravity * dt);
    this.w.controller.computeColliderMovement(this.collider, { x: vx * dt, y: this.vy * dt, z: vz * dt }, this.w.phys.R.QueryFilterFlags.EXCLUDE_SENSORS);
    const m = this.w.controller.computedMovement();
    if (this.w.controller.computedGrounded()) this.vy = 0;
    const t = this.body.translation();
    const next = { x: t.x + m.x, y: t.y + m.y, z: t.z + m.z };
    this.body.setNextKinematicTranslation(next);
    this.body.setTranslation(next, false);
    this.prevPos = this.pos;
    this.pos = { x: next.x, y: next.y - this.def.colliderHeight / 2, z: next.z };
    if (this.pos.y < store.config.game.movement.fallRescueY) this.teleportHome();
  }

  private teleportHome(): void {
    const a = this.anchor;
    this.body.setTranslation({ x: a.x, y: a.y + this.def.colliderHeight / 2 + 0.2, z: a.z }, true);
    this.pos = { ...a };
    this.prevPos = { ...a };
    this.vy = 0;
  }

  dispose(): void {
    this.w.phys.removeBody(this.body);
  }
}
