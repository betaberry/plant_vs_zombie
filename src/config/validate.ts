// Startup config validation (TR-CFG-01 / TR-CFG-02 / TR-CFG-05).
// Pure: no DOM / Three / Rapier. Returns a list of human-readable errors (empty = valid).
import type {
  AllConfig,
  CharacterDef,
  MapConfig,
  PlantDef,
  PlantsConfig,
  RingMapConfig,
  ShopItem,
  ZombieDef,
  ZombieVisualConfig,
} from './types';
import { deathDuration, headCenterHeight } from '../logic/zombiePose';
import { allMoveSpeeds } from '../logic/zombieAbilities';

export interface RawConfig {
  characters: unknown;
  weapons: unknown;
  zombies: unknown;
  plants: unknown;
  shop: unknown;
  /** Maps by id: { city_01: practice city, ring_01: guard ring }. */
  maps: unknown;
  challenge: unknown;
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

/** City (practice mode) map rules — unchanged minimums; `w` is the error prefix (e.g. maps.city_01). */
function validateMap(errors: string[], w: string, map: MapConfig, zombies: Obj, shopIds: Set<string>): void {
  const zombieIds = new Set(Object.keys(zombies));
  if (!Array.isArray(map.playerSpawns) || map.playerSpawns.length < MIN_PLAYER_SPAWNS) {
    errors.push(`${w}: 玩家重生点至少 ${MIN_PLAYER_SPAWNS} 个`);
  }
  if (!Array.isArray(map.zombieSpawners) || map.zombieSpawners.length < MIN_ZOMBIE_SPAWNERS) {
    errors.push(`${w}: 僵尸刷怪点至少 ${MIN_ZOMBIE_SPAWNERS} 个`);
  }
  const buildings = new Map((map.buildings ?? []).map((b) => [b.id, b]));
  const enterable = (map.buildings ?? []).filter((b) => b.enterable).length;
  if (enterable < MIN_ENTERABLE_BUILDINGS) errors.push(`${w}: 可进入建筑至少 ${MIN_ENTERABLE_BUILDINGS} 栋`);
  for (const b of map.buildings ?? []) {
    if (b.enterable && !b.doorSide) errors.push(`${w}.buildings.${b.id}: 可进入建筑缺少 doorSide`);
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
    if (!zombieIds.has(s.type)) errors.push(`${w}.zombieSpawners.${s.id}: 僵尸类型 "${s.type}" 不存在`);
    else if (isGuardOnly(zombies, s.type)) errors.push(`${w}.zombieSpawners.${s.id}: 僵尸类型 "${s.type}" 仅限守卫模式`);
    if (s.patrolRoute && !routes.has(s.patrolRoute)) errors.push(`${w}.zombieSpawners.${s.id}: 巡逻路线 "${s.patrolRoute}" 不存在`);
    checkPlace(`${w}.zombieSpawners.${s.id}`, s);
  }
  for (const a of map.ambushPoints ?? []) checkPlace(`${w}.ambushPoints.${a.id}`, a);
  for (const p of map.pickupPoints ?? []) {
    if (p.item !== 'sun_pack' && !shopIds.has(p.item)) errors.push(`${w}.pickupPoints.${p.id}: 物品 "${p.item}" 不存在`);
    checkPlace(`${w}.pickupPoints.${p.id}`, p);
  }
  if (!map.waypointGraph?.grid) errors.push(`${w}.waypointGraph.grid: 缺失`);
}

/** Boss / imp types are guard-mode only (FR8.5): they never appear in practice spawn tables or wave pools. */
function isGuardOnly(zombies: Obj, id: string): boolean {
  const z = zombies[id];
  return isObj(z) && z.guardOnly === true;
}

const RING_ORDER = ['outer', 'middle', 'inner'];
export const RING_ENTRANCES = 4;
export const MIN_LANE_WIDTH = 8;
export const RAMPS_PER_RING_LINK = 2;
export const RING_STAIRS = 2;

function positive(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function isAngle(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 360;
}

/** Ring (guard mode) map rules: FR2.1 / FR2.6 (entrances, radii, lane width, core inside the inner ring, spawn groups). */
function validateRingMap(errors: string[], w: string, map: RingMapConfig): void {
  const rings = Array.isArray(map.rings) ? map.rings : [];
  if (rings.length !== RING_ORDER.length || rings.some((r, i) => r?.id !== RING_ORDER[i])) {
    errors.push(`${w}.rings: 需要按 outer、middle、inner 顺序的 3 圈`);
  }
  if (!positive(map.laneWidth) || map.laneWidth < MIN_LANE_WIDTH) errors.push(`${w}.laneWidth: 环道宽度至少 ${MIN_LANE_WIDTH} m`);
  for (const k of ['wallHeight', 'outerWallThickness', 'wallSegmentDeg'] as const) if (!positive(map[k])) errors.push(`${w}.${k}: 应为正数`);
  const half = (positive(map.laneWidth) ? map.laneWidth : MIN_LANE_WIDTH) / 2;
  for (let i = 0; i < rings.length; i++) {
    if (!positive(rings[i]?.radius)) { errors.push(`${w}.rings[${i}].radius: 应为正数`); continue; }
    const next = rings[i + 1]?.radius;
    // Lanes must not overlap: a wall band (> 0 m) separates neighbouring lanes.
    if (typeof next === 'number' && !(rings[i]!.radius - half > next + half)) errors.push(`${w}.rings: 半径必须递减且相邻环道之间要有墙（${rings[i]!.id} / ${rings[i + 1]!.id}）`);
  }
  validateRingCore(errors, w, map, rings, half);
  validateRingLinks(errors, w, map, rings);
  const ents = Array.isArray(map.entrances) ? map.entrances : [];
  if (ents.length !== RING_ENTRANCES) errors.push(`${w}.entrances: 需要 ${RING_ENTRANCES} 个外圈入口（当前 ${ents.length}）`);
  for (const e of ents) {
    if (!isAngle(e.angleDeg) || !positive(e.width)) errors.push(`${w}.entrances.${e.id}: 角度应在 0～360 之间、宽度为正数`);
    const pts = Array.isArray(e.spawnPoints) ? e.spawnPoints : [];
    if (pts.length === 0) errors.push(`${w}.entrances.${e.id}.spawnPoints: 刷怪点组不能为空`);
    const outerEdge = (rings[0]?.radius ?? 0) + half + (map.outerWallThickness ?? 0);
    for (const p of pts) if (!positive(p?.radius) || !isAngle(p?.angleDeg) || p.radius <= outerEdge) errors.push(`${w}.entrances.${e.id}.spawnPoints: 刷怪点必须在外墙之外`);
  }
  if (!Array.isArray(map.playerSpawns) || map.playerSpawns.length === 0) errors.push(`${w}.playerSpawns: 至少 1 个玩家出生点`);
  if (!isObj(map.nav) || !positive(map.nav.laneNodeSpacing) || !positive(map.nav.coreApproachDistance)) errors.push(`${w}.nav: laneNodeSpacing / coreApproachDistance 应为正数`);
}

function validateRingCore(errors: string[], w: string, map: RingMapConfig, rings: RingMapConfig['rings'], half: number): void {
  const c = map.core;
  if (!isObj(c) || !Array.isArray(c.size) || !positive(c.size[0]) || !positive(c.size[1]) || !positive(c.height)) {
    errors.push(`${w}.core: 需要 center、正数 size 与 height`);
    return;
  }
  const inner = rings[rings.length - 1]?.radius ?? 0;
  const [cx, cz] = Array.isArray(c.center) ? c.center : [NaN, NaN];
  const reach = Math.hypot(Math.abs(cx) + c.size[0] / 2, Math.abs(cz) + c.size[1] / 2);
  if (!(reach < inner - half)) errors.push(`${w}.core: 核心房必须完整位于内圈环道之内`);
}

function validateRingLinks(errors: string[], w: string, map: RingMapConfig, rings: RingMapConfig['rings']): void {
  const ramps = Array.isArray(map.ramps) ? map.ramps : [];
  for (let i = 0; i + 1 < rings.length; i++) {
    const from = rings[i]!.id;
    const to = rings[i + 1]!.id;
    const n = ramps.filter((r) => r.from === from && r.to === to).length;
    if (n !== RAMPS_PER_RING_LINK) errors.push(`${w}.ramps: ${from} → ${to} 之间需要 ${RAMPS_PER_RING_LINK} 个坡道（当前 ${n}）`);
  }
  for (const r of ramps) {
    const fi = RING_ORDER.indexOf(r.from);
    if (fi < 0 || RING_ORDER.indexOf(r.to) !== fi + 1) errors.push(`${w}.ramps.${r.id}: 只能连接相邻的两圈`);
    if (!isAngle(r.angleDeg) || !positive(r.width)) errors.push(`${w}.ramps.${r.id}: 角度应在 0～360 之间、宽度为正数`);
    if (typeof r.slopeDeg !== 'number' || r.slopeDeg < 0 || r.slopeDeg > 15) errors.push(`${w}.ramps.${r.id}.slopeDeg: 坡度应在 0～15° 之间（可种植）`);
  }
  const stairs = Array.isArray(map.stairs) ? map.stairs : [];
  if (stairs.length !== RING_STAIRS) errors.push(`${w}.stairs: 需要 ${RING_STAIRS} 个层间楼梯`);
  const el = map.elevated;
  if (!isObj(el) || !positive(el.height) || !(el.height < map.wallHeight) || !isAngle(el.fromDeg) || !isAngle(el.toDeg)) {
    errors.push(`${w}.elevated: 高架层需要角度范围与低于墙高的正数高度`);
  } else {
    const [a, b] = Array.isArray(el.between) ? el.between : [];
    if (RING_ORDER.indexOf(String(b)) !== RING_ORDER.indexOf(String(a)) + 1 || RING_ORDER.indexOf(String(a)) < 0) errors.push(`${w}.elevated.between: 需要相邻的两圈`);
    for (const s of stairs) if (!angleWithin(s.angleDeg, el.fromDeg, el.toDeg)) errors.push(`${w}.stairs.${s.id}: 楼梯必须在高架层角度范围内`);
  }
}

/** True when angle a lies on the arc from → to (counter-clockwise, degrees). */
export function angleWithin(a: number, from: number, to: number): boolean {
  const span = (((to - from) % 360) + 360) % 360;
  const d = (((a - from) % 360) + 360) % 360;
  return d <= span;
}

const ZOMBIE_PALETTES = ['jacket', 'shirt', 'tie', 'trousers', 'skin', 'hair', 'shoe', 'teeth', 'eyes'];
/** Plan Step 24: state cross-fades must stay within 0.15–0.25 s. */
export const POSE_BLEND_RANGE: [number, number] = [0.15, 0.25];
/** Plan Step 23: per-zombie height variation is at most ±5 %. */
export const HEIGHT_SCALE_RANGE: [number, number] = [0.95, 1.05];

/** game.zombieVisual (Steps 23–24): rig proportions, variation, palettes and animation timings. */
function validateZombieVisual(errors: string[], game: Obj, zombies: Obj): void {
  const v = game.zombieVisual;
  if (!isObj(v)) { errors.push('game.zombieVisual: 缺失'); return; }
  const zv = v as unknown as ZombieVisualConfig;
  if (!isObj(v.proportions)) { errors.push('game.zombieVisual.proportions: 缺失'); return; }
  for (const [k, val] of Object.entries(v.proportions)) {
    if (typeof val !== 'number' || !(val > 0)) errors.push(`game.zombieVisual.proportions.${k}: 应为正数`);
  }
  if (!isObj(v.palettes)) errors.push('game.zombieVisual.palettes: 缺失');
  else for (const k of ZOMBIE_PALETTES) {
    const list = v.palettes[k];
    if (!Array.isArray(list) || list.length === 0 || list.some((c) => typeof c !== 'string')) errors.push(`game.zombieVisual.palettes.${k}: 需要至少一个颜色字符串`);
  }
  const hs = zv.variation?.heightScale;
  if (!Array.isArray(hs) || hs.length !== 2 || !(hs[0] <= hs[1]) || hs[0] < HEIGHT_SCALE_RANGE[0] || hs[1] > HEIGHT_SCALE_RANGE[1]) {
    errors.push(`game.zombieVisual.variation.heightScale: 应在 [${HEIGHT_SCALE_RANGE.join(', ')}] 内`);
  }
  const anim = zv.animation;
  if (!isObj(anim) || !isObj(anim.death)) { errors.push('game.zombieVisual.animation: 缺失'); return; }
  for (const key of ['blendTime', 'deathBlendTime'] as const) {
    const t = anim[key];
    if (typeof t !== 'number' || t < POSE_BLEND_RANGE[0] || t > POSE_BLEND_RANGE[1]) {
      errors.push(`game.zombieVisual.animation.${key}: 应在 ${POSE_BLEND_RANGE[0]}～${POSE_BLEND_RANGE[1]} s 内`);
    }
  }
  validateTypeVisuals(errors, v, anim as unknown as Obj);
  const death = deathDuration(anim);
  const head = headCenterHeight(zv.proportions);
  for (const [id, z] of Object.entries(zombies)) {
    if (!isObj(z)) continue;
    const zd = z as unknown as ZombieDef;
    if (typeof zd.deathRemoveDelay === 'number' && !(death < zd.deathRemoveDelay)) {
      errors.push(`game.zombieVisual.animation.death: 总时长 ${death.toFixed(2)} s 应小于 zombies.${id}.deathRemoveDelay`);
    }
    const range = zd.headHeightRange;
    const scaled = head * bodyScaleOf(z);
    if (Array.isArray(range) && Array.isArray(hs) && (scaled * hs[0] < range[0] || scaled * hs[1] > range[1])) {
      errors.push(`game.zombieVisual.proportions: 头部中心高度 ${scaled.toFixed(2)} m（含体型缩放与身高差异）超出 zombies.${id}.headHeightRange`);
    }
  }
}

const ARMOR_KINDS = new Set(['cone', 'bucket', 'newspaper', 'screendoor', 'helmet']);
const ARMOR_PROTECTS = new Set(['head', 'body', 'front']);
const ACCESSORIES = new Set(['cone', 'bucket', 'helmet', 'shoulderPads', 'pole', 'newspaper', 'screendoor', 'telephonePole', 'impRider']);
const ABILITY_FIELDS: Record<string, string[]> = {
  poleVault: ['triggerRange', 'triggerAngleDeg', 'duration', 'landingDistance', 'speedAfter'],
  newspaperRage: ['rageDuration', 'chaseSpeedAfter', 'wanderSpeedAfter'],
  charge: ['minDistance', 'approachSpeed'],
  smash: ['windup', 'radius', 'damageVsCore', 'damageVsPlayer', 'cooldown'],
  throwImp: ['healthFraction', 'throwDistance', 'flightTime'],
};
/** Allowed uniform rig scale (gargantuar ≈ 2, imp ≈ 0.6). */
export const BODY_SCALE_RANGE: [number, number] = [0.3, 3];

const POSE_STYLES = new Set(['normal', 'newspaper', 'screendoor', 'football', 'pole', 'gargantuar', 'imp']);
/** Revision 2 animation blocks (+ guard mode gargantuar / imp): every field must be a finite number. */
const TYPE_ANIM_BLOCKS = ['vault', 'rage', 'newspaper', 'screendoor', 'charge', 'gargantuar', 'imp'] as const;
const DROPPED_PROP_FIELDS = ['maxActive', 'restSeconds', 'fadeSeconds', 'launchSpeed', 'spinSpeed'];

function numberBlock(errors: string[], where: string, block: unknown): block is Obj {
  if (!isObj(block)) { errors.push(`${where}: 缺失`); return false; }
  for (const [k, val] of Object.entries(block)) if (typeof val !== 'number' || !Number.isFinite(val)) errors.push(`${where}.${k}: 应为数字`);
  return true;
}

/** Step 28: accessory colours, dropped-prop tunables and the vault / rage / prop-holding pose blocks. */
function validateTypeVisuals(errors: string[], v: Obj, anim: Obj): void {
  const colors = v.accessoryColors;
  if (!isObj(colors)) errors.push('game.zombieVisual.accessoryColors: 缺失');
  else for (const a of ACCESSORIES) if (typeof colors[a] !== 'string') errors.push(`game.zombieVisual.accessoryColors.${a}: 需要颜色字符串`);
  const dp = v.droppedProps;
  if (numberBlock(errors, 'game.zombieVisual.droppedProps', dp)) {
    for (const k of DROPPED_PROP_FIELDS) if (!((dp[k] as number) > 0)) errors.push(`game.zombieVisual.droppedProps.${k}: 应为正数`);
    if (!((dp.gravity as number) < 0)) errors.push('game.zombieVisual.droppedProps.gravity: 应为负数（向下）');
    if (!((dp.bounce as number) >= 0 && (dp.bounce as number) < 1)) errors.push('game.zombieVisual.droppedProps.bounce: 应在 0～1 之间（不含 1）');
  }
  for (const b of TYPE_ANIM_BLOCKS) numberBlock(errors, `game.zombieVisual.animation.${b}`, anim[b]);
  const vault = anim.vault;
  if (isObj(vault) && !(0 < (vault.plantEnd as number) && (vault.plantEnd as number) < (vault.flightEnd as number) && (vault.flightEnd as number) < 1)) {
    errors.push('game.zombieVisual.animation.vault: 需要 0 < plantEnd < flightEnd < 1');
  }
  if (isObj(vault) && !((vault.arcHeight as number) > 0)) errors.push('game.zombieVisual.animation.vault.arcHeight: 应为正数');
  if (typeof anim.armorHitHeadScale !== 'number' || !(anim.armorHitHeadScale >= 1)) errors.push('game.zombieVisual.animation.armorHitHeadScale: 应为不小于 1 的数字');
}

/** zombies.<id>.visual: accessories must exist, armour parts must be worn, pose style must be known. */
function validateZombieLook(errors: string[], id: string, z: Obj): void {
  const where = `zombies.${id}.visual`;
  const vis = z.visual;
  if (!isObj(vis)) { errors.push(`${where}: 缺失`); return; }
  const acc = Array.isArray(vis.accessories) ? vis.accessories.map(String) : null;
  if (!acc || acc.some((a) => !ACCESSORIES.has(a))) errors.push(`${where}.accessories: 应为配件 id 列表`);
  if (!POSE_STYLES.has(String(vis.poseStyle))) errors.push(`${where}.poseStyle: 未知动作风格 "${String(vis.poseStyle)}"`);
  if (typeof vis.allowMissingArm !== 'boolean') errors.push(`${where}.allowMissingArm: 应为布尔值`);
  if (vis.bodyScale !== undefined && (typeof vis.bodyScale !== 'number' || !(vis.bodyScale >= BODY_SCALE_RANGE[0] && vis.bodyScale <= BODY_SCALE_RANGE[1]))) {
    errors.push(`${where}.bodyScale: 应在 ${BODY_SCALE_RANGE[0]}～${BODY_SCALE_RANGE[1]} 之间`);
  }
  if (vis.palette !== undefined) {
    if (!isObj(vis.palette)) errors.push(`${where}.palette: 应为对象`);
    else for (const [k, list] of Object.entries(vis.palette)) {
      if (!ZOMBIE_PALETTES.includes(k) || !Array.isArray(list) || list.length === 0 || list.some((c) => typeof c !== 'string')) {
        errors.push(`${where}.palette.${k}: 应为已知配色键和非空颜色列表`);
      }
    }
  }
  const armor = z.armor;
  if (acc && isObj(armor) && Array.isArray(armor.parts)) {
    for (const p of armor.parts) if (!acc.includes(String(p))) errors.push(`${where}.accessories: 缺少护甲部件 "${String(p)}"`);
  }
  const pole = isObj(z.abilities) ? z.abilities.poleVault : undefined;
  if (acc && isObj(pole) && !acc.includes('pole')) errors.push(`${where}.accessories: 撑杆跳僵尸需要 "pole" 配件`);
}

/** Slowest walk speed any character can have (D-29: every zombie speed must stay below it). */
export function playerWalkSpeed(game: Obj, chars: Obj): number {
  const walk = (game.movement as Obj | undefined)?.walkSpeed;
  const mults = Object.values(chars).map((c) => (isObj(c) && typeof c.moveSpeedMultiplier === 'number' ? c.moveSpeedMultiplier : 1));
  return (typeof walk === 'number' ? walk : 0) * (mults.length ? Math.min(...mults) : 1);
}

function validateArmor(errors: string[], id: string, armor: unknown): void {
  if (armor === null || armor === undefined) return;
  const where = `zombies.${id}.armor`;
  if (!isObj(armor)) { errors.push(`${where}: 应为对象或 null`); return; }
  if (!ARMOR_KINDS.has(String(armor.kind))) errors.push(`${where}.kind: 未知护甲类型 "${String(armor.kind)}"`);
  if (typeof armor.health !== 'number' || !(armor.health > 0)) errors.push(`${where}.health: 应为正数`);
  if (!ARMOR_PROTECTS.has(String(armor.protects))) errors.push(`${where}.protects: 应为 head / body / front`);
  if (typeof armor.frontAngleDeg !== 'number' || armor.frontAngleDeg < 0 || armor.frontAngleDeg > 180) errors.push(`${where}.frontAngleDeg: 应为 0～180 的数字`);
  else if (armor.protects === 'front' && !(armor.frontAngleDeg > 0)) errors.push(`${where}.frontAngleDeg: 正面防护需要大于 0 的角度`);
  if (!('dropProp' in armor) || (armor.dropProp !== null && !ACCESSORIES.has(String(armor.dropProp)))) errors.push(`${where}.dropProp: 应为配件 id 或 null`);
  if (!Array.isArray(armor.parts) || armor.parts.some((p) => !ACCESSORIES.has(String(p)))) errors.push(`${where}.parts: 应为配件 id 列表`);
  if (typeof armor.metal !== 'boolean') errors.push(`${where}.metal: 应为布尔值`);
}

function validateAbilities(errors: string[], id: string, abilities: unknown): void {
  if (abilities === undefined) return;
  if (!isObj(abilities)) { errors.push(`zombies.${id}.abilities: 应为对象`); return; }
  for (const [name, ab] of Object.entries(abilities)) {
    const fields = ABILITY_FIELDS[name];
    if (!fields) { errors.push(`zombies.${id}.abilities: 未知能力 "${name}"`); continue; }
    if (!isObj(ab)) { errors.push(`zombies.${id}.abilities.${name}: 应为对象`); continue; }
    for (const f of fields) {
      if (typeof ab[f] !== 'number' || !(ab[f] >= 0)) errors.push(`zombies.${id}.abilities.${name}.${f}: 应为非负数`);
    }
  }
}

/** Boss abilities: smash must destroy plants explicitly; the imp throw threshold is a fraction and the imp type must exist. */
function validateBossAbilities(errors: string[], id: string, abilities: unknown, zombies: Obj): void {
  if (!isObj(abilities)) return;
  const smash = abilities.smash;
  if (isObj(smash) && typeof smash.destroysPlants !== 'boolean') errors.push(`zombies.${id}.abilities.smash.destroysPlants: 应为布尔值`);
  const ti = abilities.throwImp;
  if (!isObj(ti)) return;
  const f = ti.healthFraction;
  if (typeof f !== 'number' || !(f > 0 && f < 1)) errors.push(`zombies.${id}.abilities.throwImp.healthFraction: 应在 0～1 之间（不含端点）`);
  if (!isObj(zombies[String(ti.impType)])) errors.push(`zombies.${id}.abilities.throwImp.impType: 僵尸类型 "${String(ti.impType)}" 不存在`);
  else if (String(ti.impType) === id) errors.push(`zombies.${id}.abilities.throwImp.impType: 不能扔出自己`);
}

/** Per-type rig scale (default 1). */
export function bodyScaleOf(z: Obj): number {
  const s = isObj(z.visual) ? z.visual.bodyScale : undefined;
  return typeof s === 'number' ? s : 1;
}

/** Revision 2: armour, abilities and the D-29 speed rule for every zombie type. */
function validateZombieTypes(errors: string[], zombies: Obj, walkSpeed: number): void {
  for (const [id, z] of Object.entries(zombies)) {
    if (!isObj(z)) continue;
    validateArmor(errors, id, z.armor);
    validateAbilities(errors, id, z.abilities);
    validateBossAbilities(errors, id, z.abilities, zombies);
    validateZombieLook(errors, id, z);
    if ('guardOnly' in z && typeof z.guardOnly !== 'boolean') errors.push(`zombies.${id}.guardOnly: 应为布尔值`);
    const zd = z as unknown as ZombieDef;
    if (typeof zd.wanderSpeed !== 'number' || typeof zd.chaseSpeed !== 'number') continue;
    const fastest = Math.max(...allMoveSpeeds(zd).filter((s) => typeof s === 'number'));
    if (!(fastest < walkSpeed)) {
      errors.push(`zombies.${id}: 最高移速 ${fastest} m/s 不低于玩家步行速度 ${walkSpeed} m/s（违反 D-29 玩家可脱战）`);
    }
  }
}

/** Revision 2: district spawn tables (map) and per-type caps / heavy types (game.spawnDirector). */
function validateSpawnTypes(errors: string[], w: string, map: MapConfig, game: Obj, zombies: Obj): void {
  const zombieIds = new Set(Object.keys(zombies));
  const districts = new Set((map.districts ?? []).map((d) => d.id));
  const table = map.districtZombieTypes;
  if (!isObj(table)) errors.push(`${w}.districtZombieTypes: 缺失`);
  else for (const [district, weights] of Object.entries(table)) {
    const where = `${w}.districtZombieTypes.${district}`;
    if (!districts.has(district)) errors.push(`${where}: 街区 "${district}" 不存在`);
    if (!isObj(weights)) { errors.push(`${where}: 应为对象`); continue; }
    let sum = 0;
    for (const [type, wt] of Object.entries(weights)) {
      if (!zombieIds.has(type)) errors.push(`${where}: 僵尸类型 "${type}" 不存在`);
      else if (isGuardOnly(zombies, type)) errors.push(`${where}: 僵尸类型 "${type}" 仅限守卫模式，不能出现在练习模式刷怪表`);
      if (typeof wt !== 'number' || !(wt >= 0)) errors.push(`${where}.${type}: 权重不能为负`);
      else sum += wt;
    }
    if (!(sum > 0)) errors.push(`${where}: 权重总和应大于 0`);
  }
  const sd = game.spawnDirector;
  if (!isObj(sd)) { errors.push('game.spawnDirector: 缺失'); return; }
  if (!zombieIds.has(String(sd.defaultZombieType))) errors.push(`game.spawnDirector.defaultZombieType: 僵尸类型 "${String(sd.defaultZombieType)}" 不存在`);
  else if (isGuardOnly(zombies, String(sd.defaultZombieType))) errors.push('game.spawnDirector.defaultZombieType: 不能是仅限守卫模式的类型');
  if (!Array.isArray(sd.heavyZombieTypes)) errors.push('game.spawnDirector.heavyZombieTypes: 缺失');
  else for (const t of sd.heavyZombieTypes) if (!zombieIds.has(String(t))) errors.push(`game.spawnDirector.heavyZombieTypes: 僵尸类型 "${String(t)}" 不存在`);
  if (typeof sd.heavyWeightStep !== 'number' || sd.heavyWeightStep < 0) errors.push('game.spawnDirector.heavyWeightStep: 应为非负数');
  if (!isObj(sd.zombieTypeCaps)) errors.push('game.spawnDirector.zombieTypeCaps: 缺失');
  else for (const [t, cap] of Object.entries(sd.zombieTypeCaps)) {
    if (!zombieIds.has(t)) errors.push(`game.spawnDirector.zombieTypeCaps: 僵尸类型 "${t}" 不存在`);
    if (typeof cap !== 'number' || !Number.isInteger(cap) || cap < 1) errors.push(`game.spawnDirector.zombieTypeCaps.${t}: 应为正整数`);
  }
}

export const DIFFICULTY_IDS = ['easy', 'standard', 'hard'] as const;
const DIFFICULTY_FIELDS = [
  'waves', 'firstWaveCount', 'waveIncrement', 'waveCap', 'zombieHealthMultiplier', 'playerDamageMultiplier',
  'coreDamageMultiplier', 'countdownSeconds', 'entranceCap', 'sunIncomeMultiplier', 'coreHealth', 'bossHealth',
] as const;
const INTEGER_DIFFICULTY_FIELDS = new Set(['waves', 'firstWaveCount', 'waveIncrement', 'waveCap', 'entranceCap']);

/** challenge.json (FR5.4): every difficulty complete and positive, wave cap ≤ the alive cap, known types, staged core damage. */
function validateChallenge(errors: string[], ch: Obj, zombies: Obj, entrances: number): void {
  const waves = isObj(ch.waves) ? ch.waves : null;
  if (!waves) { errors.push('challenge.waves: 缺失'); return; }
  const maxAlive = waves.maxAlive;
  if (!positive(maxAlive) || !Number.isInteger(maxAlive)) errors.push('challenge.waves.maxAlive: 应为正整数');
  const diffs = isObj(ch.difficulties) ? ch.difficulties : {};
  for (const id of DIFFICULTY_IDS) {
    const d = diffs[id];
    const where = `challenge.difficulties.${id}`;
    if (!isObj(d)) { errors.push(`${where}: 缺失`); continue; }
    for (const f of DIFFICULTY_FIELDS) {
      const v = d[f];
      if (!positive(v)) errors.push(`${where}.${f}: 应为正数`);
      else if (INTEGER_DIFFICULTY_FIELDS.has(f) && !Number.isInteger(v)) errors.push(`${where}.${f}: 应为整数`);
    }
    if (positive(d.waveCap) && positive(maxAlive) && (d.waveCap as number) > (maxAlive as number)) errors.push(`${where}.waveCap: 单波上限 ${String(d.waveCap)} 超过同屏上限 ${String(maxAlive)}`);
    if (positive(d.entranceCap) && (d.entranceCap as number) > entrances) errors.push(`${where}.entranceCap: 入口上限超过地图入口数 ${entrances}`);
  }
  for (const k of ['spawnIntervalBase', 'spawnIntervalFactor', 'spawnIntervalMin'] as const) if (!positive(waves[k])) errors.push(`challenge.waves.${k}: 应为正数`);
  if (positive(waves.spawnIntervalFactor) && !((waves.spawnIntervalFactor as number) <= 1)) errors.push('challenge.waves.spawnIntervalFactor: 不应大于 1（每波节奏只能加快）');
  const unlocks = Array.isArray(waves.typeUnlocks) ? waves.typeUnlocks as Obj[] : [];
  if (unlocks.length === 0 || !unlocks.some((u) => u.fromWave === 1)) errors.push('challenge.waves.typeUnlocks: 至少一种类型从第 1 波开始');
  for (const u of unlocks) {
    const t = String(u.type);
    if (!isObj(zombies[t])) errors.push(`challenge.waves.typeUnlocks: 僵尸类型 "${t}" 不存在`);
    else if (isGuardOnly(zombies, t)) errors.push(`challenge.waves.typeUnlocks: "${t}" 是 BOSS / 小鬼，不能进入普通波次`);
    if (!positive(u.fromWave) || !Number.isInteger(u.fromWave) || !positive(u.weight)) errors.push(`challenge.waves.typeUnlocks.${t}: fromWave 应为正整数、weight 为正数`);
  }
  validateEntranceCurve(errors, waves.entranceCurve, entrances);
  const boss = String(waves.bossType);
  if (!isObj(zombies[boss])) errors.push(`challenge.waves.bossType: 僵尸类型 "${boss}" 不存在`);
  validateChallengeMisc(errors, ch);
}

function validateEntranceCurve(errors: string[], curve: unknown, entrances: number): void {
  const list = Array.isArray(curve) ? curve as Obj[] : [];
  if (list.length === 0 || list[0]?.fromWave !== 1) { errors.push('challenge.waves.entranceCurve: 需要从第 1 波开始'); return; }
  for (let i = 0; i < list.length; i++) {
    const e = list[i]!;
    if (!positive(e.open) || !Number.isInteger(e.open) || (e.open as number) > entrances) errors.push(`challenge.waves.entranceCurve[${i}].open: 应为 1～${entrances} 的整数`);
    const prev = list[i - 1];
    if (prev && !((e.fromWave as number) > (prev.fromWave as number) && (e.open as number) >= (prev.open as number))) errors.push(`challenge.waves.entranceCurve[${i}]: fromWave 需递增且开放数不减少`);
  }
}

function validateChallengeMisc(errors: string[], ch: Obj): void {
  const core = isObj(ch.core) ? ch.core : {};
  const stages = Array.isArray(core.damageStages) ? core.damageStages : [];
  const ok = stages.length > 0 && stages.every((s, i) => typeof s === 'number' && s >= 0 && s < 1 && (i === 0 || s < (stages[i - 1] as number))) && stages[stages.length - 1] === 0;
  if (!ok) errors.push('challenge.core.damageStages: 应为 0～1 之间严格递减、以 0 结尾的比例');
  if (typeof core.lowHealthFraction !== 'number' || !(core.lowHealthFraction > 0 && core.lowHealthFraction < 1)) errors.push('challenge.core.lowHealthFraction: 应在 0～1 之间');
  const t = isObj(ch.targeting) ? ch.targeting : {};
  for (const k of ['playerApproachRadius', 'plantApproachRadius']) if (!positive(t[k])) errors.push(`challenge.targeting.${k}: 应为正数`);
  const s = isObj(ch.spawnRule) ? ch.spawnRule : {};
  if (!positive(s.minPlayerDistance)) errors.push('challenge.spawnRule.minPlayerDistance: 应为正数');
  if (!positive(s.coreDirectionHalfAngleDeg) || (s.coreDirectionHalfAngleDeg as number) >= 180) errors.push('challenge.spawnRule.coreDirectionHalfAngleDeg: 应在 0～180° 之间');
}

/** maps: practice city (city_01) and guard ring (ring_01), each validated by its own kind (FR2.6). */
function validateMaps(errors: string[], raw: RawConfig, zombies: Obj, shopIds: Set<string>): void {
  const maps = raw.maps as Obj;
  for (const id of ['city_01', 'ring_01']) if (!isObj(maps[id])) errors.push(`maps.${id}: 缺失`);
  for (const [id, m] of Object.entries(maps)) {
    if (!isObj(m)) continue;
    if (m.kind === 'ring') validateRingMap(errors, `maps.${id}`, m as unknown as RingMapConfig);
    else {
      validateMap(errors, `maps.${id}`, m as unknown as MapConfig, zombies, shopIds);
      validateSpawnTypes(errors, `maps.${id}`, m as unknown as MapConfig, raw.game as Obj, zombies);
    }
  }
}

export function validateConfig(raw: RawConfig): string[] {
  const errors: string[] = [];
  for (const key of ['characters', 'weapons', 'zombies', 'plants', 'shop', 'maps', 'challenge', 'game'] as const) {
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
  validateMaps(errors, raw, zombies, shopIds);
  validateZombieVisual(errors, raw.game as Obj, zombies);
  validateZombieTypes(errors, zombies, playerWalkSpeed(raw.game as Obj, chars));
  const ring = (raw.maps as Obj).ring_01;
  const entrances = isObj(ring) && Array.isArray(ring.entrances) ? ring.entrances.length : RING_ENTRANCES;
  validateChallenge(errors, raw.challenge as Obj, zombies, entrances);
  return errors;
}
