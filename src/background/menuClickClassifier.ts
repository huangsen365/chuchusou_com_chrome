/**
 * 菜单点击意图分类 (TypeScript port)
 *
 * 抽自 background/menuHandlers.js 行 149-186 的 menuId 前缀分类逻辑。
 *
 * 单一职责：把 chrome.contextMenus.onClicked 的 menuItemId 映射成
 * 一个 ClickIntent 结构体，让上层 handler 可以基于 intent 做 switch
 * 而不用到处写 `info.menuItemId.startsWith('ccs-top100-')` 这种屎山。
 *
 * 纯函数，零 chrome.* 依赖，可在 popup / sidepanel / SW 全部复用。
 */

export type ClickIntentCategory =
  | "top100-engine"
  | "top100-open-all"
  | "fastqa-engine"
  | "fastqa-open-all"
  | "optimize"
  | "cover-pin"
  | "show-popover"
  | "unknown"

export interface ClickIntent {
  /** 原始 menuItemId */
  menuId: string
  /** 分类 */
  category: ClickIntentCategory
  /** 是否需要选区文本才能工作（top100/fastqa/optimize 全部 true） */
  requiresKeyword: boolean
  /** 是否可被 AITaskHandler 接管（SSoT 快速通道） */
  isAITask: boolean
  /** 用 `id.replace('ccs-{prefix}-', '')` 拿到的尾部段（如 engineId / category） */
  suffix: string
}

const COVER_PIN_MENU_ID_DEFAULT = "ccs-cover-pinned"

export interface ClassifyOptions {
  /** 自定义 cover-pin menu id（默认 'ccs-cover-pinned'） */
  coverPinId?: string
}

/**
 * 把 menuItemId 分类成 ClickIntent。
 *
 * 等价 menuHandlers.js 行 149-186 + 起来的多个 if/else：
 *   isTopQuestionsOpenAll / isTopQuestionsMenu / isFastAnswersMenu / ...
 */
export function classifyMenuClick(
  menuId: string | undefined | null,
  opts: ClassifyOptions = {}
): ClickIntent {
  const id = typeof menuId === "string" ? menuId : ""
  const coverPinId = opts.coverPinId || COVER_PIN_MENU_ID_DEFAULT

  if (!id) {
    return { menuId: "", category: "unknown", requiresKeyword: false, isAITask: false, suffix: "" }
  }

  if (id === "ccs-show-popover") {
    return { menuId: id, category: "show-popover", requiresKeyword: false, isAITask: false, suffix: "" }
  }

  if (id === coverPinId) {
    return { menuId: id, category: "cover-pin", requiresKeyword: true, isAITask: true, suffix: "" }
  }

  if (id === "ccs-top100-open-all") {
    return { menuId: id, category: "top100-open-all", requiresKeyword: true, isAITask: true, suffix: "" }
  }

  if (id.startsWith("ccs-top100-")) {
    return {
      menuId: id,
      category: "top100-engine",
      requiresKeyword: true,
      isAITask: true,
      suffix: id.slice("ccs-top100-".length)
    }
  }

  if (id === "ccs-fastqa-open-all") {
    return { menuId: id, category: "fastqa-open-all", requiresKeyword: true, isAITask: true, suffix: "" }
  }

  if (id.startsWith("ccs-fastqa-")) {
    return {
      menuId: id,
      category: "fastqa-engine",
      requiresKeyword: true,
      isAITask: true,
      suffix: id.slice("ccs-fastqa-".length)
    }
  }

  if (id.startsWith("ccs-optimize-")) {
    return {
      menuId: id,
      category: "optimize",
      requiresKeyword: true,
      isAITask: true,
      suffix: id.slice("ccs-optimize-".length)
    }
  }

  return { menuId: id, category: "unknown", requiresKeyword: false, isAITask: false, suffix: "" }
}

/**
 * 快速判断点击是否完全不需要关键字（show-popover 等）。
 * 用于 menuHandlers 的 early-return 短路。
 */
export function clickRequiresKeyword(menuId: string | undefined | null): boolean {
  return classifyMenuClick(menuId).requiresKeyword
}

export default { classifyMenuClick, clickRequiresKeyword }
