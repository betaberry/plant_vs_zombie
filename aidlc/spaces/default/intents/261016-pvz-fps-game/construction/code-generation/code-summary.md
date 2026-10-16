# 代码生成总结

## 结果

- 计划 22 步全部完成。
- `npm run build`（`tsc --noEmit && vite build`）通过：`dist/` 约 5.1 MB，其中 Rapier WASM 分块 4.3 MB（gzip 后 1.6 MB）。
- `npx vitest run tests/unit`：15 个文件、65 条测试全部通过。
- **尚未在浏览器中试玩。** 手感、FPS、Draw Call、两种分辨率下的布局、截图都还没有验证。

## 文件

| 位置 | 内容 |
| --- | --- |
| 根目录 | `package.json`（版本锁定：three 0.186.1、@dimforge/rapier3d-compat 0.21.0、vite 7.3.7、typescript 5.9.3、vitest 5.0.5、@types/three 0.186.0）、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts`、`index.html`、`README.md`、`scripts/gen-numbers.mjs` |
| `src/config/` | 7 个 JSON（第 11 章的 6 个 + `game.json`）、`types.ts`、`validate.ts`、`loader.ts` |
| `src/core/` | `loop.ts`、`rng.ts`、`events.ts`、`store.ts`、`commands.ts` |
| `src/logic/` | 经济、弹药、药剂、伤害、部位、商店、快捷栏、扩散、`canPlantAt`、区域、感知、目标优先级、豌豆射手 AI、刷怪导演、存档、`IAttackable` |
| `src/nav/` | 航点图（可阻断边）、A*（绕路 vs 拆墙）、网格构建 |
| `src/physics/` | Rapier 封装、带队伍过滤的射线检测 |
| `src/world/` | `layout.ts`（纯数据城市布局）、`cityBuilder.ts` |
| `src/entities/` | 玩家、豌豆枪、训练假人、僵尸、僵尸管理器、植物、tick 管理器、拾取物 |
| `src/render/` | 渲染器与画质档、实例化池、粒子、弹孔、视图模型、种植预览 |
| `src/game/` | `app.ts`、`session.ts`、`input.ts` |
| `src/audio/` | `audioManager.ts`、`synth.ts`（Web Audio 合成回退） |
| `src/ui/` | 界面、HUD、商店面板、小地图、样式、`strings.zh-CN.ts` |
| `public/assets/audio/` | 38 个 Kenney CC0 `.ogg`（约 0.29 MB）及许可证 |
| `tests/unit/` | 15 个测试文件 + `helpers.ts` |
| `docs/` | `资源来源.md`、`数值表.md`（由脚本生成）、`里程碑验收记录.md` |

## 关键实现决定

- **新增 `game.json`**：移动参数、生命规则、刷怪导演参数、UI 时长、画质档位这些全局数值，在第 11 章的 6 个文件里没有位置。为满足「数值全部在 JSON 中」新增了这个文件，它同样纳入校验和数值表。
- **城市在代码里生成**：按 `map_city_01.json` 生成。共 4 个街区、5 栋可进入建筑（每栋有大厅、2 个后房间、楼梯、2 个二楼房间）、7 个重生点、14 个刷怪点、6 个埋伏点，工业区有 30° 和 10° 两条坡道。已有测试确认真实地图上没有不连通的航点。
- **坚果墙会改变寻路代价**：受影响的边加上拆墙代价，A* 自然会在绕路和拆墙之间选更便宜的那个；只有路径经过这些边的僵尸才重新算路（TR-NAV-04）。
- **用实例化压低 Draw Call**：城市、僵尸、植物、拾取物、弹孔都用实例化渲染；粒子是一个对象池化的点系统；第一人称视图模型单独渲染一遍。
- **3D 模型全部程序化生成**：按 13.8-A 做卡通低多边形，没有下载模型包，换皮时在 `src/assets/registry.ts` 登记文件即可。音效里，命中、界面、脚步这些用 Kenney 的 CC0 素材；枪声「噗」、僵尸低吼、背景音乐、风声、爆炸、心跳用 Web Audio 合成。
- **vitest 锁到 5.0.5**：3.x 版本的依赖带有 `npm audit` 报告的严重漏洞，换版本后为 0。

## 与计划和需求的偏差

1. **手雷（P1）没有实现**，在 `shop.json` 里设为 `enabled: false`。如果按源文档把手雷同时开放给两个角色，太阳花能同时持有的道具会有 7 种，超过 6 格快捷栏，违反 TR-CFG-05，配置校验会报错（已有测试覆盖）。可选的处理：手雷只给豌豆枪手、去掉一种种子，或者放宽这条规则。
2. **部分实现的 P1 需求**：FR-WPN-11（受击方向指示）没做；FR-WPN-12 只按材质区分了音效，没区分粒子；FR-MAP-08 的可打碎门窗没做，门只能按 F 开关；FR-AI-13 门口聚集没做；FR-SPD-06 环境预警只做了一部分。这些都记在 `docs/里程碑验收记录.md` 里。
3. **P2 不做**：护甲板、加速鞋在配置里设为 `enabled: false`。
4. **测试数量**：计划写的是约 30 条，实际 65 条，多出来的主要是边界和异常用例，另外新增了 `layout.test.ts`，验证地图连通性和建筑结构。

## 测试覆盖

- 每个纯逻辑组件至少有一条正常路径测试，并覆盖了边界和异常情况。
- 已覆盖的源文档用例：TC-SUN-01/02、TC-WPN-01/02/05/07、KPI-01、TC-SHP-01/04、TC-PLT-01/02/03/04/05/08、TC-AGG-01～06、TC-SAV-01。
- 浏览器内的渲染、输入、UI、音频不在单元测试范围内（Minimal 策略），需要在浏览器里试玩验证。
- 代码生成过程中，用真实的 Rapier 在 Node 里跑过几项临时冒烟检查，跑完已删除：玩家能爬上二楼（3.37 m），冲向钟楼不会穿墙，僵尸会追击并攻击玩家，豌豆射手能击杀僵尸。
