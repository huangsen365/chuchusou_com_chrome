/**
 * 菜单图标支持 (TypeScript port)
 *
 * 与 background/icons.js 1:1 行为对等。所有 chrome.* + globalThis 依赖通过 deps 参数注入。
 *
 * 设计：
 *   - createImageDataFromUrl + resolveMenuIconTargets 是纯函数 + fetch + Canvas，参数化即可
 *   - applyMenuIcons 编排函数，依赖 chrome.contextMenus.update + chrome.storage + 多个状态
 */

export interface IconConfig {
  localPath?: string
  remoteUrl?: string
  size?: number
}

export interface MenuIconRegistryConfig {
  items?: Record<string, IconConfig>
  defaultSize?: number
}

export interface IconHandlerDeps {
  /** 缓存 imageData，避免重复 fetch + decode */
  imageCache: Map<string, ImageData>
  /** 默认 chrome.runtime.getURL */
  getExtensionUrl: (path: string) => string
  /** 默认 chrome.contextMenus.update */
  updateContextMenuIcon: (menuId: string, icons: Record<number, ImageData>) => Promise<{ ok: boolean; error?: string }>
  /** 检查菜单是否启用 */
  isMenuEnabled: (menuId: string) => boolean
  /** 加载图标配置 */
  loadConfig: () => Promise<MenuIconRegistryConfig | null>
  /** 当前 build 计数器（race condition 防护） */
  getBuildId: () => number
  /** 标记菜单图标 API 不支持（保存到 storage） */
  markIconUnsupported: () => Promise<void>
  /** 调试日志 */
  debug?: (...args: unknown[]) => void
  /** 事件日志 */
  logEvent?: (event: string, payload: Record<string, unknown>) => void
}

export async function createImageDataFromUrl(
  url: string,
  size: number,
  cache: Map<string, ImageData>,
  debug?: (...args: unknown[]) => void
): Promise<ImageData | null> {
  try {
    const cacheKey = `${url}@${size}`
    if (cache.has(cacheKey)) {
      debug?.("[触触搜][BG][ICON] cache hit", cacheKey)
      return cache.get(cacheKey)!
    }
    const isExtensionResource = url.startsWith("chrome-extension://")
    const fetchOptions: RequestInit = isExtensionResource ? {} : { mode: "cors" }
    debug?.("[触触搜][BG][ICON] fetching image", { url, size, fetchOptions })
    const response = await fetch(url, fetchOptions)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const blob = await response.blob()
    const imageBitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(size, size)
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable")
    ctx.clearRect(0, 0, size, size)
    const scale = Math.min(size / imageBitmap.width, size / imageBitmap.height, 1)
    const targetWidth = imageBitmap.width * scale
    const targetHeight = imageBitmap.height * scale
    const dx = (size - targetWidth) / 2
    const dy = (size - targetHeight) / 2
    ctx.drawImage(imageBitmap, dx, dy, targetWidth, targetHeight)
    const imageData = ctx.getImageData(0, 0, size, size)
    debug?.("[触触搜][BG][ICON] image processed", { url, size, scale })
    cache.set(cacheKey, imageData)
    return imageData
  } catch (error) {
    console.warn("[触触搜][BG] 无法加载远程图标:", url, error)
    return null
  }
}

export async function resolveMenuIconTargets(
  iconConfig: IconConfig,
  defaultSize: number,
  deps: { cache: Map<string, ImageData>; getExtensionUrl: (p: string) => string; debug?: (...args: unknown[]) => void }
): Promise<Record<number, ImageData> | null> {
  if (!iconConfig) return null
  const size = Number.isFinite(iconConfig.size) ? iconConfig.size! : defaultSize
  deps.debug?.("[触触搜][BG][ICON] resolveMenuIconTargets", { iconConfig, size })

  if (iconConfig.localPath) {
    const localUrl = deps.getExtensionUrl(iconConfig.localPath)
    const localImageData = await createImageDataFromUrl(localUrl, size, deps.cache, deps.debug)
    if (localImageData) {
      deps.debug?.("[触触搜][BG][ICON] using local image data", { localUrl, size })
      return { [size]: localImageData }
    }
    console.warn("[触触搜][BG] 本地图标加载失败，尝试远程图标:", iconConfig.localPath)
  }

  if (iconConfig.remoteUrl) {
    const imageData = await createImageDataFromUrl(iconConfig.remoteUrl, size, deps.cache, deps.debug)
    if (imageData) {
      deps.debug?.("[触触搜][BG][ICON] using remote image data", { url: iconConfig.remoteUrl, size })
      return { [size]: imageData }
    }
  }

  return null
}

interface ApplyMenuIconsState {
  inProgress: boolean
  iconUpdateSupported: boolean
}

/**
 * applyMenuIcons 完整工厂。状态通过 state 对象保存（mutable）便于多个调用之间共享。
 *
 * 用法：
 *   const state = { inProgress: false, iconUpdateSupported: true }
 *   await applyMenuIcons(state, buildId, deps)
 */
export async function applyMenuIcons(
  state: ApplyMenuIconsState,
  buildId: number,
  deps: IconHandlerDeps
): Promise<void> {
  if (state.inProgress) {
    deps.logEvent?.("icon-skip", { reason: "update-in-progress" })
    return
  }
  state.inProgress = true

  if (!state.iconUpdateSupported) {
    deps.logEvent?.("icon-skip", { reason: "unsupported" })
    state.inProgress = false
    return
  }

  const config = await deps.loadConfig()
  if (buildId !== deps.getBuildId()) {
    state.inProgress = false
    return
  }
  if (!config?.items) {
    state.inProgress = false
    return
  }
  const itemEntries = Object.entries(config.items)
  if (!itemEntries.length) {
    state.inProgress = false
    return
  }

  deps.debug?.("[触触搜][BG][ICON] applying menu icons", { buildId, items: Object.keys(config.items || {}) })
  const defaultSize = config.defaultSize || 16

  for (const [menuId, iconCfg] of itemEntries) {
    if (!state.iconUpdateSupported) {
      deps.logEvent?.("icon-abort", { reason: "unsupported-detected-during-update" })
      break
    }
    try {
      if (!deps.isMenuEnabled(menuId)) continue
      const icons = await resolveMenuIconTargets(iconCfg, defaultSize, {
        cache: deps.imageCache,
        getExtensionUrl: deps.getExtensionUrl,
        debug: deps.debug
      })
      if (!icons || buildId !== deps.getBuildId()) continue
      if (!state.iconUpdateSupported) break

      deps.debug?.("[触触搜][BG][ICON] updating menu icon", { menuId, icons: Object.keys(icons) })
      const result = await deps.updateContextMenuIcon(menuId, icons)
      if (!result.ok) {
        const msg = result.error || ""
        console.warn("[触触搜][BG] 更新菜单图标失败:", menuId, msg)
        deps.logEvent?.("icon-update-error", { menuId, message: msg })
        if (/Unexpected property: 'icons'/i.test(msg)) {
          if (state.iconUpdateSupported) {
            state.iconUpdateSupported = false
            await deps.markIconUnsupported()
          }
          deps.logEvent?.("icon-disable", { reason: msg })
        }
      } else {
        deps.debug?.("[触触搜][BG][ICON] menu icon applied", menuId)
      }

      if (!state.iconUpdateSupported) {
        deps.logEvent?.("icon-abort", { reason: "unsupported-after-update", menuId })
        break
      }
    } catch (error) {
      const message = (error as Error)?.message || String(error)
      console.warn("[触触搜][BG] 处理菜单图标失败:", menuId, message)
      if (/Unexpected property: 'icons'/i.test(message)) {
        if (state.iconUpdateSupported) {
          state.iconUpdateSupported = false
          await deps.markIconUnsupported()
        }
        deps.logEvent?.("icon-disable", { reason: message, source: "throw" })
        break
      }
    }
  }

  state.inProgress = false
}

export default { createImageDataFromUrl, resolveMenuIconTargets, applyMenuIcons }
