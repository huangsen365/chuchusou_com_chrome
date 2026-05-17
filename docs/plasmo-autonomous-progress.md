# Plasmo 自主迁移进度

## 2026-05-17 05:38:35 +0800

- 本轮目标：为 legacy popup/background 共用的 `shared/menuStructureBuilder.js` 增加自动化守护，降低后续迁移到 TypeScript/Plasmo 时菜单结构漂移风险。
- 改动：
  - 新增 `scripts/verify-menu-structure-builder.mjs`，在 Node VM 中加载 UMD builder，使用真实 `config/*.json` 与 `prompts/*.json` 构建 popup 菜单结构。
  - 校验 builder 导出、菜单组/菜单项基础字段、重复 id、enabled unified menu id 覆盖、组顺序单调性，以及显式 `toggleConfig=false` 可隐藏菜单项。
  - 将 `verify:menu-structure-builder` 接入 `npm test`。
- 验证：
  - `npm test` 通过。
  - `npm run plasmo:build` 通过；Plasmo build 后兼容层复制与 manifest/stable assets 校验通过。
- Commit：`856efac` (`test: verify shared menu structure builder`)。
- 下一步建议：继续把 popup/menu 相关共享结构的契约固定下来，例如为 Plasmo 产物增加 popup/sidepanel 静态资源与消息入口 smoke 校验，或开始迁移纯函数型 shared builder 的 TypeScript 版本并做双跑对比。

## 2026-05-17 14:07:52 +0800

- 本轮目标：继续完成 Plasmo 迁移中可自动化、低风险的剩余安全批次；不做需要人工 Chrome 回归的 UI 替换。
- 改动：
  - 新增 `src/assets-json/**`，把 `config/*.json` 和核心 `prompts/*.json` 镜像到 Plasmo 可直接 import 的 src 路径。
  - 新增 `src/shared/configAssets.ts`，由新 TS/React/Plasmo 入口显式 import 这些 JSON 镜像。
  - `src/shared/config.ts` 改为通过 `configAssets.ts` 取 typed config，避免新入口直接跨到 legacy 根目录。
  - `scripts/verify-shared-config.mjs` 增加 SSoT 镜像一致性校验：root `config/` / `prompts/` 仍是源，`src/assets-json/**` 只允许做完全一致镜像。
  - 新增 `scripts/verify-plasmo-package.mjs`，校验 `build/chrome-mv3-prod.zip` 中 manifest、关键入口、静态页面、config/prompts、icons、offscreen/voice/welcome/members/privacy 等都存在，且不包含 `src/` / `docs/` / `.plasmo/` / `node_modules/` 等源码目录。
  - `npm run plasmo:package` 现在会自动执行 package zip 校验。
  - 新增 `src/shared/keywordClient.ts`，把 legacy `shared/keywordClient.js` 的 popup/sidepanel 关键字客户端迁成 named-export TypeScript 模块；legacy global 文件保留，等消费者迁移后再切换。
- 验证：
  - `npm test` 通过。
  - `npm run plasmo:package` 通过。
  - package zip 校验通过：`build/chrome-mv3-prod.zip OK (106 entries)`。
- Commits：
  - `4c49ba9` (`refactor: expose Plasmo config asset mirrors`)
  - `fc4a5bc` (`test: validate Plasmo package zip`)
  - `2cfa73a` (`refactor: port keyword client to TypeScript`)
- 当前自动化迁移状态：Phase 1 完成；Phase 2 的 config assets 与 keyword client 已完成；package 输出已有自动化验证。剩余大项（background/popup/sidepanel/content/offscreen 真正切换到 Plasmo entrypoints）需要人工浏览器回归配合，不能只靠 CLI 安全宣称完成。
- 下一步建议：
  1. 继续 port `shared/menuStructureBuilder.js` 到 `src/shared/menuStructureBuilder.ts`，并做 legacy/TS 双跑对比。
  2. 再开始 background `Constants/TextUtils/TextLimits/Logger` 的纯模块迁移。
  3. 真正替换 popup/sidepanel/content entrypoint 前，先安排 Chrome unpacked build 手动验收清单。

## 2026-05-17 后续会话（手动驾驶）

- 本轮目标：把"下一步建议"的 1 + 2 一次做完，全部走双跑对比；不动生产入口。
- 改动：
  - `src/shared/menuStructureBuilder.ts` —— legacy UMD `shared/menuStructureBuilder.js` 的等价 TS 模块，保留 `CCSMenuStructureBuilder` 默认导出 + 4 张常量表。
  - `scripts/verify-menu-structure-builder-dual.mjs` —— 用 `typescript.transpileModule` + `node:vm` 把 TS 编译后跟 legacy UMD 在同一 Node 进程跑 7 个真实场景（默认 unifiedConfig / 无 toggles / 单叶子禁用 / advanced 全关 / 仅 quick+panel / 空 prompt / 缺 engines）+ 4 张常量表 deep-equal 校验。
  - `src/background/utils/Constants.ts` —— 抽出 15 张纯数据常量表（含 MENU_DEFINITIONS / FAST_QA_QUICK_ITEMS / OPTIMIZE_CATEGORY_TITLES / COVER_CATEGORY_TITLES / TITLE_CLEANUP_SUFFIXES / SEARCH_ENGINE_SUFFIXES / GENERIC_HOST_KEYWORDS / CACHE_EXPIRY 等）。chrome.storage / SW lifecycle / 运行时可变状态 / `tryOpenMenuUrl` 留 legacy 不迁。
  - `src/background/utils/TextUtils.ts` —— 11 个纯函数；从全局 MENU_DEFINITIONS / QUICK_RESULT_HOSTS 取值改为可选参数注入，默认值与 legacy 全局一致。
  - `src/background/utils/TextLimits.ts` —— 长度保护纯函数；toast `chrome.tabs.sendMessage` 副作用**不迁**。TS 版本 `TEXT_LIMITS_ENABLED = false` 总闸保留（CLAUDE.md 生产决策），dual-run 显式断言。
  - `src/background/Logger.ts` —— Logger 类 + `loggers` map + `getLogger` + `logMenuEvent`。`_loggerDebug` 全局注册改为 `registerLoggerDebug(globalTarget)` 显式调用，避免 import 副作用。
  - `scripts/verify-background-utils-dual.mjs` —— 自建递归 CJS resolver + `typescript.transpileModule` 加载 4 个 TS；legacy 走 SW importScripts 风格共享 globalThis 加载（chrome.* / console.* 都 stub）。Constants 15 张表、TextUtils 7 个函数 × 多 case、TextLimits 限值表 + smartTruncate + applyTextLimit(disabled+enabled) + enforceFinalUrlCap、Logger LEVELS/LEVEL_NAMES/globalConfig/getLogger/logMenuEvent 全部 deep-equal。
- 验证：
  - `npm test` 通过（lint + typecheck + verify:shared-config + verify:menu-structure-builder + verify:menu-structure-builder-dual + verify:background-utils-dual 六道关全绿）。
  - `npm run plasmo:build` 通过；compat layer 33 manifest 文件齐全。
- Commits：
  - `1d20483` (`refactor: port menuStructureBuilder to TypeScript with dual-run verify`)
  - `ef5cefa` (`refactor: port 4 background pure utils to TypeScript with dual-run verify`)
- 当前迁移状态：
  - Phase 2 已收账（所有 shared/background 纯模块都有 TS 双跑替身）
  - Phase 3 起步条件就绪：剩余 background 模块（base.js / config.js / events.js / menuBuilder.js / menuHandlers.js / KeywordSyncManager.js / KeywordService.js / MenuRegistry.js / URLBuilder.js / menuSystem.js 等）都依赖了 chrome.* 或运行时全局，迁移必须配合 SW entrypoint 替换。
- 下一步建议：
  1. 真正切 background 入口前，先把 `background/config.js` 中的 prompt loader 抽出来 port 到 `src/background/promptConfigLoader.ts`（依赖 fetch + chrome.runtime.getURL，需要在 TS 版本里参数化 fetcher），同样做双跑。
  2. 安排第一次"Chrome unpacked 手动验收清单"：把当前 build 装到 Chrome、过一遍 8 大入口（右键 / popup / sidepanel / 悬浮面板 / welcome / members / voice-permission / offscreen），作为 Phase 3+ 进入实操前的基线快照。
  3. 真正动 popup/sidepanel/content entrypoint 之前**仍需用户手动验收**，不能纯靠 CLI 自动化判断完成。
