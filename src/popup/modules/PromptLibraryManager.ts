/**
 * Popup - 提示词库管理器 (TypeScript port)
 *
 * 与 popup/modules/PromptLibraryManager.js 1:1 行为对等。chrome.storage.sync 通过 globalThis 防御性访问。
 */

export interface PromptEntry {
  id: string
  name: string
  content: string
  isBuiltin?: boolean
  createdAt: number
  updatedAt: number
}

export interface PromptLibraryData {
  version: number
  prompts: PromptEntry[]
}

export interface PromptLibraryOptions {
  onToast?: (msg: string) => void
}

interface ValidationResult {
  valid: boolean
  message?: string
}

interface ChromeLike {
  storage?: {
    sync?: {
      get: (keys: string[], cb: (r: Record<string, unknown>) => void) => void
      set: (data: Record<string, unknown>, cb?: () => void) => void
    }
  }
  runtime?: { lastError?: { message?: string } | null }
}

function getChrome(): ChromeLike | null {
  return (globalThis as unknown as { chrome?: ChromeLike }).chrome || null
}

export class PromptLibraryManager {
  onToast: (msg: string) => void
  storageKey = "ccs_prompt_library"
  maxPrompts = 100
  maxNameLength = 50
  maxContentLength = 2000
  currentPrompts: PromptEntry[] = []
  editingPromptId: string | null = null

  builtinPrompts: PromptEntry[] = [
    {
      id: "builtin-comprehensive-analysis",
      name: "综合分析",
      content: "请您尽量综合考虑，并且：进行综合分析，包括归类主题、提炼关键词、总结重点思想，并突出亮点和整理完成后以结构清晰、重点突出的方式呈现。",
      isBuiltin: true,
      createdAt: 1700000000000,
      updatedAt: 1700000000000
    }
  ]

  constructor(options: PromptLibraryOptions = {}) {
    this.onToast = options.onToast || ((msg: string) => console.log(msg))
  }

  async init(): Promise<void> {
    await this._ensureBuiltinPrompts()
    this._bindEvents()
    await this.renderList()
  }

  private async _ensureBuiltinPrompts(): Promise<void> {
    const data = await this._loadFromStorage()
    const prompts = data.prompts || []
    let needsSave = false
    for (const builtin of this.builtinPrompts) {
      const exists = prompts.some((p) => p.id === builtin.id)
      if (!exists) {
        prompts.unshift(builtin)
        needsSave = true
      }
    }
    if (needsSave) {
      await this._saveToStorage({ ...data, prompts })
    }
    this.currentPrompts = prompts
  }

  private _loadFromStorage(): Promise<PromptLibraryData> {
    return new Promise((resolve) => {
      const ch = getChrome()
      if (!ch?.storage?.sync?.get) {
        resolve({ version: 1, prompts: [] })
        return
      }
      ch.storage.sync.get([this.storageKey], (result) => {
        const data = (result[this.storageKey] as PromptLibraryData) || { version: 1, prompts: [] }
        resolve(data)
      })
    })
  }

  private async _saveToStorage(data: PromptLibraryData): Promise<void> {
    return new Promise((resolve, reject) => {
      const ch = getChrome()
      if (!ch?.storage?.sync?.set) {
        reject(new Error("chrome.storage.sync unavailable"))
        return
      }
      ch.storage.sync.set({ [this.storageKey]: data }, () => {
        const error = ch.runtime?.lastError?.message
        if (error) {
          if (error.includes("QUOTA")) {
            this.onToast("存储空间已满，请删除一些提示词")
            reject(new Error("Storage quota exceeded"))
            return
          }
          reject(new Error(error))
          return
        }
        resolve()
      })
    })
  }

  private _generateId(): string {
    return "prompt-" + Date.now() + "-" + Math.random().toString(36).slice(2, 11)
  }

  async loadPrompts(): Promise<PromptEntry[]> {
    const data = await this._loadFromStorage()
    this.currentPrompts = data.prompts || []
    return this.currentPrompts
  }

  async addPrompt(name: string, content: string): Promise<boolean> {
    const validation = this._validatePrompt(name, content)
    if (!validation.valid) {
      this.onToast(validation.message || "验证失败")
      return false
    }
    if (this.currentPrompts.length >= this.maxPrompts) {
      this.onToast(`最多只能保存 ${this.maxPrompts} 个提示词`)
      return false
    }
    const newPrompt: PromptEntry = {
      id: this._generateId(),
      name: name.trim(),
      content: content.trim(),
      isBuiltin: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    this.currentPrompts.push(newPrompt)
    try {
      await this._saveToStorage({ version: 1, prompts: this.currentPrompts })
      this.onToast("提示词已保存")
      await this.renderList()
      return true
    } catch (_) {
      this.currentPrompts.pop()
      return false
    }
  }

  async updatePrompt(id: string, name: string, content: string): Promise<boolean> {
    const index = this.currentPrompts.findIndex((p) => p.id === id)
    if (index === -1) { this.onToast("提示词未找到"); return false }
    const prompt = this.currentPrompts[index]
    if (prompt.isBuiltin) { this.onToast("内置提示词无法编辑"); return false }

    const validation = this._validatePrompt(name, content)
    if (!validation.valid) {
      this.onToast(validation.message || "验证失败")
      return false
    }

    const oldPrompt = { ...prompt }
    prompt.name = name.trim()
    prompt.content = content.trim()
    prompt.updatedAt = Date.now()

    try {
      await this._saveToStorage({ version: 1, prompts: this.currentPrompts })
      this.onToast("提示词已更新")
      await this.renderList()
      return true
    } catch (_) {
      this.currentPrompts[index] = oldPrompt
      return false
    }
  }

  async deletePrompt(id: string): Promise<boolean> {
    const index = this.currentPrompts.findIndex((p) => p.id === id)
    if (index === -1) { this.onToast("提示词未找到"); return false }
    const prompt = this.currentPrompts[index]
    if (prompt.isBuiltin) { this.onToast("内置提示词无法删除"); return false }
    if (!confirm(`确定要删除「${prompt.name}」吗？`)) return false

    const removedPrompt = this.currentPrompts.splice(index, 1)[0]
    try {
      await this._saveToStorage({ version: 1, prompts: this.currentPrompts })
      this.onToast("提示词已删除")
      await this.renderList()
      return true
    } catch (_) {
      this.currentPrompts.splice(index, 0, removedPrompt)
      return false
    }
  }

  async usePrompt(id: string): Promise<boolean> {
    const prompt = this.currentPrompts.find((p) => p.id === id)
    if (!prompt) { this.onToast("提示词未找到"); return false }
    try {
      await navigator.clipboard.writeText(prompt.content)
      this.onToast(`已复制: ${prompt.name}`)
      return true
    } catch (_) {
      this.onToast("复制失败")
      return false
    }
  }

  private _validatePrompt(name: string, content: string): ValidationResult {
    if (!name || !name.trim()) return { valid: false, message: "请输入提示词名称" }
    if (name.trim().length > this.maxNameLength) return { valid: false, message: `名称不能超过 ${this.maxNameLength} 个字符` }
    if (!content || !content.trim()) return { valid: false, message: "请输入提示词内容" }
    if (content.trim().length > this.maxContentLength) return { valid: false, message: `内容不能超过 ${this.maxContentLength} 个字符` }
    return { valid: true }
  }

  async renderList(): Promise<void> {
    await this.loadPrompts()
    const countEl = document.querySelector<HTMLElement>(".prompt-count")
    if (countEl) countEl.textContent = String(this.currentPrompts.length)

    const listEl = document.querySelector<HTMLElement>(".prompt-list")
    if (!listEl) return

    if (this.currentPrompts.length === 0) {
      listEl.innerHTML = '<div class="prompt-empty">暂无提示词</div>'
      return
    }

    listEl.innerHTML = this.currentPrompts
      .map((prompt) => {
        const preview = prompt.content.length > 30 ? prompt.content.substring(0, 30) + "..." : prompt.content
        const builtinBadge = prompt.isBuiltin ? '<span class="prompt-builtin-badge">内置</span>' : ""
        const actions = prompt.isBuiltin
          ? ""
          : `<button class="prompt-edit" data-prompt-id="${prompt.id}" title="编辑">✏️</button>
             <button class="prompt-delete" data-prompt-id="${prompt.id}" title="删除">🗑️</button>`
        return `
          <div class="prompt-item" data-prompt-id="${prompt.id}">
            <div class="prompt-main" title="点击复制">
              <div class="prompt-info">
                <span class="prompt-name">${this._escapeHtml(prompt.name)}${builtinBadge}</span>
                <span class="prompt-preview">${this._escapeHtml(preview)}</span>
              </div>
            </div>
            <div class="prompt-actions">${actions}</div>
          </div>
        `
      })
      .join("")

    this._bindListEvents()
  }

  private _escapeHtml(text: string): string {
    const div = document.createElement("div")
    div.textContent = text
    return div.innerHTML
  }

  private _bindListEvents(): void {
    document.querySelectorAll<HTMLElement>(".prompt-main").forEach((el) => {
      el.addEventListener("click", (e) => {
        const item = (e.currentTarget as HTMLElement).closest<HTMLElement>(".prompt-item")
        const id = item?.dataset.promptId
        if (id) this.usePrompt(id)
      })
    })
    document.querySelectorAll<HTMLElement>(".prompt-edit").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation()
        const id = (e.currentTarget as HTMLElement).dataset.promptId
        if (id) this.showModal("edit", id)
      })
    })
    document.querySelectorAll<HTMLElement>(".prompt-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation()
        const id = (e.currentTarget as HTMLElement).dataset.promptId
        if (id) this.deletePrompt(id)
      })
    })
  }

  private _bindEvents(): void {
    document.querySelector<HTMLElement>(".add-prompt-btn")?.addEventListener("click", () => this.showModal("add"))
    document.querySelector<HTMLElement>(".prompt-modal-cancel")?.addEventListener("click", () => this.hideModal())
    document.querySelector<HTMLElement>(".prompt-modal-save")?.addEventListener("click", () => this.saveFromModal())

    const modal = document.getElementById("promptModal")
    modal?.addEventListener("click", (e) => {
      if (e.target === modal) this.hideModal()
    })

    const contentInput = document.getElementById("promptContentInput") as HTMLTextAreaElement | null
    contentInput?.addEventListener("input", () => {
      const count = contentInput.value.length
      const countEl = document.querySelector<HTMLElement>(".prompt-char-count")
      if (countEl) {
        countEl.textContent = `${count}/${this.maxContentLength}`
        countEl.style.color = count > this.maxContentLength ? "#f44336" : ""
      }
    })
  }

  showModal(mode: "add" | "edit", promptId: string | null = null): void {
    const modal = document.getElementById("promptModal")
    const title = document.getElementById("promptModalTitle")
    const nameInput = document.getElementById("promptNameInput") as HTMLInputElement | null
    const contentInput = document.getElementById("promptContentInput") as HTMLTextAreaElement | null
    const countEl = document.querySelector<HTMLElement>(".prompt-char-count")

    if (!modal || !nameInput || !contentInput) return
    this.editingPromptId = null

    if (mode === "edit" && promptId) {
      const prompt = this.currentPrompts.find((p) => p.id === promptId)
      if (!prompt) return
      this.editingPromptId = promptId
      if (title) title.textContent = "编辑提示词"
      nameInput.value = prompt.name
      contentInput.value = prompt.content
    } else {
      if (title) title.textContent = "新建提示词"
      nameInput.value = ""
      contentInput.value = ""
    }

    if (countEl) countEl.textContent = `${contentInput.value.length}/${this.maxContentLength}`

    modal.style.display = "flex"
    nameInput.focus()
  }

  hideModal(): void {
    const modal = document.getElementById("promptModal")
    if (modal) modal.style.display = "none"
    this.editingPromptId = null
  }

  async saveFromModal(): Promise<void> {
    const nameInput = document.getElementById("promptNameInput") as HTMLInputElement | null
    const contentInput = document.getElementById("promptContentInput") as HTMLTextAreaElement | null
    if (!nameInput || !contentInput) return

    const name = nameInput.value
    const content = contentInput.value

    let success: boolean
    if (this.editingPromptId) {
      success = await this.updatePrompt(this.editingPromptId, name, content)
    } else {
      success = await this.addPrompt(name, content)
    }
    if (success) this.hideModal()
  }
}

export default PromptLibraryManager
