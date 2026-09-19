importScripts(
  // ==================== 第1层：基础工具 ====================
  './utils/Constants.js',
  './utils/TextUtils.js',
  './utils/TextLimits.js',
  './chatgptPromptRelay.js',
  './urlSafety.js',
  '../shared/promptLanguage.js',
  '../shared/rewriteVariety.js',
  // ↓ Logger.js 已被 src/background/Logger.ts (via baseBridge) 取代 ↓
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
  // ↓ base.js 已被 src/background/baseBridge.ts 完全替代 (TS port) ↓

  // ==================== 第3.5层：AI 任务统一抽象 ====================
  './tasks/AITaskRegistry.js',
  './tasks/AITaskHandler.js',
  './articleActions.js',

  // ==================== 第4层：菜单 + 事件 ====================
  // ↓ menuBuilder.js 已被 src/background/menuBuilderAttach.ts 取代 ↓
  // ↓ menuHandlers.js 已被 src/background/menuHandlersAttach.ts 取代 ↓
  // ↓ voiceOffscreenBridge.js 已被 src/background/voiceOffscreenBridge.ts 取代 ↓
  './events.js',

  // ==================== 第5层：初始化 ====================
  // ↓ init.js 已被 src/background/initAttach.ts 取代 ↓
);
