/**
 * chrome.storage.local 的 ccs_* 键名总表 —— 全扩展唯一登记处。
 *
 * 加载：SW importScripts 第一个、内容脚本 manifest 第一个、popup / sidepanel bundle 第一个，
 * 所以这些地方都直接用 globalThis.CCSStorageKeys.X，不要再写 'ccs_xxx' 字面量。
 * 例外（加载时机早于本文件，只能写字面量，值由 scripts/verify-storage-keys.mjs 对照本表）：
 *   popup/popup.boot.js、sidepanel/sidepanel.boot.js（首屏先于 bundle 运行）、src/**\/*.ts（SW bundle）。
 *
 * 新增键：在这里登记 → 用 CCSStorageKeys 引用 → npm test（守卫会拦下未登记的 ccs_ 字面量）。
 */
(function (root) {
  'use strict';

  const KEYS = {
    // ---- 设置 / 开关 ----
    SETTINGS: 'ccs_settings',                    // 悬浮面板设置（content 读，popup 设置页写）
    DEBUG: 'ccs_debug',                          // 调试日志开关（全部上下文）
    VOICE_ENABLED: 'ccs_voice_enabled',          // 侧边栏语音输入开关
    BLACKLIST: 'ccs_blacklist',                  // 站点黑名单
    SHORTCUT_KEY: 'ccs_shortcut_key',            // 快捷键
    MENU_ICON_SUPPORT: 'ccs_menu_icon_supported', // 右键菜单图标探测失败后持久化 false，之后跳过图标更新
    SCHEMA_VERSION: 'ccs_schema_version',        // 存储结构版本（storageDefaults / SW init 写默认值）
    VOICE_MIC_GRANTED_AT: 'ccs_voice_mic_granted_at', // 麦克风授权引导页记录的授权时间

    // ---- 封面生成器（popup / sidepanel / 右键菜单 / 长文封面共用）----
    COVER_PIN: 'ccs_sidepanel_pinned_action',    // 侧边栏置顶的封面风格 { taskId, categoryId, ... }
    COVER_CUSTOM_PURPOSE: 'ccs_cover_custom_purpose', // 自定义风格预设库（textarea 全文）
    COVER_CUSTOM_LINE: 'ccs_cover_custom_selected_line', // 当前应用的自定义风格那一行
    COVER_RATIO: 'ccs_cover_aspect_ratio',       // 当前比例，如 "5:2"
    COVER_CUSTOM_RATIOS: 'ccs_cover_custom_ratios', // 用户保存的自定义比例
    COVER_PALETTE_COUNTER: 'ccs_cover_palette_counter', // 墨清配色轮换计数

    // ---- 长文改写 ----
    REWRITE_VARIETY_COUNTER: 'ccs_rewrite_variety_counter', // 每篇形式安排轮换计数
    REWRITE_RECENT_CONCEPTS: 'ccs_rewrite_recent_concepts', // 近期用过的概念（去重记忆）

    // ---- 其它 ----
    PROMPT_LIBRARY: 'ccs_prompt_library',        // popup 提示词库
    VOICE_HISTORY: 'ccs_voice_history',          // 语音输入历史
    VOICE_INTRO_SEEN: 'ccs_voice_intro_seen',    // 语音引导已看过
    TRACE_BUFFER: 'ccs_trace_buffer',            // shared/logger 调试 trace 环形缓冲
    AIFILL_DIAG: 'ccs_aifill_diag'               // AI 填入诊断开关
  };

  // 动态键前缀：实际键 = 前缀 + id
  const PREFIX = {
    KEYWORD: 'ccs_kw_',                          // + tabId：popup / sidepanel 首屏关键字缓存
    SIDEPANEL_OPEN: 'ccs_sp_open_',              // + windowId：侧边栏是否打开
    X_ARTICLE_DRAFT: 'ccs_x_article_draft_',     // + taskId：X 长文草稿任务
    URL_RECOVERY: 'ccs_url_recovery_',           // + id：431/404 恢复记录
    URL_RECOVERY_TAB: 'ccs_url_recovery_tab_',   // + tabId
    AI_PENDING_PROMPT: 'ccs_ai_pending_prompt_', // + pendingId：待投递 AI 提示词
    AI_PENDING_TAB: 'ccs_ai_pending_tab_'        // + tabId
  };

  // 不是存储键，但同属 ccs_ 命名空间：AI relay 在目标站 URL 上带的待投递 id 参数
  const URL_PARAM = {
    RELAY_ID: 'ccs_pp'
  };

  root.CCSStorageKeys = Object.freeze({
    ...KEYS,
    PREFIX: Object.freeze(PREFIX),
    URL_PARAM: Object.freeze(URL_PARAM)
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
