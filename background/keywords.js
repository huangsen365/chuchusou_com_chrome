function isGenericHostKeyword(hostname, keyword) {
  if (!keyword) return false;
  const value = keyword.trim().toLowerCase();
  if (!value) return true;
  if (hostname.includes('chatgpt.com')) {
    if (value === 'chatgpt' || value === 'chatgpt.com' || value.startsWith('chatgpt.com/')) {
      return true;
    }
    if (value === 'www.chatgpt.com') {
      return true;
    }
  }
  if (hostname.includes('claude.ai')) {
    if (value === 'claude' || value === 'claude.ai' || value.startsWith('claude.ai/')) {
      return true;
    }
    if (value === 'www.claude.ai') {
      return true;
    }
  }
  return false;
}

function safeDecodeParam(value) {
  if (typeof value !== 'string' || !value) return value;
  if (!/%[0-9A-Fa-f]{2}/.test(value)) return value;
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}

// 已知 hostname 分支都没命中时的启发式兜底：按"哪个 param 最像关键字"打分挑选
// 命中常见 key 名 / 长度合理 / 含中文 = 加分；像 URL 或 UUID/hash = 直接毙
const COMMON_QUERY_KEYS = ['q', 'query', 'search', 's', 'kw', 'keyword', 'wd', 'word', 'p', 'text', 'k', 'searchword'];
const PARAM_BLACKLIST = /^(utm_|ref|fbclid|gclid|tbm|hl|source|sourceid|ie|oe|biw|bih|sa|ved|ei|sclient|cs|aep|atvm|chrome_task)/i;

function heuristicExtractFromParams(searchParams) {
  const candidates = [];
  for (const [key, value] of searchParams) {
    if (!value || value.length < 2 || value.length > 500) continue;
    if (PARAM_BLACKLIST.test(key)) continue;

    let score = 0;
    if (COMMON_QUERY_KEYS.includes(key.toLowerCase())) score += 10;
    score += Math.min(value.length / 10, 5);
    if (/[一-龥]/.test(value)) score += 3;
    if (/^https?:\/\//.test(value)) score -= 100;
    if (/^[0-9a-f-]{20,}$/i.test(value)) score -= 100;
    if (/^\d+$/.test(value)) score -= 5;       // 纯数字（id/year/page 等）大概率不是关键字

    if (score > 0) candidates.push({ key, value, score });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

async function extractSearchKeywords(url, tab) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const searchParams = urlObj.searchParams;
    BG_DBG('[触触搜][BG][DEBUG] extractSearchKeywords called', { url, hostname, title: tab && tab.title });
    
    // 百度搜索
    if (hostname.includes('baidu.com')) {
      const wd = searchParams.get('wd') || searchParams.get('word') || searchParams.get('kw');
      if (wd) {
        const kw = safeDecodeParam(wd);
        BG_DBG('[触触搜][BG][DEBUG] matched baidu wd:', kw);
        return kw;
      }
    }
    
    // ChatGPT - 读取查询参数
    if (hostname.includes('chatgpt.com')) {
      const q = searchParams.get('q');
      if (q) {
        const kw = safeDecodeParam(q);
        if (kw && !isGenericHostKeyword(hostname, kw)) {
          BG_DBG('[触触搜][BG][DEBUG] matched chatgpt q:', kw);
          return kw;
        }
      }
    }
    
    // Claude - 读取查询参数
    if (hostname.includes('claude.ai')) {
      const q = searchParams.get('q') || searchParams.get('prompt');
      if (q) {
        const kw = safeDecodeParam(q);
        if (kw && !isGenericHostKeyword(hostname, kw)) {
          BG_DBG('[触触搜][BG][DEBUG] matched claude q:', kw);
          return kw;
        }
      }
    }
    
    // Google搜索（包括各国域名）
    if (hostname.includes('google.')) {
      const q = searchParams.get('q');
      if (q) {
        const kw = safeDecodeParam(q);
        BG_DBG('[触触搜][BG][DEBUG] matched google q:', kw);
        return kw;
      }
    }
    
    // 必应搜索（包括国际版和中国版）
    if (hostname.includes('bing.com') || hostname.includes('cn.bing.com')) {
      const q = searchParams.get('q');
      if (q) {
        const kw = safeDecodeParam(q);
        BG_DBG('[触触搜][BG][DEBUG] matched bing q:', kw);
        return kw;
      }
    }
    
    // 搜狗搜索
    if (hostname.includes('sogou.com')) {
      const query = searchParams.get('query') || searchParams.get('keyword');
      if (query) {
        const kw = safeDecodeParam(query);
        BG_DBG('[触触搜][BG][DEBUG] matched sogou query:', kw);
        return kw;
      }
    }
    
    // 360搜索
    if (hostname.includes('so.com') || hostname.includes('360.cn')) {
      const q = searchParams.get('q');
      if (q) {
        const kw = safeDecodeParam(q);
        BG_DBG('[触触搜][BG][DEBUG] matched 360 q:', kw);
        return kw;
      }
    }
    
    // 神马搜索
    if (hostname.includes('m.sm.cn') || hostname.includes('sm.cn')) {
      const q = searchParams.get('q');
      if (q) {
        const kw = safeDecodeParam(q);
        BG_DBG('[触触搜][BG][DEBUG] matched sm q:', kw);
        return kw;
      }
    }
    
    // 头条搜索
    if (hostname.includes('toutiao.com')) {
      const keyword = searchParams.get('keyword');
      if (keyword) {
        const kw = safeDecodeParam(keyword);
        BG_DBG('[触触搜][BG][DEBUG] matched toutiao keyword:', kw);
        return kw;
      }
    }
    
    // DuckDuckGo
    if (hostname.includes('duckduckgo.com')) {
      const q = searchParams.get('q');
      if (q) {
        const kw = safeDecodeParam(q);
        BG_DBG('[触触搜][BG][DEBUG] matched ddg q:', kw);
        return kw;
      }
    }
    
    // Yahoo搜索
    if (hostname.includes('yahoo.com') || hostname.includes('yahoo.co.jp')) {
      const p = searchParams.get('p');
      if (p) {
        const kw = safeDecodeParam(p);
        BG_DBG('[触触搜][BG][DEBUG] matched yahoo p:', kw);
        return kw;
      }
    }
    
    // Yandex搜索
    if (hostname.includes('yandex.')) {
      const text = searchParams.get('text');
      if (text) {
        const kw = safeDecodeParam(text);
        BG_DBG('[触触搜][BG][DEBUG] matched yandex text:', kw);
        return kw;
      }
    }
    
    // Startpage
    if (hostname.includes('startpage.com')) {
      const query = searchParams.get('query');
      if (query) {
        const kw = safeDecodeParam(query);
        BG_DBG('[触触搜][BG][DEBUG] matched startpage query:', kw);
        return kw;
      }
    }
    
    // 知乎搜索
    if (hostname.includes('zhihu.com')) {
      const q = searchParams.get('q');
      if (q) {
        const kw = safeDecodeParam(q);
        BG_DBG('[触触搜][BG][DEBUG] matched zhihu q:', kw);
        return kw;
      }
    }
    
    // 微博搜索
    if (hostname.includes('weibo.com') || hostname.includes('weibo.cn')) {
      const q = searchParams.get('q');
      if (q) {
        const kw = safeDecodeParam(q);
        BG_DBG('[触触搜][BG][DEBUG] matched weibo q:', kw);
        return kw;
      }
    }
    
    // GitHub搜索
    if (hostname.includes('github.com')) {
      const q = searchParams.get('q');
      if (q) {
        const kw = safeDecodeParam(q);
        BG_DBG('[触触搜][BG][DEBUG] matched github q:', kw);
        return kw;
      }
    }
    
    // B站搜索
    if (hostname.includes('bilibili.com')) {
      const keyword = searchParams.get('keyword');
      if (keyword) {
        const kw = safeDecodeParam(keyword);
        BG_DBG('[触触搜][BG][DEBUG] matched bilibili keyword:', kw);
        return kw;
      }
    }
    
    // 淘宝搜索
    if (hostname.includes('taobao.com') || hostname.includes('tmall.com')) {
      const q = searchParams.get('q') || searchParams.get('keyword');
      if (q) {
        const kw = safeDecodeParam(q);
        BG_DBG('[触触搜][BG][DEBUG] matched taobao/tmall q:', kw);
        return kw;
      }
    }
    
    // 京东搜索
    if (hostname.includes('jd.com')) {
      const keyword = searchParams.get('keyword');
      if (keyword) {
        const kw = safeDecodeParam(keyword);
        BG_DBG('[触触搜][BG][DEBUG] matched jd keyword:', kw);
        return kw;
      }
    }

    // 启发式兜底：未硬编码的站，按 param 打分挑最像关键字的
    const heuristic = heuristicExtractFromParams(searchParams);
    if (heuristic) {
      const kw = safeDecodeParam(heuristic.value);
      BG_DBG('[触触搜][BG][DEBUG] matched heuristic:', { hostname, key: heuristic.key, score: heuristic.score, kw });
      return kw;
    }

    // 如果都没有匹配，尝试获取页面标题作为关键词
    if (tab && tab.title) {
      let title = tab.title;
      BG_DBG('[触触搜][BG][DEBUG] fallback to title:', title);
      
      // 清理常见的网站后缀
      const suffixes = [
        ' - 百度搜索',
        ' - Google 搜索',
        ' - 搜狗搜索',
        ' - 360搜索',
        ' - Bing',
        ' - 知乎',
        ' - 微博',
        ' - GitHub',
        ' - Stack Overflow',
        ' - CSDN博客',
        ' - 简书',
        ' - 掘金',
        ' - 博客园',
        ' | ',
        ' - ',
        ' – ',
        ' — '
      ];
      
      for (const suffix of suffixes) {
        const index = title.lastIndexOf(suffix);
        if (index > 0) {
          title = title.substring(0, index);
          break;
        }
      }

      title = cleanupTitleKeyword(title);

      // 限制长度
      if (title.length > 50) {
        title = title.substring(0, 50) + '...';
      }

      const cleaned = title.trim();
      if (typeof BG_DBG !== 'undefined' && BG_DBG) {
        console.log('[触触搜][BG][DEBUG] final title keyword:', cleaned);
      }
      return cleaned;
    }

  } catch (error) {
    console.error('[触触搜][BG][DEBUG] Error extracting keywords:', error);
  }

  return null;
}

// ==================== 导出到全局 ====================

globalThis.extractSearchKeywords = extractSearchKeywords;
