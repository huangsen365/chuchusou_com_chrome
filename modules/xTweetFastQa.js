(function() {
  'use strict';

  window.CCSModules = window.CCSModules || {};
  const Runtime = window.CCSModules.SiteFastQaRuntime;
  if (!Runtime) return;

  const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
  const TWEET_TEXT_SELECTOR = '[data-testid="tweetText"]';
  const X_ARTICLE_SELECTOR = '[data-testid="twitterArticleReadView"]';
  const X_ARTICLE_TITLE_SELECTOR = '[data-testid="twitter-article-title"]';
  const X_ARTICLE_BODY_SELECTOR = '[data-testid="twitterArticleRichTextView"]';
  const BUTTON_MARKER = 'data-ccs-x-tweet-fastqa';
  const HOST_MARKER = 'data-ccs-x-tweet-fastqa-host';
  const STYLE_ID = 'ccs-x-tweet-fastqa-styles';

  function isSupportedXPage(hostname = location.hostname) {
    return /(^|\.)(x\.com|twitter\.com)$/i.test(hostname);
  }

  function belongsToTweetRoot(element, root) {
    return element.closest(ARTICLE_SELECTOR) === root;
  }

  function isInsideEmbeddedTweet(element, root) {
    let current = element.parentElement;
    while (current && current !== root) {
      if (current.matches(ARTICLE_SELECTOR) || current.getAttribute('role') === 'link') return true;
      current = current.parentElement;
    }
    return false;
  }

  function normalizeTweetBody(value) {
    return String(value || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[\t ]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function elementText(element) {
    if (!element) return '';
    return normalizeTweetBody(element.innerText || element.textContent || '');
  }

  function extractPrimaryTweetBody(root) {
    const textElement = Array.from(root.querySelectorAll(TWEET_TEXT_SELECTOR))
      .find((element) => belongsToTweetRoot(element, root) && !isInsideEmbeddedTweet(element, root));
    return elementText(textElement);
  }

  function primaryXArticle(root) {
    return Array.from(root.querySelectorAll(X_ARTICLE_SELECTOR))
      .find((element) => belongsToTweetRoot(element, root) && !isInsideEmbeddedTweet(element, root)) || null;
  }

  function extractXArticleTitle(root) {
    return elementText(primaryXArticle(root)?.querySelector(X_ARTICLE_TITLE_SELECTOR));
  }

  function extractXArticleBody(root) {
    return elementText(primaryXArticle(root)?.querySelector(X_ARTICLE_BODY_SELECTOR));
  }

  function buildTweetFastQaInput(body) {
    const normalized = normalizeTweetBody(body);
    return normalized ? `【推文正文】\n${normalized}\n【正文结束】` : '';
  }

  function buildXArticleFastQaInput(title, body) {
    const normalizedTitle = normalizeTweetBody(title);
    const normalizedBody = normalizeTweetBody(body);
    if (!normalizedBody) return '';
    return [
      ...(normalizedTitle ? ['【X 长文标题】', normalizedTitle] : []),
      '【X 长文正文】',
      normalizedBody,
      '【正文结束】'
    ].join('\n');
  }

  function tweetSourceKey(root, body) {
    const permalink = Array.from(root.querySelectorAll('a[href*="/status/"]'))
      .find((link) =>
        belongsToTweetRoot(link, root) &&
        !isInsideEmbeddedTweet(link, root) &&
        Boolean(link.querySelector('time'))
      );
    if (permalink) {
      try {
        const url = new URL(permalink.getAttribute('href') || permalink.href, location.href);
        const match = url.pathname.match(/^\/[^/]+\/status\/\d+/);
        if (match) return `x:${url.origin}${match[0]}`;
      } catch (_) {
        // Ignore a temporarily incomplete href.
      }
    }
    return `x-body:${body}`;
  }

  function extractXTweetFastQaContent(root) {
    const articleBody = extractXArticleBody(root);
    if (articleBody) {
      const title = extractXArticleTitle(root);
      const keyword = buildXArticleFastQaInput(title, articleBody);
      const postKey = tweetSourceKey(root, articleBody);
      const sourceKey = postKey.startsWith('x:')
        ? `x-article:${postKey.slice(2)}`
        : `x-article-body:${title || articleBody.slice(0, 200)}`;
      return {
        platform: 'x',
        kind: 'article',
        sourceKey,
        keyword,
        body: articleBody,
        ...(title ? { title } : {})
      };
    }

    const body = extractPrimaryTweetBody(root);
    const keyword = buildTweetFastQaInput(body);
    if (!keyword) return null;
    return {
      platform: 'x',
      kind: 'post',
      sourceKey: tweetSourceKey(root, body),
      keyword,
      body
    };
  }

  function findTweetActionGroups(root) {
    const article = primaryXArticle(root);
    const candidates = Array.from(root.querySelectorAll('[role="group"]')).filter((candidate) =>
      !isInsideEmbeddedTweet(candidate, root) &&
      Array.from(candidate.querySelectorAll('[data-testid="reply"]'))
        .some((reply) => belongsToTweetRoot(reply, root))
    );
    if (!article) return candidates.slice(0, 1);

    const articleGroup = candidates.find((candidate) => article.contains(candidate));
    const tweetGroup = candidates.find((candidate) => !article.contains(candidate));
    return Array.from(new Set([articleGroup, tweetGroup].filter(Boolean)));
  }

  function findTweetActionGroup(root) {
    return findTweetActionGroups(root)[0] || null;
  }

  function directGroupChild(element, group) {
    let current = element;
    while (current && current.parentElement !== group) current = current.parentElement;
    return current?.parentElement === group ? current : null;
  }

  const adapter = {
    id: 'x',
    styleId: STYLE_ID,
    isSupported: isSupportedXPage,
    styles: `
      [${HOST_MARKER}] {
        display: flex;
        flex: 1 1 0;
        min-width: 0;
        align-items: center;
        justify-content: center;
      }
      [${BUTTON_MARKER}] {
        position: relative;
        display: inline-flex;
        width: 34.75px;
        height: 34.75px;
        margin: -8px;
        padding: 0;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 9999px;
        background: transparent;
        color: rgb(113 118 123);
        cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease, opacity 120ms ease;
      }
      [${BUTTON_MARKER}]:hover:not(:disabled) {
        background: rgb(29 155 240 / 10%);
        color: rgb(29 155 240);
      }
      [${BUTTON_MARKER}]:focus-visible {
        outline: 2px solid rgb(29 155 240 / 55%);
        outline-offset: 2px;
      }
      [${BUTTON_MARKER}]:disabled { cursor: wait; opacity: 0.58; }
      [${BUTTON_MARKER}][data-ccs-state="unavailable"] { cursor: not-allowed; opacity: 0.38; }
      [${BUTTON_MARKER}][data-ccs-state="success"] { color: rgb(0 186 124); }
      [${BUTTON_MARKER}][data-ccs-state="error"] { color: rgb(244 33 46); }
      [${BUTTON_MARKER}] svg { width: 19px; height: 19px; fill: currentColor; }
      @media (prefers-reduced-motion: reduce) {
        [${BUTTON_MARKER}] { transition: none; }
      }
    `,
    findRoots(currentDocument) {
      return Array.from(currentDocument.querySelectorAll(ARTICLE_SELECTOR));
    },
    extract(root) {
      return extractXTweetFastQaContent(root);
    },
    findActionContainer(root) {
      return findTweetActionGroup(root);
    },
    findActionContainers(root) {
      return findTweetActionGroups(root);
    },
    insertHost(_root, group, host) {
      const shareButton = Array.from(group.querySelectorAll('button'))
        .find((candidate) => /^(分享帖子|分享|Share post)$/i.test(candidate.getAttribute('aria-label') || ''));
      const shareCell = shareButton ? directGroupChild(shareButton, group) : null;
      group.insertBefore(host, shareCell);
    },
    decorateHost(host) {
      host.setAttribute(HOST_MARKER, 'true');
    },
    decorateButton(button) {
      button.setAttribute(BUTTON_MARKER, 'true');
    },
    ownsElement(element, root) {
      return belongsToTweetRoot(element, root);
    },
    copy(state, content) {
      const isArticle = content?.kind === 'article';
      if (state === 'idle') {
        return {
          label: isArticle ? '用 ChatGPT 速答这篇 X 长文' : '用 ChatGPT 速答这条推文',
          title: isArticle
            ? '速答 · ChatGPT：仅发送这篇 X 长文的标题和正文'
            : '速答 · ChatGPT：仅发送这条推文正文'
        };
      }
      if (state === 'busy') {
        return {
          label: '正在发送到 ChatGPT',
          title: isArticle ? '正在提取 X 长文并打开 ChatGPT' : '正在准备速答并打开 ChatGPT'
        };
      }
      if (state === 'success') {
        return {
          label: '已发送到 ChatGPT',
          title: isArticle ? 'X 长文已发送到速答 · ChatGPT' : '推文正文已发送到速答 · ChatGPT'
        };
      }
      if (state === 'error') return { label: '发送失败，可以重试', title: '发送失败，点击重试' };
      return { label: '未提取到 X 正文', title: '这则 X 内容没有可提取的正文' };
    },
    successToast(content) {
      return content.kind === 'article'
        ? 'X 长文标题和正文已发送到速答 · ChatGPT'
        : '推文正文已发送到速答 · ChatGPT';
    },
    unavailableToast: '未提取到这则 X 内容的正文'
  };

  function startXTweetFastQaIntegration() {
    return Runtime.start(adapter);
  }

  const XTweetFastQa = {
    normalizeTweetBody,
    extractPrimaryTweetBody,
    extractXArticleTitle,
    extractXArticleBody,
    buildTweetFastQaInput,
    buildXArticleFastQaInput,
    extract: extractXTweetFastQaContent,
    start: startXTweetFastQaIntegration
  };

  window.CCSModules.XTweetFastQa = XTweetFastQa;
  startXTweetFastQaIntegration();
})();
