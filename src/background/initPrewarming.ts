/**
 * SW 初始化预热 (TypeScript port)
 *
 * Port 自 background/init.js 的 prewarmPromptConfigs / clearStaleSidepanelStates。
 *
 * 这是 onInstalled / onStartup 触发的预热逻辑：在 SW 启动后台并行加载所有 config
 * 让 loader 内 globalThis cache 命中，节省后续右键菜单/sidepanel 首次 RPC 的成本。
 *
 * v1.6.19：移除了 prewarmPopupMenuStructure —— SW idle 30s 被回收时，popup 反而
 * 因为 prewarm 是空的而走 fallback fetch，写 prewarm 本身只为热路径加速但与卡顿场景
 * 互斥。统一让 popup 走本地 fetch（不依赖 SW），冷热表现一致。
 *
 * 所有依赖通过 deps 参数注入，便于测试。
 */

import type {
  UnifiedMenuConfig,
  EnginesConfig,
  PromptConfig
} from "../shared/types"

export interface PrewarmConfigsResult {
  ok: number
  total: number
  ms: number
}

export interface PrewarmDeps {
  /** 6 个 loader (返回 config 或 null) */
  loaders: {
    unified: () => Promise<UnifiedMenuConfig | null>
    engines: () => Promise<EnginesConfig | null>
    top100: () => Promise<PromptConfig | null>
    fastqa: () => Promise<PromptConfig | null>
    optimize: () => Promise<PromptConfig | null>
    cover: () => Promise<PromptConfig | null>
  }
  /** chrome.storage.local 注入 */
  storageGet: (keys: string[] | null) => Promise<Record<string, unknown>>
  storageSet: (data: Record<string, unknown>) => Promise<void>
  storageRemove: (keys: string[]) => Promise<void>
  /** chrome.runtime.getManifest().version */
  getManifestVersion: () => string
  /** 调试日志（可选） */
  debug?: (...args: unknown[]) => void
}

/**
 * 并行预热 6 个 config loader。loader 内部会 cache 结果，后续 popup 打开时是 cache hit。
 * 幂等：重复调用零成本（loader 自己 cache check）。
 */
export async function prewarmPromptConfigs(
  deps: PrewarmDeps
): Promise<PrewarmConfigsResult> {
  const startedAt = Date.now()
  const tasks = [
    deps.loaders.optimize().catch(() => null),
    deps.loaders.cover().catch(() => null),
    deps.loaders.top100().catch(() => null),
    deps.loaders.fastqa().catch(() => null),
    deps.loaders.unified().catch(() => null),
    deps.loaders.engines().catch(() => null)
  ]
  const results = await Promise.allSettled(tasks)
  const ok = results.filter((r) => r.status === "fulfilled" && r.value !== null).length
  const total = results.length
  const ms = Date.now() - startedAt
  deps.debug?.(`[Init] 🔥 prompt 缓存预热完成 (${ok}/${total}, ${ms}ms)`)
  return { ok, total, ms }
}

/**
 * 清理上一次浏览器会话遗留的 sidepanel 状态键（onInstalled 时调用）。
 *
 * sidepanel 状态 = `ccs_sp_open_<windowId>` 键。如果上次 Chrome 异常退出，
 * 这些键可能残留，污染本次 popup 显示的"开/关侧边栏"按钮状态。
 */
export async function clearStaleSidepanelStates(deps: PrewarmDeps): Promise<number> {
  try {
    const all = await deps.storageGet(null)
    const keys = Object.keys(all).filter((k) => k.startsWith("ccs_sp_open_"))
    if (keys.length > 0) {
      await deps.storageRemove(keys)
      deps.debug?.(`[Init] 🧹 清理了 ${keys.length} 个旧 sidepanel 状态键`)
    }
    return keys.length
  } catch (_) {
    return 0
  }
}

/**
 * 默认 deps 工厂：从 chrome.* + globalThis loaders 构造。
 * 生产 SW 直接 `runPrewarming(createDefaultPrewarmDeps())`。
 */
export function createDefaultPrewarmDeps(): PrewarmDeps {
  const ch = (globalThis as unknown as {
    chrome?: {
      runtime?: { getManifest?: () => { version?: string } }
      storage?: {
        local?: {
          get: (keys: string[] | null, cb: (r: Record<string, unknown>) => void) => void
          set: (data: Record<string, unknown>, cb: () => void) => void
          remove: (keys: string[], cb: () => void) => void
        }
      }
    }
  }).chrome

  const localFns = ch?.storage?.local

  const safeLoader = (name: string) => async (): Promise<null> => {
    const fn = (globalThis as unknown as Record<string, unknown>)[name]
    if (typeof fn !== "function") return null
    try { return (await (fn as () => Promise<unknown>)()) as null } catch (_) { return null }
  }

  return {
    loaders: {
      unified: safeLoader("loadUnifiedMenuConfig") as () => Promise<UnifiedMenuConfig | null>,
      engines: safeLoader("loadEnginesConfig") as () => Promise<EnginesConfig | null>,
      top100: safeLoader("loadTopQuestionsConfig") as () => Promise<PromptConfig | null>,
      fastqa: safeLoader("loadFastAnswersConfig") as () => Promise<PromptConfig | null>,
      optimize: safeLoader("loadOptimizedPromptConfig") as () => Promise<PromptConfig | null>,
      cover: safeLoader("loadCoverPromptConfig") as () => Promise<PromptConfig | null>
    },
    storageGet: (keys) => new Promise((resolve) => {
      if (!localFns) { resolve({}); return }
      localFns.get(keys as string[] | null, (r) => resolve(r))
    }),
    storageSet: (data) => new Promise((resolve) => {
      if (!localFns) { resolve(); return }
      localFns.set(data, () => resolve())
    }),
    storageRemove: (keys) => new Promise((resolve) => {
      if (!localFns) { resolve(); return }
      localFns.remove(keys, () => resolve())
    }),
    getManifestVersion: () => ch?.runtime?.getManifest?.()?.version || "0.0.0",
    debug: (...args) => console.log(...args)
  }
}

/**
 * 一站式入口：跑完整预热流程（onInstalled 触发用）。
 * v1.6.19：去掉 prewarmPopupMenuStructure，popup 端不再依赖 storage prewarm。
 */
export async function runFullPrewarming(deps?: PrewarmDeps): Promise<void> {
  const d = deps || createDefaultPrewarmDeps()
  await prewarmPromptConfigs(d)
  await clearStaleSidepanelStates(d)
}

export default {
  prewarmPromptConfigs,
  clearStaleSidepanelStates,
  createDefaultPrewarmDeps,
  runFullPrewarming
}
