// 豌豆枪: hitscan with spread, ADS, recoil, finite ammo and team filtering (FR-WPN-01..17, TR-HIT-01..05).
import * as THREE from 'three';
import type { GunDef } from '../config/types';
import type { CommandBus } from '../core/commands';
import type { Vec3Like } from '../core/events';
import type { Rng } from '../core/rng';
import { store } from '../core/store';
import { cancelReload, createAmmo, reserveEmpty, startReload, tickReload, tryFire, type AmmoState } from '../logic/ammo';
import type { IAttackable } from '../logic/attackable';
import { computeGunDamage, zoneMultiplier } from '../logic/damage';
import { classifyHitZone, type HitZoneDef } from '../logic/hitzone';
import { DEG } from '../logic/math';
import { potionDamageMultiplier, potionSlow, type PotionState } from '../logic/potions';
import { createSpread, currentSpreadDeg, onShot, tickSpread, type SpreadState } from '../logic/spread';
import type { Input } from '../game/input';
import { castRay } from '../physics/raycast';
import type { PhysicsWorld } from '../physics/world';
import type { Decals } from '../render/decals';
import type { Particles } from '../render/particles';
import type { Player } from './player';

/** Anything the gun can damage with body-part detection (zombies, training dummy). */
export interface ShootTarget extends IAttackable {
  localHit(point: Vec3Like): { localY: number; lateral: number };
  hitZoneDef(): HitZoneDef;
  ignoresRays(): boolean;
  /** Revision 2: whether the last applied hit landed on metal / soft armour (impact sound + sparks). */
  lastArmorHit?(): 'metal' | 'soft' | null;
}

export interface WeaponDeps {
  phys: PhysicsWorld;
  player: Player;
  rng: Rng;
  particles: Particles;
  decals: Decals;
  commands: CommandBus;
  potions: PotionState;
  upgrades: { damageBonus: number };
  resolveTarget(entityId: string): ShootTarget | undefined;
  onGunshot(pos: Vec3Like): void;
}

export class PeaGun {
  readonly ammo: AmmoState;
  readonly spread: SpreadState = createSpread();
  private cooldown = 0;
  lastSpreadDeg = 0;

  constructor(private readonly deps: WeaponDeps, mag: number, reserve: number) {
    const g = this.gun;
    this.ammo = createAmmo(g.magazineSize, g.reserveAmmoMax, reserve, mag);
  }

  get gun(): GunDef {
    return store.config.weapons.pea_gun;
  }

  interruptReload(): void {
    cancelReload(this.ammo);
  }

  /** @param active  false while an item is held, the shop is open, or the player is busy/dead. */
  update(dt: number, input: Input, active: boolean): void {
    const g = this.gun;
    const p = this.deps.player;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (p.sprinting || !active) this.interruptReload();
    if (tickReload(this.ammo, dt)) store.events.emit('reloadDone', {});
    const give = tickSpread(this.spread, dt, g, 60 / g.rpm + dt);
    if (give > 0) p.addRecoil(-give, 0);
    p.ads = active && input.isMouseDown(2) && !this.ammo.reloading && !p.sprinting;
    p.fovTarget = p.ads ? g.adsFov : g.hipFov;
    this.lastSpreadDeg = currentSpreadDeg(this.spread, g, { moving: p.moving, airborne: !p.grounded, ads: p.ads });
    if (!active) return;
    if (input.wasPressed('KeyR')) this.reload();
    if (input.isMouseDown(0) && this.cooldown <= 0) this.trigger(input.wasMousePressed(0));
  }

  reload(): void {
    const r = startReload(this.ammo, this.gun.reloadTime);
    if (r === 'started') store.events.emit('reloadStart', {});
    else if (r === 'no_reserve') store.events.emit('ammoDepleted', {});
  }

  private trigger(freshPress: boolean): void {
    const result = tryFire(this.ammo);
    if (result === 'fired') {
      this.cooldown = 60 / this.gun.rpm;
      this.shoot();
      if (this.ammo.mag === 0 && !reserveEmpty(this.ammo)) store.events.emit('banner', { text: '弹匣已空 · 按 R 换弹', kind: 'warn' });
      return;
    }
    if (!freshPress) return;
    this.cooldown = 0.2;
    if (result === 'empty_mag') {
      store.events.emit('dryFire', { reserveEmpty: false });
      store.events.emit('banner', { text: '弹匣已空 · 按 R 换弹', kind: 'warn' });
    } else if (result === 'no_ammo') {
      store.events.emit('dryFire', { reserveEmpty: true });
      store.events.emit('ammoDepleted', {});
    }
  }

  private shoot(): void {
    const { player, rng } = this.deps;
    const g = this.gun;
    const origin = player.camera.position.clone();
    const dir = player.forward();
    // Random deviation inside the current spread cone (horizontal + vertical, 7.3.3 step 1).
    const s = this.lastSpreadDeg * DEG;
    const euler = new THREE.Euler(rng.range(-s, s), rng.range(-s, s), 0, 'YXZ');
    dir.applyQuaternion(new THREE.Quaternion().setFromEuler(euler)).normalize();
    const kick = onShot(this.spread, g, rng);
    player.addRecoil(kick.pitchDeg, kick.yawDeg);
    const ice = potionSlow(this.deps.potions);
    store.events.emit('weaponFired', { pos: origin, ice: ice !== null });
    this.deps.onGunshot(player.position());
    const muzzle = origin.clone().addScaledVector(dir, 0.8);
    this.deps.particles.emit(ice ? 'frost' : 'muzzle', muzzle, 0.5);
    const hit = castRay(this.deps.phys, origin, dir, g.range * 2, {
      exclude: player.collider,
      skip: (tag) => tag.team === 'zombie' && tag.entityId !== null && (this.deps.resolveTarget(tag.entityId)?.ignoresRays() ?? false),
    });
    if (!hit) return;
    if (hit.tag.team === 'zombie' && hit.tag.entityId) {
      const target = this.deps.resolveTarget(hit.tag.entityId);
      if (target) this.hitZombie(target, hit.point, hit.distance, ice);
      return;
    }
    if (hit.tag.team === 'plant') {
      // Own plants are never damaged but they do stop the ray (TR-HIT-05, FR-WPN-13).
      this.deps.particles.emit('soft', hit.point);
      store.events.emit('zombieHit', { pos: hit.point, zone: 'torso', damage: 0, ice: false });
      return;
    }
    if (hit.tag.team === 'world' || hit.tag.team === 'door') {
      this.deps.decals.add(hit.point, hit.normal);
      this.deps.particles.emit('dust', hit.point);
      worldHitSound(hit.tag.material, hit.point);
    }
  }

  private hitZombie(target: ShootTarget, point: Vec3Like, distance: number, ice: { percent: number; duration: number } | null): void {
    const local = target.localHit(point);
    const zone = classifyHitZone(local.localY, local.lateral, target.hitZoneDef());
    const dmg = computeGunDamage({
      gun: this.gun,
      zone,
      distance,
      potionMultiplier: potionDamageMultiplier(this.deps.potions),
      permanentBonus: this.deps.upgrades.damageBonus,
    });
    const res = this.deps.commands.dispatch({
      type: 'damage', target, amount: dmg,
      info: { source: 'gun', zone, zoneMultiplier: zoneMultiplier(zone, this.gun), from: this.deps.player.position(), slow: ice },
    });
    const armor = target.lastArmorHit?.() ?? null;
    this.deps.particles.emit(armor === 'metal' ? 'dust' : ice ? 'frost' : 'pea_juice', point);
    store.events.emit('zombieHit', { pos: point, zone, damage: res.applied, ice: ice !== null, armor });
    store.events.emit('hitMarker', { kill: res.killed });
  }
}

/** Material-dependent impact feedback (FR-WPN-12). */
function worldHitSound(material: string, pos: Vec3Like): void {
  store.events.emit('worldHit', { pos, material });
}
