# 代码质量评估

## 总评

| 维度 | 评级 | 依据 |
| --- | --- | --- |
| 命名清晰度 | good | 文件 / 函数名自解释，头注释引用需求编号 |
| 函数规模 | fair | 纯逻辑函数短小；`Session`、`Zombie`、`zombiePose` 偏大 |
| 错误处理 | good | 启动失败显示错误屏；存档 / 设置读写捕获异常；事件处理器异常被隔离；配置热重载失败保留旧配置 |
| 测试覆盖 | fair | 19 个纯逻辑测试文件；实体、Session、App、UI 无测试；未配置覆盖率 |
| 重复 | good | 共享 `math.ts`、`applyHealthDamage`、实例池 |
| 死代码 | good | `noUnusedLocals` / `noUnusedParameters` 开启；未发现 TODO / FIXME / 抑制注释 |

## 测试

- 框架：Vitest，Node 环境，`tests/unit/`。
- 覆盖：ammo、armor、config、damage、droppedProp、economy、inventory、layout、nav、peashooterAI、planting、potions、save、shop、smoke、spawnDirector、targeting、zombieAbilities、zombieGeometry、zombiePose。
- `tests/unit/helpers.ts` 固定加载 `map_city_01.json`。
- 本次未运行测试套件（逆向工程阶段不改代码）；基线留给 Code Generation 前的 Test Baseline。

## 工具链与流程

- 无 ESLint / Prettier 配置，代码风格靠 TypeScript 严格选项与约定维持。
- 无 CI 流水线文件；`npm run build` 包含类型检查。
- 文档：`README.md` 完整；`docs/数值表.md` 由脚本生成。

## 技术债与风险（守卫模式相关，唯一记录处）

1. **单地图假设贯穿全栈**
   - `config/loader.ts` 静态 import `map_city_01.json`，HMR 的 `KEYS` 与 accept 列表按下标对应。
   - `AllConfig.map` 只有一个 `MapConfig`；`store` 单例同一时刻只有一份配置。
   - `validateMap` 写死 `MIN_PLAYER_SPAWNS = 6`、`MIN_ZOMBIE_SPAWNERS = 12`、`MIN_ENTERABLE_BUILDINGS = 4`，`validateSpawnTypes` 要求 `districtZombieTypes`；环形地图需要单独的校验规则。
   - `tests/unit/helpers.ts` 只认城市地图。
2. **世界在 boot 时一次性构建**：`App.boot()` 生成 layout / City / nav 后跨 Session 复用；`City` 没有 dispose，`PhysicsWorld` 的静态碰撞体不回收。按模式切换地图需要补回收逻辑或同时预建两张地图。
3. **布局生成器只懂城市**：`generateLayout` 写死十字路、正方形边界墙、建筑模板（房间名固定为 `hall/backLeft/backRight/upstairs/upstairsBack`）。`MapConfig.size` 是正方形，小地图（`ui/minimap.ts`）也按 `size[0]` 缩放并画十字路与 `highValueAreas`。
4. **航点构建是平面网格**：`buildNavGraph` 的网格节点 `y: 0`，障碍只支持轴对齐 `Rect2`。高架层与坡道需要通过 `extraNodes` / `extraEdges` 显式提供，圆环墙要用多段矩形近似；`nearestNode` 对 y 差乘 3 加权，多层时要留意误选。节点标签约定 `outdoor` / `door` / `in:<id>` 被 `Zombie.nodeFor` 依赖。
5. **目标优先级玩家优先**：`chooseZombieTarget` 无仇恨即 `WANDER`、失去玩家即 `WANDER`，没有核心分支；`Zombie.currentGoal()` 兜底目标永远是玩家；`think()` 只在 `hasAggro` 时决策。
6. **刷怪导演绑定自由探索**：刷怪点要在玩家 `activationRadius` 内、距离 ≥ 15 m、不在视野内才刷；压力等级按累计时间。`需求文档2.md` §5.4 指出环形地图下「视野外才刷」可能永不刷怪。`Session.runDirector` 每帧新建 `Frustum` 与 `Matrix4`。
7. **`Session` 职责集中**：构造函数无条件生成伏击僵尸（`spawnAmbushers`）、训练假人、补给点；新手引导在 `Hud` 中；没有模式开关。
8. **存档单槽位**：`pvz3d.save.v1` 与 `SaveData` 无模式字段；`Session.save()` 在开局 / 种植 / 购买 / 死亡 / 暂停 / 页面隐藏时都写入，守卫模式若不隔离会覆盖自由模式进度；`showCharacterSelect` 新开局会 `deleteSave`。
9. **队伍类型封闭**：`IAttackable.team` 只有 `player | zombie | plant`，`ColliderTeam` 只有 `world | player | zombie | plant | door`；武器射线、种植瞄准按队伍过滤。
10. **LOD 以玩家距离计算**：`Zombie.update` 在离玩家 > `lodFarDistance`（120 m）时直接返回、> 60 m 降到 5 Hz；`ZombieManager.CAPACITY = 64`。僵尸冲核心而玩家在远处时会被冻结或降频。
11. **工作区未提交改动**：Revision 2 的多个文件尚未提交（armor、zombieAbilities、zombiePose、zombieRig 等）；本次知识库指纹按磁盘内容计算。
