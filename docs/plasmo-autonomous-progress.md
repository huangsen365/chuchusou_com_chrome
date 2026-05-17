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
