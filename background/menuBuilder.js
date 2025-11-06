const MENU_CONTEXTS_DEFAULT = ['selection', 'page'];
const MENU_CONTEXTS_WITH_EDITABLE = ['selection', 'page', 'editable'];

const MENU_GROUPS = Object.freeze({
  fastQaQuick: FAST_QA_QUICK_ITEMS.map((item) => item.id),
  search: [
    { id: 'ccs-baidu' },
    { id: 'ccs-google' },
    { id: 'ccs-tongyi' }
  ],
  ai: [
    { id: 'ccs-chatgpt' },
    { id: 'ccs-claude' },
    { id: 'ccs-grok' }
  ],
  general: [
    { id: 'ccs-yiyan' },
    { id: 'ccs-zhihu' },
    { id: 'ccs-weixin' },
    { id: 'ccs-taobao' },
    { id: 'ccs-jd' },
    { id: 'ccs-sov2ex' },
    { id: 'ccs-google-translate' },
    { id: 'ccs-chuchusou' }
  ],
  tool: [
    { id: 'ccs-copy' },
    { id: 'ccs-base64' },
    { id: 'ccs-md5' },
    { id: 'ccs-url-encode' }
  ],
  transform: [
    { id: 'ccs-upper' },
    { id: 'ccs-lower' }
  ]
});

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

async function createMenuItemsGroup({ parentId, menuItems, contexts = MENU_CONTEXTS_DEFAULT, failureStage }) {
  const normalizedItems = Array.isArray(menuItems) ? menuItems : [];
  for (const item of normalizedItems) {
    const menuId = typeof item === 'string' ? item : item?.id;
    if (!menuId) continue;
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
  for (const item of FAST_QA_QUICK_ITEMS) {
    if (!quickEnabledMap.get(item.id)) continue;
    await createMenuItem({
      id: item.id,
      parentId: 'ccs-main',
      title: getMenuTitle(item.id),
      contexts: MENU_CONTEXTS_WITH_EDITABLE
    }, {
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
    const quickItems = FAST_QA_QUICK_ITEMS;

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
    // Clear and rebuild optimize category label IDs
    optimizeCategoryLabelIds.length = 0;
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

      // Add label with keyword at top of category submenu
      const labelId = `${categoryId}-label`;
      const labelResult = await createMenuItem({
        id: labelId,
        parentId: categoryId,
        title: '🔍 触触搜',
        enabled: false,
        contexts: MENU_CONTEXTS_DEFAULT
      }, {
        failureLogStage: 'optimize-category-label-create-failed'
      });

      // 新架构：注册到 MenuRegistry，替代原有的 optimizeCategoryLabelIds 数组
      if (labelResult.ok) {
        // 保留旧系统兼容（可在完全迁移后删除）
        optimizeCategoryLabelIds.push(labelId);

        // 注册到新的同步系统（约定：-label 结尾自动识别）
        if (typeof menuRegistry !== 'undefined' && menuRegistry) {
          menuRegistry.register({
            id: labelId,
            parentId: categoryId,
            title: '触触搜',
            icon: '🔍',
            titleTemplate: '${icon} ${title}: "${keyword}"',
            syncGroup: 'labels',
            autoSync: true
          });
        }
      } else {
        logMenuEvent('optimize-category-label-creation-failed-skipped', {
          categoryId,
          labelId,
          error: labelResult.error?.message || 'unknown'
        });
      }

      // Add separator below label
      const separatorResult = await createMenuItem({
        id: `${categoryId}-label-separator`,
        parentId: categoryId,
        type: 'separator',
        contexts: MENU_CONTEXTS_DEFAULT
      }, {
        failureLogStage: 'optimize-category-label-separator-create-failed'
      });

      if (!separatorResult.ok) {
        logMenuEvent('optimize-separator-creation-failed', {
          categoryId,
          error: separatorResult.error?.message || 'unknown'
        });
      }

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
    logMenuEvent('rebuild-start', { buildId });

    const top100RootEnabled = isMenuEnabled('ccs-top100-root');
    const top100OpenAllEnabled = top100RootEnabled && isMenuEnabled('ccs-top100-open-all');
    const fastQaRootEnabled = isMenuEnabled('ccs-fastqa-root');
    const fastQaOpenAllEnabled = fastQaRootEnabled && isMenuEnabled('ccs-fastqa-open-all');
    const optimizeRootEnabled = isMenuEnabled('ccs-optimize-root');
    const quickItems = FAST_QA_QUICK_ITEMS;
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

    const mainResult = await createMenuItem({
      id: 'ccs-main',
      title: getMenuTitle('ccs-main'),
      contexts: MENU_CONTEXTS_DEFAULT
    }, {
      failureLogStage: 'create-main-failed'
    });

    // 注册主菜单到新的同步系统
    if (mainResult.ok && typeof menuRegistry !== 'undefined' && menuRegistry) {
      menuRegistry.register({
        id: 'ccs-main',
        title: '触触搜',
        icon: '🔍',
        titleTemplate: '${icon} ${title}: "${keyword}"',
        syncGroup: 'main',
        autoSync: true
      });
    }

    // 创建关键字标签菜单项（禁用，仅作为标签显示）
    const searchLabelResult = await createMenuItem({
      id: 'ccs-search-label',
      parentId: 'ccs-main',
      title: '🔍 触触搜',
      enabled: false,
      contexts: MENU_CONTEXTS_DEFAULT
    }, {
      failureLogStage: 'create-search-label-failed'
    });

    // 注册搜索标签到新的同步系统（约定：-label 结尾自动识别）
    if (searchLabelResult.ok && typeof menuRegistry !== 'undefined' && menuRegistry) {
      menuRegistry.register({
        id: 'ccs-search-label',
        parentId: 'ccs-main',
        title: '触触搜',
        icon: '🔍',
        titleTemplate: '${icon} ${title}: "${keyword}"',
        syncGroup: 'labels',
        autoSync: true
      });
    }

    // 在标签下方添加分割线
    await createMenuItem({
      id: 'ccs-search-label-separator',
      parentId: 'ccs-main',
      type: 'separator',
      contexts: MENU_CONTEXTS_DEFAULT
    }, {
      failureLogStage: 'create-search-label-separator-failed'
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

    await createMenuItemsGroup({
      parentId: 'ccs-main',
      menuItems: MENU_GROUPS.search,
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
      menuItems: MENU_GROUPS.ai,
      contexts: MENU_CONTEXTS_DEFAULT,
      failureStage: 'ai-menu-create-failed'
    });

    await createMenuItemsGroup({
      parentId: 'ccs-main',
      menuItems: MENU_GROUPS.general,
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

      // Add label with keyword at top of submenu
      const top100LabelResult = await createMenuItem({
        id: 'ccs-top100-label',
        parentId: 'ccs-top100-root',
        title: '🔍 触触搜',
        enabled: false,
        contexts: MENU_CONTEXTS_DEFAULT
      }, {
        failureLogStage: 'top100-label-create-failed'
      });

      // 注册到新的同步系统（约定：-label 结尾自动识别）
      if (top100LabelResult.ok && typeof menuRegistry !== 'undefined' && menuRegistry) {
        menuRegistry.register({
          id: 'ccs-top100-label',
          parentId: 'ccs-top100-root',
          title: '触触搜',
          icon: '🔍',
          titleTemplate: '${icon} ${title}: "${keyword}"',
          syncGroup: 'labels',
          autoSync: true
        });
      }

      // Add separator below label
      await createMenuItem({
        id: 'ccs-top100-label-separator',
        parentId: 'ccs-top100-root',
        type: 'separator',
        contexts: MENU_CONTEXTS_DEFAULT
      }, {
        failureLogStage: 'top100-label-separator-create-failed'
      });

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

      // Add label with keyword at top of submenu
      const fastqaLabelResult = await createMenuItem({
        id: 'ccs-fastqa-label',
        parentId: 'ccs-fastqa-root',
        title: '🔍 触触搜',
        enabled: false,
        contexts: MENU_CONTEXTS_DEFAULT
      }, {
        failureLogStage: 'fastqa-label-create-failed'
      });

      // 注册到新的同步系统（约定：-label 结尾自动识别）
      if (fastqaLabelResult.ok && typeof menuRegistry !== 'undefined' && menuRegistry) {
        menuRegistry.register({
          id: 'ccs-fastqa-label',
          parentId: 'ccs-fastqa-root',
          title: '触触搜',
          icon: '🔍',
          titleTemplate: '${icon} ${title}: "${keyword}"',
          syncGroup: 'labels',
          autoSync: true
        });
      }

      // Add separator below label
      await createMenuItem({
        id: 'ccs-fastqa-label-separator',
        parentId: 'ccs-fastqa-root',
        type: 'separator',
        contexts: MENU_CONTEXTS_DEFAULT
      }, {
        failureLogStage: 'fastqa-label-separator-create-failed'
      });

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

      // BUGFIX: Changed to synchronous to ensure optimizeCategoryLabelIds is populated
      // before createContextMenus() completes, preventing race condition
      await populateOptimizedMenus({ buildId });
    }

    // Check if tool group has any enabled items
    const toolGroupEnabled = MENU_GROUPS.tool.some(item => {
      const menuId = typeof item === 'string' ? item : item?.id;
      return menuId && isMenuEnabled(menuId);
    });

    // Check if transform group has any enabled items
    const transformGroupEnabled = MENU_GROUPS.transform.some(item => {
      const menuId = typeof item === 'string' ? item : item?.id;
      return menuId && isMenuEnabled(menuId);
    });

    // Only create separator-1 and tool group if tool group has enabled items
    if (toolGroupEnabled) {
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
        menuItems: MENU_GROUPS.tool,
        contexts: MENU_CONTEXTS_DEFAULT,
        failureStage: 'tool-menu-create-failed'
      });
    }

    // Only create separator-2 and transform group if transform group has enabled items
    if (transformGroupEnabled) {
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
        menuItems: MENU_GROUPS.transform,
        contexts: MENU_CONTEXTS_DEFAULT,
        failureStage: 'transform-menu-create-failed'
      });
    }

    // Only create separator and "Open Panel" menu item if show-popover is enabled
    if (isMenuEnabled('ccs-show-popover')) {
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
    }
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

  // 新架构：菜单创建完成后，立即同步所有菜单标题
  if (typeof keywordSyncManager !== 'undefined' && keywordSyncManager && currentMenuState.display) {
    try {
      const syncResult = await keywordSyncManager.syncMenus();
      logMenuEvent('menus-synced-after-rebuild-new-system', {
        buildId,
        display: currentMenuState.display,
        syncResult
      });
    } catch (error) {
      console.error('[触触搜][BG] 菜单创建后同步失败:', error);
      logMenuEvent('menus-sync-after-rebuild-failed', {
        buildId,
        error: extractErrorMessage(error)
      });
    }
  }

  // 旧系统（兼容模式）：BUGFIX: Sync all submenu labels with current keyword after menu creation completes
  // This ensures labels show the correct keyword immediately, not just the default '🔍 触触搜'
  if (currentMenuState.display) {
    updateSubmenuLabels(currentMenuState.display);
    logMenuEvent('submenu-labels-synced-after-rebuild', {
      buildId,
      display: currentMenuState.display,
      optimizeLabelCount: optimizeCategoryLabelIds.length
    });
  } else {
    // Even without keyword, update to ensure consistency
    updateSubmenuLabels('');
    logMenuEvent('submenu-labels-synced-empty', { buildId });
  }

  finalizeMenuBuild();
}
