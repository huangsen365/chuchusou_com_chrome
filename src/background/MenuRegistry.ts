/**
 * 菜单注册表模块 (TypeScript port)
 *
 * 与 background/MenuRegistry.js 等价。差异：
 * - legacy `_updateMenuItem` 直接调用 chrome.contextMenus.update；
 *   TS 版本通过 `updater` 注入函数实现解耦，dual-run verifier 可注入 noop
 *   实际生产里调用方传入 chrome.contextMenus.update 的 wrapper 即可
 * - legacy 用 globalThis.logMenuEvent 副作用日志；TS 版本通过可选 `logger` 参数注入
 */

export interface MenuConfig {
  id: string
  parentId?: string
  title?: string
  icon?: string
  titleTemplate?: string
  syncGroup?: string
  autoSync?: boolean
  onSyncFailed?: (menuId: string, errorMessage: string) => void
  createOptions?: Record<string, unknown>
  [key: string]: unknown
}

export interface SyncContext {
  keyword?: string
  raw?: string
  normalized?: string
  tabId?: number
}

export interface UpdateResult {
  ok: boolean
  error?: { message?: string }
}

export type MenuUpdater = (menuId: string, title: string) => Promise<UpdateResult>

export type MenuLogger = (event: string, payload: Record<string, unknown>) => void

export interface SyncSummary {
  success: number
  failed: number
}

export interface SyncAllSummary extends SyncSummary {
  total: number
}

export interface RegistryStats {
  totalItems: number
  syncableItems: number
  groups: number
  groupDetails: Array<{ name: string; count: number }>
}

export class MenuRegistry {
  items: Map<string, MenuConfig>
  syncGroups: Map<string, Set<string>>
  syncableItems: Set<string>
  labelPattern: RegExp
  keywordPlaceholderPattern: RegExp

  constructor() {
    this.items = new Map()
    this.syncGroups = new Map()
    this.syncableItems = new Set()
    this.labelPattern = /-label$/
    this.keywordPlaceholderPattern = /\$\{keyword\}/i
  }

  register(config: MenuConfig): boolean {
    if (!config || !config.id) {
      console.warn("[MenuRegistry] Invalid config: missing id", config)
      return false
    }

    this.items.set(config.id, config)

    const needsSync = this._shouldSync(config)

    if (needsSync) {
      this.syncableItems.add(config.id)
      if (config.syncGroup) {
        if (!this.syncGroups.has(config.syncGroup)) {
          this.syncGroups.set(config.syncGroup, new Set())
        }
        this.syncGroups.get(config.syncGroup)!.add(config.id)
      }
    }

    return true
  }

  unregister(menuId: string): void {
    const config = this.items.get(menuId)
    if (!config) return

    this.items.delete(menuId)
    this.syncableItems.delete(menuId)

    if (config.syncGroup) {
      const group = this.syncGroups.get(config.syncGroup)
      if (group) {
        group.delete(menuId)
        if (group.size === 0) {
          this.syncGroups.delete(config.syncGroup)
        }
      }
    }
  }

  private _shouldSync(config: MenuConfig): boolean {
    if (config.autoSync === true) return true
    if (config.autoSync === false) return false

    if (config.titleTemplate && this.keywordPlaceholderPattern.test(config.titleTemplate)) {
      return true
    }

    if (this.labelPattern.test(config.id)) {
      return true
    }

    if (config.syncGroup) {
      return true
    }

    return false
  }

  renderTitle(config: MenuConfig, context: SyncContext): string {
    const { keyword = "", raw = "", normalized = "" } = context

    if (config.titleTemplate) {
      return config.titleTemplate
        .replace(/\$\{keyword\}/g, keyword)
        .replace(/\$\{raw\}/g, raw)
        .replace(/\$\{normalized\}/g, normalized)
        .replace(/\$\{title\}/g, config.title || "")
        .replace(/\$\{icon\}/g, config.icon || "")
    }

    const base = config.icon ? `${config.icon} ${config.title}` : config.title || ""
    return keyword ? `${base}: "${keyword}"` : base
  }

  /**
   * 同步特定组 — updater 注入，legacy 那个 chrome.contextMenus.update 包成 updater 即可
   */
  async syncGroupWith(
    groupName: string,
    context: SyncContext,
    updater: MenuUpdater,
    logger?: MenuLogger
  ): Promise<SyncSummary> {
    const group = this.syncGroups.get(groupName)
    if (!group || group.size === 0) {
      return { success: 0, failed: 0 }
    }

    const promises: Array<Promise<UpdateResult>> = []
    for (const menuId of group) {
      const config = this.items.get(menuId)
      if (!config) continue
      const title = this.renderTitle(config, context)
      promises.push(this._runUpdate(updater, menuId, title, config, logger))
    }

    const results = await Promise.allSettled(promises)
    const success = results.filter((r) => r.status === "fulfilled" && r.value.ok).length
    const failed = results.length - success
    return { success, failed }
  }

  async syncAllWith(
    context: SyncContext,
    updater: MenuUpdater,
    logger?: MenuLogger
  ): Promise<SyncAllSummary> {
    logger?.("menu-registry-sync-all-start", {
      syncableItemsCount: this.syncableItems.size,
      keyword: context.keyword,
      raw: context.raw,
      normalized: context.normalized
    })

    if (this.syncableItems.size === 0) {
      logger?.("menu-registry-no-syncable-items", {})
      return { success: 0, failed: 0, total: 0 }
    }

    const promises: Array<Promise<UpdateResult>> = []
    const menuIds: Array<{ menuId: string; title: string }> = []
    for (const menuId of this.syncableItems) {
      const config = this.items.get(menuId)
      if (!config) {
        logger?.("menu-registry-missing-config", { menuId })
        continue
      }
      const title = this.renderTitle(config, context)
      menuIds.push({ menuId, title })
      promises.push(this._runUpdate(updater, menuId, title, config, logger))
    }

    logger?.("menu-registry-updating-items", { count: menuIds.length, items: menuIds })

    const results = await Promise.allSettled(promises)
    const success = results.filter((r) => r.status === "fulfilled" && r.value.ok).length
    const failed = results.length - success

    logger?.("menu-registry-sync-all", {
      total: results.length,
      success,
      failed,
      keyword: context.keyword || context.normalized || context.raw
    })

    return { success, failed, total: results.length }
  }

  private async _runUpdate(
    updater: MenuUpdater,
    menuId: string,
    title: string,
    config: MenuConfig,
    logger?: MenuLogger
  ): Promise<UpdateResult> {
    const result = await updater(menuId, title)
    if (!result.ok) {
      const errorMsg = result.error?.message || ""
      if (!/Cannot find menu item/i.test(errorMsg)) {
        console.warn(`[MenuRegistry] Failed to update menu ${menuId}:`, errorMsg)
        config.onSyncFailed?.(menuId, errorMsg)
        logger?.("menu-sync-failed", { menuId, error: errorMsg })
      }
    } else {
      logger?.("menu-synced", { menuId, title })
    }
    return result
  }

  getAllMenuIds(): string[] {
    return Array.from(this.items.keys())
  }

  getSyncableMenuIds(): string[] {
    return Array.from(this.syncableItems)
  }

  getGroupMenuIds(groupName: string): string[] {
    const group = this.syncGroups.get(groupName)
    return group ? Array.from(group) : []
  }

  has(menuId: string): boolean {
    return this.items.has(menuId)
  }

  get(menuId: string): MenuConfig | undefined {
    return this.items.get(menuId)
  }

  clear(): void {
    this.items.clear()
    this.syncGroups.clear()
    this.syncableItems.clear()
  }

  getStats(): RegistryStats {
    return {
      totalItems: this.items.size,
      syncableItems: this.syncableItems.size,
      groups: this.syncGroups.size,
      groupDetails: Array.from(this.syncGroups.entries()).map(([name, ids]) => ({
        name,
        count: ids.size
      }))
    }
  }
}

export const menuRegistry = new MenuRegistry()

export default MenuRegistry
