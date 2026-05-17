/**
 * 触触搜 Popup - 菜单渲染器 (TypeScript port)
 *
 * 与 popup/modules/MenuRenderer.js 1:1 行为对等。**零 chrome.* 依赖**（纯 DOM）。
 */

export interface MenuRendererOptions {
  containerSelector?: string
  keywordSelector?: string
  maxKeywordLength?: number
  onItemClick?: ((item: MenuItem) => void) | null
}

export interface MenuItem {
  id: string
  type?: string
  title?: string
  icon?: string
  enabled?: boolean
  children?: MenuItem[]
}

export interface MenuGroup {
  id: string
  separator?: "before" | "after" | "none" | string
  items?: MenuItem[]
}

export interface MenuConfigShape {
  groups: MenuGroup[]
}

export interface KeywordInfo {
  text?: string
  raw?: string
}

export class MenuRenderer {
  containerSelector: string
  keywordSelector: string
  maxKeywordLength: number
  onItemClick: ((item: MenuItem) => void) | null

  constructor(options: MenuRendererOptions = {}) {
    this.containerSelector = options.containerSelector ?? "#menuContainer"
    this.keywordSelector = options.keywordSelector ?? "#currentKeyword"
    this.maxKeywordLength = options.maxKeywordLength ?? 15
    this.onItemClick = options.onItemClick ?? null
  }

  render(config: MenuConfigShape | null, keyword?: KeywordInfo | null): void {
    const container = document.querySelector<HTMLElement>(this.containerSelector)
    if (!container) return

    container.innerHTML = ""

    this._renderKeyword(keyword)

    if (!config || !config.groups) {
      container.innerHTML = '<div class="menu-empty">无菜单配置</div>'
      return
    }

    config.groups.forEach((group, index) => {
      if (group.id === "panel") return

      if (group.separator === "before" && index > 0) {
        container.appendChild(this._createSeparator())
      }

      this._renderGroup(container, group)

      if (group.separator === "after") {
        container.appendChild(this._createSeparator())
      }
    })
  }

  private _renderKeyword(keyword?: KeywordInfo | null): void {
    const keywordEl = document.querySelector<HTMLElement>(this.keywordSelector)
    const copyEl = document.querySelector<HTMLElement>("#currentKeywordCopy")
    if (!keywordEl) return
    const keywordWrapEl = keywordEl.closest<HTMLElement>(".menu-keyword-wrap")

    if (keyword && keyword.text) {
      const displayText = this._formatKeyword(keyword.text)
      const fullKeyword = keyword.raw || keyword.text
      keywordEl.textContent = `"${displayText}"`
      if (keywordWrapEl) keywordWrapEl.dataset.fullKeyword = fullKeyword
      keywordEl.removeAttribute("title")
      keywordEl.style.display = "block"
      if (copyEl) {
        ;(copyEl as HTMLElement & { hidden: boolean }).hidden = false
        copyEl.dataset.keyword = fullKeyword
      }
    } else {
      keywordEl.textContent = ""
      if (keywordWrapEl) keywordWrapEl.dataset.fullKeyword = ""
      keywordEl.removeAttribute("title")
      keywordEl.style.display = "none"
      if (copyEl) {
        ;(copyEl as HTMLElement & { hidden: boolean }).hidden = true
        copyEl.dataset.keyword = ""
      }
    }
  }

  private _formatKeyword(text: string): string {
    if (!text) return ""
    const compact = text.replace(/\s+/g, " ").trim()
    return compact.length > this.maxKeywordLength
      ? compact.substring(0, this.maxKeywordLength) + "..."
      : compact
  }

  private _createSeparator(): HTMLElement {
    const sep = document.createElement("div")
    sep.className = "menu-separator"
    return sep
  }

  private _renderGroup(container: HTMLElement, group: MenuGroup): void {
    if (!group.items) return

    group.items.forEach((item) => {
      if (item.enabled === false) return

      const itemEl = this._createMenuItem(item)
      container.appendChild(itemEl)

      if (item.children && item.children.length > 0) {
        const submenu = this._createSubmenu(item.children, item.id)
        container.appendChild(submenu)
      }
    })
  }

  private _createMenuItem(item: MenuItem): HTMLElement {
    const el = document.createElement("div")
    el.className = "menu-item"
    el.dataset.menuId = item.id
    el.dataset.menuType = item.type || ""

    const hasChildren = !!(item.children && item.children.length > 0)
    if (hasChildren) el.classList.add("has-children")

    let displayTitle = item.title || ""
    if (item.type === "fastqa-quick") {
      const match = displayTitle.match(/- (.+)$/)
      if (match) displayTitle = `速答 · ${match[1]}`
    }

    el.innerHTML = `
      <span class="item-icon">${item.icon || ""}</span>
      <span class="item-title">${displayTitle}</span>
      ${hasChildren ? '<span class="item-arrow">▶</span>' : ""}
    `

    el.addEventListener("click", (e) => {
      e.stopPropagation()
      if (hasChildren) {
        this._toggleSubmenu(el, item.id)
      } else if (this.onItemClick) {
        this.onItemClick(item)
      }
    })

    return el
  }

  private _createSubmenu(children: MenuItem[], parentId: string, level: number = 1): HTMLElement {
    const submenu = document.createElement("div")
    submenu.className = "submenu collapsed"
    submenu.dataset.parentId = parentId
    submenu.dataset.level = String(level)

    children.forEach((child) => {
      if (child.enabled === false) return

      const hasChildren = !!(child.children && child.children.length > 0)

      const childEl = document.createElement("div")
      childEl.className = `menu-item submenu-item level-${level}`
      childEl.dataset.menuId = child.id
      childEl.dataset.menuType = child.type || ""
      if (hasChildren) childEl.classList.add("has-children")

      childEl.innerHTML = `
        <span class="item-icon">${child.icon || ""}</span>
        <span class="item-title">${child.title}</span>
        ${hasChildren ? '<span class="item-arrow">▶</span>' : ""}
      `

      childEl.addEventListener("click", (e) => {
        e.stopPropagation()
        if (hasChildren) {
          this._toggleSubmenu(childEl, child.id)
        } else if (this.onItemClick) {
          this.onItemClick(child)
        }
      })

      submenu.appendChild(childEl)

      if (hasChildren && child.children) {
        const nestedSubmenu = this._createSubmenu(child.children, child.id, level + 1)
        submenu.appendChild(nestedSubmenu)
      }
    })

    return submenu
  }

  private _toggleSubmenu(parentEl: HTMLElement, parentId: string): void {
    const submenu = document.querySelector<HTMLElement>(`.submenu[data-parent-id="${parentId}"]`)
    if (submenu) {
      submenu.classList.toggle("collapsed")
      parentEl.classList.toggle("expanded")
    }
  }

  showError(message: string): void {
    const container = document.querySelector<HTMLElement>(this.containerSelector)
    if (container) {
      container.innerHTML = `<div class="menu-error">${message}</div>`
    }
  }
}

export default MenuRenderer
