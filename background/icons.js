async function createImageDataFromUrl(url, size) {
  try {
    const cacheKey = `${url}@${size}`;
    if (menuIconImageCache.has(cacheKey)) {
      BG_DBG('[触触搜][BG][ICON] cache hit', cacheKey);
      return menuIconImageCache.get(cacheKey);
    }
    const isExtensionResource = url.startsWith('chrome-extension://');
    const fetchOptions = isExtensionResource ? {} : { mode: 'cors' };
    BG_DBG('[触触搜][BG][ICON] fetching image', { url, size, fetchOptions });
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    const scale = Math.min(size / imageBitmap.width, size / imageBitmap.height, 1);
    const targetWidth = imageBitmap.width * scale;
    const targetHeight = imageBitmap.height * scale;
    const dx = (size - targetWidth) / 2;
    const dy = (size - targetHeight) / 2;
    ctx.drawImage(imageBitmap, dx, dy, targetWidth, targetHeight);
    const imageData = ctx.getImageData(0, 0, size, size);
    BG_DBG('[触触搜][BG][ICON] image processed', { url, size, scale });
    menuIconImageCache.set(cacheKey, imageData);
    return imageData;
  } catch (error) {
    console.warn('[触触搜][BG] 无法加载远程图标:', url, error);
    return null;
  }
}

async function resolveMenuIconTargets(iconConfig) {
  if (!iconConfig) return null;
  const size = Number.isFinite(iconConfig.size) ? iconConfig.size : (menuIconConfig?.defaultSize || 16);
  BG_DBG('[触触搜][BG][ICON] resolveMenuIconTargets', { iconConfig, size });
  if (iconConfig.localPath) {
    const localUrl = chrome.runtime.getURL(iconConfig.localPath);
    const localImageData = await createImageDataFromUrl(localUrl, size);
    if (localImageData) {
      BG_DBG('[触触搜][BG][ICON] using local image data', { localUrl, size });
      return { [size]: localImageData };
    }
    console.warn('[触触搜][BG] 本地图标加载失败，尝试远程图标:', iconConfig.localPath);
  }
  if (iconConfig.remoteUrl) {
    const imageData = await createImageDataFromUrl(iconConfig.remoteUrl, size);
    if (imageData) {
      BG_DBG('[触触搜][BG][ICON] using remote image data', { url: iconConfig.remoteUrl, size });
      return { [size]: imageData };
    }
  }
  return null;
}

async function applyMenuIcons(buildId) {
  if (menuIconUpdateInProgress) {
    logMenuEvent('icon-skip', { reason: 'update-in-progress' });
    return;
  }
  menuIconUpdateInProgress = true;
  await ensureMenuIconSupportLoaded();
  if (!menuIconUpdateSupported) {
    logMenuEvent('icon-skip', { reason: 'unsupported' });
    menuIconUpdateInProgress = false;
    return;
  }
  const config = await loadMenuIconConfig();
  if (buildId !== menuBuildCounter) {
    menuIconUpdateInProgress = false;
    return;
  }
  if (!config?.items) {
    menuIconUpdateInProgress = false;
    return;
  }
  const itemEntries = Object.entries(config.items);
  if (!itemEntries.length) {
    menuIconUpdateInProgress = false;
    return;
  }
  BG_DBG('[触触搜][BG][ICON] applying menu icons', { buildId, items: Object.keys(config.items || {}) });
  for (const [menuId, iconCfg] of itemEntries) {
    if (!menuIconUpdateSupported) {
      logMenuEvent('icon-abort', { reason: 'unsupported-detected-during-update' });
      break;
    }
    try {
      if (!isMenuEnabled(menuId)) continue;
      const icons = await resolveMenuIconTargets(iconCfg);
      if (!icons || buildId !== menuBuildCounter) continue;
      if (!menuIconUpdateSupported) break;
      BG_DBG('[触触搜][BG][ICON] updating menu icon', { menuId, icons: Object.keys(icons) });
      await new Promise((resolve) => {
        chrome.contextMenus.update(menuId, { icons }, () => {
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message || '';
            console.warn('[触触搜][BG] 更新菜单图标失败:', menuId, msg);
            logMenuEvent('icon-update-error', { menuId, message: msg });
            if (/Unexpected property: 'icons'/i.test(msg)) {
              if (menuIconUpdateSupported) {
                menuIconUpdateSupported = false;
                menuIconSupportLoaded = true;
                chrome.storage.local.set({ [MENU_ICON_SUPPORT_STORAGE_KEY]: false });
              }
              logMenuEvent('icon-disable', { reason: msg });
            }
          } else {
            BG_DBG('[触触搜][BG][ICON] menu icon applied', menuId);
          }
          resolve();
        });
      });
      if (!menuIconUpdateSupported) {
        logMenuEvent('icon-abort', { reason: 'unsupported-after-update', menuId });
        break;
      }
    } catch (error) {
      const message = error?.message || String(error);
      console.warn('[触触搜][BG] 处理菜单图标失败:', menuId, message);
      if (/Unexpected property: 'icons'/i.test(message)) {
        if (menuIconUpdateSupported) {
          menuIconUpdateSupported = false;
          menuIconSupportLoaded = true;
          chrome.storage.local.set({ [MENU_ICON_SUPPORT_STORAGE_KEY]: false });
        }
        logMenuEvent('icon-disable', { reason: message, source: 'throw' });
        break;
      }
    }
  }
  menuIconUpdateInProgress = false;
}
