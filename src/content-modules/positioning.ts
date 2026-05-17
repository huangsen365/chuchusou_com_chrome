/**
 * Content script - Positioning 模块 (TypeScript port)
 *
 * 与 modules/positioning.js 1:1 行为对等。**零 chrome.* 依赖**。
 * 大量纯函数（getViewportQuadrant / scorePosition / ensureInViewport），
 * 唯一不纯部分是 calculateSmartPosition 用 window.innerWidth + console.log。
 */

export interface PositioningConfig {
  minCursorDistance: number
  viewportPadding: number
  selectionOffset: number
  inputFieldOffset: number
  cursorOffset: number
}

export interface Position {
  x: number
  y: number
}

export interface SelectionRectLike {
  left: number
  right: number
  top: number
  bottom: number
}

export type Quadrant = "top-left" | "top-right" | "bottom-left" | "bottom-right"

export interface AbsoluteRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface SmartPositionSettings {
  mode?: "mini" | "normal" | string
  miniButtons?: unknown[]
}

export class PositioningManager {
  config: PositioningConfig = {
    minCursorDistance: 60,
    viewportPadding: 10,
    selectionOffset: 24,
    inputFieldOffset: 28,
    cursorOffset: 50
  }

  getViewportQuadrant(x: number, y: number): Quadrant {
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const scrollX = window.scrollX
    const scrollY = window.scrollY
    const relX = x - scrollX
    const relY = y - scrollY
    const isLeft = relX < viewportWidth / 2
    const isTop = relY < viewportHeight / 2
    if (isTop && isLeft) return "top-left"
    if (isTop && !isLeft) return "top-right"
    if (!isTop && isLeft) return "bottom-left"
    return "bottom-right"
  }

  scorePosition(
    pos: Position,
    cursorX: number,
    cursorY: number,
    selectionRect: SelectionRectLike | null,
    popoverWidth: number,
    popoverHeight: number
  ): number {
    const scrollX = window.scrollX
    const scrollY = window.scrollY
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    let score = 0

    const cursorDist = Math.sqrt(
      Math.pow(pos.x + popoverWidth / 2 - cursorX, 2) +
        Math.pow(pos.y + popoverHeight / 2 - cursorY, 2)
    )
    const minCursorDist = this.config.minCursorDistance
    if (cursorDist >= minCursorDist) {
      score += Math.min(cursorDist / 100, 5) * 100
    } else {
      score -= (minCursorDist - cursorDist) * 10
    }

    const padding = this.config.viewportPadding
    const left = pos.x - scrollX
    const top = pos.y - scrollY
    const right = left + popoverWidth
    const bottom = top + popoverHeight

    if (
      left >= padding &&
      top >= padding &&
      right <= viewportWidth - padding &&
      bottom <= viewportHeight - padding
    ) {
      score += 200
    } else {
      const overflowLeft = Math.max(0, padding - left)
      const overflowTop = Math.max(0, padding - top)
      const overflowRight = Math.max(0, right - (viewportWidth - padding))
      const overflowBottom = Math.max(0, bottom - (viewportHeight - padding))
      const totalOverflow = overflowLeft + overflowTop + overflowRight + overflowBottom
      score -= totalOverflow * 2
    }

    if (selectionRect) {
      const overlap = !(
        pos.x + popoverWidth < selectionRect.left + scrollX - 10 ||
        pos.x > selectionRect.right + scrollX + 10 ||
        pos.y + popoverHeight < selectionRect.top + scrollY - 10 ||
        pos.y > selectionRect.bottom + scrollY + 10
      )
      if (!overlap) score += 100
    }
    return score
  }

  calculateSmartPosition(
    selectionRect: SelectionRectLike | null,
    mouseX: number,
    mouseY: number,
    settings: SmartPositionSettings = {}
  ): Position {
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const scrollX = window.scrollX
    const scrollY = window.scrollY

    console.log("[触触搜] calculateSmartPosition 输入:", {
      selectionRect: selectionRect
        ? { top: selectionRect.top, bottom: selectionRect.bottom, left: selectionRect.left, right: selectionRect.right }
        : null,
      mouseX, mouseY,
      viewport: { width: viewportWidth, height: viewportHeight },
      scroll: { x: scrollX, y: scrollY }
    })

    const miniButtonCount = settings.miniButtons?.length || 5
    const popoverWidth = settings.mode === "mini" ? miniButtonCount * 50 + 20 : 320
    const popoverHeight = settings.mode === "mini" ? 120 : 400

    const quadrant = this.getViewportQuadrant(mouseX, mouseY)
    console.log("[触触搜] 光标象限:", quadrant)

    const anchorX = mouseX
    const anchorY = mouseY

    const activeElement = document.activeElement as HTMLElement | null
    const isInInputField = !!(activeElement && (
      activeElement.tagName === "INPUT" ||
      activeElement.tagName === "TEXTAREA" ||
      activeElement.contentEditable === "true"
    ))

    const cursorOffset = this.config.cursorOffset
    const selectionOffset = isInInputField ? this.config.inputFieldOffset : this.config.selectionOffset

    const candidatePositions: Position[] = []

    if (quadrant === "top-left") {
      candidatePositions.push(
        { x: anchorX + cursorOffset, y: anchorY + cursorOffset },
        { x: anchorX + cursorOffset, y: anchorY - popoverHeight - cursorOffset },
        { x: anchorX - popoverWidth - cursorOffset, y: anchorY + cursorOffset }
      )
    } else if (quadrant === "top-right") {
      candidatePositions.push(
        { x: anchorX - popoverWidth - cursorOffset, y: anchorY + cursorOffset },
        { x: anchorX - popoverWidth - cursorOffset, y: anchorY - popoverHeight - cursorOffset },
        { x: anchorX + cursorOffset, y: anchorY + cursorOffset }
      )
    } else if (quadrant === "bottom-left") {
      candidatePositions.push(
        { x: anchorX + cursorOffset, y: anchorY - popoverHeight - cursorOffset },
        { x: anchorX + cursorOffset, y: anchorY + cursorOffset },
        { x: anchorX - popoverWidth - cursorOffset, y: anchorY - popoverHeight - cursorOffset }
      )
    } else {
      candidatePositions.push(
        { x: anchorX - popoverWidth - cursorOffset, y: anchorY - popoverHeight - cursorOffset },
        { x: anchorX - popoverWidth - cursorOffset, y: anchorY + cursorOffset },
        { x: anchorX + cursorOffset, y: anchorY - popoverHeight - cursorOffset }
      )
    }

    if (selectionRect) {
      const selCenterX = (selectionRect.left + selectionRect.right) / 2 + scrollX
      candidatePositions.unshift({
        x: selCenterX - popoverWidth / 2,
        y: selectionRect.bottom + scrollY + selectionOffset
      })
      candidatePositions.push({
        x: selCenterX - popoverWidth / 2,
        y: selectionRect.top + scrollY - popoverHeight - selectionOffset
      })
    }

    let bestPosition: Position | null = null
    let bestScore = -Infinity
    for (const pos of candidatePositions) {
      const score = this.scorePosition(pos, mouseX, mouseY, selectionRect, popoverWidth, popoverHeight)
      console.log("[触触搜] 候选位置评分:", { pos, score })
      if (score > bestScore) {
        bestScore = score
        bestPosition = pos
      }
    }

    if (bestPosition && bestScore > 0) {
      console.log("[触触搜] calculateSmartPosition 输出（最佳）:", {
        position: bestPosition, score: bestScore,
        popoverSize: { width: popoverWidth, height: popoverHeight }
      })
      return bestPosition
    }

    let fallbackX: number, fallbackY: number
    if (quadrant === "top-left") {
      fallbackX = scrollX + viewportWidth - popoverWidth - 20
      fallbackY = scrollY + viewportHeight - popoverHeight - 20
    } else if (quadrant === "top-right") {
      fallbackX = scrollX + 20
      fallbackY = scrollY + viewportHeight - popoverHeight - 20
    } else if (quadrant === "bottom-left") {
      fallbackX = scrollX + viewportWidth - popoverWidth - 20
      fallbackY = scrollY + 20
    } else {
      fallbackX = scrollX + 20
      fallbackY = scrollY + 20
    }
    fallbackX = Math.max(scrollX + 10, Math.min(fallbackX, scrollX + viewportWidth - popoverWidth - 10))
    fallbackY = Math.max(scrollY + 10, Math.min(fallbackY, scrollY + viewportHeight - popoverHeight - 10))

    console.log("[触触搜] calculateSmartPosition 输出（备用）:", {
      x: fallbackX, y: fallbackY,
      popoverSize: { width: popoverWidth, height: popoverHeight },
      quadrant,
      reason: "使用备用位置"
    })

    return { x: fallbackX, y: fallbackY }
  }

  getAbsolutePosition(element: Element): AbsoluteRect {
    const rect = element.getBoundingClientRect()
    return {
      left: rect.left + window.scrollX,
      top: rect.top + window.scrollY,
      right: rect.right + window.scrollX,
      bottom: rect.bottom + window.scrollY,
      width: rect.width,
      height: rect.height
    }
  }

  ensureInViewport(x: number, y: number, width: number, height: number): Position {
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const scrollX = window.scrollX
    const scrollY = window.scrollY
    const padding = this.config.viewportPadding

    let adjustedX = x
    if (x - scrollX < padding) adjustedX = scrollX + padding
    else if (x + width - scrollX > viewportWidth - padding) adjustedX = scrollX + viewportWidth - width - padding

    let adjustedY = y
    if (y - scrollY < padding) adjustedY = scrollY + padding
    else if (y + height - scrollY > viewportHeight - padding) adjustedY = scrollY + viewportHeight - height - padding

    return { x: adjustedX, y: adjustedY }
  }

  setConfig(newConfig: Partial<PositioningConfig>): void {
    this.config = { ...this.config, ...newConfig }
  }
}

export const Positioning = new PositioningManager()

export default Positioning
