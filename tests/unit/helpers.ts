// Shared test fixtures: real JSON configs, deep-cloned per test.
import characters from '../../src/config/data/characters.json';
import weapons from '../../src/config/data/weapons.json';
import zombies from '../../src/config/data/zombies.json';
import plants from '../../src/config/data/plants.json';
import shop from '../../src/config/data/shop.json';
import map from '../../src/config/data/map_city_01.json';
import game from '../../src/config/data/game.json';
import type { RawConfig } from '../../src/config/validate';

export function rawConfig(): RawConfig {
  return structuredClone({ characters, weapons, zombies, plants, shop, map, game }) as RawConfig;
}

import { buildConfig } from '../../src/config/loader';
import type { AllConfig } from '../../src/config/types';

export function config(): AllConfig {
  const result = buildConfig(rawConfig());
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.config;
}
