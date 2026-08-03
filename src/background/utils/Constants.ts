/**
 * 触触搜 - 常量定义 (TypeScript port)
 *
 * 只包含**纯数据常量**，与 background/utils/Constants.js 1:1 镜像。
 *
 * 故意不迁的内容（仍由 legacy Constants.js 持有，因依赖 chrome.* / SW lifecycle / 全局可变状态）：
 * - BG_DEBUG / BG_DBG (动态 flag + chrome.storage.local.get)
 * - tryOpenMenuUrl (依赖 MenuSystem / applyTextLimit / enforceFinalUrlCap 全局)
 * - 运行时可变状态 (selectedTextByTab / fallbackKeywordByTab / latestTitleByTab /
 *   currentMenuState / menuIcon* / menuBuild*)
 * - prompt config 缓存槽 (optimizedPromptConfig / topQuestionsConfig / fastAnswersConfig / coverPromptConfig)
 *
 * 同步约束：以下表与 background/utils/Constants.js + shared/menuStructureBuilder.js
 * 三处必须保持一致。任意修改需同步另两处 + 跑 npm test。
 */

// ==================== 调试和日志 ====================

export const LOG_PREFIX = "[触触搜][MENU]"

export const STORAGE_KEYS = {
  DEBUG: "ccs_debug",
  MENU_ICON_SUPPORT: "ccs_menu_icon_supported",
  BLACKLIST: "ccs_blacklist",
  SHORTCUT_KEY: "ccs_shortcut_key"
} as const

// ==================== 快速结果页面 ====================

export const QUICK_RESULT_HOSTS: readonly string[] = ["chatgpt.com", "claude.ai"]

// ==================== 菜单定义 ====================

export interface MenuDefinitionEntry {
  text: string
  icon: string
}

export const MENU_DEFINITIONS: Record<string, MenuDefinitionEntry> = {
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
  titleKey: string
  menuTitle: string
  menuIcon: string
}

export const FAST_QA_QUICK_ITEMS: FastQaQuickItem[] = [
  {
    id: "ccs-fastqa-chatgpt-quick",
    engineId: "chatgpt",
    titleKey: "chatgpt",
    menuTitle: "触触搜 · 速答壹拾佰 - ChatGPT",
    menuIcon: "🤖"
  },
  {
    id: "ccs-fastqa-claude-quick",
    engineId: "claude",
    titleKey: "claude",
    menuTitle: "触触搜 · 速答壹拾佰 - Claude",
    menuIcon: "🧠"
  },
  {
    id: "ccs-fastqa-grok-quick",
    engineId: "grok",
    titleKey: "grok",
    menuTitle: "触触搜 · 速答壹拾佰 - Grok",
    menuIcon: "🦊"
  },
  {
    id: "ccs-fastqa-yiyan-quick",
    engineId: "yiyan",
    titleKey: "yiyan",
    menuTitle: "触触搜 · 速答壹拾佰 - 文心一言",
    menuIcon: "🧠"
  },
  {
    id: "ccs-fastqa-google-ai-quick",
    engineId: "google-ai",
    titleKey: "google-ai",
    menuTitle: "触触搜 · 速答壹拾佰 - Google AI 模式",
    menuIcon: "✨"
  }
]

// 与 legacy 文件相同：启动时把 FAST_QA_QUICK_ITEMS 写回 MENU_DEFINITIONS
FAST_QA_QUICK_ITEMS.forEach((item) => {
  MENU_DEFINITIONS[item.id] = {
    text: item.menuTitle,
    icon: item.menuIcon || ""
  }
})

// ==================== 引擎/分类标题 ====================

export const OPTIMIZE_CATEGORY_TITLES: Record<string, string> = {
  "deep-research": "📚 深度研究",
  "general-conversation": "💬 普通对话",
  "code-writing": "💻 代码编写",
  "content-creation": "📝 内容创作",
  "data-analysis": "📊 数据分析",
  "problem-solving": "🧩 问题解答",
  "brainstorm": "💡 头脑风暴",
  "description-polish": "✨ 优化描述"
}

export const COVER_CATEGORY_TITLES: Record<string, string> = {
  "anime-cute": "🌸 二次元可爱",
  "xiaohongshu": "🔴 小红书封面",
  "coconut": "🥥 椰树牌风格",
  "minimal": "⬜ 极简的留白",
  "custom": "🖌️ 自定义风格"
}

// ==================== 动态菜单项 ====================

export const DYNAMIC_SEARCH_MENU_ITEMS: readonly string[] = []

export const FAST_QA_MENU_ITEMS: readonly string[] = [
  "ccs-fastqa-root",
  "ccs-fastqa-open-all"
]

// ==================== 文本处理配置 ====================

export const MENU_TITLE_MAX_LENGTH = 20
export const KEYWORD_MAX_LENGTH = 50

export const TITLE_CLEANUP_SUFFIXES: readonly string[] = [
  " - 搜索结果",
  " - 知乎",
  " - Zhihu",
  " - ChatGPT",
  " – ChatGPT",
  " — ChatGPT",
  " - Claude",
  " – Claude",
  " — Claude",
  " / X"      // X (Twitter) 推文/主页标题尾巴，如 "某人 在 X 上：「...」 / X"
]

export const SEARCH_ENGINE_SUFFIXES: readonly string[] = [
  " - 百度搜索",
  " - Google 搜索",
  " - 搜狗搜索",
  " - 360搜索",
  " - Bing",
  " - 知乎",
  " - 微博",
  " - GitHub",
  " - Stack Overflow",
  " - CSDN博客",
  " - 简书",
  " - 掘金",
  " - 博客园",
  " | ",
  " - ",
  " – ",
  " — "
]

// ==================== 缓存配置 ====================

export const CACHE_EXPIRY = {
  TITLE: 30000,
  KEYWORD: 30000,
  SELECTION: 10000
} as const

// ==================== 通用主机关键词 ====================

export const GENERIC_HOST_KEYWORDS: Record<string, readonly string[]> = {
  "chatgpt.com": ["chatgpt", "chatgpt.com", "www.chatgpt.com"],
  "claude.ai": ["claude", "claude.ai", "www.claude.ai"]
}
