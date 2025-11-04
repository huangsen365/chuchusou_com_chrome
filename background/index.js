importScripts(
  // 日志系统（最先加载）
  './Logger.js',

  // 新菜单系统核心模块（先加载，供旧模块使用）
  './menuIds.js',
  './StateManager.js',
  './URLBuilder.js',
  './MenuManager.js',
  './menuSystem.js',

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
