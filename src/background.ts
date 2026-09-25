/**
 * Plasmo Service Worker 入口
 *
 * 生产 SW 的唯一入口，由 Plasmo 在 `static/background/index.js` 生成。
 * TS 模块（src/background/*.ts）直接 import 打包；其余 SW 逻辑仍是
 * `background/*.js` / `shared/*.js` 普通脚本，运行时通过 importScripts() 拉取。
 *
 * 关键路径：
 * - Plasmo bundle SW 路径：`/static/background/index.js`
 * - importScripts 模块路径：`/background/*.js`、`/shared/*.js`（postbuild 复制）
 * - 用 chrome.runtime.getURL() 转成扩展绝对 URL，
 *   否则相对路径会从 `/static/background/` 下找而失败
 *
 * 把某个 importScripts 模块改写成 TS 时：在这里 import 它、从列表里删掉原文件，
 * 不要留两份实现（scripts/verify-sw-bridge.mjs 守着这份列表）。
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

// 顺序：第 1 层工具 → 2 层核心管理器 → 3 层业务 → 3.5 AI → 4 层事件 handler → 5 层事件接线（events.js 必须最后）
sw.importScripts(
  // 第 1 层：基础工具（storageKeys.js 必须第一个：其它脚本加载时就读 CCSStorageKeys）
  absoluteUrl("shared/storageKeys.js"),
  absoluteUrl("background/utils/Constants.js"),
  absoluteUrl("background/utils/TextUtils.js"),
  absoluteUrl("background/utils/TextLimits.js"),
  absoluteUrl("background/chatgptPromptRelay.js"),
  absoluteUrl("background/urlSafety.js"),
  absoluteUrl("shared/promptLanguage.js"),
  absoluteUrl("shared/promptTemplate.js"),
  absoluteUrl("shared/rewriteVariety.js"),
  absoluteUrl("shared/rewriteConceptMemory.js"),
  // ↓ background/Logger.js 已被 baseBridge.ts 取代（logMenuEvent + buildLogPayload）↓
  // ↓ shared/menuStructureBuilder.js 已由 src/shared/menuStructureBuilder.ts 取代（popupMenuStructure.ts import）↓

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

  // 第 4 层：事件 handler（按领域拆分；messaging.js 提供分发表，必须在其它 events/* 之前）
  // ↓ background/menuBuilder.js 已被 src/background/menuBuilderAttach.ts 取代 ↓
  // ↓ background/menuHandlers.js 已被 src/background/menuHandlersAttach.ts 取代 ↓
  // ↓ background/voiceOffscreenBridge.js 已被 src/background/voiceOffscreenBridge.ts 取代 ↓
  absoluteUrl("background/events/messaging.js"),
  absoluteUrl("background/events/siteFastQaUpdateGuard.js"),
  absoluteUrl("background/events/menuState.js"),
  absoluteUrl("background/events/aiRelay.js"),
  absoluteUrl("background/events/articleRewrite.js"),
  absoluteUrl("background/events/longArticle.js"),
  absoluteUrl("background/events/urlRecovery.js"),
  absoluteUrl("background/events/sidePanel.js"),
  absoluteUrl("background/events/keyword.js"),
  absoluteUrl("background/events/menu.js"),
  absoluteUrl("background/events/diagnostics.js"),
  absoluteUrl("background/events/tabs.js"),
  absoluteUrl("background/events/contextMenuShown.js"),

  // 第 5 层：事件接线（所有 chrome.* 监听注册，必须最后）
  absoluteUrl("background/events.js")
  // 初始化 ↓ background/init.js 已被 src/background/initAttach.ts 取代（下面 attachInit()）↓
)

// 必须在 importScripts 之后调用：依赖 g.MenuSystem (menuSystem.js) /
// g.initKeywordSyncSystem (keywords.js) 已就位
attachInit()

console.log("[触触搜][Plasmo] background SW bootstrap complete via importScripts bridge + TS baseBridge + TS menuHandlers")

export {}
