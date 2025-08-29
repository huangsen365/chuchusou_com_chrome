(function() {
  'use strict';

  // 确保全局命名空间存在
  window.CCSModules = window.CCSModules || {};
  
  // ButtonDefinitions 模块 - 按钮定义和配置
  const ButtonDefinitions = {
    // 获取所有默认按钮定义
    getDefaultButtons() {
      return [
        {
          id: 'baidu',
          icon: '🔍',
          title: '百度搜索',
          action: (text) => {
            window.open(`https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${encodeURIComponent(text)}`, '_blank');
          }
        },
        {
          id: 'google',
          icon: '🔍',
          title: 'Google搜索',
          action: (text) => {
            window.open(`https://www.google.com/search?q=${encodeURIComponent(text)}`, '_blank');
          }
        },
        {
          id: 'chatgpt',
          icon: '🌐',
          title: 'ChatGPT',
          action: (text) => {
            window.open(`https://chatgpt.com/?prompt=${encodeURIComponent(text)}`, '_blank');
          }
        },
        {
          id: 'chuchusou',
          icon: '🌐',
          title: '更多搜索',
          action: (text) => {
            window.open(`https://chuchusou.com/?q=${encodeURIComponent(text)}`, '_blank');
          }
        },
        {
          id: 'copy',
          icon: '📝',
          title: '复制',
          action: async (text) => {
            try {
              await navigator.clipboard.writeText(text);
              this.showToast('已复制到剪贴板');
            } catch (err) {
              this.showToast('复制失败');
            }
          }
        },
        {
          id: 'base64-encode',
          icon: '🔤',
          title: 'Base64编码',
          action: (text) => {
            try {
              const encoded = btoa(unescape(encodeURIComponent(text)));
              navigator.clipboard.writeText(encoded);
              this.showToast(`已编码并复制: ${encoded.slice(0, 20)}...`);
            } catch (e) {
              this.showToast('编码失败');
            }
          }
        },
        {
          id: 'base64-decode',
          icon: '🔓',
          title: 'Base64解码',
          action: (text) => {
            try {
              const decoded = atob(text);
              navigator.clipboard.writeText(decoded);
              this.showToast(`已解码并复制: ${decoded.slice(0, 20)}...`);
            } catch (e) {
              this.showToast('解码失败: 无效的 base64');
            }
          }
        },
        {
          id: 'url-encode',
          icon: '🔗',
          title: 'URL编码',
          action: (text) => {
            const encoded = encodeURIComponent(text);
            navigator.clipboard.writeText(encoded);
            this.showToast(`已URL编码: ${encoded.slice(0, 20)}...`);
          }
        },
        {
          id: 'url-decode',
          icon: '🔓',
          title: 'URL解码',
          action: (text) => {
            try {
              const decoded = decodeURIComponent(text);
              navigator.clipboard.writeText(decoded);
              this.showToast(`已URL解码: ${decoded.slice(0, 20)}...`);
            } catch (e) {
              this.showToast('URL解码失败');
            }
          }
        },
        {
          id: 'uppercase',
          icon: '🔠',
          title: '转大写',
          action: (text) => {
            const upper = text.toUpperCase();
            navigator.clipboard.writeText(upper);
            this.showToast('已转换为大写并复制');
          }
        },
        {
          id: 'lowercase',
          icon: '🔡',
          title: '转小写',
          action: (text) => {
            const lower = text.toLowerCase();
            navigator.clipboard.writeText(lower);
            this.showToast('已转换为小写并复制');
          }
        },
        {
          id: 'md5',
          icon: '#️⃣',
          title: 'MD5哈希',
          action: (text) => {
            const hash = window.commands?.md5 ? window.commands.md5([text]) : '';
            if (hash) {
              navigator.clipboard.writeText(hash);
              this.showToast(`MD5: ${hash}`);
            } else {
              this.showToast('MD5功能不可用');
            }
          }
        }
      ];
    },
    
    // 显示提示信息（内部方法）
    showToast(message) {
      if (window.showToast) {
        window.showToast(message);
      } else if (window.CCSModules?.Toast) {
        window.CCSModules.Toast.show(message);
      } else {
        console.log('[触触搜] Toast:', message);
      }
    },
    
    // 根据ID获取按钮
    getButtonById(id) {
      const buttons = this.getDefaultButtons();
      return buttons.find(btn => btn.id === id);
    },
    
    // 根据ID列表获取按钮
    getButtonsByIds(ids) {
      const buttons = this.getDefaultButtons();
      return ids.map(id => buttons.find(btn => btn.id === id)).filter(Boolean);
    },
    
    // 获取mini模式的默认按钮
    getMiniModeButtons() {
      return ['baidu', 'google', 'chuchusou', 'copy', 'lowercase'];
    },
    
    // 获取普通模式的默认按钮
    getNormalModeButtons() {
      return ['baidu', 'google', 'chatgpt', 'chuchusou', 'copy'];
    },
    
    // 执行按钮动作
    executeAction(buttonId, text) {
      const button = this.getButtonById(buttonId);
      if (button && button.action) {
        try {
          button.action.call(this, text);
          return true;
        } catch (err) {
          console.error('[触触搜] 执行按钮动作失败:', buttonId, err);
          return false;
        }
      }
      return false;
    },
    
    // 获取搜索引擎按钮
    getSearchEngineButtons() {
      return ['baidu', 'google', 'chatgpt', 'chuchusou'];
    },
    
    // 获取工具按钮
    getToolButtons() {
      return ['copy', 'base64-encode', 'base64-decode', 'url-encode', 'url-decode', 'uppercase', 'lowercase', 'md5'];
    },
    
    // 判断是否是搜索引擎按钮
    isSearchEngineButton(id) {
      return this.getSearchEngineButtons().includes(id);
    },
    
    // 判断是否是工具按钮
    isToolButton(id) {
      return this.getToolButtons().includes(id);
    },
    
    // 创建自定义按钮
    createCustomButton(config) {
      const { id, icon, title, action, url } = config;
      
      if (!id || !title) {
        throw new Error('按钮必须有ID和标题');
      }
      
      const button = {
        id,
        icon: icon || '🔧',
        title,
        custom: true
      };
      
      if (action && typeof action === 'function') {
        button.action = action;
      } else if (url) {
        button.action = (text) => {
          const finalUrl = url.replace('{{text}}', encodeURIComponent(text));
          window.open(finalUrl, '_blank');
        };
      } else {
        throw new Error('按钮必须有action函数或url');
      }
      
      return button;
    },
    
    // 验证按钮配置
    validateButton(button) {
      if (!button || typeof button !== 'object') {
        return false;
      }
      
      if (!button.id || !button.title) {
        return false;
      }
      
      if (!button.action || typeof button.action !== 'function') {
        return false;
      }
      
      return true;
    }
  };

  // 导出模块
  window.CCSModules.ButtonDefinitions = ButtonDefinitions;
  
  // 兼容性：导出全局变量
  window.defaultButtons = ButtonDefinitions.getDefaultButtons();
  
  // 导出工具函数
  window.getButtonById = (id) => ButtonDefinitions.getButtonById(id);
  window.getButtonsByIds = (ids) => ButtonDefinitions.getButtonsByIds(ids);
})();