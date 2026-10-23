/* =========================================================
   抓取单个来源（零依赖）：RSS / Atom / JSON 订阅源 + 普通页面兜底
   被两处共用：/api/sources/test（后台"测试全部来源"）与定时抓取（server/news.js）
   ========================================================= */
function stripTags(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

/* 从 RSS / Atom 文本里解析条目 */
function parseFeed(text) {
  var blocks = text.match(/<item[\s>][\s\S]*?<\/item>/gi) || text.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.slice(0, 10).map(function (b) {
    function pick(tag) {
      var m = b.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
      return m ? stripTags(m[1]) : '';
    }
    var title = pick('title');
    if (!title) return null;
    var link = (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || pick('link');
    return {
      title: title.slice(0, 140),
      summary: (pick('description') || pick('summary') || pick('content')).slice(0, 240),
      link: String(link || '').slice(0, 300)
    };
  }).filter(Boolean);
}

/* 从 JSON 数据里找条目 */
function parseJsonItems(text) {
  var data = null;
  try { data = JSON.parse(text); } catch (e) { return []; }
  var list = Array.isArray(data) ? data
    : (data && (data.items || data.data || data.list || data.articles)) || [];
  if (!Array.isArray(list)) return [];
  return list.slice(0, 10).map(function (x) {
    var title = x && (x.title || x.name || x.headline);
    if (!title) return null;
    return {
      title: String(title).slice(0, 140),
      summary: String((x.summary || x.description || x.content || '')).slice(0, 240),
      link: String((x.link || x.url || '')).slice(0, 300),
      heat: Number(x.heat || x.hot || x.score || 0) || 0
    };
  }).filter(Boolean);
}

/* 抓一个来源：永远 resolve，不抛异常，失败也给可读原因 */
async function fetchSource(source, timeoutMs) {
  const started = Date.now();
  const limit = timeoutMs || 6000;
  const target = String(source && source.url || '').trim();
  if (!/^https?:\/\/.+/i.test(target)) {
    return { id: source && source.id, name: source && source.name, ok: false, ms: 0, count: 0, items: [], reason: '地址格式不对：必须以 http:// 或 https:// 开头' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, limit);
  try {
    const r = await fetch(target, { signal: ctrl.signal, headers: { 'User-Agent': 'HotPulse/1.0 (+prototype)' } });
    const text = await r.text();
    clearTimeout(timer);
    if (!r.ok) {
      return {
        id: source.id, name: source.name, ok: false, ms: Date.now() - started, count: 0, items: [],
        reason: '对方返回 HTTP ' + r.status + '（' + (r.status === 403 ? '拒绝访问' : r.status === 404 ? '地址不存在' : '请求被拒绝') + '）'
      };
    }
    const ctype = String(r.headers.get('content-type') || '');
    let items = [], kind = '';
    if (/xml|rss|atom/i.test(ctype) || /<rss|<feed|<channel/i.test(text)) {
      items = parseFeed(text); kind = 'feed';
    } else if (/json/i.test(ctype)) {
      items = parseJsonItems(text); kind = 'json';
    }
    const linkCount = Math.min(500, (text.match(/<a\s[^>]*href=/gi) || []).length);
    const count = items.length || (kind === 'json' ? 0 : linkCount);
    return {
      id: source.id, name: source.name, ok: true, ms: Date.now() - started, count: count, items: items, kind: kind || 'html',
      reason: items.length
        ? ('解析出 ' + items.length + ' 条' + (kind === 'feed' ? '订阅条目' : ' JSON 条目'))
        : (kind === 'json' ? '接口可访问，但没有解析出条目' : '页面可访问，粗略识别 ' + linkCount + ' 个链接（公开热榜多为前端渲染，拿不到标题）')
    };
  } catch (e) {
    clearTimeout(timer);
    const cause = (e && e.cause && (e.cause.code || e.cause.message)) || '';
    const reason = e.name === 'AbortError' ? '超时（' + Math.round(limit / 1000) + ' 秒未响应）'
      : /ENOTFOUND|EAI_AGAIN/.test(e.message + cause) ? '域名解析失败：地址可能不存在或写错了'
        : /ECONNREFUSED/.test(e.message + cause) ? '对方拒绝连接（端口未开放或被防火墙拦截）'
          : /ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT/.test(e.message + cause) ? '连接超时：对方没有在 ' + Math.round(limit / 1000) + ' 秒内响应'
            : /certificate|SSL|UNABLE_TO_VERIFY/i.test(e.message + cause) ? 'HTTPS 证书校验失败'
              : /ENETUNREACH|EACCES/.test(e.message + cause) ? '网络不可达（当前环境可能限制了外网访问）'
                : '请求失败：' + (cause || e.message);
    return { id: source.id, name: source.name, ok: false, ms: Date.now() - started, count: 0, items: [], reason: reason };
  }
}

module.exports = { stripTags, parseFeed, parseJsonItems, fetchSource };