// isGenericHostKeyword 在 background/utils/TextUtils.js。

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
// src：来源标记参数（x.com 的 ?src=typed_query、多数站的 ?src=share），值长得像词但不是关键字
const PARAM_BLACKLIST = /^(utm_|ref|fbclid|gclid|tbm|hl|source|sourceid|src|ie|oe|biw|bih|sa|ved|ei|sclient|cs|aep|atvm|chrome_task)/i;

// 域名匹配必须后缀对齐，不能用 includes：
//   'netflix.com'.includes('x.com') === true、'youtube.com.evil.test'.includes('youtube.com') === true
function matchesHostSuffix(hostname, domain) {
  return hostname === domain || hostname.endsWith('.' + domain);
}

// 启发式跳过名单：这些站的 URL 参数从来不是用户关键字，命中后跳过 heuristicExtractFromParams
// 直接走 title fallback（真正的关键字参数已由上面的站点规则取走）
//   youtube: watch?v=ID 会把 11 字符 video ID 误当关键字
//   x/twitter: 分享链接 ?s=20 会把分享码误当关键字
const HOSTS_SKIP_HEURISTIC = ['youtube.com', 'youtu.be', 'x.com', 'twitter.com'];

function heuristicExtractFromParams(searchParams) {
  const candidates = [];
  for (const [key, value] of searchParams) {
    if (!value || value.length > 500) continue;
    if (PARAM_BLACKLIST.test(key)) continue;

    const isCommonKey = COMMON_QUERY_KEYS.includes(key.toLowerCase());
    // 常见关键字 key 允许单字符：q=d / q=中 都是合法搜索词（曾被 length<2 一刀切丢掉，
    // 结果噪声参数捡漏当选）。但纯数字单字符排除：?p=1 / ?s=2 分页远比搜索 "1" 常见
    const minLength = (isCommonKey && !/^\d+$/.test(value)) ? 1 : 2;
    if (value.length < minLength) continue;

    let score = 0;
    if (isCommonKey) score += 10;
    score += Math.min(value.length / 10, 5);
    if (/[一-龥]/.test(value)) score += 3;
    if (/^https?:\/\//.test(value)) score -= 100;
    if (/^[0-9a-f-]{20,}$/i.test(value)) score -= 100;
    if (/^\d+$/.test(value)) score -= 5;       // 纯数字（id/year/page 等）大概率不是关键字

    if (score > 0) candidates.push({ key, value, score, common: isCommonKey ? 1 : 0 });
  }
  if (!candidates.length) return null;
  // 常见关键字 key 整体优先于其它 param：无论长短，src/foo 这类都不得越过 q/wd/query
  candidates.sort((a, b) => (b.common - a.common) || (b.score - a.score));
  const best = candidates[0];
  return { key: best.key, value: best.value, score: best.score };
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
    
    // X (Twitter) 搜索
    if (matchesHostSuffix(hostname, 'x.com') || matchesHostSuffix(hostname, 'twitter.com')) {
      const q = searchParams.get('q');
      if (q) {
        const kw = safeDecodeParam(q);
        BG_DBG('[触触搜][BG][DEBUG] matched x/twitter q:', kw);
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
    // youtube 等 HOSTS_SKIP_HEURISTIC 跳过：避免把 watch?v=11 字符 ID 误当关键字，直接走 title fallback
    const skipHeuristic = HOSTS_SKIP_HEURISTIC.some((h) => matchesHostSuffix(hostname, h));
    if (!skipHeuristic) {
      const heuristic = heuristicExtractFromParams(searchParams);
      if (heuristic) {
        const kw = safeDecodeParam(heuristic.value);
        BG_DBG('[触触搜][BG][DEBUG] matched heuristic:', { hostname, key: heuristic.key, score: heuristic.score, kw });
        return kw;
      }
    } else {
      BG_DBG('[触触搜][BG][DEBUG] skip heuristic for host:', hostname);
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
