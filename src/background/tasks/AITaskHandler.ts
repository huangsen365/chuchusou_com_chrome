/**
 * AI 任务处理器 (TypeScript port)
 *
 * 与 background/tasks/AITaskHandler.js 1:1 行为对等。
 * 所有依赖（AITaskRegistry / TextLimits / chrome.tabs / chrome.storage）参数化注入。
 *
 * 设计：依赖通过 deps 参数注入，便于测试 + 不直接依赖 SW 全局。
 */

import type {
  NormalizedTask,
  TaskDefinitionBase
} from "./AITaskRegistry"

export interface RunAITaskOptions {
  taskId?: string
  keyword?: string
  engineId?: string
  categoryId?: string
  openAll?: boolean
  tabId?: number
  purposeOverride?: string
}

export interface RunAITaskResult {
  success: boolean
  error?: string
  opened?: number
}

export interface RunAITaskByMenuIdResult extends RunAITaskResult {
  matched: boolean
}

export interface AITaskRegistryLike {
  TASK_DEFINITIONS: Record<string, TaskDefinitionBase>
  loadTask: (taskId: string, fetcher?: unknown) => Promise<NormalizedTask | null>
  buildPromptFromTask?: (task: NormalizedTask, keyword: string, options?: { categoryId?: string; purposeOverride?: string; vars?: Record<string, unknown> }) => string | null
  listTaskEnginesFromTask?: (task: NormalizedTask, options?: { categoryId?: string }) => Array<{ id: string; label: string | undefined; urlPattern: string | undefined; menuId: string }>
  getTaskEngineUrlFromTask?: (task: NormalizedTask, engineId: string, options?: { categoryId?: string }) => string | null
  resolveMenuId: (menuId: string) => { taskId: string; root?: boolean; openAll?: boolean; all?: boolean; categoryId?: string; engineId?: string } | null
}

export interface TextLimitsLike {
  applyTextLimit?: (menuId: string, text: string, opts?: { tabId?: number }) => { text: string; truncated: boolean }
  enforceFinalUrlCap?: (url: string) => string
}

export interface AITaskHandlerDeps {
  registry: AITaskRegistryLike
  textLimits?: TextLimitsLike
  /** Open URL in new tab. Default: chrome.tabs.create */
  openTab?: (url: string, active?: boolean) => void
  /** Get a per-task storage var. Default: chrome.storage.local */
  getStorageItem?: (key: string) => Promise<unknown>
}

function defaultOpenTab(url: string, active?: boolean): void {
  const ch = (globalThis as unknown as { chrome?: { tabs?: { create: (opts: { url: string; active?: boolean }) => void } } }).chrome
  try { ch?.tabs?.create({ url, active }) } catch (_) { /* noop */ }
}

function defaultGetStorageItem(key: string): Promise<unknown> {
  return new Promise((resolve) => {
    const ch = (globalThis as unknown as { chrome?: { storage?: { local?: { get: (k: string[], cb: (r: Record<string, unknown>) => void) => void } } } }).chrome
    if (!ch?.storage?.local?.get) { resolve(undefined); return }
    ch.storage.local.get([key], (data) => resolve(data?.[key]))
  })
}

/**
 * 收集任务运行时变量（注入到 prompt 模板）。
 * cover 任务从 storage 读取用户选的比例。
 */
export async function collectTaskVars(
  taskId: string,
  getStorageItem: (key: string) => Promise<unknown> = defaultGetStorageItem
): Promise<Record<string, string>> {
  const vars: Record<string, string> = {}
  if (taskId === "cover") {
    try {
      const r = await getStorageItem("ccs_cover_aspect_ratio")
      vars.ratio = typeof r === "string" && r.trim() ? r.trim() : "5:2"
    } catch (_) {
      vars.ratio = "5:2"
    }
  }
  return vars
}

export async function runAITask(
  options: RunAITaskOptions,
  deps: AITaskHandlerDeps
): Promise<RunAITaskResult> {
  const { taskId, keyword, engineId, categoryId, openAll, tabId, purposeOverride } = options
  const { registry, textLimits, openTab = defaultOpenTab, getStorageItem = defaultGetStorageItem } = deps

  if (!taskId || !registry) return { success: false, error: "registry-unavailable" }
  if (!keyword) return { success: false, error: "no-keyword" }

  const task = await registry.loadTask(taskId)
  if (!task) return { success: false, error: "task-not-found" }

  const openAllAxis = task.openAllAxis || "engine"
  if (task.hasCategories && !categoryId && !(openAll && openAllAxis === "category")) {
    return { success: false, error: "missing-category" }
  }

  let sampleMenuId: string
  if (openAll) {
    if (openAllAxis === "category") {
      sampleMenuId = `${task.menuIdPrefix}-open-all`
    } else {
      sampleMenuId = task.hasCategories
        ? `${task.menuIdPrefix}-${categoryId}-open-all`
        : `${task.menuIdPrefix}-open-all`
    }
  } else {
    sampleMenuId = task.hasCategories
      ? `${task.menuIdPrefix}-${categoryId}-${engineId}`
      : `${task.menuIdPrefix}-${engineId}`
  }

  let effectiveKeyword = keyword
  if (textLimits?.applyTextLimit) {
    const limited = textLimits.applyTextLimit(sampleMenuId, keyword, { tabId })
    effectiveKeyword = limited.text
  }

  const vars = await collectTaskVars(taskId, getStorageItem)

  // ---- openAll along category axis (cover) ----
  if (openAll && openAllAxis === "category") {
    const skipSet = new Set(task.openAllSkipCategoryIds || [])
    const targetCats = (task.categories || []).filter((c) => c?.id && !skipSet.has(c.id))
    if (!targetCats.length) return { success: false, error: "no-categories" }

    let opened = 0
    for (const cat of targetCats) {
      const engine = (cat.engines || [])[0]
      if (!engine?.urlPattern) continue
      const catPrompt = registry.buildPromptFromTask?.(task, effectiveKeyword, {
        categoryId: cat.id, vars
      })
      if (!catPrompt) continue
      const encoded = encodeURIComponent(catPrompt)
      let url = engine.urlPattern.split("${PROMPT}").join(encoded)
      if (textLimits?.enforceFinalUrlCap) url = textLimits.enforceFinalUrlCap(url)
      try {
        openTab(url, opened === 0)
        opened++
      } catch (_) { /* noop */ }
    }
    return { success: true, opened }
  }

  const prompt = registry.buildPromptFromTask?.(task, effectiveKeyword, {
    categoryId, purposeOverride, vars
  })
  if (!prompt) return { success: false, error: "template-invalid" }
  const encodedPrompt = encodeURIComponent(prompt)

  // ---- openAll along engine axis ----
  if (openAll) {
    const engines = registry.listTaskEnginesFromTask?.(task, { categoryId }) || []
    if (!engines.length) return { success: false, error: "no-enabled-engines" }
    let opened = 0
    for (const e of engines) {
      if (!e.urlPattern) continue
      let url = e.urlPattern.split("${PROMPT}").join(encodedPrompt)
      if (textLimits?.enforceFinalUrlCap) url = textLimits.enforceFinalUrlCap(url)
      try {
        openTab(url, opened === 0)
        opened++
      } catch (_) { /* noop */ }
    }
    return { success: true, opened }
  }

  // ---- Single engine ----
  if (!engineId) return { success: false, error: "missing-engine" }
  const urlPattern = registry.getTaskEngineUrlFromTask?.(task, engineId, { categoryId })
  if (!urlPattern) return { success: false, error: "engine-url-not-found" }
  let url = urlPattern.split("${PROMPT}").join(encodedPrompt)
  if (textLimits?.enforceFinalUrlCap) url = textLimits.enforceFinalUrlCap(url)
  openTab(url)
  return { success: true, opened: 1 }
}

export async function runAITaskByMenuId(
  menuItemId: string,
  keyword: string,
  deps: AITaskHandlerDeps,
  options: { tabId?: number } = {}
): Promise<RunAITaskByMenuIdResult> {
  if (!deps.registry) {
    return { success: false, matched: false, error: "registry-unavailable" }
  }
  const parsed = deps.registry.resolveMenuId(menuItemId)
  if (!parsed) return { success: false, matched: false, error: "not-ai-task" }

  if (parsed.root) return { success: false, matched: true, error: "root-no-action" }
  if (parsed.categoryId && !parsed.engineId && !parsed.openAll) {
    return { success: false, matched: true, error: "category-no-action" }
  }

  const res = await runAITask({
    taskId: parsed.taskId,
    keyword,
    engineId: parsed.engineId,
    categoryId: parsed.categoryId,
    openAll: parsed.openAll,
    tabId: options.tabId
  }, deps)

  return { ...res, matched: true }
}

export default { runAITask, runAITaskByMenuId, collectTaskVars }
