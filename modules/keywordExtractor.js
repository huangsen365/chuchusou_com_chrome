(function() {
  'use strict';

  // 确保全局命名空间存在
  window.CCSModules = window.CCSModules || {};
  
  function safeDecodeParam(value) {
    if (typeof value !== 'string' || !value) return value;
    if (!/%[0-9A-Fa-f]{2}/.test(value)) return value;
    try {
      return decodeURIComponent(value);
    } catch (_) {
      return value;
    }
  }

  // KeywordExtractor 模块 - 搜索关键词提取和文本获取功能
  const KeywordExtractor = {
    // 从搜索引擎页面提取关键词
    extractSearchKeyword() {
      try {
        const hostname = window.location.hostname;
        const params = new URLSearchParams(window.location.search);
        
        console.log('[触触搜] extractSearchKeyword - 开始检查URL关键词:', {
          hostname: hostname,
          search: window.location.search,
          paramsCount: Array.from(params.keys()).length
        });

        // 百度
        if (hostname.includes('baidu.com')) {
          const wd = params.get('wd') || params.get('word') || params.get('kw');
          if (wd) {
            const decoded = safeDecodeParam(wd);
            console.log('[触触搜] extractSearchKeyword - 百度搜索关键词:', decoded);
            return decoded;
          }
        }

        // Google（各国域名）
        if (hostname.includes('google.')) {
          const q = params.get('q');
          if (q) {
            const decoded = safeDecodeParam(q);
            console.log('[触触搜] extractSearchKeyword - Google搜索关键词:', decoded);
            return decoded;
          }
        }

        // Bing
        if (hostname.includes('bing.com') || hostname.includes('cn.bing.com')) {
          const q = params.get('q');
          if (q) {
            const decoded = safeDecodeParam(q);
            console.log('[触触搜] extractSearchKeyword - Bing搜索关键词:', decoded);
            return decoded;
          }
        }

        // 搜狗
        if (hostname.includes('sogou.com')) {
          const query = params.get('query') || params.get('keyword');
          if (query) {
            const decoded = safeDecodeParam(query);
            console.log('[触触搜] extractSearchKeyword - 搜狗搜索关键词:', decoded);
            return decoded;
          }
        }

        // 360搜索
        if (hostname.includes('so.com') || hostname.includes('360.cn')) {
          const q = params.get('q');
          if (q) {
            const decoded = safeDecodeParam(q);
            console.log('[触触搜] extractSearchKeyword - 360搜索关键词:', decoded);
            return decoded;
          }
        }

        // 神马
        if (hostname.includes('m.sm.cn') || hostname.includes('sm.cn')) {
          const q = params.get('q');
          if (q) {
            const decoded = safeDecodeParam(q);
            console.log('[触触搜] extractSearchKeyword - 神马搜索关键词:', decoded);
            return decoded;
          }
        }

        // 头条
        if (hostname.includes('toutiao.com')) {
          const keyword = params.get('keyword');
          if (keyword) {
            const decoded = safeDecodeParam(keyword);
            console.log('[触触搜] extractSearchKeyword - 头条搜索关键词:', decoded);
            return decoded;
          }
        }

        // DuckDuckGo
        if (hostname.includes('duckduckgo.com')) {
          const q = params.get('q');
          if (q) {
            const decoded = safeDecodeParam(q);
            console.log('[触触搜] extractSearchKeyword - DuckDuckGo搜索关键词:', decoded);
            return decoded;
          }
        }

        // Yahoo
        if (hostname.includes('yahoo.com') || hostname.includes('yahoo.co.jp')) {
          const p = params.get('p');
          if (p) {
            const decoded = safeDecodeParam(p);
            console.log('[触触搜] extractSearchKeyword - Yahoo搜索关键词:', decoded);
            return decoded;
          }
        }

        // Yandex
        if (hostname.includes('yandex.')) {
          const text = params.get('text');
          if (text) {
            const decoded = safeDecodeParam(text);
            console.log('[触触搜] extractSearchKeyword - Yandex搜索关键词:', decoded);
            return decoded;
          }
        }

        // Startpage
        if (hostname.includes('startpage.com')) {
          const query = params.get('query');
          if (query) {
            const decoded = safeDecodeParam(query);
            console.log('[触触搜] extractSearchKeyword - Startpage搜索关键词:', decoded);
            return decoded;
          }
        }

        // 知乎
        if (hostname.includes('zhihu.com')) {
          const q = params.get('q');
          if (q) {
            const decoded = safeDecodeParam(q);
            console.log('[触触搜] extractSearchKeyword - 知乎搜索关键词:', decoded);
            return decoded;
          }
        }

        // 微博
        if (hostname.includes('weibo.com') || hostname.includes('weibo.cn')) {
          const q = params.get('q');
          if (q) {
            const decoded = safeDecodeParam(q);
            console.log('[触触搜] extractSearchKeyword - 微博搜索关键词:', decoded);
            return decoded;
          }
        }

        // X (Twitter)
        // 注意用后缀匹配而非 includes('x.com')：netflix.com / box.com 都包含 "x.com" 子串
        if (hostname === 'x.com' || hostname.endsWith('.x.com') ||
            hostname === 'twitter.com' || hostname.endsWith('.twitter.com')) {
          const q = params.get('q');
          if (q) {
            const decoded = safeDecodeParam(q);
            console.log('[触触搜] extractSearchKeyword - X/Twitter搜索关键词:', decoded);
            return decoded;
          }
        }

        // GitHub
        if (hostname.includes('github.com')) {
          const q = params.get('q');
          if (q) {
            const decoded = safeDecodeParam(q);
            console.log('[触触搜] extractSearchKeyword - GitHub搜索关键词:', decoded);
            return decoded;
          }
        }

        // B站
        if (hostname.includes('bilibili.com')) {
          const keyword = params.get('keyword');
          if (keyword) {
            const decoded = safeDecodeParam(keyword);
            console.log('[触触搜] extractSearchKeyword - B站搜索关键词:', decoded);
            return decoded;
          }
        }

        // 淘宝/天猫
        if (hostname.includes('taobao.com') || hostname.includes('tmall.com')) {
          const q = params.get('q') || params.get('keyword');
          if (q) {
            const decoded = safeDecodeParam(q);
            console.log('[触触搜] extractSearchKeyword - 淘宝/天猫搜索关键词:', decoded);
            return decoded;
          }
        }

        // 京东
        if (hostname.includes('jd.com')) {
          const keyword = params.get('keyword');
          if (keyword) {
            const decoded = safeDecodeParam(keyword);
            console.log('[触触搜] extractSearchKeyword - 京东搜索关键词:', decoded);
            return decoded;
          }
        }
        
        console.log('[触触搜] extractSearchKeyword - 当前网站没有匹配的搜索引擎规则');
      } catch (e) {
        console.log('[触触搜] extractSearchKeyword - 提取关键词时出错:', e.message);
      }
      return null;
    },

    // 获取活动选中的文本
    getActiveSelectionText() {
      try {
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
          const start = ae.selectionStart;
          const end = ae.selectionEnd;
          if (typeof start === 'number' && typeof end === 'number' && end > start) {
            const text = String(ae.value).substring(start, end).trim();
            if (text) {
              console.log('[触触搜] getActiveSelectionText - 从输入框获取选中文本:', {
                element: ae.tagName,
                text: text,
                length: text.length
              });
              return text;
            }
          }
        }
      } catch (_) {}
      try {
        const selection = window.getSelection().toString().trim();
        if (selection) {
          console.log('[触触搜] getActiveSelectionText - 从window.getSelection获取选中文本:', {
            text: selection,
            length: selection.length
          });
        } else {
          console.log('[触触搜] getActiveSelectionText - 没有选中文本');
        }
        return selection;
      } catch (_) {
        console.log('[触触搜] getActiveSelectionText - 获取选中文本失败');
        return '';
      }
    },

    // 【统一的文本获取函数】- 所有地方都应该使用这个函数
    // 统一优先级：1.选中文本 > 2.URL关键词 > 3.页面标题 > 4.缓存文本
    getUnifiedSearchText(options = {}) {
      const { skipCache = false, forceRefresh = false } = options;
      
      console.log('[触触搜] getUnifiedSearchText 开始执行:', {
        skipCache,
        forceRefresh,
        currentUrl: window.location.href,
        currentTitle: document.title
      });
      
      // 优先级1: 实时选中的文本（最高优先）
      const selected = this.getActiveSelectionText();
      if (selected) {
        console.log('[触触搜] Fallback 优先级1 - 找到选中文本:', {
          text: selected,
          length: selected.length,
          source: 'selection'
        });
        return selected;
      }
      console.log('[触触搜] Fallback 优先级1 - 没有选中文本');
      
      // 优先级2: URL中的搜索关键词（比如百度、Google的搜索词）
      const searchKeyword = this.extractSearchKeyword();
      if (searchKeyword) {
        console.log('[触触搜] Fallback 优先级2 - 从URL提取到搜索关键词:', {
          text: searchKeyword,
          length: searchKeyword.length,
          source: 'url_keyword',
          hostname: window.location.hostname
        });
        return searchKeyword;
      }
      console.log('[触触搜] Fallback 优先级2 - URL中没有搜索关键词');
      
      // 优先级3: 页面标题
      const title = document.title;
      if (title) {
        // 清理标题中的无关信息（如通知计数等）
        let trimmedTitle = title.trim();
        // 移除知乎等网站的通知计数前缀，如 "(74 封私信 / 80 条消息) "
        trimmedTitle = trimmedTitle.replace(/^\([^)]+\)\s*/, '');
        // 移除常见的网站后缀
        trimmedTitle = trimmedTitle.replace(/\s*[-–—]\s*(知乎|百度|Google|微博|豆瓣|简书|CSDN|博客园|掘金|SegmentFault|Stack Overflow).*$/, '');
        
        if (trimmedTitle) {
          console.log('[触触搜] Fallback 优先级3 - 使用页面标题:', {
            text: trimmedTitle,
            length: trimmedTitle.length,
            source: 'page_title',
            originalTitle: title
          });
          return trimmedTitle;
        }
      }
      console.log('[触触搜] Fallback 优先级3 - 页面标题为空或无效');
      
      // 优先级4: 缓存的选中文本（如果不跳过缓存）
      if (!skipCache && !forceRefresh) {
        if (window.lastNonEmptySelection) {
          console.log('[触触搜] Fallback 优先级4 - 使用缓存的最近选中文本:', {
            text: window.lastNonEmptySelection,
            length: window.lastNonEmptySelection.length,
            source: 'lastNonEmptySelection'
          });
          return window.lastNonEmptySelection;
        }
        if (window.selectedText) {
          console.log('[触触搜] Fallback 优先级4 - 使用缓存的全局选中文本:', {
            text: window.selectedText,
            length: window.selectedText.length,
            source: 'selectedText'
          });
          return window.selectedText;
        }
        console.log('[触触搜] Fallback 优先级4 - 没有缓存的文本');
      } else {
        console.log('[触触搜] Fallback 优先级4 - 跳过缓存 (skipCache=' + skipCache + ', forceRefresh=' + forceRefresh + ')');
      }
      
      console.log('[触触搜] Fallback 所有优先级均无结果，返回空字符串');
      return '';
    },

    // 智能获取要搜索的内容（同步版本，尽量本地推断）
    getSmartSearchText(skipCache = false) {
      // 直接调用统一函数
      return this.getUnifiedSearchText({ skipCache });
    },

    // 统一的获取当前搜索文本函数，确保按钮提示和实际搜索内容一致
    getCurrentSearchText(forceRefresh = false) {
      // 直接调用统一函数，传递forceRefresh参数
      return this.getUnifiedSearchText({ forceRefresh, skipCache: forceRefresh });
    },

    // 智能获取要搜索的内容（异步版本）
    async getSmartSearchTextAsync() {
      try {
        // 尝试从background获取智能提取的关键词
        const response = await chrome.runtime.sendMessage({ 
          action: 'getSearchKeyword',
          windowSelection: window.getSelection().toString()
        });
        
        if (response && response.keyword) {
          return response.keyword;
        }
      } catch (err) {
        console.log('[触触搜] 无法从background获取关键词:', err);
      }
      
      // 本地尝试
      const local = this.extractSearchKeyword();
      if (local) {
        return local;
      }
      
      // 没有找到URL关键词，尝试使用选中文本
      const selected = window.getSelection().toString().trim();
      if (selected) {
        return selected;
      }
      
      // 最后，使用标题
      return this.getUnifiedSearchText({ forceRefresh: true, skipCache: true });
    }
  };

  // 导出模块
  window.CCSModules.KeywordExtractor = KeywordExtractor;
  
  // 兼容性：导出全局函数
  window.extractSearchKeyword = () => KeywordExtractor.extractSearchKeyword();
  window.getActiveSelectionText = () => KeywordExtractor.getActiveSelectionText();
  window.getUnifiedSearchText = (options) => KeywordExtractor.getUnifiedSearchText(options);
  window.getSmartSearchText = (skipCache) => KeywordExtractor.getSmartSearchText(skipCache);
  window.getCurrentSearchText = (forceRefresh) => KeywordExtractor.getCurrentSearchText(forceRefresh);
  window.getSmartSearchTextAsync = () => KeywordExtractor.getSmartSearchTextAsync();
})();
