/**
 * 触触搜 - Popup 菜单结构构建器（纯函数 / SSoT 共享）
 *
 * 设计目标：popup 和 background 共用同一份结构生成逻辑，避免双源不一致。
 * 该 builder 不依赖任何 chrome.* API，只接受配置对象、返回菜单结构。
 *
 * 输入：
 *   unifiedConfig     —— config/unifiedMenuConfig.json（用于抽取 toggle 状态）
 *   toggleConfig      —— 已抽好的 {menuId: bool} 表（与 unifiedConfig 二选一，前者优先）
 *   enginesConfig     —— config/engines.json（用于 getEngineTitle）
 *   top100Config      —— prompts/topQuestionsPrompts.json
 *   fastqaConfig      —— prompts/fastAnswersPrompts.json
 *   optimizeConfig    —— prompts/optimizedPrompts.json
 *   coverConfig       —— prompts/coverPrompts.json
 *
 * 输出：{ groups: [...] } —— 与原 background/base.js::getPopupMenuStructure 输出 100% 兼容。
 *
 * 同步源：MENU_DEFS / FAST_QA_QUICK / OPTIMIZE_TITLES / COVER_TITLES 与
 * background/utils/Constants.js 内同名常量保持一致。修改 Constants.js 时**必须**同步本文件。
 */

(function (root) {
  'use strict';

  // ============ 菜单文本/图标（与 Constants.js MENU_DEFINITIONS 一致） ============
  const MENU_DEFS = {
    'ccs-main': { text: '触触搜', icon: '🔍' },
    'ccs-baidu': { text: '百度搜索', icon: '🐼' },
    'ccs-google': { text: 'Google 搜索', icon: '🔎' },
    'ccs-x': { text: 'X（推特）搜索', icon: '𝕏' },
    'ccs-yiyan': { text: '文心一言', icon: '🧠' },
    'ccs-chatgpt': { text: 'ChatGPT', icon: '🤖' },
    'ccs-claude': { text: 'Claude', icon: '🧠' },
    'ccs-grok': { text: 'Grok', icon: '🦊' },
    'ccs-google-ai-chat': { text: 'Google AI 模式', icon: '✨' },
    'ccs-zhihu': { text: '知乎搜索', icon: '💡' },
    'ccs-weixin': { text: '微信搜一搜', icon: '💬' },
    'ccs-taobao': { text: '淘宝搜索', icon: '🛒' },
    'ccs-jd': { text: '京东搜索', icon: '🛍️' },
    'ccs-sov2ex': { text: 'V2EX (sov2ex)', icon: '💻' },
    'ccs-baidu-translate': { text: '百度翻译', icon: '✍️' },
    'ccs-google-translate': { text: 'Google 翻译', icon: '🔁' },
    'ccs-chuchusou': { text: '更多搜索引擎...', icon: '🌐' },
    'ccs-top100-root': { text: '触触搜百问', icon: '💯' },
    'ccs-top100-open-all': { text: '打开以下全部', icon: '🚀' },
    'ccs-fastqa-root': { text: '速答壹拾佰', icon: '⚡' },
    'ccs-fastqa-open-all': { text: '打开以下全部', icon: '🚀' },
    'ccs-optimize-root': { text: '优化提示词', icon: '🧠' },
    'ccs-optimize-open-all': { text: '打开以下全部', icon: '🚀' },
    'ccs-cover-root': { text: '封面生成器', icon: '🎨' },
    'ccs-cover-open-all': { text: '打开以下全部预设风格', icon: '🚀' },
    'ccs-cover-anime-cute-chatgpt-images': { text: '二次元可爱', icon: '🌸' },
    'ccs-cover-xiaohongshu-chatgpt-images': { text: '小红书封面', icon: '🔴' },
    'ccs-cover-coconut-chatgpt-images': { text: '椰树牌风格', icon: '🥥' },
    'ccs-cover-minimal-chatgpt-images': { text: '极简的留白', icon: '⬜' },
    'ccs-cover-zhumoqing-chatgpt-images': { text: '墨清风格', icon: '✒️' },
    'ccs-copy': { text: '复制文本', icon: '📋' },
    'ccs-base64': { text: 'Base64 编码', icon: '🔤' },
    'ccs-md5': { text: 'MD5 哈希', icon: '🔐' },
    'ccs-url-encode': { text: 'URL 编码', icon: '🔗' },
    'ccs-upper': { text: '转换为大写', icon: '🔠' },
    'ccs-lower': { text: '转换为小写', icon: '🔡' },
    'ccs-show-popover': { text: '打开触触搜面板 (Alt+S)', icon: '🪟' }
  };

  // 速答快捷菜单（与 Constants.js FAST_QA_QUICK_ITEMS 一致）
  const FAST_QA_QUICK = [
    { id: 'ccs-fastqa-chatgpt-quick', engineId: 'chatgpt', menuTitle: '触触搜 · 速答壹拾佰 - ChatGPT', menuIcon: '🤖' },
    { id: 'ccs-fastqa-claude-quick', engineId: 'claude', menuTitle: '触触搜 · 速答壹拾佰 - Claude', menuIcon: '🧠' },
    { id: 'ccs-fastqa-grok-quick', engineId: 'grok', menuTitle: '触触搜 · 速答壹拾佰 - Grok', menuIcon: '🦊' },
    { id: 'ccs-fastqa-yiyan-quick', engineId: 'yiyan', menuTitle: '触触搜 · 速答壹拾佰 - 文心一言', menuIcon: '🧠' },
    { id: 'ccs-fastqa-google-ai-quick', engineId: 'google-ai', menuTitle: '触触搜 · 速答壹拾佰 - Google AI 模式', menuIcon: '✨' }
  ];
  // 把 FAST_QA_QUICK 的菜单标题/图标补进 MENU_DEFS（与 Constants.js 同样做法）
  FAST_QA_QUICK.forEach((it) => {
    MENU_DEFS[it.id] = { text: it.menuTitle, icon: it.menuIcon || '' };
  });

  const OPTIMIZE_TITLES = {
    'deep-research': '📚 深度研究',
    'general-conversation': '💬 普通对话',
    'code-writing': '💻 代码编写',
    'content-creation': '📝 内容创作',
    'data-analysis': '📊 数据分析',
    'problem-solving': '🧩 问题解答',
    'brainstorm': '💡 头脑风暴',
    'description-polish': '✨ 优化描述'
  };

  const COVER_TITLES = {
    'anime-cute':  '🌸 二次元可爱',
    'xiaohongshu': '🔴 小红书封面',
    'coconut':     '🥥 椰树牌风格',
    'minimal':     '⬜ 极简的留白',
    'zhumoqing':   '✒️ 墨清风格',
    'custom':      '🖌️ 自定义风格'
  };

  // ============ Popup 菜单常驻条目（urlPattern / type / action） ============
  const SEARCH_ITEMS = [
    { id: 'ccs-baidu', type: 'search', urlPattern: 'https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${KEYWORD}' },
    { id: 'ccs-google', type: 'search', urlPattern: 'https://www.google.com/search?q=${KEYWORD}' },
    { id: 'ccs-x', type: 'search', urlPattern: 'https://x.com/search?q=${KEYWORD}' }
  ];
  const AI_ITEMS = [
    { id: 'ccs-chatgpt', type: 'ai-chat', urlPattern: 'https://chatgpt.com/?q=${KEYWORD}' },
    { id: 'ccs-claude', type: 'ai-chat', urlPattern: 'https://claude.ai/new?q=${KEYWORD}' },
    { id: 'ccs-grok', type: 'ai-chat', urlPattern: 'https://grok.com/?q=${KEYWORD}' },
    { id: 'ccs-yiyan', type: 'ai-search', urlPattern: 'https://chat.baidu.com/' },
    { id: 'ccs-google-ai-chat', type: 'ai-chat', urlPattern: 'https://www.google.com/search?udm=50&ie=UTF-8&oe=UTF-8&q=${KEYWORD}' }
  ];
  const GENERAL_ITEMS = [
    { id: 'ccs-zhihu', type: 'search', urlPattern: 'https://www.zhihu.com/search?q=${KEYWORD}' },
    { id: 'ccs-weixin', type: 'search', urlPattern: 'https://weixin.sogou.com/weixin?query=${KEYWORD}' },
    { id: 'ccs-taobao', type: 'ecommerce', urlPattern: 'https://s.taobao.com/search?q=${KEYWORD}' },
    { id: 'ccs-jd', type: 'ecommerce', urlPattern: 'https://search.jd.com/Search?keyword=${KEYWORD}' },
    { id: 'ccs-sov2ex', type: 'search', urlPattern: 'https://www.sov2ex.com/?q=${KEYWORD}' },
    { id: 'ccs-google-translate', type: 'translate', urlPattern: 'https://translate.google.com/?sl=auto&tl=zh-CN&text=${KEYWORD}' },
    { id: 'ccs-chuchusou', type: 'portal', urlPattern: 'https://chuchusou.com/#/?keyword=${KEYWORD}' }
  ];
  const TOOL_ITEMS = [
    { id: 'ccs-copy', type: 'tool', action: 'copy' },
    { id: 'ccs-base64', type: 'tool', action: 'base64-encode' },
    { id: 'ccs-md5', type: 'tool', action: 'md5-hash' },
    { id: 'ccs-url-encode', type: 'tool', action: 'url-encode' }
  ];
  const TRANSFORM_ITEMS = [
    { id: 'ccs-upper', type: 'transform', action: 'to-uppercase' },
    { id: 'ccs-lower', type: 'transform', action: 'to-lowercase' }
  ];

  // ============ 辅助函数 ============

  function extractToggleMap(unifiedConfig) {
    const map = {};
    if (!unifiedConfig || !Array.isArray(unifiedConfig.groups)) return map;
    for (const group of unifiedConfig.groups) {
      if (!Array.isArray(group.items)) continue;
      for (const item of group.items) {
        if (item && item.id && typeof item.enabled === 'boolean') {
          map[item.id] = item.enabled;
        }
        if (item && Array.isArray(item.children)) {
          for (const child of item.children) {
            if (child && child.id && typeof child.enabled === 'boolean') {
              map[child.id] = child.enabled;
            }
          }
        }
      }
    }
    return map;
  }

  function makeIsEnabled(toggleMap) {
    return function (id) {
      if (!toggleMap) return true;
      const v = toggleMap[id];
      return typeof v === 'boolean' ? v : true;
    };
  }

  function getMenuText(id) {
    return (MENU_DEFS[id] && MENU_DEFS[id].text) || id;
  }
  function getMenuIcon(id, fallback) {
    return (MENU_DEFS[id] && MENU_DEFS[id].icon) || fallback || '';
  }

  function getEngineTitle(enginesConfig, engineId, fallbackLabel) {
    if (!enginesConfig || !enginesConfig.engines) return fallbackLabel || engineId;
    const e = enginesConfig.engines[engineId];
    if (!e) return fallbackLabel || engineId;
    const icon = e.icon || '';
    const label = e.label || fallbackLabel || engineId;
    return icon ? `${icon} ${label}` : label;
  }

  // ============ 主构建函数 ============

  function build(opts) {
    opts = opts || {};
    const unifiedConfig = opts.unifiedConfig || null;
    const toggleMap = opts.toggleConfig || extractToggleMap(unifiedConfig);
    const enginesConfig = opts.enginesConfig || null;
    const top100Config = opts.top100Config || null;
    const fastqaConfig = opts.fastqaConfig || null;
    const optimizeConfig = opts.optimizeConfig || null;
    const coverConfig = opts.coverConfig || null;

    const isEnabled = makeIsEnabled(toggleMap);
    const structure = { groups: [] };

    // 1. 快速问答（fastQaQuick）
    const quickItems = FAST_QA_QUICK.filter((it) => isEnabled(it.id));
    if (quickItems.length > 0) {
      structure.groups.push({
        id: 'fastQaQuick',
        separator: 'after',
        items: quickItems.map((it) => ({
          id: it.id,
          title: getMenuText(it.id),
          icon: getMenuIcon(it.id, it.menuIcon),
          type: 'fastqa-quick',
          engineId: it.engineId
        }))
      });
    }

    // 2. 搜索（search）
    const searchItems = SEARCH_ITEMS.filter((it) => isEnabled(it.id));
    if (searchItems.length > 0) {
      structure.groups.push({
        id: 'search',
        separator: 'after',
        items: searchItems.map((it) => ({
          id: it.id,
          title: getMenuText(it.id),
          icon: getMenuIcon(it.id),
          type: it.type,
          urlPattern: it.urlPattern
        }))
      });
    }

    // 3. AI 对话（ai）
    const aiItems = AI_ITEMS.filter((it) => isEnabled(it.id));
    if (aiItems.length > 0) {
      structure.groups.push({
        id: 'ai',
        separator: 'after',
        items: aiItems.map((it) => ({
          id: it.id,
          title: getMenuText(it.id),
          icon: getMenuIcon(it.id),
          type: it.type,
          urlPattern: it.urlPattern
        }))
      });
    }

    // 4. 通用组（general）
    const generalItems = GENERAL_ITEMS.filter((it) => isEnabled(it.id));
    if (generalItems.length > 0) {
      structure.groups.push({
        id: 'general',
        separator: 'none',
        items: generalItems.map((it) => ({
          id: it.id,
          title: getMenuText(it.id),
          icon: getMenuIcon(it.id),
          type: it.type,
          urlPattern: it.urlPattern
        }))
      });
    }

    // 5. 高级功能组（advanced）
    const advancedItems = [];

    // 5.1 触触搜百问
    if (isEnabled('ccs-top100-root') && top100Config) {
      const children = [];
      if (isEnabled('ccs-top100-open-all')) {
        children.push({
          id: 'ccs-top100-open-all',
          title: getMenuText('ccs-top100-open-all'),
          icon: getMenuIcon('ccs-top100-open-all', '🚀'),
          type: 'action'
        });
      }
      for (const engine of top100Config.engines || []) {
        const menuId = `ccs-top100-${engine.id}`;
        if (!isEnabled(menuId)) continue;
        children.push({
          id: menuId,
          title: getEngineTitle(enginesConfig, engine.id, engine.label),
          icon: engine.icon || '',
          type: 'top100',
          engineId: engine.id,
          urlPattern: engine.urlPattern
        });
      }
      if (children.length > 0) {
        advancedItems.push({
          id: 'ccs-top100-root',
          title: getMenuText('ccs-top100-root'),
          icon: getMenuIcon('ccs-top100-root', '💯'),
          type: 'submenu',
          children
        });
      }
    }

    // 5.2 速答壹拾佰
    if (isEnabled('ccs-fastqa-root') && fastqaConfig) {
      const children = [];
      if (isEnabled('ccs-fastqa-open-all')) {
        children.push({
          id: 'ccs-fastqa-open-all',
          title: getMenuText('ccs-fastqa-open-all'),
          icon: getMenuIcon('ccs-fastqa-open-all', '🚀'),
          type: 'action'
        });
      }
      for (const engine of fastqaConfig.engines || []) {
        const menuId = `ccs-fastqa-${engine.id}`;
        if (!isEnabled(menuId)) continue;
        children.push({
          id: menuId,
          title: getEngineTitle(enginesConfig, engine.id, engine.label),
          icon: engine.icon || '',
          type: 'fastqa',
          engineId: engine.id,
          urlPattern: engine.urlPattern
        });
      }
      if (children.length > 0) {
        advancedItems.push({
          id: 'ccs-fastqa-root',
          title: getMenuText('ccs-fastqa-root'),
          icon: getMenuIcon('ccs-fastqa-root', '⚡'),
          type: 'submenu',
          children
        });
      }
    }

    // 5.3 优化提示词
    if (isEnabled('ccs-optimize-root') && optimizeConfig && Array.isArray(optimizeConfig.categories)) {
      const optimizeChildren = [];
      for (const category of optimizeConfig.categories) {
        const categoryId = `ccs-optimize-${category.id}`;
        if (!isEnabled(categoryId)) continue;
        const categoryEngines = [];
        const catOpenAllId = `ccs-optimize-${category.id}-open-all`;
        if (isEnabled(catOpenAllId)) {
          categoryEngines.push({
            id: catOpenAllId,
            title: '🚀 打开以下全部',
            icon: '',
            type: 'optimize',
            categoryId: category.id,
            openAll: true,
            purpose: category.purpose || category.label
          });
        }
        for (const engine of category.engines || []) {
          const menuId = `ccs-optimize-${category.id}-${engine.id}`;
          if (!isEnabled(menuId)) continue;
          categoryEngines.push({
            id: menuId,
            title: getEngineTitle(enginesConfig, engine.id, engine.label),
            icon: engine.icon || '',
            type: 'optimize',
            categoryId: category.id,
            engineId: engine.id,
            purpose: category.purpose || category.label,
            urlPattern: engine.urlPattern
          });
        }
        if (categoryEngines.length > 0) {
          optimizeChildren.push({
            id: categoryId,
            title: OPTIMIZE_TITLES[category.id] || category.label,
            icon: category.icon || '',
            type: 'submenu',
            children: categoryEngines
          });
        }
      }
      if (optimizeChildren.length > 0) {
        advancedItems.push({
          id: 'ccs-optimize-root',
          title: getMenuText('ccs-optimize-root'),
          icon: getMenuIcon('ccs-optimize-root', '🧠'),
          type: 'submenu',
          children: optimizeChildren
        });
      }
    }

    // 5.4 封面生成器（扁平：风格直接做叶子）
    if (isEnabled('ccs-cover-root') && coverConfig && Array.isArray(coverConfig.categories)) {
      const coverChildren = [];
      const coverPresets = [];
      for (const category of coverConfig.categories) {
        if (category.id === 'custom') continue;
        const engine = (category.engines || [])[0];
        if (!engine) continue;
        const leafId = `ccs-cover-${category.id}-${engine.id}`;
        if (!isEnabled(leafId)) continue;
        coverPresets.push({
          id: leafId,
          title: COVER_TITLES[category.id] || category.label,
          icon: '',
          type: 'cover',
          categoryId: category.id,
          engineId: engine.id,
          purpose: category.purpose || category.label,
          urlPattern: engine.urlPattern
        });
      }
      if (coverPresets.length >= 2 && isEnabled('ccs-cover-open-all')) {
        coverChildren.push({
          id: 'ccs-cover-open-all',
          title: '🚀 打开以下全部预设风格',
          icon: '',
          type: 'cover',
          openAll: true
        });
      }
      coverChildren.push(...coverPresets);
      if (coverChildren.length > 0) {
        advancedItems.push({
          id: 'ccs-cover-root',
          title: getMenuText('ccs-cover-root'),
          icon: getMenuIcon('ccs-cover-root', '🎨'),
          type: 'submenu',
          children: coverChildren
        });
      }
    }

    if (advancedItems.length > 0) {
      structure.groups.push({
        id: 'advanced',
        separator: 'before',
        items: advancedItems
      });
    }

    // 6. 工具组（tool）
    const toolItems = TOOL_ITEMS.filter((it) => isEnabled(it.id));
    if (toolItems.length > 0) {
      structure.groups.push({
        id: 'tool',
        separator: 'before',
        items: toolItems.map((it) => ({
          id: it.id,
          title: getMenuText(it.id),
          icon: getMenuIcon(it.id),
          type: it.type,
          action: it.action
        }))
      });
    }

    // 7. 文本转换组（transform）
    const transformItems = TRANSFORM_ITEMS.filter((it) => isEnabled(it.id));
    if (transformItems.length > 0) {
      structure.groups.push({
        id: 'transform',
        separator: 'before',
        items: transformItems.map((it) => ({
          id: it.id,
          title: getMenuText(it.id),
          icon: getMenuIcon(it.id),
          type: it.type,
          action: it.action
        }))
      });
    }

    // 8. 面板控制（panel）
    if (isEnabled('ccs-show-popover')) {
      structure.groups.push({
        id: 'panel',
        separator: 'before',
        items: [{
          id: 'ccs-show-popover',
          title: getMenuText('ccs-show-popover'),
          icon: getMenuIcon('ccs-show-popover', '🪟'),
          type: 'action',
          action: 'show-popover'
        }]
      });
    }

    return structure;
  }

  root.CCSMenuStructureBuilder = {
    build,
    extractToggleMap,
    MENU_DEFS,
    FAST_QA_QUICK,
    OPTIMIZE_TITLES,
    COVER_TITLES
  };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : self));
