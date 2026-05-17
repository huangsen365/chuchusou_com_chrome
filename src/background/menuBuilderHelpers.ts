/**
 * 菜单构建辅助 helpers (TypeScript port)
 *
 * 抽自 background/menuBuilder.js 行 1-181 + 226-228 的可独立复用工具：
 *  - extractErrorMessage(error): 把多形态 error → string
 *  - createMenuItem(options, meta): chrome.contextMenus.create 的 Promise 包装
 *  - removeAllContextMenus(): chrome.contextMenus.removeAll 的 Promise 包装
 *  - isStaleBuild(buildId, currentCounter): build epoch 比较 (idempotent guard)
 *  - MENU_CONTEXTS_DEFAULT: 默认 ['selection', 'page']
 *
 * 不抽 createContextMenus / populateXxxMenus 等 orchestrator —— 那些是有
 * 副作用的大流程，需要等 SW 切到 TS 入口后再 port。
 */

export const MENU_CONTEXTS_DEFAULT: ReadonlyArray<chrome.contextMenus.ContextType> = [
  "selection",
  "page"
] as const

export function extractErrorMessage(error: unknown): string {
  if (!error) return ""
  if (typeof error === "string") return error
  const e = error as { message?: unknown }
  if (typeof e.message === "string") return e.message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export interface CreateMenuItemMeta {
  onSuccess?: (options: chrome.contextMenus.CreateProperties) => void
  onError?: (error: unknown, options: chrome.contextMenus.CreateProperties) => void
  failureLogStage?: string
  logMenuEvent?: (stage: string, payload: Record<string, unknown>) => void
}

export interface CreateMenuItemResult {
  ok: boolean
  error?: unknown
}

export interface ChromeContextMenusCreateLite {
  create: (options: chrome.contextMenus.CreateProperties, cb?: () => void) => void
  removeAll: ((cb?: () => void) => void) & { length: number }
}

export interface ChromeRuntimeLastErrorLite {
  lastError?: { message?: string } | null
}

export interface MenuBuilderDeps {
  contextMenus?: ChromeContextMenusCreateLite
  runtime?: ChromeRuntimeLastErrorLite
}

function getDefaultChrome(): {
  contextMenus?: ChromeContextMenusCreateLite
  runtime?: ChromeRuntimeLastErrorLite
} {
  const ch = (globalThis as unknown as {
    chrome?: {
      contextMenus?: ChromeContextMenusCreateLite
      runtime?: ChromeRuntimeLastErrorLite
    }
  }).chrome
  return ch ?? {}
}

/**
 * 等价 menuBuilder.js createMenuItem(options, meta):
 * 把回调式 chrome.contextMenus.create 包成 Promise<{ok, error?}>。
 * 失败时根据 meta.failureLogStage 落日志（如有提供）。
 */
export function createMenuItem(
  options: chrome.contextMenus.CreateProperties,
  meta: CreateMenuItemMeta = {},
  deps: MenuBuilderDeps = {}
): Promise<CreateMenuItemResult> {
  const contextMenus = deps.contextMenus || getDefaultChrome().contextMenus
  const runtime = deps.runtime || getDefaultChrome().runtime
  return new Promise((resolve) => {
    if (!contextMenus?.create) {
      resolve({ ok: false, error: "no chrome.contextMenus" })
      return
    }
    try {
      contextMenus.create(options, () => {
        const error = runtime?.lastError
        if (error) {
          if (meta.failureLogStage && options?.id && meta.logMenuEvent) {
            meta.logMenuEvent(meta.failureLogStage, {
              id: options.id,
              error: extractErrorMessage(error)
            })
          }
          if (meta.onError) meta.onError(error, options)
          resolve({ ok: false, error })
          return
        }
        if (meta.onSuccess) meta.onSuccess(options)
        resolve({ ok: true })
      })
    } catch (error) {
      if (meta.failureLogStage && options?.id && meta.logMenuEvent) {
        meta.logMenuEvent(meta.failureLogStage, {
          id: options.id,
          error: extractErrorMessage(error)
        })
      }
      if (meta.onError) meta.onError(error, options)
      resolve({ ok: false, error })
    }
  })
}

/**
 * 等价 menuBuilder.js removeAllContextMenus():
 * 自动判断 chrome.contextMenus.removeAll 是 Promise-style 还是 callback-style，
 * 统一返回 Promise<void>。
 */
export async function removeAllContextMenus(deps: MenuBuilderDeps = {}): Promise<void> {
  const cm = deps.contextMenus || getDefaultChrome().contextMenus
  const runtime = deps.runtime || getDefaultChrome().runtime
  if (typeof cm?.removeAll !== "function") return
  // Chrome 一些版本 removeAll 返回 Promise，旧版本只接受 callback；用 .length 区分
  if (cm.removeAll.length === 0) {
    await (cm.removeAll() as unknown as Promise<void>)
    return
  }
  await new Promise<void>((resolve, reject) => {
    cm.removeAll(() => {
      const error = runtime?.lastError
      if (error) {
        reject(new Error(extractErrorMessage(error)))
        return
      }
      resolve()
    })
  })
}

/**
 * 等价 menuBuilder.js isStaleBuild(buildId): 检查异步 populate 任务的 buildId
 * 是否还和当前 menuBuildCounter 匹配（用于避免过时的 rebuild 覆盖更新的菜单）。
 */
export function isStaleBuild(buildId: number, currentCounter: number): boolean {
  return buildId !== currentCounter
}

export default {
  MENU_CONTEXTS_DEFAULT,
  extractErrorMessage,
  createMenuItem,
  removeAllContextMenus,
  isStaleBuild
}
