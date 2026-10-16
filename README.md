# 植物大战僵尸 3D（第一人称版）— 垂直切片

浏览器里的第一人称「射击 + 种植塔防」沙盒：豌豆枪手靠枪、太阳花靠植物设施，在一座四个街区的城市里赚阳光、买东西、种植物、打僵尸。需求来源见 `需求文档.md`（v0.3.1）。

技术栈：TypeScript（严格模式）+ Three.js + Rapier（`@dimforge/rapier3d-compat`）+ Vite，单元测试用 Vitest。

## 运行

需要 Node.js 22.12 或更高版本，浏览器使用最新版 Chrome / Edge（Windows 桌面，键盘 + 鼠标）。

```bash
npm install          # 安装依赖（版本已锁定）
npm run dev          # 开发服务器（支持配置热重载）
npm run build        # 类型检查 + 生产构建，输出到 dist/
npm run preview      # 本地预览 dist/ 中的构建产物
npm test             # 单元测试（等同于 npx vitest run tests/unit）
npm run docs:numbers # 从 JSON 配置重新生成 docs/数值表.md
```

纯本地单机：运行时不发任何网络请求，存档只保存在浏览器 `localStorage`（键名 `pvz3d.save.v1`），设置保存在 `pvz3d.settings.v1`。`npm run preview` 起的是本地静态服务器，没有任何鉴权，只适合在本机试玩。

## 键位

| 按键 | 功能 |
| --- | --- |
| W A S D | 移动 |
| 鼠标 | 视角（点击画面锁定鼠标） |
| 鼠标左键 | 使用当前手持物：开火 / 种植 / 饮用药剂 / 使用医疗包 / 铲除 |
| 鼠标右键 | 开镜（手持豌豆枪）/ 取消选中、退出种植或铲除模式 |
| R | 换弹（备弹为 0 时无效） |
| Shift | 冲刺 |
| Space | 跳跃 |
| Ctrl 或 C | 蹲下 |
| B | 打开 / 关闭商店（不暂停游戏；商店内数字键 1–6 快捷购买） |
| Q | 快捷使用医疗包 |
| 1 – 6 | 选中快捷栏道具，再按一次取消 |
| 鼠标滚轮 | 循环切换快捷栏 |
| Tab（按住） | 太阳花：显示种子轮盘 |
| X | 进入 / 退出铲除模式（免费、不返还阳光） |
| F | 交互：开门 / 关门、拾取补给箱 |
| Esc | 暂停菜单；种植 / 铲除模式下为取消 |
| H | 跳过新手引导 |
| F3 | 调试面板（FPS、Draw Call、三角面、实体数、物理耗时、坐标、不连通航点数） |
| F4 | 在僵尸头顶显示状态机状态 |

## 目录

| 目录 | 内容 |
| --- | --- |
| `src/config/` | 第 11 章的六个 JSON（`data/`）+ 全局参数 `game.json`，类型定义、启动校验、开发模式热重载 |
| `src/core/` | 固定步长循环、事件总线、Store、可播种随机数、`GameCommand` 分发器 |
| `src/logic/` | 与渲染无关的规则：经济、弹药、药剂、伤害、部位、商店、快捷栏、`canPlantAt`、僵尸目标优先级、豌豆射手索敌、刷怪导演、存档 |
| `src/nav/` | 航点图、A*、连通性检查、坚果墙阻断与「绕路 vs 拆墙」 |
| `src/physics/` | Rapier 世界封装、带队伍过滤的射线检测 |
| `src/world/` | 程序化城市布局（纯数据）与 Three.js / Rapier 构建 |
| `src/entities/` | 玩家、豌豆枪、僵尸、六种植物、拾取物、训练假人、统一 tick 管理器 |
| `src/render/` | 渲染器与画质档位、实例化池、粒子、弹孔、第一人称视图模型、种植预览 |
| `src/audio/` | 3D 音效、三路音量、背景音乐交叉淡入淡出、Web Audio 合成回退 |
| `src/ui/` | DOM/CSS 界面；全部文案在 `strings.zh-CN.ts` |
| `public/assets/audio/` | CC0 音效（来源见 `docs/资源来源.md`） |
| `tests/unit/` | Vitest 单元测试 |
| `docs/` | 数值表、资源来源、里程碑验收记录 |

## 调整数值

所有平衡数值都在 `src/config/data/*.json` 中。开发模式下修改并保存 JSON 会立即热重载（校验失败时保留旧配置并在控制台报错）。启动时会校验字段缺失、引用不存在、种子 `availableTo` 与植物 `onlyByCharacter` 是否一致，以及每个角色可同时持有的快捷栏道具种类是否超过 6 种；校验失败会阻止进入游戏并显示错误列表。改完数值后运行 `npm run docs:numbers` 更新 `docs/数值表.md`。
