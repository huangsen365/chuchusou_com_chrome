# _unactivated —— 已下线的新架构模块

本目录存放经过"真实调用审计"确认**零外部引用**的新架构文件（class-based MenuManager / MenuBuilder / 等）。

## 背景

项目曾启动过一次"老流水线 → 新架构"的重构：
- 新架构由 `MenuSystem / MenuManager / MenuBuilder / MenuUpdater / MenuHandlers / TabEvents / MessageEvents / MenuEvents` 组成
- 开关位置：`background/init.js` 的 `INIT_CONFIG.useNewSystem`（生产恒为 `false`）
- 生产跑的是老流水线：`base.js / events.js / menuBuilder.js / menuHandlers.js`

2026-04 审计结论（详见 `docs/TECH_DEBT_AUDIT.md`）：
- 这 7 个文件的"外部引用"全部是 `importScripts` / 注释 / Logger 字符串 / README 目录树
- `new MenuManager()` 在 `menuSystem.js` 里被 `if (INIT_CONFIG.useNewSystem)` 守护，永远走不到
- 下架后完全不影响兼容模式

## 文件清单

| 文件 | LOC |
|---|---|
| `MenuManager.js` | 745 |
| `menu/MenuBuilder.js` | 296 |
| `menu/MenuUpdater.js` | 287 |
| `menu/MenuHandlers.js` | 379 |
| `events/TabEvents.js` | 416 |
| `events/MessageEvents.js` | 791 |
| `events/MenuEvents.js` | 429 |
| **合计** | **3343** |

## 恢复方式

如果将来要激活新架构：
1. 把本目录的文件整体搬回 `background/`（保持 `menu/` `events/` 子目录）
2. 在 `background/index.js` 的 importScripts 数组里取消对应注释
3. 在 `background/init.js` 里将 `INIT_CONFIG.useNewSystem` 改为 `true`
4. 充分测试所有菜单点击路径（特别是 AI 引擎打开、URL 菜单、速答/百问/优化三大流）

## 不要做的事

- 不要直接在本目录编辑这些文件 —— 它们现在是历史快照
- 不要在 `background/` 其他文件里 `importScripts('../legacy/_unactivated/...')` —— 本目录**不参与**扩展运行时
