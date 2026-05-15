/**
 * 触触搜扩展初始化脚本
 *
 * 在兼容模式下初始化新菜单系统
 * 保留旧系统的所有功能，同时提供新工具的增强能力
 *
 * @module init
 */

// ============================================
// 初始化配置
// ============================================

const INIT_CONFIG = {
  // 是否使用新系统（false = 兼容模式）
  useNewSystem: false,

  // 是否启用调试日志
  debug: true,

  // 是否自动清理过期状态
  autoCleanup: true,

  // 是否启用性能监控
  enablePerformanceMonitoring: false
};

// ============================================
// 性能监控
// ============================================

let performanceMetrics = {
  initStartTime: Date.now(),
  initEndTime: null,
  menuBuildStartTime: null,
  menuBuildEndTime: null
};

function logPerformance(stage, duration) {
  if (!INIT_CONFIG.enablePerformanceMonitoring) return;

  console.log(`[Performance] ${stage}: ${duration}ms`);
}

// ============================================
// Prompt / 配置缓存预热
// ============================================

// 首次冷启动时，popup/sidepanel 第一次拉 getMenuStructure 会触发 4 个 prompts/*.json
// 加 unifiedMenuConfig + engines.json 共 6 个 fetch（loaders 用 globalThis.*Config 内存缓存，
// 首次为空全走 fetch）。把这些 fetch 摊到 SW 启动时并行触发，等用户点 popup 时全是 cache hit。
//
// 幂等：每个 loader 内部 `if (globalThis.xxxConfig) return ...` 已经做了去重，重复调用零成本。
let _prewarmStarted = false;
function prewarmPromptConfigs() {
  if (_prewarmStarted) return Promise.resolve();
  _prewarmStarted = true;
  const loaders = [
    'loadOptimizedPromptConfig',
    'loadCoverPromptConfig',
    'loadTopQuestionsConfig',
    'loadFastAnswersConfig',
    'loadUnifiedMenuConfig',
    'loadEnginesConfig'
  ];
  const startedAt = Date.now();
  const tasks = loaders
    .map((name) => (typeof globalThis[name] === 'function' ? globalThis[name]() : null))
    .filter(Boolean);
  return Promise.allSettled(tasks).then((results) => {
    if (INIT_CONFIG.debug) {
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const ms = Date.now() - startedAt;
      console.log(`[Init] 🔥 prompt 缓存预热完成 (${ok}/${results.length}, ${ms}ms)`);
    }
  });
}

// ============================================
// 初始化流程
// ============================================

/**
 * 初始化扩展
 * @returns {Promise<void>}
 */
async function initializeExtension() {
  try {
    console.log('[Init] 🚀 触触搜扩展初始化开始...');
    console.log('[Init] 模式:', INIT_CONFIG.useNewSystem ? '新系统' : '兼容模式');

    // 1. 初始化新菜单系统工具
    await initializeMenuSystem();

    // 2. 使用旧系统创建菜单（兼容模式）
    if (!INIT_CONFIG.useNewSystem) {
      performanceMetrics.menuBuildStartTime = Date.now();

      // 调用旧系统的菜单创建函数
      if (typeof createContextMenus === 'function') {
        await createContextMenus();

        performanceMetrics.menuBuildEndTime = Date.now();
        const buildDuration = performanceMetrics.menuBuildEndTime - performanceMetrics.menuBuildStartTime;
        logPerformance('Menu Build (Old System)', buildDuration);

        console.log('[Init] ✅ 菜单创建完成（使用旧系统）');
      } else {
        console.warn('[Init] ⚠️ createContextMenus 函数不存在');
      }
    }

    // 3. 设置清理定时器
    if (INIT_CONFIG.autoCleanup) {
      setupCleanupTasks();
    }

    performanceMetrics.initEndTime = Date.now();
    const totalDuration = performanceMetrics.initEndTime - performanceMetrics.initStartTime;

    console.log('[Init] ✅ 初始化完成！');
    console.log(`[Init] ⏱️ 总耗时: ${totalDuration}ms`);

    // 4. 打印系统状态
    printSystemStatus();

  } catch (error) {
    console.error('[Init] ❌ 初始化失败:', error);
    console.error(error.stack);
  }
}

/**
 * 初始化新菜单系统
 * @returns {Promise<void>}
 */
async function initializeMenuSystem() {
  console.log('[Init] 初始化新菜单系统工具...');

  try {
    await MenuSystem.init({
      useNewSystem: INIT_CONFIG.useNewSystem,
      debug: INIT_CONFIG.debug
    });

    console.log('[Init] ✅ 新菜单系统工具已就绪');

    // 初始化关键字同步系统（新架构）
    if (typeof initKeywordSyncSystem === 'function') {
      initKeywordSyncSystem();
      console.log('[Init] ✅ 关键字同步系统已初始化');
    }

    // 导出全局访问点（方便调试）
    if (INIT_CONFIG.debug) {
      globalThis._debugMenuSystem = {
        stateManager: MenuSystem.getStateManager(),
        urlBuilder: MenuSystem.getURLBuilder(),
        menuManager: MenuSystem.getMenuManager(),
        config: MenuSystem.getSystemConfig(),
        // 新增：关键字同步系统调试接口
        menuRegistry: typeof menuRegistry !== 'undefined' ? menuRegistry : null,
        keywordSyncManager: typeof keywordSyncManager !== 'undefined' ? keywordSyncManager : null
      };

      console.log('[Init] 🔧 调试工具已挂载到 _debugMenuSystem');
    }

  } catch (error) {
    console.error('[Init] 新菜单系统初始化失败:', error);
    throw error;
  }
}

/**
 * 设置清理任务
 */
function setupCleanupTasks() {
  // 每 5 分钟清理一次过期的标签页状态
  setInterval(() => {
    const stateManager = MenuSystem.getStateManager();
    if (stateManager) {
      const count = stateManager.cleanupExpiredStates();
      if (count > 0) {
        console.log(`[Init] 🧹 清理了 ${count} 个过期的标签页状态`);
      }
    }
  }, 5 * 60 * 1000);

  console.log('[Init] ✅ 自动清理任务已设置（每 5 分钟）');
}

/**
 * 打印系统状态
 */
function printSystemStatus() {
  const stateManager = MenuSystem.getStateManager();
  const urlBuilder = MenuSystem.getURLBuilder();
  const systemConfig = MenuSystem.getSystemConfig();

  console.log('[Init] 📊 系统状态:');

  if (stateManager) {
    const stats = stateManager.getStats();
    console.log('  - StateManager:', {
      currentState: stats.currentState.hasContent ? '有数据' : '空',
      tabStates: stats.tabStates.total,
      autoCleanup: '已启用'
    });
  }

  if (urlBuilder) {
    const stats = urlBuilder.getStats();
    console.log('  - URLBuilder:', {
      templates: stats.total,
      menuIds: `${stats.menuIds.length} 个`
    });
  }

  if (systemConfig) {
    console.log('  - Config:', {
      version: systemConfig.version,
      groups: systemConfig.groups?.length || 0
    });
  }

  console.log('  - 模式:', INIT_CONFIG.useNewSystem ? '新系统' : '兼容模式');
  console.log('  - 调试:', INIT_CONFIG.debug ? '启用' : '禁用');
}

// ============================================
// 事件监听器
// ============================================

/**
 * 扩展安装/更新时触发
 *
 * 注意：由于 events.js 已经注册了 onInstalled 监听器来调用 createContextMenus()，
 * 这里我们只初始化新菜单系统工具，不重复创建菜单。
 * 监听器执行顺序：后注册的先执行，所以这个会在 events.js 的监听器之前运行。
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Init] onInstalled 事件触发:', details.reason);

  // 只初始化新菜单系统工具（不创建菜单）
  try {
    await initializeMenuSystem();

    if (INIT_CONFIG.autoCleanup) {
      setupCleanupTasks();
    }

    // 打印安装/更新信息
    if (details.reason === 'install') {
      console.log('[Init] 🎉 触触搜扩展安装成功！');
    } else if (details.reason === 'update') {
      console.log(`[Init] 🔄 触触搜扩展已更新至 v${chrome.runtime.getManifest().version}`);
    }

    console.log('[Init] ✅ 新菜单系统工具初始化完成');
    console.log('[Init] 📝 等待旧系统创建菜单（由 events.js 触发）...');

    // 预热 prompt / 配置缓存（fire-and-forget），让用户首次点 popup/sidepanel 时全是 cache hit
    prewarmPromptConfigs();

  } catch (error) {
    console.error('[Init] ❌ 初始化失败:', error);
  }
});

/**
 * 浏览器启动时触发
 */
chrome.runtime.onStartup.addListener(async () => {
  console.log('[Init] onStartup 事件触发');

  // 只初始化新菜单系统工具（不创建菜单）
  try {
    INIT_CONFIG.debug = false; // 关闭调试日志以提升性能
    await initializeMenuSystem();

    if (INIT_CONFIG.autoCleanup) {
      setupCleanupTasks();
    }

    console.log('[Init] ✅ 新菜单系统工具初始化完成');

    // 预热 prompt / 配置缓存（fire-and-forget），让用户首次点 popup/sidepanel 时全是 cache hit
    prewarmPromptConfigs();

  } catch (error) {
    console.error('[Init] ❌ 初始化失败:', error);
  }
});

// 模块顶层兜底：SW 被消息事件唤醒（既不是 install 也不是 startup）时也跑一次。
// _prewarmStarted 保证幂等，重复调用零成本。
prewarmPromptConfigs();

// ============================================
// 调试命令（仅在调试模式下）
// ============================================

if (INIT_CONFIG.debug) {
  /**
   * 调试命令：重建菜单
   */
  globalThis._debugRebuildMenus = async function() {
    console.log('[Debug] 重建菜单...');
    await MenuSystem.rebuildMenus();
    console.log('[Debug] 菜单重建完成');
  };

  /**
   * 调试命令：查看状态
   */
  globalThis._debugShowState = function() {
    const stateManager = MenuSystem.getStateManager();
    if (stateManager) {
      console.log('[Debug] 当前状态:', stateManager.getCurrentState());
      console.log('[Debug] 统计信息:', stateManager.getStats());
    }
  };

  /**
   * 调试命令：查看 URL 模板
   */
  globalThis._debugShowUrlTemplates = function() {
    const urlBuilder = MenuSystem.getURLBuilder();
    if (urlBuilder) {
      console.log('[Debug] URL 模板:', urlBuilder.getStats());
    }
  };

  /**
   * 调试命令：测试 URL 构建
   */
  globalThis._debugTestUrl = function(menuId, params = {}) {
    const urlBuilder = MenuSystem.getURLBuilder();
    if (urlBuilder) {
      const url = urlBuilder.build(menuId, params);
      console.log(`[Debug] ${menuId} => ${url}`);
      return url;
    }
  };

  console.log('[Init] 🔧 调试命令已注册:');
  console.log('  - _debugRebuildMenus() - 重建菜单');
  console.log('  - _debugShowState() - 查看状态');
  console.log('  - _debugShowUrlTemplates() - 查看 URL 模板');
  console.log('  - _debugTestUrl(menuId, params) - 测试 URL 构建');
  console.log('  - _debugMenuSystem - 访问核心组件');
}

// ============================================
// 错误处理
// ============================================

/**
 * 全局错误处理
 */
self.addEventListener('error', (event) => {
  console.error('[Init] 全局错误:', event.error);
});

/**
 * 未捕获的 Promise 错误
 */
self.addEventListener('unhandledrejection', (event) => {
  console.error('[Init] 未处理的 Promise 错误:', event.reason);
});

// ============================================
// 导出（供其他模块使用）
// ============================================

if (typeof globalThis !== 'undefined') {
  globalThis.ExtensionInit = {
    config: INIT_CONFIG,
    metrics: performanceMetrics,
    reinitialize: initializeExtension
  };
}
