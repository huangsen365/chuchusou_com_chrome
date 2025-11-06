/**
 * 菜单 ID 常量管理模块
 *
 * 借鉴参考案例 1 的 MENU_IDS 模式，集中管理所有菜单 ID
 * 避免字符串硬编码，提供类型安全的 ID 访问
 *
 * @module menuIds
 */

/**
 * 菜单 ID 常量对象
 *
 * 所有菜单项的 ID 都在这里统一定义
 * 使用常量代替字符串字面量，避免拼写错误
 */
const MENU_IDS = Object.freeze({
  // 根菜单
  ROOT: 'ccs-main',

  // 快速问答快捷菜单（顶部）
  FASTQA_CHATGPT_QUICK: 'ccs-fastqa-chatgpt-quick',
  FASTQA_CLAUDE_QUICK: 'ccs-fastqa-claude-quick',
  FASTQA_GROK_QUICK: 'ccs-fastqa-grok-quick',

  // 搜索引擎组
  BAIDU: 'ccs-baidu',
  GOOGLE: 'ccs-google',
  TONGYI: 'ccs-tongyi',
  YIYAN: 'ccs-yiyan',

  // AI 对话组
  CHATGPT: 'ccs-chatgpt',
  CLAUDE: 'ccs-claude',
  GROK: 'ccs-grok',

  // 通用搜索组
  ZHIHU: 'ccs-zhihu',
  WEIXIN: 'ccs-weixin',
  TAOBAO: 'ccs-taobao',
  JD: 'ccs-jd',
  SOV2EX: 'ccs-sov2ex',
  GOOGLE_TRANSLATE: 'ccs-google-translate',
  CHUCHUSOU: 'ccs-chuchusou',

  // 高级功能组
  TOP100_ROOT: 'ccs-top100-root',
  TOP100_OPEN_ALL: 'ccs-top100-open-all',
  FASTQA_ROOT: 'ccs-fastqa-root',
  FASTQA_OPEN_ALL: 'ccs-fastqa-open-all',
  OPTIMIZE_ROOT: 'ccs-optimize-root',

  // 工具组
  COPY: 'ccs-copy',
  BASE64: 'ccs-base64',
  MD5: 'ccs-md5',
  URL_ENCODE: 'ccs-url-encode',

  // 文本转换组
  UPPER: 'ccs-upper',
  LOWER: 'ccs-lower',

  // 面板控制
  SHOW_POPOVER: 'ccs-show-popover'
});

/**
 * 菜单 ID 分组
 *
 * 将相关的菜单 ID 组织成逻辑分组
 * 便于批量操作和管理
 */
const MENU_ID_GROUPS = Object.freeze({
  // 需要动态标题的菜单项
  DYNAMIC_TITLE: [
    MENU_IDS.ROOT,
    MENU_IDS.CHATGPT,
    MENU_IDS.CLAUDE,
    MENU_IDS.GROK,
    MENU_IDS.CHUCHUSOU,
    MENU_IDS.FASTQA_CHATGPT_QUICK,
    MENU_IDS.FASTQA_CLAUDE_QUICK,
    MENU_IDS.FASTQA_GROK_QUICK,
    MENU_IDS.FASTQA_ROOT,
    MENU_IDS.FASTQA_OPEN_ALL
  ],

  // 快速问答快捷菜单
  FAST_QA_QUICK: [
    MENU_IDS.FASTQA_CHATGPT_QUICK,
    MENU_IDS.FASTQA_CLAUDE_QUICK,
    MENU_IDS.FASTQA_GROK_QUICK
  ],

  // 搜索引擎
  SEARCH_ENGINES: [
    MENU_IDS.BAIDU,
    MENU_IDS.GOOGLE,
    MENU_IDS.TONGYI,
    MENU_IDS.YIYAN
  ],

  // AI 对话
  AI_CHAT: [
    MENU_IDS.CHATGPT,
    MENU_IDS.CLAUDE,
    MENU_IDS.GROK
  ],

  // 通用搜索
  GENERAL_SEARCH: [
    MENU_IDS.ZHIHU,
    MENU_IDS.WEIXIN,
    MENU_IDS.TAOBAO,
    MENU_IDS.JD,
    MENU_IDS.SOV2EX,
    MENU_IDS.GOOGLE_TRANSLATE,
    MENU_IDS.CHUCHUSOU
  ],

  // 高级功能（子菜单）
  ADVANCED: [
    MENU_IDS.TOP100_ROOT,
    MENU_IDS.FASTQA_ROOT,
    MENU_IDS.OPTIMIZE_ROOT
  ],

  // 工具
  TOOLS: [
    MENU_IDS.COPY,
    MENU_IDS.BASE64,
    MENU_IDS.MD5,
    MENU_IDS.URL_ENCODE
  ],

  // 文本转换
  TRANSFORMS: [
    MENU_IDS.UPPER,
    MENU_IDS.LOWER
  ]
});

/**
 * 菜单 ID 前缀常量
 */
const MENU_ID_PREFIXES = Object.freeze({
  TOP100: 'ccs-top100-',
  FASTQA: 'ccs-fastqa-',
  OPTIMIZE: 'ccs-optimize-',
  CCS: 'ccs-'
});

/**
 * 检查菜单 ID 是否属于某个前缀
 *
 * @param {string} menuId - 菜单 ID
 * @param {string} prefix - 前缀
 * @returns {boolean} 是否匹配
 */
function hasMenuIdPrefix(menuId, prefix) {
  return typeof menuId === 'string' && menuId.startsWith(prefix);
}

/**
 * 检查是否是触触搜百问菜单
 *
 * @param {string} menuId - 菜单 ID
 * @returns {boolean}
 */
function isTop100Menu(menuId) {
  return hasMenuIdPrefix(menuId, MENU_ID_PREFIXES.TOP100);
}

/**
 * 检查是否是速答壹拾佰菜单
 *
 * @param {string} menuId - 菜单 ID
 * @returns {boolean}
 */
function isFastQAMenu(menuId) {
  return hasMenuIdPrefix(menuId, MENU_ID_PREFIXES.FASTQA);
}

/**
 * 检查是否是优化提示词菜单
 *
 * @param {string} menuId - 菜单 ID
 * @returns {boolean}
 */
function isOptimizeMenu(menuId) {
  return hasMenuIdPrefix(menuId, MENU_ID_PREFIXES.OPTIMIZE);
}

/**
 * 检查是否需要动态标题
 *
 * @param {string} menuId - 菜单 ID
 * @returns {boolean}
 */
function needsDynamicTitle(menuId) {
  return MENU_ID_GROUPS.DYNAMIC_TITLE.includes(menuId);
}

/**
 * 获取所有菜单 ID（数组形式）
 *
 * @returns {string[]}
 */
function getAllMenuIds() {
  return Object.values(MENU_IDS);
}

/**
 * 验证菜单 ID 是否有效
 *
 * @param {string} menuId - 菜单 ID
 * @returns {boolean}
 */
function isValidMenuId(menuId) {
  return getAllMenuIds().includes(menuId);
}

/**
 * 根据常量名获取菜单 ID
 *
 * @param {string} constantName - 常量名（如 'ROOT', 'CHATGPT'）
 * @returns {string|null}
 */
function getMenuIdByConstant(constantName) {
  return MENU_IDS[constantName] || null;
}

/**
 * 根据菜单 ID 获取常量名
 *
 * @param {string} menuId - 菜单 ID
 * @returns {string|null}
 */
function getConstantByMenuId(menuId) {
  for (const [key, value] of Object.entries(MENU_IDS)) {
    if (value === menuId) {
      return key;
    }
  }
  return null;
}
