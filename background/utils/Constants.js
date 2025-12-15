/**
 * 触触搜 - 常量定义
 * 集中管理所有硬编码的常量值
 */

// ==================== 调试和日志 ====================

/**
 * 日志前缀
 */
const LOG_PREFIX = '[触触搜][MENU]';

/**
 * 存储键名
 */
const STORAGE_KEYS = {
  DEBUG: 'ccs_debug',
  MENU_ICON_SUPPORT: 'ccs_menu_icon_supported',
  BLACKLIST: 'ccs_blacklist',
  SHORTCUT_KEY: 'ccs_shortcut_key'
};

// ==================== 快速结果页面 ====================

/**
 * 需要保留菜单状态的快速结果页面主机名
 */
const QUICK_RESULT_HOSTS = ['chatgpt.com', 'claude.ai'];

// ==================== 菜单配置 ====================

/**
 * 菜单定义 - 每个菜单项的文本和图标
 */
const MENU_DEFINITIONS = {
  'ccs-main': { text: '触触搜', icon: '🔍' },
  'ccs-baidu': { text: '百度搜索', icon: '🐼' },
  'ccs-google': { text: 'Google 搜索', icon: '🔎' },
  'ccs-tongyi': { text: '通义千问', icon: '🪄' },
  'ccs-yiyan': { text: '文心一言', icon: '🧠' },
  'ccs-chatgpt': { text: 'ChatGPT', icon: '🤖' },
  'ccs-claude': { text: 'Claude', icon: '🧠' },
  'ccs-grok': { text: 'Grok', icon: '🦊' },
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
  'ccs-copy': { text: '复制文本', icon: '📋' },
  'ccs-base64': { text: 'Base64 编码', icon: '🔤' },
  'ccs-md5': { text: 'MD5 哈希', icon: '🔐' },
  'ccs-url-encode': { text: 'URL 编码', icon: '🔗' },
  'ccs-upper': { text: '转换为大写', icon: '🔠' },
  'ccs-lower': { text: '转换为小写', icon: '🔡' },
  'ccs-show-popover': { text: '打开触触搜面板 (Alt+S)', icon: '🪟' }
};

/**
 * 速答快捷菜单项
 */
const FAST_QA_QUICK_ITEMS = [
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
  },
  {
    id: 'ccs-fastqa-yiyan-quick',
    engineId: 'yiyan',
    titleKey: 'yiyan',
    menuTitle: '触触搜 · 速答壹拾佰 - 文心一言',
    menuIcon: '🧠'
  }
];

// 动态添加速答快捷项到菜单定义
FAST_QA_QUICK_ITEMS.forEach((item) => {
  MENU_DEFINITIONS[item.id] = {
    text: item.menuTitle,
    icon: item.menuIcon || ''
  };
});

// ==================== 引擎标题配置 ====================

/**
 * 优化提示词 - 分类标题
 */
const OPTIMIZE_CATEGORY_TITLES = {
  'deep-research': '📚 深度研究',
  'general-conversation': '💬 普通对话',
  'code-writing': '💻 代码编写',
  'content-creation': '📝 内容创作',
  'data-analysis': '📊 数据分析',
  'problem-solving': '🧩 问题解答',
  'brainstorm': '💡 头脑风暴',
  'description-polish': '✨ 优化描述'
};

/**
 * 优化提示词 - 引擎标题
 */
const OPTIMIZE_ENGINE_TITLES = {
  'chatgpt': '🤖 ChatGPT',
  'claude': '🧠 Claude (推荐 Opus)'
};

/**
 * 触触搜百问 - 引擎标题
 */
const TOP_QUESTION_ENGINE_TITLES = {
  'chatgpt': '🤖 ChatGPT',
  'claude': '🧠 Claude',
  'grok': '🦊 Grok',
  'yiyan': '🧠 文心一言'
};

/**
 * 速答壹拾佰 - 引擎标题
 */
const FAST_ANSWER_ENGINE_TITLES = {
  'chatgpt': '🤖 ChatGPT',
  'claude': '🧠 Claude',
  'grok': '🦊 Grok',
  'yiyan': '🧠 文心一言'
};

// ==================== 动态菜单项 ====================

/**
 * 动态搜索菜单项 - 需要显示关键字的菜单项
 * 清空以移除各菜单项后的关键字显示
 * 关键字将统一显示在二级菜单顶部的标签中
 */
const DYNAMIC_SEARCH_MENU_ITEMS = [];

/**
 * 速答菜单项
 */
const FAST_QA_MENU_ITEMS = [
  'ccs-fastqa-root',
  'ccs-fastqa-open-all'
];

// ==================== 文本处理配置 ====================

/**
 * 菜单标题最大长度
 */
const MENU_TITLE_MAX_LENGTH = 20;

/**
 * 关键词最大长度
 */
const KEYWORD_MAX_LENGTH = 50;

/**
 * 需要从标题中移除的后缀
 */
const TITLE_CLEANUP_SUFFIXES = [
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

/**
 * 搜索引擎网站后缀（用于标题清理）
 */
const SEARCH_ENGINE_SUFFIXES = [
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

// ==================== 缓存配置 ====================

/**
 * 缓存过期时间（毫秒）
 */
const CACHE_EXPIRY = {
  TITLE: 30000,      // 标题缓存 30 秒
  KEYWORD: 30000,    // 关键词缓存 30 秒
  SELECTION: 10000   // 选区缓存 10 秒
};

// ==================== 通用主机关键词 ====================

/**
 * 通用主机关键词映射 - 用于判断关键词是否为泛化的主机名
 */
const GENERIC_HOST_KEYWORDS = {
  'chatgpt.com': ['chatgpt', 'chatgpt.com', 'www.chatgpt.com'],
  'claude.ai': ['claude', 'claude.ai', 'www.claude.ai']
};
