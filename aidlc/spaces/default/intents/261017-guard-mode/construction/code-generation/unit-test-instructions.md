# 单元测试说明（守卫模式）

## 框架与配置

- 沿用现有 Vitest（`vitest.config.ts`，`environment: 'node'`，`include: ['tests/unit/**/*.test.ts']`）。
- 只测纯逻辑层：`src/config/`（校验）、`src/logic/`、`src/nav/`、`src/world/ringLayout.ts`（纯数据）。不引用 Three.js、Rapier 或 DOM。
- 前置条件：工作区根目录已运行过 `npm install`。

## 运行命令

只运行本次新增和改动的测试文件：

```bash
npx vitest run tests/unit/challengeConfig.test.ts tests/unit/config.test.ts tests/unit/guardSave.test.ts tests/unit/waveDirector.test.ts tests/unit/guardRules.test.ts tests/unit/guardTargeting.test.ts tests/unit/bossAbilities.test.ts tests/unit/ringLayout.test.ts
```

回归（Step 1 基线与 Step 16 收尾时运行，确认原有测试保持通过）：

```bash
npx vitest run tests/unit
```

## 测试范围（Minimal 策略，约 30 条新增）

| 文件 | 组件 | 覆盖需求 |
| --- | --- | --- |
| `tests/unit/challengeConfig.test.ts`（新） | 难度与环形地图配置校验 | FR2.6、FR5.1、FR5.4、FR8.7 |
| `tests/unit/config.test.ts`（补充） | 城市地图校验不回归 | NFR2 |
| `tests/unit/guardSave.test.ts`（新） | 守卫模式存档 | FR11 |
| `tests/unit/waveDirector.test.ts`（新） | 波次引擎 | FR4、FR5.3、FR8.1 |
| `tests/unit/guardRules.test.ts`（新） | 失败重开、核心血量、倍率、刷怪判据 | FR3.3、FR4.8、FR5.2、FR6 |
| `tests/unit/guardTargeting.test.ts`（新） | 冲核心目标规则 | FR7 |
| `tests/unit/bossAbilities.test.ts`（新） | 巨人僵尸砸击与扔小鬼 | FR8.3～FR8.5 |
| `tests/unit/ringLayout.test.ts`（新） | 环形地图布局与航点 | FR2.1～FR2.4 |

每个新测试文件至少一条正常路径，加至少两条边界 / 异常用例；断言针对真实计算结果，禁止恒真断言。

## 覆盖率目标

express 范围不设行覆盖率下限。目标：需求中每条可计算的规则至少一条测试；每个新逻辑组件至少一条正常路径测试；原有 110 条测试全部保持通过。

## Mock / Stub 指南

- 时间：逻辑函数接收 `dt`，测试中直接传数值。
- 随机：注入可播种 PRNG（`src/core/rng.ts`），固定种子。
- 存储：`guardSave.ts` 接收 `Storage` 风格接口，测试用内存实现。
- 世界查询：目标规则、刷怪判据、BOSS 能力通过上下文对象接收位置、视线、实体列表，测试中直接构造。

## 测试数据

- 用真实的 `src/config/data/*.json`（含 `challenge.json`、`map_ring_01.json`）作为基线；异常用例在测试内深拷贝后修改。
- 坐标用简单数值（原点、12 m、13 m 等），便于看出边界。
