/**
 * Content script - Buttons 模块 (TypeScript port)
 *
 * 与 modules/buttons.js 1:1 行为对等。**零 chrome.* 依赖**。
 */

export interface ButtonAction {
  (text: string): void | Promise<void>
}

export interface ButtonConfig {
  id: string
  icon?: string
  title: string
  action: ButtonAction
}

interface GlobalContent {
  CCSModules?: {
    Toast?: { show?: (m: string) => void; error?: (m: string) => void }
    Selection?: { getCurrentSearchText?: () => string }
  }
}

function getToast(): { show: (m: string) => void; error: (m: string) => void } {
  const w = window as unknown as GlobalContent
  return {
    show: (m) => w.CCSModules?.Toast?.show?.(m),
    error: (m) => w.CCSModules?.Toast?.error?.(m)
  }
}

const defaultButtons: ButtonConfig[] = [
  {
    id: "baidu", icon: "🔍", title: "百度搜索",
    action: (text) => {
      const url = `https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${encodeURIComponent(text)}`
      console.log("[触触搜] Baidu Search URL:", { searchText: text, encodedText: encodeURIComponent(text), fullURL: url })
      window.open(url, "_blank")
    }
  },
  {
    id: "google", icon: "🔍", title: "Google搜索",
    action: (text) => {
      const url = `https://www.google.com/search?q=${encodeURIComponent(text)}`
      console.log("[触触搜] Google Search URL:", { searchText: text, encodedText: encodeURIComponent(text), fullURL: url })
      window.open(url, "_blank")
    }
  },
  {
    id: "chatgpt", icon: "🌐", title: "ChatGPT",
    action: (text) => { window.open(`https://chatgpt.com/?q=${encodeURIComponent(text)}`, "_blank") }
  },
  {
    id: "chuchusou", icon: "🌐", title: "更多搜索",
    action: (text) => {
      const url = `https://chuchusou.com/?q=${encodeURIComponent(text)}`
      console.log("[触触搜] Chuchusou Search URL:", { searchText: text, encodedText: encodeURIComponent(text), fullURL: url })
      window.open(url, "_blank")
    }
  },
  {
    id: "copy", icon: "📝", title: "复制",
    action: async (text) => {
      const toast = getToast()
      try {
        await navigator.clipboard.writeText(text)
        toast.show("已复制到剪贴板")
      } catch (_) {
        toast.error("复制失败")
      }
    }
  },
  {
    id: "base64-encode", icon: "🔤", title: "Base64编码",
    action: (text) => {
      const toast = getToast()
      try {
        const encoded = btoa(unescape(encodeURIComponent(text)))
        navigator.clipboard.writeText(encoded)
        toast.show(`已编码并复制: ${encoded.slice(0, 20)}...`)
      } catch (_) {
        toast.error("编码失败")
      }
    }
  },
  {
    id: "base64-decode", icon: "🔓", title: "Base64解码",
    action: (text) => {
      const toast = getToast()
      try {
        const decoded = decodeURIComponent(escape(atob(text)))
        navigator.clipboard.writeText(decoded)
        toast.show(`已解码并复制: ${decoded.slice(0, 20)}...`)
      } catch (_) {
        toast.error("解码失败: 无效的 base64")
      }
    }
  },
  {
    id: "url-encode", icon: "🔗", title: "URL编码",
    action: (text) => {
      const encoded = encodeURIComponent(text)
      navigator.clipboard.writeText(encoded)
      getToast().show(`已URL编码: ${encoded.slice(0, 20)}...`)
    }
  },
  {
    id: "url-decode", icon: "🔓", title: "URL解码",
    action: (text) => {
      const toast = getToast()
      try {
        const decoded = decodeURIComponent(text)
        navigator.clipboard.writeText(decoded)
        toast.show(`已URL解码: ${decoded.slice(0, 20)}...`)
      } catch (_) {
        toast.error("URL解码失败")
      }
    }
  },
  {
    id: "uppercase", icon: "🔠", title: "转大写",
    action: (text) => {
      navigator.clipboard.writeText(text.toUpperCase())
      getToast().show("已转换为大写并复制")
    }
  },
  {
    id: "lowercase", icon: "🔡", title: "转小写",
    action: (text) => {
      navigator.clipboard.writeText(text.toLowerCase())
      getToast().show("已转换为小写并复制")
    }
  },
  {
    id: "translate", icon: "🌏", title: "谷歌翻译",
    action: (text) => { window.open(`https://translate.google.com/?text=${encodeURIComponent(text)}`, "_blank") }
  },
  {
    id: "wikipedia", icon: "📖", title: "维基百科",
    action: (text) => { window.open(`https://wikipedia.org/wiki/${encodeURIComponent(text)}`, "_blank") }
  }
]

const miniModeButtonConfig: Record<string, { icon: string; title: string }> = {
  baidu: { icon: "🔍", title: "百度" },
  google: { icon: "🔍", title: "Google" },
  chatgpt: { icon: "🤖", title: "ChatGPT" },
  chuchusou: { icon: "🌐", title: "触触搜" },
  copy: { icon: "📋", title: "复制" },
  uppercase: { icon: "🔠", title: "大写" },
  lowercase: { icon: "🔡", title: "小写" },
  translate: { icon: "🌏", title: "翻译" }
}

export class ButtonsManager {
  defaultButtons: ButtonConfig[] = [...defaultButtons]
  miniModeButtons = { ...miniModeButtonConfig }

  getButtonById(buttonId: string): ButtonConfig | undefined {
    return this.defaultButtons.find((b) => b.id === buttonId)
  }

  getAllButtons(): ButtonConfig[] { return this.defaultButtons }

  addButton(button: ButtonConfig): boolean {
    if (!button.id || !button.title || !button.action) {
      console.error("[触触搜] 添加按钮失败：缺少必要属性")
      return false
    }
    if (this.getButtonById(button.id)) {
      console.warn("[触触搜] 按钮已存在：", button.id)
      return false
    }
    this.defaultButtons.push(button)
    return true
  }

  removeButton(buttonId: string): boolean {
    const index = this.defaultButtons.findIndex((b) => b.id === buttonId)
    if (index > -1) {
      this.defaultButtons.splice(index, 1)
      return true
    }
    return false
  }

  executeAction(buttonId: string, text: string): void {
    console.log("[触触搜][executeAction] Called with:", { buttonId, text, textLength: text ? text.length : 0 })
    const button = this.getButtonById(buttonId)
    console.log("[触触搜][executeAction] Found button:", { found: !!button, buttonId: button?.id, buttonTitle: button?.title })
    if (button?.action) {
      try {
        console.log("[触触搜][executeAction] Executing action for:", buttonId, "with text:", text)
        button.action(text)
      } catch (e) {
        console.error("[触触搜] 执行按钮动作失败:", e)
        getToast().error("操作失败")
      }
    }
  }

  renderButtons(container: HTMLElement | null, buttonsToShow?: (string | ButtonConfig)[], _mode: string = "normal"): void {
    if (!container) return
    container.innerHTML = ""
    const buttons: (string | ButtonConfig)[] = buttonsToShow || this.defaultButtons

    buttons.forEach((buttonConfig) => {
      let button: HTMLButtonElement
      if (typeof buttonConfig === "string") {
        const btnDef = this.getButtonById(buttonConfig)
        if (!btnDef) return

        button = document.createElement("button")
        button.className = "ccs-mini-button"
        button.dataset.id = buttonConfig
        const miniConfig = this.miniModeButtons[buttonConfig] || { icon: "", title: "" }
        button.innerHTML = `
          <span class="ccs-mini-icon">${miniConfig.icon || btnDef.icon || "❓"}</span>
          <span class="ccs-mini-label">${miniConfig.title || btnDef.title}</span>
        `
        button.onclick = () => {
          let text = button.dataset.searchText
          console.log("[触触搜][Modules] Mini Button Click:", {
            buttonId: buttonConfig, dataSearchText: button.dataset.searchText, hasDataSearchText: !!button.dataset.searchText
          })
          if (!text) {
            const w = window as unknown as GlobalContent
            text = w.CCSModules?.Selection?.getCurrentSearchText?.() || ""
            console.log("[触触搜][Modules] Fallback to Selection module:", text)
          }
          console.log("[触触搜][Modules] Final text for mini button:", text)
          if (text) this.executeAction(buttonConfig, text)
        }
      } else {
        const bc = buttonConfig as ButtonConfig
        button = document.createElement("button")
        button.className = "ccs-button"
        button.dataset.id = bc.id
        button.innerHTML = `
          <span class="ccs-button-icon">${bc.icon || ""}</span>
          <span class="ccs-button-label">${bc.title}</span>
        `
        button.onclick = () => {
          let text = button.dataset.searchText
          console.log("[触触搜][Modules] Normal Button Click:", {
            buttonId: bc.id, buttonTitle: bc.title, dataSearchText: button.dataset.searchText, hasDataSearchText: !!button.dataset.searchText
          })
          if (!text) {
            const w = window as unknown as GlobalContent
            text = w.CCSModules?.Selection?.getCurrentSearchText?.() || ""
            console.log("[触触搜][Modules] Fallback to Selection module:", text)
          }
          console.log("[触触搜][Modules] Final text for normal button:", text)
          if (text) bc.action(text)
        }
      }
      container.appendChild(button)
    })
  }

  updateAllButtonsText(text: string, shadowRoot: ShadowRoot | null): void {
    if (!shadowRoot) return
    const buttons = shadowRoot.querySelectorAll<HTMLElement>(".ccs-button, .ccs-mini-button")
    buttons.forEach((b) => { b.dataset.searchText = text })
  }

  getMiniModeDefaults(): string[] { return ["baidu", "google", "chuchusou", "copy", "lowercase"] }

  registerSearchEngine(id: string, name: string, urlTemplate: string, icon: string = "🔍"): boolean {
    return this.addButton({
      id, icon, title: name,
      action: (text) => {
        const url = urlTemplate.replace("{query}", encodeURIComponent(text))
        window.open(url, "_blank")
      }
    })
  }
}

export const Buttons = new ButtonsManager()

export default Buttons
