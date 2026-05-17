importScripts(
  // ==================== 第1层：基础工具 ====================
  './utils/Constants.js',
  './utils/TextUtils.js',
  './utils/TextLimits.js',
  './Logger.js',
  '../shared/menuStructureBuilder.js',

  // ==================== 第2层：核心管理器 ====================
  './MenuRegistry.js',
  './KeywordSyncManager.js',
  './menuIds.js',
  './StateManager.js',
  './URLBuilder.js',
  './menuSystem.js',

  // ==================== 第3层：业务逻辑 ====================
  './config.js',
  './icons.js',
  './keywords.js',
  './keywordResolver.js',
  './KeywordService.js',
  './base.js',

  // ==================== 第3.5层：AI 任务统一抽象 ====================
  './tasks/AITaskRegistry.js',
  './tasks/AITaskHandler.js',

  // ==================== 第4层：菜单 + 事件 ====================
  './menuBuilder.js',
  './menuHandlers.js',
  './voiceOffscreenBridge.js',
  './events.js',

  // ==================== 第5层：初始化 ====================
  './init.js'
);
