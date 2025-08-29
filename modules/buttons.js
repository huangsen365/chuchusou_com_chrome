(function() {
  'use strict';

  // 确保全局命名空间存在
  window.CCSModules = window.CCSModules || {};
  
  // Buttons 模块 - 按钮定义和管理
  const Buttons = {
    // 默认按钮定义
    defaultButtons: [
      {
        id: 'baidu',
        icon: '🔍',
        title: '百度搜索',
        action: (text) => {
          const url = `https://www.baidu.com/s?ie=utf-8&oe=utf-8&wd=${encodeURIComponent(text)}`;
          console.log('[触触搜] Baidu Search URL:', {
            searchText: text,
            encodedText: encodeURIComponent(text),
            fullURL: url
          });
          window.open(url, '_blank');
        }
      },
      {
        id: 'google',
        icon: '🔍',
        title: 'Google搜索',
        action: (text) => {
          const url = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
          console.log('[触触搜] Google Search URL:', {
            searchText: text,
            encodedText: encodeURIComponent(text),
            fullURL: url
          });
          window.open(url, '_blank');
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
          const url = `https://chuchusou.com/?q=${encodeURIComponent(text)}`;
          console.log('[触触搜] Chuchusou Search URL:', {
            searchText: text,
            encodedText: encodeURIComponent(text),
            fullURL: url
          });
          window.open(url, '_blank');
        }
      },
      {
        id: 'copy',
        icon: '📝',
        title: '复制',
        action: async (text) => {
          try {
            await navigator.clipboard.writeText(text);
            if (window.CCSModules.Toast) {
              window.CCSModules.Toast.show('已复制到剪贴板');
            }
          } catch (err) {
            if (window.CCSModules.Toast) {
              window.CCSModules.Toast.error('复制失败');
            }
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
            if (window.CCSModules.Toast) {
              window.CCSModules.Toast.show(`已编码并复制: ${encoded.slice(0, 20)}...`);
            }
          } catch (e) {
            if (window.CCSModules.Toast) {
              window.CCSModules.Toast.error('编码失败');
            }
          }
        }
      },
      {
        id: 'base64-decode',
        icon: '🔓',
        title: 'Base64解码',
        action: (text) => {
          try {
            const decoded = decodeURIComponent(escape(atob(text)));
            navigator.clipboard.writeText(decoded);
            if (window.CCSModules.Toast) {
              window.CCSModules.Toast.show(`已解码并复制: ${decoded.slice(0, 20)}...`);
            }
          } catch (e) {
            if (window.CCSModules.Toast) {
              window.CCSModules.Toast.error('解码失败: 无效的 base64');
            }
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
          if (window.CCSModules.Toast) {
            window.CCSModules.Toast.show(`已URL编码: ${encoded.slice(0, 20)}...`);
          }
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
            if (window.CCSModules.Toast) {
              window.CCSModules.Toast.show(`已URL解码: ${decoded.slice(0, 20)}...`);
            }
          } catch (e) {
            if (window.CCSModules.Toast) {
              window.CCSModules.Toast.error('URL解码失败');
            }
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
          if (window.CCSModules.Toast) {
            window.CCSModules.Toast.show('已转换为大写并复制');
          }
        }
      },
      {
        id: 'lowercase',
        icon: '🔡',
        title: '转小写',
        action: (text) => {
          const lower = text.toLowerCase();
          navigator.clipboard.writeText(lower);
          if (window.CCSModules.Toast) {
            window.CCSModules.Toast.show('已转换为小写并复制');
          }
        }
      },
      {
        id: 'translate',
        icon: '🌏',
        title: '谷歌翻译',
        action: (text) => {
          window.open(`https://translate.google.com/?text=${encodeURIComponent(text)}`, '_blank');
        }
      },
      {
        id: 'wikipedia',
        icon: '📖',
        title: '维基百科',
        action: (text) => {
          window.open(`https://wikipedia.org/wiki/${encodeURIComponent(text)}`, '_blank');
        }
      }
    ],

    // Mini模式按钮配置
    miniModeButtons: {
      baidu: { icon: '🔍', title: '百度' },
      google: { icon: '🔍', title: 'Google' },
      chatgpt: { icon: '🤖', title: 'ChatGPT' },
      chuchusou: { icon: '🌐', title: '触触搜' },
      copy: { icon: '📋', title: '复制' },
      uppercase: { icon: '🔠', title: '大写' },
      lowercase: { icon: '🔡', title: '小写' },
      translate: { icon: '🌏', title: '翻译' }
    },

    // 获取按钮通过ID
    getButtonById(buttonId) {
      return this.defaultButtons.find(btn => btn.id === buttonId);
    },

    // 获取所有按钮
    getAllButtons() {
      return this.defaultButtons;
    },

    // 添加自定义按钮
    addButton(button) {
      if (!button.id || !button.title || !button.action) {
        console.error('[触触搜] 添加按钮失败：缺少必要属性');
        return false;
      }
      
      // 检查是否已存在
      if (this.getButtonById(button.id)) {
        console.warn('[触触搜] 按钮已存在：', button.id);
        return false;
      }
      
      this.defaultButtons.push(button);
      return true;
    },

    // 移除按钮
    removeButton(buttonId) {
      const index = this.defaultButtons.findIndex(btn => btn.id === buttonId);
      if (index > -1) {
        this.defaultButtons.splice(index, 1);
        return true;
      }
      return false;
    },

    // 执行按钮动作
    executeAction(buttonId, text) {
      console.log('[触触搜][executeAction] Called with:', {
        buttonId: buttonId,
        text: text,
        textLength: text ? text.length : 0
      });
      
      const button = this.getButtonById(buttonId);
      console.log('[触触搜][executeAction] Found button:', {
        found: !!button,
        buttonId: button?.id,
        buttonTitle: button?.title
      });
      
      if (button && button.action) {
        try {
          console.log('[触触搜][executeAction] Executing action for:', buttonId, 'with text:', text);
          button.action(text);
        } catch (e) {
          console.error('[触触搜] 执行按钮动作失败:', e);
          if (window.CCSModules.Toast) {
            window.CCSModules.Toast.error('操作失败');
          }
        }
      }
    },

    // 渲染按钮到容器
    renderButtons(container, buttonsToShow, mode = 'normal') {
      if (!container) return;
      
      // 清空容器
      container.innerHTML = '';
      
      // 根据模式选择按钮
      const buttons = buttonsToShow || this.defaultButtons;
      
      buttons.forEach(buttonConfig => {
        let button;
        
        if (typeof buttonConfig === 'string') {
          // Mini模式：通过ID获取按钮
          const btnDef = this.getButtonById(buttonConfig);
          if (!btnDef) return;
          
          button = document.createElement('button');
          button.className = 'ccs-mini-button';
          button.dataset.id = buttonConfig;
          
          const miniConfig = this.miniModeButtons[buttonConfig] || {};
          button.innerHTML = `
            <span class="ccs-mini-icon">${miniConfig.icon || btnDef.icon || '❓'}</span>
            <span class="ccs-mini-label">${miniConfig.title || btnDef.title}</span>
          `;
          
          button.onclick = () => {
            // 优先使用按钮上存储的搜索文本
            let text = button.dataset.searchText;
            
            console.log('[触触搜][Modules] Mini Button Click:', {
              buttonId: buttonConfig,
              dataSearchText: button.dataset.searchText,
              hasDataSearchText: !!button.dataset.searchText
            });
            
            // 如果没有存储的文本，则从Selection模块获取
            if (!text) {
              text = window.CCSModules?.Selection?.getCurrentSearchText() || '';
              console.log('[触触搜][Modules] Fallback to Selection module:', text);
            }
            
            console.log('[触触搜][Modules] Final text for mini button:', text);
            
            if (text) {
              this.executeAction(buttonConfig, text);
            }
          };
        } else {
          // 普通模式：完整按钮
          button = document.createElement('button');
          button.className = 'ccs-button';
          button.dataset.id = buttonConfig.id;
          button.innerHTML = `
            <span class="ccs-button-icon">${buttonConfig.icon}</span>
            <span class="ccs-button-label">${buttonConfig.title}</span>
          `;
          
          button.onclick = () => {
            // 优先使用按钮上存储的搜索文本
            let text = button.dataset.searchText;
            
            console.log('[触触搜][Modules] Normal Button Click:', {
              buttonId: buttonConfig.id,
              buttonTitle: buttonConfig.title,
              dataSearchText: button.dataset.searchText,
              hasDataSearchText: !!button.dataset.searchText
            });
            
            // 如果没有存储的文本，则从Selection模块获取
            if (!text) {
              text = window.CCSModules?.Selection?.getCurrentSearchText() || '';
              console.log('[触触搜][Modules] Fallback to Selection module:', text);
            }
            
            console.log('[触触搜][Modules] Final text for normal button:', text);
            
            if (text) {
              buttonConfig.action(text);
            }
          };
        }
        
        container.appendChild(button);
      });
    },

    // 更新所有按钮的文本（data属性）
    updateAllButtonsText(text, shadowRoot) {
      if (!shadowRoot) return;
      
      const buttons = shadowRoot.querySelectorAll('.ccs-button, .ccs-mini-button');
      buttons.forEach(button => {
        button.dataset.searchText = text;
      });
    },

    // 获取Mini模式的默认按钮
    getMiniModeDefaults() {
      return ['baidu', 'google', 'chuchusou', 'copy', 'lowercase'];
    },

    // 注册新的搜索引擎
    registerSearchEngine(id, name, urlTemplate, icon = '🔍') {
      return this.addButton({
        id: id,
        icon: icon,
        title: name,
        action: (text) => {
          const url = urlTemplate.replace('{query}', encodeURIComponent(text));
          window.open(url, '_blank');
        }
      });
    }
  };

  // 导出模块
  window.CCSModules.Buttons = Buttons;
  
  // 兼容性：导出全局变量
  window.defaultButtons = Buttons.defaultButtons;
})();