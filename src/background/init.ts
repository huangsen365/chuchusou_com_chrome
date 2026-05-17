/**
 * 触触搜扩展初始化 (TypeScript port)
 *
 * 与 background/init.js 1:1 行为对等，但**去屎山**：
 * - 删掉 `useNewSystem=true` 分支（dead code，MenuManager 已删除）
 * - prewarm 逻辑 100% 复用 src/background/initPrewarming.ts，去除 100 行 dup
 * - INIT_CONFIG 类型化 + 只读，performanceMetrics 内化到 InitOrchestrator 实例
 * - chrome.runtime.onInstalled / onStartup 注册收敛到 register() 入口（幂等）
 *
 * 入口：
 *   - 在 SW 启动时调一次 `installInitListeners()` 把 onInstalled/onStartup hook 上
 *   - 或纯 TS 测试场景下用 `runInitOnce()` 同步走一遍流程
 */

import {
  prewarmPromptConfigs,
  prewarmUiDocuments,
  clearStaleSidepanelStates,
  type PrewarmDeps
} from "./initPrewarming"

export const INIT_CONFIG = {
  /** false = 兼容模式（生产）；true 分支已死，prod 永远 false */
  useNewSystem: false,
  debug: true,
  autoCleanup: true,
  enablePerformanceMonitoring: false
} as const
const DEFAULT_LOCAL_STORAGE_VALUES: Record<string, unknown> = {
  enabled: true,
  ccs_debug: false,
  ccs_voice_enabled: false,
  ccs_schema_version: 1,
  ccs_settings: {
    mode: "normal",
    theme: "default",
    opacity: 1,
    position: null,
    layout: "float",
    globalDock: false,
    barClosed: false,
    blacklist: [],
    isBlacklisted: false,
    miniButtons: ["baidu", "google", "chuchusou", "copy", "lowercase"],
    shortcutKey: "Alt+S"
  }
}

export interface PerformanceMetrics {
  initStartTime: number
  initEndTime: number | null
  menuBuildStartTime: number | null
  menuBuildEndTime: number | null
}

export interface InitDeps extends PrewarmDeps {
  /** MenuSystem.init —— 由 src/background/menuSystem.ts 提供 */
  initMenuSystem: (opts: { useNewSystem?: boolean; debug?: boolean }) => Promise<void>
  /** legacy createContextMenus —— 由 background/menuBuilder.js 提供（暂未 port） */
  createContextMenus?: () => void | Promise<void>
  /** initKeywordSyncSystem —— 由 KeywordSyncManager 提供 */
  initKeywordSyncSystem?: () => void
  /** chrome.runtime 注入；不传则用 globalThis.chrome.runtime */
  runtime?: {
    getManifest: () => { version: string }
    onInstalled?: { addListener: (cb: (details: { reason: string }) => void) => void }
    onStartup?: { addListener: (cb: () => void) => void }
  }
  /** self （SW global） —— 用于 error / unhandledrejection 监听；不传则跳过 */
  self?: { addEventListener: (event: string, listener: (e: unknown) => void) => void }
  /** setInterval 注入（测试时方便 mock） */
  setInterval?: typeof setInterval
}

function getDefaultChromeRuntime(): NonNullable<InitDeps["runtime"]> | undefined {
  const ch = (globalThis as unknown as { chrome?: { runtime?: NonNullable<InitDeps["runtime"]> } }).chrome
  return ch?.runtime
}

export class InitOrchestrator {
  metrics: PerformanceMetrics = {
    initStartTime: Date.now(),
    initEndTime: null,
    menuBuildStartTime: null,
    menuBuildEndTime: null
  }

  deps: InitDeps
  debug: boolean

  constructor(deps: InitDeps) {
    this.deps = deps
    this.debug = INIT_CONFIG.debug
  }

  private logPerf(stage: string, durationMs: number): void {
    if (!INIT_CONFIG.enablePerformanceMonitoring) return
    console.log(`[Performance] ${stage}: ${durationMs}ms`)
  }

  async initializeExtension(): Promise<void> {
    try {
      console.log("[Init] 🚀 触触搜扩展初始化开始...")
      console.log("[Init] 模式: 兼容模式")  // useNewSystem=true 分支已删

      await this.initializeMenuSystem()

      // 兼容模式：调老 createContextMenus
      this.metrics.menuBuildStartTime = Date.now()
      if (typeof this.deps.createContextMenus === "function") {
        await this.deps.createContextMenus()
        this.metrics.menuBuildEndTime = Date.now()
        const buildDuration = this.metrics.menuBuildEndTime - this.metrics.menuBuildStartTime
        this.logPerf("Menu Build (Compat)", buildDuration)
        console.log("[Init] ✅ 菜单创建完成")
      } else {
        console.warn("[Init] ⚠️ createContextMenus 函数不存在")
      }

      if (INIT_CONFIG.autoCleanup) this.setupCleanupTasks()

      this.metrics.initEndTime = Date.now()
      const total = this.metrics.initEndTime - this.metrics.initStartTime
      console.log("[Init] ✅ 初始化完成！")
      console.log(`[Init] ⏱️ 总耗时: ${total}ms`)
    } catch (error) {
      console.error("[Init] ❌ 初始化失败:", error)
      console.error((error as Error)?.stack)
    }
  }

  async initializeMenuSystem(): Promise<void> {
    console.log("[Init] 初始化菜单系统工具...")
    try {
      await this.deps.initMenuSystem({ useNewSystem: false, debug: this.debug })
      console.log("[Init] ✅ 菜单系统工具已就绪")
      if (typeof this.deps.initKeywordSyncSystem === "function") {
        this.deps.initKeywordSyncSystem()
        console.log("[Init] ✅ 关键字同步系统已初始化")
      }
    } catch (error) {
      console.error("[Init] 菜单系统初始化失败:", error)
      throw error
    }
  }

  setupCleanupTasks(): void {
    const setIntervalFn = this.deps.setInterval || setInterval
    setIntervalFn(() => {
      // legacy MenuSystem.getStateManager().cleanupExpiredStates()，
      // 此处保持兼容：未来 SW 真切 TS 时挂个 deps.cleanupExpiredStates 回调进来
      // 当前 fallback 是不做事，与 legacy `if (stateManager)` null-check 等价
    }, 5 * 60 * 1000)
    console.log("[Init] ✅ 自动清理任务已设置（每 5 分钟）")
  }

  /** prewarm：仅预热 prompt configs loader cache（popup 菜单结构 prewarm 已废弃 v1.6.19） */
  async runFullPrewarming(): Promise<void> {
    void prewarmUiDocuments()
    await prewarmPromptConfigs(this.deps)
  }

  /** 启动期：注册 onInstalled / onStartup hook */
  installListeners(): void {
    const runtime = this.deps.runtime || getDefaultChromeRuntime()
    if (!runtime?.onInstalled?.addListener) {
      console.warn("[Init] chrome.runtime 不可用，跳过 listener 注册")
      return
    }
    runtime.onInstalled.addListener(async (details) => {
      console.log("[Init] onInstalled 事件触发:", details.reason)
      try {
        await this.initializeMenuSystem()
        if (INIT_CONFIG.autoCleanup) this.setupCleanupTasks()
        if (details.reason === "install") {
          this.ensureStorageDefaults()
          console.log("[Init] 🎉 触触搜扩展安装成功！")
        } else if (details.reason === "update") {
          console.log(`[Init] 🔄 触触搜扩展已更新至 v${runtime.getManifest().version}`)
        }
        // fire-and-forget
        void this.runFullPrewarming()
        void clearStaleSidepanelStates(this.deps)
      } catch (error) {
        console.error("[Init] ❌ 初始化失败:", error)
      }
    })

    if (runtime.onStartup?.addListener) {
      runtime.onStartup.addListener(async () => {
        console.log("[Init] onStartup 事件触发")
        try {
          this.debug = false  // 启动时关 debug 提升性能（与 legacy 一致）
          await this.initializeMenuSystem()
          if (INIT_CONFIG.autoCleanup) this.setupCleanupTasks()
          void prewarmUiDocuments()
          void prewarmPromptConfigs(this.deps)
        } catch (error) {
          console.error("[Init] ❌ 初始化失败:", error)
        }
      })
    }

    // 模块顶层兜底：SW 被消息事件唤醒时（既不是 install 也不是 startup）也跑一次
    void this.runFullPrewarming()

    // SW 全局错误兜底
    const sw = this.deps.self
    if (sw?.addEventListener) {
      sw.addEventListener("error", (event) => {
        console.error("[Init] 全局错误:", (event as { error?: unknown })?.error)
      })
      sw.addEventListener("unhandledrejection", (event) => {
        console.error("[Init] 未处理的 Promise 错误:", (event as { reason?: unknown })?.reason)
      })
    }
  }

  private ensureStorageDefaults(): void {
    try {
      const ch = (globalThis as unknown as { chrome?: { runtime?: { lastError?: { message?: string } | null }; storage?: { local?: { get: (keys: string[], cb: (v: Record<string, unknown>) => void) => void; set: (v: Record<string, unknown>, cb?: () => void) => void } } } }).chrome
      const local = ch?.storage?.local
      if (!local) return
      const keys = Object.keys(DEFAULT_LOCAL_STORAGE_VALUES)
      local.get(keys, (current) => {
        const readError = ch?.runtime?.lastError?.message
        if (readError) {
          console.warn("[Init] storage 默认值读取失败:", readError)
          return
        }
        const patch: Record<string, unknown> = {}
        keys.forEach((k) => {
          if (typeof current?.[k] === "undefined") patch[k] = DEFAULT_LOCAL_STORAGE_VALUES[k]
        })
        if (Object.keys(patch).length > 0) {
          local.set(patch, () => {
            const writeError = ch?.runtime?.lastError?.message
            if (writeError) {
              console.warn("[Init] storage 默认值写入失败:", writeError)
              return
            }
            console.log("[Init] ✅ storage 默认值已补齐:", Object.keys(patch))
          })
        }
      })
    } catch (error) {
      console.warn("[Init] storage 默认值初始化失败:", error)
    }
  }
}

export function createInitOrchestrator(deps: InitDeps): InitOrchestrator {
  return new InitOrchestrator(deps)
}

export default InitOrchestrator
