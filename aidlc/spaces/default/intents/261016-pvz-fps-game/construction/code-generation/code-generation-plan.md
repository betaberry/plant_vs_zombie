# 代码生成计划 — 植物大战僵尸 3D（第一人称版）垂直切片 M0～M6

## Summary

- Builds: 浏览器可运行的第一人称射击 + 种植塔防垂直切片（M0～M6：控制器、城市、射击、僵尸 AI、双角色、商店、种植、刷怪导演、HUD、音频）
- Touches: 工作区根目录下新建 `package.json`、`vite.config.ts`、`tsconfig.json`、`index.html`、`src/`、`public/assets/`、`tests/unit/`、`docs/`
- Tests: 约 30 条 Vitest 单元测试，覆盖纯逻辑模块（配置校验、经济、弹药、药剂、商店、快捷栏、种植规则、目标优先级、伤害、寻路、刷怪导演、存档）

## 输入

- 需求：`aidlc/spaces/default/intents/261016-pvz-fps-game/inception/requirements-analysis/requirements.md`（FR1～FR18、NFR1～NFR8）
- 唯一数值来源：`需求文档.md` v0.3.1（第 11 章配置结构、第 14 章测试用例）
- 本工作流为 express 范围，没有单独的设计阶段；架构决定写在本计划「架构」一节。

## 架构

分层（满足 AR-01～AR-04）：

| 层 | 目录 | 说明 |
| --- | --- | --- |
| 配置 | `src/config/data/*.json`、`src/config/` | 第 11 章六个 JSON；`loadConfig()` + `validateConfig()`；开发模式 `import.meta.hot` 热重载 |
| 核心 | `src/core/` | 固定步长循环（1/60 s + 插值）、事件总线、单例 Store、可播种 PRNG（mulberry32）、`GameCommand` 分发器 |
| 纯逻辑 | `src/logic/` | 不依赖 Three.js/Rapier/DOM 的规则：经济、弹药/换弹、药剂、商店过滤与购买、快捷栏、伤害结算、部位判定、`canPlantAt`、目标优先级、刷怪导演、存档序列化。**单元测试只针对这一层** |
| 导航 | `src/nav/` | 航点图、A*（纯逻辑，可测）、连通性检查、坚果墙阻断与局部重算、「绕路 vs 拆墙」代价 |
| 物理 | `src/physics/` | Rapier 世界封装、角色控制器（胶囊体、台阶 0.35 m、坡度）、射线检测带队伍过滤 |
| 实体 | `src/entities/` | 玩家、僵尸（状态机）、植物（6 种）、统一 `IAttackable`；全部由一个 tick 管理器驱动 |
| 世界 | `src/world/` | 程序化城市（4 街区、≥ 4 栋可进入建筑、地标、封锁墙）、`map_city_01.json` 中的重生点/刷怪点/埋伏点/可种植区；实例化 + 合批 |
| 渲染 | `src/render/` | 场景、光照、卡通材质、弹孔贴花池、粒子池、第一人称视图模型、种植预览 |
| 资源 | `src/assets/` + `public/assets/` | 统一资源注册表（id → 文件），加载失败时回退到程序化几何体 / Web Audio 合成 |
| 音频 | `src/audio/` | `AudioListener` + `PositionalAudio`、三路音量、背景音乐交叉淡入淡出 |
| 界面 | `src/ui/` + `src/ui/strings.zh-CN.ts` | DOM/CSS 覆盖层：加载、主菜单、角色选择、HUD、商店、暂停、设置、死亡、引导、F3/F4 调试；全部文案来自字符串表 |

## Testing Contract
```json
{
  "version": 1,
  "methodology": "test-after",
  "source": "org",
  "ordering": "implement each applicable testable layer, then write and run that layer's tests.",
  "scope": "express",
  "test_strategy": "minimal",
  "project_type": "greenfield",
  "applicable_notes": [
    {
      "layer": "org",
      "text": "We treat tests as a first-class deliverable in every Bolt. The specific\nmethodology (TDD, BDD, ATDD, or classic test-after) is affirmed at\npractices-discovery and recorded in `team.md` under this heading with explicit\n`Methodology` and `Ordering` fields; Code Generation resolves those fields\nindependently from coverage, tooling, and scope notes.\n\nWhen no posture has been affirmed, our default per scope is:\n- **Methodology**: test-after\n- **Ordering**: implement each applicable testable layer, then write and run\n  that layer's tests.\n- `mvp`, `enterprise`, `feature`, `infra`, `classic` add an 80% line-coverage\n  floor and CI execution before merge.\n- `bugfix`, `security-patch` add a targeted regression for the specific\n  bug/vulnerability and require the existing suite to remain green.\n- `express` uses the Minimal strategy: requirement-driven unit tests (one per\n  requirement, with a happy-path floor per component); existing tests remain\n  green.\n- `poc`, `refactor`, `workshop` add no extra new-test floor and require the\n  existing suite to remain green.\n\nThe active `Test Strategy` still applies in every scope and determines test\nvolume/types. Scope floors are additive; they never reduce or replace the\nselected strategy.\n\nBuild and Test verifies defined coverage floors and affirmed quality targets;\nthey may not be weakened to make a step pass.\n\nAffirm a stricter posture in `team.md` if the team commits to one."
    }
  ],
  "obligations": {
    "strategy": "minimal",
    "strategy_volume": [
      "One verifiable test per requirement at the narrowest effective level.",
      "At least one happy-path unit test per component.",
      "Unit tests are the default; a bugfix/security scope floor may require an integration or E2E regression when that is the narrowest level that reproduces the defect."
    ],
    "scope_floor": [
      "Keep the existing test suite green.",
      "This scope adds no extra new-test floor beyond the selected test strategy."
    ],
    "combination_rule": "Apply every selected-strategy obligation and every scope-floor obligation; neither replaces the other, and a targeted scope regression may add the narrowest necessary test type beyond the strategy default."
  },
  "plan_profile": {
    "methodology": "test-after",
    "runner_step": "Bootstrap the minimal test runner/configuration and record the exact unit-scoped command.",
    "runner_ready_before_first_test": true,
    "testable_layers": [
      "Data model / database behavior",
      "Repository / data access",
      "Business logic",
      "API / endpoint",
      "Frontend behavior"
    ],
    "steps": [
      "Project structure and production configuration skeleton.",
      "Bootstrap the minimal test runner/configuration and record the exact unit-scoped command.",
      "Data model / database behavior - implement.",
      "Data model / database behavior - write and run its tests after implementation.",
      "Repository / data access - implement.",
      "Repository / data access - write and run its tests after implementation.",
      "Business logic - implement.",
      "Business logic - write and run its tests after implementation.",
      "API / endpoint - implement.",
      "API / endpoint - write and run its tests after implementation.",
      "Frontend behavior - implement.",
      "Frontend behavior - write and run its tests after implementation.",
      "Environment/build configuration.",
      "Documentation and traceability."
    ]
  },
  "input_sha256": "sha256:6cb23162168334768ff8f29699669845616670119c9eb58bf9bb05af6fefd3de",
  "contract_sha256": "sha256:283a836cf0757ed2efa4b5dd3135f3986eb59880b3017f4ba87a685cfebedfdb"
}
```

层映射说明：本项目没有数据库和 HTTP API。「Data model」= JSON 配置与其校验；「Repository / data access」= 配置加载与 `localStorage` 存档；「Business logic」= `src/logic/` 与 `src/nav/`；「API / endpoint」不适用（以 `GameCommand` 入口代替，与业务逻辑一起测）；「Frontend behavior」= 实体、渲染、UI、音频，靠构建与浏览器试玩验证，不写自动化测试（Minimal 策略）。

## 步骤

### 阶段 A：骨架与测试运行器（M0）

- [x] Step 1：工程骨架（FR1.1、NFR6）。`package.json`（锁定版本：`three`、`@dimforge/rapier3d-compat`、`vite`、`typescript`、`vitest`、`@types/three`）、`tsconfig.json`（strict）、`vite.config.ts`、`index.html`、`src/main.ts`、`.gitignore` 追加 `node_modules/`、`dist/`。运行 `npm install`。
- [x] Step 2：测试运行器（Testing Contract runner_step）。`vitest.config.ts`（node 环境，`include: ['tests/unit/**/*.test.ts']`），先放一条冒烟测试 `tests/unit/smoke.test.ts`，运行 `npx vitest run tests/unit` 确认可执行。

### 阶段 B：数据模型 — 配置（贯穿）

- [x] Step 3：实现配置（FR16.1、FR16.2）。按第 11 章写 `characters.json`、`weapons.json`、`zombies.json`、`plants.json`、`shop.json`、`map_city_01.json`（真实坐标：≥ 6 重生点、≥ 12 刷怪点、埋伏点、巡逻路线、拾取点、可种植区、航点图）；TypeScript 类型 `src/config/types.ts`；`validateConfig()` 实现 TR-CFG-01/02/05，返回错误列表。
- [x] Step 4：测试配置校验。`tests/unit/config.test.ts`：正常配置通过；`seedItemId` 不存在报错；`availableTo` 与 `onlyByCharacter` 不一致报错；可选道具种类 > 6 报错（TC-SUN-02）。运行并通过。

### 阶段 C：数据访问 — 配置加载与存档

- [x] Step 5：实现 `src/config/loader.ts`（加载 + 校验失败时阻止进入游戏并显示错误 + `import.meta.hot` 热重载，TR-CFG-04）；`src/logic/save.ts`（键 `pvz3d.save.v1`、版本号、序列化 FR-SAV-02 字段、读取、删除、版本不兼容检测，FR13.1/FR13.2）。存储接口可注入，便于测试。
- [x] Step 6：测试存档。`tests/unit/save.test.ts`：保存后读取字段一致（含植物位置类型，TC-SAV-01）；版本号不匹配返回不兼容；损坏 JSON 不抛异常、返回空。运行并通过。

### 阶段 D：业务逻辑 — 核心规则

- [x] Step 7：实现核心（FR1.2、FR1.4）。`src/core/loop.ts`（固定步长累加器 + 插值 alpha + 失焦暂停）、`src/core/rng.ts`、`src/core/events.ts`、`src/core/store.ts`、`src/core/commands.ts`（`GameCommand`：damage / spawn / plant / shovel / pickup / purchase / useItem）、`src/logic/attackable.ts`（`IAttackable`）。
- [x] Step 8：实现经济与战斗规则（FR4.1、FR4.4、FR8.1、FR8.2、FR9.1～FR9.5、FR10.1、FR10.2）。`src/logic/economy.ts`（击杀 +10、爆头 +5、本体 15/s 每 0.2 s 结算且死亡停止、太阳花苗 4/s 每 0.5 s、上限 999）；`src/logic/ammo.ts`（弹匣/备弹/换弹/打断/弹尽）；`src/logic/potions.ts`（30 s、替换不叠加、寒冰减速 50%/3 s、强化 ×1.5）；`src/logic/damage.ts`（部位倍率、距离衰减、强化、永久强化 +20%、爆炸线性衰减、护甲）；`src/logic/hitzone.ts`（局部高度判定头/躯干/四肢）；`src/logic/shop.ts`（按角色过滤、置灰、购买、携带上限、弹药包即时补充与上限丢弃、弹尽提示标志）；`src/logic/inventory.ts`（6 格快捷栏、选中/取消、手持物、铲子模式）；`src/logic/spread.ts`（扩散与后坐力累加/回落）。
- [x] Step 9：测试经济与战斗规则。`tests/unit/economy.test.ts`（太阳花静止 20 s +300，TC-SUN-01；死亡期间不产出；上限 999）；`tests/unit/ammo.test.ts`（打空弹匣需换弹 TC-WPN-01；240 备弹打完第 10 个弹匣后弹尽 TC-WPN-05；弹药包超出 240 丢弃）；`tests/unit/potions.test.ts`（寒冰生效中嗑强化则替换 TC-WPN-07；30 s 过期）；`tests/unit/damage.test.ts`（爆头 68 TC-WPN-02；3 发躯干击杀 100 血 KPI-01；强化 51；超射程 ×0.5）；`tests/unit/shop.test.ts`（太阳花看不到弹药包/药剂/太阳花苗种子 TC-SHP-04、TC-PLT-04；阳光 30 买 40 失败 TC-SHP-01；达到携带上限拒绝）；`tests/unit/inventory.test.ts`（选中/再按取消；铲除不返还阳光 TC-PLT-08）。运行并通过。
- [x] Step 10：实现种植、目标优先级、导航、刷怪导演（FR3.3、FR3.4、FR5.4、FR11.1～FR11.3、FR12.1、FR12.2）。`src/logic/planting.ts`（`canPlantAt(pos, ctx): {ok, reason}`：距离 ≤ 6 m、坡度 ≤ 15°、可种植区多边形、重叠、数量上限、不可种区域类型）；`src/logic/targeting.ts`（纯函数 `chooseZombieTarget(zombie, ctx)`：玩家第一、坚果墙挡路 BREAK、豌豆射手 8 m 且正在攻击自己 / 玩家不可感知时 20 m、太阳花苗 3 m、玩家丢失 40 m 或 8 s 放弃）；`src/logic/peashooterAI.ts`（索敌最近、转向 180°/s、≤ 8° 开火、18 m 丢失）；`src/nav/graph.ts` + `src/nav/astar.ts`（A*、连通性检查、边阻断、局部重算、绕路 vs 拆墙代价）；`src/logic/spawnDirector.ts`（全局上限 40、每 3 分钟压力、视野外、15 m 禁刷、防御阵地 −30%、滞留加刷）；`src/logic/perception.ts`（视野角/距离判定、听觉事件半径）。
- [x] Step 11：测试种植、目标、导航、刷怪。`tests/unit/planting.test.ts`（5 m 平地可种 TC-PLT-01；8 m 外拒绝 TC-PLT-02；30° 坡拒绝并返回坡度原因 TC-PLT-03；第 9 株豌豆射手拒绝 TC-PLT-05）；`tests/unit/targeting.test.ts`（远处植物不理会直奔玩家 TC-AGG-01；坚果墙挡路时 BREAK TC-AGG-02；玩家不可达时攻击 20 m 内豌豆射手 TC-AGG-03；太阳花苗 3 m 内顺手拆 TC-AGG-04/05；玩家丢失 8 s 后放弃 TC-AGG-06）；`tests/unit/nav.test.ts`（A* 找到路径；阻断后绕路；不连通节点被检出）；`tests/unit/spawnDirector.test.ts`（达到 40 不再刷；15 m 内不刷；防御阵地刷新率 ×0.7）；`tests/unit/peashooterAI.test.ts`（夹角 > 8° 只转向不开火；超 18 m 丢失目标）。运行并通过。

### 阶段 E：前端行为 — 引擎、实体、世界（M0～M5）

- [x] Step 12：物理与第一人称控制器（FR2.1、FR2.2、FR2.3）。`src/physics/world.ts`（Rapier 初始化，失败时显示明确错误）、`src/physics/raycast.ts`（队伍过滤：跳过玩家、`plant` 拦截但不伤害、死亡僵尸 0.5 s 后禁用）、`src/entities/player.ts`（Pointer Lock、WASD/冲刺/跳/蹲、空中控制 40%、头部摆动与落地冲击、掉图兜底传送、受伤/濒死/死亡/重生/无敌、F 交互）。
- [x] Step 13：城市世界与资源（FR3.1、FR3.2、FR3.5、FR17.1～FR17.3）。`src/world/cityBuilder.ts`（按 `map_city_01.json` 程序化生成 4 街区、街道、人行道、≥ 4 栋带房间/走廊/楼梯的可进入建筑、地标（钟楼、加油站、超市招牌）、封锁墙、集装箱、道具，`InstancedMesh` 合批）；从 Kenney 等 CC0 库下载需要的模型与音效到 `public/assets/`，写 `src/assets/registry.ts`（id → 路径 + 程序化回退）；`docs/资源来源.md` 登记名称、URL、许可证；下载失败的条目用程序化方案并注明。
- [x] Step 14：射击与视图模型（FR4.1～FR4.6）。`src/entities/weapon.ts`（hitscan、ADS 90°→55°、后坐力、扩散、换弹打断、空仓两种音）、`src/render/decals.ts`（≤ 100 循环）、`src/render/particles.ts`（对象池：豌豆汁、血花、阳光、破土、枯萎、爆炸、结霜）、`src/render/viewModel.ts`（豌豆枪 / 太阳花捧种子手）、训练假人。
- [x] Step 15：僵尸（FR5.1～FR5.5）。`src/entities/zombie.ts`：状态机 IDLE/WANDER/ALERT/CHASE/ATTACK/AMBUSH/BREAK/HIT_REACT/DEAD，调用 `perception`、`targeting`、`nav`，分离力避让、前摇 0.3 s、受击闪白后仰、死亡 2 s 后移除并掉落阳光、减速与定身、LOD 节流、个体差异、巡逻、F4 状态显示与拆墙图标。
- [x] Step 16：植物与种植模式（FR11.1～FR11.5）。`src/entities/plants.ts`（太阳花苗、豌豆射手、坚果墙（Rapier 静态碰撞体 + 导航阻断）、炸弹花、藤蔓陷阱、寒冰射手；独立生命与摧毁动画）、`src/entities/tickManager.ts`（统一 tick，禁止 `setInterval`）、`src/render/plantPreview.ts`（绿/红预览、6 m 内可种植区网格高亮）、铲除模式。
- [x] Step 17：刷怪导演接入与游戏会话（FR12.1、FR12.2、FR6.1、FR6.2、FR7.1～FR7.3）。`src/game/session.ts`：角色初始化、重生点选择（附近僵尸最少）、刷怪导演驱动、自动存档时机（购买、种植、死亡、退出、关闭页面）、死亡统计、新手引导刷怪点。

### 阶段 F：前端行为 — 界面与音频（M4、M6）

- [x] Step 18：UI（FR14.1～FR14.5、FR9.1～FR9.3）。`src/ui/`：加载进度、主菜单（开始/继续/设置/操作说明/删除存档二次确认）、角色选择（属性对比表）、HUD（通用 + 豌豆枪手专属 + 太阳花专属：无准星、种子轮盘、计数）、商店（5 页签、角色过滤、置灰、飘字、弹尽常驻提示、0.15 s 动画、数字键快捷购买）、暂停菜单与键位表、设置（灵敏度、三路音量、画质三档实际生效、头部摆动、反转 Y）、死亡提示、横幅、引导（按角色分步、可跳过）、小地图、F3 调试面板、全部 `data-testid`；`strings.zh-CN.ts` 集中文案；1280×720 与 1920×1080 自适应。
- [x] Step 19：音频（FR15.1～FR15.3）。`src/audio/audioManager.ts`：3D 定位音、两条背景音乐按附近僵尸数交叉淡入淡出、结霜音、随机音高、三路音量；资源缺失时用 Web Audio 合成回退；资源总量 ≤ 10 MB。
- [x] Step 20：性能（NFR1～NFR4）。实例化与合批、对象池、LOD 节流、阴影与粒子按画质档调整；F3 面板显示 Draw Call 与三角面数。

### 阶段 G：构建配置与文档

- [x] Step 21：构建配置（FR18.1）。`npm run build`（`tsc --noEmit && vite build`）、`npm run preview`；Rapier WASM 打包验证；`npm run docs:numbers` 从 JSON 生成 `docs/数值表.md`（TR-CFG-03）。运行构建确认通过，运行全部单元测试确认通过。
- [x] Step 22：文档与追溯（FR18.2）。`README.md`（运行方式、键位）、`docs/里程碑验收记录.md`（M0～M6 逐条清单，截图项标注待补）、`docs/资源来源.md` 完整。

### 阶段 H：修订 — 僵尸模型与动作精细化

> 修订来源（需求方原话）：「僵尸的模型有点粗糙啊，能不能做的精美一点，还有僵尸的动作也要精美一点」

- [x] Step 23：精细化僵尸模型（FR5.1、FR4.2、FR17.2）。把 `src/entities/zombieManager.ts` 里 6 个方块拼的僵尸，换成分层骨架的精细低多边形模型，卡通 PvZ 风格：棕色破西装 + 红领带、衬衫领口、骨盆、上臂/前臂/手掌与手指、大腿/小腿/鞋、脖子、头部（凹陷眼窝与眼珠、眉骨、下颌可开合、牙齿、稀疏头发、耳朵）。用圆滑几何体（胶囊、球、车削体，适度分段）代替方块，加顶点色明暗、衣服破损与补丁细节、皮肤斑块。每种部件仍是一个 `InstancedMesh`，所以无论多少只僵尸，僵尸的 Draw Call 都只等于部件种类数（目标 ≤ 16），不突破 NFR1 的 ≤ 150 总预算。个体差异：身高 ±5%、体型、衣服和皮肤配色、是否缺一只手臂或歪头，用可播种 PRNG 决定。比例保持头部在局部高度 1.5～1.8 m，部位判定（TR-HIT-01）不变。新模型放在 `src/render/zombieRig.ts`，部件定义写进 `game.json`（或新的 `zombie_visual.json`），不在代码里写死数值。
- [x] Step 24：精细化僵尸动作（FR5.1、FR-AI-08/09/10）。新建纯逻辑模块 `src/logic/zombiePose.ts`：按状态给出各关节角度的程序化动画，并在状态切换时做 0.15～0.25 s 的姿态混合，不再瞬间跳变。具体动作：
  - IDLE：重心左右晃，头轻微抽动，下颌咀嚼
  - WANDER：蹒跚步，一条腿拖地、肩膀高低不平、手臂下垂摆动，有膝盖与肘部弯曲
  - ALERT：头先转向目标、身体跟着转，下颌张开低吼，双臂抬起
  - CHASE：前倾踉跄快步，双臂前伸，步频随移速
  - ATTACK：0.3 s 前摇（后仰蓄力，与 FR-AI-08 前摇时间对齐）→ 前扑抓击 → 收回
  - BREAK：双臂交替捶打
  - HIT_REACT：按受击方向后仰并甩头，0.15 s 内恢复
  - DEAD：膝盖先软、再随机向前或向后倒下，手臂随惯性甩动，最后着地静止
  - AMBUSH：蹲伏静止，触发后起身
  - 被藤蔓定身时挣扎，被减速时动作放慢
  
  `zombieManager.render` 只负责把姿态写进实例矩阵。LOD：> 60 m 的僵尸用简化姿态，> 120 m 冻结（与 FR-AI-20 一致）。
- [x] Step 25：测试姿态逻辑。新增 `tests/unit/zombiePose.test.ts`：ATTACK 在 0.3 s 时到达前摇最大后仰、随后前扑；状态切换时混合权重在混合时长内从 0 平滑升到 1；DEAD 动作结束后停在倒地姿态不再变化；减速时步频按比例降低。运行 `npx vitest run tests/unit`，全部通过；运行 `npm run build`，通过。

### 阶段 I：修订 — 多种僵尸类型

> 修订来源（需求方原话）：「你参考植物大战僵尸游戏中的设定，再多加一些不同类型的僵尸，比如撑杆跳僵尸（速度更快，可以跳），铁桶僵尸（血条厚）等等」
>
> 这项修改推翻了源文档 NG-07「本期 1 种僵尸」，以需求方这次的要求为准。数值来源：
> - 源文档 8.1 已登记的三项：路障僵尸 +200 护甲、铁桶僵尸 +500 护甲且慢速、跳跃僵尸能翻越障碍。
> - 其余数值参照 PvZ 原作中各僵尸的相对强弱换算，统一标为【待调参】。
>
> 所有僵尸的移速仍低于玩家步行的 4.5 m/s，所以 D-29「玩家永远可以脱战」不变。

保留普通僵尸，新增 6 种：

| 类型 | id | 本体生命 | 护甲 / 道具 | 移速（游荡 / 追击，m/s） | 特殊行为 | 掉落阳光 |
| --- | --- | --- | --- | --- | --- | --- |
| 路障僵尸 | `conehead_zombie` | 100 | 路障 200，戴在头上 | 0.8 / 1.4 | 路障被打掉后变回普通僵尸外观 | 15 |
| 铁桶僵尸 | `buckethead_zombie` | 100 | 铁桶 500，戴在头上；命中时有金属声 | 0.7 / 1.2 | 铁桶被打掉后变回普通僵尸外观 | 25 |
| 撑杆跳僵尸 | `pole_vaulter_zombie` | 170 | 撑杆（不算护甲） | 1.0 / 3.0（持杆时） | 追击途中遇到 2 m 内的第一株植物或坚果墙，就撑杆跳过去。只跳一次，过程约 1 s，期间不受藤蔓影响。跳完丢掉撑杆，追击速度降为 1.4 | 20 |
| 读报僵尸 | `newspaper_zombie` | 100 | 报纸 50，挡在身前 | 0.6 / 1.0 | 报纸被打烂后暴怒：先怒吼 0.6 s，之后追击速度升到 3.2 | 15 |
| 铁门僵尸 | `screendoor_zombie` | 100 | 铁门 550，只挡来自正面 ±60° 的射击 | 0.7 / 1.1 | 从侧面或背后开枪直接打到本体；爆炸同时伤到门和本体；门被打烂后变回普通僵尸外观 | 30 |
| 橄榄球僵尸 | `football_zombie` | 100 | 头盔 700，护住头部和躯干 | 1.2 / 2.6 | 追击时用冲锋姿态；攻击伤害 15 | 35 |

- [x] Step 26：多类型僵尸的数据与规则（纯逻辑）。
  - **配置**：`zombies.json` 新增 6 个条目，结构与 `basic_zombie` 相同，另加两组字段，参数全部写在 JSON 里：
    - `armor`：护甲类型、生命值、保护部位（`head` / `body` / `front`）、正面防护角度、打掉后掉落的道具 id。
    - `abilities`：`poleVault`、`newspaperRage`、`charge` 等。
  - **新文件 `src/logic/armor.ts`**（护甲结算）：
    - 伤害先扣护甲，溢出部分继续打本体。
    - 爆头倍率只对本体生效；打在铁桶、路障、头盔上一律按 ×1 计算。
    - 铁门只挡来自正面 ±60° 的射击。
    - 爆炸（炸弹花、手雷）同时伤到护甲和本体。
    - 护甲被打掉时发出 `armorBroken` 事件。
  - **新文件 `src/logic/zombieAbilities.ts`**（特殊能力）：
    - 撑杆跳：判断是否触发、保证只跳一次、算出起跳点和落地点、跳完切换移速。
    - 读报：报纸被打烂后暴怒，0.6 s 后提速。
    - 橄榄球：冲锋。
  - **`spawnDirector.ts`**（按街区和压力等级决定刷哪些类型）：
    - 起点街区只刷普通僵尸和路障僵尸。
    - 商业街加入撑杆跳僵尸和读报僵尸。
    - 住宅区加入铁门僵尸。
    - 工业区加入铁桶僵尸和橄榄球僵尸。
    - 压力每升一级，重甲类型的出现权重提高。
    - 每种类型有同屏上限（如橄榄球僵尸 ≤ 4、铁桶僵尸 ≤ 6），全局上限 40 不变。
    - 权重和上限写在 `map_city_01.json`（刷怪点 / 街区配置）和 `game.json` 里。
  - **经济**：击杀奖励按各类型的 `sunDrop` 发放，豌豆射手击杀也算。
  - **`validate.ts`**（配置校验）：
    - 刷怪点引用的类型必须存在。
    - 权重不能为负，且总和大于 0。
    - 护甲字段必须完整。
    - 所有类型的追击速度必须低于玩家步行速度，以保证 D-29。
- [x] Step 27：测试多类型规则。
  - 新增 `tests/unit/armor.test.ts`：
    - 路障先吸收 200 点伤害，之后才伤到本体；溢出伤害正确结转。
    - 爆头打在铁桶上，伤害不翻倍。
    - 铁门挡住正面射击；从侧面或背后射击能打到本体。
    - 爆炸同时伤到门和本体。
  - 新增 `tests/unit/zombieAbilities.test.ts`：
    - 撑杆跳僵尸遇到 2 m 内的坚果墙就起跳，只跳一次，跳完速度降为 1.4。
    - 跳跃过程中不会被藤蔓定身。
    - 读报僵尸的报纸被打烂后，0.6 s 后提速到 3.2。
  - 补充 `spawnDirector.test.ts`：
    - 起点街区不刷铁桶僵尸和橄榄球僵尸。
    - 每种类型的同屏上限生效。
    - 压力升级后重甲类型的权重提高。
  - 补充 `config.test.ts`：追击速度不低于玩家步行速度的类型会被校验拒绝。
  - 补充 `economy.test.ts`：击杀铁桶僵尸获得 25 阳光。
  - 运行 `npx vitest run tests/unit`，全部通过。
- [x] Step 28：多类型僵尸的实体、模型与动作。
  - **实体（`zombie.ts`）**：按类型读取配置，接入护甲和特殊能力；新增 `VAULT`（撑杆跳）和 `RAGE`（读报暴怒）两个状态；F4 调试显示同时列出类型名和状态。
  - **模型（`zombieRig.ts` / `zombieGeometry.ts`）**：
    - 新增配件：
      - 路障：橙色锥体带反光条，受损后有凹痕。
      - 铁桶：带凹痕和铆钉。
      - 撑杆。
      - 报纸：印字效果用顶点色画出。
      - 铁门：带纱网和把手。
      - 橄榄球头盔和护肩，加队服配色。
    - 配件同样是每种部件一个实例化网格；僵尸主渲染的 Draw Call 总数不超过 24。
    - 护甲被打掉时，配件作为道具掉落：翻滚落地，2 s 后淡出（用对象池）。铁桶和头盔掉落时有金属声。
  - **动作（`zombiePose.ts`）**：
    - 撑杆跳：持杆奔跑 → 插杆 → 划弧线跃过 → 落地踉跄。
    - 读报：边走边看报；报纸被撕烂后跺脚怒吼，然后狂奔。
    - 铁门：双手举门前进。
    - 橄榄球：低头冲锋。
    - 路障、铁桶：沿用普通僵尸的动作；护甲受击时头部晃得更厉害。
    - 新动作全部接入现有的姿态混合。
  - **音效**：铁桶、铁门、头盔受击时有金属声；读报僵尸暴怒时有吼声；找不到资源时用 Web Audio 合成。
  - **HUD**：击杀飘字按僵尸类型显示获得的阳光数。
- [x] Step 29：姿态测试与收尾。
  - 补充 `zombiePose.test.ts`：
    - `VAULT` 过程中，根节点高度先升后降，落地后回到地面。
    - `RAGE` 结束后切换到奔跑步频。
  - 运行 `npx vitest run tests/unit` 和 `npm run build`，全部通过。
  - 运行 `npm run docs:numbers`，重新生成 `docs/数值表.md`，覆盖所有僵尸类型。
  - 更新文档：
    - `README.md`：新增「僵尸图鉴」一节。
    - `docs/里程碑验收记录.md`：新增「多类型僵尸」一节，注明推翻了 NG-07、尚待浏览器确认。

## 需求追溯

| 需求 | 计划步骤 |
| --- | --- |
| FR1 骨架与循环 | 1、7、21 |
| FR2 移动 | 12 |
| FR3 城市与导航 | 3、10、11、13 |
| FR4 射击 | 8、9、14 |
| FR5 僵尸 AI | 10、11、15 |
| FR6 生命与重生 | 12、17 |
| FR7 双角色 | 3、17、18 |
| FR8 阳光经济 | 8、9 |
| FR9 商店 | 8、9、18 |
| FR10 快捷栏与铲子 | 8、9、16 |
| FR11 种植 | 10、11、16 |
| FR12 刷怪导演 | 10、11、17 |
| FR13 存档 | 5、6、17 |
| FR14 界面 | 18 |
| FR15 音频 | 19 |
| FR16 配置 | 3、4、5、21 |
| FR17 资源 | 13 |
| FR18 交付与记录 | 21、22 |
| NFR1～NFR4 性能稳定 | 13、14、20 |
| NFR5 兼容 | 21 |
| NFR6 可维护 | 1、全部 |
| NFR7 测试 | 2、4、6、9、11 |
| NFR8 本地单机 | 5（运行时无网络请求；资源在构建前下载到本地） |
