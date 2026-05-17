/**
 * 菜单标题查询 + 显示文本格式化 (TypeScript port)
 *
 * 抽自 background/base.js 行 277-299 的 3 个纯函数：
 * - getMenuDefinition(menuId): MENU_DEFINITIONS 查找
 * - getMenuText(menuId, fallback): 拿菜单的 text 字段（带 fallback）
 * - getMenuTitle(menuId, fallback): 拼 "${icon} ${text}" 格式化（带 fallback）
 *
 * 这些是 base.js 里被到处调用的纯 lookup 函数。无 chrome.* 依赖。
 * Legacy 通过 `MENU_DEFINITIONS` global 查表，本 TS 版本通过 deps 注入。
 */

export interface MenuDefinition {
  text?: string
  icon?: string
  [k: string]: unknown
}

export type MenuDefinitions = Record<string, MenuDefinition>

export function getMenuDefinition(definitions: MenuDefinitions, menuId: string): MenuDefinition | null {
  return definitions[menuId] || null
}

export function getMenuText(definitions: MenuDefinitions, menuId: string, fallback?: string): string {
  const def = getMenuDefinition(definitions, menuId)
  if (def && typeof def.text === "string" && def.text) return def.text
  if (typeof fallback === "string" && fallback) return fallback
  return menuId
}

export function getMenuTitle(definitions: MenuDefinitions, menuId: string, fallback?: string): string {
  const def = getMenuDefinition(definitions, menuId)
  const text = getMenuText(definitions, menuId, fallback)
  if (def && typeof def.icon === "string" && def.icon.trim()) {
    return `${def.icon.trim()} ${text}`
  }
  return text
}

/** 一组便捷工厂：返回绑定到某个 definitions 字典的偏函数 */
export function createMenuTitleLookup(definitions: MenuDefinitions) {
  return {
    getDefinition: (menuId: string) => getMenuDefinition(definitions, menuId),
    getText: (menuId: string, fallback?: string) => getMenuText(definitions, menuId, fallback),
    getTitle: (menuId: string, fallback?: string) => getMenuTitle(definitions, menuId, fallback)
  }
}

export default { getMenuDefinition, getMenuText, getMenuTitle, createMenuTitleLookup }
