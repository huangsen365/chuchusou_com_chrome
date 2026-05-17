/**
 * Prompt 模板渲染 + 菜单 map 构建 (TypeScript port)
 *
 * 与 background/config.js 的纯函数部分 1:1 行为对等：
 *   - buildOptimizedPrompt / buildCoverPrompt / buildTopQuestionsPrompt / buildFastAnswersPrompt
 *   - isMenuEnabled
 *   - populateOptimizedMenuMap / populateCoverMenuMap
 *
 * 故意不迁的内容：4 个 loadXxxConfig + loadUnifiedMenuConfig + loadEnginesConfig + loadMenuIconConfig
 * （这些走 chrome.runtime.getURL + fetch，TS 入口直接 import src/assets-json/**，无需 loader）
 *
 * legacy 用 globalThis.xxxTemplate / globalThis.menuToggleConfig；
 * TS 版本通过参数注入解耦。
 */

// ==================== Prompt 模板渲染 ====================

export function buildOptimizedPrompt(
  purpose: string | null | undefined,
  inputText: string | null | undefined,
  template: string | null | undefined
): string | null {
  if (!template) return null
  const safePurpose = purpose || ""
  const safeInput = inputText || ""
  return template.split("${purpose}").join(safePurpose).split("${input}").join(safeInput)
}

export function buildCoverPrompt(
  purpose: string | null | undefined,
  inputText: string | null | undefined,
  template: string | null | undefined
): string | null {
  if (!template) return null
  const safePurpose = purpose || ""
  const safeInput = inputText || ""
  return template.split("${purpose}").join(safePurpose).split("${input}").join(safeInput)
}

export function buildTopQuestionsPrompt(
  inputText: string | null | undefined,
  template: string | null | undefined
): string | null {
  if (!template) return null
  const safeInput = inputText || ""
  return template.split("${input}").join(safeInput)
}

export function buildFastAnswersPrompt(
  inputText: string | null | undefined,
  template: string | null | undefined
): string | null {
  if (!template) return null
  const safeInput = inputText || ""
  return template.split("${input}").join(safeInput)
}

// ==================== 菜单启用查询 ====================

export type MenuToggleConfig = Record<string, boolean>

export function isMenuEnabled(menuId: string, toggleConfig?: MenuToggleConfig | null): boolean {
  if (!toggleConfig) return true
  const flag = toggleConfig[menuId]
  if (typeof flag === "boolean") return flag
  return true
}

// ==================== 菜单 map 构建（用于优化提示词 / 封面生成器） ====================

export interface PromptEngine {
  id: string
  label?: string
  urlPattern?: string
  icon?: string
}

export interface PromptCategory {
  id: string
  label?: string
  purpose?: string
  engines?: PromptEngine[]
}

export interface PromptConfigShape {
  categories?: PromptCategory[]
}

export interface MenuMapEntry {
  purpose: string
  urlPattern: string
}

export function populateOptimizedMenuMap(
  config: PromptConfigShape | null | undefined,
  toggleConfig?: MenuToggleConfig | null
): Map<string, MenuMapEntry> {
  const map = new Map<string, MenuMapEntry>()
  if (!config || !Array.isArray(config.categories)) return map
  config.categories.forEach((category) => {
    const categoryId = category.id
    if (!categoryId) return
    const categoryMenuId = `ccs-optimize-${categoryId}`
    if (!isMenuEnabled(categoryMenuId, toggleConfig)) return
    ;(category.engines || []).forEach((engine) => {
      if (!engine || !engine.id) return
      const menuId = `ccs-optimize-${categoryId}-${engine.id}`
      if (!isMenuEnabled(menuId, toggleConfig)) return
      map.set(menuId, {
        purpose: category.purpose || category.label || "",
        urlPattern: engine.urlPattern || ""
      })
    })
  })
  return map
}

export function populateCoverMenuMap(
  config: PromptConfigShape | null | undefined,
  toggleConfig?: MenuToggleConfig | null
): Map<string, MenuMapEntry> {
  const map = new Map<string, MenuMapEntry>()
  if (!config || !Array.isArray(config.categories)) return map
  config.categories.forEach((category) => {
    const categoryId = category.id
    if (!categoryId) return
    ;(category.engines || []).forEach((engine) => {
      if (!engine || !engine.id) return
      const menuId = `ccs-cover-${categoryId}-${engine.id}`
      if (!isMenuEnabled(menuId, toggleConfig)) return
      map.set(menuId, {
        purpose: category.purpose || category.label || "",
        urlPattern: engine.urlPattern || ""
      })
    })
  })
  return map
}

// ==================== Engine 查询（接受 enginesConfig 参数注入） ====================

export interface EngineDefinition {
  id: string
  label?: string
  icon?: string
  urlPattern?: string
  searchUrlPattern?: string
  description?: string
}

export interface EnginesConfig {
  engines: Record<string, EngineDefinition>
}

export function getEngine(
  engineId: string,
  enginesConfig: EnginesConfig | null | undefined
): EngineDefinition | null {
  if (!enginesConfig || !enginesConfig.engines) return null
  return enginesConfig.engines[engineId] || null
}

export function getEngineTitle(
  engineId: string,
  fallbackLabel: string | undefined,
  enginesConfig: EnginesConfig | null | undefined
): string {
  const engine = getEngine(engineId, enginesConfig)
  if (engine) {
    const icon = engine.icon || ""
    const label = engine.label || fallbackLabel || engineId
    return icon ? `${icon} ${label}` : label
  }
  return fallbackLabel || engineId
}

export function getEngineUrlPattern(
  engineId: string,
  type: "prompt" | "search" = "prompt",
  enginesConfig: EnginesConfig | null | undefined
): string | null {
  const engine = getEngine(engineId, enginesConfig)
  if (!engine) return null
  return (type === "search" ? engine.searchUrlPattern : engine.urlPattern) || null
}

export default {
  buildOptimizedPrompt,
  buildCoverPrompt,
  buildTopQuestionsPrompt,
  buildFastAnswersPrompt,
  isMenuEnabled,
  populateOptimizedMenuMap,
  populateCoverMenuMap,
  getEngine,
  getEngineTitle,
  getEngineUrlPattern
}
