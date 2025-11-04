function createContextMenus() {
  if (menuBuildInProgress) {
    menuBuildPending = true;
    logMenuEvent('rebuild-queued', {});
    return;
  }
  menuBuildInProgress = true;
  const buildId = ++menuBuildCounter;
  // 清除所有现有菜单
  chrome.contextMenus.removeAll(async () => {
    const finalizeMenuBuild = () => {
      if (!menuBuildInProgress) return;
      menuBuildInProgress = false;
      if (menuBuildPending) {
        menuBuildPending = false;
        createContextMenus();
      }
    };
    if (buildId !== menuBuildCounter) {
      finalizeMenuBuild();
      return;
    }
    await loadMenuToggleConfig();
    BG_DBG('[触触搜][BG][MENU] rebuilding context menus', { buildId });
    optimizedPromptMenuMap.clear();
    logMenuEvent('rebuild-start', { buildId });
    
    // 创建主菜单 - 对选中文本和页面都生效
    chrome.contextMenus.create({
      id: 'ccs-main',
      title: '🔍 触触搜',
      contexts: ['selection', 'page']
    }, () => {
      if (chrome.runtime.lastError) {
        logMenuEvent('create-main-failed', { error: chrome.runtime.lastError.message });
      }
    });

    topQuestionsMenuMap.clear();
    fastAnswersMenuMap.clear();
    quickMenuState.forEach((state) => { state.registered = false; });

    const top100RootEnabled = isMenuEnabled('ccs-top100-root');
    const top100OpenAllEnabled = top100RootEnabled && isMenuEnabled('ccs-top100-open-all');
    const quickEnabledMap = new Map(FAST_QA_QUICK_ITEMS.map((item) => [item.id, isMenuEnabled(item.id)]));
    const fastQaRootEnabled = isMenuEnabled('ccs-fastqa-root');
    const fastQaOpenAllEnabled = fastQaRootEnabled && isMenuEnabled('ccs-fastqa-open-all');
    const optimizeRootEnabled = isMenuEnabled('ccs-optimize-root');
    const hasAdvancedSections = top100RootEnabled || fastQaRootEnabled || optimizeRootEnabled;
    const needsFastAnswersConfig = fastQaRootEnabled || FAST_QA_QUICK_ITEMS.some((item) => quickEnabledMap.get(item.id));
    logMenuEvent('toggle-status', {
      top100RootEnabled,
      top100OpenAllEnabled,
      quickEnabled: Object.fromEntries(quickEnabledMap.entries()),
      fastQaRootEnabled,
      fastQaOpenAllEnabled,
      optimizeRootEnabled,
      hasAdvancedSections,
      needsFastAnswersConfig
    });

    // 创建标签项（不可点击，仅显示）
  chrome.contextMenus.create({
    id: 'ccs-label',
    parentId: 'ccs-main',
    title: getMenuTitle('ccs-label', '触触搜'),
    enabled: false,  // 禁用使其不可点击
    contexts: ['selection', 'page']
  });

  FAST_QA_QUICK_ITEMS.forEach((item) => {
    if (!quickEnabledMap.get(item.id)) {
      return;
    }
    chrome.contextMenus.create({
      id: item.id,
      parentId: 'ccs-main',
      title: getMenuTitle(item.id, MENU_FALLBACK_TITLES[item.id]),
      contexts: ['selection', 'page', 'editable']
    }, () => {
      if (chrome.runtime.lastError) {
        logMenuEvent('fastqa-quick-child-create-failed', { id: item.id, error: chrome.runtime.lastError.message });
      } else {
        const state = quickMenuState.get(item.id);
        if (state) state.registered = true;
        updateFastQaQuickTitle(currentMenuState.display);
        logMenuEvent('fastqa-quick-child-created', { id: item.id });
      }
    });
  });

  chrome.contextMenus.create({
    id: 'ccs-separator-0',
    parentId: 'ccs-main',
    type: 'separator',
    contexts: ['selection', 'page']
  });
  updateMainMenuTitle(currentMenuState.display);
  updateFastQaQuickTitle(currentMenuState.display);

    // 创建子菜单项
    const aiMenuItems = [
      'ccs-chatgpt',
      'ccs-claude'
    ];

    aiMenuItems.forEach((menuId) => {
      if (!isMenuEnabled(menuId)) return;
      chrome.contextMenus.create({
        id: menuId,
        parentId: 'ccs-main',
        title: getMenuTitle(menuId, MENU_FALLBACK_TITLES[menuId]),
        contexts: ['selection', 'page']
      });
    });

    chrome.contextMenus.create({
      id: 'ccs-separator-ai',
      parentId: 'ccs-main',
      type: 'separator',
      contexts: ['selection', 'page']
    });

    const baseMenuItems = [
      'ccs-baidu',
      'ccs-google',
      // 'ccs-baidu-translate',
      'ccs-yiyan',
      'ccs-zhihu',
      'ccs-weixin',
      'ccs-taobao',
      'ccs-jd',
      'ccs-sov2ex',
      'ccs-google-translate',
      'ccs-chuchusou'
    ];

    baseMenuItems.forEach((menuId) => {
      if (!isMenuEnabled(menuId)) return;
      chrome.contextMenus.create({
        id: menuId,
        parentId: 'ccs-main',
        title: getMenuTitle(menuId, MENU_FALLBACK_TITLES[menuId]),
        contexts: ['selection', 'page']
      });
    });
    BG_DBG('[触触搜][BG][MENU] base search items created');

    const asyncTasks = [];

    if (hasAdvancedSections) {
      chrome.contextMenus.create({
        id: 'ccs-separator-optimized',
        parentId: 'ccs-main',
        type: 'separator',
        contexts: ['selection', 'page']
      });
    }

    if (top100RootEnabled) {
      chrome.contextMenus.create({
        id: 'ccs-top100-root',
        parentId: 'ccs-main',
        title: getMenuTitle('ccs-top100-root', '触触搜百问'),
        contexts: ['selection', 'page']
      });

      if (top100OpenAllEnabled) {
        chrome.contextMenus.create({
          id: 'ccs-top100-open-all',
          parentId: 'ccs-top100-root',
          title: getMenuTitle('ccs-top100-open-all', '打开以下全部'),
          contexts: ['selection', 'page']
        });
      }

      chrome.contextMenus.create({
        id: 'ccs-top100-separator',
        parentId: 'ccs-top100-root',
        type: 'separator',
        contexts: ['selection', 'page']
      });

      const topQuestionsTask = loadTopQuestionsConfig()
        .then((config) => {
          if (buildId !== menuBuildCounter) {
            return;
          }
          if (!config) return;
          (config.engines || []).forEach((engine) => {
            const menuId = `ccs-top100-${engine.id}`;
            if (!isMenuEnabled(menuId)) return;
            const engineTitle = TOP_QUESTION_ENGINE_TITLES[engine.id] || engine.label;
            chrome.contextMenus.create({
              id: menuId,
              parentId: 'ccs-top100-root',
              title: engineTitle,
              contexts: ['selection', 'page']
            });
            topQuestionsMenuMap.set(menuId, {
              urlPattern: engine.urlPattern || ''
            });
          });
        })
        .catch((error) => {
          console.warn('[触触搜][BG] 无法构建触触搜百问菜单:', error);
        });
      asyncTasks.push(topQuestionsTask);
    }

    let fastAnswersTask = null;
    if (fastQaRootEnabled) {
      chrome.contextMenus.create({
        id: 'ccs-fastqa-root',
        parentId: 'ccs-main',
        title: getMenuTitle('ccs-fastqa-root', '速答壹拾佰'),
        contexts: ['selection', 'page']
      });

      if (fastQaOpenAllEnabled) {
        chrome.contextMenus.create({
          id: 'ccs-fastqa-open-all',
          parentId: 'ccs-fastqa-root',
          title: getMenuTitle('ccs-fastqa-open-all', '打开以下全部'),
          contexts: ['selection', 'page']
        });
      }

      chrome.contextMenus.create({
        id: 'ccs-fastqa-separator',
        parentId: 'ccs-fastqa-root',
        type: 'separator',
        contexts: ['selection', 'page']
      });
    }

    if (needsFastAnswersConfig) {
      fastAnswersTask = loadFastAnswersConfig()
        .then((config) => {
          if (buildId !== menuBuildCounter) {
            return;
          }
          if (!config) return;
          logMenuEvent('fastqa-config-loaded', {
            engines: (config.engines || []).map((engine) => ({
              id: engine?.id,
              enabled: isMenuEnabled(`ccs-fastqa-${engine?.id}`),
              quickTargets: FAST_QA_QUICK_ITEMS
                .filter((item) => item.engineId === engine?.id && quickEnabledMap.get(item.id))
                .map((item) => item.id)
            }))
          });
          (config.engines || []).forEach((engine) => {
            const menuId = `ccs-fastqa-${engine.id}`;
            const urlPattern = engine.urlPattern || '';
            if (fastQaRootEnabled && isMenuEnabled(menuId)) {
              const engineTitle = FAST_ANSWER_ENGINE_TITLES[engine.id] || engine.label;
              chrome.contextMenus.create({
                id: menuId,
                parentId: 'ccs-fastqa-root',
                title: engineTitle,
                contexts: ['selection', 'page']
              });
              fastAnswersMenuMap.set(menuId, { urlPattern });
            }
            FAST_QA_QUICK_ITEMS.forEach((item) => {
              if (item.engineId !== engine.id) return;
              if (!quickEnabledMap.get(item.id)) return;
              fastAnswersMenuMap.set(item.id, { urlPattern });
              logMenuEvent('fastqa-quick-url-ready', { id: item.id, urlPattern });
              updateFastQaQuickTitle(currentMenuState.display);
            });
          });
        })
        .catch((error) => {
          console.warn('[触触搜][BG] 无法构建速答壹拾佰菜单:', error);
          logMenuEvent('fastqa-config-error', { error: error?.message || String(error) });
        });
      asyncTasks.push(fastAnswersTask);
    }

    if (optimizeRootEnabled) {
      chrome.contextMenus.create({
        id: 'ccs-optimize-root',
        parentId: 'ccs-main',
        title: '🧠 优化提示词',
        contexts: ['selection', 'page']
      });

      // 动态加载优化提示词菜单
      const optimizeTask = loadOptimizedPromptConfig()
        .then((config) => {
          if (buildId !== menuBuildCounter) {
            return;
          }
          if (!config) return;
          populateOptimizedMenuMap(config);
          (config.categories || []).forEach((category) => {
            const categoryId = `ccs-optimize-${category.id}`;
            if (!isMenuEnabled(categoryId)) return;
            const categoryTitle = OPTIMIZE_CATEGORY_TITLES[category.id] || category.label;
            chrome.contextMenus.create({
              id: categoryId,
              parentId: 'ccs-optimize-root',
              title: categoryTitle,
              contexts: ['selection', 'page']
            });

            (category.engines || []).forEach((engine) => {
              const menuId = `ccs-optimize-${category.id}-${engine.id}`;
              if (!isMenuEnabled(menuId)) return;
              const engineTitle = OPTIMIZE_ENGINE_TITLES[engine.id] || engine.label;
              chrome.contextMenus.create({
                id: menuId,
                parentId: categoryId,
                title: engineTitle,
                contexts: ['selection', 'page']
              });
              BG_DBG('[触触搜][BG][MENU] optimize submenu created', { menuId });
            });
          });
        })
        .catch((error) => {
          console.warn('[触触搜][BG] 无法构建优化提示词菜单:', error);
        });
      asyncTasks.push(optimizeTask);
    }

    Promise.all(asyncTasks)
      .finally(() => {
        BG_DBG('[触触搜][BG][MENU] applying icons', { buildId });
        applyMenuIcons(buildId).catch((err) => {
          console.warn('[触触搜][BG] 无法应用菜单图标:', err);
        });
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (!Array.isArray(tabs) || !tabs[0]) return;
          refreshMenuTitle(tabs[0]).catch((err) => {
            console.warn('[触触搜][BG] 初始化菜单标题失败:', err);
            logMenuEvent('initial-title-error', { error: err?.message || String(err) });
          });
        });
        logMenuEvent('rebuild-complete', { buildId });
        finalizeMenuBuild();
      });

    chrome.contextMenus.create({
      id: 'ccs-separator-1',
      parentId: 'ccs-main',
      type: 'separator',
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-copy',
      parentId: 'ccs-main',
      title: getMenuTitle('ccs-copy', '复制文本'),
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-base64',
      parentId: 'ccs-main',
      title: getMenuTitle('ccs-base64', 'Base64编码'),
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-md5',
      parentId: 'ccs-main',
      title: getMenuTitle('ccs-md5', 'MD5哈希'),
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-url-encode',
      parentId: 'ccs-main',
      title: getMenuTitle('ccs-url-encode', 'URL编码'),
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-separator-2',
      parentId: 'ccs-main',
      type: 'separator',
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-upper',
      parentId: 'ccs-main',
      title: getMenuTitle('ccs-upper', '转换为大写'),
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-lower',
      parentId: 'ccs-main',
      title: getMenuTitle('ccs-lower', '转换为小写'),
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-separator-3',
      parentId: 'ccs-main',
      type: 'separator',
      contexts: ['selection', 'page']
    });

    chrome.contextMenus.create({
      id: 'ccs-show-popover',
      parentId: 'ccs-main',
      title: getMenuTitle('ccs-show-popover', '打开触触搜面板 (Alt+S)'),
      contexts: ['selection', 'page']
    });
  });
}
