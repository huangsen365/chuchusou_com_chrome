export type MenuContext = "all" | "selection" | "page" | "editable"

export type MenuItemType =
  | "search"
  | "ai-chat"
  | "ai-search"
  | "fastqa"
  | "fastqa-quick"
  | "top100"
  | "optimize"
  | "cover"
  | "tool"
  | "submenu"
  | string

export interface UnifiedMenuRoot {
  id: string
  title: string
  icon?: string
  contexts?: MenuContext[]
  dynamicTitle?: boolean
  titleTemplate?: string
  syncGroup?: string
  autoSync?: boolean
}

export interface UnifiedMenuItem {
  id: string
  type: MenuItemType
  title: string
  icon?: string
  engineId?: string
  titleKey?: string
  purpose?: string
  action?: string
  dynamicTitle?: boolean
  contexts?: MenuContext[]
  urlPattern?: string
  enabled?: boolean
  children?: UnifiedMenuItem[]
}

export interface UnifiedMenuGroup {
  id: string
  name: string
  position?: "top" | "middle" | "bottom" | string
  separator?: "before" | "after" | "none" | string
  items: UnifiedMenuItem[]
}

export interface UnifiedMenuConfig {
  version: string
  description?: string
  constants?: Record<string, unknown>
  syncRules?: Record<string, unknown>
  root: UnifiedMenuRoot
  groups: UnifiedMenuGroup[]
}

export interface EngineDefinition {
  id: string
  label: string
  icon?: string
  urlPattern: string
  searchUrlPattern?: string
  description?: string
}

export interface EnginesConfig {
  version: string
  description?: string
  engines: Record<string, EngineDefinition>
  presets?: Record<string, { description?: string; engines: string[] }>
}

export interface PromptEngineDefinition {
  id: string
  label: string
  urlPattern: string
}

export interface PromptCategoryDefinition {
  id: string
  label: string
  purpose: string
  engines: PromptEngineDefinition[]
}

export interface PromptConfig {
  /** 模板正文所在的 Markdown（与 JSON 同目录）；运行时由 shared/promptTemplate.js 展开成 templateLines */
  templateFile?: string
  templateLines?: string[]
  engines?: PromptEngineDefinition[]
  categories?: PromptCategoryDefinition[]
}
