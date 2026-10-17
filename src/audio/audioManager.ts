// Audio: Three.js AudioListener + PositionalAudio for 3D sounds, 2D UI/player sounds, three volume buses,
// calm/combat music crossfade by nearby zombie count, random pitch, synth fallback (FR-AUD-01..13).
import * as THREE from 'three';
import { AUDIO_ASSETS, assetUrl } from '../assets/registry';
import type { Vec3Like } from '../core/events';
import { store } from '../core/store';
import { renderMusic, renderRecipe, renderWind } from './synth';

const POSITIONAL_POOL = 24;

export class AudioManager {
  readonly listener = new THREE.AudioListener();
  private buffers = new Map<string, AudioBuffer[]>();
  private sfxBus: GainNode;
  private musicBus: GainNode;
  private pool: THREE.PositionalAudio[] = [];
  private poolIdx = 0;
  private calm: THREE.Audio | null = null;
  private combat: THREE.Audio | null = null;
  private wind: THREE.Audio | null = null;
  private combatMix = 0;
  private heartbeatTimer = 0;
  private groanTimer = 4;
  private ready = false;
  private disposers: (() => void)[] = [];

  constructor(scene: THREE.Scene) {
    const ctx = this.listener.context;
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.connect(this.listener.getInput());
    this.musicBus.connect(this.listener.getInput());
    for (let i = 0; i < POSITIONAL_POOL; i++) {
      const a = new THREE.PositionalAudio(this.listener);
      a.setRefDistance(4);
      a.setRolloffFactor(1.4);
      a.setDistanceModel('inverse');
      a.gain.disconnect();
      a.gain.connect(this.sfxBus);
      const holder = new THREE.Object3D();
      holder.add(a);
      scene.add(holder);
      this.pool.push(a);
    }
    this.applyVolumes();
  }

  /** Loads every registered file; missing/broken files fall back to synthesis with a console warning. */
  async load(onProgress: (p: number) => void): Promise<void> {
    const ctx = this.listener.context;
    const entries = Object.entries(AUDIO_ASSETS);
    let done = 0;
    await Promise.all(entries.map(async ([id, asset]) => {
      const loaded: AudioBuffer[] = [];
      for (const file of asset.files) {
        try {
          const res = await fetch(assetUrl(file));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          loaded.push(await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch (err) {
          console.warn(`[audio] 音效 ${file} 加载失败，改用合成音：`, err);
        }
      }
      if (loaded.length === 0) {
        try {
          loaded.push(await renderRecipe(asset.synth, ctx.sampleRate));
        } catch (err) {
          console.error(`[audio] 合成音 ${asset.synth} 生成失败：`, err);
        }
      }
      this.buffers.set(id, loaded);
      onProgress(++done / entries.length);
    }));
    try {
      const [calm, combat, wind] = await Promise.all([renderMusic('calm', ctx.sampleRate), renderMusic('combat', ctx.sampleRate), renderWind(ctx.sampleRate)]);
      this.calm = this.makeLoop(calm, this.musicBus);
      this.combat = this.makeLoop(combat, this.musicBus);
      this.wind = this.makeLoop(wind, this.sfxBus);
    } catch (err) {
      console.error('[audio] 背景音乐生成失败，本次没有音乐：', err);
    }
    this.ready = true;
  }

  private makeLoop(buffer: AudioBuffer, bus: GainNode): THREE.Audio {
    const a = new THREE.Audio(this.listener);
    a.setBuffer(buffer);
    a.setLoop(true);
    a.gain.disconnect();
    a.gain.connect(bus);
    a.setVolume(0);
    return a;
  }

  /** Browsers only allow audio after a user gesture. */
  unlock(): void {
    const ctx = this.listener.context;
    if (ctx.state === 'suspended') ctx.resume().catch((err: unknown) => console.warn('[audio] 无法恢复音频上下文:', err));
    for (const loop of [this.calm, this.combat, this.wind]) if (loop && !loop.isPlaying) loop.play();
  }

  applyVolumes(): void {
    const s = store.settings;
    this.listener.setMasterVolume(s.masterVolume);
    this.sfxBus.gain.value = s.sfxVolume;
    this.musicBus.gain.value = s.musicVolume;
  }

  private pick(id: string): AudioBuffer | null {
    const list = this.buffers.get(id);
    if (!list || list.length === 0) return null;
    return list[Math.floor(Math.random() * list.length)]!;
  }

  /** 2D sound (UI, own weapon). */
  play2D(id: string, pitchJitter = 0): void {
    if (!this.ready) return;
    const buf = this.pick(id);
    if (!buf) return;
    const ctx = this.listener.context;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * pitchJitter;
    const g = ctx.createGain();
    g.gain.value = AUDIO_ASSETS[id]?.volume ?? 0.5;
    src.connect(g).connect(this.sfxBus);
    src.start();
  }

  /** 3D positional sound with random pitch offset (FR-AUD-01/04/09). */
  play3D(id: string, pos: Vec3Like, pitchJitter = 0.08): void {
    if (!this.ready) return;
    const buf = this.pick(id);
    if (!buf) return;
    const a = this.pool[this.poolIdx]!;
    this.poolIdx = (this.poolIdx + 1) % this.pool.length;
    if (a.isPlaying) a.stop();
    a.parent!.position.set(pos.x, pos.y + 1, pos.z);
    a.setBuffer(buf);
    a.setVolume(AUDIO_ASSETS[id]?.volume ?? 0.5);
    a.setPlaybackRate(1 + (Math.random() * 2 - 1) * pitchJitter);
    a.play();
  }

  bind(camera: THREE.Camera): void {
    if (this.listener.parent !== camera) camera.add(this.listener);
    const ev = store.events;
    this.disposers.forEach((f) => f());
    this.disposers = [
      ev.on('weaponFired', (e) => this.play2D(e.ice ? 'pea_shot_ice' : 'pea_shot', 0.06)),
      ev.on('zombieHit', (e) => {
        if (e.armor === 'metal') this.play3D('hit_armor_metal', e.pos, 0.12);
        else if (e.armor === 'soft' || e.damage <= 0) this.play3D('hit_soft', e.pos);
        else this.play3D(e.ice ? 'hit_frost' : 'hit_flesh', e.pos);
      }),
      // Plant peas / explosions on metal armour clank too (gun hits are covered by zombieHit above).
      ev.on('armorHit', (e) => e.metal && e.source !== 'gun' && this.play3D('hit_armor_metal', e.pos, 0.12)),
      ev.on('propLanded', (e) => this.play3D(e.metal ? 'prop_metal_clang' : 'hit_soft', e.pos, 0.1)),
      ev.on('zombieRage', (e) => this.play3D('zombie_roar', e.pos, 0.08)),
      ev.on('worldHit', (e) => this.play3D(`hit_${e.material === 'wood' ? 'wood' : e.material === 'metal' ? 'metal' : e.material === 'glass' ? 'glass' : 'concrete'}`, e.pos)),
      ev.on('hitMarker', (e) => e.kill && this.play2D('kill_confirm')),
      ev.on('dryFire', (e) => this.play2D(e.reserveEmpty ? 'dry_reserve' : 'dry_mag')),
      ev.on('reloadStart', () => {
        const step = store.config.weapons.pea_gun.reloadTime / 3;
        this.play2D('reload_1');
        setTimeout(() => this.play2D('reload_2'), step * 1000);
        setTimeout(() => this.play2D('reload_3'), step * 2000);
      }),
      ev.on('zombieGroan', (e) => this.play3D('zombie_groan', e.pos, 0.15)),
      ev.on('zombieAttack', (e) => this.play3D('zombie_attack', e.pos)),
      ev.on('playerHurt', () => this.play2D('hurt', 0.1)),
      ev.on('playerDied', () => this.play2D('death')),
      ev.on('plantPlaced', (e) => {
        this.play3D('plant_dig', e.pos);
        setTimeout(() => this.play3D('plant_grow', e.pos), store.config.plants.plantingRules.plantAnimationTime * 1000);
      }),
      ev.on('plantDestroyed', (e) => this.play3D('plant_destroyed', e.pos)),
      ev.on('plantShoveled', (e) => this.play3D('shovel_pull', e.pos)),
      ev.on('plantHurt', (e) => e.type === 'nut_wall' && this.play3D('nut_hit', e.pos)),
      ev.on('plantFired', (e) => this.play3D(e.ice ? 'pea_shot_ice' : 'plant_fire', e.pos)),
      ev.on('explosion', (e) => this.play3D('explosion', e.pos, 0.05)),
      ev.on('vineRoot', (e) => this.play3D('vine', e.pos)),
      ev.on('frost', (e) => this.play3D('hit_frost', e.pos)),
      ev.on('potionDrunk', (e) => e.id && this.play2D(e.replaced ? 'potion_replace' : 'potion')),
      ev.on('purchase', (e) => this.play2D(e.ok ? 'ui_buy' : 'ui_error')),
      ev.on('plantRejected', () => this.play2D('ui_error')),
      ev.on('pickup', () => this.play2D('pickup')),
      ev.on('footstep', (e) => this.play3D('footstep', e.pos, 0.15)),
      // Guard mode: reuse existing sounds (no new assets).
      ev.on('bossSmash', (e) => this.play3D('explosion', e.pos, 0.05)),
      ev.on('coreStage', () => this.play2D('plant_destroyed')),
      ev.on('waveStarted', () => this.play2D('zombie_roar')),
    ];
  }

  /** Per-frame: music crossfade by nearby zombies (FR-AUD-06), heartbeat at low health, distant groans. */
  update(dt: number, s: { nearbyZombies: number; lowHealth: boolean; alive: boolean; listenerPos: Vec3Like; distantZombie: Vec3Like | null; coreLow?: boolean }): void {
    if (!this.ready) return;
    const a = store.config.game.audio;
    const target = s.nearbyZombies >= a.combatZombieCount ? 1 : 0;
    this.combatMix += (target - this.combatMix) * Math.min(1, dt / a.crossfadeTime);
    this.calm?.setVolume(1 - this.combatMix);
    this.combat?.setVolume(this.combatMix);
    this.wind?.setVolume(0.6);
    this.heartbeatTimer -= dt;
    // Guard mode (FR12.2): the core below 50 % also beats the heart.
    if (((s.lowHealth && s.alive) || s.coreLow === true) && this.heartbeatTimer <= 0) {
      this.heartbeatTimer = 0.9;
      this.play2D('heartbeat');
    }
    this.groanTimer -= dt;
    if (this.groanTimer <= 0) {
      this.groanTimer = 6 + Math.random() * 8;
      if (s.distantZombie) this.play3D('zombie_groan', s.distantZombie, 0.2);
    }
  }

  stopMusic(): void {
    this.calm?.setVolume(0);
    this.combat?.setVolume(0);
  }
}
