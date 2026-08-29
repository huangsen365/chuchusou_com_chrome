/**
 * 站点正文 -> 速答 · ChatGPT 的共享运行时。
 *
 * 网站适配器只负责定位内容、准备全文和放置按钮；动态扫描、去重、状态恢复、
 * Toast 与后台 fastqa 消息全部由这里统一处理。
 */

import { Toast } from "./toast"

export type SiteFastQaState = "idle" | "busy" | "success" | "error" | "unavailable"
export type SiteFastQaKind = "post" | "answer" | "article"

export interface SiteFastQaContent {
  platform: string
  kind: SiteFastQaKind
  sourceKey: string
  keyword: string
  body: string
  title?: string
  sourceUrl?: string
  bodyIncomplete?: boolean
}

export interface SiteFastQaCopy {
  label: string
  title: string
}

export interface SiteFastQaAdapter {
  id: string
  styleId: string
  styles: string
  isSupported(hostname?: string): boolean
  findRoots(currentDocument: Document): HTMLElement[]
  extract(root: HTMLElement): SiteFastQaContent | null
  prepare?(root: HTMLElement): Promise<void>
  findActionContainer(root: HTMLElement): HTMLElement | null
  findActionContainers?(root: HTMLElement): HTMLElement[]
  insertHost(root: HTMLElement, container: HTMLElement, host: HTMLElement): void
  createHost?(): HTMLElement
  decorateHost?(host: HTMLElement): void
  decorateButton?(button: HTMLButtonElement): void
  ownsElement?(element: Element, root: HTMLElement): boolean
  copy(state: SiteFastQaState, content: SiteFastQaContent | null): SiteFastQaCopy
  visibleText?(state: SiteFastQaState, content: SiteFastQaContent | null): string
  successToast(content: SiteFastQaContent): string
  unavailableToast?: string
}

interface FastQaResponse {
  success?: boolean
  error?: string
}

interface ActiveAction {
  content: SiteFastQaContent
  state: SiteFastQaState
}

function createFastQaIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("aria-hidden", "true")
  svg.setAttribute("data-ccs-site-fastqa-icon", "true")
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
  path.setAttribute("d", "M13.2 2.5 5.4 13h5.7l-.5 8.5L18.7 10H13l.2-7.5Z")
  svg.appendChild(path)
  return svg
}

function ensureStyles(adapter: SiteFastQaAdapter): void {
  if (document.getElementById(adapter.styleId)) return
  const style = document.createElement("style")
  style.id = adapter.styleId
  style.textContent = `
    [data-ccs-site-fastqa="${adapter.id}"] [data-ccs-site-fastqa-spinner] {
      display: none;
      width: 15px;
      height: 15px;
      box-sizing: border-box;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: ccs-site-fastqa-spin 720ms linear infinite;
    }
    [data-ccs-site-fastqa="${adapter.id}"][data-ccs-state="busy"]
      [data-ccs-site-fastqa-icon] { display: none; }
    [data-ccs-site-fastqa="${adapter.id}"][data-ccs-state="busy"]
      [data-ccs-site-fastqa-spinner] { display: block; }
    @keyframes ccs-site-fastqa-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      [data-ccs-site-fastqa="${adapter.id}"] [data-ccs-site-fastqa-spinner] {
        animation: none;
      }
    }
    ${adapter.styles}
  `
  ;(document.head ?? document.documentElement).appendChild(style)
}

export function sendSiteFastQaToChatGpt(keyword: string): Promise<FastQaResponse> {
  return new Promise((resolve) => {
    try {
      if (!chrome.runtime?.id) {
        resolve({ success: false, error: "runtime-unavailable" })
        return
      }
      chrome.runtime.sendMessage({
        action: "executeMenuAction",
        menuItemId: "ccs-fastqa-chatgpt-quick",
        menuType: "fastqa-quick",
        engineId: "chatgpt",
        keyword
      }, (response: FastQaResponse | undefined) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message || "runtime-error" })
          return
        }
        resolve(response ?? { success: false, error: "empty-response" })
      })
    } catch (error) {
      resolve({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
}

function mutationElement(target: Node): Element | null {
  return target instanceof Element ? target : target.parentElement
}

export function startSiteFastQaIntegration(adapter: SiteFastQaAdapter): () => void {
  try {
    if (window.top !== window || !adapter.isSupported()) return () => {}
  } catch (_) {
    return () => {}
  }

  const buttonSelector = `[data-ccs-site-fastqa="${adapter.id}"]`
  const hostSelector = `[data-ccs-site-fastqa-host="${adapter.id}"]`
  const ownsElement = adapter.ownsElement ?? ((element, root) => root.contains(element))
  const activeActions = new Map<string, ActiveAction>()
  const resetTimers = new Map<string, number>()
  let stopped = false
  let observer: MutationObserver | null = null
  let scheduled = false

  const actionContainers = (root: HTMLElement): HTMLElement[] => {
    const candidates = adapter.findActionContainers?.(root) ?? [adapter.findActionContainer(root)]
    return Array.from(new Set(candidates.filter((container): container is HTMLElement => container != null)))
  }

  const matchingButtons = (sourceKey: string): HTMLButtonElement[] =>
    Array.from(document.querySelectorAll<HTMLButtonElement>(buttonSelector))
      .filter((button) => button.dataset.ccsSourceKey === sourceKey)

  const setActionState = (
    button: HTMLButtonElement,
    state: SiteFastQaState,
    content: SiteFastQaContent | null
  ): void => {
    const next = adapter.copy(state, content)
    button.dataset.ccsState = state
    if (content) {
      button.dataset.ccsSourceKey = content.sourceKey
      button.dataset.ccsContentKind = content.kind
    }
    button.disabled = state === "busy" || state === "success" || state === "unavailable"
    button.setAttribute("aria-disabled", String(button.disabled))
    button.setAttribute("aria-label", next.label)
    button.title = next.title
    const host = button.closest<HTMLElement>(hostSelector)
    if (host) host.title = next.title
    const visibleText = button.querySelector<HTMLElement>("[data-ccs-site-fastqa-text]")
    if (visibleText) visibleText.textContent = adapter.visibleText?.(state, content) ?? ""
  }

  const applyActiveState = (sourceKey: string, active: ActiveAction): void => {
    matchingButtons(sourceKey).forEach((button) => setActionState(button, active.state, active.content))
  }

  const scheduleReset = (sourceKey: string): void => {
    const existing = resetTimers.get(sourceKey)
    if (existing != null) window.clearTimeout(existing)
    const timer = window.setTimeout(() => {
      resetTimers.delete(sourceKey)
      activeActions.delete(sourceKey)
      schedule()
    }, 3000)
    resetTimers.set(sourceKey, timer)
  }

  const runFastQa = async (root: HTMLElement, button: HTMLButtonElement): Promise<void> => {
    const preview = adapter.extract(root)
    if (!preview) {
      setActionState(button, "unavailable", null)
      Toast.warning(adapter.unavailableToast ?? "未提取到可用于速答的正文")
      return
    }

    const sourceKey = preview.sourceKey
    const existingTimer = resetTimers.get(sourceKey)
    if (existingTimer != null) {
      window.clearTimeout(existingTimer)
      resetTimers.delete(sourceKey)
    }
    const busy: ActiveAction = { content: preview, state: "busy" }
    activeActions.set(sourceKey, busy)
    applyActiveState(sourceKey, busy)
    setActionState(button, "busy", preview)

    try {
      await adapter.prepare?.(root)
      const content = adapter.extract(root)
      if (!content?.keyword) throw new Error("未提取到可用于速答的正文")
      const response = await sendSiteFastQaToChatGpt(content.keyword)
      if (!response.success) throw new Error(response.error || "速答启动失败")
      const success: ActiveAction = { content, state: "success" }
      activeActions.set(sourceKey, success)
      applyActiveState(sourceKey, success)
      if (button.isConnected) setActionState(button, "success", content)
      Toast.success(adapter.successToast(content))
    } catch (error) {
      const latest = adapter.extract(root) ?? preview
      const failed: ActiveAction = { content: latest, state: "error" }
      activeActions.set(sourceKey, failed)
      applyActiveState(sourceKey, failed)
      if (button.isConnected) setActionState(button, "error", latest)
      Toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      scheduleReset(sourceKey)
    }
  }

  const inject = (root: HTMLElement): void => {
    const containers = actionContainers(root)
    if (!containers.length) return
    const content = adapter.extract(root)
    containers.forEach((container) => {
      const existing = Array.from(container.querySelectorAll<HTMLButtonElement>(buttonSelector))
        .find((button) => ownsElement(button, root))
      if (existing) {
        const active = content ? activeActions.get(content.sourceKey) : undefined
        setActionState(existing, active?.state ?? (content ? "idle" : "unavailable"), active?.content ?? content)
        return
      }
      if (!content) return

      const host = adapter.createHost?.() ?? document.createElement("div")
      host.setAttribute("data-ccs-site-fastqa-host", adapter.id)
      adapter.decorateHost?.(host)
      host.addEventListener("click", (event) => event.stopPropagation())
      host.addEventListener("pointerdown", (event) => event.stopPropagation())

      const button = document.createElement("button")
      button.type = "button"
      button.setAttribute("data-ccs-site-fastqa", adapter.id)
      adapter.decorateButton?.(button)
      const spinner = document.createElement("span")
      spinner.setAttribute("data-ccs-site-fastqa-spinner", "true")
      spinner.setAttribute("aria-hidden", "true")
      button.append(createFastQaIcon(), spinner)
      if (adapter.visibleText) {
        const visibleText = document.createElement("span")
        visibleText.setAttribute("data-ccs-site-fastqa-text", "true")
        button.appendChild(visibleText)
      }
      button.addEventListener("click", (event) => {
        event.preventDefault()
        event.stopPropagation()
        void runFastQa(root, button)
      })
      host.appendChild(button)
      adapter.insertHost(root, container, host)
      const active = activeActions.get(content.sourceKey)
      setActionState(button, active?.state ?? "idle", active?.content ?? content)
    })
  }

  const scan = (): void => {
    scheduled = false
    if (stopped) return
    adapter.findRoots(document).forEach(inject)
  }
  const schedule = (): void => {
    if (stopped || scheduled) return
    scheduled = true
    requestAnimationFrame(scan)
  }
  const boot = (): void => {
    if (stopped || observer || !document.documentElement) return
    ensureStyles(adapter)
    observer = new MutationObserver((mutations) => {
      const onlyOwnChanges = mutations.length > 0 && mutations.every((mutation) =>
        Boolean(mutationElement(mutation.target)?.closest(hostSelector))
      )
      if (!onlyOwnChanges) schedule()
    })
    observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true })
    schedule()
  }

  boot()
  if (!observer) document.addEventListener("DOMContentLoaded", boot, { once: true })

  return () => {
    stopped = true
    document.removeEventListener("DOMContentLoaded", boot)
    observer?.disconnect()
    resetTimers.forEach((timer) => window.clearTimeout(timer))
    resetTimers.clear()
    activeActions.clear()
    document.querySelectorAll(hostSelector).forEach((host) => host.remove())
  }
}

export const SiteFastQaRuntime = {
  sendToChatGpt: sendSiteFastQaToChatGpt,
  start: startSiteFastQaIntegration
}

export default SiteFastQaRuntime
