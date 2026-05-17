/**
 * 菜单调试信息收集 (TypeScript port)
 *
 * 抽自 background/base.js 行 703-835 的 getMenuDebugInfo(tabId)。
 *
 * 用途：popup 调试面板 / "导出菜单状态" 按钮 / 故障排查时一次性 dump 所有
 * 全局菜单状态。生产路径不会调用，纯诊断工具。
 *
 * 不做行为对齐 dual-run（debug 输出格式可以演进），但保持 5 个 section 不变：
 *   1. activeTab / 2. currentMenuState / 3. globalCaches / 4. menuRegistry
 *   5. keywordSyncManager (+ variableSources + dataFlow 说明)
 */

export interface ChromeTabsGetLite {
  get: (tabId: number) => Promise<{ url?: string; title?: string }>
}

export interface MenuRegistryLike {
  getStats?: () => unknown
  getAllMenuIds?: () => string[]
  get?: (id: string) => {
    title?: string
    icon?: string
    titleTemplate?: string
    syncGroup?: string
    autoSync?: boolean
    parentId?: string
  } | null
}

export interface KeywordSyncManagerLike {
  getState?: () => unknown
  getStats?: () => unknown
}

export interface MenuStateLike {
  raw: string
  normalized: string
  display: string
  tabId: number | null
  url: string
}

export type CacheMap = Record<string | number, unknown>

export interface MenuDebugInfoDeps {
  currentMenuState: MenuStateLike
  selectedTextByTab?: CacheMap | null
  fallbackKeywordByTab?: CacheMap | null
  latestTitleByTab?: CacheMap | null
  menuRegistry?: MenuRegistryLike | null
  keywordSyncManager?: KeywordSyncManagerLike | null
  tabs?: ChromeTabsGetLite
}

interface DebugActiveTab {
  tabId: number | null
  url: string | null
  title: string | null
  error?: string
}

interface DebugMenuRegistry {
  available: boolean
  stats: unknown
  registeredMenus?: Record<string, unknown>
  error?: string
}

interface DebugKeywordSyncManager {
  available: boolean
  currentState: unknown
  stats: unknown
  error?: string
}

export interface MenuDebugInfo {
  timestamp: string
  generatedAt: number
  activeTab: DebugActiveTab
  currentMenuState: {
    raw: string
    normalized: string
    display: string
    tabId: number | null
    url: string
  }
  globalCaches: {
    selectedTextByTab: CacheMap
    fallbackKeywordByTab: CacheMap
    latestTitleByTab: CacheMap
  }
  menuRegistry: DebugMenuRegistry
  keywordSyncManager: DebugKeywordSyncManager
  variableSources: Record<string, string>
  dataFlow: {
    description: string
    steps: string[]
  }
}

function getDefaultChromeTabs(): ChromeTabsGetLite | undefined {
  const ch = (globalThis as unknown as { chrome?: { tabs?: ChromeTabsGetLite } }).chrome
  return ch?.tabs
}

export async function getMenuDebugInfo(
  tabId: number | null,
  deps: MenuDebugInfoDeps
): Promise<MenuDebugInfo> {
  const info: MenuDebugInfo = {
    timestamp: new Date().toISOString(),
    generatedAt: Date.now(),
    activeTab: { tabId: tabId ?? null, url: null, title: null },
    currentMenuState: {
      raw: deps.currentMenuState.raw,
      normalized: deps.currentMenuState.normalized,
      display: deps.currentMenuState.display,
      tabId: deps.currentMenuState.tabId,
      url: deps.currentMenuState.url
    },
    globalCaches: {
      selectedTextByTab: {},
      fallbackKeywordByTab: {},
      latestTitleByTab: {}
    },
    menuRegistry: { available: !!deps.menuRegistry, stats: null },
    keywordSyncManager: { available: !!deps.keywordSyncManager, currentState: null, stats: null },
    variableSources: {
      currentMenuState: "background/base.js (全局变量)",
      selectedTextByTab: "background/base.js (全局变量，由 events.js 更新)",
      fallbackKeywordByTab: "background/base.js (全局变量，由 keywordResolver.js 更新)",
      latestTitleByTab: "background/base.js (全局变量，由 events.js 更新)",
      menuRegistry: "background/MenuRegistry.js (单例)",
      keywordSyncManager: "background/KeywordSyncManager.js (单例)"
    },
    dataFlow: {
      description: "关键字更新流程",
      steps: [
        "1. 用户操作触发 (选中文本/Tab切换) → events.js",
        "2. events.js 更新全局缓存 (selectedTextByTab/fallbackKeywordByTab/latestTitleByTab)",
        "3. events.js 调用 setMenuState(raw, normalized, meta)",
        "4. setMenuState 更新 currentMenuState",
        "5. setMenuState 调用 keywordSyncManager.update()",
        "6. setMenuState 调用 keywordSyncManager.syncMenus()",
        "7. syncMenus 调用 menuRegistry.syncAll(context)",
        "8. menuRegistry.syncAll 遍历所有注册的菜单项",
        "9. 使用 titleTemplate 渲染标题",
        "10. 调用 chrome.contextMenus.update() 更新菜单",
        "11. (同时) 旧系统调用 updateMainMenuTitle/updateSearchLabelTitle/updateSubmenuLabels"
      ]
    }
  }

  // 1. tab 详细信息
  if (tabId != null) {
    const tabs = deps.tabs || getDefaultChromeTabs()
    if (tabs?.get) {
      try {
        const tab = await tabs.get(tabId)
        info.activeTab.url = tab.url ?? null
        info.activeTab.title = tab.title ?? null
      } catch (error) {
        info.activeTab.error = (error as Error)?.message
      }
    }
  }

  // 2. 全局缓存 shallow copy
  if (deps.selectedTextByTab) Object.assign(info.globalCaches.selectedTextByTab, deps.selectedTextByTab)
  if (deps.fallbackKeywordByTab) Object.assign(info.globalCaches.fallbackKeywordByTab, deps.fallbackKeywordByTab)
  if (deps.latestTitleByTab) Object.assign(info.globalCaches.latestTitleByTab, deps.latestTitleByTab)

  // 3. MenuRegistry stats + 注册项详情
  if (deps.menuRegistry) {
    try {
      info.menuRegistry.stats = deps.menuRegistry.getStats?.() ?? null
      const allMenuIds = deps.menuRegistry.getAllMenuIds?.() ?? []
      const registered: Record<string, unknown> = {}
      for (const menuId of allMenuIds) {
        const config = deps.menuRegistry.get?.(menuId)
        if (config) {
          registered[menuId] = {
            title: config.title,
            icon: config.icon,
            titleTemplate: config.titleTemplate,
            syncGroup: config.syncGroup,
            autoSync: config.autoSync,
            parentId: config.parentId
          }
        }
      }
      info.menuRegistry.registeredMenus = registered
    } catch (error) {
      info.menuRegistry.error = (error as Error)?.message
    }
  }

  // 4. KeywordSyncManager state + stats
  if (deps.keywordSyncManager) {
    try {
      info.keywordSyncManager.currentState = deps.keywordSyncManager.getState?.() ?? null
      info.keywordSyncManager.stats = deps.keywordSyncManager.getStats?.() ?? null
    } catch (error) {
      info.keywordSyncManager.error = (error as Error)?.message
    }
  }

  return info
}

export default { getMenuDebugInfo }
