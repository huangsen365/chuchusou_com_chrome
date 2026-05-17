/**
 * URL 构建器类 (TypeScript port)
 *
 * 与 background/URLBuilder.js 1:1 行为对等。
 * 故意不迁的内容：openMultipleUrls(chrome.tabs.create) 留在 legacy。
 *
 * 支持的模板变量：
 * - ${KEYWORD}      标准化搜索关键词
 * - ${PROMPT}       AI 提示词
 * - ${RAW_TEXT}     原始未规范化文本
 * - ${ENCODED_TEXT} URL 编码后的原始文本
 * - ${NORMALIZED}   规范化文本（同 KEYWORD）
 */

export interface URLBuilderOptions {
  autoEncode?: boolean
  debug?: boolean
}

export interface URLBuildParams {
  raw?: string
  normalized?: string
  prompt?: string
  [key: string]: string | undefined
}

export interface URLBuilderConfigItem {
  id: string
  urlPattern?: string
  children?: URLBuilderConfigItem[]
}

export interface URLBuilderConfigGroup {
  items?: URLBuilderConfigItem[]
}

export interface URLBuilderConfig {
  groups: URLBuilderConfigGroup[]
}

export interface URLBuilderStats {
  total: number
  menuIds: string[]
}

type VariableHandler = (value: URLBuildParams) => string

export class URLBuilder {
  templates: Map<string, string>
  options: { autoEncode: boolean; debug: boolean }
  variableHandlers: Record<string, VariableHandler>

  constructor(options: URLBuilderOptions = {}) {
    this.templates = new Map()
    this.options = {
      autoEncode: options.autoEncode !== false,
      debug: options.debug || false
    }
    this.variableHandlers = {
      KEYWORD: (value) => value.normalized || value.raw || "",
      PROMPT: (value) => value.prompt || value.raw || "",
      RAW_TEXT: (value) => value.raw || "",
      ENCODED_TEXT: (value) => encodeURIComponent(value.raw || ""),
      NORMALIZED: (value) => value.normalized || ""
    }
  }

  register(menuId: string, urlPattern: string): void {
    if (!menuId || typeof menuId !== "string") {
      throw new Error("menuId must be a non-empty string")
    }
    if (!urlPattern || typeof urlPattern !== "string") {
      throw new Error("urlPattern must be a non-empty string")
    }
    this.templates.set(menuId, urlPattern)
    this._log("register", { menuId, urlPattern })
  }

  registerBatch(templates: Record<string, string>): void {
    if (!templates || typeof templates !== "object") {
      throw new Error("templates must be an object")
    }
    for (const [menuId, urlPattern] of Object.entries(templates)) {
      this.register(menuId, urlPattern)
    }
  }

  build(menuId: string, params: URLBuildParams = {}): string | null {
    const template = this.templates.get(menuId)
    if (!template) {
      this._log("build:template-not-found", { menuId })
      return null
    }
    const url = this._replaceVariables(template, params)
    this._log("build", { menuId, template, params, url })
    return url
  }

  private _replaceVariables(template: string, params: URLBuildParams): string {
    return template.replace(/\$\{(\w+)\}/g, (_match, varName: string) => {
      const handler = this.variableHandlers[varName]
      if (handler) {
        const value = handler(params)
        return this.options.autoEncode ? encodeURIComponent(value) : value
      } else {
        const value = params[varName.toLowerCase()] || ""
        return this.options.autoEncode ? encodeURIComponent(value) : value
      }
    })
  }

  has(menuId: string): boolean {
    return this.templates.has(menuId)
  }

  getTemplate(menuId: string): string | null {
    return this.templates.get(menuId) || null
  }

  delete(menuId: string): boolean {
    const deleted = this.templates.delete(menuId)
    if (deleted) this._log("delete", { menuId })
    return deleted
  }

  clear(): void {
    this.templates.clear()
    this._log("clear")
  }

  getAllMenuIds(): string[] {
    return Array.from(this.templates.keys())
  }

  getStats(): URLBuilderStats {
    return {
      total: this.templates.size,
      menuIds: this.getAllMenuIds()
    }
  }

  static isValidUrl(url: string): boolean {
    try {
      new URL(url)
      return true
    } catch {
      return false
    }
  }

  static buildSimple(baseUrl: string, paramKey: string, paramValue: string): string {
    const separator = baseUrl.includes("?") ? "&" : "?"
    const encodedKey = encodeURIComponent(paramKey)
    const encodedValue = encodeURIComponent(paramValue)
    return `${baseUrl}${separator}${encodedKey}=${encodedValue}`
  }

  loadFromConfig(config: URLBuilderConfig): number {
    if (!config || !config.groups) {
      throw new Error("Invalid config: missing groups")
    }
    let count = 0
    for (const group of config.groups) {
      if (!group.items) continue
      for (const item of group.items) {
        if (item.urlPattern) {
          this.register(item.id, item.urlPattern)
          count++
        }
        if (item.children) {
          for (const child of item.children) {
            if (child.urlPattern) {
              this.register(child.id, child.urlPattern)
              count++
            }
          }
        }
      }
    }
    this._log("loadFromConfig", { count })
    return count
  }

  private _log(action: string, data?: unknown): void {
    if (!this.options.debug) return
    console.log(`[URLBuilder] ${action}`, data ?? "")
  }
}

export function buildUrlWithParam(baseUrl: string, key: string, value: string): string {
  return URLBuilder.buildSimple(baseUrl, key, value)
}

export default URLBuilder
