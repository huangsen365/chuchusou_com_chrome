/**
 * 菜单系统集成模块 (TypeScript port)
 *
 * Port 自 background/menuSystem.js。
 *
 * 协调 StateManager + URLBuilder + (可选) MenuManager 三个新核心。
 * 当 useNewSystem=false 时（生产）只激活 StateManager + URLBuilder，
 * 把它们 expose 给 legacy 代码用（_menuSystemCompat / _stateManagerLegacy）。
 *
 * MenuManager 已删除（legacy/_unactivated/ 已清理），
 * 所以 useNewSystem=true 分支保留作未来扩展，本 TS 版本不实例化它。
 */

import { StateManager } from "./StateManager"
import { URLBuilder } from "./URLBuilder"
import type { UnifiedMenuConfig } from "../shared/types"

export interface MenuSystemInitOptions {
  debug?: boolean
  useNewSystem?: boolean
  cacheExpiry?: {
    TITLE?: number
    KEYWORD?: number
    SELECTION?: number
  }
  fetchConfig?: () => Promise<UnifiedMenuConfig>
}

export interface MenuSystemAPI {
  init: (options?: MenuSystemInitOptions) => Promise<void>
  getStateManager: () => StateManager | null
  getURLBuilder: () => URLBuilder | null
  getSystemConfig: () => UnifiedMenuConfig | null
  setMenuState: (rawText: string, normalizedText: string, meta?: { tabId?: number | null; url?: string }) => void
  formatMenuTitle: (text: string) => string
  buildMenuUrl: (menuId: string, params: { raw?: string; normalized?: string; prompt?: string }) => string | null
  rebuildMenus: () => Promise<void>
}

let stateManager: StateManager | null = null
let urlBuilder: URLBuilder | null = null
let systemConfig: UnifiedMenuConfig | null = null

async function defaultFetchConfig(): Promise<UnifiedMenuConfig> {
  const ch = (globalThis as unknown as { chrome?: { runtime?: { getURL: (p: string) => string } } }).chrome
  const url = ch?.runtime?.getURL?.("config/unifiedMenuConfig.json") || "config/unifiedMenuConfig.json"
  const response = await fetch(url)
  return (await response.json()) as UnifiedMenuConfig
}

export async function initMenuSystem(options: MenuSystemInitOptions = {}): Promise<void> {
  const {
    debug = false,
    useNewSystem = false,
    cacheExpiry,
    fetchConfig = defaultFetchConfig
  } = options

  console.log("[MenuSystem] Initializing...", { debug, useNewSystem })

  try {
    stateManager = new StateManager({
      debug,
      stateExpiry: 5 * 60 * 1000,
      autoCleanupInterval: 60 * 1000,
      titleCacheExpiry: cacheExpiry?.TITLE ?? 30000,
      keywordCacheExpiry: cacheExpiry?.KEYWORD ?? 30000,
      selectionCacheExpiry: cacheExpiry?.SELECTION ?? 10000
    })

    const legacyProxy = stateManager.createLegacyProxy()
    const g = globalThis as unknown as { _stateManagerLegacy?: unknown; _menuSystemCompat?: unknown }
    g._stateManagerLegacy = legacyProxy

    urlBuilder = new URLBuilder({ debug, autoEncode: true })

    try {
      systemConfig = await fetchConfig()
      console.log("[MenuSystem] Config loaded:", {
        version: systemConfig?.version,
        groups: systemConfig?.groups?.length
      })
    } catch (error) {
      console.error("[MenuSystem] Failed to load unified config:", error)
      throw error
    }

    try {
      const count = urlBuilder.loadFromConfig(systemConfig as unknown as {
        groups: Array<{ items?: Array<{ id: string; urlPattern?: string; children?: Array<{ id: string; urlPattern?: string }> }> }>
      })
      console.log("[MenuSystem] URLBuilder loaded", count, "templates from config")
    } catch (err) {
      console.warn("[MenuSystem] URLBuilder.loadFromConfig failed (非致命):", (err as Error)?.message)
    }

    if (useNewSystem) {
      // useNewSystem 分支：MenuManager 已删除，本 TS 版本不实例化。
      // 留作未来扩展（如果 SW 真切到 Plasmo entry 时要用新菜单系统）。
      console.warn("[MenuSystem] useNewSystem=true 但 MenuManager 已下线，仅 stateManager+urlBuilder 可用")
    } else {
      console.log("[MenuSystem] Running in compatibility mode (old system + new utilities)")
      g._menuSystemCompat = { stateManager, urlBuilder, systemConfig }
    }
  } catch (error) {
    console.error("[MenuSystem] Initialization failed:", error)
    throw error
  }
}

export function getStateManager(): StateManager | null { return stateManager }
export function getURLBuilder(): URLBuilder | null { return urlBuilder }
export function getSystemConfig(): UnifiedMenuConfig | null { return systemConfig }

export function setMenuState(
  rawText: string,
  normalizedText: string,
  meta: { tabId?: number | null; url?: string } = {}
): void {
  if (!stateManager) {
    console.warn("[MenuSystem] StateManager not initialized")
    return
  }
  const display = formatMenuTitle(rawText)
  stateManager.setCurrentState({
    raw: rawText,
    normalized: normalizedText,
    display,
    tabId: meta.tabId ?? null,
    url: meta.url || ""
  })
}

export function formatMenuTitle(text: string): string {
  if (!text) return ""
  const maxLength = (systemConfig?.constants as { maxDisplayLength?: number } | undefined)?.maxDisplayLength || 20
  if (text.length > maxLength) return text.slice(0, maxLength) + "..."
  return text
}

export function buildMenuUrl(
  menuId: string,
  params: { raw?: string; normalized?: string; prompt?: string }
): string | null {
  if (!urlBuilder) {
    console.warn("[MenuSystem] URLBuilder not initialized")
    return null
  }
  return urlBuilder.build(menuId, params)
}

/**
 * 在 TS land 里 rebuildMenus 只 noop —— 因为 legacy MenuManager 已下线。
 * Legacy 代码继续走 createContextMenus()。
 */
export async function rebuildMenus(): Promise<void> {
  console.warn("[MenuSystem] rebuildMenus: TS 实现为 noop（MenuManager 已下线）")
}

/**
 * 与 legacy 兼容的全局命名空间。SW importScripts 顺序加载时，
 * legacy 代码通过 globalThis.MenuSystem 访问。
 */
export const MenuSystem: MenuSystemAPI = {
  init: initMenuSystem,
  getStateManager,
  getURLBuilder,
  getSystemConfig,
  setMenuState,
  formatMenuTitle,
  buildMenuUrl,
  rebuildMenus
}

export default MenuSystem
