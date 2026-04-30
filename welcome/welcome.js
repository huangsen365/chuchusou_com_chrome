(function () {
  // YouTube 缩略图加载失败时（如用户网络无法访问 img.youtube.com）
  // 隐藏 broken image 占位，露出 CSS 的深色渐变背景 + 红色播放按钮
  const videoThumb = document.getElementById('videoThumb');
  if (videoThumb) {
    videoThumb.addEventListener('error', () => {
      videoThumb.style.display = 'none';
    });
  }

  const btn = document.getElementById('openSidePanelBtn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '正在打开...';

    try {
      const win = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: win.id });
      btn.textContent = '✓ 已打开侧边栏';
    } catch (e) {
      console.warn('[welcome] open side panel failed:', e);
      btn.textContent = '⚠️ 打开失败，请用 Chrome 右上角侧边栏按钮';
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = originalText;
      }, 4000);
    }
  });
})();
