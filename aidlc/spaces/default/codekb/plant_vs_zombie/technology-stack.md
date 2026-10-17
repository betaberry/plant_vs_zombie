# 技术栈

| 层 | 技术 | 版本 | 用途 |
| --- | --- | --- | --- |
| 语言 | TypeScript | 5.9.3 | 严格模式，`noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch`、`noImplicitOverride` |
| 运行时 | 浏览器（最新 Chrome / Edge，Windows 桌面） | — | ES2022 目标 |
| 渲染 | three | 0.186.1 | 场景、InstancedMesh、卡通材质、阴影 |
| 物理 | @dimforge/rapier3d-compat | 0.21.0 | 内嵌 WASM（base64），角色控制器、射线 |
| 构建 / 开发 | Vite | 7.3.7 | 开发服务器、JSON HMR、`base: './'`、手动分包 three / rapier |
| 测试 | Vitest | 5.0.5 | `environment: node`，仅 `tests/unit/**/*.test.ts` |
| 类型 | @types/three | 0.186.0 | — |
| 开发环境 | Node.js | ≥ 22.12（README） | npm，`package-lock.json` 锁定版本 |
| 音频 | Web Audio API（经 three `AudioListener` / `PositionalAudio`） | — | CC0 `.ogg` + 合成回退 |
| 界面 | 原生 DOM + CSS | — | 无前端框架 |
| 存储 | `localStorage` | — | 存档与设置 |

## npm 脚本

| 脚本 | 命令 |
| --- | --- |
| `dev` | `vite` |
| `build` | `tsc --noEmit && vite build` |
| `preview` | `vite preview` |
| `test` | `vitest run tests/unit` |
| `typecheck` | `tsc --noEmit` |
| `docs:numbers` | `node scripts/gen-numbers.mjs` |

未使用 ESLint、Prettier、覆盖率工具或 CI（见 `code-quality-assessment.md`）。
