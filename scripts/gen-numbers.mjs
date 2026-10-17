// Generates docs/数值表.md from the JSON configs (TR-CFG-03). Run: npm run docs:numbers
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = (name) => JSON.parse(readFileSync(join(root, 'src/config/data', name), 'utf8'));

const characters = data('characters.json');
const weapons = data('weapons.json');
const zombies = data('zombies.json');
const plantsRaw = data('plants.json');
const shop = data('shop.json');
const game = data('game.json');
const { plantingRules, ...plants } = plantsRaw;

const fmt = (v) => (v === null || v === undefined ? '—' : Array.isArray(v) ? v.join('、') : typeof v === 'object' ? JSON.stringify(v) : String(v));
const table = (headers, rows) => [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(fmt).join(' | ')} |`)].join('\n');
const kv = (obj) => table(['字段', '值'], Object.entries(obj).map(([k, v]) => [k, v]));

const out = [];
out.push('# 数值表');
out.push('');
out.push('> 本文件由 `npm run docs:numbers` 从 `src/config/data/*.json` 自动生成，请勿手工编辑。');
out.push('');
out.push('## 角色（characters.json）');
out.push('');
const charIds = Object.keys(characters);
const charFields = ['displayName', 'tagline', 'maxHealth', 'damageMultiplier', 'moveSpeedMultiplier', 'passiveSunPerSecond', 'startingSun', 'startingItems', 'startingReserveAmmo', 'weapon', 'canBuyAmmo', 'availableSeeds', 'blockedSeeds', 'availablePotions'];
out.push(table(['字段', ...charIds], charFields.map((f) => [f, ...charIds.map((id) => characters[id][f])])));
out.push('');
out.push('## 武器（weapons.json）');
out.push('');
out.push('### 豌豆枪');
out.push('');
out.push(kv(weapons.pea_gun));
out.push('');
out.push('### 弹药包');
out.push('');
out.push(kv(weapons.ammo_pack));
out.push('');
out.push('## 僵尸（zombies.json）');
out.push('');
for (const [id, z] of Object.entries(zombies)) {
  out.push(`### ${z.displayName}（${id}）`);
  out.push('');
  const { targeting, ...rest } = z;
  out.push(kv(rest));
  out.push('');
  out.push('目标优先级参数：');
  out.push('');
  out.push(kv(targeting));
  out.push('');
}
out.push('## 植物（plants.json）');
out.push('');
const plantFields = [...new Set(Object.values(plants).flatMap((p) => Object.keys(p)))].filter((f) => f !== 'id');
const plantIds = Object.keys(plants);
out.push(table(['字段', ...plantIds.map((id) => plants[id].displayName)], plantFields.map((f) => [f, ...plantIds.map((id) => plants[id][f])])));
out.push('');
out.push('### 种植规则');
out.push('');
out.push(kv(plantingRules));
out.push('');
out.push('## 商店（shop.json）');
out.push('');
out.push(table(['id', '名称', '分类', '价格', '携带上限', '可购买角色', '启用', '说明'],
  shop.items.map((i) => [i.id, i.name, i.category, i.price, i.maxCarry, i.availableTo, i.enabled === false ? '否（未实现）' : '是', i.desc])));
out.push('');
// ---------- 守卫模式（challenge.json、map_ring_01.json） ----------
const challenge = data('challenge.json');
const ring = data('map_ring_01.json');
out.push('## 守卫模式（challenge.json）');
out.push('');
out.push('### 难度');
out.push('');
const diffIds = Object.keys(challenge.difficulties);
const diffFields = [...new Set(diffIds.flatMap((id) => Object.keys(challenge.difficulties[id])))];
out.push(table(['字段', ...diffIds], diffFields.map((f) => [f, ...diffIds.map((id) => challenge.difficulties[id][f])])));
out.push('');
out.push('### 波次');
out.push('');
const { typeUnlocks, entranceCurve, ...waveRest } = challenge.waves;
out.push(kv(waveRest));
out.push('');
out.push('僵尸类型引入顺序：');
out.push('');
out.push(table(['类型', '名称', '从第几波', '权重'], typeUnlocks.map((u) => [u.type, zombies[u.type]?.displayName ?? '—', u.fromWave, u.weight])));
out.push('');
out.push('入口开放曲线（再受难度入口上限约束）：');
out.push('');
out.push(table(['从第几波', '开放入口数'], entranceCurve.map((e) => [e.fromWave, e.open])));
out.push('');
for (const key of ['core', 'targeting', 'spawnRule']) {
  out.push(`### ${key}`);
  out.push('');
  out.push(kv(challenge[key]));
  out.push('');
}
out.push('## 守卫模式地图（map_ring_01.json）');
out.push('');
out.push(kv({ size: ring.size, laneWidth: ring.laneWidth, wallHeight: ring.wallHeight, outerWallThickness: ring.outerWallThickness, wallSegmentDeg: ring.wallSegmentDeg }));
out.push('');
out.push(table(['圈层', '半径 (m)'], ring.rings.map((r) => [r.id, r.radius])));
out.push('');
out.push(kv({ elevated: ring.elevated, core: ring.core, nav: ring.nav }));
out.push('');
out.push(table(['入口', '角度 (°)', '宽 (m)', '刷怪点数'], ring.entrances.map((e) => [e.id, e.angleDeg, e.width, e.spawnPoints.length])));
out.push('');
out.push(table(['坡道', '从', '到', '角度 (°)', '宽 (m)'], ring.ramps.map((r) => [r.id, r.from, r.to, r.angleDeg, r.width])));
out.push('');
out.push(table(['楼梯', '角度 (°)', '宽 (m)'], ring.stairs.map((s) => [s.id, s.angleDeg, s.width])));
out.push('');
out.push(table(['地标', '类型', '半径 (m)', '角度 (°)'], ring.landmarks.map((l) => [l.id, l.kind, l.pos.radius, l.pos.angleDeg])));
out.push('');
out.push('## 全局参数（game.json）');
out.push('');
const { zombieVisual, ...gameSections } = game;
for (const [section, values] of Object.entries(gameSections)) {
  out.push(`### ${section}`);
  out.push('');
  out.push(section === 'render' ? table(['画质', '阴影', '阴影贴图', '粒子倍率', '像素比上限', '可视距离'],
    Object.entries(values.quality).map(([k, q]) => [k, q.shadows, q.shadowMapSize, q.particleScale, q.pixelRatioCap, q.drawDistance])) : kv(values));
  out.push('');
}
if (zombieVisual) {
  out.push('## 僵尸外观与动作（game.json → zombieVisual）');
  out.push('');
  out.push(`剔除距离 cullDistance：${zombieVisual.cullDistance} m`);
  out.push('');
  for (const key of ['proportions', 'segments', 'variation']) {
    out.push(`### ${key}`);
    out.push('');
    out.push(kv(zombieVisual[key]));
    out.push('');
  }
  out.push('### palettes');
  out.push('');
  out.push(table(['部位', '颜色'], Object.entries(zombieVisual.palettes)));
  out.push('');
  const { idle, wander, alert, chase, attack, break: brk, hitReact, death, ambush, rooted, ...blend } = zombieVisual.animation;
  out.push('### animation（角度单位：度；时间单位：秒）');
  out.push('');
  out.push(kv(blend));
  out.push('');
  for (const [name, values] of Object.entries({ idle, wander, alert, chase, attack, break: brk, hitReact, death, ambush, rooted })) {
    out.push(`#### ${name}`);
    out.push('');
    out.push(kv(values));
    out.push('');
  }
}

const target = join(root, 'docs', '数值表.md');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, out.join('\n'), 'utf8');
console.log(`已生成 ${target}`);
