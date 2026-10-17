/* 本地测试用「服务商」端点（零依赖）
   实现 OpenAI 兼容的 POST /v1/chat/completions，用来验证真实 HTTP 链路：
     · 密钥错误      → 401 invalid_api_key
     · 模型名不存在  → 404 model_not_found
     · 被限流        → 429 rate_limit_exceeded
     · 余额不足      → 402 insufficient_quota
     · 文案生成      → 200，返回一段"照素材拼出来"的合规微博文案
     · 模型评审      → 200，返回四维评分 JSON（有时包代码块/带前后废话，用于验证解析容错）
   另外提供 GET /__last 返回最近一次收到的请求体，便于断言提示词内容。
   启动：node tests/stub-provider.js [端口] */
const http = require('http');

const PORT = Number(process.argv[2] || 8794);
const GOOD_KEY_PREFIX = 'sk-good';
let lastRequest = null;
const requestLog = [];

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise(function (resolve) {
    let raw = '';
    req.on('data', function (c) { raw += c; });
    req.on('end', function () { resolve(raw); });
  });
}

const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, 'http://localhost');

  /* 允许浏览器直连（真实服务商不一定开 CORS，这里模拟一个开启 CORS 的服务商） */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (url.pathname === '/__last' && req.method === 'GET') {
    return send(res, 200, { ok: true, last: lastRequest });
  }
  if (url.pathname === '/__all' && req.method === 'GET') {
    return send(res, 200, { ok: true, count: requestLog.length, requests: requestLog });
  }
  if (url.pathname === '/__reset' && req.method === 'GET') {
    requestLog.length = 0; lastRequest = null;
    return send(res, 200, { ok: true });
  }

  /* 一个可被当作"新闻订阅源"的 RSS：用于验证添加订阅源 → 抓到条目 → 工作台可见 */
  if (url.pathname === '/rss' && req.method === 'GET') {
    const items = [
      {
        title: '订阅源测试：秋季家居保暖小家电销量走高',
        desc: '多家电商平台数据显示，进入换季期后取暖类小家电销量环比上升，桌面取暖设备最受欢迎。'
      },
      {
        title: '订阅源测试：通勤外套进入采购旺季',
        desc: '降温带动外套类目搜索量上升，加绒与防风款式的转化率明显高于普通款。'
      },
      {
        title: '订阅源测试：办公室养生潮带动热饮器具',
        desc: '年轻上班族开始把保温杯、恒温杯列入办公必备，相关商品复购率提升。'
      }
    ];
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>' +
      '<title>实测订阅源</title><link>http://127.0.0.1:' + PORT + '/rss</link>' +
      '<description>用于测试的新闻订阅源</description>' +
      items.map(function (it, i) {
        return '<item><title>' + it.title + '</title>' +
          '<link>http://127.0.0.1:' + PORT + '/rss#item' + (i + 1) + '</link>' +
          '<description>' + it.desc + '</description>' +
          '<pubDate>' + new Date(Date.now() - i * 3600000).toUTCString() + '</pubDate></item>';
      }).join('') +
      '</channel></rss>';
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    return res.end(xml);
  }

  if (url.pathname !== '/v1/chat/completions' || req.method !== 'POST') {
    return send(res, 404, { error: { message: 'Not Found', type: 'invalid_request_error' } });
  }

  let body = {};
  try { body = JSON.parse(await readBody(req)); } catch (e) {}
  var userText = String(((body.messages || []).filter(function (m) { return m.role === 'user'; })[0] || {}).content || '');
  lastRequest = {
    model: body.model, temperature: body.temperature, messages: body.messages,
    auth: req.headers.authorization || '',
    /* 返工调用带着「未通过清单」，评审调用的 system 里带「评审」，据此区分 */
    kind: /评审/.test(String(((body.messages || []).filter(function (m) { return m.role === 'system'; })[0] || {}).content || ''))
      ? 'review'
      : (userText.indexOf('【未通过清单】') > -1 ? 'rework' : 'compose')
  };
  requestLog.push(lastRequest);

  const key = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!key || key.indexOf(GOOD_KEY_PREFIX) !== 0) {
    return send(res, 401, {
      error: {
        message: 'Incorrect API key provided: ' + (key ? key.slice(0, 6) + '***' : '(empty)') + '. You can find your API key at https://example.com/account/api-keys.',
        type: 'invalid_request_error', code: 'invalid_api_key'
      }
    });
  }

  const model = String(body.model || '');
  if (model === 'stub-rate-limit') {
    return send(res, 429, { error: { message: 'Rate limit reached for requests', type: 'requests', code: 'rate_limit_exceeded' } });
  }
  if (model === 'stub-no-balance') {
    return send(res, 402, { error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota', code: 'insufficient_quota' } });
  }
  const VALID_MODELS = ['stub-model', 'stub-model-v2', 'stub-model-v3', 'stub-slow'];
  if (VALID_MODELS.indexOf(model) < 0) {
    return send(res, 404, {
      error: {
        message: 'The model `' + model + '` does not exist or you do not have access to it.',
        type: 'invalid_request_error', code: 'model_not_found'
      }
    });
  }
  /* stub-slow：每条慢 600ms，用来测试「同一条条跑时中途叫停」 */
  if (model === 'stub-slow') await new Promise(function (r) { setTimeout(r, 600); });

  const user = String(((body.messages || []).filter(m => m.role === 'user')[0] || {}).content || '');
  const sys = String(((body.messages || []).filter(m => m.role === 'system')[0] || {}).content || '');
  const content = /评审/.test(sys) ? buildReview(user) : buildCompose(model, user);

  send(res, 200, {
    id: 'chatcmpl-stub-' + Date.now(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model,                     // 回显请求里的模型名，便于断言"用的是哪个模型"
    choices: [{ index: 0, message: { role: 'assistant', content: content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 812, completion_tokens: 96, total_tokens: 908 }
  });
});

/* ============ 下面这段：把收到的素材拼成一段「合规」文案 ============
   目的是让真实 HTTP 链路上也能跑出正常分数——它只按素材里给的东西写，
   不编价格、不带违禁词、字数落在素材声明的区间里。 */
function hashOf(s) {
  let h = 0, t = String(s || '');
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 100003;
  return h;
}
function charCount(t) { return String(t || '').replace(/\s/g, '').length; }

/* 从「商品清单」里读出售价 / 原价 / 名称 / 卖点，模板怎么改都能尽量捞到 */
function parseProducts(user) {
  const out = [];
  user.split('\n').forEach(function (line) {
    const m = line.match(/^\s*\d+\s*[.、]\s*(.+)$/);
    if (!m) return;
    const body = m[1];
    let name = (body.split(/[｜|]/)[0] || '').replace(/（[^）]*）/g, '').trim();
    const price = (body.match(/(?:售价|现价|价格)\s*[¥￥]?\s*(\d+(?:\.\d+)?)/) || [])[1] ||
      (body.match(/[¥￥]\s*(\d+(?:\.\d+)?)/) || [])[1];
    const market = (body.match(/(?:原价|市场价)\s*[¥￥]?\s*(\d+(?:\.\d+)?)/) || [])[1];
    const pts = ((body.match(/卖点[：:]\s*(.+)$/) || [])[1] || '')
      .split(/[、,，;；]/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (name) out.push({ name: name, price: price, market: market, points: pts });
  });
  return out;
}

function buildCompose(model, user) {
  const tags = (user.match(/#[^#\s]{1,24}#/g) || []).slice(0, 3);
  const range = user.match(/字数要求[：:]\s*(\d+)\s*[–\-~—至]\s*(\d+)/);
  const minWords = range ? Number(range[1]) : 60;
  const maxWords = range ? Number(range[2]) : 320;
  const title = ((user.match(/标题[：:]\s*(.+)/) || [])[1] || '今日热点').trim();
  const shortTitle = title.split(/[：:！!，,；;]/)[0].slice(0, 12);
  const prods = parseProducts(user);
  const main = prods[0] || null;
  const emoji = ['🥶', '✨', '🔥'];
  const head = '【' + shortTitle + '】' + emoji[1] + ' 这波来得挺快，提前准备的人更从容。';
  const productLine = main
    ? (main.name + (main.points.length ? '，' + main.points.slice(0, 2).join('，') + '。' : '。'))
    : '';
  const priceLine = main && main.price
    ? ('现在 ¥' + main.price + (main.market ? '（原价 ¥' + main.market + '）' : '') + '，需要的话可以留意一下。')
    : '';
  const cta = '你那边是什么情况？评论区聊聊 👇';
  const blocks = ['【' + model + ' 返回的示例文案】', head, productLine, priceLine, cta, tags.join(' ')];
  let text = blocks.filter(function (b) { return String(b).trim(); }).join('\n\n');

  const fillers = [
    '身边问起的人不少，我一般直接把自己的选择说清楚。',
    '用下来最直观的感受是省心，不用来回折腾。',
    '提前一点准备，真的比临时手忙脚乱舒服。'
  ];
  let guard = 0;
  while (charCount(text) < minWords && guard < fillers.length) { text += '\n\n' + fillers[guard++]; }
  if (charCount(text) > maxWords && productLine && main && main.points.length > 1) {
    /* 宁可少写一个卖点也不能超 */
    const shortProduct = main.name + '，' + main.points[0] + '。';
    text = text.split(productLine).join(shortProduct);
  }
  guard = 0;
  while (charCount(text) > maxWords && guard++ < 4) {
    const lines = text.split('\n');
    let idx = -1;
    lines.forEach(function (l, i) { if (idx < 0 && /^(【|现在|你那边|#|\d)/.test(l) === false && l.trim()) idx = i; });
    if (idx < 0) break;
    lines.splice(idx, 1);
    text = lines.join('\n');
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/* 评审：读素材里的价格与文案本身，给出四维分 + 一句点评 */
function buildReview(user) {
  const parts = String(user).split('【待评审文案】');
  const material = parts[0] || '';
  const copy = (parts[1] || '').trim() || String(user);
  const amounts = (material.match(/[¥￥]\s*\d+(?:\.\d+)?/g) || []);
  const priceAccurate = amounts.some(function (a) { return copy.indexOf(a) > -1; });
  const hasTag = /#[^#\s]{1,24}#/.test(copy);
  const hasCta = /评论区|评论里|扣个|留言|私信|聊聊|说说|告诉我/.test(copy);
  const hasHook = copy.indexOf('【') === 0;
  const hasJunk = /\*\*|\{\{|```/.test(copy);
  const tooLong = charCount(copy) > Number((material.match(/上限\s*(\d+)/) || [])[1] || 320);
  const clamp = function (n) { return Math.max(1, Math.min(5, Math.round(n))); };
  const seed = hashOf(copy);
  const dims = {
    hot: clamp(3 + (hasHook ? 1 : 0) + (seed % 2)),
    material: clamp((priceAccurate ? 4 : 2) + (seed % 2)),
    appeal: clamp(3 + (hasTag && hasCta ? 1 : 0) + ((seed >> 2) % 2)),
    natural: clamp(5 - (hasJunk ? 2 : 0) - (tooLong ? 1 : 0) - (seed % 2) + 1)
  };
  const comment = dims.material >= 4
    ? '热点与商品衔接自然，价格与卖点用得准，结尾互动引导可用。'
    : '热点接得上，但素材里的价格或卖点用得不够准，建议对照素材再改。';
  const json = JSON.stringify({ hot: dims.hot, material: dims.material, appeal: dims.appeal, natural: dims.natural, comment: comment });
  /* 三种形态，用来验证前端解析容错：代码块 / 带废话 / 纯 JSON */
  const form = seed % 3;
  if (form === 0) return '```json\n' + json + '\n```';
  if (form === 1) return '好的，我的评分如下：\n' + json + '\n以上为本次评审结果，供参考。';
  return json;
}

server.listen(PORT, function () {
  console.log('stub provider listening on http://127.0.0.1:' + PORT + '/v1  (模型名 stub-model，密钥 sk-good-*)');
});
