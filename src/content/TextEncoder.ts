/**
 * 触触搜 - 文本编码器 (TypeScript port)
 *
 * 与 content/TextEncoder.js 1:1 行为对等。**零 chrome.* 依赖**，纯函数。
 * Class 名 `CCSTextEncoder` 避免与浏览器 TextEncoder 全局碰撞。
 */

export type EncodeCommand =
  | "base64"
  | "base64-decode"
  | "md5"
  | "url-encode"
  | "url-decode"
  | "upper"
  | "lower"

export class CCSTextEncoder {
  static encodeBase64(text: string | null | undefined): string | null {
    if (!text) return ""
    try {
      return btoa(unescape(encodeURIComponent(text)))
    } catch (err) {
      console.warn("[触触搜][Encoder] Base64 编码失败:", err)
      return null
    }
  }

  static decodeBase64(text: string | null | undefined): string | null {
    if (!text) return ""
    try {
      return decodeURIComponent(escape(atob(text)))
    } catch (err) {
      console.warn("[触触搜][Encoder] Base64 解码失败:", err)
      return null
    }
  }

  static encodeURL(text: string | null | undefined): string {
    if (!text) return ""
    return encodeURIComponent(text)
  }

  static decodeURL(text: string | null | undefined): string | null {
    if (!text) return ""
    try {
      return decodeURIComponent(text)
    } catch (err) {
      console.warn("[触触搜][Encoder] URL 解码失败:", err)
      return null
    }
  }

  static pseudoMD5(text: string | null | undefined): string {
    if (!text) return "00000000000000000000000000000000"
    let hash = 0
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i)
      hash = ((hash << 5) - hash) + charCode
      hash |= 0
    }
    const normalized = Math.abs(hash).toString(16)
    return normalized.padStart(32, "0").slice(0, 32)
  }

  static toUpperCase(text: string | null | undefined): string {
    if (!text) return ""
    return text.toUpperCase()
  }

  static toLowerCase(text: string | null | undefined): string {
    if (!text) return ""
    return text.toLowerCase()
  }

  static runCommand(command: EncodeCommand | string, text: string | null | undefined): string | null {
    switch (command) {
      case "base64":         return CCSTextEncoder.encodeBase64(text)
      case "base64-decode":  return CCSTextEncoder.decodeBase64(text)
      case "md5":            return CCSTextEncoder.pseudoMD5(text)
      case "url-encode":     return CCSTextEncoder.encodeURL(text)
      case "url-decode":     return CCSTextEncoder.decodeURL(text)
      case "upper":          return CCSTextEncoder.toUpperCase(text)
      case "lower":          return CCSTextEncoder.toLowerCase(text)
      default:               return null
    }
  }
}

export default CCSTextEncoder
