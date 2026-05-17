/**
 * Plasmo popup entry — 真实 popup（替换 popup/popup.html + popup/popup.js）
 *
 * 渲染与 legacy popup.html 完全一致的 HTML 结构（含 8 个静态预渲染菜单项，
 * 与 v1.6.16 优化保持一致：HTML 解析完就立刻可见可点），
 * 然后用 PopupController 接管完整生命周期。
 *
 * 不替换生产 manifest 入口；生产 popup.html 仍由 build.sh 复制 legacy。
 * 等 Chrome 真机验证完成后，把 manifest action.default_popup 切到此 entry 即可。
 */

import { useEffect, useRef } from "react"

import PopupController from "./popup/PopupController"

function PopupApp() {
  const containerRef = useRef<HTMLDivElement>(null)
  const initOnceRef = useRef(false)

  useEffect(() => {
    if (initOnceRef.current) return
    initOnceRef.current = true
    const controller = new PopupController()
    controller.init().catch((err) => {
      console.error("[触触搜] PopupController.init() failed:", err)
    })
  }, [])

  return (
    <div ref={containerRef} className="ccs-popup-menu">
      <header className="menu-header">
        <div className="header-left">
          <span className="menu-icon">🔍</span>
          <span className="menu-title">触触搜</span>
        </div>
        <div className="menu-keyword-wrap">
          <span className="menu-keyword" id="currentKeyword" title=""></span>
          <button
            className="menu-keyword-copy"
            id="currentKeywordCopy"
            type="button"
            title="复制关键字到剪贴板"
            aria-label="复制关键字到剪贴板"
            hidden>
            📋
          </button>
        </div>
      </header>

      <section className="popup-pin" id="popupPin" hidden>
        <span className="popup-pin-corner-ratio" id="popupPinRatio" title="当前画面比例"></span>
        <button
          className="popup-pin-action"
          id="popupPinAction"
          type="button"
          title="用当前置顶风格 + 关键字一键生成封面">
          <span className="popup-pin-icon">🎨</span>
          <span className="popup-pin-text">
            <span className="popup-pin-task">封面生成器</span>
            <span className="popup-pin-style" id="popupPinStyle"></span>
          </span>
        </button>
        <button
          className="popup-pin-hint"
          id="popupPinOpenSidepanel"
          type="button"
          title="到侧边栏切换风格 / 比例 / 自定义预设">
          📑 改风格 / 比例 → 侧边栏
        </button>
      </section>

      <div className="menu-container" id="menuContainer">
        <div className="menu-item" data-menu-id="ccs-fastqa-chatgpt-quick" data-menu-type="fastqa-quick" data-engine-id="chatgpt">
          <span className="item-icon">🤖</span>
          <span className="item-title">速答 · ChatGPT</span>
        </div>
        <div className="menu-item" data-menu-id="ccs-fastqa-claude-quick" data-menu-type="fastqa-quick" data-engine-id="claude">
          <span className="item-icon">🧠</span>
          <span className="item-title">速答 · Claude</span>
        </div>
        <div className="menu-separator"></div>
        <div className="menu-item" data-menu-id="ccs-baidu" data-menu-type="search" data-url-pattern="https://www.baidu.com/s?wd=${KEYWORD}">
          <span className="item-icon">🐼</span>
          <span className="item-title">百度搜索</span>
        </div>
        <div className="menu-item" data-menu-id="ccs-google" data-menu-type="search" data-url-pattern="https://www.google.com/search?q=${KEYWORD}">
          <span className="item-icon">🔎</span>
          <span className="item-title">Google 搜索</span>
        </div>
        <div className="menu-separator"></div>
        <div className="menu-item" data-menu-id="ccs-chatgpt" data-menu-type="ai-chat" data-url-pattern="https://chatgpt.com/?q=${KEYWORD}">
          <span className="item-icon">🤖</span>
          <span className="item-title">ChatGPT</span>
        </div>
        <div className="menu-item" data-menu-id="ccs-claude" data-menu-type="ai-chat" data-url-pattern="https://claude.ai/new?q=${KEYWORD}">
          <span className="item-icon">🧠</span>
          <span className="item-title">Claude</span>
        </div>
        <div className="menu-item" data-menu-id="ccs-google-ai-chat" data-menu-type="ai-chat" data-url-pattern="https://www.google.com/search?udm=50&ie=UTF-8&oe=UTF-8&q=${KEYWORD}">
          <span className="item-icon">✨</span>
          <span className="item-title">Google AI 模式</span>
        </div>
        <div className="menu-separator"></div>
        <div className="menu-item" data-menu-id="ccs-google-translate" data-menu-type="translate" data-url-pattern="https://translate.google.com/?sl=auto&tl=zh-CN&text=${KEYWORD}">
          <span className="item-icon">🔁</span>
          <span className="item-title">Google 翻译</span>
        </div>
      </div>

      <div className="settings-panel" id="settingsPanel" style={{ display: "none" }}>
        <div className="settings-header">
          <button className="back-to-menu" id="backToMenu">← 返回菜单</button>
        </div>
        <div className="settings-content">
          <div className="settings-grid">
            <button className="setting-btn" data-action="toggle">
              <span className="setting-icon">⚡</span>
              <span className="setting-label">启用/禁用</span>
            </button>
            <button className="setting-btn" data-action="blacklist">
              <span className="setting-icon">🚫</span>
              <span className="setting-label">黑名单管理</span>
            </button>
            <button className="setting-btn" data-action="debug">
              <span className="setting-icon">🐞</span>
              <span className="setting-label">调试日志：关</span>
            </button>
            <button className="setting-btn" data-action="voice" title="实验性功能：通过语音说出引擎名快速搜索（默认关）">
              <span className="setting-badge">BETA</span>
              <span className="setting-icon">🎤</span>
              <span className="setting-label">语音功能：关</span>
            </button>
            <button className="setting-btn" data-action="export-menu-state">
              <span className="setting-icon">📋</span>
              <span className="setting-label">导出菜单状态</span>
            </button>
            <button className="setting-btn" data-action="shortcut-settings">
              <span className="setting-icon">⌨️</span>
              <span className="setting-label">快捷键设置</span>
            </button>
            <button className="setting-btn" data-action="prompt-library">
              <span className="setting-icon">📚</span>
              <span className="setting-label">提示词库</span>
            </button>
            <button className="setting-btn" data-action="open-welcome">
              <span className="setting-icon">📖</span>
              <span className="setting-label">查看欢迎页</span>
            </button>
          </div>

          <div className="blacklist-section" id="blacklistSection" style={{ display: "none" }}>
            <h3>黑名单管理</h3>
            <div className="blacklist-info">
              <p>已屏蔽 <span className="blacklist-count">0</span> 个网站</p>
              <button className="clear-blacklist">清空全部</button>
            </div>
            <div className="blacklist-list"></div>
            <div className="blacklist-tips">
              恢复：<kbd>Alt+右键</kbd> / <kbd>Alt+S</kbd>
            </div>
          </div>

          <div className="shortcut-settings-section" id="shortcutSection" style={{ display: "none" }}>
            <h3>快捷键设置</h3>
            <div className="shortcut-settings">
              <label>切换面板快捷键：</label>
              <select className="shortcut-key-select" defaultValue="Alt+S">
                <option value="Alt+S">Alt+S（默认）</option>
                <option value="Ctrl+Shift+S">Ctrl+Shift+S</option>
                <option value="Alt+Shift+S">Alt+Shift+S</option>
                <option value="Ctrl+Alt+S">Ctrl+Alt+S</option>
                <option value="Alt+Q">Alt+Q</option>
                <option value="Alt+E">Alt+E</option>
              </select>
            </div>
            <button className="save-shortcut">保存设置</button>
          </div>

          <div className="prompt-library-section" id="promptLibrarySection" style={{ display: "none" }}>
            <h3>提示词库</h3>
            <div className="prompt-library-header">
              <p>已保存 <span className="prompt-count">0</span> 个提示词</p>
              <button className="add-prompt-btn">+ 新建</button>
            </div>
            <div className="prompt-list"></div>
            <div className="prompt-library-tips">
              点击提示词复制到剪贴板，跨设备自动同步
            </div>
          </div>

          <div className="menu-debug-section" id="debugSection" style={{ display: "none" }}>
            <h3>菜单状态调试</h3>
            <div className="menu-debug-info">
              <button className="copy-debug-info">复制到剪贴板</button>
              <button className="close-debug-info">关闭</button>
            </div>
            <div className="menu-debug-content">
              <pre className="menu-debug-text"></pre>
            </div>
          </div>

          <div className="version-info">
            <span className="version-label">版本</span>
            <span className="version-number" id="versionNumber">v1.1.1</span>
          </div>
        </div>
      </div>

      <footer className="menu-footer">
        <button className="settings-toggle" id="settingsToggle">⚙️ 设置</button>
        <button className="panel-toggle" id="openSidePanel">📑 打开侧边栏</button>
        <a href="https://chuchusou.com" target="_blank" rel="noopener noreferrer" className="footer-link">chuchusou.com</a>
      </footer>

      <div className="prompt-modal" id="promptModal" style={{ display: "none" }}>
        <div className="prompt-modal-content">
          <h4 id="promptModalTitle">新建提示词</h4>
          <div className="prompt-form">
            <label>
              名称
              <input type="text" id="promptNameInput" maxLength={50} placeholder="提示词名称" />
            </label>
            <label>
              内容
              <textarea id="promptContentInput" maxLength={2000} rows={5} placeholder="提示词内容"></textarea>
              <span className="prompt-char-count">0/2000</span>
            </label>
          </div>
          <div className="prompt-modal-actions">
            <button className="prompt-modal-cancel">取消</button>
            <button className="prompt-modal-save">保存</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PopupApp
