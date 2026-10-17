# 代码结构

## 目录组织

| 目录 | 分类 | 内容 |
| --- | --- | --- |
| `src/main.ts` | 入口 | 创建 `App`，捕获启动异常 |
| `src/game/` | 装配 / 控制 | `app.ts`（UI 状态机、boot、循环回调）、`session.ts`（一局游戏）、`input.ts`（键鼠 + Pointer Lock） |
| `src/config/` | 配置 | `data/*.json`（7 个）、`types.ts`（类型）、`validate.ts`（纯校验）、`loader.ts`（加载 + HMR） |
| `src/core/` | 横切工具 | `commands.ts`、`events.ts`、`store.ts`、`loop.ts`、`rng.ts`（mulberry32） |
| `src/logic/` | 纯业务规则 | 经济、弹药、护甲、伤害、部位、快捷栏、种植、药剂、商店、散布、目标优先级、豌豆射手索敌、感知、刷怪导演、僵尸能力、僵尸姿态、存档、区域、数学 |
| `src/entities/` | 实体 | 玩家、豌豆枪、僵尸、僵尸管理器、植物管理器、拾取物、训练假人、TickManager |
| `src/nav/` | 纯寻路 | 航点图、A*（绕路 vs 拆墙）、图构建 |
| `src/physics/` | 物理适配 | Rapier 世界封装（碰撞体打标签）、带队伍过滤的射线 |
| `src/world/` | 世界 | `layout.ts`（纯数据布局）、`cityBuilder.ts`（Three.js + Rapier 构建、门） |
| `src/render/` | 渲染 | 渲染器与画质档、实例池、粒子、弹孔、视图模型、种植预览、僵尸几何 / 骨架 / 掉落道具 |
| `src/audio/` | 音频 | 3D 音效、三路音量、音乐交叉淡入、合成回退 |
| `src/ui/` | 界面 | DOM 屏幕、HUD、小地图、商店面板、中文文案、CSS |
| `src/assets/` | 资源 | 逻辑 id → 文件的注册表 |
| `tests/unit/` | 测试 | Vitest 单元测试（19 个）与 `helpers.ts`（加载真实 JSON） |
| `scripts/` | 工具 | `gen-numbers.mjs` 从 JSON 生成 `docs/数值表.md` |
| `public/assets/audio/` | 静态资源 | CC0 音效 `.ogg` 与许可证 |
| `docs/` | 文档 | 数值表、资源来源、里程碑验收记录 |

## 代码模式

- **纯函数 + 状态对象**：如 `createDirectorState()` + `stepDirector(state, ctx, cfg, dt)`、`createWallet()` + `addSun()`。新纯逻辑模块（例如波次导演）沿用此形态最易测。
- **依赖注入的世界接口**：`ZombieWorld`、`PlantManagerDeps`、`SessionDeps` 用接口传入回调（`targetPlants`、`hasLOS` 等），避免实体间直接引用。
- **单例 store**：`store.config` 全局读取配置；`store.events` 全局事件总线。
- **命令分发**：`Session.registerCommands()` 注册 7 个处理器。
- **配置驱动**：数值全部来自 JSON，`types.ts` 描述形状，`validate.ts` 校验引用与约束。
- **文案隔离**：逻辑代码不写 UI 字符串，统一在 `S`（`strings.zh-CN.ts`）。
- **测试用 testid**：DOM 元素都带 `data-testid`。

## 关键文件规模

| 文件 | 行数 | 说明 |
| --- | --- | --- |
| `src/logic/zombiePose.ts` | 764 | 程序化僵尸动画 |
| `src/entities/zombie.ts` | 655 | 僵尸状态机 + 导航 + 攻击 |
| `src/render/zombieGeometry.ts` | 632 | 僵尸部件几何 |
| `src/game/session.ts` | 626 | 一局游戏的装配与每帧逻辑 |
| `src/config/types.ts` | 487 | 配置类型 |
| `src/ui/hud.ts` | 401 | HUD |
| `src/config/validate.ts` | 391 | 配置校验 |
| `src/world/layout.ts` | 344 | 城市布局 |
| `src/game/app.ts` | 337 | 应用外壳 |

全仓 `src/` 约 1.2 万行 TypeScript，`tests/` 约 1.4 千行。
