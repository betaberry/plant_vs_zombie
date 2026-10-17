# 代码生成计划 — 守卫模式

## Summary

- Builds: 守卫模式（S1 + S2）：模式入口、螺旋同心环地图、核心房、波次引擎、三档难度、失败重开、冲核心 AI、巨人僵尸 BOSS 与小鬼、结算界面、独立存档、HUD
- Touches: `src/config/`（新 `challenge.json`、`map_ring_01.json`、类型与校验）、`src/logic/`（新 `waveDirector.ts`、`guardRules.ts`、`guardTargeting.ts`、`bossAbilities.ts`）、`src/world/`（新环形布局生成器）、`src/nav/`、`src/entities/`、`src/game/`、`src/ui/`、`src/render/`、`tests/unit/`、`README.md`、`docs/`
- Tests: 约 30 条新增 Vitest 单元测试（波次、难度、失败重开、目标规则、BOSS、存档、环形地图寻路），现有 110 条保持通过

## 输入

- 需求：`aidlc/spaces/default/intents/261017-guard-mode/inception/requirements-analysis/requirements.md`（FR1～FR12、NFR1～NFR5）
- 数值与规则来源：`需求文档2.md` v0.3
- 现有代码知识库：`aidlc/spaces/default/codekb/plant_vs_zombie/`（接入点与技术债见 `code-quality-assessment.md`、`architecture.md`）
- express 范围，没有单独的设计阶段；设计决定写在下面「架构」一节。

## 架构

| 关注点 | 决定 | 理由 / 放弃的方案 |
| --- | --- | --- |
| 模式 | 新增 `GameMode = 'practice' \| 'guard'`，从主菜单一路传进 `Session`；练习模式的代码路径保持不变 | 放弃「另写一个 Session 类」：重复太多；用模式开关只关掉补给点 / 假人 / 城市埋伏 / 刷怪导演，换上波次引擎 |
| 地图 | `AllConfig.maps` 改为按 id 索引（`city_01`、`ring_01`）；新增 `generateRingLayout` 输出与城市相同的 `CityLayout` 接口；每局按模式构建 / 销毁世界（给 `City` 加 `dispose`，回收碰撞体与网格） | 放弃「启动时同时预建两张地图」：内存和碰撞体翻倍 |
| 弧形环墙 | 用多段轴对齐矩形 + 旋转盒碰撞体近似弧墙；航点按环道中心线等距撒点，再显式连接坡道 / 楼梯 / 高架层（`extraNodes/extraEdges`） | 现有导航只支持平面网格与轴对齐障碍（代码扫描结论） |
| 核心 | `CoreHouse` 实现 `IAttackable`，`team: 'core'`；扩展 `Team` 与 `ColliderTeam`；核心房内不放航点，门只对玩家开放（僵尸碰撞组过滤） | |
| 波次 | 纯逻辑 `waveDirector.ts`：`createWaveState(difficulty)` + `stepWave(state, input, dt)`，输入时间 / 按 F / 存活数 / 失败事件，输出要刷的 `{type, entrance}` 与阶段（`intermission`、`active`、`cleared`、`failed`、`victory`） | 与现有 `createXState + stepX` 写法一致，可单元测试 |
| 目标 | 纯逻辑 `guardTargeting.ts`：`chooseGuardTarget(zombie, ctx)`，优先级 仇恨 → 接近（玩家 12 m / 植物 8 m）→ 受阻拆墙 → 核心；`Zombie` 按模式选用原 `chooseZombieTarget` 或它 | 练习模式完全不受影响 |
| LOD | 守卫模式下按「到玩家或核心的较近距离」算 LOD | 防止冲核心的僵尸被冻结 |
| BOSS | `gargantuar_zombie`、`imp_zombie` 加入 `zombies.json`；纯逻辑 `bossAbilities.ts`（砸击前摇与范围、半血扔小鬼只一次、落点计算）；新模型复用分层骨架与姿态系统，体型缩放 + 专属配件（电线杆、背上小鬼） | 放弃全新骨架：工作量大，风格不统一 |
| 存档 | 守卫模式独立键 `pvz3d.guard.save.v1`，`GuardSaveData` 带版本号；保存波次间状态 | 两种模式互不覆盖 |

## Testing Contract
```json
{
  "version": 1,
  "methodology": "test-after",
  "source": "org",
  "ordering": "implement each applicable testable layer, then write and run that layer's tests.",
  "scope": "express",
  "test_strategy": "minimal",
  "project_type": "brownfield",
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
    "runner_step": "Verify the existing test runner/configuration and record the exact unit-scoped command.",
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
      "Verify the existing test runner/configuration and record the exact unit-scoped command.",
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
  "input_sha256": "sha256:c8f84e35190e007d9863fad236154d0269ab9bf633fc2a3ff106ed965ba4a9b9",
  "contract_sha256": "sha256:bb76c1b22f8307be6e5780d50cabab891684449d5b164bd0e825e9e4e5c61e5b"
}
```

层映射说明：没有数据库和 HTTP API。「Data model」= JSON 配置与校验；「Repository / data access」= 配置加载与存档；「Business logic」= `src/logic/`、`src/nav/`、环形布局生成器（纯数据）；「API / endpoint」不适用（以 `GameCommand` 入口代替）；「Frontend behavior」= 实体、渲染、UI、音频，靠构建与浏览器试玩验证。

## 步骤

### 阶段 A：准备

- [x] Step 1：确认现有测试运行器。运行 `npx vitest run tests/unit` 与 `npx tsc --noEmit`，记录基线（预期 110 条通过、0 类型错误）。

### 阶段 B：数据模型 — 配置

- [x] Step 2：配置（FR1、FR2.1、FR2.6、FR5、FR8.7、NFR3）。
  - 新增 `src/config/data/challenge.json`：三档难度全部参数（需求 FR5.1）、波次类型引入顺序、入口开放曲线、刷怪间隔基数与每波 ×0.9、BOSS 血量按难度、核心损坏阶段阈值（75/50/25/0%）、倒计时 30 s、接近半径（玩家 12 m / 植物 8 m）。
  - 新增 `src/config/data/map_ring_01.json`：三圈半径、环道宽、两层高度、核心房尺寸与位置、4 个入口与各自刷怪点组、每圈 2 个坡道角度、2 个楼梯、玩家出生点、地标位置、可种植区。
  - `zombies.json` 加入 `gargantuar_zombie`、`imp_zombie`（血量、移速 0.6 / 2.5、砸击前摇 1 s、范围、对核心 200 / 对玩家 40、一击摧毁植物、扔小鬼阈值 0.5、视觉块）。
  - `types.ts`：`AllConfig.maps` 按 id 索引、`ChallengeConfig`、环形地图类型、BOSS 能力类型。
  - `validate.ts`：按地图类型分开校验（城市规则不变；环形：入口 = 4、半径递减、环道宽 ≥ 8、核心在内圈内、刷怪点组完整）；难度参数齐全为正、单波上限 ≤ 40；BOSS 与小鬼移速低于玩家步行速度（沿用 D-29 校验）。
  - `loader.ts` 加载两张地图与 `challenge.json`。
- [x] Step 3：测试配置。补充 `tests/unit/config.test.ts`，新增 `tests/unit/challengeConfig.test.ts`：三档参数值与需求一致；环形地图缺入口 / 环道过窄被拒绝；城市地图校验不变；小鬼移速 ≥ 4.5 被拒绝。更新 `tests/unit/helpers.ts`。运行并通过。

### 阶段 C：数据访问 — 存档

- [x] Step 4：守卫模式存档（FR11）。`src/logic/guardSave.ts`：键 `pvz3d.guard.save.v1`、版本号、`GuardSaveData`（难度、角色、当前波、核心血量、阳光、物品与种子、永久强化、药剂剩余时间、植物位置类型血量）、读 / 写 / 删除；存储接口可注入；练习模式 `save.ts` 不改。
- [x] Step 5：测试存档。`tests/unit/guardSave.test.ts`：保存后读取一致；与练习模式存档互不覆盖；版本不符返回不兼容；损坏 JSON 不抛异常。运行并通过。

### 阶段 D：业务逻辑

- [x] Step 6：波次引擎与失败重开（FR4、FR5.2、FR6、FR8.1）。
  - `src/logic/waveDirector.ts`：每波数量 = 首波 + (波 − 1) × 递增，封顶单波上限；类型按引入顺序解锁并加权；刷新间隔每波 ×0.9；开放入口数按曲线并受难度上限约束；按 F 或倒计时 30 s 开波；本波全部僵尸消灭后清场，最后一波清场即通关；BOSS 只在最后一波加入 1 只，并纳入清场判定；同屏上限 40。
  - `src/logic/guardRules.ts`：失败判定（核心 ≤ 0 / 所有玩家阵亡；有存活者时阵亡者不复活）；重开当前波时保留 / 清除清单；核心血量规则（不可修复；因核心归零而失败时恢复到该波开始时的血量，其他失败保持当前值）；难度伤害、血量、阳光倍率的计算函数。
  - 刷怪判据：视锥外 且 距玩家 > 15 m 且 不在玩家指向核心方向的 45° 内（纯函数 `guardSpawnAllowed`）。
- [x] Step 7：测试波次与失败。`tests/unit/waveDirector.test.ts`：三档难度的波数、每波数量（含上限封顶）；入口开放曲线与难度上限；按 F 立即开波、倒计时到时自动开波；清场与通关判定；BOSS 只在最后一波出现且必须被消灭；刷新间隔每波 ×0.9。`tests/unit/guardRules.test.ts`：核心归零失败、玩家阵亡失败；重开保留植物 / 阳光 / 强化、清除僵尸；核心血量恢复规则；倍率计算；刷怪判据三个条件。运行并通过。
- [x] Step 8：守卫模式目标规则与 BOSS 能力（FR7、FR8.3～FR8.5）。
  - `src/logic/guardTargeting.ts`：`chooseGuardTarget`（仇恨 → 接近玩家 12 m / 植物 8 m 取最近 → 坚果墙受阻拆墙 → 核心）；植物被拆后的仇恨转移；仇恨保持 40 m / 8 s。
  - `src/logic/bossAbilities.ts`：砸击（前摇 1 s、范围内目标列表、对植物和坚果墙一击摧毁）；血量降到 ≤ 50% 时扔小鬼，只扔一次，落点在前方防线（朝核心方向前进 N 米，落在可行走处）。
- [x] Step 9：测试目标与 BOSS。`tests/unit/guardTargeting.test.ts`：默认冲核心；被玩家打后反击；玩家进入 12 m 转向、13 m 不转；植物 8 m 内转向；受阻拆墙；仇恨超时回到冲核心。`tests/unit/bossAbilities.test.ts`：半血只扔一次；砸击一击摧毁坚果墙；范围外不受伤；前摇期间不结算伤害。运行并通过。
- [x] Step 10：环形地图布局与航点（FR2.1～FR2.4）。`src/world/ringLayout.ts`：由 `map_ring_01.json` 生成纯数据 `CityLayout`（弧墙矩形段、坡道、楼梯、高架层平台、核心房、入口缺口、可种植区、刷怪点、重生点）；`src/nav/` 支持显式额外节点 / 边（多层），核心房内不放航点。
- [x] Step 11：测试环形地图。`tests/unit/ringLayout.test.ts`：0 个不连通航点；每个入口到核心外墙都有路径，最短路程在 95 m ±20%、最长在 190 m ±20% 之内；核心房内无航点；环道采样点 `canPlantAt` 可种植。运行并通过。

### 阶段 E：前端行为

- [x] Step 12：世界与核心实体（FR2、FR3）。`City` 支持按地图构建与 `dispose`（回收碰撞体、网格）；环形地图建造器（程序化几何 + 占位色块，再加地标：塔楼、水塔、集装箱堆场）；`src/entities/coreHouse.ts`：`IAttackable`、`team: 'core'`、独立碰撞体（玩家可进，僵尸不可进）、4 个损坏阶段视觉（窗户破碎、墙体裂痕、冒烟粒子、崩塌）、低于 50% 时闪红；扩展 `Team` / `ColliderTeam`。
- [x] Step 13：会话与僵尸接入（FR1、FR4、FR6、FR7、FR9）。
  - `App` 与 `Session` 接入 `GameMode`、难度。
  - 守卫模式下关闭：补给点、训练假人、城市埋伏、原刷怪导演、原 3 秒复活流程。
  - 由 `waveDirector` 驱动刷怪（走现有 spawn 命令），按 F 开波（波次之间按 F 优先用于开波，不触发交互）。
  - `Zombie` 按模式选用目标规则，能攻击核心；守卫模式下 LOD 按到玩家或核心的较近距离计算。
  - 难度倍率作用于僵尸血量、伤害、阳光收入。
  - 失败 → 失败界面 → 重开当前波。
  - 存档时机：清场、购买、种植、暂停、退出、关闭页面。
- [x] Step 14：巨人僵尸与小鬼（FR8.2、FR8.6）。模型复用分层骨架：巨人僵尸缩放约 2 倍，加电线杆和背上小鬼配件；小鬼缩放约 0.6 倍。姿态：巨人僵尸沉重步伐、抡杆砸击（1 s 前摇后砸下，地面冲击粒子 + 镜头震动）、扔小鬼动作、受击、倒地；小鬼快速小跑。BOSS 出现时 HUD 显示 BOSS 血条。新增 Draw Call 记录在代码总结里，满足总预算 ≤ 150。
- [x] Step 15：界面（FR1.1～FR1.3、FR10、FR12）。
  - 主菜单两个入口；守卫模式子菜单：继续 / 重新开始（二次确认）/ 选难度（显示三档主要参数）。
  - 守卫模式 HUD：波数 / 总波数、倒计时或剩余僵尸、「按 F 开始下一波」提示、核心血条（< 50% 闪红 + 心跳音）、BOSS 血条。
  - 失败界面：原因 + 当前波 + 重开当前波 / 返回主菜单。
  - 「守卫成功」结算界面：难度、用时、剩余核心血量；返回主菜单 / 再来一局。
  - 小地图支持环形地图：圈层、已开放入口、核心、玩家朝向。
  - 文案全部放进 `strings.zh-CN.ts`，交互元素加 `data-testid`。

### 阶段 F：构建与文档

- [x] Step 16：构建与回归。运行 `npx vitest run tests/unit`（全部通过，含原有 110 条）、`npx tsc --noEmit`（0 错误）、`npm run build`（通过）；`npm run docs:numbers` 重新生成 `docs/数值表.md`，覆盖 `challenge.json` 与新僵尸。
- [x] Step 17：文档。`README.md` 新增「守卫模式」一节（玩法、按键 F、三档难度、BOSS）；新增 `docs/守卫模式验收记录.md`（按需求 FR1～FR12 逐条勾选，标注待浏览器试玩确认的项）。

## 需求追溯

| 需求 | 计划步骤 |
| --- | --- |
| FR1 模式与入口 | 2、13、15 |
| FR2 环形地图 | 2、3、10、11、12 |
| FR3 核心房 | 6、12、15 |
| FR4 波次引擎 | 6、7、13、15 |
| FR5 三档难度 | 2、3、6、7、13 |
| FR6 失败与重开 | 6、7、13、15 |
| FR7 目标规则 | 8、9、13 |
| FR8 巨人僵尸与小鬼 | 2、6、8、9、14 |
| FR9 经济与商店 | 6、13 |
| FR10 结算与失败界面 | 15 |
| FR11 存档 | 4、5、13 |
| FR12 HUD 与小地图 | 14、15 |
| NFR1 性能 | 12、14、16 |
| NFR2 不回归 | 1、16 |
| NFR3 可配置 | 2、3 |
| NFR4 测试 | 3、5、7、9、11 |
| NFR5 本地单机 | 4 |
