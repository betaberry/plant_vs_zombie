// Web Audio synthesis fallbacks for every sound without a CC0 file (FR-17.3), and the two procedural music loops.
import type { SynthRecipe } from '../assets/registry';

type Ctx = BaseAudioContext;

function noiseBuffer(ctx: Ctx, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < len; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return buf;
}

interface Tone {
  type: OscillatorType | 'noise';
  f0: number;
  f1: number;
  dur: number;
  gain: number;
  delay?: number;
  filter?: { type: BiquadFilterType; freq: number; q?: number };
}

const RECIPES: Record<SynthRecipe, Tone[]> = {
  pea_shot: [{ type: 'noise', f0: 0, f1: 0, dur: 0.08, gain: 0.7, filter: { type: 'lowpass', freq: 1400 } }, { type: 'sine', f0: 420, f1: 140, dur: 0.09, gain: 0.6 }],
  pea_shot_ice: [{ type: 'noise', f0: 0, f1: 0, dur: 0.1, gain: 0.5, filter: { type: 'highpass', freq: 3000 } }, { type: 'triangle', f0: 1800, f1: 900, dur: 0.12, gain: 0.35 }],
  hit_flesh: [{ type: 'noise', f0: 0, f1: 0, dur: 0.1, gain: 0.6, filter: { type: 'lowpass', freq: 700 } }],
  hit_frost: [{ type: 'triangle', f0: 2600, f1: 1800, dur: 0.15, gain: 0.3 }, { type: 'noise', f0: 0, f1: 0, dur: 0.12, gain: 0.3, filter: { type: 'highpass', freq: 5000 } }],
  hit_world: [{ type: 'noise', f0: 0, f1: 0, dur: 0.06, gain: 0.5, filter: { type: 'bandpass', freq: 2200, q: 1.5 } }],
  hit_soft: [{ type: 'sine', f0: 300, f1: 120, dur: 0.08, gain: 0.5 }],
  dry_mag: [{ type: 'square', f0: 2400, f1: 2400, dur: 0.02, gain: 0.3 }],
  dry_reserve: [{ type: 'square', f0: 900, f1: 600, dur: 0.05, gain: 0.35 }, { type: 'square', f0: 700, f1: 500, dur: 0.05, gain: 0.3, delay: 0.08 }],
  reload_1: [{ type: 'square', f0: 1200, f1: 800, dur: 0.04, gain: 0.25 }],
  reload_2: [{ type: 'noise', f0: 0, f1: 0, dur: 0.12, gain: 0.3, filter: { type: 'bandpass', freq: 1500 } }],
  reload_3: [{ type: 'square', f0: 1600, f1: 1600, dur: 0.03, gain: 0.3 }],
  zombie_groan: [{ type: 'sawtooth', f0: 110, f1: 70, dur: 0.9, gain: 0.35, filter: { type: 'lowpass', freq: 500 } }],
  zombie_attack: [{ type: 'noise', f0: 0, f1: 0, dur: 0.15, gain: 0.6, filter: { type: 'lowpass', freq: 900 } }],
  footstep: [{ type: 'noise', f0: 0, f1: 0, dur: 0.05, gain: 0.25, filter: { type: 'lowpass', freq: 500 } }],
  plant_dig: [{ type: 'noise', f0: 0, f1: 0, dur: 0.2, gain: 0.5, filter: { type: 'lowpass', freq: 600 } }],
  plant_grow: [{ type: 'sine', f0: 400, f1: 900, dur: 0.25, gain: 0.3 }],
  plant_destroyed: [{ type: 'noise', f0: 0, f1: 0, dur: 0.35, gain: 0.5, filter: { type: 'lowpass', freq: 400 } }, { type: 'sine', f0: 300, f1: 80, dur: 0.4, gain: 0.3 }],
  shovel_pull: [{ type: 'noise', f0: 0, f1: 0, dur: 0.25, gain: 0.4, filter: { type: 'bandpass', freq: 800 } }, { type: 'sine', f0: 200, f1: 700, dur: 0.15, gain: 0.3, delay: 0.2 }],
  plant_fire: [{ type: 'sine', f0: 600, f1: 180, dur: 0.1, gain: 0.6 }, { type: 'noise', f0: 0, f1: 0, dur: 0.05, gain: 0.3, filter: { type: 'lowpass', freq: 1800 } }],
  explosion: [{ type: 'noise', f0: 0, f1: 0, dur: 1.0, gain: 0.9, filter: { type: 'lowpass', freq: 500 } }, { type: 'sine', f0: 90, f1: 30, dur: 0.8, gain: 0.8 }],
  potion: [{ type: 'sine', f0: 500, f1: 1100, dur: 0.3, gain: 0.3 }],
  potion_replace: [{ type: 'square', f0: 800, f1: 300, dur: 0.2, gain: 0.2 }],
  hurt: [{ type: 'sawtooth', f0: 300, f1: 150, dur: 0.15, gain: 0.3, filter: { type: 'lowpass', freq: 1200 } }],
  death: [{ type: 'sawtooth', f0: 400, f1: 60, dur: 1.2, gain: 0.35, filter: { type: 'lowpass', freq: 900 } }],
  heartbeat: [{ type: 'sine', f0: 70, f1: 50, dur: 0.12, gain: 0.8 }, { type: 'sine', f0: 65, f1: 45, dur: 0.12, gain: 0.6, delay: 0.22 }],
  kill_confirm: [{ type: 'triangle', f0: 900, f1: 1400, dur: 0.12, gain: 0.3 }],
  ui_click: [{ type: 'square', f0: 1000, f1: 1000, dur: 0.03, gain: 0.2 }],
  ui_buy: [{ type: 'triangle', f0: 700, f1: 1200, dur: 0.15, gain: 0.3 }],
  ui_error: [{ type: 'square', f0: 220, f1: 180, dur: 0.18, gain: 0.25 }],
  ui_open: [{ type: 'triangle', f0: 500, f1: 800, dur: 0.1, gain: 0.25 }],
  ui_close: [{ type: 'triangle', f0: 800, f1: 500, dur: 0.1, gain: 0.25 }],
  pickup: [{ type: 'triangle', f0: 900, f1: 1500, dur: 0.12, gain: 0.3 }],
  vine: [{ type: 'noise', f0: 0, f1: 0, dur: 0.4, gain: 0.4, filter: { type: 'bandpass', freq: 400 } }],
};

/** Renders a recipe into an AudioBuffer (offline) so it can be played like any loaded sample. */
export async function renderRecipe(recipe: SynthRecipe, sampleRate: number): Promise<AudioBuffer> {
  const tones = RECIPES[recipe];
  const length = Math.max(...tones.map((t) => (t.delay ?? 0) + t.dur)) + 0.05;
  const ctx = new OfflineAudioContext(1, Math.ceil(length * sampleRate), sampleRate);
  for (const t of tones) {
    const start = t.delay ?? 0;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(t.gain, start + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0008, start + t.dur);
    let src: AudioScheduledSourceNode;
    if (t.type === 'noise') {
      const b = ctx.createBufferSource();
      b.buffer = noiseBuffer(ctx, t.dur);
      src = b;
    } else {
      const o = ctx.createOscillator();
      o.type = t.type;
      o.frequency.setValueAtTime(t.f0, start);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, t.f1), start + t.dur);
      src = o;
    }
    let node: AudioNode = src;
    if (t.filter) {
      const f = ctx.createBiquadFilter();
      f.type = t.filter.type;
      f.frequency.value = t.filter.freq;
      f.Q.value = t.filter.q ?? 1;
      node.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(ctx.destination);
    src.start(start);
    src.stop(start + t.dur + 0.02);
  }
  return ctx.startRendering();
}

/** Procedural looping music: calm (slow pad) or combat (pad + drums). */
export async function renderMusic(kind: 'calm' | 'combat', sampleRate: number): Promise<AudioBuffer> {
  const bars = 4;
  const beat = kind === 'calm' ? 0.75 : 0.42;
  const length = bars * 4 * beat;
  const ctx = new OfflineAudioContext(2, Math.ceil(length * sampleRate), sampleRate);
  const chords = kind === 'calm' ? [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]]
    : [[146.8, 174.6, 220], [130.8, 155.6, 196], [116.5, 146.8, 174.6], [130.8, 164.8, 196]];
  const master = ctx.createGain();
  master.gain.value = 0.18;
  master.connect(ctx.destination);
  chords.forEach((chord, bar) => {
    const t0 = bar * 4 * beat;
    for (const f of chord) {
      const o = ctx.createOscillator();
      o.type = kind === 'calm' ? 'sine' : 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(kind === 'calm' ? 0.35 : 0.12, t0 + 0.3);
      g.gain.linearRampToValueAtTime(0, t0 + 4 * beat);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = kind === 'calm' ? 1200 : 900;
      o.connect(lp).connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + 4 * beat + 0.05);
    }
    if (kind === 'combat') {
      for (let b = 0; b < 4; b++) {
        const t = t0 + b * beat;
        const k = ctx.createOscillator();
        k.frequency.setValueAtTime(120, t);
        k.frequency.exponentialRampToValueAtTime(40, t + 0.15);
        const kg = ctx.createGain();
        kg.gain.setValueAtTime(0.9, t);
        kg.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        k.connect(kg).connect(master);
        k.start(t);
        k.stop(t + 0.2);
      }
    }
  });
  return ctx.startRendering();
}

/** Looping ambience: filtered wind noise. */
export async function renderWind(sampleRate: number): Promise<AudioBuffer> {
  const seconds = 6;
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, seconds);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(300, 0);
  f.frequency.linearRampToValueAtTime(700, seconds / 2);
  f.frequency.linearRampToValueAtTime(300, seconds);
  const g = ctx.createGain();
  g.gain.value = 0.25;
  src.connect(f).connect(g).connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}
