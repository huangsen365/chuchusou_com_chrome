const MENU_CONTEXTS_DEFAULT = ['selection', 'page'];
const MENU_CONTEXTS_WITH_EDITABLE = ['selection', 'page', 'editable'];

const FAST_QA_QUICK_ITEM_DEFS = [
  {
    id: 'ccs-fastqa-chatgpt-quick',
    engineId: 'chatgpt',
    titleKey: 'chatgpt',
    menuTitle: '触触搜 · 速答壹拾佰 - ChatGPT',
    menuIcon: '🤖'
  },
  {
    id: 'ccs-fastqa-claude-quick',
    engineId: 'claude',
    titleKey: 'claude',
    menuTitle: '触触搜 · 速答壹拾佰 - Claude',
    menuIcon: '🧠'
  },
  {
    id: 'ccs-fastqa-grok-quick',
    engineId: 'grok',
    titleKey: 'grok',
    menuTitle: '触触搜 · 速答壹拾佰 - Grok',
    menuIcon: '🦊'
  }
];

setFastQaQuickItems(FAST_QA_QUICK_ITEM_DEFS);

const SEARCH_MENU_ITEMS = [
  'ccs-baidu',
  'ccs-google',
  'ccs-tongyi',
  'ccs-yiyan'
];

const AI_MENU_ITEMS = [
  'ccs-chatgpt',
  'ccs-claude'
];

const GENERAL_MENU_ITEMS = [
  'ccs-zhihu',
  'ccs-weixin',
  'ccs-taobao',
  'ccs-jd',
  'ccs-sov2ex',
  'ccs-google-translate',
  'ccs-chuchusou'
];

const TOOL_MENU_ITEMS = [
  'ccs-copy',
  'ccs-base64',
  'ccs-md5',
  'ccs-url-encode'
];

const TRANSFORM_MENU_ITEMS = [
  'ccs-upper',
  'ccs-lower'
];

function extractErrorMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string') return error.message;
  try {
    return JSON.stringify(error);
  } catch (_) {
    return String(error);
  }
}

function createMenuItem(options, meta = {}) {
  const { onSuccess, onError, failureLogStage } = meta;
  return new Promise((resolve) => {
    try {
      chrome.contextMenus.create(options, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          if (failureLogStage && options?.id) {
            logMenuEvent(failureLogStage, {
              id: options.id,
              error: extractErrorMessage(error)
            });
          }
          if (onError) {
            onError(error, options);
          }
          resolve({ ok: false, error });
          return;
        }
        if (onSuccess) {
          onSuccess(options);
        }
        resolve({ ok: true });
      });
    } catch (error) {
      if (failureLogStage && options?.id) {
        logMenuEvent(failureLogStage, {
          id: options.id,
          error: extractErrorMessage(error)
        });
      }
      if (onError) {
        onError(error, options);
      }
      resolve({ ok: false, error });
    }
  });
}

async function removeAllContextMenus() {
  if (typeof chrome?.contextMenus?.removeAll !== 'function') {
    return;
  }
  if (chrome.contextMenus.removeAll.length === 0) {
    await chrome.contextMenus.removeAll();
    return;
  }
  await new Promise((resolve, reject) => {
    chrome.contextMenus.removeAll(() => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(extractErrorMessage(error)));
        return;
      }
      resolve();
    });
  });
}

async function createMenuItemsGroup({ parentId, menuIds, contexts = MENU_CONTEXTS_DEFAULT, failureStage }) {
  for (const menuId of menuIds) {
    if (!isMenuEnabled(menuId)) continue;
    await createMenuItem({
      id: menuId,
      parentId,
      title: getMenuTitle(menuId),
      contexts
    }, {
      onError: (error) => {
        if (failureStage) {
          logMenuEvent(failureStage, {
            id: menuId,
            error: extractErrorMessage(error)
          });
        }
      }
    });
  }
}

async function createQuickMenuItems(quickEnabledMap) {
  for (const item of getFastQaQuickItems()) {
    if (!quickEnabledMap.get(item.id)) continue;
    await createMenuItem({
      id: item.id,
      parentId: 'ccs-main',
      title: getMenuTitle(item.id),
      contexts: MENU_CONTEXTS_WITH_EDITABLE
    }, {
      onSuccess: () => {
        const state = quickMenuState.get(item.id);
        if (state) state.registered = true;
        updateFastQaQuickTitle(currentMenuState.display);
        logMenuEvent('fastqa-quick-child-created', { id: item.id });
      },
      onError: (error) => {
        logMenuEvent('fastqa-quick-child-create-failed', {
          id: item.id,
          error: extractErrorMessage(error)
        });
      }
    });
  }
}

function isStaleBuild(buildId) {
  return buildId !== menuBuildCounter;
}

async function populateTopQuestionsMenus({ buildId }) {
  try {
    const config = await loadTopQuestionsConfig();
    if (!config || isStaleBuild(buildId)) return;
    (config.engines || []).forEach((engine) => {
      const menuId = `ccs-top100-${engine.id}`;
      if (!isMenuEnabled(menuId)) return;
      topQuestionsMenuMap.set(menuId, {
        urlPattern: engine.urlPattern || ''
      });
    });
    for (const engine of config.engines || []) {
      const menuId = `ccs-top100-${engine.id}`;
      if (!isMenuEnabled(menuId)) continue;
      if (isStaleBuild(buildId)) return;
      const engineTitle = TOP_QUESTION_ENGINE_TITLES[engine.id] || engine.label;
      await createMenuItem({
        id: menuId,
        parentId: 'ccs-top100-root',
        title: engineTitle,
        contexts: MENU_CONTEXTS_DEFAULT
      }, {
        failureLogStage: 'top100-child-create-failed'
      });
    }
  } catch (error) {
    console.warn('[触触搜][BG] 无法构建触触搜百问菜单:', error);
  }
}

async function populateFastAnswersMenus({ buildId, fastQaRootEnabled, quickEnabledMap }) {
  try {
    const config = await loadFastAnswersConfig();
    if (!config || isStaleBuild(buildId)) return;
    const quickItems = getFastQaQuickItems();

    logMenuEvent('fastqa-config-loaded', {
      engines: (config.engines || []).map((engine) => ({
        id: engine?.id,
        enabled: isMenuEnabled(`ccs-fastqa-${engine?.id}`),
        quickTargets: quickItems
          .filter((item) => item.engineId === engine?.id && quickEnabledMap.get(item.id))
          .map((item) => item.id)
      }))
    });

    for (const engine of config.engines || []) {
      const menuId = `ccs-fastqa-${engine.id}`;
      const urlPattern = engine.urlPattern || '';
      if (fastQaRootEnabled && isMenuEnabled(menuId)) {
        if (isStaleBuild(buildId)) return;
        const engineTitle = FAST_ANSWER_ENGINE_TITLES[engine.id] || engine.label;
        await createMenuItem({
          id: menuId,
          parentId: 'ccs-fastqa-root',
          title: engineTitle,
          contexts: MENU_CONTEXTS_DEFAULT
        }, {
          failureLogStage: 'fastqa-child-create-failed'
        });
        fastAnswersMenuMap.set(menuId, { urlPattern });
      }
      quickItems.forEach((item) => {
        if (item.engineId !== engine.id) return;
        if (!quickEnabledMap.get(item.id)) return;
        fastAnswersMenuMap.set(item.id, { urlPattern });
        logMenuEvent('fastqa-quick-url-ready', { id: item.id, urlPattern });
      });
    }
    updateFastQaQuickTitle(currentMenuState.display);
  } catch (error) {
    console.warn('[触触搜][BG] 无法构建速答壹拾佰菜单:', error);
    logMenuEvent('fastqa-config-error', { error: extractErrorMessage(error) });
  }
}

async function populateOptimizedMenus({ buildId }) {
  try {
    const config = await loadOptimizedPromptConfig();
    if (!config || isStaleBuild(buildId)) return;
    populateOptimizedMenuMap(config);
    for (const category of config.categories || []) {
      const categoryId = `ccs-optimize-${category.id}`;
      if (!isMenuEnabled(categoryId)) continue;
      if (isStaleBuild(buildId)) return;
      const categoryTitle = OPTIMIZE_CATEGORY_TITLES[category.id] || category.label;
      await createMenuItem({
        id: categoryId,
        parentId: 'ccs-optimize-root',
        title: categoryTitle,
        contexts: MENU_CONTEXTS_DEFAULT
      }, {
        failureLogStage: 'optimize-category-create-failed'
      });
      for (const engine of category.engines || []) {
        const menuId = `ccs-optimize-${category.id}-${engine.id}`;
        if (!isMenuEnabled(menuId)) continue;
        if (isStaleBuild(buildId)) return;
        const engineTitle = OPTIMIZE_ENGINE_TITLES[engine.id] || engine.label;
        await createMenuItem({
          id: menuId,
          parentId: categoryId,
          title: engineTitle,
          contexts: MENU_CONTEXTS_DEFAULT
        }, {
          failureLogStage: 'optimize-engine-create-failed'
        });
        BG_DBG('[触触搜][BG][MENU] optimize submenu created', { menuId });
      }
    }
  } catch (error) {
    console.warn('[触触搜][BG] 无法构建优化提示词菜单:', error);
  }
}

async function createContextMenus() {
  if (menuBuildInProgress) {
    menuBuildPending = true;
    logMenuEvent('rebuild-queued', {});
    return;
  }

  menuBuildInProgress = true;
  const buildId = ++menuBuildCounter;

  const finalizeMenuBuild = () => {
    if (!menuBuildInProgress) return;
    menuBuildInProgress = false;
    if (menuBuildPending) {
      menuBuildPending = false;
      createContextMenus();
    }
  };

  try {
    await removeAllContextMenus();
  } catch (error) {
    logMenuEvent('remove-all-error', { error: extractErrorMessage(error) });
    finalizeMenuBuild();
    return;
  }

  const asyncTasks = [];

  try {
    await loadMenuToggleConfig();
    BG_DBG('[触触搜][BG][MENU] rebuilding context menus', { buildId });

    optimizedPromptMenuMap.clear();
    topQuestionsMenuMap.clear();
    fastAnswersMenuMap.clear();
    quickMenuState.forEach((state) => { state.registered = false; });
    logMenuEvent('rebuild-start', { buildId });

    const top100RootEnabled = isMenuEnabled('ccs-top100-root');
    const top100OpenAllEnabled = top100RootEnabled && isMenuEnabled('ccs-top100-open-all');
    const fastQaRootEnabled = isMenuEnabled('ccs-fastqa-root');
    const fastQaOpenAllEnabled = fastQaRootEnabled && isMenuEnabled('ccs-fastqa-open-all');
    const optimizeRootEnabled = isMenuEnabled('ccs-optimize-root');
    const quickItems = getFastQaQuickItems();
    const quickEnabledMap = new Map(quickItems.map((item) => [item.id, isMenuEnabled(item.id)]));
    const hasAdvancedSections = top100RootEnabled || fastQaRootEnabled || optimizeRootEnabled;
    const needsFastAnswersConfig = fastQaRootEnabled || quickItems.some((item) => quickEnabledMap.get(item.id));

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

    await createMenuItem({
      id: 'ccs-main',
      title: getMenuTitle('ccs-main'),
      contexts: MENU_CONTEXTS_DEFAULT
    }, {
      failureLogStage: 'create-main-failed'
    });

    await createQuickMenuItems(quickEnabledMap);

    await createMenuItem({
      id: 'ccs-separator-0',
      parentId: 'ccs-main',
      type: 'separator',
      contexts: MENU_CONTEXTS_DEFAULT
    }, {
      failureLogStage: 'create-separator-0-failed'
    });

    updateMainMenuTitle(currentMenuState.display);
    updateFastQaQuickTitle(currentMenuState.display);

    await createMenuItemsGroup({
      parentId: 'ccs-main',
      menuIds: SEARCH_MENU_ITEMS,
      contexts: MENU_CONTEXTS_DEFAULT,
      failureStage: 'search-menu-create-failed'
    });
    BG_DBG('[触触搜][BG][MENU] base search items created');

    await createMenuItem({
      id: 'ccs-separator-ai',
      parentId: 'ccs-main',
      type: 'separator',
      contexts: MENU_CONTEXTS_DEFAULT
    }, {
      failureLogStage: 'create-separator-ai-failed'
    });

    await createMenuItemsGroup({
      parentId: 'ccs-main',
      menuIds: AI_MENU_ITEMS,
      contexts: MENU_CONTEXTS_DEFAULT,
      failureStage: 'ai-menu-create-failed'
    });

    await createMenuItemsGroup({
      parentId: 'ccs-main',
      menuIds: GENERAL_MENU_ITEMS,
      contexts: MENU_CONTEXTS_DEFAULT,
      failureStage: 'general-menu-create-failed'
    });

    if (hasAdvancedSections) {
      await createMenuItem({
        id: 'ccs-separator-optimized',
        parentId: 'ccs-main',
        type: 'separator',
        contexts: MENU_CONTEXTS_DEFAULT
      }, {
        failureLogStage: 'create-separator-optimized-failed'
      });
    }

    if (top100RootEnabled) {
      await createMenuItem({
        id: 'ccs-top100-root',
        parentId: 'ccs-main',
        title: getMenuTitle('ccs-top100-root'),
        contexts: MENU_CONTEXTS_DEFAULT
      }, {
        failureLogStage: 'top100-root-create-failed'
      });

      if (top100OpenAllEnabled) {
        await createMenuItem({
          id: 'ccs-top100-open-all',
          parentId: 'ccs-top100-root',
          title: getMenuTitle('ccs-top100-open-all'),
          contexts: MENU_CONTEXTS_DEFAULT
        }, {
          failureLogStage: 'top100-open-all-create-failed'
        });
      }

      await createMenuItem({
        id: 'ccs-top100-separator',
        parentId: 'ccs-top100-root',
        type: 'separator',
        contexts: MENU_CONTEXTS_DEFAULT
      }, {
        failureLogStage: 'top100-separator-create-failed'
      });

      asyncTasks.push(populateTopQuestionsMenus({ buildId }));
    }

    if (fastQaRootEnabled) {
      await createMenuItem({
        id: 'ccs-fastqa-root',
        parentId: 'ccs-main',
        title: getMenuTitle('ccs-fastqa-root'),
        contexts: MENU_CONTEXTS_DEFAULT
      }, {
        failureLogStage: 'fastqa-root-create-failed'
      });

      if (fastQaOpenAllEnabled) {
        await createMenuItem({
          id: 'ccs-fastqa-open-all',
          parentId: 'ccs-fastqa-root',
          title: getMenuTitle('ccs-fastqa-open-all'),
          contexts: MENU_CONTEXTS_DEFAULT
        }, {
          failureLogStage: 'fastqa-open-all-create-failed'
        });
      }

      await createMenuItem({
        id: 'ccs-fastqa-separator',
        parentId: 'ccs-fastqa-root',
        type: 'separator',
        contexts: MENU_CONTEXTS_DEFAULT
      }, {
        failureLogStage: 'fastqa-separator-create-failed'
      });
    }

    if (needsFastAnswersConfig) {
      asyncTasks.push(populateFastAnswersMenus({ buildId, fastQaRootEnabled, quickEnabledMap }));
    }

    if (optimizeRootEnabled) {
      await createMenuItem({
        id: 'ccs-optimize-root',
        parentId: 'ccs-main',
        title: getMenuTitle('ccs-optimize-root'),
        contexts: MENU_CONTEXTS_DEFAULT
      }, {
        failureLogStage: 'optimize-root-create-failed'
      });

      asyncTasks.push(populateOptimizedMenus({ buildId }));
    }

    await createMenuItem({
      id: 'ccs-separator-1',
      parentId: 'ccs-main',
      type: 'separator',
      contexts: MENU_CONTEXTS_DEFAULT
    }, {
      failureLogStage: 'create-separator-1-failed'
    });

    await createMenuItemsGroup({
      parentId: 'ccs-main',
      menuIds: TOOL_MENU_ITEMS,
      contexts: MENU_CONTEXTS_DEFAULT,
      failureStage: 'tool-menu-create-failed'
    });

    await createMenuItem({
      id: 'ccs-separator-2',
      parentId: 'ccs-main',
      type: 'separator',
      contexts: MENU_CONTEXTS_DEFAULT
    }, {
      failureLogStage: 'create-separator-2-failed'
    });

    await createMenuItemsGroup({
      parentId: 'ccs-main',
      menuIds: TRANSFORM_MENU_ITEMS,
      contexts: MENU_CONTEXTS_DEFAULT,
      failureStage: 'transform-menu-create-failed'
    });

    await createMenuItem({
      id: 'ccs-separator-3',
      parentId: 'ccs-main',
      type: 'separator',
      contexts: MENU_CONTEXTS_DEFAULT
    }, {
      failureLogStage: 'create-separator-3-failed'
    });

    await createMenuItem({
      id: 'ccs-show-popover',
      parentId: 'ccs-main',
      title: getMenuTitle('ccs-show-popover'),
      contexts: MENU_CONTEXTS_DEFAULT
    }, {
      failureLogStage: 'show-popover-create-failed'
    });
  } catch (error) {
    console.warn('[触触搜][BG] 构建上下文菜单时发生错误:', error);
    logMenuEvent('rebuild-error', {
      buildId,
      error: extractErrorMessage(error)
    });
  }

  try {
    if (asyncTasks.length > 0) {
      await Promise.allSettled(asyncTasks);
    }
  } catch (error) {
    console.warn('[触触搜][BG] 等待菜单异步任务时发生错误:', error);
  }

  try {
    BG_DBG('[触触搜][BG][MENU] applying icons', { buildId });
    await applyMenuIcons(buildId);
  } catch (error) {
    console.warn('[触触搜][BG] 无法应用菜单图标:', error);
  }

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = Array.isArray(tabs) ? tabs[0] : null;
    if (activeTab) {
      await refreshMenuTitle(activeTab);
    }
  } catch (error) {
    console.warn('[触触搜][BG] 初始化菜单标题失败:', error);
    logMenuEvent('initial-title-error', { error: extractErrorMessage(error) });
  }

  logMenuEvent('rebuild-complete', { buildId });
  finalizeMenuBuild();
}
