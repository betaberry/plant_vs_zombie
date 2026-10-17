// In-game HUD (10.1): shared + character-specific elements, banners, vignette, death overlay,
// zombie labels (F4), debug panel (F3), tutorial (FR-TUT-01..04) and minimap.
import * as THREE from 'three';
import { store } from '../core/store';
import { reloadProgress } from '../logic/ammo';
import { displaySun, passiveRate } from '../logic/economy';
import { heldItem } from '../logic/inventory';
import type { Session } from '../game/session';
import type { GameLoop } from '../core/loop';
import type { GameRenderer } from '../render/renderer';
import type { NavGraph } from '../nav/graph';
import type { CityLayout } from '../world/layout';
import { clear, el, setText } from './dom';
import { Minimap } from './minimap';
import { S, formatDuration } from './strings.zh-CN';

interface TutorialStep {
  text: string;
  done(): boolean;
}

export class Hud {
  readonly root: HTMLElement;
  private sun = el('span', { testid: 'hud-sun' });
  private sunIcon = el('span', { class: 'icon' }, '☀️');
  private sub1 = el('div', { class: 'sub', testid: 'hud-economy-line' });
  private floats = el('div', { class: 'floats' });
  private healthBox = el('div', { class: 'health', testid: 'hud-health' });
  private healthBar = el('div');
  private healthNum = el('span', { class: 'num' });
  private ammo = el('div', { class: 'ammo', testid: 'hud-ammo' });
  private reload = el('div', { class: 'reload' }, el('div'));
  private counts = el('div', { class: 'counts', testid: 'hud-plant-counts' });
  private shooters = el('div', { class: 'shooters' });
  private hotbar = el('div', { class: 'hotbar', testid: 'hud-hotbar' });
  private banner = el('div', { class: 'banner', testid: 'hud-banner' });
  private potion = el('div', { class: 'potion', testid: 'hud-potion' });
  private hint = el('div', { class: 'hint', testid: 'hud-hint' });
  private reject = el('div', { class: 'hint reject', testid: 'hud-reject' });
  private crosshair = el('div', { class: 'crosshair', testid: 'hud-crosshair' });
  private wheel = el('div', { class: 'wheel', testid: 'hud-seed-wheel' });
  private vignette = el('div', { class: 'vignette' });
  private fade = el('div', { class: 'fade' });
  private death = el('div', { class: 'death', testid: 'hud-death' });
  private labels = el('div', { class: 'labels' });
  private debug = el('div', { class: 'debug', testid: 'hud-debug' });
  private tutorialBox = el('div', { class: 'tutorial', testid: 'hud-tutorial' });
  private resume = el('div', { class: 'resume', testid: 'hud-click-to-resume' }, S.clickToPlay);
  private minimap: Minimap;
  private bannerTimer = 0;
  private rejectTimer = 0;
  private hurt = 0;
  private hitTimer = 0;
  private killTimer = 0;
  private wheelTimer = 0;
  private sunFlash = 0;
  private shownSun = -1;
  showDebug = false;
  showStates = false;
  private tutorial: TutorialStep[] = [];
  private tutorialIndex = 0;
  private tutorialT = 0;
  private flags = { moved: false, fired: false, killed: false, bought: false, planted: false, plantKill: false, shop: false };
  private disposers: (() => void)[] = [];
  private lastHotbarKey = '';

  constructor(
    private readonly session: Session,
    private readonly loop: GameLoop,
    private readonly renderer: GameRenderer,
    private readonly nav: NavGraph,
    layout: CityLayout,
  ) {
    this.minimap = new Minimap(store.config.map, layout);
    const gunner = session.gun !== null;
    this.healthBox.append(el('span', { class: 'avatar' }, S.characterIcons[session.character.id] ?? ''),
      el('div', { class: 'bar' }, this.healthBar), this.healthNum);
    for (const [cls, w, h, x, y] of [['', 2, 10, -1, -16], ['', 2, 10, -1, 6], ['', 10, 2, -16, -1], ['', 10, 2, 6, -1]] as const) {
      const i = el('i', { class: cls });
      Object.assign(i.style, { width: `${w}px`, height: `${h}px`, left: `${x}px`, top: `${y}px` });
      this.crosshair.append(i);
    }
    this.root = el('div', { class: 'hud passive', testid: 'hud' },
      this.vignette, this.labels,
      el('div', { class: 'tl' }, el('div', { class: 'sun' }, this.sunIcon, this.sun), this.sub1, this.floats),
      el('div', { class: 'tr' }, this.minimap.canvas),
      el('div', { class: 'bl' }, this.healthBox),
      el('div', { class: 'br' }, gunner ? this.ammo : null, gunner ? this.reload : null, this.counts, gunner ? null : this.shooters, this.hotbar),
      this.banner, this.potion, this.hint, this.reject, this.crosshair, this.wheel, this.tutorialBox, this.death, this.debug, this.resume, this.fade,
    );
    this.banner.style.opacity = '0';
    this.debug.style.display = 'none';
    this.resume.style.display = 'none';
    this.setupEvents();
    this.setupTutorial();
  }

  private setupEvents(): void {
    const ev = store.events;
    this.disposers.push(
      ev.on('banner', (b) => this.showBanner(b.text, b.kind ?? 'info')),
      ev.on('floatText', (f) => this.addFloat(f.text, f.kind)),
      ev.on('sunChanged', () => (this.sunFlash = 0.3)),
      ev.on('hitMarker', (h) => (h.kill ? (this.killTimer = 0.25) : (this.hitTimer = 0.12))),
      ev.on('playerHurt', (h) => (this.hurt = Math.min(1, this.hurt + h.amount / 25))),
      ev.on('plantRejected', (r) => {
        this.reject.textContent = r.reason;
        this.rejectTimer = 1.6;
      }),
      ev.on('playerRespawned', () => {
        this.fade.style.transition = 'none';
        this.fade.style.opacity = '1';
        requestAnimationFrame(() => {
          this.fade.style.transition = 'opacity 0.8s';
          this.fade.style.opacity = '0';
        });
      }),
      ev.on('weaponFired', () => (this.flags.fired = true)),
      ev.on('zombieKilled', (z) => {
        this.flags.killed = true;
        if (z.byPlant) this.flags.plantKill = true;
      }),
      ev.on('purchase', (p) => {
        if (p.ok && (p.itemId === 'sunflower_seed' || p.itemId.endsWith('_seed'))) this.flags.bought = true;
      }),
      ev.on('plantPlaced', () => (this.flags.planted = true)),
    );
  }

  private setupTutorial(): void {
    const s = this.session;
    if (s.tutorialDone) return;
    const start = s.player.position();
    const after = (sec: number): (() => boolean) => () => this.tutorialT > sec;
    const t = s.gun ? S.tutorialGunner : S.tutorialSunflower;
    const conds: (() => boolean)[] = s.gun
      ? [
        () => Math.hypot(s.player.position().x - start.x, s.player.position().z - start.z) > 4,
        () => this.flags.fired && this.tutorialT > 3,
        () => this.flags.killed,
        () => this.flags.bought,
        () => this.flags.planted,
        after(8),
      ]
      : [
        () => this.flags.shop || this.tutorialT > 8,
        () => this.flags.bought || this.tutorialT > 25,
        () => this.flags.planted,
        () => this.flags.plantKill || this.tutorialT > 30,
        after(10),
      ];
    this.tutorial = t.map((text, i) => ({ text, done: conds[i] ?? after(6) }));
    // FR-CHR-07: the sunflower's very first prompt.
    if (!s.gun) this.showBanner(S.tutorialSunflower[0]!, 'warn');
    else this.showBanner(S.bannerShopHint, 'info');
  }

  notifyShopOpened(): void {
    this.flags.shop = true;
  }

  skipTutorial(): void {
    this.tutorialIndex = this.tutorial.length;
    this.session.tutorialDone = true;
  }

  private updateTutorial(dt: number): void {
    const step = this.tutorial[this.tutorialIndex];
    if (!step) {
      this.tutorialBox.style.display = 'none';
      return;
    }
    this.tutorialT += dt;
    this.tutorialBox.style.display = 'block';
    if (this.tutorialBox.dataset.step !== String(this.tutorialIndex)) {
      this.tutorialBox.dataset.step = String(this.tutorialIndex);
      clear(this.tutorialBox);
      this.tutorialBox.append(el('div', {}, `${this.tutorialIndex + 1}/${this.tutorial.length} · ${step.text}`), el('small', {}, `${S.tutorialSkip}：H`));
    }
    if (step.done()) {
      this.tutorialIndex++;
      this.tutorialT = 0;
      // Kill-step helper: make sure a zombie shows up for the tutorial.
      const killStep = this.session.gun ? 2 : 3;
      if (this.tutorialIndex === killStep) this.session.spawnTutorialZombie();
      if (this.tutorialIndex >= this.tutorial.length) this.session.tutorialDone = true;
    }
  }

  private showBanner(text: string, kind: string): void {
    this.banner.textContent = text;
    this.banner.className = `banner ${kind}`;
    this.banner.style.opacity = '1';
    this.bannerTimer = store.config.game.ui.bannerDuration;
  }

  private addFloat(text: string, kind: string): void {
    if (!text) return;
    const f = el('div', { class: `float ${kind}` }, text);
    f.style.left = `${Math.random() * 2}em`;
    this.floats.append(f);
    setTimeout(() => f.remove(), store.config.game.ui.floatTextDuration * 1000);
  }

  setPointerHint(visible: boolean): void {
    this.resume.style.display = visible ? 'block' : 'none';
  }

  update(dt: number, camera: THREE.PerspectiveCamera): void {
    const s = this.session;
    const p = s.player;
    const cfg = store.config;
    // Sun counter rolls toward the real value (FR-SUN-06).
    const target = displaySun(s.wallet);
    if (this.shownSun < 0) this.shownSun = target;
    this.shownSun += (target - this.shownSun) * Math.min(1, dt * 10);
    if (Math.abs(target - this.shownSun) < 0.5) this.shownSun = target;
    setText(this.sun, String(Math.round(this.shownSun)));
    this.sunFlash = Math.max(0, this.sunFlash - dt);
    this.sunIcon.classList.toggle('flash', this.sunFlash > 0);
    const sunflowerDef = cfg.plants.plants.sunflower_plant!;
    const shooterDef = cfg.plants.plants.pea_shooter_plant!;
    if (s.gun) {
      const n = s.plants.countOf('sunflower_plant');
      setText(this.sub1, `${S.hudSunflowerCount(n, sunflowerDef.maxAlive)} · ${S.hudIncome(n * (sunflowerDef.sunPerSecond ?? 0))}`);
    } else {
      setText(this.sub1, S.hudSelfIncome(Math.round(passiveRate(s.character.passiveSunPerSecond, s.upgrades.sunBonus) * 10) / 10));
    }
    // Health.
    this.healthBar.style.width = `${(p.health / p.maxHealth) * 100}%`;
    setText(this.healthNum, String(Math.ceil(p.health)));
    this.healthBox.classList.toggle('low', p.isLowHealth());
    // Ammo (gunner only).
    if (s.gun) {
      const a = s.gun.ammo;
      setText(this.ammo, '');
      if (!this.ammo.firstChild) this.ammo.append(el('span', { class: 'mag' }), ' / ', el('span', { class: 'reserve' }));
      setText(this.ammo.querySelector('.mag') as HTMLElement, String(a.mag));
      setText(this.ammo.querySelector('.reserve') as HTMLElement, a.reserve > 0 ? String(a.reserve) : `0 ${S.hudAmmoEmpty}`);
      this.ammo.classList.toggle('empty', a.reserve <= 0);
      (this.reload.firstChild as HTMLElement).style.width = `${reloadProgress(a, cfg.weapons.pea_gun.reloadTime) * 100}%`;
      this.reload.style.visibility = a.reloading ? 'visible' : 'hidden';
      setText(this.counts, '');
    } else {
      const shooters = [...s.plants.plants.values()].filter((x) => x.alive && (x.type === 'pea_shooter_plant' || x.type === 'ice_shooter_plant'));
      setText(this.counts, `${S.hudShooterCount(s.plants.countOf('pea_shooter_plant'), shooterDef.maxAlive)} · ${S.hudTempPlants(s.inventory.counts.bomb_flower_seed ?? 0, s.inventory.counts.vine_trap_seed ?? 0)}`);
      const key = shooters.map((x) => Math.round((x.health / x.def.health) * 4)).join(',');
      if (this.shooters.dataset.key !== key) {
        this.shooters.dataset.key = key;
        clear(this.shooters);
        for (const x of shooters) {
          const r = x.health / x.def.health;
          const dot = el('span');
          dot.style.background = r > 0.6 ? '#7cb342' : r > 0.3 ? '#fbc02d' : '#e53935';
          this.shooters.append(dot);
        }
      }
    }
    this.updateHotbar();
    // Potion countdown.
    const pot = s.potions.active;
    this.potion.style.display = pot ? 'block' : 'none';
    if (pot) {
      setText(this.potion, S.hudPotion(S.potionHudNames[pot.id] ?? pot.id, Math.ceil(pot.remaining)));
      this.potion.className = `potion ${pot.type}`;
    }
    this.updateHints();
    this.updateCrosshair(dt);
    // Banner / reject fades.
    this.bannerTimer -= dt;
    if (this.bannerTimer <= 0) this.banner.style.opacity = '0';
    this.rejectTimer -= dt;
    this.reject.style.display = this.rejectTimer > 0 ? 'block' : 'none';
    // Hurt vignette ∝ damage, low-health breathing (FR-HP-02/03).
    this.hurt = Math.max(0, this.hurt - dt * 1.5);
    this.vignette.classList.toggle('low', p.isLowHealth());
    if (!p.isLowHealth()) this.vignette.style.opacity = String(this.hurt);
    this.updateDeath();
    this.updateLabels(camera);
    this.updateDebug();
    this.updateTutorial(dt);
    const crates = s.pickups.items.filter((x) => x.active && x.item !== 'sun_pack').map((x) => x.pos);
    this.minimap.update(p.position(), p.yaw, crates);
  }

  private updateHotbar(): void {
    const inv = this.session.inventory;
    const key = JSON.stringify([inv.slots, inv.counts, inv.selected]);
    if (key === this.lastHotbarKey) return;
    this.lastHotbarKey = key;
    clear(this.hotbar);
    inv.slots.forEach((id, i) => {
      const slot = el('div', { class: `slot${id ? '' : ' empty'}${inv.selected === i ? ' selected' : ''}`, testid: `hud-slot-${i + 1}` },
        el('span', { class: 'key' }, String(i + 1)),
        id ? el('span', { class: 'ico' }, S.itemIcons[id] ?? '📦') : null,
        id ? el('span', { class: 'cnt' }, `×${inv.counts[id] ?? 0}`) : null);
      this.hotbar.append(slot);
    });
  }

  private updateHints(): void {
    const s = this.session;
    const inv = s.inventory;
    const held = heldItem(inv);
    let hint: string | null = null;
    if (inv.shovel) hint = s.shovelTarget ? S.shovelHint : `${S.shovelHint} · ${S.shovelNoTarget}`;
    else if (s.plantAim) hint = S.plantHint;
    else if (held) hint = S.useItemHint(store.config.shop.items.find((i) => i.id === held)?.name ?? held);
    else if (s.interactPrompt) hint = s.interactPrompt;
    this.hint.style.display = hint && s.player.isAlive() ? 'block' : 'none';
    if (hint) setText(this.hint, hint);
  }

  private updateCrosshair(dt: number): void {
    const s = this.session;
    this.hitTimer = Math.max(0, this.hitTimer - dt);
    this.killTimer = Math.max(0, this.killTimer - dt);
    const showGun = s.gun !== null && !s.inventory.shovel && s.player.isAlive();
    const showShovel = s.inventory.shovel && s.player.isAlive();
    this.crosshair.style.display = showGun || showShovel ? 'block' : 'none';
    const shovelIcon = this.crosshair.querySelector('.shovel');
    if (showShovel && !shovelIcon) this.crosshair.append(el('span', { class: 'shovel' }, '⛏️'));
    if (!showShovel && shovelIcon) shovelIcon.remove();
    this.crosshair.querySelectorAll('i').forEach((i) => ((i as HTMLElement).style.display = showShovel ? 'none' : 'block'));
    if (showGun && s.gun) {
      const gap = 4 + s.gun.lastSpreadDeg * 6;
      const [up, down, left, right] = [...this.crosshair.querySelectorAll('i')] as HTMLElement[];
      up!.style.top = `${-gap - 10}px`;
      down!.style.top = `${gap}px`;
      left!.style.left = `${-gap - 10}px`;
      right!.style.left = `${gap}px`;
      this.crosshair.className = `crosshair${this.killTimer > 0 ? ' kill' : this.hitTimer > 0 ? ' hit' : ''}`;
    }
    // Sunflower seed wheel instead of a crosshair (FR-CHR-04): shown while Tab is held or after scrolling.
    if (s.gun === null) this.updateWheel(dt);
    else this.wheel.style.display = 'none';
  }

  private updateWheel(dt: number): void {
    const inv = this.session.inventory;
    this.wheelTimer = Math.max(0, this.wheelTimer - dt);
    if (inv.selected !== null && this.wheel.dataset.sel !== String(inv.selected)) this.wheelTimer = 1.5;
    const seeds = inv.slots.map((id, i) => ({ id, i })).filter((x) => x.id && x.id.endsWith('_seed'));
    const visible = (this.wheelTimer > 0 || this.tabHeld) && seeds.length > 0 && this.session.player.isAlive();
    this.wheel.style.display = visible ? 'block' : 'none';
    this.wheel.style.opacity = visible ? '1' : '0';
    const key = `${seeds.map((x) => x.id).join(',')}|${inv.selected}`;
    if (this.wheel.dataset.key === key) return;
    this.wheel.dataset.key = key;
    this.wheel.dataset.sel = String(inv.selected);
    clear(this.wheel);
    seeds.forEach((x, k) => {
      const a = (k / seeds.length) * Math.PI * 2 - Math.PI / 2;
      const span = el('span', { class: inv.selected === x.i ? 'on' : '' }, S.itemIcons[x.id!] ?? '🌱');
      span.style.left = `${Math.cos(a) * 70}px`;
      span.style.top = `${Math.sin(a) * 70}px`;
      this.wheel.append(span);
    });
    this.wheel.append(el('div', { class: 'label' }, S.seedWheel));
  }

  tabHeld = false;

  private updateDeath(): void {
    const p = this.session.player;
    const canvas = this.renderer.renderer.domElement;
    canvas.classList.toggle('dead', !p.isAlive());
    this.death.style.display = p.isAlive() ? 'none' : 'flex';
    if (p.isAlive()) return;
    const d = this.session.lastDeath;
    const key = `${Math.ceil(p.deathTimer)}`;
    if (this.death.dataset.key === key) return;
    this.death.dataset.key = key;
    clear(this.death);
    this.death.append(el('div', { class: 'big' }, S.youDied), el('div', {}, S.respawnIn(Math.max(0, Math.ceil(p.deathTimer)))),
      el('div', {}, S.deathStats(formatDuration(d.survived), d.kills, d.sun, d.planted)));
  }

  private updateLabels(camera: THREE.PerspectiveCamera): void {
    const list = this.session.zombies.labels(camera.position, this.showStates);
    clear(this.labels);
    const v = new THREE.Vector3();
    for (const l of list) {
      v.set(l.pos.x, l.pos.y, l.pos.z).project(camera);
      if (v.z > 1 || v.z < -1) continue;
      const d = el('div', { class: l.kind === 'break' ? 'break' : '' }, l.kind === 'break' ? S.breakIcon : S.zombieLabel(l.typeName, l.text));
      d.style.left = `${(v.x * 0.5 + 0.5) * 100}%`;
      d.style.top = `${(-v.y * 0.5 + 0.5) * 100}%`;
      this.labels.append(d);
    }
  }

  private updateDebug(): void {
    this.debug.style.display = this.showDebug ? 'block' : 'none';
    if (!this.showDebug) return;
    const s = this.session;
    const p = s.player.position();
    const st = this.renderer.stats();
    const states: Record<string, number> = {};
    for (const z of s.zombies.zombies) states[z.state] = (states[z.state] ?? 0) + 1;
    const disconnected = this.disconnectedCount ??= this.nav.findDisconnected().length;
    setText(this.debug, [
      S.debugTitle,
      `FPS ${this.loop.fps}`,
      `逻辑 ${this.loop.lastUpdateMs.toFixed(2)} ms · 渲染 ${this.loop.lastRenderMs.toFixed(2)} ms · 物理 ${s.player ? this.physMs().toFixed(2) : '0'} ms`,
      `Draw Call ${st.drawCalls} · 三角面 ${st.triangles}`,
      `实体：僵尸 ${s.zombies.aliveCount} · 植物 ${s.plants.total} · ${S.debugDroppedProps(s.zombies.droppedPropCount)}`,
      `僵尸 Draw Call ${s.zombies.drawCalls}`,
      `僵尸状态：${Object.entries(states).map(([k, n]) => `${k}×${n}`).join(' ') || '-'}`,
      `坐标 ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} · ${s.player.grounded ? '着地' : '空中'}${s.isInsideBuilding() ? ' · 室内' : ''}`,
      `航点 ${this.nav.nodes.length} · ${S.debugDisconnected(disconnected)}`,
      `最近命令：${s.commands.recent.join(', ')}`,
    ].join('\n'));
  }

  private disconnectedCount: number | undefined;
  physMs: () => number = () => 0;

  dispose(): void {
    this.disposers.forEach((f) => f());
    this.renderer.renderer.domElement.classList.remove('dead');
  }
}
