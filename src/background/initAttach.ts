/**
 * Init 启动期监听器激活 (TypeScript port)
 *
 * 抽自 background/init.js 的 chrome.runtime.onInstalled / onStartup
 * 注册逻辑。本文件由 src/background.ts 在 importScripts 完成后调用，
 * 替代 legacy init.js。
 *
 * 关键差异：legacy 在 importScripts 时执行模块顶层（注册 listener + 立刻
 * runFullPrewarming）。TS 版本走 InitOrchestrator + installListeners()
 * 显式调用，行为一致。
 */
import { InitOrchestrator, type InitDeps } from "./init"
import { createDefaultPrewarmDeps } from "./initPrewarming"

type G = Record<string, any> & { chrome?: any; self?: any }

/**
 * 用 globalThis 上 legacy / bridge 提供的依赖构造 InitOrchestrator 并注册
 * onInstalled / onStartup listener。
 */
export function attachInit(): InitOrchestrator | null {
  const g = globalThis as unknown as G
  const runtime = g.chrome?.runtime
  if (!runtime?.onInstalled?.addListener) {
    console.warn("[initAttach] chrome.runtime 不可用，跳过 init 注册")
    return null
  }

  const prewarmDeps = createDefaultPrewarmDeps()

  // legacy init.js 依赖：MenuSystem.init / createContextMenus / initKeywordSyncSystem
  // 全部从 globalThis 取（importScripts 后已就位 + baseBridge 已 attach）
  const deps: InitDeps = {
    ...prewarmDeps,
    initMenuSystem: async (opts) => {
      const ms = g.MenuSystem
      if (ms && typeof ms.init === "function") {
        return ms.init(opts)
      }
      console.warn("[initAttach] MenuSystem.init 不存在")
    },
    createContextMenus: g.createContextMenus,
    initKeywordSyncSystem: g.initKeywordSyncSystem,
    runtime,
    self: g.self,
    setInterval: g.setInterval
  }

  const orchestrator = new InitOrchestrator(deps)
  orchestrator.installListeners()
  return orchestrator
}

export default attachInit
