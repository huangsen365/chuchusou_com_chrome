/**
 * Cover Pin 相关 storage key + 默认值 (共享 SSoT)
 *
 * 以前在 PopupController.ts 和 sidepanel/PinnedAction.ts 各定义一份，是技术债。
 * 抽到这里：两边 import，唯一真值。
 */

export const PIN_STORAGE_KEY = "ccs_sidepanel_pinned_action"
export const CUSTOM_PURPOSE_KEY = "ccs_cover_custom_purpose"
export const CUSTOM_LINE_KEY = "ccs_cover_custom_selected_line"
export const CUSTOM_PURPOSE_MAX = 5000
export const CUSTOM_LINE_PREVIEW_MAX = 15

export const RATIO_KEY = "ccs_cover_aspect_ratio"
export const RATIO_CUSTOM_LIST_KEY = "ccs_cover_custom_ratios"
export const RATIO_CUSTOM_MAX = 5
export const DEFAULT_RATIO = "5:2"
export const RATIO_RE = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/

export const DEFAULT_PIN = { taskId: "cover", categoryId: "xiaohongshu" } as const

export interface PinSnapshot {
  taskId: string
  categoryId: string
}

export const RATIO_PRESETS = [
  { value: "5:2",    label: "5:2 · 横幅封面（默认）" },
  { value: "6:2",    label: "6:2 · X (Twitter / 推特) 个人主页 Banner（1500×500）" },
  { value: "2.35:1", label: "2.35:1 · 微信公众号头图 / 电影宽屏" },
  { value: "2:1",    label: "2:1 · 横幅卡片（Twitter / 知乎）" },
  { value: "16:9",   label: "16:9 · 通用横屏（YouTube / B 站 / 视频号）" },
  { value: "3:2",    label: "3:2 · 头条号 / 摄影标准" },
  { value: "4:3",    label: "4:3 · 传统媒体 / PPT" },
  { value: "1:1",    label: "1:1 · 方形（Instagram / 微博 / 朋友圈）" },
  { value: "4:5",    label: "4:5 · 竖版图文（Instagram 推荐）" },
  { value: "3:4",    label: "3:4 · 竖版封面（小红书原生 / Pinterest）" },
  { value: "9:16",   label: "9:16 · 手机竖屏（抖音 / TikTok / Reels / 视频号）" }
] as const

export const RATIO_CUSTOM_TRIGGER = "__custom__"

export function parseCustomLines(text: string): string[] {
  if (typeof text !== "string") return []
  return text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0)
}

export function truncateLine(s: string, max: number = CUSTOM_LINE_PREVIEW_MAX): string {
  if (typeof s !== "string") return ""
  return s.length > max ? s.slice(0, max) + "…" : s
}
