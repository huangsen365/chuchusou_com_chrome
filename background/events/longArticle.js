/**
 * 长文操作栏消息：生成封面、X 长文草稿任务的创建 / 领取 / 完成。
 *
 * 业务实现在 background/articleActions.js。
 */

function ccsHandleCreateXArticleDraft(request, sender, sendResponse) {
  const requestId = ccsGetRequestId(request, 'ccsCreateXArticleDraft');
  const respond = ccsCreateSafeResponder(sendResponse, 'ccsCreateXArticleDraft', requestId, 90000);
  const senderUrl = sender?.url || '';
  const senderTabUrl = sender?.tab?.url || '';
  const sourceUrl = typeof request.sourceUrl === 'string' ? request.sourceUrl : '';
  if (!globalThis.CCSArticleActions?.trustedChatGptSource(senderUrl, sourceUrl, senderTabUrl)) {
    respond({ success: false, error: 'sender-not-chatgpt' });
    return true;
  }
  globalThis.CCSArticleActions.createAndDeliverXArticleDraft(request.input, sourceUrl)
    .then(respond)
    .catch((error) => respond({ success: false, error: error?.message || String(error) }));
  return true;
}

function ccsHandleCreateLongArticleCover(request, sender, sendResponse) {
  const requestId = ccsGetRequestId(request, 'ccsCreateLongArticleCover');
  const respond = ccsCreateSafeResponder(sendResponse, 'ccsCreateLongArticleCover', requestId, 10000);
  const senderUrl = sender?.url || '';
  const senderTabUrl = sender?.tab?.url || '';
  const sourceUrl = typeof request.sourceUrl === 'string' ? request.sourceUrl : '';
  if (!globalThis.CCSArticleActions?.trustedChatGptSource(senderUrl, sourceUrl, senderTabUrl)) {
    respond({ success: false, error: 'sender-not-chatgpt' });
    return true;
  }
  globalThis.CCSArticleActions.createLongArticleCover(request.input, sourceUrl, sender?.tab?.id)
    .then(respond)
    .catch((error) => respond({ success: false, error: error?.message || String(error) }));
  return true;
}

function ccsHandleXArticleContentReady(request, sender, sendResponse) {
  const requestId = ccsGetRequestId(request, 'ccsXArticleContentReady');
  const respond = ccsCreateSafeResponder(sendResponse, 'ccsXArticleContentReady', requestId, 4000);
  const tabId = typeof sender?.tab?.id === 'number' ? sender.tab.id : null;
  const senderUrl = sender?.url || sender?.tab?.url || '';
  if (tabId == null || !globalThis.CCSArticleActions?.isXArticleComposerUrl(senderUrl)) {
    respond({ success: false, error: 'sender-not-x-articles' });
    return true;
  }
  globalThis.CCSArticleActions.pendingTaskForTab(tabId)
    .then((task) => respond({ success: true, taskId: task?.id || '' }))
    .catch((error) => respond({ success: false, error: error?.message || String(error) }));
  return true;
}

function ccsHandleGetXArticleDraftTask(request, sender, sendResponse) {
  const requestId = ccsGetRequestId(request, 'ccsGetXArticleDraftTask');
  const respond = ccsCreateSafeResponder(sendResponse, 'ccsGetXArticleDraftTask', requestId, 4000);
  const tabId = typeof sender?.tab?.id === 'number' ? sender.tab.id : null;
  const senderUrl = sender?.url || sender?.tab?.url || '';
  const taskId = typeof request.taskId === 'string' ? request.taskId : '';
  if (tabId == null || !globalThis.CCSArticleActions?.isXArticleComposerUrl(senderUrl)) {
    respond({ success: false, error: 'sender-not-x-articles' });
    return true;
  }
  globalThis.CCSArticleActions.taskForTarget(taskId, tabId)
    .then(async (task) => {
      if (!task) {
        respond({ success: false, error: 'x-article-task-not-found' });
        return;
      }
      await globalThis.CCSArticleActions.updateTask(taskId, { status: 'filling_x' });
      respond({
        success: true,
        task: {
          id: task.id,
          title: task.title,
          bodyText: task.bodyText,
          bodyHtml: task.bodyHtml,
          checksum: task.checksum,
          expiresAt: task.expiresAt
        }
      });
    })
    .catch((error) => respond({ success: false, error: error?.message || String(error) }));
  return true;
}

function ccsHandleCompleteXArticleDraft(request, sender, sendResponse) {
  const requestId = ccsGetRequestId(request, 'ccsCompleteXArticleDraft');
  const respond = ccsCreateSafeResponder(sendResponse, 'ccsCompleteXArticleDraft', requestId, 4000);
  const tabId = typeof sender?.tab?.id === 'number' ? sender.tab.id : null;
  const senderUrl = sender?.url || sender?.tab?.url || '';
  const taskId = typeof request.taskId === 'string' ? request.taskId : '';
  if (tabId == null || !globalThis.CCSArticleActions?.isXArticleComposerUrl(senderUrl)) {
    respond({ success: false, error: 'sender-not-x-articles' });
    return true;
  }
  globalThis.CCSArticleActions.completeTaskFromTarget(taskId, tabId, request.result)
    .then((ok) => respond({ success: ok, error: ok ? undefined : 'x-article-task-not-found' }))
    .catch((error) => respond({ success: false, error: error?.message || String(error) }));
  return true;
}

ccsRegisterMessageHandlers({
  ccsCreateXArticleDraft: ccsHandleCreateXArticleDraft,
  ccsCreateLongArticleCover: ccsHandleCreateLongArticleCover,
  ccsXArticleContentReady: ccsHandleXArticleContentReady,
  ccsGetXArticleDraftTask: ccsHandleGetXArticleDraftTask,
  ccsCompleteXArticleDraft: ccsHandleCompleteXArticleDraft
});
