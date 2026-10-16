// First-person player: Rapier character controller movement, camera, health / death / respawn (FR-MOV, FR-HP).
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { CharacterDef, GameConfig } from '../config/types';
import type { Vec3Like } from '../core/events';
import { store } from '../core/store';
import { applyHealthDamage, type DamageInfo, type DamageResult, type IAttackable } from '../logic/attackable';
import { incomingDamage } from '../logic/damage';
import type { Input } from '../game/input';
import type { PhysicsWorld } from '../physics/world';

const UP_LIMIT = Math.PI / 2 - 0.01;

export class Player implements IAttackable {
  readonly attackableId = 'player';
  readonly team = 'player' as const;
  readonly camera: THREE.PerspectiveCamera;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  yaw = 0;
  pitch = 0;
  health: number;
  maxHealth: number;
  velocity = new THREE.Vector3();
  grounded = false;
  crouching = false;
  sprinting = false;
  moving = false;
  ads = false;
  dead = false;
  deathTimer = 0;
  invulnerableTimer = 0;
  sinceHurt = 999;
  /** While > 0 the player can't fire or plant (medkit / planting / shovel animations). */
  busyTimer = 0;
  speedMultiplier = 1;
  private prevPos = new THREE.Vector3();
  private currPos = new THREE.Vector3();
  private bobPhase = 0;
  private landingOffset = 0;
  private eyeHeight: number;
  fovTarget: number;

  constructor(
    private readonly phys: PhysicsWorld,
    private readonly character: CharacterDef,
    spawn: Vec3Like,
    aspect: number,
  ) {
    const m = store.config.game.movement;
    this.camera = new THREE.PerspectiveCamera(90, aspect, 0.05, 600);
    this.camera.rotation.order = 'YXZ';
    this.fovTarget = 90;
    const halfHeight = m.capsuleHeight / 2 - m.capsuleRadius;
    const center = { x: spawn.x, y: spawn.y + m.capsuleHeight / 2, z: spawn.z };
    const { body, collider } = phys.addKinematicCapsule(center, halfHeight, m.capsuleRadius, { team: 'player', entityId: 'player', material: 'flesh' });
    this.body = body;
    this.collider = collider;
    this.controller = phys.createCharacterController(m.stepHeight, m.maxClimbSlopeDeg);
    this.maxHealth = character.maxHealth;
    this.health = character.maxHealth;
    this.eyeHeight = m.standEyeHeight;
    this.currPos.set(center.x, center.y, center.z);
    this.prevPos.copy(this.currPos);
  }

  get movement(): GameConfig['movement'] {
    return store.config.game.movement;
  }

  /** Feet position (logic). */
  position(): Vec3Like {
    const t = this.body.translation();
    return { x: t.x, y: t.y - this.movement.capsuleHeight / 2, z: t.z };
  }

  eyePosition(): THREE.Vector3 {
    const p = this.position();
    return new THREE.Vector3(p.x, p.y + this.eyeHeight, p.z);
  }

  forward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  isAlive(): boolean {
    return !this.dead;
  }

  isInvulnerable(): boolean {
    return this.invulnerableTimer > 0 || this.dead;
  }

  isLowHealth(): boolean {
    return !this.dead && this.health < store.config.game.health.lowHealthThreshold;
  }

  applyDamage(amount: number, info: DamageInfo): DamageResult {
    const scaled = incomingDamage(amount, this.character.damageMultiplier, this.isInvulnerable());
    const state = { health: this.health };
    const res = applyHealthDamage(state, scaled);
    this.health = state.health;
    if (res.applied > 0) {
      this.sinceHurt = 0;
      store.events.emit('playerHurt', { amount: res.applied, from: info.from ?? null });
    }
    if (res.killed) this.die();
    return res;
  }

  heal(amount: number): void {
    if (this.dead) return;
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  private die(): void {
    this.dead = true;
    this.deathTimer = store.config.game.health.respawnDelay;
    this.velocity.set(0, 0, 0);
    this.ads = false;
    store.events.emit('playerDied', {});
  }

  respawnAt(pos: Vec3Like): void {
    this.teleport(pos);
    this.dead = false;
    this.health = this.maxHealth;
    this.invulnerableTimer = store.config.game.health.invulnerableAfterRespawn;
    store.events.emit('playerRespawned', {});
  }

  teleport(pos: Vec3Like): void {
    const y = pos.y + this.movement.capsuleHeight / 2;
    this.body.setTranslation({ x: pos.x, y, z: pos.z }, true);
    this.body.setNextKinematicTranslation({ x: pos.x, y, z: pos.z });
    this.velocity.set(0, 0, 0);
    this.currPos.set(pos.x, y, pos.z);
    this.prevPos.copy(this.currPos);
  }

  look(dx: number, dy: number): void {
    if (this.dead) return;
    const s = store.settings;
    const k = 0.0022 * s.sensitivity * (this.ads ? 0.6 : 1);
    this.yaw -= dx * k;
    this.pitch -= dy * k * (s.invertY ? -1 : 1);
    this.pitch = Math.max(-UP_LIMIT, Math.min(UP_LIMIT, this.pitch));
  }

  addRecoil(pitchDeg: number, yawDeg: number): void {
    this.pitch = Math.min(UP_LIMIT, this.pitch + (pitchDeg * Math.PI) / 180);
    this.yaw += (yawDeg * Math.PI) / 180;
  }

  /** Fixed-step update. Returns true when the player respawn timer elapsed (caller picks the spawn). */
  update(dt: number, input: Input): boolean {
    const hp = store.config.game.health;
    this.invulnerableTimer = Math.max(0, this.invulnerableTimer - dt);
    this.busyTimer = Math.max(0, this.busyTimer - dt);
    this.sinceHurt += dt;
    if (this.dead) {
      this.deathTimer -= dt;
      this.integrate(dt, new THREE.Vector3(), false);
      return this.deathTimer <= 0;
    }
    if (this.sinceHurt > hp.regenDelay && this.health < this.maxHealth * hp.regenCapFraction) {
      this.health = Math.min(this.maxHealth * hp.regenCapFraction, this.health + hp.regenPerSecond * dt);
    }
    this.integrate(dt, this.wishDirection(input), input.wasPressed('Space'));
    return false;
  }

  private wishDirection(input: Input): THREE.Vector3 {
    const m = this.movement;
    const f = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    const r = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    this.crouching = input.isDown('ControlLeft') || input.isDown('ControlRight') || input.isDown('KeyC');
    this.sprinting = input.isDown('ShiftLeft') && f > 0 && !this.crouching && !this.ads;
    const wish = new THREE.Vector3(r, 0, -f);
    if (wish.lengthSq() > 0) wish.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    let speed = m.walkSpeed * this.character.moveSpeedMultiplier * this.speedMultiplier;
    if (this.sprinting) speed *= m.sprintMultiplier;
    if (this.crouching) speed *= m.crouchMultiplier;
    if (this.ads) speed *= store.config.weapons.pea_gun.adsMoveMultiplier;
    if (this.isLowHealth()) speed *= store.config.game.health.lowHealthMoveMultiplier;
    this.moving = wish.lengthSq() > 0;
    return wish.multiplyScalar(speed);
  }

  private integrate(dt: number, wish: THREE.Vector3, jump: boolean): void {
    const m = this.movement;
    if (this.grounded) {
      this.velocity.x = wish.x;
      this.velocity.z = wish.z;
      if (jump) this.velocity.y = m.jumpSpeed;
    } else {
      // Air control: correct only a fraction of the difference toward the wished velocity.
      const k = Math.min(1, m.airControl * dt * 10);
      this.velocity.x += (wish.x - this.velocity.x) * k;
      this.velocity.z += (wish.z - this.velocity.z) * k;
    }
    this.velocity.y += m.gravity * dt;
    const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    this.controller.computeColliderMovement(this.collider, desired, this.phys.R.QueryFilterFlags.EXCLUDE_SENSORS);
    const moved = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.velocity.y < 0) {
      if (!wasGrounded && this.velocity.y < -4) this.landingOffset = -Math.min(0.25, -this.velocity.y * m.landingImpactScale);
      this.velocity.y = 0;
    }
    if (desired.y > 0 && moved.y < desired.y * 0.5) this.velocity.y = 0; // bumped into a ceiling
    const t = this.body.translation();
    const next = { x: t.x + moved.x, y: t.y + moved.y, z: t.z + moved.z };
    this.body.setNextKinematicTranslation(next);
    this.body.setTranslation(next, false);
    this.prevPos.copy(this.currPos);
    this.currPos.set(next.x, next.y, next.z);
    const eyeTarget = this.crouching ? m.crouchEyeHeight : m.standEyeHeight;
    this.eyeHeight += (eyeTarget - this.eyeHeight) * Math.min(1, dt * 12);
    const horizontal = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && horizontal > 0.5) this.bobPhase += dt * m.bobFrequency * (horizontal / m.walkSpeed) * Math.PI * 2;
    this.landingOffset *= Math.max(0, 1 - dt * 8);
  }

  /** True when below the kill plane (FR-MOV-06 fallback teleport). */
  isOutOfWorld(): boolean {
    return this.position().y < this.movement.fallRescueY;
  }

  /** Render-time camera placement with interpolation, bobbing, landing kick and death tilt. */
  updateCamera(alpha: number, frameDt: number): void {
    const m = this.movement;
    const p = new THREE.Vector3().lerpVectors(this.prevPos, this.currPos, alpha);
    const feetY = p.y - m.capsuleHeight / 2;
    const bob = store.settings.headBob && this.grounded ? Math.sin(this.bobPhase) * m.bobAmplitude : 0;
    const bobX = store.settings.headBob && this.grounded ? Math.cos(this.bobPhase * 0.5) * m.bobAmplitude * 0.5 : 0;
    const deathDrop = this.dead ? Math.min(1, (store.config.game.health.respawnDelay - this.deathTimer) * 2) : 0;
    this.camera.position.set(p.x, feetY + this.eyeHeight + bob + this.landingOffset - deathDrop * (this.eyeHeight - 0.3), p.z);
    this.camera.rotation.set(this.pitch, this.yaw, deathDrop * 1.2);
    if (bobX !== 0) this.camera.translateX(bobX);
    const fov = this.camera.fov + (this.fovTarget - this.camera.fov) * Math.min(1, frameDt * 14);
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
