importScripts(
  // ==================== 第1层：基础工具 ====================
  // 常量和工具函数（最先加载）
  './utils/Constants.js',
  './utils/TextUtils.js',
  './utils/TextLimits.js',

  // 日志系统
  './Logger.js',

  // ==================== 第2层：核心管理器 ====================
  // 关键字同步系统
  './MenuRegistry.js',
  './KeywordSyncManager.js',

  // 菜单系统核心
  './menuIds.js',
  './StateManager.js',
  './URLBuilder.js',
  './MenuManager.js',
  './menuSystem.js',

  // ==================== 第3层：原有业务逻辑 ====================
  // 这些模块定义了很多函数，需要先加载供后续模块使用
  './config.js',        // 配置加载函数
  './icons.js',         // 图标处理
  './keywords.js',      // 关键词提取
  './keywordResolver.js', // 关键词解析
  './base.js',          // 核心业务函数（最多依赖）

  // ==================== 第3.5层：AI 任务统一抽象 ====================
  // 把速答/百问/优化抽象成 AITask；依赖 Constants / TextLimits / isMenuEnabled
  './tasks/AITaskRegistry.js',
  './tasks/AITaskHandler.js',

  './menuBuilder.js',   // 菜单构建
  './menuHandlers.js',  // 菜单处理
  './events.js',        // 事件处理

  // ==================== 第4层：新架构模块 ====================
  // 这些模块可能调用第3层的函数
  './menu/MenuBuilder.js',
  './menu/MenuUpdater.js',
  './menu/MenuHandlers.js',

  './events/TabEvents.js',
  './events/MessageEvents.js',
  './events/MenuEvents.js',

  // ==================== 第5层：初始化 ====================
  './init.js'
);
