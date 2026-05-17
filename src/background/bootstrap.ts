/**
 * Background bootstrap helpers (TypeScript port)
 *
 * 抽自 background/base.js 的两个启动期初始化函数：
 * - initKeywordSyncSystem (行 13-31): 把 MenuRegistry 串到 KeywordSyncManager
 * - ensureMenuIconSupportLoaded (行 195-220): 读 chrome.storage.local 拿
 *   ccs_debug + menu_icon_support_storage_key 持久化 flag（singleton init pattern）
 *
 * 两者都是 SW 启动 / install / activate 时跑一次的副作用，纯函数式可注入。
 */

export interface MenuRegistryLike {
  getStats?: () => unknown
}

export interface KeywordSyncManagerCtor {
  new (registry: MenuRegistryLike): unknown
}

export interface InitKeywordSyncOptions {
  /** MenuRegistry 单例（来自 src/background/MenuRegistry.ts） */
  menuRegistry?: MenuRegistryLike | null
  /** KeywordSyncManager 类（用于构造 if 不存在 instance） */
  KeywordSyncManagerClass?: KeywordSyncManagerCtor | null
  /** 已存在的实例（避免重复构造） */
  existingInstance?: unknown
  /** 日志钩子（默认 console.log） */
  log?: (msg: string, ...args: unknown[]) => void
  /** 警告钩子（默认 console.warn） */
  warn?: (msg: string, ...args: unknown[]) => void
}

export interface InitKeywordSyncResult {
  /** 是否新建了 instance（true = 本次构造，false = 已存在 / 无法构造） */
  created: boolean
  /** 最终 instance（如果可用） */
  instance: unknown
  /** 失败原因（如有） */
  error?: string
}

/**
 * 等价 base.js initKeywordSyncSystem()。
 * 关键差异：legacy 通过 typeof globalThis.X 嗅探依赖；TS 版本通过 opts 显式传入。
 */
export function initKeywordSyncSystem(
  opts: InitKeywordSyncOptions = {}
): InitKeywordSyncResult {
  const log = opts.log || ((m: string, ...a: unknown[]) => console.log(m, ...a))
  const warn = opts.warn || ((m: string, ...a: unknown[]) => console.warn(m, ...a))

  log("[触触搜] initKeywordSyncSystem called")

  if (!opts.menuRegistry) {
    warn("[触触搜] menuRegistry 未定义，可能 MenuRegistry.js 未加载")
    return { created: false, instance: null, error: "no-menu-registry" }
  }

  log("[触触搜] menuRegistry found, stats:", opts.menuRegistry.getStats?.())

  if (opts.existingInstance) {
    log("[触触搜] keywordSyncManager already initialized")
    return { created: false, instance: opts.existingInstance }
  }

  if (!opts.KeywordSyncManagerClass) {
    warn("[触触搜] KeywordSyncManager class not found")
    return { created: false, instance: null, error: "no-ctor" }
  }

  const instance = new opts.KeywordSyncManagerClass(opts.menuRegistry)
  const stats = (instance as { getStats?: () => unknown })?.getStats?.()
  log("[触触搜] KeywordSyncManager 已初始化, stats:", stats)
  return { created: true, instance }
}

// ============================================
// 菜单 icon 支持持久化
// ============================================
//
// Chrome 在某些版本/平台不支持 chrome.contextMenus.update({icons}) 的 dataURL
// path。我们在第一次跑时探测，把结果缓存到 chrome.storage.local。
// 这个 helper 把 SW 重启时的"加载 cached flag"流程封装成 idempotent Promise。

export interface ChromeStorageGetLite {
  get: (
    keys: string[],
    cb: (res: Record<string, unknown>) => void
  ) => void
}

export interface MenuIconSupportState {
  loaded: boolean
  loadPromise: Promise<void> | null
  supported: boolean
}

export interface EnsureMenuIconSupportOptions {
  /** 共享 state object（与 legacy globalThis.menuIconUpdateSupported 共享） */
  state: MenuIconSupportState
  /** chrome.storage.local */
  storage?: ChromeStorageGetLite
  /** 持久化 key（与 legacy MENU_ICON_SUPPORT_STORAGE_KEY 等价） */
  storageKey: string
  /** debug flag setter (BG_DEBUG global) */
  setDebug?: (v: boolean) => void
  /** logMenuEvent 钩子 */
  logMenuEvent?: (stage: string, payload: Record<string, unknown>) => void
}

function getDefaultStorage(): ChromeStorageGetLite | undefined {
  const ch = (globalThis as unknown as { chrome?: { storage?: { local?: ChromeStorageGetLite } } }).chrome
  return ch?.storage?.local
}

/**
 * 等价 base.js ensureMenuIconSupportLoaded(): 第一次调时跑 storage.local.get
 * 拿持久化 flag，之后所有调用复用同一个 Promise（idempotent）。
 */
export function ensureMenuIconSupportLoaded(opts: EnsureMenuIconSupportOptions): Promise<void> {
  if (opts.state.loaded) return Promise.resolve()
  if (opts.state.loadPromise) return opts.state.loadPromise

  const storage = opts.storage || getDefaultStorage()
  if (!storage?.get) {
    opts.state.loaded = true
    return Promise.resolve()
  }

  opts.state.loadPromise = new Promise<void>((resolve) => {
    storage.get(["ccs_debug", opts.storageKey], (res) => {
      const data = res || {}
      if (typeof data.ccs_debug === "boolean" && opts.setDebug) {
        opts.setDebug(data.ccs_debug)
      }
      const iconSupport = data[opts.storageKey]
      if (typeof iconSupport === "boolean") {
        opts.state.supported = iconSupport
        if (!iconSupport) {
          opts.logMenuEvent?.("icon-skip", { reason: "persisted-unsupported" })
        }
      }
      opts.state.loaded = true
      resolve()
    })
  })
  return opts.state.loadPromise
}

export function createMenuIconSupportState(): MenuIconSupportState {
  return { loaded: false, loadPromise: null, supported: true }
}

export default { initKeywordSyncSystem, ensureMenuIconSupportLoaded, createMenuIconSupportState }
