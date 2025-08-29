(() => {
  'use strict';

  // 确保全局命名空间存在
  window.CCSModules = window.CCSModules || {};

  // 命令定义
  const commands = {
    base64: (args) => {
      if (args[0] === '-d') {
        try {
          return atob(args.slice(1).join(' '));
        } catch (e) {
          return '解码失败: 无效的 base64 字符串';
        }
      } else {
        return btoa(unescape(encodeURIComponent(args.join(' '))));
      }
    },
    md5: (args) => {
      const text = args.join(' ');
      let hash = 0;
      for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return Math.abs(hash).toString(16).padStart(32, '0').slice(0, 32);
    },
    url: (args) => {
      if (args[0] === 'decode') {
        return decodeURIComponent(args.slice(1).join(' '));
      } else {
        return encodeURIComponent(args.join(' '));
      }
    },
    upper: (args) => args.join(' ').toUpperCase(),
    lower: (args) => args.join(' ').toLowerCase(),
    search: (args) => {
      const query = args.join(' ');
      window.open(`https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${encodeURIComponent(query)}`, '_blank');
      return `正在搜索: ${query}`;
    },
    copy: (args) => {
      const text = args.join(' ');
      navigator.clipboard.writeText(text).then(() => {
        if (window.showToast) {
          window.showToast('已复制到剪贴板');
        }
      }).catch(() => {
        if (window.showToast) {
          window.showToast('复制失败');
        }
      });
      return '已复制到剪贴板';
    }
  };

  // Commands 模块 - 命令执行系统
  const Commands = {
    // 获取所有命令
    getCommands() {
      return commands;
    },

    // 执行单个命令
    execute(cmd, args) {
      if (commands[cmd]) {
        return commands[cmd](args);
      }
      return null;
    },

    // 解析并执行命令行
    parseAndExecute(inputValue, selectedText = '') {
      if (!inputValue || !inputValue.trim()) return null;

      const trimmedInput = inputValue.trim();
      
      // 解析命令
      if (trimmedInput.startsWith('/')) {
        const parts = trimmedInput.slice(1).split(' ');
        const cmd = parts[0];
        const args = parts.slice(1);

        if (commands[cmd]) {
          // 如果没有参数，使用选中的文本
          const finalArgs = args.length ? args : [selectedText];
          return {
            success: true,
            result: commands[cmd](finalArgs),
            command: cmd
          };
        } else {
          return {
            success: false,
            error: `未知命令: ${cmd}`
          };
        }
      }
      
      // 不是命令
      return null;
    },

    // 执行命令并处理结果
    executeCommand(shadowRoot, selectedText = '') {
      const input = shadowRoot?.querySelector('.ccs-input');
      const resultDiv = shadowRoot?.querySelector('.ccs-result');
      
      if (!input) return;
      
      const inputValue = input.value.trim();
      if (!inputValue) return;

      const commandResult = this.parseAndExecute(inputValue, selectedText);
      
      if (commandResult) {
        if (commandResult.success) {
          if (resultDiv) {
            resultDiv.textContent = commandResult.result;
            resultDiv.style.display = 'block';
          }
          
          // 自动复制结果
          navigator.clipboard.writeText(commandResult.result);
          if (window.showToast) {
            window.showToast('结果已复制到剪贴板');
          }
        } else {
          if (resultDiv) {
            resultDiv.textContent = commandResult.error;
            resultDiv.style.display = 'block';
          }
        }
      } else {
        // 如果不是命令，默认进行百度搜索
        window.open(`https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${encodeURIComponent(inputValue)}`, '_blank');
      }
    },

    // 检查是否是有效命令
    isValidCommand(cmd) {
      return commands.hasOwnProperty(cmd);
    },

    // 获取命令列表
    getCommandList() {
      return Object.keys(commands);
    },

    // 添加新命令
    addCommand(name, handler) {
      if (!commands[name]) {
        commands[name] = handler;
        return true;
      }
      return false;
    },

    // 移除命令
    removeCommand(name) {
      if (commands[name]) {
        delete commands[name];
        return true;
      }
      return false;
    }
  };

  // 导出模块
  window.CCSModules.Commands = Commands;
  
  // 导出全局函数以保持兼容性
  window.executeCommand = function() {
    const shadowRoot = document.querySelector('#ccs-popover')?.shadowRoot;
    const selectedText = window.selectedText || '';
    Commands.executeCommand(shadowRoot, selectedText);
  };

  // 导出 commands 对象以保持兼容性
  window.commands = commands;
})();