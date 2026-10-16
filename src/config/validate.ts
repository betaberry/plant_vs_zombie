// Startup config validation (TR-CFG-01 / TR-CFG-02 / TR-CFG-05).
// Pure: no DOM / Three / Rapier. Returns a list of human-readable errors (empty = valid).
import type {
  AllConfig,
  CharacterDef,
  MapConfig,
  PlantDef,
  PlantsConfig,
  ShopItem,
} from './types';

export interface RawConfig {
  characters: unknown;
  weapons: unknown;
  zombies: unknown;
  plants: unknown;
  shop: unknown;
  map: unknown;
  game: unknown;
}

type Obj = Record<string, unknown>;
const HOTBAR_CATEGORIES = new Set(['potion', 'seed', 'consumable']);
const ROOMS = new Set(['hall', 'backLeft', 'backRight', 'upstairs', 'upstairsBack']);
export const MIN_PLAYER_SPAWNS = 6;
export const MIN_ZOMBIE_SPAWNERS = 12;
export const MIN_ENTERABLE_BUILDINGS = 4;

const CHARACTER_FIELDS: [string, string][] = [
  ['id', 'string'], ['displayName', 'string'], ['role', 'string'], ['tagline', 'string'],
  ['maxHealth', 'number'], ['damageMultiplier', 'number'], ['moveSpeedMultiplier', 'number'],
  ['passiveSunPerSecond', 'number'], ['startingSun', 'number'], ['startingItems', 'object'],
  ['startingReserveAmmo', 'number'], ['canBuyAmmo', 'boolean'], ['availableSeeds', 'array'],
  ['blockedSeeds', 'array'], ['availablePotions', 'array'],
];
const GUN_FIELDS = [
  'damage', 'headshotMultiplier', 'limbMultiplier', 'rpm', 'magazineSize', 'reserveAmmoMax',
  'reloadTime', 'range', 'falloffMultiplier', 'baseSpreadDeg', 'maxSpreadDeg', 'recoilVerticalDeg',
  'recoilHorizontalDeg', 'adsFov', 'adsMoveMultiplier', 'hipFov',
];
const ZOMBIE_FIELDS = [
  'health', 'wanderSpeed', 'chaseSpeed', 'attackDamage', 'attackInterval', 'attackRange',
  'attackWindup', 'visionRange', 'visionAngleDeg', 'hearingRange', 'sunDrop',
];
const PLANT_FIELDS: [string, string][] = [
  ['id', 'string'], ['seedItemId', 'string'], ['displayName', 'string'], ['category', 'string'],
  ['health', 'number'], ['footprintRadius', 'number'], ['maxAlive', 'number'],
];
const SHOP_FIELDS: [string, string][] = [
  ['id', 'string'], ['category', 'string'], ['price', 'number'], ['name', 'string'],
  ['desc', 'string'], ['availableTo', 'array'],
];

function typeOf(v: unknown): string {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  return typeof v;
}

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkFields(errors: string[], where: string, o: Obj, fields: [string, string][]): void {
  for (const [key, type] of fields) {
    if (!(key in o)) errors.push(`${where}: 缺少字段 "${key}"`);
    else if (typeOf(o[key]) !== type) errors.push(`${where}: 字段 "${key}" 类型应为 ${type}`);
  }
}

function numberFields(keys: string[]): [string, string][] {
  return keys.map((k) => [k, 'number']);
}

/** Split the chapter-11 plants.json shape (plant ids at top level + plantingRules). */
export function normalizePlants(raw: unknown): PlantsConfig {
  const o = isObj(raw) ? raw : {};
  const plants: Record<string, PlantDef> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k !== 'plantingRules' && isObj(v)) plants[k] = v as unknown as PlantDef;
  }
  return { plants, plantingRules: o.plantingRules as PlantsConfig['plantingRules'] };
}

export function isItemEnabled(item: ShopItem): boolean {
  return item.enabled !== false;
}

/** Hotbar-occupying item kinds a character can hold at the same time (TR-CFG-05). */
export function hotbarKindsFor(characterId: string, items: ShopItem[]): string[] {
  return items
    .filter((i) => isItemEnabled(i) && HOTBAR_CATEGORIES.has(i.category) && i.availableTo.includes(characterId))
    .map((i) => i.id);
}

function validateCharacters(errors: string[], chars: Obj, shopIds: Set<string>, weaponIds: Set<string>): void {
  for (const [id, c] of Object.entries(chars)) {
    if (!isObj(c)) { errors.push(`characters.${id}: 不是对象`); continue; }
    checkFields(errors, `characters.${id}`, c, CHARACTER_FIELDS);
    const ch = c as unknown as CharacterDef;
    if (ch.weapon !== null && !weaponIds.has(String(ch.weapon))) {
      errors.push(`characters.${id}.weapon: 引用了不存在的武器 "${String(ch.weapon)}"`);
    }
    const refs = [...(ch.availableSeeds ?? []), ...(ch.blockedSeeds ?? []), ...(ch.availablePotions ?? []),
      ...Object.keys(isObj(ch.startingItems) ? ch.startingItems : {})];
    for (const ref of refs) {
      if (!shopIds.has(ref)) errors.push(`characters.${id}: 引用了不存在的商品 "${ref}"`);
    }
  }
}

function validatePlants(errors: string[], plants: PlantsConfig, shopById: Map<string, ShopItem>, charIds: string[]): void {
  for (const [id, p] of Object.entries(plants.plants)) {
    checkFields(errors, `plants.${id}`, p as unknown as Obj, PLANT_FIELDS);
    if (!('onlyByCharacter' in p)) errors.push(`plants.${id}: 缺少字段 "onlyByCharacter"`);
    const seed = shopById.get(p.seedItemId);
    if (!seed) { errors.push(`plants.${id}.seedItemId: 商店中不存在种子 "${p.seedItemId}"`); continue; }
    const expected = p.onlyByCharacter === null ? [...charIds] : [p.onlyByCharacter];
    if (p.onlyByCharacter !== null && !charIds.includes(p.onlyByCharacter)) {
      errors.push(`plants.${id}.onlyByCharacter: 角色 "${p.onlyByCharacter}" 不存在`);
    }
    const actual = [...seed.availableTo].sort().join(',');
    if (actual !== [...expected].sort().join(',')) {
      errors.push(`plants.${id}: 种子 "${seed.id}" 的 availableTo [${seed.availableTo.join(',')}] 与 onlyByCharacter (${String(p.onlyByCharacter)}) 不一致`);
    }
  }
  if (!plants.plantingRules) errors.push('plants.plantingRules: 缺失');
  else checkFields(errors, 'plants.plantingRules', plants.plantingRules as unknown as Obj,
    numberFields(['maxPlacementDistance', 'maxSlopeDeg', 'plantAnimationTime', 'shovelAnimationTime', 'refundPercentOnShovel']));
}

function validateShop(errors: string[], items: ShopItem[], charIds: string[], hotbarSlots: number): void {
  const seen = new Set<string>();
  items.forEach((item, idx) => {
    checkFields(errors, `shop.items[${idx}]`, item as unknown as Obj, SHOP_FIELDS);
    if (seen.has(item.id)) errors.push(`shop.items: 商品 id 重复 "${item.id}"`);
    seen.add(item.id);
    for (const c of item.availableTo ?? []) {
      if (!charIds.includes(c)) errors.push(`shop.items.${item.id}.availableTo: 角色 "${c}" 不存在`);
    }
  });
  for (const c of charIds) {
    const kinds = hotbarKindsFor(c, items);
    if (kinds.length > hotbarSlots) {
      errors.push(`shop: 角色 "${c}" 可同时持有的快捷栏道具种类为 ${kinds.length}，超过快捷栏 ${hotbarSlots} 格（${kinds.join(', ')}）`);
    }
  }
}

function validateMap(errors: string[], map: MapConfig, zombieIds: Set<string>, shopIds: Set<string>): void {
  if (!Array.isArray(map.playerSpawns) || map.playerSpawns.length < MIN_PLAYER_SPAWNS) {
    errors.push(`map: 玩家重生点至少 ${MIN_PLAYER_SPAWNS} 个`);
  }
  if (!Array.isArray(map.zombieSpawners) || map.zombieSpawners.length < MIN_ZOMBIE_SPAWNERS) {
    errors.push(`map: 僵尸刷怪点至少 ${MIN_ZOMBIE_SPAWNERS} 个`);
  }
  const buildings = new Map((map.buildings ?? []).map((b) => [b.id, b]));
  const enterable = (map.buildings ?? []).filter((b) => b.enterable).length;
  if (enterable < MIN_ENTERABLE_BUILDINGS) errors.push(`map: 可进入建筑至少 ${MIN_ENTERABLE_BUILDINGS} 栋`);
  for (const b of map.buildings ?? []) {
    if (b.enterable && !b.doorSide) errors.push(`map.buildings.${b.id}: 可进入建筑缺少 doorSide`);
  }
  const routes = new Set((map.patrolRoutes ?? []).map((r) => r.id));
  const checkPlace = (where: string, p: { pos?: unknown; building?: string; room?: string }): void => {
    if (p.building !== undefined) {
      const b = buildings.get(p.building);
      if (!b || !b.enterable) errors.push(`${where}: 建筑 "${p.building}" 不存在或不可进入`);
      if (!p.room || !ROOMS.has(p.room)) errors.push(`${where}: 房间 "${String(p.room)}" 无效`);
    } else if (!Array.isArray(p.pos) || p.pos.length !== 3) {
      errors.push(`${where}: 需要 pos 或 building+room`);
    }
  };
  for (const s of map.zombieSpawners ?? []) {
    if (!zombieIds.has(s.type)) errors.push(`map.zombieSpawners.${s.id}: 僵尸类型 "${s.type}" 不存在`);
    if (s.patrolRoute && !routes.has(s.patrolRoute)) errors.push(`map.zombieSpawners.${s.id}: 巡逻路线 "${s.patrolRoute}" 不存在`);
    checkPlace(`map.zombieSpawners.${s.id}`, s);
  }
  for (const a of map.ambushPoints ?? []) checkPlace(`map.ambushPoints.${a.id}`, a);
  for (const p of map.pickupPoints ?? []) {
    if (p.item !== 'sun_pack' && !shopIds.has(p.item)) errors.push(`map.pickupPoints.${p.id}: 物品 "${p.item}" 不存在`);
    checkPlace(`map.pickupPoints.${p.id}`, p);
  }
  if (!map.waypointGraph?.grid) errors.push('map.waypointGraph.grid: 缺失');
}

export function validateConfig(raw: RawConfig): string[] {
  const errors: string[] = [];
  for (const key of ['characters', 'weapons', 'zombies', 'plants', 'shop', 'map', 'game'] as const) {
    if (!isObj(raw[key])) errors.push(`${key}: 配置缺失或不是对象`);
  }
  if (errors.length) return errors;
  const chars = raw.characters as Obj;
  const weapons = raw.weapons as Obj;
  const zombies = raw.zombies as Obj;
  const shop = raw.shop as Obj;
  const game = raw.game as AllConfig['game'];
  const items = (Array.isArray(shop.items) ? shop.items : []) as ShopItem[];
  if (!Array.isArray(shop.items)) errors.push('shop.items: 缺失');
  const shopById = new Map(items.map((i) => [i.id, i]));
  const shopIds = new Set(shopById.keys());
  const charIds = Object.keys(chars);
  const hotbarSlots = game.inventory?.hotbarSlots;
  if (typeof hotbarSlots !== 'number') errors.push('game.inventory.hotbarSlots: 缺失');

  if (!isObj(weapons.pea_gun)) errors.push('weapons.pea_gun: 缺失');
  else checkFields(errors, 'weapons.pea_gun', weapons.pea_gun, numberFields(GUN_FIELDS));
  if (!isObj(weapons.ammo_pack)) errors.push('weapons.ammo_pack: 缺失');
  else checkFields(errors, 'weapons.ammo_pack', weapons.ammo_pack, numberFields(['price', 'rounds']));
  for (const [id, z] of Object.entries(zombies)) {
    if (!isObj(z)) { errors.push(`zombies.${id}: 不是对象`); continue; }
    checkFields(errors, `zombies.${id}`, z, numberFields(ZOMBIE_FIELDS));
    if (!isObj(z.targeting)) errors.push(`zombies.${id}.targeting: 缺失`);
  }
  validateCharacters(errors, chars, shopIds, new Set(Object.keys(weapons)));
  validatePlants(errors, normalizePlants(raw.plants), shopById, charIds);
  validateShop(errors, items, charIds, typeof hotbarSlots === 'number' ? hotbarSlots : 6);
  validateMap(errors, raw.map as MapConfig, new Set(Object.keys(zombies)), shopIds);
  return errors;
}
