/**
 * AI 任务注册表 (TypeScript port)
 *
 * 与 background/tasks/AITaskRegistry.js 等价。差异：
 * - legacy `loadTask` 直接调用 chrome.runtime.getURL + fetch；
 *   TS 版本接受 `fetcher: (file: string) => Promise<unknown>` 注入，
 *   生产传入 chrome.runtime.getURL+fetch 包装，测试传 mock
 * - legacy `listTaskEngines` 依赖 globalThis.isMenuEnabled；TS 版本通过 `isMenuEnabled` 参数注入
 *
 * TASK_DEFINITIONS / _normalize / _normEngine / resolveMenuId / listTaskDefinitions 全部纯函数，
 * 行为与 legacy 1:1 镜像，dual-run verifier 重点验证这几个。
 */

export interface TaskDefinitionBase {
  id: string
  label: string
  icon: string
  menuRootId: string
  menuIdPrefix: string
  promptsFile: string
  templateVariable: string
  hasCategories: boolean
  showOpenAll: boolean
  categoryVariable?: string
  categoryTitlesKey?: string
  openAllAxis?: "engine" | "category"
  openAllSkipCategoryIds?: readonly string[]
}

export const TASK_DEFINITIONS: Record<string, TaskDefinitionBase> = {
  fastqa: {
    id: "fastqa",
    label: "速答壹拾佰",
    icon: "⚡",
    menuRootId: "ccs-fastqa-root",
    menuIdPrefix: "ccs-fastqa",
    promptsFile: "prompts/fastAnswersPrompts.json",
    templateVariable: "input",
    hasCategories: false,
    showOpenAll: true
  },
  top100: {
    id: "top100",
    label: "触触搜百问",
    icon: "💯",
    menuRootId: "ccs-top100-root",
    menuIdPrefix: "ccs-top100",
    promptsFile: "prompts/topQuestionsPrompts.json",
    templateVariable: "input",
    hasCategories: false,
    showOpenAll: true
  },
  optimize: {
    id: "optimize",
    label: "优化提示词",
    icon: "🧠",
    menuRootId: "ccs-optimize-root",
    menuIdPrefix: "ccs-optimize",
    promptsFile: "prompts/optimizedPrompts.json",
    templateVariable: "input",
    hasCategories: true,
    showOpenAll: true,
    categoryVariable: "purpose",
    categoryTitlesKey: "OPTIMIZE_CATEGORY_TITLES"
  },
  cover: {
    id: "cover",
    label: "封面生成器",
    icon: "🎨",
    menuRootId: "ccs-cover-root",
    menuIdPrefix: "ccs-cover",
    promptsFile: "prompts/coverPrompts.json",
    templateVariable: "input",
    hasCategories: true,
    showOpenAll: true,
    openAllAxis: "category",
    openAllSkipCategoryIds: ["custom"],
    categoryVariable: "purpose",
    categoryTitlesKey: "COVER_CATEGORY_TITLES"
  }
}

export interface EngineSpec {
  id: string
  label?: string
  urlPattern?: string
}

export interface CategorySpec {
  id: string
  label?: string
  purpose?: string
  template?: string
  engines: EngineSpec[]
}

export interface NormalizedTask extends TaskDefinitionBase {
  template: string
  engines: EngineSpec[]
  categories: CategorySpec[]
  openAllAxis: "engine" | "category"
  openAllSkipCategoryIds: readonly string[]
}

interface RawPromptEngine {
  id: string
  label?: string
  urlPattern?: string
}

interface RawPromptCategory {
  id: string
  label?: string
  purpose?: string
  template?: string
  templateLines?: string[]
  engines?: RawPromptEngine[]
}

interface RawPromptConfig {
  label?: string
  icon?: string
  showOpenAll?: boolean
  template?: string
  templateLines?: string[]
  engines?: RawPromptEngine[]
  categories?: RawPromptCategory[]
}

function _normEngine(e: RawPromptEngine): EngineSpec {
  return {
    id: e.id,
    label: e.label,
    urlPattern: e.urlPattern
  }
}

export function normalizeTask(def: TaskDefinitionBase, raw: RawPromptConfig): NormalizedTask {
  const template = Array.isArray(raw.templateLines)
    ? raw.templateLines.join("\n")
    : raw.template || ""

  const task: NormalizedTask = {
    ...def,
    label: raw.label || def.label,
    icon: raw.icon || def.icon,
    showOpenAll: typeof raw.showOpenAll === "boolean" ? raw.showOpenAll : def.showOpenAll,
    openAllAxis: def.openAllAxis || "engine",
    openAllSkipCategoryIds: Array.isArray(def.openAllSkipCategoryIds)
      ? def.openAllSkipCategoryIds
      : [],
    template,
    engines: [],
    categories: []
  }

  if (def.hasCategories && Array.isArray(raw.categories)) {
    task.categories = raw.categories.map((cat) => {
      const catTemplate = Array.isArray(cat.templateLines)
        ? cat.templateLines.join("\n")
        : cat.template || template
      return {
        id: cat.id,
        label: cat.label,
        purpose: cat.purpose || cat.label || "",
        template: catTemplate,
        engines: Array.isArray(cat.engines) ? cat.engines.map(_normEngine) : []
      }
    })
  }

  if (Array.isArray(raw.engines)) {
    task.engines = raw.engines.map(_normEngine)
  }

  return task
}

// ============================================================================
// Loader / cache（注入式，无 chrome.* 直依赖）
// ============================================================================

export type AITaskFetcher = (promptsFile: string) => Promise<RawPromptConfig | null>

const _taskCache = new Map<string, NormalizedTask>()

export async function loadTask(
  taskId: string,
  fetcher: AITaskFetcher
): Promise<NormalizedTask | null> {
  if (_taskCache.has(taskId)) return _taskCache.get(taskId)!
  const def = TASK_DEFINITIONS[taskId]
  if (!def) return null

  try {
    const raw = await fetcher(def.promptsFile)
    if (!raw) return null
    const task = normalizeTask(def, raw)
    _taskCache.set(taskId, task)
    return task
  } catch (err) {
    console.warn(`[AITaskRegistry] loadTask(${taskId}) failed:`, (err as Error)?.message)
    return null
  }
}

export function clearTaskCache(): void {
  _taskCache.clear()
}

// ============================================================================
// Prompt 构建 + 引擎 URL 查询（接受 NormalizedTask，零 chrome.* 依赖）
// ============================================================================

export interface BuildPromptOptions {
  categoryId?: string
  purposeOverride?: string
  vars?: Record<string, string | number | null | undefined>
}

export function buildPromptFromTask(
  task: NormalizedTask,
  keyword: string,
  options: BuildPromptOptions = {}
): string | null {
  let template = task.template
  let purpose = ""

  if (task.hasCategories) {
    const cat = (task.categories || []).find((c) => c.id === options.categoryId)
    if (!cat) return null
    template = cat.template || template
    purpose =
      typeof options.purposeOverride === "string" && options.purposeOverride.trim()
        ? options.purposeOverride
        : cat.purpose || cat.label || ""
  }

  if (!template) return null

  let prompt = template
  prompt = prompt.split("${" + task.templateVariable + "}").join(keyword || "")
  if (task.categoryVariable) {
    prompt = prompt.split("${" + task.categoryVariable + "}").join(purpose)
  }
  if (options.vars && typeof options.vars === "object") {
    for (const [k, v] of Object.entries(options.vars)) {
      if (typeof k !== "string" || !k) continue
      prompt = prompt.split("${" + k + "}").join(v == null ? "" : String(v))
    }
  }
  return prompt
}

export function getTaskEngineUrlFromTask(
  task: NormalizedTask,
  engineId: string,
  options: { categoryId?: string } = {}
): string | null {
  let enginePool: EngineSpec[] = task.engines
  if (task.hasCategories && options.categoryId) {
    const cat = (task.categories || []).find((c) => c.id === options.categoryId)
    if (cat) enginePool = cat.engines
  }
  const engine = (enginePool || []).find((e) => e.id === engineId)
  return engine?.urlPattern || null
}

export interface ListedEngine {
  id: string
  label: string | undefined
  urlPattern: string | undefined
  menuId: string
}

export type IsMenuEnabledFn = (menuId: string) => boolean

export function listTaskEnginesFromTask(
  task: NormalizedTask,
  options: { categoryId?: string; isMenuEnabled?: IsMenuEnabledFn } = {}
): ListedEngine[] {
  let pool: EngineSpec[] = task.engines
  let menuIdBuilder = (eid: string) => `${task.menuIdPrefix}-${eid}`

  if (task.hasCategories && options.categoryId) {
    const cat = (task.categories || []).find((c) => c.id === options.categoryId)
    if (!cat) return []
    pool = cat.engines
    menuIdBuilder = (eid: string) => `${task.menuIdPrefix}-${options.categoryId}-${eid}`
  }

  const out: ListedEngine[] = []
  for (const e of pool || []) {
    const menuId = menuIdBuilder(e.id)
    if (options.isMenuEnabled && !options.isMenuEnabled(menuId)) continue
    out.push({ id: e.id, label: e.label, urlPattern: e.urlPattern, menuId })
  }
  return out
}

// ============================================================================
// Menu ID 反向解析（纯函数）
// ============================================================================

export interface ResolvedMenuId {
  taskId: string
  root?: boolean
  openAll?: boolean
  all?: boolean
  categoryId?: string
  engineId?: string
}

export function resolveMenuId(menuId: string): ResolvedMenuId | null {
  if (!menuId) return null

  for (const [taskId, def] of Object.entries(TASK_DEFINITIONS)) {
    const prefix = def.menuIdPrefix + "-"
    if (!menuId.startsWith(prefix)) continue
    if (menuId === def.menuRootId) return { taskId, root: true }
    const rest = menuId.slice(prefix.length)

    if (rest === "open-all") return { taskId, openAll: true, all: true }
    if (def.hasCategories && rest.endsWith("-open-all")) {
      const catId = rest.slice(0, -"-open-all".length)
      return { taskId, openAll: true, categoryId: catId }
    }

    if (def.hasCategories) {
      const KNOWN_ENGINE_IDS = ["chatgpt-images", "chatgpt", "claude", "grok", "yiyan", "google-ai"]
      for (const eid of KNOWN_ENGINE_IDS) {
        if (rest === eid) {
          return null
        }
        if (rest.endsWith("-" + eid)) {
          const catId = rest.slice(0, rest.length - eid.length - 1)
          return { taskId, categoryId: catId, engineId: eid }
        }
      }
      if (rest && !rest.includes("/")) return { taskId, categoryId: rest }
    } else {
      return { taskId, engineId: rest }
    }
  }
  return null
}

export function listTaskDefinitions(): TaskDefinitionBase[] {
  return Object.values(TASK_DEFINITIONS).map((d) => ({ ...d }))
}

// ============================================================================
// 聚合导出（与 legacy globalThis.AITaskRegistry 对齐）
// ============================================================================

export const AITaskRegistry = {
  TASK_DEFINITIONS,
  loadTask,
  normalizeTask,
  buildPromptFromTask,
  getTaskEngineUrlFromTask,
  listTaskEnginesFromTask,
  resolveMenuId,
  listTaskDefinitions,
  clearTaskCache,
  _clearCache: clearTaskCache
}

export default AITaskRegistry
