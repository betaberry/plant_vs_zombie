// One play session: wires player, weapon, zombies, plants, economy, shop, director, pickups and saving
// together through the CommandBus (AR-01). UI and audio only observe it.
import * as THREE from 'three';
import type { CharacterDef, ShopItem } from '../config/types';
import { CommandBus } from '../core/commands';
import type { Vec3Like } from '../core/events';
import { createRng, type Rng } from '../core/rng';
import { store } from '../core/store';
import { reserveEmpty } from '../logic/ammo';
import { addSun, createTicker, createWallet, displaySun, killReward, passiveRate, tickInterval, type SunWallet } from '../logic/economy';
import { addItem, cancelSelection, consumeOne, countOf, createInventory, cycleSlot, heldItem, selectSlot, toggleShovel, type Inventory } from '../logic/inventory';
import { distXZ, pointInPolygon } from '../logic/math';
import { canPlantAt, type PlantCheck } from '../logic/planting';
import { createPotionState, drinkPotion, tickPotion, type PotionState } from '../logic/potions';
import { writeSave, type SaveData, type StorageLike } from '../logic/save';
import { purchase, type PurchaseResult, type ShopContext } from '../logic/shop';
import { createDirectorState, stepDirector, type DirectorState } from '../logic/spawnDirector';
import type { NavGraph } from '../nav/graph';
import { castRay, hasLineOfSight, probeGround } from '../physics/raycast';
import type { PhysicsWorld } from '../physics/world';
import { Decals } from '../render/decals';
import { Particles } from '../render/particles';
import { PlantPreview } from '../render/plantPreview';
import type { GameRenderer } from '../render/renderer';
import { ViewModel } from '../render/viewModel';
import { S } from '../ui/strings.zh-CN';
import { buildingAt, districtAt, resolvePlace, type CityLayout } from '../world/layout';
import type { City } from '../world/cityBuilder';
import { TrainingDummy } from '../entities/dummy';
import { PickupManager } from '../entities/pickups';
import { PlantManager } from '../entities/plants';
import { Player } from '../entities/player';
import { PeaGun, type ShootTarget } from '../entities/weapon';
import { ZombieManager } from '../entities/zombieManager';
import type { Input } from './input';

export interface SessionDeps {
  renderer: GameRenderer;
  phys: PhysicsWorld;
  city: City;
  layout: CityLayout;
  nav: NavGraph;
  input: Input;
  storage: StorageLike;
  characterId: string;
  resume: SaveData | null;
}

export type PendingAction = { kind: 'heal'; amount: number; timer: number } | { kind: 'shovel'; plantId: string; timer: number } | null;

export interface PlantAim {
  type: string;
  pos: Vec3Like | null;
  check: PlantCheck;
}

const ITEM_COLORS: Record<string, string> = {
  ice_potion: '#4fc3f7', power_potion: '#ef5350', medkit: '#ffffff', sunflower_seed: '#fdd835', pea_shooter_seed: '#7cb342',
  nut_wall_seed: '#a1887f', bomb_flower_seed: '#e53935', vine_trap_seed: '#43a047', ice_shooter_seed: '#81d4fa',
};

export class Session {
  readonly rng: Rng;
  readonly commands = new CommandBus();
  readonly character: CharacterDef;
  readonly player: Player;
  readonly gun: PeaGun | null;
  readonly zombies: ZombieManager;
  readonly plants: PlantManager;
  readonly particles: Particles;
  readonly decals: Decals;
  readonly viewModel = new ViewModel();
  readonly preview: PlantPreview;
  readonly pickups: PickupManager;
  readonly dummy: TrainingDummy;
  readonly wallet: SunWallet;
  readonly inventory: Inventory;
  readonly potions: PotionState = createPotionState();
  readonly upgrades = { damageBonus: 0, sunBonus: 0 };
  readonly ownedEquipment = new Set<string>();
  private readonly director: DirectorState = createDirectorState();
  private readonly passiveTicker = createTicker();
  kills = 0;
  playTime = 0;
  stats = { deaths: 0, sunEarned: 0, plantsPlanted: 0 };
  life = { start: 0, kills: 0, sun: 0, planted: 0 };
  lastDeath = { survived: 0, kills: 0, sun: 0, planted: 0 };
  tutorialDone = false;
  shopOpen = false;
  pending: PendingAction = null;
  plantAim: PlantAim | null = null;
  shovelTarget: string | null = null;
  interactPrompt: string | null = null;
  private ammoBannerAt = -999;
  private runNoiseTimer = 0;
  private cellTimer = 0;
  private disposers: (() => void)[] = [];
  private firstZombieTipShown = false;
  /** Scene objects created by this session (removed on dispose so a new game starts clean). */
  private owned: THREE.Object3D[] = [];

  constructor(private readonly d: SessionDeps) {
    const cfg = store.config;
    const character = cfg.characters[d.characterId];
    if (!character) throw new Error(`unknown character ${d.characterId}`);
    this.character = character;
    this.rng = createRng((Date.now() & 0xffffffff) >>> 0);
    const scene = d.renderer.scene;
    const before = new Set(scene.children);
    this.particles = new Particles(scene, this.rng);
    this.decals = new Decals(scene);
    this.preview = new PlantPreview(scene);
    const spawn = d.resume ? this.pickSpawn() : resolvePlace(d.layout, { pos: cfg.map.playerSpawns[0]!.pos });
    this.player = new Player(d.phys, character, spawn, window.innerWidth / window.innerHeight);
    scene.add(this.player.camera);
    this.wallet = createWallet(character.startingSun, cfg.game.economy.sunCap);
    this.inventory = createInventory(cfg.game.inventory.hotbarSlots);
    const hasLOS = (a: Vec3Like, b: Vec3Like): boolean => hasLineOfSight(d.phys, a, b);
    this.zombies = new ZombieManager(scene, {
      phys: d.phys, nav: d.nav, layout: d.layout, rng: this.rng, commands: this.commands, player: this.player,
      targetPlants: (id) => this.plants.targetPlants(id),
      plantById: (id) => this.plants.byId(id),
      nutWallNear: (pos, r) => this.plants.nutWallNear(pos, r),
      openDoorsNear: (pos, r) => d.city.openDoorsNear(pos, r),
      hasLOS,
    });
    this.plants = new PlantManager({
      scene, phys: d.phys, nav: d.nav, commands: this.commands, zombies: this.zombies, particles: this.particles, hasLOS,
      onSun: (amount) => this.gainSun(amount, false),
    });
    this.gun = character.weapon ? new PeaGun({
      phys: d.phys, player: this.player, rng: this.rng, particles: this.particles, decals: this.decals, commands: this.commands,
      potions: this.potions, upgrades: this.upgrades,
      resolveTarget: (id) => this.resolveTarget(id),
      onGunshot: (pos) => this.zombies.noise('gunshot', pos),
    }, cfg.weapons.pea_gun.magazineSize, character.startingReserveAmmo) : null;
    this.dummy = new TrainingDummy(scene, d.phys, resolvePlace(d.layout, { pos: cfg.map.trainingDummy }));
    this.pickups = new PickupManager(scene, cfg.map.pickupPoints.map((def) => ({ def, pos: resolvePlace(d.layout, def) })), cfg.game.economy.sunPackLifetime);
    this.registerCommands();
    this.registerEvents();
    if (d.resume) this.applySave(d.resume);
    else for (const [id, n] of Object.entries(character.startingItems)) addItem(this.inventory, id, n, this.shopItem(id)?.maxCarry ?? null);
    this.spawnAmbushers();
    this.viewModel.show(this.gun ? 'gun' : 'hands');
    this.owned = scene.children.filter((c) => !before.has(c) && c !== this.player.camera);
  }

  // ---------- wiring ----------

  private shopItem(id: string): ShopItem | undefined {
    return store.config.shop.items.find((i) => i.id === id);
  }

  private resolveTarget(id: string): ShootTarget | undefined {
    return id === 'dummy' ? this.dummy : this.zombies.get(id);
  }

  private shopContext(): ShopContext {
    return {
      characterId: this.character.id, wallet: this.wallet, inventory: this.inventory, ammo: this.gun?.ammo ?? null,
      ownedEquipment: this.ownedEquipment, upgrades: this.upgrades, ammoPackRounds: store.config.weapons.ammo_pack.rounds,
    };
  }

  private registerCommands(): void {
    const c = this.commands;
    c.register('damage', (cmd) => cmd.target.applyDamage(cmd.amount, cmd.info));
    c.register('spawn', (cmd) => {
      const patrol = cmd.patrolRoute ? store.config.map.patrolRoutes.find((r) => r.id === cmd.patrolRoute)?.waypoints.map(([x, y, z]) => ({ x, y, z })) ?? null : null;
      return this.zombies.spawn(cmd.pos, { ambush: cmd.ambush, spawnerId: cmd.spawnerId, patrol }) !== null;
    });
    c.register('plant', (cmd) => {
      const def = store.config.plants.plants[cmd.plantType];
      if (!def) return { ok: false, reason: 'not_allowed' };
      if (!consumeOne(this.inventory, def.seedItemId)) return { ok: false, reason: 'no_seed' };
      this.plants.place(cmd.plantType, cmd.pos, cmd.yaw);
      this.stats.plantsPlanted++;
      this.life.planted++;
      store.events.emit('plantPlaced', { type: cmd.plantType, pos: cmd.pos });
      this.save();
      return { ok: true };
    });
    c.register('shovel', (cmd) => this.plants.shovel(cmd.plantId));
    c.register('pickup', (cmd) => this.takePickup(cmd.pickupId));
    c.register('purchase', (cmd) => {
      const res: PurchaseResult = purchase(store.config.shop, this.shopContext(), cmd.itemId);
      if (res.ok) {
        store.events.emit('sunChanged', { sun: displaySun(this.wallet), delta: -res.item.price, capped: false });
        store.events.emit('floatText', { text: `-${res.item.price}`, kind: 'spend' });
        if (res.discarded > 0) store.events.emit('banner', { text: S.bannerReserveFull, kind: 'info' });
        this.save();
      }
      store.events.emit('purchase', { itemId: cmd.itemId, ok: res.ok, reason: res.ok ? undefined : res.reason });
      return res.ok ? { ok: true } : { ok: false, reason: res.reason };
    });
    c.register('useItem', (cmd) => this.useItem(cmd.itemId));
  }

  private registerEvents(): void {
    const ev = store.events;
    this.disposers.push(
      ev.on('zombieKilled', (e) => {
        const eco = store.config.game.economy;
        this.kills++;
        this.life.kills++;
        this.gainSun(killReward(eco.killReward, eco.headshotBonus, e.headshot), true);
        this.particles.emit('sun', { x: e.pos.x, y: e.pos.y + 1, z: e.pos.z });
        if (e.headshot) ev.emit('banner', { text: S.bannerHeadshot, kind: 'info' });
      }),
      ev.on('playerDied', () => {
        this.stats.deaths++;
        this.lastDeath = { survived: this.playTime - this.life.start, kills: this.life.kills, sun: Math.round(this.life.sun), planted: this.life.planted };
        this.pending = null;
        this.gun?.interruptReload();
        this.save();
      }),
      ev.on('playerHurt', () => this.zombies.noise('playerHurt', this.player.position())),
      ev.on('ammoDepleted', () => this.ammoBanner()),
    );
  }

  private ammoBanner(): void {
    if (this.playTime - this.ammoBannerAt < store.config.game.ui.ammoBannerCooldown) return;
    this.ammoBannerAt = this.playTime;
    store.events.emit('banner', { text: S.bannerAmmoOut, kind: 'danger' });
  }

  private gainSun(amount: number, showFloat: boolean): void {
    const before = displaySun(this.wallet);
    const res = addSun(this.wallet, amount);
    this.stats.sunEarned += res.applied;
    this.life.sun += res.applied;
    const after = displaySun(this.wallet);
    if (after !== before || res.capped) store.events.emit('sunChanged', { sun: after, delta: after - before, capped: res.capped });
    if (showFloat && res.applied > 0) store.events.emit('floatText', { text: `+${Math.round(res.applied)}`, kind: 'gain' });
    if (res.capped && showFloat) store.events.emit('banner', { text: S.bannerSunFull, kind: 'info' });
  }

  private spawnAmbushers(): void {
    for (const a of store.config.map.ambushPoints) {
      const pos = resolvePlace(this.d.layout, a);
      for (let i = 0; i < a.count; i++) this.commands.dispatch({ type: 'spawn', spawnerId: null, pos, ambush: true });
    }
  }

  /** FR-HP-05: respawn at the spawn point with the fewest zombies nearby. */
  pickSpawn(): Vec3Like {
    const spawns = store.config.map.playerSpawns.map((s) => resolvePlace(this.d.layout, { pos: s.pos }));
    let best = spawns[0]!;
    let bestN = Infinity;
    for (const s of spawns) {
      const n = this.zombies ? this.zombies.zombies.filter((z) => z.isAlive() && distXZ(z.pos, s) < 30).length : 0;
      if (n < bestN) {
        bestN = n;
        best = s;
      }
    }
    return best;
  }

  // ---------- items ----------

  private useItem(itemId: string): boolean {
    const item = this.shopItem(itemId);
    if (!item || countOf(this.inventory, itemId) <= 0 || this.player.busyTimer > 0 || this.pending) return false;
    if (item.category === 'potion') {
      if (!this.gun) return false;
      consumeOne(this.inventory, itemId);
      const r = drinkPotion(this.potions, item);
      store.events.emit('potionDrunk', { id: itemId, replaced: r.replaced });
      if (r.replaced) store.events.emit('banner', { text: S.bannerPotionReplaced, kind: 'info' });
      this.viewModel.actionKick();
      return true;
    }
    if (item.effect?.type === 'heal') {
      if (this.player.health >= this.player.maxHealth) {
        store.events.emit('banner', { text: S.bannerHealthFull, kind: 'info' });
        return false;
      }
      consumeOne(this.inventory, itemId);
      this.pending = { kind: 'heal', amount: item.effect.amount, timer: item.effect.useTime };
      this.player.busyTimer = item.effect.useTime;
      this.gun?.interruptReload();
      store.events.emit('banner', { text: S.bannerHealing, kind: 'info' });
      return true;
    }
    return false;
  }

  private takePickup(id: string): boolean {
    const p = this.pickups.items.find((x) => x.id === id);
    if (!p) return false;
    const item = this.shopItem(p.item);
    if (!item) return false;
    if (addItem(this.inventory, item.id, 1, item.maxCarry).added === 0) {
      store.events.emit('banner', { text: S.bannerPickupFull(item.name), kind: 'warn' });
      return false;
    }
    this.pickups.take(id);
    store.events.emit('pickup', { item: item.id });
    store.events.emit('banner', { text: S.bannerPickedUp(item.name), kind: 'info' });
    return true;
  }

  // ---------- per-tick ----------

  update(dt: number): void {
    const input = this.d.input;
    const p = this.player;
    this.playTime += dt;
    const look = input.consumeMouse();
    p.look(look.dx, look.dy);
    this.handleKeys(input);
    if (p.update(dt, input)) this.respawn();
    if (p.isOutOfWorld()) p.teleport(this.pickSpawn());
    this.updatePending(dt);
    this.updateHeld(dt, input);
    const eco = store.config.game.economy;
    const rate = passiveRate(this.character.passiveSunPerSecond, this.upgrades.sunBonus);
    const passive = tickInterval(this.passiveTicker, dt, eco.passiveTickInterval, rate, p.isAlive());
    if (passive > 0) this.gainSun(passive, false);
    if (tickPotion(this.potions, dt)) store.events.emit('potionDrunk', { id: '', replaced: false });
    if (p.sprinting && p.grounded) {
      this.runNoiseTimer -= dt;
      if (this.runNoiseTimer <= 0) {
        this.runNoiseTimer = 0.5;
        this.zombies.noise('running', p.position());
        store.events.emit('footstep', { pos: p.position(), running: true });
      }
    }
    this.runDirector(dt);
    this.zombies.update(dt);
    this.plants.update(dt);
    this.dummy.update(dt);
    for (const s of this.pickups.update(dt, p.position(), eco.sunPackPickupRadius)) {
      this.gainSun(eco.sunPackAmount, true);
      store.events.emit('pickup', { item: s.item });
      store.events.emit('banner', { text: S.bannerSunPack(eco.sunPackAmount), kind: 'info' });
    }
    this.updateInteract(input);
    this.d.phys.step(dt);
    this.checkFirstZombie();
    input.endTick();
  }

  private handleKeys(input: Input): void {
    const inv = this.inventory;
    if (!this.player.isAlive() || this.shopOpen) return;
    for (let i = 0; i < 6; i++) {
      if (!input.wasPressed(`Digit${i + 1}`)) continue;
      const r = selectSlot(inv, i);
      if (r === 'empty') store.events.emit('banner', { text: S.bannerNoItem, kind: 'info' });
      else this.gun?.interruptReload();
    }
    const wheel = input.consumeWheel();
    if (wheel !== 0 && cycleSlot(inv, wheel > 0 ? 1 : -1) !== null) this.gun?.interruptReload();
    if (input.wasPressed('KeyX')) {
      toggleShovel(inv);
      this.gun?.interruptReload();
    }
    if (input.wasPressed('KeyQ') && countOf(inv, 'medkit') > 0) this.commands.dispatch({ type: 'useItem', itemId: 'medkit' });
    const held = heldItem(inv);
    if (input.wasMousePressed(2) && (held !== null || inv.shovel)) cancelSelection(inv);
  }

  /** Esc while planting / shoveling cancels instead of pausing (FR-PLT-08). */
  cancelHeld(): boolean {
    return cancelSelection(this.inventory);
  }

  private updatePending(dt: number): void {
    const a = this.pending;
    if (!a) return;
    a.timer -= dt;
    if (a.timer > 0) return;
    this.pending = null;
    if (a.kind === 'heal') this.player.heal(a.amount);
    else this.commands.dispatch({ type: 'shovel', plantId: a.plantId });
  }

  private updateHeld(dt: number, input: Input): void {
    const p = this.player;
    const inv = this.inventory;
    const held = heldItem(inv);
    const alive = p.isAlive();
    const canAct = alive && !this.shopOpen && p.busyTimer <= 0 && this.pending === null;
    this.preview.update(dt);
    this.plantAim = null;
    this.shovelTarget = null;
    const plantType = held ? Object.values(store.config.plants.plants).find((x) => x.seedItemId === held)?.id ?? null : null;
    if (inv.shovel) {
      this.viewModel.show('shovel');
      this.preview.hide();
      this.aimShovel();
      if (canAct && input.wasMousePressed(0) && this.shovelTarget) {
        const t = store.config.plants.plantingRules.shovelAnimationTime;
        this.pending = { kind: 'shovel', plantId: this.shovelTarget, timer: t };
        p.busyTimer = t;
        this.viewModel.actionKick();
      }
    } else if (plantType) {
      this.viewModel.show('item', ITEM_COLORS[held!] ?? '#ffffff');
      this.aimPlant(plantType, dt);
      if (canAct && input.wasMousePressed(0)) this.tryPlant();
    } else if (held) {
      this.preview.hide();
      this.viewModel.show('item', ITEM_COLORS[held] ?? '#ffffff');
      if (canAct && input.wasMousePressed(0)) this.commands.dispatch({ type: 'useItem', itemId: held });
    } else {
      this.preview.hide();
      this.viewModel.show(this.gun ? 'gun' : 'hands');
    }
    const gunActive = canAct && held === null && !inv.shovel;
    if (this.gun) this.gun.update(dt, input, gunActive);
    else p.fovTarget = 90;
    if (this.gun && reserveEmpty(this.gun.ammo) && this.gun.ammo.mag === 0 && alive) this.ammoBanner();
  }

  private aimPoint(maxDist: number): { point: Vec3Like; plantId: string | null } | null {
    const cam = this.player.camera.position;
    const hit = castRay(this.d.phys, cam, this.player.forward(), maxDist, {
      exclude: this.player.collider,
      skip: (tag) => tag.team === 'zombie' || tag.team === 'player',
    });
    if (!hit) return null;
    return { point: hit.point, plantId: hit.tag.team === 'plant' ? hit.tag.entityId : null };
  }

  private aimShovel(): void {
    const aim = this.aimPoint(6);
    if (!aim) return;
    this.shovelTarget = aim.plantId ?? this.plants.plantAt(aim.point)?.attackableId ?? null;
  }

  private aimPlant(type: string, dt: number): void {
    const cfg = store.config;
    const def = cfg.plants.plants[type]!;
    const aim = this.aimPoint(cfg.plants.plantingRules.maxPlacementDistance + 4);
    let pos: Vec3Like | null = null;
    let ground: { normalY: number } | null = null;
    if (aim) {
      const g = probeGround(this.d.phys, aim.point.x, aim.point.z, aim.point.y + 0.3, 1.2);
      if (g) {
        pos = g.point;
        ground = { normalY: g.normal.y };
      } else pos = aim.point;
    }
    const occupied = this.plants.occupancy();
    if (type !== 'bomb_flower') {
      for (const z of this.zombies.zombies) if (z.isAlive()) occupied.push({ pos: z.pos, radius: z.def.colliderRadius });
    }
    occupied.push({ pos: this.player.position(), radius: cfg.game.movement.capsuleRadius });
    const zones = { plantable: cfg.map.plantableZones, blocked: [...cfg.map.nonPlantableZones, ...this.d.layout.extraNoPlantZones] };
    const check: PlantCheck = pos
      ? canPlantAt(pos, { characterId: this.character.id, playerPos: this.player.position(), plant: def, rules: cfg.plants.plantingRules, aliveOfType: this.plants.countOf(type), ground, zones, occupied })
      : { ok: false, reason: 'no_ground' };
    this.plantAim = { type, pos, check };
    if (pos) this.preview.show(pos, check.ok, def.footprintRadius, this.player.yaw, type === 'nut_wall');
    else this.preview.hide();
    this.cellTimer -= dt;
    if (this.cellTimer <= 0) {
      this.cellTimer = 0.3;
      this.preview.setCells(this.plantableCells(zones));
    }
  }

  /** FR-MAP-15: highlight plantable ground cells within the placement radius. */
  private plantableCells(zones: { plantable: typeof store.config.map.plantableZones; blocked: typeof store.config.map.nonPlantableZones }): Vec3Like[] {
    const r = store.config.plants.plantingRules;
    const c = this.player.position();
    const out: Vec3Like[] = [];
    for (let dx = -r.maxPlacementDistance; dx <= r.maxPlacementDistance; dx += 1) {
      for (let dz = -r.maxPlacementDistance; dz <= r.maxPlacementDistance; dz += 1) {
        if (Math.hypot(dx, dz) > r.maxPlacementDistance) continue;
        const x = Math.round(c.x) + dx;
        const z = Math.round(c.z) + dz;
        const g = probeGround(this.d.phys, x, z, c.y + 1.2, 2.5);
        if (!g || Math.acos(Math.min(1, g.normal.y)) * (180 / Math.PI) > r.maxSlopeDeg) continue;
        const blocked = zones.blocked.some((zone) => pointInPolygon(x, z, zone.points));
        if (!blocked) out.push(g.point);
      }
    }
    return out;
  }

  private tryPlant(): void {
    const aim = this.plantAim;
    if (!aim) return;
    if (!aim.pos || !aim.check.ok) {
      this.preview.flashInvalid();
      const reason = aim.check.ok ? 'no_ground' : aim.check.reason;
      store.events.emit('plantRejected', { reason: this.rejectText(aim.type, reason, aim.check.ok ? undefined : aim.check.detail) });
      return;
    }
    const res = this.commands.dispatch({ type: 'plant', plantType: aim.type, pos: aim.pos, yaw: this.player.yaw });
    if (res.ok) {
      this.player.busyTimer = store.config.plants.plantingRules.plantAnimationTime;
      this.particles.emit('dirt', aim.pos);
      this.viewModel.actionKick();
    }
  }

  rejectText(type: string, reason: string, detail?: string): string {
    const name = store.config.plants.plants[type]?.displayName ?? '';
    if (reason === 'limit') return S.plantReject.limit(name);
    if (reason === 'zone' && detail) return S.zoneNames[detail] ?? S.plantReject.zone;
    return (S.plantReject as Record<string, string | ((n: string) => string)>)[reason] as string ?? S.plantReject.zone;
  }

  private updateInteract(input: Input): void {
    const p = this.player;
    this.interactPrompt = null;
    if (!p.isAlive()) return;
    const range = store.config.game.movement.interactRange;
    const pos = p.position();
    const crate = this.pickups.nearestCrate(pos, range);
    const door = this.d.city.nearestDoor(pos, range);
    if (crate) {
      const name = this.shopItem(crate.item)?.name ?? crate.item;
      this.interactPrompt = S.interactCrate(name);
      if (input.wasPressed('KeyF')) this.commands.dispatch({ type: 'pickup', pickupId: crate.id });
    } else if (door) {
      const open = this.d.city.isDoorOpen(door);
      this.interactPrompt = open ? S.interactDoorOpen : S.interactDoorClosed;
      if (input.wasPressed('KeyF')) this.d.city.setDoor(door, !open);
    }
  }

  private runDirector(dt: number): void {
    const cfg = store.config;
    const p = this.player;
    const pos = p.position();
    const cam = p.camera;
    cam.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const spawners = cfg.map.zombieSpawners.map((s) => {
      const sp = resolvePlace(this.d.layout, s);
      return { id: s.id, pos: sp, district: districtAt(cfg.map, sp) ?? '', maxAlive: s.maxAlive, respawnCooldown: s.respawnCooldown, activationRadius: s.activationRadius, alive: this.zombies.aliveFromSpawner(s.id) };
    });
    const ids = stepDirector(this.director, {
      playerPos: pos,
      playerDistrict: districtAt(cfg.map, pos),
      spawners,
      totalAlive: this.zombies.aliveCount,
      plantPositions: this.plants.positions(),
      isVisibleToPlayer: (sp) => {
        const head = new THREE.Vector3(sp.x, sp.y + 1.2, sp.z);
        return frustum.containsPoint(head) && hasLineOfSight(this.d.phys, cam.position, head);
      },
    }, cfg.game.spawnDirector, dt);
    for (const id of ids) {
      const def = cfg.map.zombieSpawners.find((s) => s.id === id)!;
      const spPos = spawners.find((s) => s.id === id)!.pos;
      this.commands.dispatch({ type: 'spawn', spawnerId: id, pos: spPos, ambush: def.mode === 'indoor', patrolRoute: def.patrolRoute });
    }
  }

  private checkFirstZombie(): void {
    if (this.firstZombieTipShown) return;
    if (this.zombies.zombies.some((z) => z.isAlive() && z.perceivedNow && distXZ(z.pos, this.player.position()) < 25)) {
      this.firstZombieTipShown = true;
      store.events.emit('banner', { text: this.gun ? S.tipGunnerZombie : S.tipSunflowerZombie, kind: 'info' });
    }
  }

  private respawn(): void {
    this.player.respawnAt(this.pickSpawn());
    this.life = { start: this.playTime, kills: 0, sun: 0, planted: 0 };
    store.events.emit('banner', { text: S.bannerRespawned, kind: 'info' });
  }

  /** Tutorial helper: one zombie ~20 m in front of the player, out of the 15 m no-spawn radius. */
  spawnTutorialZombie(): void {
    const p = this.player.position();
    const f = this.player.forward();
    const pos = { x: p.x + f.x * 22, y: p.y, z: p.z + f.z * 22 };
    const node = this.d.nav.nodes[this.d.nav.nearestNode(pos, (n) => n.tag === 'outdoor')];
    if (node) this.commands.dispatch({ type: 'spawn', spawnerId: null, pos: { x: node.x, y: node.y, z: node.z }, ambush: false });
  }

  isInsideBuilding(): boolean {
    return buildingAt(this.d.layout, this.player.position()) !== null;
  }

  // ---------- render ----------

  render(alpha: number, frameDt: number): void {
    const p = this.player;
    p.updateCamera(alpha, frameDt);
    this.d.renderer.followShadows(p.camera.position.x, p.camera.position.z);
    this.zombies.render(alpha, p.camera.position);
    this.plants.render();
    this.pickups.render();
    this.particles.scale = this.d.renderer.particleScale;
    this.particles.update(frameDt);
    this.viewModel.update(frameDt, {
      moving: p.moving, sprinting: p.sprinting, ads: p.ads, reloading: this.gun?.ammo.reloading ?? false,
      aspect: window.innerWidth / window.innerHeight,
    });
    this.d.renderer.render(p.camera);
    if (p.isAlive()) this.viewModel.render(this.d.renderer.renderer);
  }

  // ---------- save ----------

  private applySave(s: SaveData): void {
    this.wallet.sun = Math.min(this.wallet.cap, s.sun);
    for (const [id, n] of Object.entries(s.items)) addItem(this.inventory, id, n, this.shopItem(id)?.maxCarry ?? null);
    if (this.gun) {
      this.gun.ammo.mag = Math.min(this.gun.ammo.magSize, s.magAmmo);
      this.gun.ammo.reserve = Math.min(this.gun.ammo.reserveMax, s.reserveAmmo);
    }
    this.upgrades.damageBonus = s.upgrades.damageBonus;
    this.upgrades.sunBonus = s.upgrades.sunBonus;
    for (const e of s.ownedEquipment ?? []) this.ownedEquipment.add(e);
    for (const pl of s.plants) {
      if (store.config.plants.plants[pl.type]) this.plants.place(pl.type, { x: pl.pos[0], y: pl.pos[1], z: pl.pos[2] }, pl.yaw, pl.health);
    }
    this.kills = s.kills;
    this.playTime = s.playTimeSeconds;
    this.life.start = this.playTime;
    this.stats = { ...this.stats, ...s.stats };
    this.tutorialDone = s.tutorialDone;
  }

  buildSave(): SaveData {
    return {
      version: 1,
      characterId: this.character.id,
      sun: this.wallet.sun,
      items: { ...this.inventory.counts },
      magAmmo: this.gun?.ammo.mag ?? 0,
      reserveAmmo: this.gun?.ammo.reserve ?? 0,
      upgrades: { ...this.upgrades },
      ownedEquipment: [...this.ownedEquipment],
      plants: this.plants.serialize(),
      kills: this.kills,
      playTimeSeconds: this.playTime,
      stats: { ...this.stats },
      tutorialDone: this.tutorialDone,
      savedAt: Date.now(),
    };
  }

  save(): boolean {
    const res = writeSave(this.d.storage, this.buildSave());
    store.events.emit('saved', { ok: res.ok });
    if (!res.ok) store.events.emit('banner', { text: S.bannerSaveFailed, kind: 'danger' });
    return res.ok;
  }

  dispose(): void {
    this.disposers.forEach((f) => f());
    this.zombies.clear();
    this.plants.clear();
    this.d.phys.removeBody(this.player.body);
    this.d.phys.removeBody(this.dummy.body);
    for (const o of this.owned) o.removeFromParent();
    this.owned = [];
  }
}
