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
