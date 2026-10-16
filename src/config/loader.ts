// Config loading (bundled JSON) + validation + dev hot reload (TR-CFG-01, TR-CFG-04).
import charactersJson from './data/characters.json';
import weaponsJson from './data/weapons.json';
import zombiesJson from './data/zombies.json';
import plantsJson from './data/plants.json';
import shopJson from './data/shop.json';
import mapJson from './data/map_city_01.json';
import gameJson from './data/game.json';
import type { AllConfig } from './types';
import { normalizePlants, validateConfig, type RawConfig } from './validate';

export type ConfigResult = { ok: true; config: AllConfig } | { ok: false; errors: string[] };

/** Validate raw JSON objects and turn them into the typed runtime config. */
export function buildConfig(raw: RawConfig): ConfigResult {
  const errors = validateConfig(raw);
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    config: {
      characters: raw.characters as AllConfig['characters'],
      weapons: raw.weapons as AllConfig['weapons'],
      zombies: raw.zombies as AllConfig['zombies'],
      plants: normalizePlants(raw.plants),
      shop: raw.shop as AllConfig['shop'],
      map: raw.map as AllConfig['map'],
      game: raw.game as AllConfig['game'],
    },
  };
}

function bundledRaw(): RawConfig {
  // Deep copy so runtime code can never mutate the module-level JSON.
  return structuredClone({
    characters: charactersJson,
    weapons: weaponsJson,
    zombies: zombiesJson,
    plants: plantsJson,
    shop: shopJson,
    map: mapJson,
    game: gameJson,
  });
}

export function loadConfig(): ConfigResult {
  const result = buildConfig(bundledRaw());
  if (!result.ok) {
    console.error('[config] 配置校验失败，已阻止进入游戏：\n' + result.errors.join('\n'));
  }
  return result;
}

const KEYS = ['characters', 'weapons', 'zombies', 'plants', 'shop', 'map', 'game'] as const;

/**
 * Dev-only: re-validate and push a new config whenever a JSON file changes.
 * Invalid edits are reported and ignored (the running game keeps the last valid config).
 */
export function enableConfigHotReload(onReload: (config: AllConfig) => void): void {
  if (!import.meta.hot) return;
  const current: RawConfig = bundledRaw();
  import.meta.hot.accept(
    [
      './data/characters.json',
      './data/weapons.json',
      './data/zombies.json',
      './data/plants.json',
      './data/shop.json',
      './data/map_city_01.json',
      './data/game.json',
    ],
    (modules) => {
      modules.forEach((mod, idx) => {
        if (mod && 'default' in mod) current[KEYS[idx]] = structuredClone(mod.default);
      });
      const result = buildConfig(structuredClone(current));
      if (result.ok) {
        console.info('[config] 配置已热重载');
        onReload(result.config);
      } else {
        console.error('[config] 热重载的配置无效，保留旧配置：\n' + result.errors.join('\n'));
      }
    },
  );
}
