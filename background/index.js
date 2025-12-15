importScripts(
  // 工具模块（最先加载）
  './utils/Constants.js',
  './utils/TextUtils.js',

  // 日志系统
  './Logger.js',

  // 关键字同步系统重构模块（新架构）
  './MenuRegistry.js',
  './KeywordSyncManager.js',

  // 新菜单系统核心模块（先加载，供旧模块使用）
  './menuIds.js',
  './StateManager.js',
  './URLBuilder.js',
  './MenuManager.js',
  './menuSystem.js',

  // 新菜单模块（模块化重构）
  './menu/MenuBuilder.js',
  './menu/MenuUpdater.js',
  './menu/MenuHandlers.js',

  // 新事件模块（模块化重构）
  './events/TabEvents.js',
  './events/MessageEvents.js',
  './events/MenuEvents.js',

  // 原有模块（兼容模式）
  './base.js',
  './config.js',
  './icons.js',
  './keywords.js',
  './keywordResolver.js',
  './menuBuilder.js',
  './events.js',
  './menuHandlers.js',

  // 初始化脚本（最后加载，启动兼容模式）
  './init.js'
);
