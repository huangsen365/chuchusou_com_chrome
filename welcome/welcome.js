(function () {
  // Use JS transforms instead of CSS marquee; Windows can disable/freeze CSS animation here.
  function setupMarquee(viewportSelector, textSelector, options = {}) {
    const viewport = document.querySelector(viewportSelector);
    const text = document.querySelector(textSelector);
    if (!viewport || !text) return;

    const speed = options.speed || 44;
    let viewportWidth = 0;
    let textWidth = 0;
    let distance = 1;
    let offset = 0;
    let lastTime = performance.now();

    text.style.animation = 'none';
    text.style.paddingLeft = '0';

    const measure = () => {
      viewportWidth = Math.ceil(viewport.getBoundingClientRect().width);
      textWidth = Math.ceil(text.scrollWidth || text.getBoundingClientRect().width);
      distance = Math.max(1, viewportWidth + textWidth);
      offset %= distance;
    };

    const tick = (now) => {
      if (viewportWidth <= 0 || textWidth <= 0) {
        measure();
      }

      const delta = Math.min(now - lastTime, 100);
      offset = (offset + delta * speed / 1000) % distance;

      lastTime = now;
      text.style.transform = `translateX(${Math.round(viewportWidth - offset)}px)`;
      requestAnimationFrame(tick);
    };

    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(viewport);
      viewport._ccsMarqueeState = { observer };
    } else {
      window.addEventListener('resize', measure);
    }
    window.addEventListener('load', measure, { once: true });
    requestAnimationFrame(tick);
  }

  setupMarquee('.top-marquee-viewport', '.top-marquee-text', { speed: 44 });

  // YouTube 缩略图加载失败时（如用户网络无法访问 img.youtube.com）
  // 隐藏 broken image 占位，露出 CSS 的深色渐变背景 + 红色播放按钮
  const videoThumb = document.getElementById('videoThumb');
  if (videoThumb) {
    videoThumb.addEventListener('error', () => {
      videoThumb.style.display = 'none';
    });
  }

  // 「立即打开侧边栏」按钮——通过 welcome-watcher port 实时同步侧边栏开关状态，
  // 用户从浏览器右上 X 关掉、或从 popup 开关，欢迎页按钮文字立即反映
  const btn = document.getElementById('openSidePanelBtn');
  if (!btn) return;

  let sidePanelIsOpen = false;
  let currentWindowId = null;

  function renderSideBtn() {
    btn.disabled = false;
    btn.textContent = sidePanelIsOpen ? '📕 关闭侧边栏' : '✨ 立即打开侧边栏';
  }

  function connectWatcher() {
    try {
      const port = chrome.runtime.connect({ name: 'welcome-watcher' });
      if (currentWindowId !== null) {
        port.postMessage({ windowId: currentWindowId });
      }
      port.onMessage.addListener((msg) => {
        if (msg && msg.action === 'sidePanelStateChanged') {
          sidePanelIsOpen = !!msg.isOpen;
          renderSideBtn();
        }
      });
      port.onDisconnect.addListener(() => {
        // SW 重启 / 扩展重载，500ms 后重连
        setTimeout(connectWatcher, 500);
      });
    } catch (e) {
      console.warn('[welcome] connect watcher failed:', e);
    }
  }

  (async () => {
    try {
      const win = await chrome.windows.getCurrent();
      currentWindowId = win.id;
    } catch (e) {
      console.warn('[welcome] get current window failed:', e);
      return;
    }
    renderSideBtn();        // 初始按钮文字（关闭态）
    connectWatcher();       // 订阅状态后会立即推送当前真实状态
  })();

  btn.addEventListener('click', async () => {
    if (currentWindowId === null) return;
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = sidePanelIsOpen ? '正在关闭...' : '正在打开...';

    try {
      if (sidePanelIsOpen) {
        await chrome.runtime.sendMessage({
          action: 'closeSidePanel',
          windowId: currentWindowId
        });
      } else {
        await chrome.sidePanel.open({ windowId: currentWindowId });
      }
      // 状态变化会通过 watcher port 推回来自动调 renderSideBtn，不手动改
    } catch (e) {
      console.warn('[welcome] toggle side panel failed:', e);
      btn.textContent = '⚠️ ' + (sidePanelIsOpen ? '关闭失败' : '打开失败');
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = originalText;
      }, 3000);
    }
  });
})();
