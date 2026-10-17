# 业务概览

## 产品定位

`pvz3d-fps` 是浏览器里运行的《植物大战僵尸》3D 第一人称垂直切片：玩家在一座 300 m × 300 m、四个街区的程序化城市中自由探索，赚阳光、在商店买东西、种植物、打僵尸。需求来源为 `需求文档.md`（v0.3.1）；新意图 261017-guard-mode 依据 `需求文档2.md` 新增「守卫模式」。

## 核心玩法

- **两个角色**（`src/config/data/characters.json`）：豌豆枪手（有枪、可买弹药）与太阳花（无枪、被动产阳光、靠植物作战）。
- **阳光经济**（`src/logic/economy.ts`）：击杀奖励（按僵尸类型 `sunDrop`，爆头 +5）、被动产出、太阳花植物产出、地图阳光包；上限 999。
- **商店**（`src/logic/shop.ts`、`src/ui/shopPanel.ts`）：弹药、药剂、种子、消耗品、永久装备，按角色过滤，B 键打开且不暂停。
- **种植**（`src/logic/planting.ts`、`src/entities/plants.ts`）：六种植物（太阳花、豌豆射手、寒冰射手、坚果墙、炸弹花、藤蔓陷阱），有数量上限、可种区域与坡度规则；坚果墙阻断航点。
- **僵尸**（`src/entities/zombie.ts`、`src/config/data/zombies.json`）：7 种类型（普通、路障、铁桶、撑杆跳、读报、铁门、橄榄球），带护甲与特殊能力；「顺路」目标优先级以玩家为先。
- **刷怪导演**（`src/logic/spawnDirector.ts`）：按时间升压、按街区权重选类型、视野外才刷、全局上限 40。
- **存档**：浏览器 `localStorage` 单槽位；死亡后自动重生，无失败结局。

## 业务约束

- 纯本地单机，运行时零网络请求；`npm run preview` 无鉴权，仅供本机试玩。
- 所有平衡数值在 `src/config/data/*.json`，启动校验，开发模式热重载。
- 全部界面文案集中在 `src/ui/strings.zh-CN.ts`（简体中文）。
- 性能预算：同屏僵尸 ≤ 40、首包 < 15 MB（`vite.config.ts` 注释）。

## 与守卫模式的关系

现有产品是「无终点沙盒」：没有波次、没有可失败的防守目标、只有一张地图。守卫模式需要在此之上增加模式选择、环形地图、波次引擎、核心房与难度档。具体接入点见 `architecture.md` 的「Improvement Opportunities」与 `code-quality-assessment.md`。
