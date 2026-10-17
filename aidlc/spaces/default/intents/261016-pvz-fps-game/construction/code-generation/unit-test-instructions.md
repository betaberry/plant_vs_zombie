# 单元测试说明

## 框架与配置

- 测试框架：Vitest（版本在 `package.json` 中锁定）
- 配置文件：工作区根目录 `vitest.config.ts`，`environment: 'node'`，`include: ['tests/unit/**/*.test.ts']`
- 只测试纯逻辑层：`src/config/`（校验）、`src/logic/`、`src/nav/`。这些模块不引用 Three.js、Rapier 或 DOM，所以不需要浏览器环境。
- 前置条件：在工作区根目录运行过 `npm install`。

## 运行命令

本工作流只有一个工作单元，下面的命令只运行本次生成的单元测试目录：

```bash
npx vitest run tests/unit
```

运行单个文件（调试用）：

```bash
npx vitest run tests/unit/targeting.test.ts
```

测试运行器在计划 Step 2 搭好，Step 2 结束时这条命令必须能执行（有一条冒烟测试）。

## 测试范围（Minimal 策略，约 30 条）

| 文件 | 组件 | 覆盖的需求 / 源文档用例 |
| --- | --- | --- |
| `tests/unit/smoke.test.ts` | 运行器 | 冒烟 |
| `tests/unit/config.test.ts` | 配置校验 | FR16.2；TR-CFG-01/02/05；TC-SUN-02 |
| `tests/unit/save.test.ts` | 存档 | FR13.1/13.2；TC-SAV-01 |
| `tests/unit/economy.test.ts` | 阳光经济 | FR8.1；TC-SUN-01；FR-SUN-05/11 |
| `tests/unit/ammo.test.ts` | 弹药 | FR4.4；TC-WPN-01/05；FR-WPN-17 |
| `tests/unit/potions.test.ts` | 药剂 | FR9.3；TC-WPN-07 |
| `tests/unit/damage.test.ts` | 伤害与部位 | FR4.1；TC-WPN-02；KPI-01 |
| `tests/unit/shop.test.ts` | 商店 | FR9.1/9.2；TC-SHP-01/04；TC-PLT-04 |
| `tests/unit/inventory.test.ts` | 快捷栏与铲子 | FR10.1/10.2；TC-PLT-08 |
| `tests/unit/planting.test.ts` | `canPlantAt` | FR3.3、FR11.1；TC-PLT-01/02/03/05 |
| `tests/unit/targeting.test.ts` | 僵尸目标优先级 | FR5.4；TC-AGG-01～06 |
| `tests/unit/peashooterAI.test.ts` | 豌豆射手索敌 | FR11.3 |
| `tests/unit/nav.test.ts` | 航点 A* | FR3.4；TR-NAV-03/04 |
| `tests/unit/spawnDirector.test.ts` | 刷怪导演 | FR12.1 |
| `tests/unit/zombiePose.test.ts` | 僵尸姿态动画（修订 1、2） | FR5.1；FR-AI-08 前摇 0.3 s；FR-AI-10 死亡姿态；撑杆跳弧线；暴怒切换 |
| `tests/unit/armor.test.ts` | 护甲结算（修订 2） | 路障 / 铁桶 / 头盔的吸收与溢出；铁门只挡正面 ±60°；爆头倍率不作用于护甲；爆炸同时伤到护甲和本体 |
| `tests/unit/zombieAbilities.test.ts` | 僵尸特殊能力（修订 2） | 撑杆跳只跳一次并降速；跳跃中不受藤蔓影响；读报僵尸暴怒后提速 |

每个测试文件至少包含一条正常路径用例，并按项目阶段规则覆盖至少两个异常/边界用例。断言必须针对真实计算结果，禁止恒真断言。

## 覆盖率目标

express 范围不设行覆盖率下限。目标是需求表中每条可计算规则至少有一条测试，以及每个逻辑组件至少一条正常路径测试。

## Mock / Stub 指南

- 时间：逻辑函数接收 `dt` 或 `now` 参数，测试中直接传入数值，不使用真实计时器。
- 随机：注入可播种 PRNG（`src/core/rng.ts`），测试中固定种子。
- 存储：`save.ts` 接收一个 `Storage` 风格的接口，测试中传入内存实现（`Map` 封装），不依赖 `localStorage`。
- 世界查询：`canPlantAt`、`chooseZombieTarget`、`spawnDirector` 通过上下文对象接收地面坡度、可种植区、视线结果、实体列表，测试中直接构造。

## 测试数据

- 用真实的 `src/config/data/*.json` 作为基线配置；需要异常配置的用例在测试内对基线做深拷贝后修改。
- 坐标用简单数值（如原点、5 m、8 m），便于看出距离判定边界。
