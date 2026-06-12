# background-retired/ —— 已退役的 legacy Service Worker 模块

这 6 个文件曾是 `background/` 运行时的一部分，现已**全部被 `src/background/*.ts` 移植取代**，
从两个 SW 入口（Plasmo `src/background.ts` 与 legacy `background/index.js`）的 importScripts
列表中移除（commits 9437c35..725b45d），2026-06 起移入本目录：

| 文件 | 行数 | TS 接班者 |
|------|------|-----------|
| `base.js` | 889 | `src/background/{baseBridge,tabState,menuTitles,menuTitleUpdater,menuStateOrchestrator,menuActions,menuDebugInfo,popupMenuStructure,bootstrap}.ts` |
| `Logger.js` | 458 | `src/background/Logger.ts`（via baseBridge） |
| `menuHandlers.js` | 611 | `src/background/menuHandlersAttach.ts` |
| `menuBuilder.js` | 718 | `src/background/menuBuilderAttach.ts`（+ `menuBuilderHelpers.ts`） |
| `voiceOffscreenBridge.js` | 100 | `src/background/voiceOffscreenBridge.ts` |
| `init.js` | 448 | `src/background/{init,initAttach,initPrewarming}.ts` |

## 为什么不直接删

- `Logger.js` 仍被 `scripts/verify-background-utils-dual.mjs` / `verify-background-extras-dual.mjs`
  作为 dual 校验的 legacy 对照源加载执行（确保 TS port 与 legacy 行为一致）。
- 其余文件保留作移植对照参考；待 `events.js` 也完成 TS 移植、dual 校验退役后可整目录删除。

## 注意

- 本目录在 `eslint.config.mjs` ignores（`legacy/**`）内，不参与 lint。
- 本目录**不在** `scripts/plasmo-compat-postbuild.mjs` 的 copyDirs 里 → 不进 build、不进商店 zip。
- 不要把这里的文件重新加回任何 importScripts 列表。
