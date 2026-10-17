# 组件清单

每个组件：职责 · 主要文件 · 依赖 · 守卫模式影响（高 / 中 / 低 / 无）。

### App Shell
- **职责**：启动流程、UI 状态机（`boot/menu/playing/paused`）、屏幕与浮层栈、商店开关、Pointer Lock、主循环回调、菜单背景飞行镜头。
- **文件**：`src/main.ts`、`src/game/app.ts`
- **依赖**：Config、Physics、World Layout、Navigation、Render、Audio、UI、Session
- **影响**：高（需要模式维度、按模式构建地图、难度选择）

### Session
- **职责**：一局游戏的装配与每帧更新；注册命令；经济、物品、种植瞄准、交互、刷怪导演调用、首只僵尸提示、重生、存档读写、清理。
- **文件**：`src/game/session.ts`
- **依赖**：Core、Logic Rules、Zombie AI、Plants、Player and Weapon、Pickups and Dummy、Physics、Render、World Layout
- **影响**：高（波次 / 核心 / 失败重开都在这里接入）

### Input
- **职责**：键鼠输入、每 tick 边沿检测、Pointer Lock。
- **文件**：`src/game/input.ts`
- **依赖**：无
- **影响**：低

### Config
- **职责**：7 个 JSON 的类型、校验、加载与开发热重载。
- **文件**：`src/config/types.ts`、`src/config/validate.ts`、`src/config/loader.ts`、`src/config/data/*.json`
- **依赖**：Logic Rules（`zombiePose`、`zombieAbilities` 被校验调用）
- **影响**：高（新地图、波次表、难度档、核心参数）

### Core
- **职责**：`store` 单例、类型化事件总线、命令总线、固定步长循环、可播种随机数。
- **文件**：`src/core/store.ts`、`src/core/events.ts`、`src/core/commands.ts`、`src/core/loop.ts`、`src/core/rng.ts`
- **依赖**：Config（类型）
- **影响**：中（新增事件与命令）

### Logic Rules
- **职责**：与渲染无关的规则：经济、弹药、护甲、伤害、部位、快捷栏、种植合法性、药剂、商店、散布、感知、豌豆射手索敌、刷怪导演、存档、区域、数学。
- **文件**：`src/logic/*.ts`（不含 `targeting.ts`、`zombieAbilities.ts`、`zombiePose.ts`，见 Zombie AI）
- **依赖**：Config（类型）
- **影响**：高（`spawnDirector.ts` 并列新增波次导演；`save.ts` 需按模式隔离；`attackable.ts` 需核心队伍）

### Zombie AI
- **职责**：僵尸状态机、感知、目标优先级、导航、攻击、特殊能力、LOD、程序化姿态，以及管理器的生成 / 噪声 / 渲染。
- **文件**：`src/entities/zombie.ts`、`src/entities/zombieManager.ts`、`src/logic/targeting.ts`、`src/logic/zombieAbilities.ts`、`src/logic/zombiePose.ts`
- **依赖**：Core、Navigation、Physics、World Layout、Render（僵尸骨架）
- **影响**：高（默认冲核心、LOD 以玩家距离计算）

### Plants
- **职责**：六种植物的放置、tick、索敌开火、炸弹、藤蔓、坚果墙阻断航点、序列化。
- **文件**：`src/entities/plants.ts`、`src/entities/tickManager.ts`
- **依赖**：Core、Navigation、Physics、Render、Zombie AI（`ZombieManager`）
- **影响**：低（复用）

### Player and Weapon
- **职责**：第一人称移动、相机、生命 / 死亡 / 重生；豌豆枪射线、散布、后坐、弹药。
- **文件**：`src/entities/player.ts`、`src/entities/weapon.ts`
- **依赖**：Physics、Logic Rules、Core
- **影响**：中（失败规则可能改变重生行为）

### Pickups and Dummy
- **职责**：地图阳光包、补给箱（F 拾取）、训练假人。
- **文件**：`src/entities/pickups.ts`、`src/entities/dummy.ts`
- **依赖**：Physics、Render
- **影响**：中（守卫模式取消补给点，需按模式关闭）

### Navigation
- **职责**：航点图（可阻断边）、A*（绕路 vs 拆墙）、网格 + 室内节点 + 门连接构建、连通性检查。
- **文件**：`src/nav/graph.ts`、`src/nav/astar.ts`、`src/nav/build.ts`
- **依赖**：Logic Rules（`math.ts`）
- **影响**：高（双层环道、核心房不连点、0 不连通航点）

### Physics
- **职责**：Rapier 初始化、静态盒 / 圆柱、运动学胶囊、角色控制器、碰撞体标签、带队伍过滤的射线与视线。
- **文件**：`src/physics/world.ts`、`src/physics/raycast.ts`
- **依赖**：`@dimforge/rapier3d-compat`
- **影响**：中（核心碰撞体队伍；切换地图时回收静态体）

### World Layout
- **职责**：把 `MapConfig` 变成纯数据布局（地面、道路、边界墙、建筑模板含楼梯与房间、道具、门、航点、禁种区），再用 InstancedMesh + 静态碰撞体构建城市与门。
- **文件**：`src/world/layout.ts`、`src/world/cityBuilder.ts`
- **依赖**：Config、Physics、Render
- **影响**：高（环形地图需要新的布局生成器）

### Render
- **职责**：场景、灯光、卡通材质、画质档、阴影跟随、实例池、粒子、弹孔、视图模型、种植预览、僵尸几何 / 骨架 / 掉落道具。
- **文件**：`src/render/*.ts`
- **依赖**：`three`
- **影响**：低

### Audio
- **职责**：3D 音效、UI 音、三路音量、平静 / 战斗音乐交叉淡入、Web Audio 合成回退。
- **文件**：`src/audio/audioManager.ts`、`src/audio/synth.ts`
- **依赖**：Assets Registry、`three`
- **影响**：低

### UI
- **职责**：加载 / 错误 / 主菜单 / 角色选择 / 暂停 / 设置 / 键位 / 确认屏幕；HUD（阳光、生命、弹药、快捷栏、横幅、死亡层、标签、调试面板、新手引导）；小地图；商店面板；中文文案。
- **文件**：`src/ui/screens.ts`、`src/ui/hud.ts`、`src/ui/minimap.ts`、`src/ui/shopPanel.ts`、`src/ui/strings.zh-CN.ts`、`src/ui/dom.ts`、`src/ui/styles.css`
- **依赖**：Core、Session、Logic Rules、World Layout
- **影响**：高（模式 / 难度屏、波次与核心血量 HUD、结算界面、环形小地图）

### Assets Registry
- **职责**：逻辑资源 id → 文件或合成配方。
- **文件**：`src/assets/registry.ts`
- **依赖**：无
- **影响**：低

### Tests
- **职责**：纯逻辑单元测试，`helpers.ts` 加载真实 JSON 并深拷贝。
- **文件**：`tests/unit/*.test.ts`、`tests/unit/helpers.ts`
- **依赖**：Config、Logic Rules、Navigation、World Layout
- **影响**：中（新地图 / 波次需新增测试；`helpers.ts` 只认城市地图）

### Tooling Scripts
- **职责**：从 JSON 生成数值表文档。
- **文件**：`scripts/gen-numbers.mjs`
- **依赖**：`src/config/data/*.json`
- **影响**：低
