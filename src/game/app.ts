// Application shell: boot (config → physics → city → nav → audio), UI state machine and the main loop.
import * as THREE from 'three';
import { AudioManager } from '../audio/audioManager';
import { enableConfigHotReload, loadConfig } from '../config/loader';
import { GameLoop } from '../core/loop';
import { SETTINGS_KEY, defaultSettings, parseSettings, store, type Settings } from '../core/store';
import { deleteSave, readSave, resolveBrowserStorage, type ReadResult, type StorageLike } from '../logic/save';
import { buildNavGraph } from '../nav/build';
import type { NavGraph } from '../nav/graph';
import { PhysicsWorld } from '../physics/world';
import { GameRenderer } from '../render/renderer';
import { Hud } from '../ui/hud';
import { characterSelect, confirmDialog, controlsScreen, errorScreen, loadingScreen, mainMenu, pauseMenu, settingsScreen } from '../ui/screens';
import { ShopPanel } from '../ui/shopPanel';
import { S } from '../ui/strings.zh-CN';
import { City } from '../world/cityBuilder';
import { generateLayout, type CityLayout } from '../world/layout';
import { distXZ } from '../logic/math';
import { Input } from './input';
import { Session } from './session';

type Mode = 'boot' | 'menu' | 'playing' | 'paused';

export class App {
  private readonly ui: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private renderer!: GameRenderer;
  private phys!: PhysicsWorld;
  private layout!: CityLayout;
  private city!: City;
  private nav!: NavGraph;
  private input!: Input;
  private audio!: AudioManager;
  private loop!: GameLoop;
  private storage!: StorageLike;
  private persistent = true;
  private session: Session | null = null;
  private hud: Hud | null = null;
  private shop: ShopPanel | null = null;
  private mode: Mode = 'boot';
  private screen: HTMLElement | null = null;
  private overlayStack: HTMLElement[] = [];
  private lastFrame = performance.now();
  private readonly menuCamera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 800);
  private menuT = 0;

  constructor() {
    const ui = document.getElementById('ui-root');
    const canvas = document.getElementById('game-canvas');
    if (!ui || !(canvas instanceof HTMLCanvasElement)) throw new Error('index.html is missing #ui-root / #game-canvas');
    this.ui = ui;
    this.canvas = canvas;
  }

  async boot(): Promise<void> {
    const loading = loadingScreen();
    this.setScreen(loading.root);
    const cfg = loadConfig();
    if (!cfg.ok) {
      this.setScreen(errorScreen(S.configError, cfg.errors, S.fatalHint));
      return;
    }
    store.setConfig(cfg.config);
    enableConfigHotReload((c) => {
      store.setConfig(c);
      this.applySettings(store.settings);
    });
    const { storage, persistent } = resolveBrowserStorage();
    this.storage = storage;
    this.persistent = persistent;
    const m = cfg.config.game.movement;
    store.settings = parseSettings(safeGet(storage, SETTINGS_KEY), defaultSettings(m.sensitivityDefault), m.sensitivityMin, m.sensitivityMax);
    try {
      loading.set(0.1, S.loadingPhysics);
      this.phys = await PhysicsWorld.create(m.gravity);
      this.renderer = new GameRenderer(this.canvas);
      loading.set(0.35, S.loadingCity);
      this.layout = generateLayout(cfg.config.map);
      this.city = new City(this.renderer.scene, this.phys, this.layout);
      this.nav = buildNavGraph({
        grid: cfg.config.map.waypointGraph.grid,
        obstacles: this.layout.obstacles,
        extraNodes: [...this.layout.navNodes, ...cfg.config.map.waypointGraph.nodes.map((n) => ({ key: n.id, pos: { x: n.pos[0], y: n.pos[1], z: n.pos[2] }, tag: 'outdoor' }))],
        extraEdges: [...this.layout.navEdges, ...cfg.config.map.waypointGraph.edges],
        doorLinks: this.layout.doorLinks.map((d) => ({ ...d, radius: cfg.config.map.waypointGraph.doorLinkRadius })),
      });
      const disconnected = this.nav.findDisconnected();
      if (disconnected.length > 0) console.warn('[nav] 不连通航点：', disconnected.map((n) => `${n.key} (${n.x.toFixed(1)}, ${n.y.toFixed(1)}, ${n.z.toFixed(1)})`));
      this.phys.step(cfg.config.game.loop.fixedDt);
      loading.set(0.6, S.loadingAudio);
      this.audio = new AudioManager(this.renderer.scene);
      await this.audio.load((p) => loading.set(0.6 + p * 0.4, S.loadingAudio));
    } catch (err) {
      console.error('[boot] 启动失败：', err);
      this.setScreen(errorScreen(S.fatalError, [err instanceof Error ? err.message : String(err)], S.fatalHint));
      return;
    }
    this.input = new Input(this.canvas);
    this.input.onKeyAny = (code) => this.onKey(code);
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.canvas.addEventListener('click', () => {
      this.audio.unlock();
      if (this.mode === 'playing' && !this.session?.shopOpen) this.input.requestLock();
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab' && this.hud) this.hud.tabHeld = false;
    });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('beforeunload', () => this.session?.save());
    document.addEventListener('visibilitychange', () => document.hidden && this.session?.save());
    this.applySettings(store.settings);
    const g = cfg.config.game.loop;
    this.loop = new GameLoop(g.fixedDt, g.maxSubSteps, { update: (dt) => this.update(dt), render: (a, f) => this.render(a, f) });
    this.loop.start();
    this.resize();
    this.showMainMenu();
  }

  /** Pointer Lock is granted asynchronously (and may be refused right after an Esc); show the hint until it arrives. */
  private lock(): void {
    this.input.requestLock();
    this.hud?.setPointerHint(!this.input.isLocked());
  }

  // ---------- screens ----------

  private setScreen(node: HTMLElement | null): void {
    if (this.screen) this.screen.remove();
    for (const o of this.overlayStack) o.remove();
    this.overlayStack = [];
    this.screen = node;
    if (node) this.ui.append(node);
  }

  private pushOverlay(node: HTMLElement): void {
    this.overlayStack.push(node);
    this.ui.append(node);
  }

  private popOverlay(): void {
    this.overlayStack.pop()?.remove();
  }

  private saveStatus(): ReadResult {
    return readSave(this.storage);
  }

  private showMainMenu(): void {
    this.mode = 'menu';
    this.input.gameplayEnabled = false;
    const st = this.saveStatus();
    const note = !this.persistent ? S.storageWarning : st.status === 'incompatible' ? S.saveIncompatible : st.status === 'corrupt' ? S.saveCorrupt : null;
    this.setScreen(mainMenu({
      hasSave: st.status === 'ok',
      saveNote: note,
      onStart: () => {
        this.audio.unlock();
        if (st.status === 'ok') this.pushOverlay(confirmDialog(S.confirmNewGameTitle, S.confirmDeleteBody, () => this.showCharacterSelect(), () => this.popOverlay()));
        else this.showCharacterSelect();
      },
      onContinue: () => {
        this.audio.unlock();
        const s = this.saveStatus();
        if (s.status === 'ok') this.startGame(s.data.characterId, s.data);
      },
      onSettings: () => this.pushOverlay(this.settingsNode(false)),
      onControls: () => this.pushOverlay(controlsScreen(() => this.popOverlay())),
      onDelete: () => this.pushOverlay(confirmDialog(S.confirmDeleteTitle, S.confirmDeleteBody, () => {
        deleteSave(this.storage);
        this.showMainMenu();
      }, () => this.popOverlay())),
    }));
  }

  private showCharacterSelect(): void {
    this.setScreen(characterSelect(store.config, (id) => {
      // 13.6-A: a new game resets everything, including permanent upgrades.
      deleteSave(this.storage);
      this.startGame(id, null);
    }, () => this.showMainMenu()));
  }

  private settingsNode(overlay: boolean): HTMLElement {
    const m = store.config.game.movement;
    return settingsScreen({ ...store.settings }, { min: m.sensitivityMin, max: m.sensitivityMax }, (s) => this.applySettings(s), () => this.popOverlay(), overlay);
  }

  private applySettings(s: Settings): void {
    store.settings = { ...s };
    try {
      this.storage.setItem(SETTINGS_KEY, JSON.stringify(store.settings));
    } catch (err) {
      console.warn('[settings] 保存设置失败:', err);
    }
    this.renderer?.applyQuality(store.config.game.render.quality[s.quality]);
    this.audio?.applyVolumes();
  }

  // ---------- game lifecycle ----------

  private startGame(characterId: string, resume: import('../logic/save').SaveData | null): void {
    this.endSession();
    try {
      this.session = new Session({ renderer: this.renderer, phys: this.phys, city: this.city, layout: this.layout, nav: this.nav, input: this.input, storage: this.storage, characterId, resume });
    } catch (err) {
      console.error('[game] 无法开始游戏：', err);
      this.setScreen(errorScreen(S.fatalError, [err instanceof Error ? err.message : String(err)], S.fatalHint));
      return;
    }
    this.hud = new Hud(this.session, this.loop, this.renderer, this.nav, this.layout);
    this.hud.physMs = () => this.phys.lastStepMs;
    this.shop = new ShopPanel(this.session, () => this.toggleShop(false));
    this.shop.root.style.display = 'none';
    this.setScreen(null);
    this.ui.append(this.hud.root, this.shop.root);
    this.audio.bind(this.session.player.camera);
    this.resize();
    this.mode = 'playing';
    this.input.gameplayEnabled = true;
    this.lock();
    this.session.save();
  }

  private endSession(): void {
    if (!this.session) return;
    this.session.save();
    this.session.dispose();
    this.hud?.dispose();
    this.hud?.root.remove();
    this.shop?.root.remove();
    if (this.session.player.camera.parent) this.session.player.camera.parent.remove(this.session.player.camera);
    this.session = null;
    this.hud = null;
    this.shop = null;
  }

  private toMainMenu(): void {
    this.input.exitLock();
    this.endSession();
    this.audio.stopMusic();
    this.showMainMenu();
  }

  private pause(): void {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.input.gameplayEnabled = false;
    this.session?.save();
    this.pushOverlay(pauseMenu({
      onResume: () => this.resume(),
      onSettings: () => this.pushOverlay(this.settingsNode(true)),
      onControls: () => this.pushOverlay(controlsScreen(() => this.popOverlay())),
      onMainMenu: () => this.toMainMenu(),
    }));
  }

  private resume(): void {
    if (this.mode !== 'paused') return;
    while (this.overlayStack.length) this.popOverlay();
    this.mode = 'playing';
    this.input.gameplayEnabled = true;
    this.lock();
  }

  private toggleShop(open: boolean): void {
    const s = this.session;
    if (!s || !this.shop || this.mode !== 'playing') return;
    if (open === s.shopOpen) return;
    s.shopOpen = open;
    this.shop.root.style.display = open ? 'flex' : 'none';
    if (open) {
      this.hud?.notifyShopOpened();
      this.shop.open();
      this.audio.play2D('ui_open');
      this.input.gameplayEnabled = false;
      this.input.exitLock();
    } else {
      this.shop.close();
      this.audio.play2D('ui_close');
      this.input.gameplayEnabled = true;
      this.lock();
    }
  }

  private onKey(code: string): void {
    if (this.mode === 'paused' && code === 'Escape' && this.overlayStack.length === 1) {
      this.resume();
      return;
    }
    if (this.mode !== 'playing' || !this.session) return;
    if (code === 'KeyB') this.toggleShop(!this.session.shopOpen);
    else if (code === 'Escape' && this.session.shopOpen) this.toggleShop(false);
    else if (code === 'F3' && this.hud) {
      this.hud.showDebug = !this.hud.showDebug;
      if (this.hud.showDebug) console.info('[nav] 不连通航点：', this.nav.findDisconnected().map((n) => n.key));
    } else if (code === 'F4' && this.hud) this.hud.showStates = !this.hud.showStates;
    else if (code === 'KeyH' && this.hud) this.hud.skipTutorial();
    else if (code === 'Tab' && this.hud) this.hud.tabHeld = true;
    else if (this.session.shopOpen && /^Digit[1-6]$/.test(code)) this.shop?.quickBuy(Number(code.slice(5)) - 1);
  }

  private onLockChange(locked: boolean): void {
    if (!this.session || this.mode !== 'playing') return;
    this.hud?.setPointerHint(!locked && !this.session.shopOpen);
    if (locked || this.session.shopOpen) return;
    // Esc while planting / shoveling only cancels that mode (FR-PLT-08); otherwise it opens the pause menu (FR-UI-02).
    if (this.session.cancelHeld()) return;
    this.pause();
  }

  private resize(): void {
    const cam = this.session?.player.camera;
    if (cam) this.renderer.resize(cam);
    else this.renderer.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  // ---------- loop ----------

  private update(dt: number): void {
    if (!this.session || this.mode !== 'playing') return;
    try {
      this.session.update(dt);
    } catch (err) {
      console.error('[game] 逻辑更新出错：', err);
    }
  }

  private render(alpha: number, frameDt: number): void {
    const now = performance.now();
    const real = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    const s = this.session;
    if (!s || !this.hud) {
      // Slow fly-over of the city behind the menus.
      this.menuT += real;
      this.menuCamera.position.set(Math.cos(this.menuT * 0.05) * 90, 45, Math.sin(this.menuT * 0.05) * 90);
      this.menuCamera.lookAt(0, 0, 0);
      this.menuCamera.aspect = window.innerWidth / window.innerHeight;
      this.menuCamera.updateProjectionMatrix();
      this.renderer.render(this.menuCamera);
      return;
    }
    s.render(this.mode === 'playing' ? alpha : 1, this.mode === 'playing' ? frameDt : 0);
    this.hud.update(real, s.player.camera);
    if (s.shopOpen) this.shop?.update(real);
    const p = s.player.position();
    let nearby = 0;
    let distant: { x: number; y: number; z: number } | null = null;
    for (const z of s.zombies.zombies) {
      if (!z.isAlive()) continue;
      const d = distXZ(z.pos, p);
      if (d < store.config.game.audio.combatRadius && z.hasAggro) nearby++;
      else if (d > 30 && d < 70 && !distant) distant = z.pos;
    }
    this.audio.update(real, { nearbyZombies: nearby, lowHealth: s.player.isLowHealth(), alive: s.player.isAlive(), listenerPos: p, distantZombie: distant });
  }
}

function safeGet(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}
