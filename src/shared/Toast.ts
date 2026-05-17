/**
 * 触触搜 - Toast 共享原语 (SSoT)
 *
 * 项目里 3 处 Toast 实现各有独特视觉风格（ToastUI / CCSContentToast / ToastHelper），
 * 真正可共用的是**类型→颜色 + 位置→CSS** 两张映射表 + showToastPrimitive 工厂。
 *
 * 各 wrapper（src/content/ToastUI.ts, src/content-modules/toast.ts,
 * src/popup/modules/ToastHelper.ts）从这里 import 共享类型 + 颜色，
 * 自己负责具体动画细节（保持原有视觉风格）。
 */

export type ToastType = "info" | "success" | "error" | "warning"

export type ToastPosition =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left"
  | "bottom-center"
  | "top-center"

/**
 * Toast 类型 → 背景色 / 文字色 (内联样式版本，ToastUI/CCSContentToast 用)
 */
export const TOAST_INLINE_COLORS: Record<ToastType, { bg: string; color: string }> = {
  info: { bg: "rgba(0, 0, 0, 0.85)", color: "#fff" },
  success: { bg: "rgba(39, 174, 96, 0.95)", color: "#fff" },
  error: { bg: "rgba(231, 76, 60, 0.95)", color: "#fff" },
  warning: { bg: "rgba(241, 196, 15, 0.95)", color: "#333" }
}

/**
 * 老 CCSContentToast 使用的鲜艳色板（更亮一些，用于 content script 上）
 */
export const TOAST_BRIGHT_COLORS: Record<ToastType, string> = {
  info: "rgba(30, 144, 255, 0.9)",
  success: "rgba(34, 139, 34, 0.9)",
  error: "rgba(220, 20, 60, 0.9)",
  warning: "rgba(255, 140, 0, 0.9)"
}

/**
 * 位置 → CSS 片段
 */
export const TOAST_POSITION_CSS: Record<ToastPosition, string> = {
  "bottom-right": "bottom: 20px; right: 20px;",
  "bottom-left": "bottom: 20px; left: 20px;",
  "top-right": "top: 20px; right: 20px;",
  "top-left": "top: 20px; left: 20px;",
  "bottom-center": "bottom: 20px; left: 50%; transform: translateX(-50%);",
  "top-center": "top: 20px; left: 50%; transform: translateX(-50%);"
}

/**
 * 共享 z-index（足够大避免被任何 site CSS 盖住）
 */
export const TOAST_Z_INDEX = 2147483647

/**
 * 共享字体栈
 */
export const TOAST_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

/**
 * 解析 position 字符串，未匹配回退到 bottom-right。
 * (兼容 CCSContentToast 的 "bottom" / "right" 关键字检测旧逻辑)
 */
export function resolvePositionCss(position: string): string {
  if (position in TOAST_POSITION_CSS) {
    return TOAST_POSITION_CSS[position as ToastPosition]
  }
  // 老 API 兜底：检测包含 "bottom" / "top" / "right" / "left" 关键字
  const bottom = position.includes("bottom")
  const right = position.includes("right")
  return `${bottom ? "bottom: 20px;" : "top: 20px;"} ${right ? "right: 20px;" : "left: 20px;"}`
}
