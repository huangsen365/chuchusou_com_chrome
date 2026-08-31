/**
 * Background SW 配置加载器 (TypeScript port)
 *
 * 与 background/config.js 1:1 行为对等，但**去重**：legacy 有 4 个几乎一样的
 * loadXxxConfig() 函数 + 4 个 buildXxxPrompt() —— 都收敛到一个 generic helper。
 *
 * legacy 通过 globalThis.* 共享缓存 + 模板字符串；TS 版本支持两种用法：
 *   1. createConfigLoader(deps)：纯 TS 实例化，所有缓存挂在实例上，不污染 globalThis
 *   2. installLegacyGlobals(loader)：把 loader 的 API 挂到 globalThis（兼容 legacy 调用方）
 *
 * 引擎标题 / 菜单 SSoT 依然走 config/engines.json / config/unifiedMenuConfig.json。
 */

import { applyPromptOutputLanguage } from "../shared/promptLanguage"

export interface PromptConfigShape {
  template?: string
  templateLines?: string[]
  [key: string]: unknown
}

export interface EnginesConfigShape {
  engines?: Record<string, { icon?: string; label?: string; urlPattern?: string; searchUrlPattern?: string }>
  [key: string]: unknown
}

export interface UnifiedMenuConfigShape {
  groups?: Array<{
    items?: Array<{
      id?: string
      enabled?: boolean
      children?: Array<{ id?: string; enabled?: boolean }>
    }>
  }>
  [key: string]: unknown
}

export interface ConfigLoaderDeps {
  /** chrome.runtime.getURL 注入；不传则用 globalThis.chrome */
  getURL?: (path: string) => string
  /** fetch 注入；不传则用 globalThis.fetch */
  fetch?: typeof fetch
}

interface PromptConfigEntry {
  config: PromptConfigShape | null
  template: string
}

export class ConfigLoader {
  /** prompts/optimizedPrompts.json + 派生 template */
  optimized: PromptConfigEntry = { config: null, template: "" }
  cover: PromptConfigEntry = { config: null, template: "" }
  topQuestions: PromptConfigEntry = { config: null, template: "" }
  fastAnswers: PromptConfigEntry = { config: null, template: "" }

  unifiedMenuConfig: UnifiedMenuConfigShape | null = null
  enginesConfig: EnginesConfigShape | null = null
  /** menuId → enabled bool 派生表，从 unifiedMenuConfig 摊平出来 */
  menuToggleConfig: Record<string, boolean> = {}

  private _getURL: (path: string) => string
  private _fetch: typeof fetch

  constructor(deps: ConfigLoaderDeps = {}) {
    const ch = (globalThis as unknown as { chrome?: { runtime?: { getURL: (p: string) => string } } }).chrome
    this._getURL = deps.getURL || ch?.runtime?.getURL || ((p) => p)
    this._fetch = deps.fetch || globalThis.fetch
  }

  /** 通用 prompt 配置加载器（取代 legacy 4 个几乎一样的 loadXxxConfig） */
  private async _loadPrompt(label: string, jsonPath: string, target: PromptConfigEntry): Promise<PromptConfigShape | null> {
    if (target.config) return target.config
    try {
      const url = this._getURL(jsonPath)
      const response = await this._fetch(url)
      if (!response.ok) throw new Error(`Failed to load ${label}: ${response.status}`)
      const config = (await response.json()) as PromptConfigShape
      target.config = config
      target.template = Array.isArray(config.templateLines)
        ? config.templateLines.join("\n")
        : (config.template || "")
      return target.config
    } catch (error) {
      console.error(`[触触搜][BG] Failed to load ${label}:`, error)
      target.config = null
      target.template = ""
      return null
    }
  }

  loadOptimizedPromptConfig(): Promise<PromptConfigShape | null> {
    return this._loadPrompt("optimized prompt config", "prompts/optimizedPrompts.json", this.optimized)
  }
  loadCoverPromptConfig(): Promise<PromptConfigShape | null> {
    return this._loadPrompt("cover prompt config", "prompts/coverPrompts.json", this.cover)
  }
  loadTopQuestionsConfig(): Promise<PromptConfigShape | null> {
    return this._loadPrompt("top questions config", "prompts/topQuestionsPrompts.json", this.topQuestions)
  }
  loadFastAnswersConfig(): Promise<PromptConfigShape | null> {
    return this._loadPrompt("fast answers config", "prompts/fastAnswersPrompts.json", this.fastAnswers)
  }

  /** 通用 prompt 模板替换（取代 legacy 4 个 buildXxxPrompt） */
  private static _fillTemplate(template: string, vars: Record<string, string>): string {
    let result = template
    for (const [k, v] of Object.entries(vars)) {
      result = result.split(`\${${k}}`).join(v)
    }
    return result
  }

  buildOptimizedPrompt(purpose: string, inputText: string): string | null {
    if (!this.optimized.template) return null
    return ConfigLoader._fillTemplate(this.optimized.template, { purpose: purpose || "", input: inputText || "" })
  }
  buildCoverPrompt(purpose: string, inputText: string): string | null {
    if (!this.cover.template) return null
    return ConfigLoader._fillTemplate(this.cover.template, { purpose: purpose || "", input: inputText || "" })
  }
  buildTopQuestionsPrompt(inputText: string): string | null {
    if (!this.topQuestions.template) return null
    return ConfigLoader._fillTemplate(this.topQuestions.template, { input: inputText || "" })
  }
  buildFastAnswersPrompt(inputText: string, outputLanguage?: string | null): string | null {
    if (!this.fastAnswers.template) return null
    const prompt = ConfigLoader._fillTemplate(this.fastAnswers.template, { input: inputText || "" })
    return applyPromptOutputLanguage(prompt, outputLanguage)
  }

  async loadUnifiedMenuConfig(): Promise<UnifiedMenuConfigShape | null> {
    if (this.unifiedMenuConfig) return this.unifiedMenuConfig
    try {
      const url = this._getURL("config/unifiedMenuConfig.json")
      const response = await this._fetch(url)
      if (!response.ok) throw new Error(`Failed to load unified menu config: ${response.status}`)
      this.unifiedMenuConfig = (await response.json()) as UnifiedMenuConfigShape
      return this.unifiedMenuConfig
    } catch (error) {
      console.warn("[触触搜][BG] Failed to load unified menu config:", error)
      this.unifiedMenuConfig = null
      return null
    }
  }

  async loadMenuToggleConfig(): Promise<Record<string, boolean>> {
    if (Object.keys(this.menuToggleConfig).length > 0) return this.menuToggleConfig
    const config = await this.loadUnifiedMenuConfig()
    if (!config) {
      this.menuToggleConfig = {}
      return this.menuToggleConfig
    }
    this.menuToggleConfig = {}
    if (Array.isArray(config.groups)) {
      for (const group of config.groups) {
        if (!Array.isArray(group.items)) continue
        for (const item of group.items) {
          if (item.id && typeof item.enabled === "boolean") {
            this.menuToggleConfig[item.id] = item.enabled
          }
          if (Array.isArray(item.children)) {
            for (const child of item.children) {
              if (child.id && typeof child.enabled === "boolean") {
                this.menuToggleConfig[child.id] = child.enabled
              }
            }
          }
        }
      }
    }
    return this.menuToggleConfig
  }

  isMenuEnabled(menuId: string): boolean {
    const flag = this.menuToggleConfig[menuId]
    if (typeof flag === "boolean") return flag
    return true
  }

  async loadEnginesConfig(): Promise<EnginesConfigShape | null> {
    if (this.enginesConfig) return this.enginesConfig
    try {
      const url = this._getURL("config/engines.json")
      const response = await this._fetch(url)
      if (!response.ok) throw new Error(`Failed to load engines config: ${response.status}`)
      this.enginesConfig = (await response.json()) as EnginesConfigShape
      return this.enginesConfig
    } catch (error) {
      console.warn("[触触搜][BG] Failed to load engines config:", error)
      this.enginesConfig = null
      return null
    }
  }

  getEngine(engineId: string) {
    return this.enginesConfig?.engines?.[engineId] || null
  }

  /**
   * 引擎菜单标题 SSoT —— 从 engines.json 生成 "${icon} ${label}"。
   * 所有 AI 任务子菜单 / popup / sidepanel 都用这个。
   */
  getEngineTitle(engineId: string, fallbackLabel?: string): string {
    const engine = this.getEngine(engineId)
    if (engine) {
      const icon = engine.icon || ""
      const label = engine.label || fallbackLabel || engineId
      return icon ? `${icon} ${label}` : label
    }
    return fallbackLabel || engineId
  }

  getEngineUrlPattern(engineId: string, type: "prompt" | "search" = "prompt"): string | null {
    const engine = this.getEngine(engineId)
    if (!engine) return null
    return type === "search" ? (engine.searchUrlPattern || null) : (engine.urlPattern || null)
  }

  /** 菜单图标配置 - 存根（与 legacy 一致：菜单图标配置文件不存在） */
  loadMenuIconConfig(): Promise<{ items: Record<string, unknown> }> {
    return Promise.resolve({ items: {} })
  }

  /** 兼容 legacy globalThis API：可选挂载，让现有 SW 代码无缝调用 */
  installLegacyGlobals(): void {
    const g = globalThis as unknown as Record<string, unknown>
    g.loadOptimizedPromptConfig = () => this.loadOptimizedPromptConfig()
    g.loadCoverPromptConfig = () => this.loadCoverPromptConfig()
    g.loadTopQuestionsConfig = () => this.loadTopQuestionsConfig()
    g.loadFastAnswersConfig = () => this.loadFastAnswersConfig()
    g.buildOptimizedPrompt = (p: string, i: string) => this.buildOptimizedPrompt(p, i)
    g.buildCoverPrompt = (p: string, i: string) => this.buildCoverPrompt(p, i)
    g.buildTopQuestionsPrompt = (i: string) => this.buildTopQuestionsPrompt(i)
    g.buildFastAnswersPrompt = (i: string) => this.buildFastAnswersPrompt(i)
    g.loadUnifiedMenuConfig = () => this.loadUnifiedMenuConfig()
    g.loadMenuToggleConfig = () => this.loadMenuToggleConfig()
    g.isMenuEnabled = (id: string) => this.isMenuEnabled(id)
    g.loadEnginesConfig = () => this.loadEnginesConfig()
    g.getEngine = (id: string) => this.getEngine(id)
    g.getEngineTitle = (id: string, fb?: string) => this.getEngineTitle(id, fb)
    g.getEngineUrlPattern = (id: string, t?: "prompt" | "search") => this.getEngineUrlPattern(id, t)
    g.loadMenuIconConfig = () => this.loadMenuIconConfig()
    // 模板暴露给 legacy promptBuilders 读取
    Object.defineProperty(g, "optimizedPromptTemplate", { get: () => this.optimized.template, configurable: true })
    Object.defineProperty(g, "coverPromptTemplate", { get: () => this.cover.template, configurable: true })
    Object.defineProperty(g, "topQuestionsTemplate", { get: () => this.topQuestions.template, configurable: true })
    Object.defineProperty(g, "fastAnswersTemplate", { get: () => this.fastAnswers.template, configurable: true })
    Object.defineProperty(g, "menuToggleConfig", { get: () => this.menuToggleConfig, configurable: true })
  }
}

export function createConfigLoader(deps: ConfigLoaderDeps = {}): ConfigLoader {
  return new ConfigLoader(deps)
}

export default ConfigLoader
