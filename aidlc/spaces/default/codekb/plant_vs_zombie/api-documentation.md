# API 文档

本项目没有网络 API（无 HTTP / WebSocket，运行时零请求）。下列是模块之间的内部契约，新增模式时会被扩展。

## 命令总线 `CommandBus`（`src/core/commands.ts`）

所有世界状态变更的唯一入口（AR-01）。处理器在 `Session.registerCommands()` 注册；未注册的命令会抛错。

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `damage` | `target: IAttackable`、`amount`、`info: DamageInfo` | `DamageResult { applied, killed }` |
| `spawn` | `spawnerId \| null`、`pos`、`ambush`、`patrolRoute?`、`zombieType?` | `boolean` |
| `plant` | `plantType`、`pos`、`yaw` | `{ ok, reason? }` |
| `shovel` | `plantId` | `boolean` |
| `pickup` | `pickupId` | `boolean` |
| `purchase` | `itemId` | `{ ok, reason? }` |
| `useItem` | `itemId` | `boolean` |

## 事件总线 `GameEvents`（`src/core/events.ts`）

`store.events.on(name, handler)` 返回取消订阅函数；`emit` 捕获处理器异常并记录。主要事件：`sunChanged`、`floatText`、`banner`、`hitMarker`、`zombieHit`、`zombieKilled`（含 `typeId`、`sunDrop`、`byPlant`）、`armorHit`、`armorBroken`、`zombieRage`、`playerHurt`、`playerDied`、`playerRespawned`、`plantPlaced`、`plantDestroyed`、`purchase`、`plantRejected`、`zombieGroan`、`zombieAttack`、`pickup`、`saved` 等。目前没有波次、核心受击、胜负相关事件。

## 攻击目标接口 `IAttackable`（`src/logic/attackable.ts`）

```ts
interface IAttackable {
  readonly attackableId: string;
  readonly team: 'player' | 'zombie' | 'plant';
  position(): Vec3Like;
  isAlive(): boolean;
  applyDamage(amount: number, info: DamageInfo): DamageResult;
}
```

`applyHealthDamage(state, amount)` 是共用的扣血函数。物理碰撞体标签另有 `ColliderTeam = 'world' | 'player' | 'zombie' | 'plant' | 'door'`（`src/physics/world.ts`）。

## 纯逻辑入口

| 函数 | 文件 | 契约 |
| --- | --- | --- |
| `chooseZombieTarget(ctx)` | `logic/targeting.ts` | 输入僵尸位置、仇恨、玩家状态、植物列表、挡路墙、当前植物、规则；输出 `WANDER` / `CHASE_PLAYER` / `BREAK` / `ATTACK_PLANT` |
| `stepDirector(state, ctx, cfg, dt)` | `logic/spawnDirector.ts` | 返回本次应各刷一只的刷怪点 id |
| `chooseZombieType(district, level, aliveByType, table, cfg, roll)` | `logic/spawnDirector.ts` | 按权重与类型上限选类型，全满返回 `null` |
| `findPath(graph, start, goal, allowBreak)` / `planRoute` | `nav/astar.ts` | A*，坚果墙边追加拆墙代价 |
| `buildNavGraph(input)` | `nav/build.ts` | 网格 + 额外节点 / 边 + 门连接 |
| `generateLayout(map)` | `world/layout.ts` | `MapConfig` → `CityLayout` |
| `validateConfig(raw)` / `buildConfig(raw)` | `config/validate.ts` / `loader.ts` | 返回中文错误列表 / 类型化配置 |
| `readSave` / `writeSave` / `deleteSave` | `logic/save.ts` | 见下 |

## 浏览器存储

| 键 | 内容 | 版本 |
| --- | --- | --- |
| `pvz3d.save.v1` | `SaveData`：角色、阳光、物品、弹药、升级、装备、植物、击杀、时长、统计、引导完成 | `SAVE_VERSION = 1`，版本不符返回 `incompatible` |
| `pvz3d.settings.v1` | `Settings`：灵敏度、三路音量、画质、镜头晃动、反转 Y | `parseSettings` 夹取非法值 |

`readSave` 返回 `ok / none / corrupt / incompatible`；`writeSave` 捕获配额异常并返回 `{ ok: false, error }`。`SaveData` 不含模式字段，只有单槽位。

## 配置文件契约

`AllConfig = { characters, weapons, zombies, plants, shop, map, game }`，`map` 只有一个 `MapConfig`（来自 `map_city_01.json`）。字段定义见 `src/config/types.ts`，约束见 `src/config/validate.ts`（问题汇总在 `code-quality-assessment.md`）。
