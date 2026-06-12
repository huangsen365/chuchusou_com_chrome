# 历史文档归档 (HISTORY.md)

本目录存放 2024–2026 年初重构期间产出的阶段性设计文档、路线图、修复笔记。
它们对当前代码已无指令性意义，但保留作为"决策考古"参考。

## 阅读顺序建议

按时间线 → 按主题浏览：

### 1. 架构演进（主线）
- **MENU_SYSTEM_REFACTOR.md**（458 行）—— 菜单系统重构的正式设计文档：目标、新旧对比、MenuManager/MenuBuilder/MenuUpdater/MenuHandlers 的类职责、useNewSystem 开关、迁移步骤
- **MODULARIZATION_ROADMAP.md**（216 行）—— content.js 模块化路线图：把 content.js 拆成 modules/* 多个 ES Module 的分步计划
- **REFACTOR_SUMMARY.md**（293 行）—— 重构成果总结：文件变更清单、每个新类承担的职责、预期收益
- **FINAL_SUMMARY.md**（508 行）—— 最终总结：里程碑回顾、测试覆盖、已知问题、后续建议

### 2. 使用 & 就绪
- **READY_TO_USE.md**（271 行）—— 新菜单系统"就绪公告"：如何切换到新架构、验证步骤
- **USAGE_EXAMPLES.md**（459 行）—— 新系统 API 使用示例：MenuRegistry.register / URLBuilder.build / MenuManager.createMenu 等

### 3. 修复与专题
- **HOTFIX_SERVICE_WORKER.md**（122 行）—— Service Worker 兼容性问题的热修复记录（importScripts / globalThis / 顶层作用域坑）
- **DOCKBAR_MODULE.md**（79 行）—— Dockbar 模块说明
- **POPUP_FOOTER_STICKY_SHORT_DISPLAY.md** —— popup footer 短屏固定问题修复记录：记录 fixed footer 方案与失败的 height-sync 路线
- **MARQUEE_SCROLL_WINDOWS.md** —— Windows marquee 滚动问题修复记录：记录 RAF transform 方案与失败的 CSS marquee 路线
- **voice-engine-picker.md** —— 语音选引擎麦克风授权问题（2026-05-02 已修复：改走 MV3 offscreen document）
- **sidepanel-keyword-on-chrome-internal-pages.md** —— sidepanel 在 chrome:// 内置页首次进入拿不到关键字（2026-05-16 已修复：补 tabs 权限 + KeywordService 按 tabId 自取元数据）

## 当前状态（2026-04）

上述设计的"新架构"代码已被确认为**未激活僵尸**（`INIT_CONFIG.useNewSystem=false`），相关文件已全部搬迁到 `legacy/_unactivated/`。生产环境跑的是老流水线（`background/base.js` / `events.js` / `menuBuilder.js` / `menuHandlers.js`）。

## 2026-06 增补

老流水线随后也被逐个 port 成 TS：`base.js / menuBuilder.js / menuHandlers.js` 等 6 个文件
已退役到 `legacy/background-retired/`（见该目录 README），生产 SW 入口是 `src/background.ts`，
仅剩 `background/events.js` 仍是 legacy 主体。`menuSystem.js` 的 `useNewSystem` 死分支已删。

详见：
- 最新审计：`../TECH_DEBT_AUDIT.md`
- 僵尸代码位置：`/legacy/_unactivated/README.md`
- 当前架构导航：`/CLAUDE.md`

## 原则

- **不要**在这些文档里更新信息 —— 它们是历史快照
- **不要**把这些文档当作当前架构的真理来源
- 如果将来要复活新架构，先读完 READY_TO_USE.md + USAGE_EXAMPLES.md，再读最新 TECH_DEBT_AUDIT.md 了解下线原因
