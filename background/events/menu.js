/**
 * popup / sidepanel 菜单：取菜单结构、执行菜单项（与右键菜单同一套动作）。
 */

// 处理popup获取菜单结构请求（与右键菜单保持一致）
function ccsHandleGetMenuStructure(request, sender, sendResponse) {
  const requestId = ccsGetRequestId(request, 'getMenuStructure');
  const respond = ccsCreateSafeResponder(sendResponse, 'getMenuStructure', requestId, 3500);
  getPopupMenuStructure()
    .then(structure => {
      respond({ success: true, structure });
    })
    .catch(error => {
      console.error('[触触搜][BG] 获取菜单结构失败:', error);
      respond({ success: false, error: error?.message || String(error), code: 'MENU_STRUCTURE_FAILED' });
    });
  return true; // 异步响应
}

// 处理popup菜单项点击（复用右键菜单逻辑）
function ccsHandleExecuteMenuAction(request, sender, sendResponse) {
  const requestId = ccsGetRequestId(request, 'executeMenuAction');
  const safeSendResponse = ccsCreateSafeResponder(sendResponse, 'executeMenuAction', requestId, 6000);
  ccsLogMessage('request', 'executeMenuAction', requestId, {
    menuItemId: request.menuItemId,
    menuType: request.menuType,
    hasKeyword: !!request.keyword
  });
  const { menuItemId, menuType, keyword, urlPattern, actionType, engineId } = request;

  (async () => {
    const sendResponse = safeSendResponse;
    try {
      // 获取当前标签页
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tab?.id;

      // 没有关键词时的处理（某些操作不需要关键词）
      if (!keyword && menuType !== 'action' && actionType !== 'show-popover') {
        sendResponse({ success: false, error: 'no-keyword' });
        return;
      }

      // 字数保护：按目标引擎截断用户原文 + toast 提示
      let effectiveKeyword = keyword || '';
      if (effectiveKeyword && typeof applyTextLimit === 'function' && menuItemId) {
        const limited = applyTextLimit(menuItemId, effectiveKeyword, { tabId: sender?.tab?.id });
        effectiveKeyword = limited.text;
      }
      const encodedKeyword = effectiveKeyword ? encodeURIComponent(effectiveKeyword) : '';

      // === SSoT: AI 任务统一快速通道 ===
      // 速答/百问/优化/封面生成器都走 runAITask；命中即返回，否则回落老 case。
      if (['fastqa','fastqa-quick','top100','optimize','cover'].includes(menuType) &&
          typeof runAITask === 'function' && effectiveKeyword) {
        const taskId = (menuType === 'optimize') ? 'optimize'
          : (menuType === 'cover') ? 'cover'
          : (menuType === 'top100') ? 'top100' : 'fastqa';
        let categoryId;
        let eid = engineId;
        let openAllFlag = request.openAll === true; // 调用方显式传 openAll（popup/sidepanel 走 menuItemId 走下面 resolveMenuId 也会兜住）
        if ((taskId === 'optimize' || taskId === 'cover') && menuItemId && typeof AITaskRegistry !== 'undefined') {
          const parsed = AITaskRegistry.resolveMenuId(menuItemId);
          if (parsed) {
            categoryId = parsed.categoryId;
            eid = parsed.engineId || eid;
            if (parsed.openAll) openAllFlag = true;
          }
        }
        // cover 自定义风格：sidepanel 传过来的 request.purpose 作为 purposeOverride 注入
        // 否则会用 coverPrompts.json 里 custom category 的占位文本
        const purposeOverride = (taskId === 'cover' && categoryId === 'custom' && typeof request.purpose === 'string' && request.purpose.trim())
          ? request.purpose
          : undefined;
        try {
          const r = await runAITask({
            taskId, keyword: effectiveKeyword, engineId: eid,
            categoryId, tabId: sender?.tab?.id,
            openAll: openAllFlag,
            purposeOverride
          });
          if (r.success) { sendResponse({ success: true }); return; }
        } catch (err) { /* 继续 fallback */ }
      }

      // 根据menuType处理不同类型的菜单
      switch (menuType) {
        case 'search':
        case 'ai-chat':
        case 'ai-search':
        case 'ecommerce':
        case 'translate':
        case 'portal':
          if (urlPattern && keyword) {
            const url = urlPattern
              .replace('${KEYWORD}', encodedKeyword)
              .replace('${PROMPT}', encodedKeyword);
            await ccsOpenMenuUrlWithAIRelay(urlPattern, effectiveKeyword, url, {
              source: 'execute-menu-action',
              menuId: menuItemId || '',
              engineId: engineId || '',
              tabId
            });
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'invalid-params' });
          }
          return;

        case 'tool':
        case 'transform':
          if (tabId && keyword) {
            const commandMap = {
              'copy': 'copy',
              'base64-encode': 'base64',
              'md5-hash': 'md5',
              'url-encode': 'url-encode',
              'to-uppercase': 'upper',
              'to-lowercase': 'lower'
            };
            const command = commandMap[actionType];
            if (actionType === 'copy') {
              const ok = await copyTextInTab(tab, keyword);
              if (!ok) {
                await ccsSendTabMessageWithFallback(tabId, {
                  action: 'showToast',
                  message: '复制失败，请检查页面权限'
                }, 'copy-failed-toast');
                sendResponse({ success: false, error: 'copy-failed', code: 'COPY_FAILED' });
                return;
              }
            } else if (command) {
              const sent = await ccsSendTabMessageWithFallback(tabId, {
                action: 'processCommand',
                command: command,
                text: keyword
              }, 'process-command');
              if (!sent.ok) {
                sendResponse({
                  success: false,
                  error: sent.error || 'content-unavailable',
                  code: sent.code || 'CONTENT_UNAVAILABLE'
                });
                return;
              }
            }
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'invalid-params' });
          }
          return;

        case 'fastqa':
        case 'fastqa-quick':
          if (keyword) {
            const config = await loadFastAnswersConfig();
            if (!config) {
              sendResponse({ success: false, error: 'config-load-failed' });
              return;
            }
            if (!fastAnswersTemplate) {
              fastAnswersTemplate = Array.isArray(config.templateLines)
                ? config.templateLines.join('\n')
                : (config.template || '');
            }
            const prompt = buildFastAnswersPrompt(keyword);
            if (!prompt) {
              sendResponse({ success: false, error: 'template-invalid' });
              return;
            }
            // 查找对应引擎的URL模式
            let targetPattern = null;
            if (engineId) {
              const engine = (config.engines || []).find((e) => e.id === engineId);
              if (engine && engine.urlPattern) {
                targetPattern = engine.urlPattern;
              }
            }
            if (!targetPattern && urlPattern) {
              targetPattern = urlPattern;
            }
            if (targetPattern) {
              await ccsOpenPromptUrlPattern(targetPattern, prompt, {
                source: 'popup-fastqa',
                menuId: menuItemId || '',
                engineId: engineId || ''
              });
              sendResponse({ success: true });
            } else {
              sendResponse({ success: false, error: 'no-engine-url' });
            }
          } else {
            sendResponse({ success: false, error: 'no-keyword' });
          }
          return;

        case 'top100':
          if (keyword) {
            const config = await loadTopQuestionsConfig();
            if (!config) {
              sendResponse({ success: false, error: 'config-load-failed' });
              return;
            }
            if (!topQuestionsTemplate) {
              topQuestionsTemplate = Array.isArray(config.templateLines)
                ? config.templateLines.join('\n')
                : (config.template || '');
            }
            const prompt = buildTopQuestionsPrompt(keyword);
            if (!prompt) {
              sendResponse({ success: false, error: 'template-invalid' });
              return;
            }
            let targetPattern = null;
            if (engineId) {
              const engine = (config.engines || []).find((e) => e.id === engineId);
              if (engine && engine.urlPattern) {
                targetPattern = engine.urlPattern;
              }
            }
            if (!targetPattern && urlPattern) {
              targetPattern = urlPattern;
            }
            if (targetPattern) {
              await ccsOpenPromptUrlPattern(targetPattern, prompt, {
                source: 'popup-top100',
                menuId: menuItemId || '',
                engineId: engineId || ''
              });
              sendResponse({ success: true });
            } else {
              sendResponse({ success: false, error: 'no-engine-url' });
            }
          } else {
            sendResponse({ success: false, error: 'no-keyword' });
          }
          return;

        case 'optimize':
          if (keyword) {
            const config = await loadOptimizedPromptConfig();
            if (!config) {
              sendResponse({ success: false, error: 'config-load-failed' });
              return;
            }
            if (!optimizedPromptTemplate) {
              optimizedPromptTemplate = Array.isArray(config.templateLines)
                ? config.templateLines.join('\n')
                : (config.template || '');
            }
            // 从 request 获取 purpose（优化类别）
            const purpose = request.purpose || '';
            const prompt = buildOptimizedPrompt(purpose, keyword);
            if (!prompt) {
              sendResponse({ success: false, error: 'template-invalid' });
              return;
            }
            let targetPattern = null;
            if (urlPattern) {
              targetPattern = urlPattern;
            }
            if (targetPattern) {
              await ccsOpenPromptUrlPattern(targetPattern, prompt, {
                source: 'popup-optimize',
                menuId: menuItemId || '',
                engineId: engineId || ''
              });
              sendResponse({ success: true });
            } else {
              sendResponse({ success: false, error: 'no-engine-url' });
            }
          } else {
            sendResponse({ success: false, error: 'no-keyword' });
          }
          return;

        case 'cover':
          if (keyword) {
            const config = await loadCoverPromptConfig();
            if (!config) {
              sendResponse({ success: false, error: 'config-load-failed' });
              return;
            }
            if (!coverPromptTemplate) {
              coverPromptTemplate = Array.isArray(config.templateLines)
                ? config.templateLines.join('\n')
                : (config.template || '');
            }
            // 从 request 获取 purpose（封面风格）
            const purpose = request.purpose || '';
            const prompt = buildCoverPrompt(purpose, keyword);
            if (!prompt) {
              sendResponse({ success: false, error: 'template-invalid' });
              return;
            }
            let targetPattern = null;
            if (urlPattern) {
              targetPattern = urlPattern;
            }
            if (targetPattern) {
              await ccsOpenPromptUrlPattern(targetPattern, prompt, {
                source: 'popup-cover',
                menuId: menuItemId || '',
                engineId: engineId || ''
              });
              sendResponse({ success: true });
            } else {
              sendResponse({ success: false, error: 'no-engine-url' });
            }
          } else {
            sendResponse({ success: false, error: 'no-keyword' });
          }
          return;

        case 'action':
          if (actionType === 'show-popover' && tabId) {
            const sent = await ccsSendTabMessageWithFallback(tabId, {
              action: 'showPopover',
              text: keyword || ''
            }, 'show-popover');
            if (!sent.ok) {
              sendResponse({
                success: false,
                error: sent.error || 'content-unavailable',
                code: sent.code || 'CONTENT_UNAVAILABLE'
              });
              return;
            }
            sendResponse({ success: true });
          } else if (menuItemId === 'ccs-top100-open-all' && keyword) {
            // 打开所有触触搜百问引擎
            const config = await loadTopQuestionsConfig();
            if (!config) {
              sendResponse({ success: false, error: 'config-load-failed' });
              return;
            }
            if (!topQuestionsTemplate) {
              topQuestionsTemplate = Array.isArray(config.templateLines)
                ? config.templateLines.join('\n')
                : (config.template || '');
            }
            const prompt = buildTopQuestionsPrompt(keyword);
            if (!prompt) {
              sendResponse({ success: false, error: 'template-invalid' });
              return;
            }
            const engines = Array.isArray(config.engines) ? config.engines : [];
            let openedCount = 0;
            for (const engine of engines) {
              if (!engine || typeof engine.urlPattern !== 'string' || !engine.urlPattern) {
                continue;
              }
              const engineMenuId = `ccs-top100-${engine.id}`;
              if (!isMenuEnabled(engineMenuId)) continue;
              await ccsOpenPromptUrlPattern(engine.urlPattern, prompt, {
                source: 'popup-top100-open-all',
                menuId: engineMenuId,
                engineId: engine.id || '',
                active: openedCount === 0
              });
              openedCount += 1;
            }
            sendResponse({ success: true, openedCount });
          } else if (menuItemId === 'ccs-fastqa-open-all' && keyword) {
            // 打开所有速答壹拾佰引擎
            const config = await loadFastAnswersConfig();
            if (!config) {
              sendResponse({ success: false, error: 'config-load-failed' });
              return;
            }
            if (!fastAnswersTemplate) {
              fastAnswersTemplate = Array.isArray(config.templateLines)
                ? config.templateLines.join('\n')
                : (config.template || '');
            }
            const prompt = buildFastAnswersPrompt(keyword);
            if (!prompt) {
              sendResponse({ success: false, error: 'template-invalid' });
              return;
            }
            const engines = Array.isArray(config.engines) ? config.engines : [];
            let openedCount = 0;
            for (const engine of engines) {
              if (!engine || typeof engine.urlPattern !== 'string' || !engine.urlPattern) {
                continue;
              }
              const engineMenuId = `ccs-fastqa-${engine.id}`;
              if (!isMenuEnabled(engineMenuId)) continue;
              await ccsOpenPromptUrlPattern(engine.urlPattern, prompt, {
                source: 'popup-fastqa-open-all',
                menuId: engineMenuId,
                engineId: engine.id || '',
                active: openedCount === 0
              });
              openedCount += 1;
            }
            sendResponse({ success: true, openedCount });
          } else {
            sendResponse({ success: false, error: 'unknown-action' });
          }
          return;

        case 'submenu':
          // 子菜单本身不执行操作
          sendResponse({ success: false, error: 'submenu-no-action' });
          return;

        default:
          // 尝试根据menuItemId使用现有的switch case逻辑
          if (menuItemId && keyword) {
            let handled = false;

            // === SSoT 快速通道 ===
            // URLBuilder 命中则直接打开，跳过下方硬编码 switch（保留作安全网）
            if (typeof tryOpenMenuUrl === 'function' && tryOpenMenuUrl(menuItemId, keyword, { tabId: sender?.tab?.id })) {
              sendResponse({ success: true });
              return;
            }

            switch (menuItemId) {
              case 'ccs-baidu':
                chrome.tabs.create({ url: `https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${encodedKeyword}` });
                handled = true;
                break;
              case 'ccs-google':
                chrome.tabs.create({ url: `https://www.google.com/search?q=${encodedKeyword}` });
                handled = true;
                break;
              case 'ccs-x':
                chrome.tabs.create({ url: `https://x.com/search?q=${encodedKeyword}` });
                handled = true;
                break;
              case 'ccs-google-ai-chat':
                await ccsOpenMenuUrlWithAIRelay(
                  'https://www.google.com/search?udm=50&ie=UTF-8&oe=UTF-8&q=${KEYWORD}',
                  keyword,
                  `https://www.google.com/search?udm=50&ie=UTF-8&oe=UTF-8&q=${encodedKeyword}`,
                  { source: 'execute-menu-action-fallback', menuId: menuItemId, engineId: 'google-ai' }
                );
                handled = true;
                break;
              case 'ccs-yiyan':
                await ccsOpenMenuUrlWithAIRelay(
                  'https://chat.baidu.com/',
                  keyword,
                  'https://chat.baidu.com/',
                  { source: 'execute-menu-action-fallback', menuId: menuItemId, engineId: 'yiyan' }
                );
                handled = true;
                break;
              case 'ccs-chatgpt':
                await ccsOpenMenuUrlWithAIRelay(
                  'https://chatgpt.com/?q=${KEYWORD}',
                  keyword,
                  `https://chatgpt.com/?q=${encodedKeyword}`,
                  { source: 'execute-menu-action-fallback', menuId: menuItemId, engineId: 'chatgpt' }
                );
                handled = true;
                break;
              case 'ccs-claude':
                await ccsOpenMenuUrlWithAIRelay(
                  'https://claude.ai/new?q=${KEYWORD}',
                  keyword,
                  `https://claude.ai/new?q=${encodedKeyword}`,
                  { source: 'execute-menu-action-fallback', menuId: menuItemId, engineId: 'claude' }
                );
                handled = true;
                break;
              case 'ccs-grok':
                await ccsOpenMenuUrlWithAIRelay(
                  'https://grok.com/?q=${KEYWORD}',
                  keyword,
                  `https://grok.com/?q=${encodedKeyword}`,
                  { source: 'execute-menu-action-fallback', menuId: menuItemId, engineId: 'grok' }
                );
                handled = true;
                break;
              case 'ccs-zhihu':
                chrome.tabs.create({ url: `https://www.zhihu.com/search?q=${encodedKeyword}` });
                handled = true;
                break;
              case 'ccs-weixin':
                chrome.tabs.create({ url: `https://search.weixin.qq.com/cgi-bin/newsearchweb/userclientjump?path=page/search/christmas_jump&query=${encodedKeyword}` });
                handled = true;
                break;
              case 'ccs-taobao':
                chrome.tabs.create({ url: `https://s.taobao.com/search?q=${encodedKeyword}` });
                handled = true;
                break;
              case 'ccs-jd':
                chrome.tabs.create({ url: `https://search.jd.com/Search?keyword=${encodedKeyword}` });
                handled = true;
                break;
              case 'ccs-sov2ex':
                chrome.tabs.create({ url: `https://www.sov2ex.com/?q=${encodedKeyword}` });
                handled = true;
                break;
              case 'ccs-google-translate':
                chrome.tabs.create({ url: `https://translate.google.com/?sl=auto&tl=zh-CN&text=${encodedKeyword}` });
                handled = true;
                break;
              case 'ccs-chuchusou':
                chrome.tabs.create({ url: `https://chuchusou.com/?q=${encodedKeyword}` });
                handled = true;
                break;
            }
            if (handled) {
              sendResponse({ success: true });
              return;
            }
          }
          sendResponse({ success: false, error: 'unhandled-type' });
      }
    } catch (error) {
      console.error('[触触搜][BG] executeMenuAction 失败:', error);
      sendResponse({ success: false, error: error?.message || String(error) });
    }
  })();
  return true; // 异步响应
}

ccsRegisterMessageHandlers({
  getMenuStructure: ccsHandleGetMenuStructure,
  executeMenuAction: ccsHandleExecuteMenuAction
});
