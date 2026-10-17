# 代码生成总结（守卫模式）

## 结果

- 计划 17 步全部完成。
- `npx vitest run tests/unit`：28 个文件、179 条全部通过（原有 110 条 + 新增 69 条）。
- `npx tsc --noEmit`：0 错误；`npm run build`：通过；`docs/数值表.md` 已重新生成。
- **尚未在浏览器里试玩。** 需要试玩确认的项在 `docs/守卫模式验收记录.md` 里标为 🟡。

## 新增与改动的文件

| 位置 | 内容 |
| --- | --- |
| `src/config/data/challenge.json`（新） | 三档难度、波次类型解锁顺序与权重、入口开放曲线、刷怪间隔、同屏上限 40、BOSS 血量、核心损坏阶段、接近半径、刷怪判据 |
| `src/config/data/map_ring_01.json`（新） | 螺旋同心环地图参数 |
| `src/config/data/zombies.json` | 新增 `gargantuar_zombie`、`imp_zombie`（`guardOnly`） |
| `src/config/data/game.json` | 巨人僵尸 / 小鬼动画块与新配件颜色 |
| `src/config/types.ts`、`validate.ts`、`loader.ts` | `maps.{city_01, ring_01}` + `challenge`；按地图类型分开校验 |
| `src/logic/guardSave.ts`（新） | 守卫模式独立存档 `pvz3d.guard.save.v1` |
| `src/logic/waveDirector.ts`（新） | 波次引擎 |
| `src/logic/guardRules.ts`（新） | 失败判定、重开快照、核心血量规则、难度倍率、损坏阶段、刷怪判据 |
| `src/logic/guardTargeting.ts`（新） | 冲核心目标规则、植物被拆后的仇恨转移、LOD 距离 |
| `src/logic/bossAbilities.ts`（新） | 砸击、扔小鬼 |
| `src/world/ringLayout.ts`（新） | 环形地图布局与航点（纯数据） |
| `src/nav/build.ts` | 支持只用显式节点 / 边建图 |
| `src/game/world.ts`（新）、`guardRun.ts`（新） | 按模式构建世界；守卫模式一局的驱动（刷怪、失败、通关、重开、小鬼落地） |
| `src/entities/coreHouse.ts`（新） | 核心房 |
| `src/game/app.ts`、`session.ts`、`src/entities/zombie.ts`、`zombieManager.ts`、`src/physics/world.ts`、`raycast.ts` | 接入模式、核心、守卫目标规则、只拦僵尸的门 |
| `src/render/zombieRig.ts`、`zombieGeometry.ts`、`src/logic/zombiePose.ts` | 体型缩放、电线杆和背上小鬼配件、砸击 / 扔小鬼 / 小鬼快跑姿态 |
| `src/ui/`（`screens.ts`、`hud.ts`、新 `RingMinimap`、`strings.zh-CN.ts`） | 模式选择、守卫菜单与难度卡片、守卫 HUD、失败 / 通关界面、环形小地图 |
| `tests/unit/` | 新增 `challengeConfig`、`guardSave`、`waveDirector`、`guardRules`、`guardTargeting`、`bossAbilities`、`ringLayout`、`guardVisuals`；更新 `config`、`helpers`、`zombieGeometry` |
| `README.md`、`docs/守卫模式验收记录.md`（新）、`docs/数值表.md` | 文档 |

## 关键实现决定

- **环形地图**：三圈半径 50 / 32 / 16 m 是环道中心线，环道宽 8 m；环道之间是实心墙带，用每 5° 一段的旋转盒子拼成；「坡道」是墙带上的平缺口。高架层是外圈与中圈之间墙带的顶面（200°～340°，高 4 m），两端各有一段楼梯。核心房外有 8 个攻击站位点，房内没有航点。测试确认最短路程约 95 m、最长约 190 m，都在 ±20% 内。
- **核心房的门**：用 Rapier 碰撞组在门口放了只拦僵尸的隐形挡板，玩家能进出，射线不受影响。
- **巨人僵尸与小鬼**：复用分层骨架，体型分别缩放 2 倍和 0.6 倍；新增电线杆和背上小鬼两个配件（扔出后背上的小鬼隐藏）。BOSS 不会被打出受击硬直，砸击前摇不会被打断。小鬼落点会检查是否是可行走的地面。
- **BOSS 刷新**：在最后一波中途额外加 1 只，不占单波数量上限；同屏 40 只的上限会让队列等待，不会丢掉要刷的僵尸。
- **练习模式保护**：`guardOnly` 标记让巨人僵尸和小鬼不能出现在城市刷怪表和普通波次里；练习模式的代码只在 `mode === 'guard'` 时分支。
- **核心被摧毁时不写存档**，保留上一次正常的存档点。

## 与需求的偏差和需要你知道的地方

1. **坚果墙不算「8 m 内的植物」**（FR7.3）：如果算，僵尸会停下来啃每一面路过的坚果墙。现在坚果墙只在「挡路且绕不过去」时被拆（FR7.4）。如果你希望坚果墙也触发接近规则，改一行即可。
2. **难度血量倍率只乘本体血量**，不乘护甲（路障、铁桶等）。
3. **仇恨只由枪和射手类植物产生**：炸弹花爆炸、藤蔓陷阱不会让僵尸记仇；但 8 m 接近规则仍会让僵尸转向附近的植物。
4. **核心房崩塌只是视觉效果**，碰撞体不变，防止玩家或僵尸掉进房子里。
5. **没有新增音效**：砸击用爆炸声、开波用怒吼声。
6. **Draw Call**：僵尸主渲染从 24 个增加到 26 个（电线杆、背上小鬼），测试断言 ≤ 26；核心房约 5 个。总数是否 ≤ 150、FPS 是否达标，需要用 F3 面板实测。
7. **FR7.5 的理解**：僵尸拆掉正在攻击的植物后，仇恨转移到这株植物的主人（玩家）。

## 测试覆盖

- 每个新逻辑模块都有单元测试（正常路径 + 边界用例）：配置校验、存档、波次引擎、失败与重开、目标规则、BOSS 能力、环形地图布局与寻路、BOSS 视觉参数。
- 原有 110 条测试全部保持通过。
- 浏览器内的行为（高架层能不能走上去、门是否只拦僵尸、僵尸绕环的实际路线、动作观感、HUD 与小地图布局、帧率）不在单元测试范围内，需要试玩确认。
