/* =========================================================
   HotPulse 本地服务端（零依赖，只用 Node 内置模块）
   启动：node server/server.js [端口]
   · 静态托管工作台 index.html 与后台 admin.html
   · 配置读写：GET /api/config、PUT /api/config
     - 读取时自动补齐缺失内容（误删一段也不会崩）
     - 写入前把上一版备份到 data/backups（保留最近 10 份）
     - 关键内容为空直接拒绝写入
   ========================================================= */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DEFAULTS_FILE = path.join(__dirname, 'defaults.json');
const PORT = Number(process.argv[2] || process.env.PORT || 8787);
/* 监听地址：默认 0.0.0.0（同局域网可访问）；只在本机用可设 HOST=127.0.0.1 */
const HOST = process.env.HOST || '0.0.0.0';
const KEEP_BACKUPS = 10;

/* 只对外暴露前端资源，数据、服务端源码、测试脚本一律不给下载
   （data/config.json 里可能有密钥，绝不能通过静态服务泄出去） */
const STATIC_DENY = ['data', 'server', 'tests', 'scripts', 'work', 'outputs', 'node_modules'];

function staticBlocked(rel) {
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (!parts.length) return false;
  if (parts.indexOf('..') >= 0) return true;                                  /* 目录穿越 */
  if (parts.some(function (p) { return p.charAt(0) === '.'; })) return true;  /* 隐藏文件/目录 */
  return STATIC_DENY.indexOf(parts[0].toLowerCase()) >= 0;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8'
};

function ensureDirs() {
  [DATA_DIR, BACKUP_DIR].forEach(function (d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
}

function loadDefaults() {
  try { return JSON.parse(fs.readFileSync(DEFAULTS_FILE, 'utf8')); } catch (e) { return {}; }
}

function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function deepMerge(base, override) {
  const out = JSON.parse(JSON.stringify(base || {}));
  if (!isPlainObject(override)) return out;
  Object.keys(override).forEach(function (k) {
    const v = override[k];
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k], v);
    else if (v !== undefined && v !== null) out[k] = JSON.parse(JSON.stringify(v));
  });
  return out;
}

/* 读取时补齐缺失内容，并告诉前端补了哪些区块 */
function readConfig() {
  ensureDirs();
  const defaults = loadDefaults();
  let stored = {}, filled = [];
  const existed = fs.existsSync(CONFIG_FILE);
  /* 这几个键不是"配置区块"，不计入补齐提示 */
  const NOT_SECTIONS = ['version', 'updatedAt', 'ui'];
  if (existed) {
    try { stored = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
    catch (e) { return { ok: false, status: 500, error: '服务端配置文件不是合法 JSON：' + e.message }; }
  }
  Object.keys(defaults).forEach(function (k) {
    if (!(k in stored) || stored[k] === null) {
      stored[k] = JSON.parse(JSON.stringify(defaults[k]));
      if (existed && NOT_SECTIONS.indexOf(k) < 0) filled.push(k);
    }
    else if (isPlainObject(defaults[k]) && isPlainObject(stored[k])) {
      const before = JSON.stringify(stored[k]);
      stored[k] = deepMerge(defaults[k], stored[k]);
      if (JSON.stringify(stored[k]) !== before && NOT_SECTIONS.indexOf(k) < 0) filled.push(k);
    }
  });
  const savedAt = fs.existsSync(CONFIG_FILE) ? fs.statSync(CONFIG_FILE).mtime.toISOString() : null;
  /* 首次运行（配置文件还不存在）不算"缺了一段"，不做补齐提示 */
  return { ok: true, config: stored, savedAt: savedAt, filled: existed ? filled : [], isNew: !existed };
}

/* 写入前的防线 */
function guard(cfg) {
  const errors = [];
  if (!isPlainObject(cfg)) return ['提交内容不是有效的配置对象'];
  if (Object.keys(cfg).length === 0) errors.push('配置内容为空（拒绝写入）');
  if (Array.isArray(cfg.products) && cfg.products.length === 0) errors.push('商品列表不能为空（拒绝写入）');
  if (!cfg.prompt || !String(cfg.prompt.role || '').trim()) errors.push('角色设定不能为空（拒绝写入）');
  return errors;
}

function backup() {
  ensureDirs();
  if (!fs.existsSync(CONFIG_FILE)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(BACKUP_DIR, 'config-' + stamp + '.json');
  fs.copyFileSync(CONFIG_FILE, target);
  const files = fs.readdirSync(BACKUP_DIR).filter(function (f) { return /^config-.*\.json$/.test(f); }).sort();
  while (files.length > KEEP_BACKUPS) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, files.shift())); } catch (e) {}
  }
  return path.basename(target);
}

function writeConfig(cfg) {
  ensureDirs();
  const errors = guard(cfg);
  if (errors.length) return { ok: false, status: 400, errors: errors };
  const bak = backup();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  return { ok: true, savedAt: new Date().toISOString(), backup: bak, path: CONFIG_FILE };
}

function send(res, status, body, type) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(payload);
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    let raw = '';
    req.on('data', function (c) { raw += c; if (raw.length > 8e6) { reject(new Error('请求体过大')); req.destroy(); } });
    req.on('end', function () { resolve(raw); });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  if (staticBlocked(rel)) {
    return send(res, 403, 'Forbidden: ' + rel + ' 不对静态访问开放', 'text/plain; charset=utf-8');
  }
  const target = path.join(ROOT, rel);
  if (!target.startsWith(ROOT)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  fs.stat(target, function (err, st) {
    if (err || !st.isFile()) return send(res, 404, 'Not Found: ' + rel, 'text/plain; charset=utf-8');
    const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    fs.createReadStream(target).pipe(res);
  });
}

/* 模型中转：密钥可以放在服务端环境变量里，浏览器完全不接触密钥 */
/* ---------------- 来源测试：真发一次抓取，逐个返回结果与条目 ---------------- */
function stripTags(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

/* 从 RSS / Atom 文本里解析条目（零依赖，够用即可） */
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
      link: String((x.link || x.url || '')).slice(0, 300)
    };
  }).filter(Boolean);
}

async function handleSourcesTest(req, res) {
  let body = {};
  try { body = JSON.parse(await readBody(req)); } catch (e) {}
  const list = body.sources || [];
  const results = [];

  for (const s of list) {
    const started = Date.now();
    const target = String(s.url || '').trim();
    if (!/^https?:\/\/.+/i.test(target)) {
      results.push({ id: s.id, name: s.name, ok: false, ms: 0, count: 0, items: [], reason: '地址格式不对：必须以 http:// 或 https:// 开头' });
      continue;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, 6000);
    try {
      const r = await fetch(target, { signal: ctrl.signal, headers: { 'User-Agent': 'HotPulse/1.0 (+prototype)' } });
      const text = await r.text();
      clearTimeout(timer);
      if (!r.ok) {
        results.push({
          id: s.id, name: s.name, ok: false, ms: Date.now() - started, count: 0, items: [],
          reason: '对方返回 HTTP ' + r.status + '（' + (r.status === 403 ? '拒绝访问' : r.status === 404 ? '地址不存在' : '请求被拒绝') + '）'
        });
        continue;
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
      results.push({
        id: s.id, name: s.name, ok: true, ms: Date.now() - started, count: count, items: items, kind: kind || 'html',
        reason: items.length
          ? ('解析出 ' + items.length + ' 条' + (kind === 'feed' ? '订阅条目' : ' JSON 条目'))
          : (kind === 'json' ? '接口可访问，但没有解析出条目' : '页面可访问，粗略识别 ' + linkCount + ' 个链接（公开热榜多为前端渲染，拿不到标题）')
      });
    } catch (e) {
      clearTimeout(timer);
      const cause = (e && e.cause && (e.cause.code || e.cause.message)) || '';
      const reason = e.name === 'AbortError' ? '超时（6 秒未响应）'
        : /ENOTFOUND|EAI_AGAIN/.test(e.message + cause) ? '域名解析失败：地址可能不存在或写错了'
          : /ECONNREFUSED/.test(e.message + cause) ? '对方拒绝连接（端口未开放或被防火墙拦截）'
            : /ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT/.test(e.message + cause) ? '连接超时：对方没有在 6 秒内响应'
              : /certificate|SSL|UNABLE_TO_VERIFY/i.test(e.message + cause) ? 'HTTPS 证书校验失败'
                : /ENETUNREACH|EACCES/.test(e.message + cause) ? '网络不可达（当前环境可能限制了外网访问）'
                  : '请求失败：' + (cause || e.message);
      results.push({ id: s.id, name: s.name, ok: false, ms: Date.now() - started, count: 0, items: [], reason: reason });
    }
  }
  send(res, 200, { ok: true, via: 'server', testedAt: new Date().toISOString(), results: results });
}

async function handleLLM(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch (e) { return send(res, 400, { ok: false, error: '请求体不是合法 JSON' }); }

  const base = String(body.baseUrl || '').replace(/\/+$/, '');
  const key = body.apiKey || process.env.HOTPULSE_API_KEY || process.env.OPENAI_API_KEY || '';
  if (!base) return send(res, 400, { ok: false, error: '缺少 baseUrl（接口地址）' });
  if (!key) {
    return send(res, 400, {
      ok: false,
      error: '服务端没有可用密钥：请在后台填写，或启动服务端时设置环境变量 HOTPULSE_API_KEY'
    });
  }
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, 60000);
  try {
    const upstream = await fetch(base + '/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: body.model,
        temperature: body.temperature,
        stream: false,
        messages: body.messages || []
      })
    });
    const text = await upstream.text();
    send(res, upstream.status, text, 'application/json; charset=utf-8');
  } catch (e) {
    const msg = e.name === 'AbortError' ? '请求超时（60 秒）' : (e.cause && e.cause.code) || e.message;
    send(res, 502, { ok: false, error: '中转失败：' + msg });
  } finally {
    clearTimeout(timer);
  }
}

const server = http.createServer(async function (req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    if (pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (pathname === '/api/health') {
      return send(res, 200, { ok: true, name: 'hotpulse-local', port: PORT, configFile: CONFIG_FILE, time: new Date().toISOString() });
    }
    if (pathname === '/api/config' && req.method === 'GET') {
      const r = readConfig();
      if (!r.ok) return send(res, r.status || 500, { ok: false, errors: [r.error] });
      return send(res, 200, {
        ok: true, config: r.config, savedAt: r.savedAt, filled: r.filled,
        isNew: !!r.isNew, configFile: CONFIG_FILE
      });
    }
    if (pathname === '/api/config' && req.method === 'PUT') {
      let body;
      try { body = JSON.parse(await readBody(req)); }
      catch (e) { return send(res, 400, { ok: false, errors: ['请求体不是合法 JSON'] }); }
      const r = writeConfig(body.config || body);
      return send(res, r.ok ? 200 : (r.status || 400), r.ok ? r : { ok: false, errors: r.errors });
    }
    if (pathname === '/api/config/backups' && req.method === 'GET') {
      ensureDirs();
      const files = fs.readdirSync(BACKUP_DIR).filter(function (f) { return /^config-.*\.json$/.test(f); })
        .sort().reverse().map(function (f) {
          const p = path.join(BACKUP_DIR, f);
          return { name: f, size: fs.statSync(p).size, time: fs.statSync(p).mtime.toISOString() };
        });
      return send(res, 200, { ok: true, dir: BACKUP_DIR, count: files.length, backups: files });
    }
    if (pathname === '/api/llm' && req.method === 'POST') return handleLLM(req, res);
    if (pathname === '/api/sources/test' && req.method === 'POST') return handleSourcesTest(req, res);
    return serveStatic(req, res, pathname);
  } catch (e) {
    send(res, 500, { ok: false, error: e.message });
  }
});

/* 列出本机可用的局域网地址，方便同事直接用同一台机器的服务 */
function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(function (name) {
    (ifaces[name] || []).forEach(function (info) {
      if (info.family === 'IPv4' && !info.internal) out.push(info.address);
    });
  });
  return out;
}

server.listen(PORT, HOST, function () {
  ensureDirs();
  const startedAt = new Date();
  console.log('HotPulse 服务端已启动  ' + startedAt.toLocaleString('zh-CN'));
  console.log('  监听地址：' + HOST + ':' + PORT);
  console.log('  工作台：http://localhost:' + PORT + '/index.html');
  console.log('  后台  ：http://localhost:' + PORT + '/admin.html');
  lanAddresses().forEach(function (ip) {
    console.log('  局域网：http://' + ip + ':' + PORT + '/index.html');
  });
  console.log('  配置文件：' + CONFIG_FILE);
  console.log('  备份目录：' + BACKUP_DIR);
  console.log('  静态访问已收口：data/ server/ tests/ scripts/ work/ outputs/ 不对外开放');
});

server.on('error', function (e) {
  if (e.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用：换一个端口启动，例如  node server/server.js 8788');
  } else {
    console.error('服务端启动失败：' + e.message);
  }
  process.exit(1);
});
