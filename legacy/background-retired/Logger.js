/**
 * 日志系统
 *
 * 提供结构化的日志记录功能
 * 支持不同日志级别和模块化管理
 *
 * @class Logger
 */
class Logger {
  /**
   * 日志级别枚举
   */
  static LEVELS = Object.freeze({
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 999
  });

  /**
   * 日志级别名称
   */
  static LEVEL_NAMES = Object.freeze({
    0: 'DEBUG',
    1: 'INFO',
    2: 'WARN',
    3: 'ERROR',
    999: 'NONE'
  });

  /**
   * 全局配置
   */
  static globalConfig = {
    enabled: true,
    level: Logger.LEVELS.DEBUG,
    timestamp: true,
    colors: true,
    prefix: '[触触搜]'
  };

  /**
   * 日志记录存储（用于调试）
   */
  static records = [];
  static maxRecords = 1000;

  /**
   * 构造函数
   *
   * @param {string} moduleName - 模块名称
   * @param {Object} options - 选项
   */
  constructor(moduleName, options = {}) {
    this.moduleName = moduleName || 'Unknown';
    this.options = {
      enabled: options.enabled !== false,
      level: options.level !== undefined ? options.level : Logger.globalConfig.level,
      ...options
    };

    this.sequence = 0;
  }

  /**
   * 设置全局日志级别
   *
   * @param {number} level - 日志级别
   */
  static setGlobalLevel(level) {
    Logger.globalConfig.level = level;
  }

  /**
   * 启用/禁用全局日志
   *
   * @param {boolean} enabled
   */
  static setGlobalEnabled(enabled) {
    Logger.globalConfig.enabled = enabled;
  }

  /**
   * 获取日志级别名称
   *
   * @param {number} level
   * @returns {string}
   */
  static getLevelName(level) {
    return Logger.LEVEL_NAMES[level] || 'UNKNOWN';
  }

  /**
   * 检查是否应该记录日志
   *
   * @param {number} level
   * @returns {boolean}
   * @private
   */
  _shouldLog(level) {
    if (!Logger.globalConfig.enabled || !this.options.enabled) {
      return false;
    }

    const effectiveLevel = this.options.level !== undefined
      ? this.options.level
      : Logger.globalConfig.level;

    return level >= effectiveLevel;
  }

  /**
   * 格式化日志消息
   *
   * @param {number} level
   * @param {string} message
   * @param {*} data
   * @returns {Object}
   * @private
   */
  _formatLog(level, message, data) {
    const timestamp = Date.now();
    const levelName = Logger.getLevelName(level);

    const record = {
      level: levelName,
      module: this.moduleName,
      message,
      data,
      timestamp,
      sequence: ++this.sequence
    };

    // 存储日志记录
    Logger.records.push(record);
    if (Logger.records.length > Logger.maxRecords) {
      Logger.records.shift();
    }

    return record;
  }

  /**
   * 输出日志到控制台
   *
   * @param {number} level
   * @param {string} message
   * @param {*} data
   * @private
   */
  _output(level, message, data) {
    const record = this._formatLog(level, message, data);

    // 构建输出字符串
    let output = '';

    if (Logger.globalConfig.prefix) {
      output += `${Logger.globalConfig.prefix} `;
    }

    if (Logger.globalConfig.timestamp) {
      const time = new Date(record.timestamp).toISOString().split('T')[1].replace('Z', '');
      output += `${time} `;
    }

    output += `[${record.level}]`;
    output += `[${record.module}]`;
    output += ` ${message}`;

    // 选择合适的控制台方法
    const consoleMethod = {
      [Logger.LEVELS.DEBUG]: 'log',
      [Logger.LEVELS.INFO]: 'info',
      [Logger.LEVELS.WARN]: 'warn',
      [Logger.LEVELS.ERROR]: 'error'
    }[level] || 'log';

    // 输出
    if (data !== undefined && data !== null) {
      console[consoleMethod](output, data);
    } else {
      console[consoleMethod](output);
    }
  }

  /**
   * DEBUG 级别日志
   *
   * @param {string} message
   * @param {*} data
   */
  debug(message, data) {
    if (this._shouldLog(Logger.LEVELS.DEBUG)) {
      this._output(Logger.LEVELS.DEBUG, message, data);
    }
  }

  /**
   * INFO 级别日志
   *
   * @param {string} message
   * @param {*} data
   */
  info(message, data) {
    if (this._shouldLog(Logger.LEVELS.INFO)) {
      this._output(Logger.LEVELS.INFO, message, data);
    }
  }

  /**
   * WARN 级别日志
   *
   * @param {string} message
   * @param {*} data
   */
  warn(message, data) {
    if (this._shouldLog(Logger.LEVELS.WARN)) {
      this._output(Logger.LEVELS.WARN, message, data);
    }
  }

  /**
   * ERROR 级别日志
   *
   * @param {string} message
   * @param {*} data
   */
  error(message, data) {
    if (this._shouldLog(Logger.LEVELS.ERROR)) {
      this._output(Logger.LEVELS.ERROR, message, data);
    }
  }

  /**
   * 分组开始
   *
   * @param {string} label
   */
  group(label) {
    if (this._shouldLog(Logger.LEVELS.DEBUG)) {
      console.group(`${Logger.globalConfig.prefix} [${this.moduleName}] ${label}`);
    }
  }

  /**
   * 分组结束
   */
  groupEnd() {
    if (this._shouldLog(Logger.LEVELS.DEBUG)) {
      console.groupEnd();
    }
  }

  /**
   * 计时开始
   *
   * @param {string} label
   */
  time(label) {
    if (this._shouldLog(Logger.LEVELS.DEBUG)) {
      console.time(`${Logger.globalConfig.prefix} [${this.moduleName}] ${label}`);
    }
  }

  /**
   * 计时结束
   *
   * @param {string} label
   */
  timeEnd(label) {
    if (this._shouldLog(Logger.LEVELS.DEBUG)) {
      console.timeEnd(`${Logger.globalConfig.prefix} [${this.moduleName}] ${label}`);
    }
  }

  /**
   * 表格输出
   *
   * @param {*} data
   */
  table(data) {
    if (this._shouldLog(Logger.LEVELS.DEBUG)) {
      console.table(data);
    }
  }

  /**
   * 获取日志历史
   *
   * @param {Object} filters - 过滤条件
   * @param {string} [filters.module] - 模块名称
   * @param {string} [filters.level] - 日志级别
   * @param {number} [filters.limit] - 限制数量
   * @returns {Array}
   */
  static getHistory(filters = {}) {
    let records = [...Logger.records];

    if (filters.module) {
      records = records.filter(r => r.module === filters.module);
    }

    if (filters.level) {
      records = records.filter(r => r.level === filters.level);
    }

    if (filters.limit) {
      records = records.slice(-filters.limit);
    }

    return records;
  }

  /**
   * 清空日志历史
   */
  static clearHistory() {
    Logger.records = [];
  }

  /**
   * 导出日志
   *
   * @returns {string} JSON 字符串
   */
  static export() {
    return JSON.stringify({
      exportTime: new Date().toISOString(),
      records: Logger.records
    }, null, 2);
  }
}

// ============================================
// 预定义的模块 Logger
// ============================================

const loggers = {
  menuSystem: new Logger('MenuSystem'),
  stateManager: new Logger('StateManager'),
  urlBuilder: new Logger('URLBuilder'),
  menuManager: new Logger('MenuManager'),
  menuBuilder: new Logger('MenuBuilder'),
  menuHandlers: new Logger('MenuHandlers'),
  events: new Logger('Events'),
  init: new Logger('Init')
};

/**
 * 获取模块 Logger
 *
 * @param {string} moduleName
 * @returns {Logger}
 */
function getLogger(moduleName) {
  if (loggers[moduleName]) {
    return loggers[moduleName];
  }

  // 创建新的 Logger
  loggers[moduleName] = new Logger(moduleName);
  return loggers[moduleName];
}

// ============================================
// 全局调试命令
// ============================================

if (typeof globalThis !== 'undefined') {
  globalThis._loggerDebug = {
    // 设置日志级别
    setLevel: (level) => {
      if (typeof level === 'string') {
        const levelValue = Logger.LEVELS[level.toUpperCase()];
        if (levelValue !== undefined) {
          Logger.setGlobalLevel(levelValue);
          console.log(`日志级别已设置为: ${level.toUpperCase()}`);
        }
      } else {
        Logger.setGlobalLevel(level);
        console.log(`日志级别已设置为: ${Logger.getLevelName(level)}`);
      }
    },

    // 启用/禁用日志
    enable: () => {
      Logger.setGlobalEnabled(true);
      console.log('日志已启用');
    },

    disable: () => {
      Logger.setGlobalEnabled(false);
      console.log('日志已禁用');
    },

    // 查看日志历史
    history: (filters) => {
      return Logger.getHistory(filters);
    },

    // 清空日志
    clear: () => {
      Logger.clearHistory();
      console.log('日志历史已清空');
    },

    // 导出日志
    export: () => {
      const data = Logger.export();
      console.log('日志已导出（复制下面的内容）：');
      console.log(data);
      return data;
    },

    // 查看所有可用的 Logger
    loggers: () => {
      return Object.keys(loggers);
    }
  };

  console.log('[Logger] 🔧 调试命令已注册:');
  console.log('  - _loggerDebug.setLevel(level) - 设置日志级别 (DEBUG/INFO/WARN/ERROR)');
  console.log('  - _loggerDebug.enable() - 启用日志');
  console.log('  - _loggerDebug.disable() - 禁用日志');
  console.log('  - _loggerDebug.history(filters) - 查看日志历史');
  console.log('  - _loggerDebug.clear() - 清空日志');
  console.log('  - _loggerDebug.export() - 导出日志');
  console.log('  - _loggerDebug.loggers() - 查看所有模块');
}

// ============================================
// 兼容函数：logMenuEvent
// ============================================

/**
 * 记录菜单事件（兼容函数）
 * @param {string} eventName - 事件名称
 * @param {Object} data - 事件数据
 */
function logMenuEvent(eventName, data = {}) {
  // 检查是否启用调试
  const debugEnabled = typeof BG_DEBUG !== 'undefined' ? BG_DEBUG : false;
  if (!debugEnabled) return;

  const logger = loggers.menuSystem || new Logger('MenuSystem');
  logger.debug(`[${eventName}]`, data);
}

// ============================================
// 导出到全局
// ============================================

globalThis.Logger = Logger;
globalThis.getLogger = getLogger;
globalThis.logMenuEvent = logMenuEvent;
globalThis.loggers = loggers;
