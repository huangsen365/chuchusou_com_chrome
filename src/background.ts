/**
 * Plasmo Service Worker 入口
 *
 * 生产 SW 的唯一入口，由 Plasmo 在 `static/background/index.js` 生成。
 * 运行时通过 importScripts() 拉取 legacy SW 模块（在 `background/*.js`），
 * 加载顺序与原 background/index.js 完全一致 —— 行为零差异。
 *
 * 关键路径：
 * - Plasmo bundle SW 路径：`/static/background/index.js`
 * - Legacy SW 模块路径：`/background/*.js`（postbuild 复制）
 * - 用 chrome.runtime.getURL() 把相对 import 转成扩展绝对 URL，
 *   否则 legacy index.js 里的 `./utils/Constants.js` 会从 `/static/background/utils/` 找而失败
 *
 * 这是"管道归 Plasmo，逻辑暂留 legacy"的过渡形态。
 * 后续把 base.js / events.js / menuBuilder.js / menuHandlers.js 等剩余 legacy
 * 全部 port 成 TS 之后，可以把 importScripts 列表逐个换成 import。
 */

import { attachBaseBridge } from "./background/baseBridge"
import { attachMenuHandlers } from "./background/menuHandlersAttach"
import { autoRegisterVoiceBridge } from "./background/voiceOffscreenBridge"
import { attachInit } from "./background/initAttach"
import { attachMenuBuilder } from "./background/menuBuilderAttach"

const sw = self as unknown as {
  importScripts: (...urls: string[]) => void
}

const runtime = (globalThis as unknown as { chrome?: { runtime?: { getURL: (p: string) => string } } }).chrome?.runtime

function absoluteUrl(relPath: string): string {
  return runtime?.getURL?.(relPath) ?? relPath
}

// ============================================================
// ⚠️ 顺序非常关键 —— 不要随意交换
// ============================================================
// legacy events.js 顶层（importScripts 时立刻执行）会引用
// `createContextMenus`、`globalThis.setMenuState`、`formatMenuTitle` 等。
// 它们的 legacy 提供方（base.js / menuBuilder.js / menuHandlers.js /
// voiceOffscreenBridge.js / Logger.js / init.js）已从 importScripts 列表里 drop，
// 改由 TS attach* 提供。
//
// 所以 4 个 attach 必须 **前置** 到 importScripts 之前，
// 这样 events.js 顶层引用到的 globalThis.X 已存在：
//   attachBaseBridge()       → setMenuState / applyMenuTitle / logMenuEvent / ...
//   attachMenuBuilder()      → createContextMenus / COVER_PIN_MENU_ID
//   attachMenuHandlers()     → chrome.contextMenus.onClicked 监听器
//   autoRegisterVoiceBridge()→ chrome.runtime.onMessage voice bridge
//
// 注意：attachInit 必须放在 importScripts **之后**，因为它在 attach 时直接读
// g.MenuSystem / g.initKeywordSyncSystem / g.createContextMenus —— 前两个由
// 第 2/3 层 legacy importScripts 提供，第三个由 attachMenuBuilder 已经提供。
// ============================================================

attachBaseBridge()
attachMenuBuilder()
attachMenuHandlers()
autoRegisterVoiceBridge()

// 与 legacy background/index.js 1:1 顺序：第 1 层工具 → 2 层核心管理器 → 3 层业务 → 3.5 AI → 4 层菜单/事件
sw.importScripts(
  // 第 1 层：基础工具
  absoluteUrl("background/utils/Constants.js"),
  absoluteUrl("background/utils/TextUtils.js"),
  absoluteUrl("background/utils/TextLimits.js"),
  absoluteUrl("background/chatgptPromptRelay.js"),
  absoluteUrl("background/urlSafety.js"),
  absoluteUrl("shared/promptLanguage.js"),
  absoluteUrl("shared/rewriteVariety.js"),
  absoluteUrl("shared/rewriteConceptMemory.js"),
  // ↓ background/Logger.js 已被 baseBridge.ts 取代（logMenuEvent + buildLogPayload）↓
  absoluteUrl("shared/menuStructureBuilder.js"),

  // 第 2 层：核心管理器
  absoluteUrl("background/MenuRegistry.js"),
  absoluteUrl("background/KeywordSyncManager.js"),
  absoluteUrl("background/menuIds.js"),
  absoluteUrl("background/StateManager.js"),
  absoluteUrl("background/URLBuilder.js"),
  absoluteUrl("background/menuSystem.js"),

  // 第 3 层：业务逻辑
  absoluteUrl("background/config.js"),
  absoluteUrl("background/icons.js"),
  absoluteUrl("background/keywords.js"),
  absoluteUrl("background/keywordResolver.js"),
  absoluteUrl("background/KeywordService.js"),
  // ↓ background/base.js 已被 src/background/baseBridge.ts 完全替代 ↓

  // 第 3.5 层：AI 任务统一抽象
  absoluteUrl("background/tasks/AITaskRegistry.js"),
  absoluteUrl("background/tasks/AITaskHandler.js"),
  absoluteUrl("background/articleActions.js"),

  // 第 4 层：菜单 + 事件
  // ↓ background/menuBuilder.js 已被 src/background/menuBuilderAttach.ts 取代 ↓
  // ↓ background/menuHandlers.js 已被 src/background/menuHandlersAttach.ts 取代 ↓
  // ↓ background/voiceOffscreenBridge.js 已被 src/background/voiceOffscreenBridge.ts 取代 ↓
  absoluteUrl("background/events.js")
  // 第 5 层：初始化 ↓ background/init.js 已被 src/background/initAttach.ts 取代 ↓
)

// 必须在 importScripts 之后调用：依赖 g.MenuSystem (menuSystem.js) /
// g.initKeywordSyncSystem (keywords.js) 已就位
attachInit()

console.log("[触触搜][Plasmo] background SW bootstrap complete via importScripts bridge + TS baseBridge + TS menuHandlers")

export {}
