/**
 * Long-article actions shared by the ChatGPT Writing-block buttons and the
 * X Articles delivery content script.
 *
 * The source page never writes directly into another origin.  It creates a
 * short-lived, checksummed local task; the background binds that task to one
 * dedicated X Articles tab, and only that tab may read or complete it.
 */
(() => {
  const X_ARTICLE_COMPOSER_URL = 'https://x.com/compose/articles';
  const X_TASK_STORAGE_PREFIX = 'ccs_x_article_draft_';
  const X_TASK_TTL_MS = 24 * 60 * 60 * 1000;
  const X_DELIVERY_RETRIES = 18;
  const X_DELIVERY_TIMEOUT_MS = 50000;

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function storageArea() {
    return globalThis.chrome?.storage?.local || null;
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      const area = storageArea();
      if (!area?.get) {
        resolve(undefined);
        return;
      }
      try {
        area.get([key], (data) => {
          if (globalThis.chrome?.runtime?.lastError) resolve(undefined);
          else resolve(data?.[key]);
        });
      } catch (_) {
        resolve(undefined);
      }
    });
  }

  function storageSet(key, value) {
    return new Promise((resolve) => {
      const area = storageArea();
      if (!area?.set) {
        resolve(false);
        return;
      }
      try {
        area.set({ [key]: value }, () => resolve(!globalThis.chrome?.runtime?.lastError));
      } catch (_) {
        resolve(false);
      }
    });
  }

  function storageRemove(key) {
    return new Promise((resolve) => {
      const area = storageArea();
      if (!area?.remove) {
        resolve(false);
        return;
      }
      try {
        area.remove(Array.isArray(key) ? key : [key], () => resolve(!globalThis.chrome?.runtime?.lastError));
      } catch (_) {
        resolve(false);
      }
    });
  }

  function normalizeUrl(value) {
    try {
      const url = new URL(String(value || ''));
      url.hash = '';
      return url.href;
    } catch (_) {
      return '';
    }
  }

  function isChatGptUrl(value) {
    try {
      const url = new URL(String(value || ''));
      const host = url.hostname.toLowerCase();
      return url.protocol === 'https:' && (
        host === 'chatgpt.com' || host.endsWith('.chatgpt.com') ||
        host === 'chat.openai.com' || host.endsWith('.chat.openai.com')
      );
    } catch (_) {
      return false;
    }
  }

  function isXArticleComposerUrl(value) {
    try {
      const url = new URL(String(value || ''));
      const host = url.hostname.toLowerCase();
      return url.protocol === 'https:' &&
        (host === 'x.com' || host === 'www.x.com') &&
        (url.pathname === '/compose/articles' || url.pathname.startsWith('/compose/articles/'));
    } catch (_) {
      return false;
    }
  }

  function trustedChatGptSource(senderUrl, sourceUrl, senderTabUrl) {
    const sender = normalizeUrl(senderUrl);
    const source = normalizeUrl(sourceUrl);
    const senderTab = normalizeUrl(senderTabUrl);
    const trustedSender = sender || senderTab;
    return Boolean(
      trustedSender &&
      source &&
      isChatGptUrl(trustedSender) &&
      isChatGptUrl(source) &&
      (sender === source || senderTab === source)
    );
  }

  function normalizeArticleInput(value) {
    if (!value || typeof value !== 'object') return null;
    const title = typeof value.title === 'string'
      ? value.title.replace(/\s+/g, ' ').trim()
      : '';
    const bodyText = typeof value.bodyText === 'string'
      ? value.bodyText.replace(/\r\n?/g, '\n').trim()
      : '';
    const bodyHtml = typeof value.bodyHtml === 'string' ? value.bodyHtml.trim() : '';
    if (!title || title.length > 500) return null;
    if (bodyText.length < 10 || bodyText.length > 120000) return null;
    if (!bodyHtml || bodyHtml.length > 600000) return null;
    return { title, bodyText, bodyHtml };
  }

  function checksumText(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function taskChecksum(task) {
    return checksumText(`${task.title}\u0000${task.bodyText}\u0000${task.bodyHtml}`);
  }

  function uniqueTaskId() {
    const random = globalThis.crypto?.randomUUID?.();
    return random || `ccs-x-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function taskStorageKey(taskId) {
    return `${X_TASK_STORAGE_PREFIX}${taskId}`;
  }

  async function saveTask(task) {
    const saved = await storageSet(taskStorageKey(task.id), task);
    if (!saved) throw new Error('无法保存本地 X 文章任务。');
    return task;
  }

  async function pruneExpiredTasks() {
    const area = storageArea();
    if (!area?.get) return;
    const all = await new Promise((resolve) => {
      try {
        area.get(null, (data) => resolve(globalThis.chrome?.runtime?.lastError ? {} : (data || {})));
      } catch (_) {
        resolve({});
      }
    });
    const expiredKeys = Object.entries(all)
      .filter(([key]) => key.startsWith(X_TASK_STORAGE_PREFIX))
      .filter(([, task]) => !task || typeof task !== 'object' || Number(task.expiresAt) <= Date.now())
      .map(([key]) => key);
    if (expiredKeys.length) await storageRemove(expiredKeys);
  }

  async function readTask(taskId) {
    if (typeof taskId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(taskId)) return null;
    const task = await storageGet(taskStorageKey(taskId));
    if (!task || typeof task !== 'object' || task.id !== taskId) return null;
    if (Number(task.expiresAt) <= Date.now()) {
      await storageRemove(taskStorageKey(taskId));
      return null;
    }
    if (taskChecksum(task) !== task.checksum) return null;
    return task;
  }

  async function updateTask(taskId, patch) {
    const current = await readTask(taskId);
    if (!current) return null;
    const next = { ...current, ...patch };
    await saveTask(next);
    return next;
  }

  function createTab(options) {
    return new Promise((resolve, reject) => {
      try {
        globalThis.chrome.tabs.create(options, (tab) => {
          const error = globalThis.chrome?.runtime?.lastError;
          if (error) reject(new Error(error.message || 'tabs.create failed'));
          else resolve(tab || null);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function getTab(tabId) {
    return new Promise((resolve, reject) => {
      try {
        globalThis.chrome.tabs.get(tabId, (tab) => {
          const error = globalThis.chrome?.runtime?.lastError;
          if (error) reject(new Error(error.message || 'tabs.get failed'));
          else resolve(tab || null);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function waitForXTab(tabId, timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const tab = await getTab(tabId);
        if (tab?.status === 'complete' && isXArticleComposerUrl(tab.url)) return tab;
      } catch (_) {
        // The tab can briefly be unavailable while Chrome attaches it.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('等待 X Articles 编辑器超时，请确认已经登录并拥有 Articles 权限。');
  }

  function sendTabMessage(tabId, message) {
    return new Promise((resolve) => {
      try {
        globalThis.chrome.tabs.sendMessage(tabId, message, (response) => {
          if (globalThis.chrome?.runtime?.lastError) {
            resolve({ success: false, retryable: true, error: globalThis.chrome.runtime.lastError.message });
          } else {
            resolve(response || { success: false, retryable: true, error: 'empty-response' });
          }
        });
      } catch (error) {
        resolve({ success: false, retryable: true, error: errorMessage(error) });
      }
    });
  }

  async function deliverTaskToTab(taskId, tabId) {
    const deadline = Date.now() + X_DELIVERY_TIMEOUT_MS;
    let lastError = 'X Articles 内容脚本尚未就绪。';
    for (let attempt = 0; attempt < X_DELIVERY_RETRIES && Date.now() < deadline; attempt += 1) {
      const response = await sendTabMessage(tabId, {
        action: 'ccsDeliverXArticleDraft',
        taskId
      });
      if (response?.success) return response;
      lastError = response?.error || lastError;
      if (response && response.retryable === false) return response;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 650));
    }
    return { success: false, error: lastError, retryable: true };
  }

  async function createAndDeliverXArticleDraft(inputValue, sourceUrl) {
    const input = normalizeArticleInput(inputValue);
    if (!input) return { success: false, error: 'invalid-article-payload' };
    await pruneExpiredTasks();
    const now = Date.now();
    const task = {
      ...input,
      id: uniqueTaskId(),
      sourceUrl: normalizeUrl(sourceUrl),
      createdAt: now,
      expiresAt: now + X_TASK_TTL_MS,
      status: 'opening_x',
      targetTabId: null,
      deliveredAt: null,
      lastError: null
    };
    task.checksum = taskChecksum(task);
    await saveTask(task);

    try {
      const tab = await createTab({ url: X_ARTICLE_COMPOSER_URL, active: true });
      if (typeof tab?.id !== 'number') throw new Error('无法取得 X Articles 标签页 ID。');
      await updateTask(task.id, { targetTabId: tab.id, status: 'waiting_x' });
      await waitForXTab(tab.id);
      const response = await deliverTaskToTab(task.id, tab.id);
      if (!response?.success) {
        await updateTask(task.id, { status: 'failed', lastError: response?.error || 'X 草稿注入失败。' });
        return response || { success: false, error: 'X 草稿注入失败。' };
      }
      await updateTask(task.id, {
        status: 'delivered',
        deliveredAt: Date.now(),
        lastError: response.warning || null
      });
      return { ...response, taskId: task.id, targetTabId: tab.id };
    } catch (error) {
      const message = errorMessage(error);
      await updateTask(task.id, { status: 'failed', lastError: message });
      return { success: false, error: message };
    }
  }

  async function pendingTaskForTab(tabId) {
    if (typeof tabId !== 'number') return null;
    await pruneExpiredTasks();
    const area = storageArea();
    if (!area?.get) return null;
    const all = await new Promise((resolve) => {
      try {
        area.get(null, (data) => resolve(globalThis.chrome?.runtime?.lastError ? {} : (data || {})));
      } catch (_) {
        resolve({});
      }
    });
    const candidates = Object.entries(all)
      .filter(([key]) => key.startsWith(X_TASK_STORAGE_PREFIX))
      .map(([, value]) => value)
      .filter((task) => task && task.targetTabId === tabId && task.expiresAt > Date.now())
      .filter((task) => taskChecksum(task) === task.checksum)
      .filter((task) => ['opening_x', 'waiting_x', 'filling_x'].includes(task.status))
      .sort((left, right) => right.createdAt - left.createdAt);
    return candidates[0] || null;
  }

  async function taskForTarget(taskId, tabId) {
    const task = await readTask(taskId);
    if (!task || task.targetTabId !== tabId) return null;
    return task;
  }

  async function completeTaskFromTarget(taskId, tabId, result) {
    const task = await taskForTarget(taskId, tabId);
    if (!task) return false;
    const success = result?.success === true;
    await updateTask(taskId, {
      status: success ? 'delivered' : 'failed',
      deliveredAt: success ? Date.now() : null,
      lastError: success ? (result?.warning || null) : (result?.error || 'X 草稿注入失败。')
    });
    return true;
  }

  async function createLongArticleCover(inputValue, sourceUrl, tabId) {
    const input = normalizeArticleInput(inputValue);
    if (!input) return { success: false, error: 'invalid-article-payload' };
    if (!isChatGptUrl(sourceUrl)) return { success: false, error: 'sender-not-chatgpt' };
    if (typeof globalThis.runAITask !== 'function') {
      return { success: false, error: 'cover-task-unavailable' };
    }
    const article = [input.title, input.bodyText].filter(Boolean).join('\n\n');
    const result = await globalThis.runAITask({
      taskId: 'cover',
      keyword: article,
      engineId: 'chatgpt-images',
      categoryId: 'minimal',
      tabId
    });
    return result?.success
      ? { success: true, opened: result.opened || 1 }
      : { success: false, error: result?.error || 'cover-task-failed' };
  }

  globalThis.CCSArticleActions = {
    X_ARTICLE_COMPOSER_URL,
    checksumText,
    createAndDeliverXArticleDraft,
    createLongArticleCover,
    isChatGptUrl,
    isXArticleComposerUrl,
    normalizeArticleInput,
    normalizeUrl,
    pendingTaskForTab,
    pruneExpiredTasks,
    taskChecksum,
    taskForTarget,
    completeTaskFromTarget,
    trustedChatGptSource,
    updateTask
  };
})();
