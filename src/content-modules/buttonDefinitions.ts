/**
 * Content script - ButtonDefinitions 模块 (TypeScript port)
 *
 * 与 modules/buttonDefinitions.js 1:1 行为对等。**零 chrome.* 依赖**。
 */

export interface ButtonDefinition {
  id: string
  icon?: string
  title: string
  action?: (text: string) => void | Promise<void>
  custom?: boolean
}

export interface CustomButtonConfig {
  id: string
  icon?: string
  title: string
  action?: (text: string) => void | Promise<void>
  url?: string
}

function getShowToast(): (m: string) => void {
  const w = window as unknown as {
    showToast?: (m: string) => void
    CCSModules?: { Toast?: { show: (m: string) => void } }
  }
  return (m: string) => {
    if (w.showToast) w.showToast(m)
    else if (w.CCSModules?.Toast) w.CCSModules.Toast.show(m)
    else console.log("[触触搜] Toast:", m)
  }
}

export class ButtonDefinitionsManager {
  getDefaultButtons(): ButtonDefinition[] {
    const toast = getShowToast()
    return [
      { id: "baidu", icon: "🔍", title: "百度搜索", action: (text) => { window.open(`https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${encodeURIComponent(text)}`, "_blank") } },
      { id: "google", icon: "🔍", title: "Google搜索", action: (text) => { window.open(`https://www.google.com/search?q=${encodeURIComponent(text)}`, "_blank") } },
      { id: "chatgpt", icon: "🌐", title: "ChatGPT", action: (text) => { window.open(`https://chatgpt.com/?q=${encodeURIComponent(text)}`, "_blank") } },
      { id: "chuchusou", icon: "🌐", title: "更多搜索", action: (text) => { window.open(`https://chuchusou.com/?q=${encodeURIComponent(text)}`, "_blank") } },
      { id: "copy", icon: "📝", title: "复制", action: async (text) => {
        try { await navigator.clipboard.writeText(text); toast("已复制到剪贴板") }
        catch (_) { toast("复制失败") }
      }},
      { id: "base64-encode", icon: "🔤", title: "Base64编码", action: (text) => {
        try {
          const encoded = btoa(unescape(encodeURIComponent(text)))
          navigator.clipboard.writeText(encoded)
          toast(`已编码并复制: ${encoded.slice(0, 20)}...`)
        } catch (_) { toast("编码失败") }
      }},
      { id: "base64-decode", icon: "🔓", title: "Base64解码", action: (text) => {
        try {
          const decoded = atob(text)
          navigator.clipboard.writeText(decoded)
          toast(`已解码并复制: ${decoded.slice(0, 20)}...`)
        } catch (_) { toast("解码失败: 无效的 base64") }
      }},
      { id: "url-encode", icon: "🔗", title: "URL编码", action: (text) => {
        const encoded = encodeURIComponent(text)
        navigator.clipboard.writeText(encoded)
        toast(`已URL编码: ${encoded.slice(0, 20)}...`)
      }},
      { id: "url-decode", icon: "🔓", title: "URL解码", action: (text) => {
        try {
          const decoded = decodeURIComponent(text)
          navigator.clipboard.writeText(decoded)
          toast(`已URL解码: ${decoded.slice(0, 20)}...`)
        } catch (_) { toast("URL解码失败") }
      }},
      { id: "uppercase", icon: "🔠", title: "转大写", action: (text) => {
        const upper = text.toUpperCase()
        navigator.clipboard.writeText(upper)
        toast("已转换为大写并复制")
      }},
      { id: "lowercase", icon: "🔡", title: "转小写", action: (text) => {
        const lower = text.toLowerCase()
        navigator.clipboard.writeText(lower)
        toast("已转换为小写并复制")
      }},
      { id: "md5", icon: "#️⃣", title: "MD5哈希", action: (text) => {
        const w = window as unknown as { commands?: { md5?: (a: string[]) => string } }
        const hash = w.commands?.md5 ? w.commands.md5([text]) : ""
        if (hash) {
          navigator.clipboard.writeText(hash)
          toast(`MD5: ${hash}`)
        } else {
          toast("MD5功能不可用")
        }
      }}
    ]
  }

  getButtonById(id: string): ButtonDefinition | undefined {
    return this.getDefaultButtons().find((b) => b.id === id)
  }

  getButtonsByIds(ids: string[]): ButtonDefinition[] {
    const all = this.getDefaultButtons()
    return ids.map((id) => all.find((b) => b.id === id)).filter((b): b is ButtonDefinition => Boolean(b))
  }

  getMiniModeButtons(): string[] { return ["baidu", "google", "chuchusou", "copy", "lowercase"] }
  getNormalModeButtons(): string[] { return ["baidu", "google", "chatgpt", "chuchusou", "copy"] }

  executeAction(buttonId: string, text: string): boolean {
    const button = this.getButtonById(buttonId)
    if (button?.action) {
      try {
        button.action.call(this, text)
        return true
      } catch (err) {
        console.error("[触触搜] 执行按钮动作失败:", buttonId, err)
        return false
      }
    }
    return false
  }

  getSearchEngineButtons(): string[] { return ["baidu", "google", "chatgpt", "chuchusou"] }
  getToolButtons(): string[] { return ["copy", "base64-encode", "base64-decode", "url-encode", "url-decode", "uppercase", "lowercase", "md5"] }
  isSearchEngineButton(id: string): boolean { return this.getSearchEngineButtons().includes(id) }
  isToolButton(id: string): boolean { return this.getToolButtons().includes(id) }

  createCustomButton(config: CustomButtonConfig): ButtonDefinition {
    const { id, icon, title, action, url } = config
    if (!id || !title) throw new Error("按钮必须有ID和标题")

    const button: ButtonDefinition = { id, icon: icon || "🔧", title, custom: true }
    if (action && typeof action === "function") {
      button.action = action
    } else if (url) {
      button.action = (text: string) => {
        const finalUrl = url.replace("{{text}}", encodeURIComponent(text))
        window.open(finalUrl, "_blank")
      }
    } else {
      throw new Error("按钮必须有action函数或url")
    }
    return button
  }

  validateButton(button: unknown): boolean {
    if (!button || typeof button !== "object") return false
    const b = button as ButtonDefinition
    return !!(b.id && b.title && typeof b.action === "function")
  }
}

export const ButtonDefinitions = new ButtonDefinitionsManager()

export default ButtonDefinitions
