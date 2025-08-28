(function() {
  'use strict';

  // 确保全局命名空间存在
  window.CCSModules = window.CCSModules || {};
  
  // Search 模块 - 搜索相关功能
  const Search = {
    // 调试相关
    DEBUG_REQUEST_ID: 0,

    // 向 background 请求关键词提取
    async requestKeywordsFromBackground() {
      return new Promise((resolve) => {
        try {
          if (!(chrome.runtime && chrome.runtime.id)) {
            resolve(null);
            return;
          }
          
          const reqId = ++this.DEBUG_REQUEST_ID;
          if (window.CCS_DEBUG) {
            console.log('[触触搜][DEBUG] requestKeywordsFromBackground start', {
              reqId,
              url: window.location.href,
              title: document.title
            });
          }
          
          let settled = false;
          const payload = {
            action: 'extractKeywords',
            url: window.location.href,
            title: document.title || ''
          };
          
          chrome.runtime.sendMessage(payload, (response) => {
            settled = true;
            if (window.CCS_DEBUG) {
              console.log('[触触搜][DEBUG] background response', { reqId, response });
            }
            if (response && response.keywords) {
              resolve(response.keywords);
            } else {
              resolve(null);
            }
          });
          
          // 超时处理
          setTimeout(() => {
            if (!settled) {
              if (window.CCS_DEBUG) {
                console.warn('[触触搜][DEBUG] background response timeout', { reqId });
              }
              resolve(null);
            }
          }, 1200);
        } catch (_) {
          resolve(null);
        }
      });
    },

    // 智能获取搜索文本（异步版本）
    async getSmartSearchTextAsync() {
      const Selection = window.CCSModules?.Selection;
      
      // 1) 优先选中文本
      const selected = Selection?.getActiveSelectionText();
      if (selected) return selected;
      
      // 2) 使用缓存的选中文本
      if (Selection?.lastNonEmptySelection) {
        return Selection.lastNonEmptySelection;
      }
      
      // 3) 尝试与右键一致的 background 提取
      const fromBg = await this.requestKeywordsFromBackground();
      if (fromBg) return fromBg;
      
      // 4) 回退到本地URL解析
      const local = Selection?.extractSearchKeywordFromUrl();
      if (local) return local;
      
      // 5) 最后回退到页面标题
      const title = document.title || '';
      return title.trim();
    },

    // 智能获取搜索文本（同步版本，带缓存）
    getSmartSearchText(skipCache = false) {
      const Selection = window.CCSModules?.Selection;
      if (!Selection) return '';
      
      if (!skipCache && Selection.selectedText) {
        return Selection.selectedText;
      }
      
      return Selection.getUnifiedSearchText({ skipCache });
    },

    // 获取实时页面文本（优先标题）
    getRealtimePageTextPreferTitle() {
      const Selection = window.CCSModules?.Selection;
      if (!Selection) return document.title || '';
      
      return Selection.getUnifiedSearchText({
        forceRefresh: true,
        skipCache: true
      });
    },

    // 构建搜索URL
    buildSearchUrl(engineId, query) {
      const engines = {
        baidu: `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`,
        google: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        bing: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
        duckduckgo: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        sogou: `https://www.sogou.com/web?query=${encodeURIComponent(query)}`,
        so360: `https://www.so.com/s?q=${encodeURIComponent(query)}`,
        yandex: `https://yandex.com/search/?text=${encodeURIComponent(query)}`,
        yahoo: `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`,
        chuchusou: `https://chuchusou.com/?q=${encodeURIComponent(query)}`,
        wikipedia: `https://wikipedia.org/wiki/${encodeURIComponent(query)}`,
        github: `https://github.com/search?q=${encodeURIComponent(query)}`,
        stackoverflow: `https://stackoverflow.com/search?q=${encodeURIComponent(query)}`,
        mdn: `https://developer.mozilla.org/search?q=${encodeURIComponent(query)}`,
        npm: `https://www.npmjs.com/search?q=${encodeURIComponent(query)}`,
        youtube: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
        bilibili: `https://search.bilibili.com/all?keyword=${encodeURIComponent(query)}`,
        zhihu: `https://www.zhihu.com/search?q=${encodeURIComponent(query)}`,
        weibo: `https://s.weibo.com/weibo?q=${encodeURIComponent(query)}`,
        taobao: `https://s.taobao.com/search?q=${encodeURIComponent(query)}`,
        jd: `https://search.jd.com/Search?keyword=${encodeURIComponent(query)}`,
        amazon: `https://www.amazon.com/s?k=${encodeURIComponent(query)}`,
        translate: `https://translate.google.com/?text=${encodeURIComponent(query)}`
      };
      
      return engines[engineId] || engines.google;
    },

    // 执行搜索
    performSearch(engineId, query) {
      const url = this.buildSearchUrl(engineId, query);
      window.open(url, '_blank');
    },

    // 智能建议（基于输入）
    getSmartSuggestions(input, selectedText) {
      const suggestions = [];
      const inputLower = input.toLowerCase();
      
      // 基于输入的建议
      if (inputLower.includes('search') || inputLower.includes('搜')) {
        suggestions.push({
          text: `/search ${selectedText || '关键词'}`,
          description: '搜索'
        });
      }
      
      if (inputLower.includes('trans') || inputLower.includes('翻译')) {
        suggestions.push({
          text: `/translate ${selectedText || '文本'}`,
          description: '翻译'
        });
      }
      
      if (inputLower.includes('copy') || inputLower.includes('复制')) {
        suggestions.push({
          text: `/copy ${selectedText || ''}`,
          description: '复制到剪贴板'
        });
      }
      
      if (inputLower.includes('base64')) {
        suggestions.push({
          text: `/base64 encode ${selectedText || '文本'}`,
          description: 'Base64 编码'
        });
        suggestions.push({
          text: `/base64 decode ${selectedText || 'base64字符串'}`,
          description: 'Base64 解码'
        });
      }
      
      if (inputLower.includes('url')) {
        suggestions.push({
          text: `/url encode ${selectedText || '文本'}`,
          description: 'URL 编码'
        });
        suggestions.push({
          text: `/url decode ${selectedText || 'URL编码字符串'}`,
          description: 'URL 解码'
        });
      }
      
      if (inputLower.includes('upper') || inputLower.includes('大写')) {
        suggestions.push({
          text: `/upper ${selectedText || '文本'}`,
          description: '转换为大写'
        });
      }
      
      if (inputLower.includes('lower') || inputLower.includes('小写')) {
        suggestions.push({
          text: `/lower ${selectedText || '文本'}`,
          description: '转换为小写'
        });
      }
      
      // 如果没有特定匹配，提供通用建议
      if (suggestions.length === 0 && selectedText) {
        suggestions.push({
          text: `/search ${selectedText}`,
          description: `搜索 "${selectedText.substring(0, 20)}${selectedText.length > 20 ? '...' : ''}"`
        });
        suggestions.push({
          text: `/copy ${selectedText}`,
          description: '复制选中的文本'
        });
      }
      
      return suggestions.slice(0, 5); // 最多返回5个建议
    },

    // 解析命令
    parseCommand(command) {
      const parts = command.trim().split(/\s+/);
      if (parts[0].startsWith('/')) {
        const cmd = parts[0].substring(1);
        const args = parts.slice(1).join(' ');
        return { command: cmd, args };
      }
      return null;
    },

    // 执行命令
    executeCommand(command, selectedText) {
      const parsed = this.parseCommand(command);
      if (!parsed) return false;
      
      const { command: cmd, args } = parsed;
      const text = args || selectedText || '';
      
      switch (cmd.toLowerCase()) {
        case 'search':
        case 's':
          this.performSearch('google', text);
          return true;
          
        case 'baidu':
        case 'bd':
          this.performSearch('baidu', text);
          return true;
          
        case 'translate':
        case 'trans':
        case 't':
          this.performSearch('translate', text);
          return true;
          
        case 'copy':
        case 'c':
          navigator.clipboard.writeText(text);
          if (window.CCSModules.Toast) {
            window.CCSModules.Toast.show('已复制到剪贴板');
          }
          return true;
          
        case 'upper':
        case 'uppercase':
          navigator.clipboard.writeText(text.toUpperCase());
          if (window.CCSModules.Toast) {
            window.CCSModules.Toast.show('已转换为大写并复制');
          }
          return true;
          
        case 'lower':
        case 'lowercase':
          navigator.clipboard.writeText(text.toLowerCase());
          if (window.CCSModules.Toast) {
            window.CCSModules.Toast.show('已转换为小写并复制');
          }
          return true;
          
        case 'base64':
          if (args.startsWith('encode')) {
            const textToEncode = args.substring(6).trim() || selectedText;
            const encoded = btoa(unescape(encodeURIComponent(textToEncode)));
            navigator.clipboard.writeText(encoded);
            if (window.CCSModules.Toast) {
              window.CCSModules.Toast.show('已Base64编码并复制');
            }
            return true;
          } else if (args.startsWith('decode')) {
            const textToDecode = args.substring(6).trim() || selectedText;
            try {
              const decoded = decodeURIComponent(escape(atob(textToDecode)));
              navigator.clipboard.writeText(decoded);
              if (window.CCSModules.Toast) {
                window.CCSModules.Toast.show('已Base64解码并复制');
              }
            } catch (e) {
              if (window.CCSModules.Toast) {
                window.CCSModules.Toast.error('Base64解码失败');
              }
            }
            return true;
          }
          break;
          
        case 'url':
          if (args.startsWith('encode')) {
            const textToEncode = args.substring(6).trim() || selectedText;
            navigator.clipboard.writeText(encodeURIComponent(textToEncode));
            if (window.CCSModules.Toast) {
              window.CCSModules.Toast.show('已URL编码并复制');
            }
            return true;
          } else if (args.startsWith('decode')) {
            const textToDecode = args.substring(6).trim() || selectedText;
            try {
              navigator.clipboard.writeText(decodeURIComponent(textToDecode));
              if (window.CCSModules.Toast) {
                window.CCSModules.Toast.show('已URL解码并复制');
              }
            } catch (e) {
              if (window.CCSModules.Toast) {
                window.CCSModules.Toast.error('URL解码失败');
              }
            }
            return true;
          }
          break;
      }
      
      return false;
    }
  };

  // 导出模块
  window.CCSModules.Search = Search;
  
  // 兼容性：导出全局函数
  window.requestKeywordsFromBackground = () => Search.requestKeywordsFromBackground();
  window.getSmartSearchText = (skipCache) => Search.getSmartSearchText(skipCache);
  window.getSmartSearchTextAsync = () => Search.getSmartSearchTextAsync();
  window.getRealtimePageTextPreferTitle = () => Search.getRealtimePageTextPreferTitle();
  window.getSmartSuggestions = (input, text) => Search.getSmartSuggestions(input, text);
})();