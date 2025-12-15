/**
 * 触触搜 - 文本处理工具
 * 集中管理所有文本处理函数
 */

// ==================== 文本格式化 ====================

/**
 * 格式化菜单标题 - 截断过长的文本
 * @param {string} text - 原始文本
 * @param {number} maxLength - 最大长度（默认 20）
 * @returns {string|null} - 格式化后的文本，空文本返回 null
 */
function formatMenuTitle(text, maxLength = 20) {
  if (!text) return null;
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return null;
  return compact.substring(0, maxLength) + (compact.length > maxLength ? '...' : '');
}

/**
 * 规范化搜索文本 - 处理空白字符和 URL 编码
 * @param {string} raw - 原始文本
 * @returns {string} - 规范化后的文本
 */
function normalizeSearchText(raw) {
  if (!raw) return '';
  let text = raw;
  // 尝试解码 URL 编码的文本
  try {
    if (/%[0-9A-Fa-f]{2}/.test(text) && decodeURIComponent(text) !== text) {
      text = decodeURIComponent(text);
    }
  } catch (_) {
    // 忽略解码错误
  }
  // 规范化空白字符
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

// ==================== 标题清理 ====================

/**
 * 清理标题中的关键词 - 移除网站后缀和括号前缀
 * @param {string} rawTitle - 原始标题
 * @returns {string} - 清理后的标题
 */
function cleanupTitleKeyword(rawTitle) {
  if (!rawTitle) return '';
  let cleaned = rawTitle.trim();

  // 需要移除的后缀列表
  const suffixes = [
    ' - 搜索结果',
    ' - 知乎',
    ' - Zhihu',
    ' - ChatGPT',
    ' – ChatGPT',
    ' — ChatGPT',
    ' - Claude',
    ' – Claude',
    ' — Claude'
  ];

  // 移除后缀
  suffixes.forEach((suffix) => {
    if (cleaned.endsWith(suffix)) {
      cleaned = cleaned.slice(0, -suffix.length);
    }
  });

  // 移除括号前缀 (如 "(1) 标题" 或 "（提示）标题")
  const prefixPattern = /^[\s]*[\(（][^\)）]*[\)）]\s*/;
  while (prefixPattern.test(cleaned)) {
    cleaned = cleaned.replace(prefixPattern, '').trim();
  }

  return cleaned.trim();
}

/**
 * 从标题中提取关键词 - 用于搜索引擎结果页
 * @param {string} title - 页面标题
 * @returns {string} - 提取的关键词
 */
function extractKeywordFromTitle(title) {
  if (!title) return '';

  let cleaned = title;

  // 搜索引擎网站后缀
  const suffixes = [
    ' - 百度搜索',
    ' - Google 搜索',
    ' - 搜狗搜索',
    ' - 360搜索',
    ' - Bing',
    ' - 知乎',
    ' - 微博',
    ' - GitHub',
    ' - Stack Overflow',
    ' - CSDN博客',
    ' - 简书',
    ' - 掘金',
    ' - 博客园',
    ' | ',
    ' - ',
    ' – ',
    ' — '
  ];

  // 移除网站后缀
  for (const suffix of suffixes) {
    const index = cleaned.lastIndexOf(suffix);
    if (index > 0) {
      cleaned = cleaned.substring(0, index);
      break;
    }
  }

  // 进一步清理
  cleaned = cleanupTitleKeyword(cleaned);

  // 限制长度
  if (cleaned.length > 50) {
    cleaned = cleaned.substring(0, 50) + '...';
  }

  return cleaned.trim();
}

// ==================== 主机名和关键词判断 ====================

/**
 * 判断关键词是否为泛化的主机名关键词
 * 用于过滤掉类似 "chatgpt" 或 "claude.ai" 这样的无意义关键词
 * @param {string} hostname - 主机名
 * @param {string} keyword - 关键词
 * @returns {boolean} - 是否为泛化关键词
 */
function isGenericHostKeyword(hostname, keyword) {
  if (!keyword) return false;
  const value = keyword.trim().toLowerCase();
  if (!value) return true;

  // ChatGPT 相关
  if (hostname.includes('chatgpt.com')) {
    if (value === 'chatgpt' || value === 'chatgpt.com' || value.startsWith('chatgpt.com/')) {
      return true;
    }
    if (value === 'www.chatgpt.com') {
      return true;
    }
  }

  // Claude 相关
  if (hostname.includes('claude.ai')) {
    if (value === 'claude' || value === 'claude.ai' || value.startsWith('claude.ai/')) {
      return true;
    }
    if (value === 'www.claude.ai') {
      return true;
    }
  }

  return false;
}

// ==================== 菜单工具函数 ====================

/**
 * 获取菜单定义
 * @param {string} menuId - 菜单 ID
 * @returns {Object|null} - 菜单定义对象
 */
function getMenuDefinition(menuId) {
  return (typeof MENU_DEFINITIONS !== 'undefined' ? MENU_DEFINITIONS[menuId] : null) || null;
}

/**
 * 获取菜单文本
 * @param {string} menuId - 菜单 ID
 * @param {string} fallback - 回退文本
 * @returns {string} - 菜单文本
 */
function getMenuText(menuId, fallback) {
  const definition = getMenuDefinition(menuId);
  if (definition && typeof definition.text === 'string' && definition.text) {
    return definition.text;
  }
  if (typeof fallback === 'string' && fallback) {
    return fallback;
  }
  return menuId;
}

/**
 * 获取带图标的菜单标题
 * @param {string} menuId - 菜单 ID
 * @param {string} fallback - 回退文本
 * @returns {string} - 带图标的菜单标题
 */
function getMenuTitle(menuId, fallback) {
  const definition = getMenuDefinition(menuId);
  const text = getMenuText(menuId, fallback);
  if (definition && typeof definition.icon === 'string' && definition.icon.trim()) {
    return `${definition.icon.trim()} ${text}`;
  }
  return text;
}

// ==================== URL 工具函数 ====================

/**
 * 判断 URL 是否为需要保留菜单状态的快速结果页面
 * @param {string} url - URL 字符串
 * @returns {boolean} - 是否需要保留状态
 */
function shouldPreserveMenuStateForUrl(url) {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname;
    const quickResultHosts = typeof QUICK_RESULT_HOSTS !== 'undefined'
      ? QUICK_RESULT_HOSTS
      : ['chatgpt.com', 'claude.ai'];
    return quickResultHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch (_) {
    return false;
  }
}

/**
 * 判断标签页是否为需要保留菜单状态的快速结果页面
 * @param {Object} tab - 标签页对象
 * @returns {boolean} - 是否需要保留状态
 */
function shouldPreserveMenuStateForTab(tab) {
  if (!tab || typeof tab.url !== 'string') return false;
  return shouldPreserveMenuStateForUrl(tab.url);
}

// ==================== 候选项选择 ====================

/**
 * 从候选项列表中选择第一个有意义的文本
 * @param {Array<string>} candidates - 候选项列表
 * @returns {Object} - { raw, trimmed } 对象
 */
function pickFirstMeaningfulText(candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      return { raw: candidate, trimmed };
    }
  }
  return { raw: '', trimmed: '' };
}
