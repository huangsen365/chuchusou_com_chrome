(function() {
  'use strict';

  const REQUEST_CHANNEL = 'ccs:x-article-state-request';
  const RESULT_CHANNEL = 'ccs:x-article-state-result';
  const TITLE_ATTRIBUTE = 'data-ccs-main-title';
  const BODY_ATTRIBUTE = 'data-ccs-main-body';
  const DRAFT_JS_MODULE_ID = 147785;
  let cachedWebpackRequire = null;

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function elementForRequest(attribute, requestId) {
    return Array.from(document.querySelectorAll(`[${attribute}]`)).find(
      (element) => element.getAttribute(attribute) === requestId
    ) || null;
  }

  function reactValue(element, prefix) {
    const key = Object.getOwnPropertyNames(element).find((name) => name.startsWith(prefix));
    return key ? element[key] : undefined;
  }

  function propCandidates(element) {
    const candidates = [];
    const seen = new Set();
    const add = (props, depth) => {
      if (!props || typeof props !== 'object' || seen.has(props)) return;
      seen.add(props);
      candidates.push({ props, depth });
    };
    add(reactValue(element, '__reactProps$'), 0);
    let fiber = reactValue(element, '__reactFiber$');
    for (let depth = 0; fiber && depth < 60; depth += 1, fiber = fiber.return) {
      add(fiber.memoizedProps, depth);
      add(fiber.pendingProps, depth);
      add(fiber.alternate?.memoizedProps, depth);
      add(fiber.alternate?.pendingProps, depth);
    }
    return candidates;
  }

  function isDraftEditorState(value) {
    return Boolean(value && typeof value === 'object' &&
      typeof value.getCurrentContent === 'function' && typeof value.getSelection === 'function');
  }

  function findBodyStateProps(element) {
    for (const candidate of propCandidates(element)) {
      if (isDraftEditorState(candidate.props.editorState) && typeof candidate.props.onChange === 'function') {
        return {
          editorState: candidate.props.editorState,
          onChange: candidate.props.onChange,
          depth: candidate.depth
        };
      }
    }
    return null;
  }

  function findTitleChangeProps(element) {
    for (const candidate of propCandidates(element)) {
      if (typeof candidate.props.onChange !== 'function') continue;
      if (candidate.depth === 0 || candidate.props.multiline === true ||
          typeof candidate.props.maxLength === 'number' || typeof candidate.props.value === 'string') {
        return { onChange: candidate.props.onChange, depth: candidate.depth };
      }
    }
    return null;
  }

  function getWebpackRequire() {
    if (cachedWebpackRequire) return cachedWebpackRequire;
    const queue = window.webpackChunk_twitter_responsive_web;
    if (!queue) throw new Error('X 的模块运行环境尚未就绪。');
    const chunkId = Date.now() + Math.floor(Math.random() * 10000);
    queue.push([[chunkId], {}, (runtime) => { cachedWebpackRequire = runtime; }]);
    if (!cachedWebpackRequire) throw new Error('无法连接 X 的模块运行环境。');
    return cachedWebpackRequire;
  }

  function asDraftJsModule(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.EditorState && value.ContentState && value.SelectionState &&
        typeof value.convertFromHTML === 'function') return value;
    return value.default && value.default !== value ? asDraftJsModule(value.default) : null;
  }

  function findDraftJsModule(runtime) {
    for (const cached of Object.values(runtime.c || {})) {
      const draft = asDraftJsModule(cached.exports);
      if (draft) return draft;
    }
    const known = asDraftJsModule(runtime(DRAFT_JS_MODULE_ID));
    if (known) return known;
    throw new Error('X Draft.js 模块接口已经变化。');
  }

  function buildEditorState(draft, current, html) {
    const converted = draft.convertFromHTML(html);
    if (!converted?.contentBlocks?.length) throw new Error('X Draft.js 无法解析文章富文本。');
    const content = draft.ContentState.createFromBlockArray(converted.contentBlocks, converted.entityMap);
    let state = draft.EditorState.push(current, content, 'insert-fragment');
    const lastBlock = content.getLastBlock();
    const end = lastBlock.getLength();
    const selection = draft.SelectionState.createEmpty(lastBlock.getKey()).merge({
      anchorOffset: end,
      focusOffset: end,
      hasFocus: true
    });
    state = draft.EditorState.forceSelection(state, selection);
    return { state, blockCount: content.getBlockMap().size, bodyText: content.getPlainText('\n') };
  }

  function applyState(request) {
    try {
      const titleElement = elementForRequest(TITLE_ATTRIBUTE, request.requestId);
      const bodyElement = elementForRequest(BODY_ATTRIBUTE, request.requestId);
      if (!titleElement || !bodyElement) throw new Error('未找到标记后的 X 标题或正文编辑器。');
      const titleProps = findTitleChangeProps(titleElement);
      const bodyProps = findBodyStateProps(bodyElement);
      if (!titleProps || !bodyProps) throw new Error('未找到 X React 编辑器的状态更新入口。');
      const draft = findDraftJsModule(getWebpackRequire());
      const next = buildEditorState(draft, bodyProps.editorState, request.bodyHtml);
      const eventTarget = { value: request.title };
      titleProps.onChange({
        target: eventTarget,
        currentTarget: eventTarget,
        nativeEvent: { text: request.title },
        preventDefault() {},
        stopPropagation() {}
      });
      bodyProps.onChange(next.state);
      return {
        channel: RESULT_CHANNEL,
        requestId: request.requestId,
        ok: true,
        data: {
          blockCount: next.blockCount,
          bodyText: next.bodyText,
          bodyFiberDepth: bodyProps.depth,
          titleFiberDepth: titleProps.depth
        }
      };
    } catch (error) {
      return { channel: RESULT_CHANNEL, requestId: request.requestId, ok: false, error: errorMessage(error) };
    }
  }

  function isRequest(value) {
    return Boolean(value && typeof value === 'object' &&
      value.channel === REQUEST_CHANNEL &&
      typeof value.requestId === 'string' && /^[A-Za-z0-9_-]{8,100}$/u.test(value.requestId) &&
      typeof value.title === 'string' && value.title.length <= 500 &&
      typeof value.bodyHtml === 'string' && value.bodyHtml.length <= 600000);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !isRequest(event.data)) return;
    window.postMessage(applyState(event.data), location.origin);
  });
})();
