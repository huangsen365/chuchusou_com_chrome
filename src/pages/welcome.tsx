/**
 * Plasmo page: welcome.html (欢迎页)
 *
 * Phase 7 第二个 Plasmo entry。React 化 welcome 页，并接入：
 *  - 跑马灯（JS transform，避免 Windows CSS marquee 卡顿）
 *  - YouTube 缩略图 broken image 回退
 *  - 侧边栏开关按钮 + welcome-watcher port 实时同步
 *
 * 内容与 legacy welcome/welcome.html + welcome.js 等价。
 * 不替换生产 welcome.html；生产仍由 build.sh 复制 legacy。
 */

import { useEffect, useRef, useState } from "react"

const SIDE_PANEL_OPEN_TEXT = "📕 关闭侧边栏"
const SIDE_PANEL_CLOSED_TEXT = "✨ 立即打开侧边栏"

function useMarquee(viewportRef: React.RefObject<HTMLElement | null>, textRef: React.RefObject<HTMLElement | null>, speed = 44): void {
  useEffect(() => {
    const viewport = viewportRef.current
    const text = textRef.current
    if (!viewport || !text) return

    let viewportWidth = 0
    let textWidth = 0
    let distance = 1
    let offset = 0
    let lastTime = performance.now()
    let raf = 0

    text.style.animation = "none"
    text.style.paddingLeft = "0"

    const measure = () => {
      viewportWidth = Math.ceil(viewport.getBoundingClientRect().width)
      textWidth = Math.ceil(text.scrollWidth || text.getBoundingClientRect().width)
      distance = Math.max(1, viewportWidth + textWidth)
      offset %= distance
    }

    const tick = (now: number) => {
      if (viewportWidth <= 0 || textWidth <= 0) measure()
      const delta = Math.min(now - lastTime, 100)
      offset = (offset + (delta * speed) / 1000) % distance
      lastTime = now
      text.style.transform = `translateX(${Math.round(viewportWidth - offset)}px)`
      raf = requestAnimationFrame(tick)
    }

    measure()
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure)
      observer.observe(viewport)
    } else {
      window.addEventListener("resize", measure)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      observer?.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [viewportRef, textRef, speed])
}

function useSidePanelToggle() {
  const [isOpen, setIsOpen] = useState(false)
  const [windowId, setWindowId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const portRef = useRef<chrome.runtime.Port | null>(null)

  useEffect(() => {
    let cancelled = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const connectWatcher = (winId: number) => {
      try {
        const port = chrome.runtime.connect({ name: "welcome-watcher" })
        portRef.current = port
        port.postMessage({ windowId: winId })
        port.onMessage.addListener((msg: { action?: string; isOpen?: boolean }) => {
          if (msg?.action === "sidePanelStateChanged") {
            setIsOpen(!!msg.isOpen)
          }
        })
        port.onDisconnect.addListener(() => {
          if (cancelled) return
          reconnectTimer = setTimeout(() => connectWatcher(winId), 500)
        })
      } catch (e) {
        console.warn("[welcome] connect watcher failed:", e)
      }
    }

    ;(async () => {
      try {
        const win = await chrome.windows.getCurrent()
        if (cancelled) return
        if (win.id != null) {
          setWindowId(win.id)
          connectWatcher(win.id)
        }
      } catch (e) {
        console.warn("[welcome] get current window failed:", e)
      }
    })()

    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      try { portRef.current?.disconnect() } catch (_) { /* noop */ }
    }
  }, [])

  const toggle = async () => {
    if (windowId === null) return
    setBusy(true)
    try {
      if (isOpen) {
        await chrome.runtime.sendMessage({ action: "closeSidePanel", windowId })
      } else {
        await chrome.sidePanel.open({ windowId })
      }
    } catch (e) {
      console.warn("[welcome] toggle side panel failed:", e)
      setBusy(false)
      return
    }
    // 状态变化等 watcher 推送回来
    setBusy(false)
  }

  return { isOpen, busy, toggle, windowId }
}

function WelcomePage() {
  const viewportRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  useMarquee(viewportRef, textRef)

  const [thumbBroken, setThumbBroken] = useState(false)
  const { isOpen, busy, toggle, windowId } = useSidePanelToggle()

  const sideBtnLabel = busy
    ? isOpen ? "正在关闭..." : "正在打开..."
    : isOpen ? SIDE_PANEL_OPEN_TEXT : SIDE_PANEL_CLOSED_TEXT

  return (
    <>
      <a href="#cover-warning" className="top-marquee" aria-label="封面生成器重要提示，点击查看详情">
        <span className="top-marquee-icon" aria-hidden="true">⚠️</span>
        <span className="top-marquee-viewport" ref={viewportRef}>
          <span className="top-marquee-text" ref={textRef}>
            关于封面生成器，图片生成后，建议截图另存新图再使用，避免被识别为AI产出 · 点击查看详情 →
          </span>
        </span>
      </a>

      <div className="container">
        <header className="welcome-header">
          <span className="welcome-icon">🔍</span>
          <span className="welcome-title">触触搜</span>
        </header>

        <main className="welcome-main">
          <h1 className="welcome-greeting">欢迎使用触触搜！</h1>
          <p className="welcome-tagline">
            选中文本即用 AI 的 Chrome 扩展 —— 基于 ChatGPT Images 2.0 的封面生成器 / 多 AI 速答 / 提示词优化。
          </p>

          <section className="welcome-section">
            <h2 className="welcome-section-title">🎯 四种入口（任选其一）</h2>
            <div className="entry-grid">
              <div className="entry-card entry-card-primary">
                <div className="entry-card-head">
                  <span className="entry-icon">📑</span>
                  <h3>侧边栏 <span className="entry-badge">推荐</span></h3>
                </div>
                <p>最强大的入口，置顶快捷动作 + 完整菜单。</p>
                <button
                  className="entry-cta"
                  id="openSidePanelBtn"
                  onClick={toggle}
                  disabled={busy || windowId === null}>
                  {sideBtnLabel}
                </button>
              </div>

              <div className="entry-card">
                <div className="entry-card-head">
                  <span className="entry-icon">🪟</span>
                  <h3>悬浮面板</h3>
                </div>
                <p>在任意网页选中文本，自动浮出快捷按钮。</p>
              </div>

              <div className="entry-card">
                <div className="entry-card-head">
                  <span className="entry-icon">🖱</span>
                  <h3>右键菜单</h3>
                </div>
                <p>选中文本后右键 → 「触触搜」分类下完整菜单。</p>
              </div>

              <div className="entry-card">
                <div className="entry-card-head">
                  <span className="entry-icon">⚡</span>
                  <h3>Popup 弹窗</h3>
                </div>
                <p>点击 Chrome 工具栏的扩展图标即可。</p>
              </div>
            </div>
          </section>

          <section className="welcome-section">
            <h2 className="welcome-section-title">✨ 主打功能</h2>
            <ul className="feature-list">
              <li><span className="feature-icon">⚡</span><strong>AI 多端速答</strong> —— 一次问遍 ChatGPT / Claude / Grok / 文心一言 / Google AI</li>
              <li><span className="feature-icon">🎨</span><strong>封面生成器</strong> —— 二次元可爱 / 小红书 / 椰树牌 / 极简留白 × ChatGPT Images 2.0</li>
              <li><span className="feature-icon">🧠</span><strong>提示词优化</strong> —— 八种场景模板一键升级</li>
              <li><span className="feature-icon">💯</span><strong>触触搜百问</strong> —— 同主题问遍五大 AI</li>
            </ul>
          </section>

          <section className="welcome-section" id="cover-warning">
            <h2 className="welcome-section-title">⚠️ 封面生成器使用提示</h2>
            <div className="warning-card">
              <p className="warning-headline">关于封面生成器，图片生成后，建议截图另存新图再使用，避免被识别为AI产出</p>
              <p className="warning-body-title">为什么生成图片后要截图另存？</p>
              <ol className="warning-list">
                <li><strong>AI 生成的图片下载时会自带元数据指纹（C2PA 等）</strong>——是 AI 内容的"身份证"，小红书、抖音、视频号等平台可一键识别。</li>
                <li><strong>一旦被打上"AI 生成"标签，账号可能面临：</strong>
                  <ul>
                    <li>流量限流 / 推荐降权</li>
                    <li>强制叠加"AI 生成"水印</li>
                    <li>影响商业合作与账号权重</li>
                  </ul>
                </li>
                <li><strong>截图重新存成新文件，不携带原指纹</strong>——可有效绕过平台的 AI 内容检测。</li>
              </ol>
              <p className="warning-shortcuts">截图快捷键：Mac ⇧⌘4 · Windows ⊞+Shift+S（或任意截图工具）</p>
            </div>
          </section>

          <section className="welcome-section">
            <h2 className="welcome-section-title">🎥 视频教程</h2>
            <a
              href="https://www.youtube.com/watch?v=f5zF4BKfeQU"
              target="_blank"
              rel="noopener noreferrer"
              className="video-card">
              <div className="video-thumbnail-wrap">
                {!thumbBroken && (
                  <img
                    src="https://img.youtube.com/vi/f5zF4BKfeQU/hqdefault.jpg"
                    alt="触触搜视频教程"
                    className="video-thumbnail"
                    onError={() => setThumbBroken(true)}
                  />
                )}
                <div className="video-play-overlay">
                  <span className="video-play-icon" aria-hidden="true">▶</span>
                </div>
              </div>
              <div className="video-meta">
                <div className="video-title">点击观看：触触搜使用教程</div>
                <div className="video-source">YouTube · 在新标签打开</div>
              </div>
            </a>
          </section>

          <section className="welcome-section">
            <h2 className="welcome-section-title">👋 关注作者</h2>
            <a
              href="https://x.com/yunbiyun"
              target="_blank"
              rel="noopener noreferrer"
              className="author-card">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="author-x-icon" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
                />
              </svg>
              <div className="author-info">
                <div className="author-name">云比云</div>
                <div className="author-handle">@yunbiyun · 在 X 上关注</div>
              </div>
              <span className="author-arrow" aria-hidden="true">→</span>
            </a>
          </section>
        </main>

        <footer className="welcome-footer">
          <a href="https://chuchusou.com" target="_blank" rel="noopener noreferrer">了解更多</a>
          <span className="footer-divider">·</span>
          <a href="https://github.com/huangsen365/chuchusou_com_chrome" target="_blank" rel="noopener noreferrer">GitHub</a>
        </footer>
      </div>
    </>
  )
}

export default WelcomePage
