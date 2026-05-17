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

const sw = self as unknown as {
  importScripts: (...urls: string[]) => void
}

const runtime = (globalThis as unknown as { chrome?: { runtime?: { getURL: (p: string) => string } } }).chrome?.runtime

function absoluteUrl(relPath: string): string {
  return runtime?.getURL?.(relPath) ?? relPath
}

// 与 legacy background/index.js 1:1 顺序：第 1 层工具 → 2 层核心管理器 → 3 层业务 → 3.5 AI → 4 层菜单/事件 → 5 层 init
sw.importScripts(
  // 第 1 层：基础工具
  absoluteUrl("background/utils/Constants.js"),
  absoluteUrl("background/utils/TextUtils.js"),
  absoluteUrl("background/utils/TextLimits.js"),
  absoluteUrl("background/Logger.js"),
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
  absoluteUrl("background/base.js"),

  // 第 3.5 层：AI 任务统一抽象
  absoluteUrl("background/tasks/AITaskRegistry.js"),
  absoluteUrl("background/tasks/AITaskHandler.js"),

  // 第 4 层：菜单 + 事件
  absoluteUrl("background/menuBuilder.js"),
  absoluteUrl("background/menuHandlers.js"),
  absoluteUrl("background/voiceOffscreenBridge.js"),
  absoluteUrl("background/events.js"),

  // 第 5 层：初始化
  absoluteUrl("background/init.js")
)

console.log("[触触搜][Plasmo] background SW bootstrap complete via importScripts bridge")

export {}
