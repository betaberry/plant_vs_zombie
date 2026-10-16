// Singleton store: current config, settings and the shared event bus.
import type { AllConfig } from '../config/types';
import { EventBus } from './events';

export type QualityLevel = 'low' | 'medium' | 'high';

export interface Settings {
  sensitivity: number;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  quality: QualityLevel;
  headBob: boolean;
  invertY: boolean;
}

export const SETTINGS_KEY = 'pvz3d.settings.v1';

export function defaultSettings(sensitivity: number): Settings {
  return {
    sensitivity,
    masterVolume: 0.8,
    sfxVolume: 0.8,
    musicVolume: 0.5,
    quality: 'medium',
    headBob: true,
    invertY: false,
  };
}

/** Merge persisted settings over defaults, clamping invalid values. */
export function parseSettings(text: string | null, defaults: Settings, sensMin: number, sensMax: number): Settings {
  if (!text) return { ...defaults };
  try {
    const o = JSON.parse(text) as Partial<Settings>;
    const vol = (v: unknown, d: number): number => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);
    const sens = typeof o.sensitivity === 'number' ? Math.min(sensMax, Math.max(sensMin, o.sensitivity)) : defaults.sensitivity;
    return {
      sensitivity: sens,
      masterVolume: vol(o.masterVolume, defaults.masterVolume),
      sfxVolume: vol(o.sfxVolume, defaults.sfxVolume),
      musicVolume: vol(o.musicVolume, defaults.musicVolume),
      quality: o.quality === 'low' || o.quality === 'medium' || o.quality === 'high' ? o.quality : defaults.quality,
      headBob: typeof o.headBob === 'boolean' ? o.headBob : defaults.headBob,
      invertY: typeof o.invertY === 'boolean' ? o.invertY : defaults.invertY,
    };
  } catch {
    console.warn('[settings] 设置数据损坏，使用默认值');
    return { ...defaults };
  }
}

class Store {
  private cfg: AllConfig | null = null;
  readonly events = new EventBus();
  settings: Settings = defaultSettings(1);
  private configListeners = new Set<(c: AllConfig) => void>();

  get config(): AllConfig {
    if (!this.cfg) throw new Error('config not loaded');
    return this.cfg;
  }

  setConfig(c: AllConfig): void {
    this.cfg = c;
    for (const l of this.configListeners) l(c);
  }

  onConfigChanged(l: (c: AllConfig) => void): () => void {
    this.configListeners.add(l);
    return () => this.configListeners.delete(l);
  }
}

export const store = new Store();
