/**
 * Content script - Dragging 模块 (TypeScript port)
 *
 * 与 modules/dragging.js 1:1 行为对等。**零 chrome.* 依赖**（依赖 Settings 通过 window 注入）。
 */

export interface DragConfig {
  dragHandle: string
  dragBoundary: boolean
  savePosition: boolean
  minOpacity: number
  dragClass: string
}

export interface DragPosition {
  left: number
  top: number
  width?: number
  height?: number
}

export interface DragCallbacks {
  onDrag?: (pos: { x: number; y: number }) => void
  onDragEnd?: () => void
}

interface GlobalContent {
  CCSModules?: {
    Settings?: { set?: (k: string, v: unknown) => void; get?: (k: string) => DragPosition | null }
  }
}

export class DraggingManager {
  isDragging = false
  dragOffset = { x: 0, y: 0 }
  dragTarget: HTMLElement | null = null
  originalPosition: { left: string; top: string } | null = null
  config: DragConfig = {
    dragHandle: ".ccs-header",
    dragBoundary: true,
    savePosition: true,
    minOpacity: 0.3,
    dragClass: "ccs-dragging"
  }
  private globalEventsAttached = false
  dragCallback?: (pos: { x: number; y: number }) => void
  dragEndCallback?: () => void

  init(element: HTMLElement | null, options: Partial<DragConfig> = {}): void {
    if (!element) return
    this.config = { ...this.config, ...options }
    const handle: HTMLElement = (element.querySelector<HTMLElement>(this.config.dragHandle) || element)
    handle.addEventListener("mousedown", (e: MouseEvent) => this.startDragging(e, element))

    if (!this.globalEventsAttached) {
      document.addEventListener("mousemove", (e: MouseEvent) => this.handleDragging(e))
      document.addEventListener("mouseup", () => this.stopDragging())
      this.globalEventsAttached = true
    }
  }

  startDragging(e: MouseEvent, element: HTMLElement): void {
    if (!this.shouldDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    this.isDragging = true
    this.dragTarget = element
    const rect = element.getBoundingClientRect()
    this.dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    this.originalPosition = { left: element.style.left, top: element.style.top }
    element.classList.add(this.config.dragClass)
    element.style.cursor = "grabbing"
    element.style.opacity = "0.8"
    element.style.transition = "none"
    document.body.style.userSelect = "none"
    console.log("[触触搜] 开始拖拽")
  }

  handleDragging(e: MouseEvent): void {
    if (!this.isDragging || !this.dragTarget) return
    e.preventDefault()
    let newX = e.clientX - this.dragOffset.x
    let newY = e.clientY - this.dragOffset.y
    if (this.config.dragBoundary) {
      const boundary = this.getBoundary()
      const rect = this.dragTarget.getBoundingClientRect()
      newX = Math.max(boundary.left, Math.min(newX, boundary.right - rect.width))
      newY = Math.max(boundary.top, Math.min(newY, boundary.bottom - rect.height))
    }
    this.dragTarget.style.position = "fixed"
    this.dragTarget.style.left = `${newX}px`
    this.dragTarget.style.top = `${newY}px`
    this.onDrag({ x: newX, y: newY })
  }

  stopDragging(): void {
    if (!this.isDragging) return
    console.log("[触触搜] 停止拖拽")
    if (this.dragTarget) {
      this.dragTarget.classList.remove(this.config.dragClass)
      this.dragTarget.style.cursor = ""
      this.dragTarget.style.opacity = ""
      this.dragTarget.style.transition = ""
      if (this.config.savePosition) this.savePosition()
      this.onDragEnd()
    }
    this.isDragging = false
    this.dragTarget = null
    this.dragOffset = { x: 0, y: 0 }
    document.body.style.userSelect = ""
  }

  shouldDrag(e: MouseEvent): boolean {
    const target = e.target as Element
    if (!target) return false
    const tagName = target.tagName.toLowerCase()
    if (["button", "input", "textarea", "select", "a"].includes(tagName)) return false
    const draggable = (target as HTMLElement).closest<HTMLElement>("[data-draggable]")
    if (draggable && draggable.dataset.draggable === "false") return false
    if (this.config.dragHandle) {
      const handle = (target as HTMLElement).closest(this.config.dragHandle)
      if (!handle) return false
      if ((target as HTMLElement).closest("button, input, textarea, select, a")) return false
    }
    return true
  }

  getBoundary(): { left: number; top: number; right: number; bottom: number } {
    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  }

  savePosition(): void {
    if (!this.dragTarget) return
    const rect = this.dragTarget.getBoundingClientRect()
    const position: DragPosition = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    }
    const w = window as unknown as GlobalContent
    if (w.CCSModules?.Settings?.set) w.CCSModules.Settings.set("position", position)
    console.log("[触触搜] 位置已保存:", position)
  }

  restorePosition(element: HTMLElement): void {
    const w = window as unknown as GlobalContent
    const Settings = w.CCSModules?.Settings
    if (!Settings?.get) return
    const position = Settings.get("position")
    if (position) {
      element.style.position = "fixed"
      element.style.left = `${position.left}px`
      element.style.top = `${position.top}px`
      console.log("[触触搜] 位置已恢复:", position)
    }
  }

  cleanup(): void {
    this.stopDragging()
    this.isDragging = false
    this.dragTarget = null
    this.dragOffset = { x: 0, y: 0 }
    this.originalPosition = null
  }

  onDrag(position: { x: number; y: number }): void {
    if (this.dragCallback) this.dragCallback(position)
  }

  onDragEnd(): void {
    if (this.dragEndCallback) this.dragEndCallback()
  }

  setCallbacks(callbacks: DragCallbacks = {}): void {
    this.dragCallback = callbacks.onDrag
    this.dragEndCallback = callbacks.onDragEnd
  }

  makeDraggable(element: HTMLElement, options: Partial<DragConfig> = {}): void {
    this.init(element, options)
    const handle = element.querySelector<HTMLElement>(this.config.dragHandle) || element
    handle.style.cursor = "grab"
    handle.setAttribute("data-draggable", "true")
  }

  disableDragging(element: HTMLElement): void {
    const handle = element.querySelector<HTMLElement>(this.config.dragHandle) || element
    handle.style.cursor = ""
    handle.setAttribute("data-draggable", "false")
  }

  isDraggingNow(): boolean { return this.isDragging }
}

export const Dragging = new DraggingManager()

export default Dragging
