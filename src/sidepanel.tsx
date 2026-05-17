/**
 * Plasmo sidepanel entry —— 真实 sidepanel（替换 sidepanel/sidepanel.html + sidepanel.js 的核心生命周期）
 *
 * 渲染与 legacy sidepanel.html 一致的核心 DOM 结构（含 8 个静态预渲染菜单项），
 * useEffect 时实例化 SidepanelController.init()。
 *
 * 故意保留 legacy 的部分：
 *   - PinnedAction（cover 风格 + ratio 选择，~544 行）由 legacy sidepanel.js 接管 #spPin* DOM
 *   - VoicePanel / VoiceRecognizer（实验性语音功能，~470 行）由 legacy 接管 #spVoice* DOM
 *
 * 这两块在下一会话完整 port 后会移除 legacy 依赖。
 * 当前 manifest 仍指向 legacy sidepanel.html，本 entry 是预备态。
 */

import { useEffect, useRef } from "react"

import SidepanelController from "./sidepanel/SidepanelController"

function SidepanelApp() {
  const initOnceRef = useRef(false)

  useEffect(() => {
    if (initOnceRef.current) return
    initOnceRef.current = true
    const controller = new SidepanelController()
    controller.init().catch((err) => {
      console.error("[触触搜] SidepanelController.init() failed:", err)
    })
  }, [])

  return (
    <div className="sp-container">
      <header className="sp-header">
        <div className="sp-header-row">
          <span className="sp-title-icon">🔍</span>
          <span className="sp-title">触触搜</span>
          <div className="sp-keyword-wrap">
            <span className="sp-keyword" id="spKeyword"></span>
            <button
              className="sp-keyword-copy"
              id="spKeywordCopy"
              type="button"
              title="复制关键字到剪贴板"
              aria-label="复制关键字"
              hidden>
              📋
            </button>
            <button
              className="sp-keyword-voice"
              id="spKeywordVoice"
              type="button"
              title="🎤 通过语音说出引擎名（实验性）"
              aria-label="语音输入"
              hidden>
              🎤
            </button>
          </div>
        </div>
        <button className="sp-clipboard-btn" id="spClipboardBtn" type="button" hidden>
          📋 从剪贴板读取关键字
        </button>
      </header>

      <main className="sp-main">
        {/* PinnedAction 区域 - 仍由 legacy sidepanel.js 接管 */}
        <section className="sp-pin" id="spPin" hidden>
          <span className="sp-pin-corner-ratio" id="spPinRatio" title="当前画面比例"></span>
          <button className="sp-pin-action" id="spPinAction" type="button">
            <span className="sp-pin-icon">🎨</span>
            <span className="sp-pin-text">
              <span className="sp-pin-task">封面生成器</span>
              <span className="sp-pin-style" id="spPinStyle"></span>
            </span>
            <span className="sp-pin-task-info" id="spPinTaskInfo" role="button" tabIndex={0} aria-expanded="false">ⓘ</span>
          </button>
          <button className="sp-pin-edit" id="spPinEdit" type="button" title="编辑置顶风格">✏️</button>
          <div className="sp-pin-task-popover" id="spPinTaskPopover" hidden></div>
        </section>

        <div className="sp-menu" id="spMenu">
          {/* 8 个静态预渲染菜单项（与 popup 同步，v1.6.16 优化） */}
          <div className="sp-menu-item" data-menu-id="ccs-fastqa-chatgpt-quick" data-menu-type="fastqa-quick" data-engine-id="chatgpt">
            <span className="sp-item-icon">🤖</span>
            <span className="sp-item-title">速答 · ChatGPT</span>
          </div>
          <div className="sp-menu-item" data-menu-id="ccs-fastqa-claude-quick" data-menu-type="fastqa-quick" data-engine-id="claude">
            <span className="sp-item-icon">🧠</span>
            <span className="sp-item-title">速答 · Claude</span>
          </div>
          <div className="sp-menu-separator"></div>
          <div className="sp-menu-item" data-menu-id="ccs-baidu" data-menu-type="search" data-url-pattern="https://www.baidu.com/s?wd=${KEYWORD}">
            <span className="sp-item-icon">🐼</span>
            <span className="sp-item-title">百度搜索</span>
          </div>
          <div className="sp-menu-item" data-menu-id="ccs-google" data-menu-type="search" data-url-pattern="https://www.google.com/search?q=${KEYWORD}">
            <span className="sp-item-icon">🔎</span>
            <span className="sp-item-title">Google 搜索</span>
          </div>
          <div className="sp-menu-separator"></div>
          <div className="sp-menu-item" data-menu-id="ccs-chatgpt" data-menu-type="ai-chat" data-url-pattern="https://chatgpt.com/?q=${KEYWORD}">
            <span className="sp-item-icon">🤖</span>
            <span className="sp-item-title">ChatGPT</span>
          </div>
          <div className="sp-menu-item" data-menu-id="ccs-claude" data-menu-type="ai-chat" data-url-pattern="https://claude.ai/new?q=${KEYWORD}">
            <span className="sp-item-icon">🧠</span>
            <span className="sp-item-title">Claude</span>
          </div>
          <div className="sp-menu-item" data-menu-id="ccs-google-ai-chat" data-menu-type="ai-chat" data-url-pattern="https://www.google.com/search?udm=50&ie=UTF-8&oe=UTF-8&q=${KEYWORD}">
            <span className="sp-item-icon">✨</span>
            <span className="sp-item-title">Google AI 模式</span>
          </div>
          <div className="sp-menu-separator"></div>
          <div className="sp-menu-item" data-menu-id="ccs-google-translate" data-menu-type="translate" data-url-pattern="https://translate.google.com/?sl=auto&tl=zh-CN&text=${KEYWORD}">
            <span className="sp-item-icon">🔁</span>
            <span className="sp-item-title">Google 翻译</span>
          </div>
        </div>

        {/* 内置风格成员库入口（legacy sidepanel.js 绑定） */}
        <div className="sp-stanley-section">
          <a className="sp-stanley-entry" data-group="stanleyFriends" href="#">
            🧑‍🤝‍🧑 Stanley 和他的朋友们
          </a>
          <a className="sp-stanley-entry" data-group="herName" href="#">
            🌸 HerName
          </a>
        </div>
      </main>
    </div>
  )
}

export default SidepanelApp
