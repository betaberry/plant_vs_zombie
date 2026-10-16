// Unified asset registry (FR-17.2, D-04): logical id → file(s). Swapping files here re-skins the game
// without touching gameplay code. Entries without files use procedural fallbacks (FR-17.3).

export interface AudioAsset {
  /** Variants are picked at random to avoid repetition. Empty → Web Audio synthesis fallback. */
  files: string[];
  /** Name of the synth recipe used when files are missing or fail to load. */
  synth: SynthRecipe;
  volume: number;
}

export type SynthRecipe =
  | 'pea_shot' | 'pea_shot_ice' | 'hit_flesh' | 'hit_frost' | 'hit_world' | 'hit_soft' | 'dry_mag' | 'dry_reserve'
  | 'reload_1' | 'reload_2' | 'reload_3' | 'zombie_groan' | 'zombie_attack' | 'footstep' | 'plant_dig'
  | 'plant_grow' | 'plant_destroyed' | 'shovel_pull' | 'plant_fire' | 'explosion' | 'potion' | 'potion_replace'
  | 'hurt' | 'death' | 'heartbeat' | 'kill_confirm' | 'ui_click' | 'ui_buy' | 'ui_error' | 'ui_open' | 'ui_close'
  | 'pickup' | 'vine';

const A = (base: string): string => `assets/audio/${base}.ogg`;

export const AUDIO_ASSETS: Record<string, AudioAsset> = {
  pea_shot: { files: [], synth: 'pea_shot', volume: 0.55 },
  pea_shot_ice: { files: [], synth: 'pea_shot_ice', volume: 0.55 },
  hit_flesh: { files: [A('impactPunch_medium_000'), A('impactPunch_medium_001'), A('impactPunch_medium_002')], synth: 'hit_flesh', volume: 0.6 },
  hit_frost: { files: [A('impactGlass_light_000')], synth: 'hit_frost', volume: 0.5 },
  hit_concrete: { files: [A('impactGeneric_light_000'), A('impactGeneric_light_001')], synth: 'hit_world', volume: 0.45 },
  hit_metal: { files: [A('impactMetal_light_000'), A('impactMetal_light_001')], synth: 'hit_world', volume: 0.45 },
  hit_glass: { files: [A('impactGlass_light_000')], synth: 'hit_world', volume: 0.45 },
  hit_wood: { files: [A('impactWood_light_000'), A('impactWood_light_001')], synth: 'hit_world', volume: 0.45 },
  hit_soft: { files: [A('impactSoft_medium_000'), A('impactSoft_medium_001')], synth: 'hit_soft', volume: 0.5 },
  nut_hit: { files: [A('impactPlank_medium_000')], synth: 'hit_world', volume: 0.6 },
  dry_mag: { files: [A('tick_002')], synth: 'dry_mag', volume: 0.7 },
  dry_reserve: { files: [A('switch_002')], synth: 'dry_reserve', volume: 0.8 },
  reload_1: { files: [A('toggle_001')], synth: 'reload_1', volume: 0.6 },
  reload_2: { files: [A('switch_005')], synth: 'reload_2', volume: 0.6 },
  reload_3: { files: [A('click_005')], synth: 'reload_3', volume: 0.6 },
  zombie_groan: { files: [], synth: 'zombie_groan', volume: 0.7 },
  zombie_attack: { files: [A('impactPunch_heavy_000'), A('impactPunch_heavy_001')], synth: 'zombie_attack', volume: 0.7 },
  footstep: { files: [A('footstep_concrete_000'), A('footstep_concrete_001'), A('footstep_concrete_002')], synth: 'footstep', volume: 0.35 },
  footstep_wood: { files: [A('footstep_wood_000'), A('footstep_wood_001')], synth: 'footstep', volume: 0.35 },
  plant_dig: { files: [A('impactMining_000'), A('impactMining_001')], synth: 'plant_dig', volume: 0.6 },
  plant_grow: { files: [], synth: 'plant_grow', volume: 0.5 },
  plant_destroyed: { files: [A('impactWood_heavy_000')], synth: 'plant_destroyed', volume: 0.7 },
  shovel_pull: { files: [A('scratch_002'), A('pluck_001')], synth: 'shovel_pull', volume: 0.7 },
  plant_fire: { files: [], synth: 'plant_fire', volume: 0.8 },
  explosion: { files: [], synth: 'explosion', volume: 0.9 },
  vine: { files: [], synth: 'vine', volume: 0.6 },
  potion: { files: [A('maximize_004')], synth: 'potion', volume: 0.6 },
  potion_replace: { files: [A('glitch_001')], synth: 'potion_replace', volume: 0.6 },
  hurt: { files: [], synth: 'hurt', volume: 0.6 },
  death: { files: [], synth: 'death', volume: 0.7 },
  heartbeat: { files: [], synth: 'heartbeat', volume: 0.7 },
  kill_confirm: { files: [], synth: 'kill_confirm', volume: 0.5 },
  ui_click: { files: [A('click_002')], synth: 'ui_click', volume: 0.5 },
  ui_buy: { files: [A('confirmation_001')], synth: 'ui_buy', volume: 0.6 },
  ui_error: { files: [A('error_004')], synth: 'ui_error', volume: 0.6 },
  ui_open: { files: [A('open_001')], synth: 'ui_open', volume: 0.5 },
  ui_close: { files: [A('close_001')], synth: 'ui_close', volume: 0.5 },
  pickup: { files: [A('drop_002')], synth: 'pickup', volume: 0.6 },
};

/** Visual assets: all procedural low-poly geometry for now (see docs/资源来源.md). */
export const MODEL_ASSETS = {
  zombie: { file: null, procedural: 'zombieParts' },
  sunflower_plant: { file: null, procedural: 'plantParts' },
  pea_shooter_plant: { file: null, procedural: 'plantParts' },
  ice_shooter_plant: { file: null, procedural: 'plantParts' },
  nut_wall: { file: null, procedural: 'plantParts' },
  bomb_flower: { file: null, procedural: 'plantParts' },
  vine_trap: { file: null, procedural: 'plantParts' },
  pea_gun: { file: null, procedural: 'viewModel' },
  seed_hands: { file: null, procedural: 'viewModel' },
  city: { file: null, procedural: 'cityBuilder' },
} as const;

/** Resolves a public asset path against Vite's base URL. */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}
