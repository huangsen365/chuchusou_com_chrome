/**
 * 触触搜 - Popup 菜单结构构建器 (TypeScript port)
 *
 * 与 shared/menuStructureBuilder.js 1:1 行为对等。Legacy UMD 文件仍是生产 SSoT，
 * 该 TS 版本供 Plasmo / React / Vite 入口直接 import 使用，并由
 * scripts/verify-menu-structure-builder-dual.mjs 用真实 config 跟 legacy 做 deep-equal 校验。
 *
 * 同步约束：MENU_DEFS / FAST_QA_QUICK / OPTIMIZE_TITLES / COVER_TITLES 与
 *   - shared/menuStructureBuilder.js
 *   - background/utils/Constants.js
 * 三处必须保持一致。修改任意一处需同步另外两处，并跑 npm test。
 */

import type {
  EnginesConfig,
  PromptCategoryDefinition,
  PromptConfig,
  PromptEngineDefinition,
  UnifiedMenuConfig
} from "./types"

// ============ 菜单文本/图标 ============

export interface MenuDefinitionEntry {
  text: string
  icon: string
}

export const MENU_DEFS: Record<string, MenuDefinitionEntry> = {
  "ccs-main": { text: "触触搜", icon: "🔍" },
  "ccs-baidu": { text: "百度搜索", icon: "🐼" },
  "ccs-google": { text: "Google 搜索", icon: "🔎" },
  "ccs-x": { text: "X（推特）搜索", icon: "𝕏" },
  "ccs-yiyan": { text: "文心一言", icon: "🧠" },
  "ccs-chatgpt": { text: "ChatGPT", icon: "🤖" },
  "ccs-claude": { text: "Claude", icon: "🧠" },
  "ccs-grok": { text: "Grok", icon: "🦊" },
  "ccs-google-ai-chat": { text: "Google AI 模式", icon: "✨" },
  "ccs-zhihu": { text: "知乎搜索", icon: "💡" },
  "ccs-weixin": { text: "微信搜一搜", icon: "💬" },
  "ccs-taobao": { text: "淘宝搜索", icon: "🛒" },
  "ccs-jd": { text: "京东搜索", icon: "🛍️" },
  "ccs-sov2ex": { text: "V2EX (sov2ex)", icon: "💻" },
  "ccs-baidu-translate": { text: "百度翻译", icon: "✍️" },
  "ccs-google-translate": { text: "Google 翻译", icon: "🔁" },
  "ccs-chuchusou": { text: "更多搜索引擎...", icon: "🌐" },
  "ccs-top100-root": { text: "触触搜百问", icon: "💯" },
  "ccs-top100-open-all": { text: "打开以下全部", icon: "🚀" },
  "ccs-fastqa-root": { text: "速答壹拾佰", icon: "⚡" },
  "ccs-fastqa-open-all": { text: "打开以下全部", icon: "🚀" },
  "ccs-optimize-root": { text: "优化提示词", icon: "🧠" },
  "ccs-optimize-open-all": { text: "打开以下全部", icon: "🚀" },
  "ccs-cover-root": { text: "封面生成器", icon: "🎨" },
  "ccs-cover-open-all": { text: "打开以下全部预设风格", icon: "🚀" },
  "ccs-cover-anime-cute-chatgpt-images": { text: "二次元可爱", icon: "🌸" },
  "ccs-cover-xiaohongshu-chatgpt-images": { text: "小红书封面", icon: "🔴" },
  "ccs-cover-coconut-chatgpt-images": { text: "椰树牌风格", icon: "🥥" },
  "ccs-cover-minimal-chatgpt-images": { text: "极简的留白", icon: "⬜" },
  "ccs-copy": { text: "复制文本", icon: "📋" },
  "ccs-base64": { text: "Base64 编码", icon: "🔤" },
  "ccs-md5": { text: "MD5 哈希", icon: "🔐" },
  "ccs-url-encode": { text: "URL 编码", icon: "🔗" },
  "ccs-upper": { text: "转换为大写", icon: "🔠" },
  "ccs-lower": { text: "转换为小写", icon: "🔡" },
  "ccs-show-popover": { text: "打开触触搜面板 (Alt+S)", icon: "🪟" }
}

export interface FastQaQuickItem {
  id: string
  engineId: string
  menuTitle: string
  menuIcon: string
}

export const FAST_QA_QUICK: FastQaQuickItem[] = [
  { id: "ccs-fastqa-chatgpt-quick", engineId: "chatgpt", menuTitle: "触触搜 · 速答壹拾佰 - ChatGPT", menuIcon: "🤖" },
  { id: "ccs-fastqa-claude-quick", engineId: "claude", menuTitle: "触触搜 · 速答壹拾佰 - Claude", menuIcon: "🧠" },
  { id: "ccs-fastqa-grok-quick", engineId: "grok", menuTitle: "触触搜 · 速答壹拾佰 - Grok", menuIcon: "🦊" },
  { id: "ccs-fastqa-yiyan-quick", engineId: "yiyan", menuTitle: "触触搜 · 速答壹拾佰 - 文心一言", menuIcon: "🧠" },
  { id: "ccs-fastqa-google-ai-quick", engineId: "google-ai", menuTitle: "触触搜 · 速答壹拾佰 - Google AI 模式", menuIcon: "✨" }
]

// 与 legacy 文件相同的"启动时把 FAST_QA_QUICK 写回 MENU_DEFS"行为
FAST_QA_QUICK.forEach((it) => {
  MENU_DEFS[it.id] = { text: it.menuTitle, icon: it.menuIcon || "" }
})

export const OPTIMIZE_TITLES: Record<string, string> = {
  "deep-research": "📚 深度研究",
  "general-conversation": "💬 普通对话",
  "code-writing": "💻 代码编写",
  "content-creation": "📝 内容创作",
  "data-analysis": "📊 数据分析",
  "problem-solving": "🧩 问题解答",
  "brainstorm": "💡 头脑风暴",
  "description-polish": "✨ 优化描述"
}

export const COVER_TITLES: Record<string, string> = {
  "anime-cute": "🌸 二次元可爱",
  "xiaohongshu": "🔴 小红书封面",
  "coconut": "🥥 椰树牌风格",
  "minimal": "⬜ 极简的留白",
  "custom": "🖌️ 自定义风格"
}

// ============ Popup 菜单常驻条目 ============

interface SearchLikeItem {
  id: string
  type: string
  urlPattern: string
}

interface ToolLikeItem {
  id: string
  type: string
  action: string
}

const SEARCH_ITEMS: SearchLikeItem[] = [
  { id: "ccs-baidu", type: "search", urlPattern: "https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${KEYWORD}" },
  { id: "ccs-google", type: "search", urlPattern: "https://www.google.com/search?q=${KEYWORD}" },
  { id: "ccs-x", type: "search", urlPattern: "https://x.com/search?q=${KEYWORD}" }
]

const AI_ITEMS: SearchLikeItem[] = [
  { id: "ccs-chatgpt", type: "ai-chat", urlPattern: "https://chatgpt.com/?q=${KEYWORD}" },
  { id: "ccs-claude", type: "ai-chat", urlPattern: "https://claude.ai/new?q=${KEYWORD}" },
  { id: "ccs-grok", type: "ai-chat", urlPattern: "https://grok.com/?q=${KEYWORD}" },
  { id: "ccs-yiyan", type: "ai-search", urlPattern: "https://chat.baidu.com/" },
  { id: "ccs-google-ai-chat", type: "ai-chat", urlPattern: "https://www.google.com/search?udm=50&ie=UTF-8&oe=UTF-8&q=${KEYWORD}" }
]

const GENERAL_ITEMS: SearchLikeItem[] = [
  { id: "ccs-zhihu", type: "search", urlPattern: "https://www.zhihu.com/search?q=${KEYWORD}" },
  { id: "ccs-weixin", type: "search", urlPattern: "https://weixin.sogou.com/weixin?query=${KEYWORD}" },
  { id: "ccs-taobao", type: "ecommerce", urlPattern: "https://s.taobao.com/search?q=${KEYWORD}" },
  { id: "ccs-jd", type: "ecommerce", urlPattern: "https://search.jd.com/Search?keyword=${KEYWORD}" },
  { id: "ccs-sov2ex", type: "search", urlPattern: "https://www.sov2ex.com/?q=${KEYWORD}" },
  { id: "ccs-google-translate", type: "translate", urlPattern: "https://translate.google.com/?sl=auto&tl=zh-CN&text=${KEYWORD}" },
  { id: "ccs-chuchusou", type: "portal", urlPattern: "https://chuchusou.com/#/?keyword=${KEYWORD}" }
]

const TOOL_ITEMS: ToolLikeItem[] = [
  { id: "ccs-copy", type: "tool", action: "copy" },
  { id: "ccs-base64", type: "tool", action: "base64-encode" },
  { id: "ccs-md5", type: "tool", action: "md5-hash" },
  { id: "ccs-url-encode", type: "tool", action: "url-encode" }
]

const TRANSFORM_ITEMS: ToolLikeItem[] = [
  { id: "ccs-upper", type: "transform", action: "to-uppercase" },
  { id: "ccs-lower", type: "transform", action: "to-lowercase" }
]

// ============ 辅助函数 ============

export type ToggleMap = Record<string, boolean>

export function extractToggleMap(unifiedConfig: UnifiedMenuConfig | null | undefined): ToggleMap {
  const map: ToggleMap = {}
  if (!unifiedConfig || !Array.isArray(unifiedConfig.groups)) return map
  for (const group of unifiedConfig.groups) {
    if (!Array.isArray(group.items)) continue
    for (const item of group.items) {
      if (item && item.id && typeof item.enabled === "boolean") {
        map[item.id] = item.enabled
      }
      if (item && Array.isArray(item.children)) {
        for (const child of item.children) {
          if (child && child.id && typeof child.enabled === "boolean") {
            map[child.id] = child.enabled
          }
        }
      }
    }
  }
  return map
}

function makeIsEnabled(toggleMap: ToggleMap | null | undefined): (id: string) => boolean {
  return (id: string) => {
    if (!toggleMap) return true
    const v = toggleMap[id]
    return typeof v === "boolean" ? v : true
  }
}

function getMenuText(id: string): string {
  return MENU_DEFS[id]?.text || id
}

function getMenuIcon(id: string, fallback?: string): string {
  return MENU_DEFS[id]?.icon || fallback || ""
}

function getEngineTitle(
  enginesConfig: EnginesConfig | null | undefined,
  engineId: string,
  fallbackLabel?: string
): string {
  if (!enginesConfig || !enginesConfig.engines) return fallbackLabel || engineId
  const e = enginesConfig.engines[engineId]
  if (!e) return fallbackLabel || engineId
  const icon = e.icon || ""
  const label = e.label || fallbackLabel || engineId
  return icon ? `${icon} ${label}` : label
}

// ============ 主构建函数 ============

export interface BuildOptions {
  unifiedConfig?: UnifiedMenuConfig | null
  toggleConfig?: ToggleMap | null
  enginesConfig?: EnginesConfig | null
  top100Config?: PromptConfig | null
  fastqaConfig?: PromptConfig | null
  optimizeConfig?: PromptConfig | null
  coverConfig?: PromptConfig | null
}

export interface MenuStructureItem {
  id: string
  title: string
  icon: string
  type: string
  engineId?: string
  urlPattern?: string
  action?: string
  categoryId?: string
  purpose?: string
  openAll?: boolean
  children?: MenuStructureItem[]
}

export interface MenuStructureGroup {
  id: string
  separator: string
  items: MenuStructureItem[]
}

export interface MenuStructure {
  groups: MenuStructureGroup[]
}

export function build(opts: BuildOptions = {}): MenuStructure {
  const unifiedConfig = opts.unifiedConfig ?? null
  const toggleMap = opts.toggleConfig ?? extractToggleMap(unifiedConfig)
  const enginesConfig = opts.enginesConfig ?? null
  const top100Config = opts.top100Config ?? null
  const fastqaConfig = opts.fastqaConfig ?? null
  const optimizeConfig = opts.optimizeConfig ?? null
  const coverConfig = opts.coverConfig ?? null

  const isEnabled = makeIsEnabled(toggleMap)
  const structure: MenuStructure = { groups: [] }

  // 1. 快速问答（fastQaQuick）
  const quickItems = FAST_QA_QUICK.filter((it) => isEnabled(it.id))
  if (quickItems.length > 0) {
    structure.groups.push({
      id: "fastQaQuick",
      separator: "after",
      items: quickItems.map((it) => ({
        id: it.id,
        title: getMenuText(it.id),
        icon: getMenuIcon(it.id, it.menuIcon),
        type: "fastqa-quick",
        engineId: it.engineId
      }))
    })
  }

  // 2. 搜索（search）
  const searchItems = SEARCH_ITEMS.filter((it) => isEnabled(it.id))
  if (searchItems.length > 0) {
    structure.groups.push({
      id: "search",
      separator: "after",
      items: searchItems.map((it) => ({
        id: it.id,
        title: getMenuText(it.id),
        icon: getMenuIcon(it.id),
        type: it.type,
        urlPattern: it.urlPattern
      }))
    })
  }

  // 3. AI 对话（ai）
  const aiItems = AI_ITEMS.filter((it) => isEnabled(it.id))
  if (aiItems.length > 0) {
    structure.groups.push({
      id: "ai",
      separator: "after",
      items: aiItems.map((it) => ({
        id: it.id,
        title: getMenuText(it.id),
        icon: getMenuIcon(it.id),
        type: it.type,
        urlPattern: it.urlPattern
      }))
    })
  }

  // 4. 通用组（general）
  const generalItems = GENERAL_ITEMS.filter((it) => isEnabled(it.id))
  if (generalItems.length > 0) {
    structure.groups.push({
      id: "general",
      separator: "none",
      items: generalItems.map((it) => ({
        id: it.id,
        title: getMenuText(it.id),
        icon: getMenuIcon(it.id),
        type: it.type,
        urlPattern: it.urlPattern
      }))
    })
  }

  // 5. 高级功能组（advanced）
  const advancedItems: MenuStructureItem[] = []

  // 5.1 触触搜百问
  if (isEnabled("ccs-top100-root") && top100Config) {
    const children: MenuStructureItem[] = []
    if (isEnabled("ccs-top100-open-all")) {
      children.push({
        id: "ccs-top100-open-all",
        title: getMenuText("ccs-top100-open-all"),
        icon: getMenuIcon("ccs-top100-open-all", "🚀"),
        type: "action"
      })
    }
    for (const engine of (top100Config.engines || []) as PromptEngineDefinition[]) {
      const menuId = `ccs-top100-${engine.id}`
      if (!isEnabled(menuId)) continue
      children.push({
        id: menuId,
        title: getEngineTitle(enginesConfig, engine.id, engine.label),
        icon: (engine as { icon?: string }).icon || "",
        type: "top100",
        engineId: engine.id,
        urlPattern: engine.urlPattern
      })
    }
    if (children.length > 0) {
      advancedItems.push({
        id: "ccs-top100-root",
        title: getMenuText("ccs-top100-root"),
        icon: getMenuIcon("ccs-top100-root", "💯"),
        type: "submenu",
        children
      })
    }
  }

  // 5.2 速答壹拾佰
  if (isEnabled("ccs-fastqa-root") && fastqaConfig) {
    const children: MenuStructureItem[] = []
    if (isEnabled("ccs-fastqa-open-all")) {
      children.push({
        id: "ccs-fastqa-open-all",
        title: getMenuText("ccs-fastqa-open-all"),
        icon: getMenuIcon("ccs-fastqa-open-all", "🚀"),
        type: "action"
      })
    }
    for (const engine of (fastqaConfig.engines || []) as PromptEngineDefinition[]) {
      const menuId = `ccs-fastqa-${engine.id}`
      if (!isEnabled(menuId)) continue
      children.push({
        id: menuId,
        title: getEngineTitle(enginesConfig, engine.id, engine.label),
        icon: (engine as { icon?: string }).icon || "",
        type: "fastqa",
        engineId: engine.id,
        urlPattern: engine.urlPattern
      })
    }
    if (children.length > 0) {
      advancedItems.push({
        id: "ccs-fastqa-root",
        title: getMenuText("ccs-fastqa-root"),
        icon: getMenuIcon("ccs-fastqa-root", "⚡"),
        type: "submenu",
        children
      })
    }
  }

  // 5.3 优化提示词
  if (isEnabled("ccs-optimize-root") && optimizeConfig && Array.isArray(optimizeConfig.categories)) {
    const optimizeChildren: MenuStructureItem[] = []
    for (const category of optimizeConfig.categories as PromptCategoryDefinition[]) {
      const categoryId = `ccs-optimize-${category.id}`
      if (!isEnabled(categoryId)) continue
      const categoryEngines: MenuStructureItem[] = []
      const catOpenAllId = `ccs-optimize-${category.id}-open-all`
      if (isEnabled(catOpenAllId)) {
        categoryEngines.push({
          id: catOpenAllId,
          title: "🚀 打开以下全部",
          icon: "",
          type: "optimize",
          categoryId: category.id,
          openAll: true,
          purpose: category.purpose || category.label
        })
      }
      for (const engine of category.engines || []) {
        const menuId = `ccs-optimize-${category.id}-${engine.id}`
        if (!isEnabled(menuId)) continue
        categoryEngines.push({
          id: menuId,
          title: getEngineTitle(enginesConfig, engine.id, engine.label),
          icon: (engine as { icon?: string }).icon || "",
          type: "optimize",
          categoryId: category.id,
          engineId: engine.id,
          purpose: category.purpose || category.label,
          urlPattern: engine.urlPattern
        })
      }
      if (categoryEngines.length > 0) {
        optimizeChildren.push({
          id: categoryId,
          title: OPTIMIZE_TITLES[category.id] || category.label,
          icon: (category as { icon?: string }).icon || "",
          type: "submenu",
          children: categoryEngines
        })
      }
    }
    if (optimizeChildren.length > 0) {
      advancedItems.push({
        id: "ccs-optimize-root",
        title: getMenuText("ccs-optimize-root"),
        icon: getMenuIcon("ccs-optimize-root", "🧠"),
        type: "submenu",
        children: optimizeChildren
      })
    }
  }

  // 5.4 封面生成器（扁平：风格直接做叶子）
  if (isEnabled("ccs-cover-root") && coverConfig && Array.isArray(coverConfig.categories)) {
    const coverChildren: MenuStructureItem[] = []
    const coverPresets: MenuStructureItem[] = []
    for (const category of coverConfig.categories as PromptCategoryDefinition[]) {
      if (category.id === "custom") continue
      const engine = (category.engines || [])[0]
      if (!engine) continue
      const leafId = `ccs-cover-${category.id}-${engine.id}`
      if (!isEnabled(leafId)) continue
      coverPresets.push({
        id: leafId,
        title: COVER_TITLES[category.id] || category.label,
        icon: "",
        type: "cover",
        categoryId: category.id,
        engineId: engine.id,
        purpose: category.purpose || category.label,
        urlPattern: engine.urlPattern
      })
    }
    if (coverPresets.length >= 2 && isEnabled("ccs-cover-open-all")) {
      coverChildren.push({
        id: "ccs-cover-open-all",
        title: "🚀 打开以下全部预设风格",
        icon: "",
        type: "cover",
        openAll: true
      })
    }
    coverChildren.push(...coverPresets)
    if (coverChildren.length > 0) {
      advancedItems.push({
        id: "ccs-cover-root",
        title: getMenuText("ccs-cover-root"),
        icon: getMenuIcon("ccs-cover-root", "🎨"),
        type: "submenu",
        children: coverChildren
      })
    }
  }

  if (advancedItems.length > 0) {
    structure.groups.push({
      id: "advanced",
      separator: "before",
      items: advancedItems
    })
  }

  // 6. 工具组（tool）
  const toolItems = TOOL_ITEMS.filter((it) => isEnabled(it.id))
  if (toolItems.length > 0) {
    structure.groups.push({
      id: "tool",
      separator: "before",
      items: toolItems.map((it) => ({
        id: it.id,
        title: getMenuText(it.id),
        icon: getMenuIcon(it.id),
        type: it.type,
        action: it.action
      }))
    })
  }

  // 7. 文本转换组（transform）
  const transformItems = TRANSFORM_ITEMS.filter((it) => isEnabled(it.id))
  if (transformItems.length > 0) {
    structure.groups.push({
      id: "transform",
      separator: "before",
      items: transformItems.map((it) => ({
        id: it.id,
        title: getMenuText(it.id),
        icon: getMenuIcon(it.id),
        type: it.type,
        action: it.action
      }))
    })
  }

  // 8. 面板控制（panel）
  if (isEnabled("ccs-show-popover")) {
    structure.groups.push({
      id: "panel",
      separator: "before",
      items: [
        {
          id: "ccs-show-popover",
          title: getMenuText("ccs-show-popover"),
          icon: getMenuIcon("ccs-show-popover", "🪟"),
          type: "action",
          action: "show-popover"
        }
      ]
    })
  }

  return structure
}

// 与 legacy UMD root.CCSMenuStructureBuilder = { ... } 等价的默认导出
export const CCSMenuStructureBuilder = {
  build,
  extractToggleMap,
  MENU_DEFS,
  FAST_QA_QUICK,
  OPTIMIZE_TITLES,
  COVER_TITLES
}

export default CCSMenuStructureBuilder
