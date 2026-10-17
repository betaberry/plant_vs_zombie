# 开发者代码扫描（Reverse Engineering · 261017-guard-mode）

## Developer Code Scan Results

### Scan Coverage
- **Analyzed deeply**:
  - `package.json`、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts`、`.gitignore`、`README.md`
  - `src/main.ts`
  - `src/game/app.ts`、`src/game/session.ts`
  - `src/ui/screens.ts`、`src/ui/hud.ts`、`src/ui/minimap.ts`
  - `src/config/loader.ts`、`src/config/validate.ts`、`src/config/types.ts`
  - `src/config/data/map_city_01.json`、`src/config/data/game.json`
  - `src/core/`（`commands.ts`、`events.ts`、`store.ts`、`loop.ts`）
  - `src/logic/targeting.ts`、`src/logic/spawnDirector.ts`、`src/logic/save.ts`、`src/logic/attackable.ts`
  - `src/entities/zombie.ts`、`src/entities/zombieManager.ts`、`src/entities/plants.ts`（第 120–220 行：PlantManager 公共 API 与坚果墙阻断航点）
  - `src/world/layout.ts`、`src/world/cityBuilder.ts`
  - `src/nav/`（`build.ts`、`graph.ts`、`astar.ts`）
  - `src/physics/world.ts`
  - `tests/unit/helpers.ts`
  - `需求文档2.md` §5（仅作意图对照，不属于代码）
- **Skimmed only**（读了文件头注释或函数签名）：
  - `src/entities/`（`player.ts`、`weapon.ts`、`pickups.ts`、`dummy.ts`、`tickManager.ts`）
  - `src/logic/` 其余模块（economy、ammo、armor、damage、droppedProp、hitzone、inventory、math、peashooterAI、perception、planting、potions、shop、spread、zombieAbilities、zombiePose、zones）
  - `src/render/`、`src/audio/`、`src/assets/`
  - `src/ui/shopPanel.ts`、`src/ui/strings.zh-CN.ts`、`src/ui/dom.ts`、`src/ui/styles.css`
  - `src/config/data/` 其余 JSON（characters、plants、shop、weapons、zombies）
  - `src/game/input.ts`、`src/physics/raycast.ts`
  - `tests/unit/*.test.ts`（仅文件名与导入）
  - `scripts/gen-numbers.mjs`、`docs/`、`index.html`、`public/assets/audio/`
- **Left out**：
  - `node_modules/`
  - `dist/`
  - `.kiro/`、`aidlc/`（AI-DLC 自身安装与工作区，按要求排除）

### Packages Found
- `pvz3d-fps` — 单包浏览器应用（ESM，`private`）— TypeScript — 第一人称「射击 + 种植塔防」沙盒游戏

### Build System
- **Type**: npm + Vite 7（打包）+ `tsc --noEmit`（类型检查）
- **Config Files**: `package.json`、`package-lock.json`、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts`
- **Build Dependencies**: 单包，无内部包依赖；`build` = `tsc --noEmit && vite build`；Rollup 手动分包 `three` / `rapier`

### APIs Discovered
- 无网络 API（纯本地单机，无 HTTP 请求）
- 内部命令总线 — `src/core/commands.ts` — 7 个命令（damage、spawn、plant、shovel、pickup、purchase、useItem）
- 内部事件总线 — `src/core/events.ts` — 约 40 个类型化事件
- 浏览器存储 — `src/logic/save.ts`、`src/core/store.ts` — `localStorage` 键 `pvz3d.save.v1`、`pvz3d.settings.v1`

### Frameworks & Libraries
- three — 0.186.1 — 3D 渲染
- @dimforge/rapier3d-compat — 0.21.0 — 物理（内嵌 WASM）
- typescript — 5.9.3 — 严格模式
- vite — 7.3.7 — 开发服务器 / 构建 / JSON 热重载
- vitest — 5.0.5 — 单元测试
- @types/three — 0.186.0

### Test Coverage
- **Test Directories**: `tests/unit/`（19 个测试文件 + `helpers.ts`）
- **Test Frameworks**: Vitest（`environment: node`）
- **Coverage Config**: 缺失（未配置 coverage）

### Code Quality Indicators
- **Linting**: 无 ESLint / Prettier 配置；靠 `tsconfig` 严格选项（`strict`、`noUnusedLocals`、`noUnusedParameters` 等）
- **CI/CD**: 未发现流水线文件
- **Documentation**: `README.md` 完整（运行、键位、图鉴、目录）；源码每个文件都有头注释并引用需求编号（FR-/TR-）

### Technical Debt Signals
- 未发现 TODO / FIXME / HACK / `eslint-disable` / `@ts-ignore`
- 大文件：`src/logic/zombiePose.ts`（764 行）、`src/entities/zombie.ts`（655 行）、`src/render/zombieGeometry.ts`（632 行）、`src/game/session.ts`（626 行，装配 + 每帧逻辑 + 存档，职责偏多）
- 单地图硬编码：`src/config/loader.ts` 直接 import `map_city_01.json`；`AllConfig.map` 只有一个 `MapConfig`
- `src/game/app.ts` 在 boot 时一次性构建 layout / City / nav，`City` 无 dispose，静态碰撞体不回收
- 工作区有未提交改动与未跟踪文件（Revision 2：armor、zombieAbilities、zombiePose、zombieRig 等）；本次指纹按磁盘内容计算

## Handoff Summary
- **Intent-relevant finding**: 守卫模式需要的「模式 / 地图 / 波次 / 核心」四个接入点都缺失且彼此耦合：
  - 模式：`App` 只有 `Mode = 'boot' | 'menu' | 'playing' | 'paused'`（`src/game/app.ts` 第 22 行），主菜单 `mainMenu()` 没有模式入口（`src/ui/screens.ts`）。
  - 地图：`boot()` 用 `cfg.config.map` 只生成一次 `generateLayout` → `City` → `buildNavGraph`（`app.ts` 第 74–82 行）；`validateMap` 强制 ≥6 重生点、≥12 刷怪点、≥4 可进入建筑与 `districtZombieTypes`（`src/config/validate.ts`），环形地图按现规则必然校验失败。
  - 目标：`chooseZombieTarget` 是「玩家优先」，没有核心目标；失去玩家即 `WANDER`（`src/logic/targeting.ts` 第 70–103 行）；`Zombie.currentGoal()` 兜底永远是玩家（`src/entities/zombie.ts`）。
  - 刷怪：`stepDirector` 由玩家距离 `activationRadius` + 视野可见性 + 按时间的压力等级驱动（`src/logic/spawnDirector.ts`），没有波次概念；`Session.runDirector` 与之紧耦合。
- **Risks / follow-up**:
  - 航点网格固定 `y: 0`、障碍只支持轴对齐 `Rect2`（`src/nav/build.ts`），双层环道与圆环墙需显式额外节点 / 边或多段矩形近似，并保持 `findDisconnected()` 为 0。
  - `IAttackable.team` 与 `ColliderTeam` 联合类型没有「核心」，加入核心房需同时扩展 `logic/attackable.ts` 与 `physics/world.ts`。
  - 存档只有一个键 `pvz3d.save.v1` 且 `SaveData` 不含模式；守卫模式写入会覆盖自由模式存档（`Session.save()` 在开局、种植、购买、暂停时都会写）。
  - `Session` 构造函数无条件生成伏击僵尸、训练假人、补给点与新手引导；`Hud` / `Minimap` 依赖城市地图字段（`roads`、`highValueAreas`、正方形 `size`）。
  - `ZombieManager` 容量 `CAPACITY = 64`、LOD 以玩家距离计算（>60 m 降频、>120 m 冻结），僵尸冲核心时远离玩家会被冻结。
