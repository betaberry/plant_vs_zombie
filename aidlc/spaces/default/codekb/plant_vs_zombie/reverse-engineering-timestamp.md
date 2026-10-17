# Reverse Engineering Timestamp

## Run Record

- Date: 2026-10-17
- Commit: f5a2e002a93eb834723a4a3e2292f97b39097a74（工作区含未提交改动与未跟踪文件；指纹按磁盘内容计算）

首次全量扫描（store 不存在）。深读的文件与只浏览的区域见下方 `shallow.paths` 与 `inception/reverse-engineering/developer-scan.md` 的 Scan Coverage；`node_modules/`、`dist/` 与 AI-DLC 自身安装未打开。

## Scope of Analysis

```yaml
scope_version: 1
kind: full
intent: 261017-guard-mode
fingerprint: 4a9d2617186a2f66901f2d681104360b5dec244f
analyzed:
  paths:
    - ./
  components:
    - App Shell
    - Session
    - Input
    - Config
    - Core
    - Logic Rules
    - Zombie AI
    - Plants
    - Player and Weapon
    - Pickups and Dummy
    - Navigation
    - Physics
    - World Layout
    - Render
    - Audio
    - UI
    - Assets Registry
    - Tests
    - Tooling Scripts
shallow:
  paths:
    - src/render/
    - src/audio/
    - src/assets/
    - public/assets/audio/
    - docs/
    - scripts/
```
