/**
 * 菜单 ID 常量管理模块 (TypeScript port)
 *
 * 与 background/menuIds.js 1:1 行为对等。所有数据/函数纯函数化，无 chrome.* 依赖。
 *
 * ⚠ 遗留 bug 保留：MENU_ID_GROUPS.SEARCH_ENGINES 第 3 项是 `MENU_IDS.TONGYI`，
 * 但 MENU_IDS 里**从未定义过 TONGYI**，所以这一项实际是 `undefined`。
 * 为了与 legacy dual-run 完全一致，TS 版本保留这个 `undefined`。修复留给真实重构期。
 */

export const MENU_IDS = Object.freeze({
  ROOT: "ccs-main",

  FASTQA_CHATGPT_QUICK: "ccs-fastqa-chatgpt-quick",
  FASTQA_CLAUDE_QUICK: "ccs-fastqa-claude-quick",
  FASTQA_GROK_QUICK: "ccs-fastqa-grok-quick",

  BAIDU: "ccs-baidu",
  GOOGLE: "ccs-google",

  CHATGPT: "ccs-chatgpt",
  CLAUDE: "ccs-claude",
  GROK: "ccs-grok",
  YIYAN: "ccs-yiyan",
  GOOGLE_AI_CHAT: "ccs-google-ai-chat",

  ZHIHU: "ccs-zhihu",
  WEIXIN: "ccs-weixin",
  TAOBAO: "ccs-taobao",
  JD: "ccs-jd",
  SOV2EX: "ccs-sov2ex",
  GOOGLE_TRANSLATE: "ccs-google-translate",
  CHUCHUSOU: "ccs-chuchusou",

  TOP100_ROOT: "ccs-top100-root",
  TOP100_OPEN_ALL: "ccs-top100-open-all",
  FASTQA_ROOT: "ccs-fastqa-root",
  FASTQA_OPEN_ALL: "ccs-fastqa-open-all",
  OPTIMIZE_ROOT: "ccs-optimize-root",

  COPY: "ccs-copy",
  BASE64: "ccs-base64",
  MD5: "ccs-md5",
  URL_ENCODE: "ccs-url-encode",

  UPPER: "ccs-upper",
  LOWER: "ccs-lower",

  SHOW_POPOVER: "ccs-show-popover"
})

export type MenuIdConstantName = keyof typeof MENU_IDS
export type MenuIdValue = (typeof MENU_IDS)[MenuIdConstantName]

// 保留 legacy 的 TONGYI 引用为 undefined（dual-run 校验必需）
const TONGYI_LEGACY_UNDEFINED = (MENU_IDS as unknown as Record<string, string | undefined>).TONGYI

export const MENU_ID_GROUPS = Object.freeze({
  DYNAMIC_TITLE: [
    MENU_IDS.ROOT,
    MENU_IDS.CHATGPT,
    MENU_IDS.CLAUDE,
    MENU_IDS.GROK,
    MENU_IDS.CHUCHUSOU,
    MENU_IDS.FASTQA_CHATGPT_QUICK,
    MENU_IDS.FASTQA_CLAUDE_QUICK,
    MENU_IDS.FASTQA_GROK_QUICK,
    MENU_IDS.FASTQA_ROOT,
    MENU_IDS.FASTQA_OPEN_ALL
  ],

  FAST_QA_QUICK: [
    MENU_IDS.FASTQA_CHATGPT_QUICK,
    MENU_IDS.FASTQA_CLAUDE_QUICK,
    MENU_IDS.FASTQA_GROK_QUICK
  ],

  SEARCH_ENGINES: [
    MENU_IDS.BAIDU,
    MENU_IDS.GOOGLE,
    TONGYI_LEGACY_UNDEFINED, // legacy 这里写了不存在的 MENU_IDS.TONGYI → undefined
    MENU_IDS.YIYAN
  ],

  AI_CHAT: [MENU_IDS.CHATGPT, MENU_IDS.CLAUDE, MENU_IDS.GROK],

  GENERAL_SEARCH: [
    MENU_IDS.ZHIHU,
    MENU_IDS.WEIXIN,
    MENU_IDS.TAOBAO,
    MENU_IDS.JD,
    MENU_IDS.SOV2EX,
    MENU_IDS.GOOGLE_TRANSLATE,
    MENU_IDS.CHUCHUSOU
  ],

  ADVANCED: [MENU_IDS.TOP100_ROOT, MENU_IDS.FASTQA_ROOT, MENU_IDS.OPTIMIZE_ROOT],

  TOOLS: [MENU_IDS.COPY, MENU_IDS.BASE64, MENU_IDS.MD5, MENU_IDS.URL_ENCODE],

  TRANSFORMS: [MENU_IDS.UPPER, MENU_IDS.LOWER]
})

export const MENU_ID_PREFIXES = Object.freeze({
  TOP100: "ccs-top100-",
  FASTQA: "ccs-fastqa-",
  OPTIMIZE: "ccs-optimize-",
  CCS: "ccs-"
})

export function hasMenuIdPrefix(
  menuId: unknown,
  prefix: string
): boolean {
  return typeof menuId === "string" && menuId.startsWith(prefix)
}

export function isTop100Menu(menuId: unknown): boolean {
  return hasMenuIdPrefix(menuId, MENU_ID_PREFIXES.TOP100)
}

export function isFastQAMenu(menuId: unknown): boolean {
  return hasMenuIdPrefix(menuId, MENU_ID_PREFIXES.FASTQA)
}

export function isOptimizeMenu(menuId: unknown): boolean {
  return hasMenuIdPrefix(menuId, MENU_ID_PREFIXES.OPTIMIZE)
}

export function needsDynamicTitle(menuId: unknown): boolean {
  return (MENU_ID_GROUPS.DYNAMIC_TITLE as readonly unknown[]).includes(menuId)
}

export function getAllMenuIds(): string[] {
  return Object.values(MENU_IDS)
}

export function isValidMenuId(menuId: unknown): boolean {
  return typeof menuId === "string" && getAllMenuIds().includes(menuId)
}

export function getMenuIdByConstant(constantName: string): string | null {
  return (MENU_IDS as Record<string, string>)[constantName] || null
}

export function getConstantByMenuId(menuId: string): string | null {
  for (const [key, value] of Object.entries(MENU_IDS)) {
    if (value === menuId) {
      return key
    }
  }
  return null
}
