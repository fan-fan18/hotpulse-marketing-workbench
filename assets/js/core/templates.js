/* =========================================================
   HP.Templates —— 各数据入口的「填写模板」与导入导出
   · 每个数据入口 = 一份字段定义 + 示例行 + 逐行校验 + 写入草稿
   · 模板本身不写死任何业务数据：空白模板只有表头，示例模板只有一两行示范
   · 浏览器与 Node 共用（UMD）：后台页面、评测台、自动化测试用的是同一份逻辑
   ========================================================= */
(function () {
  'use strict';
  var ROOT = (typeof window !== 'undefined') ? window : global;
  var HP = ROOT.HP = ROOT.HP || {};

  /* ---------------- CSV：序列化 ---------------- */
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function rowsToCSV(headers, rows) {
    var lines = [headers.map(csvCell).join(',')];
    (rows || []).forEach(function (r) { lines.push(r.map(csvCell).join(',')); });
    return '\ufeff' + lines.join('\r\n');   // BOM：Excel / WPS 打开不乱码
  }

  /* ---------------- CSV：状态机解析 ---------------- */
  /* 支持：引号包裹、字段内逗号、字段内换行、转义引号（""）、CRLF、BOM */
  function parseCSV(text) {
    var t = String(text == null ? '' : text).replace(/^\ufeff/, '');
    var rows = [], row = [], cell = '', q = false, i = 0;
    while (i < t.length) {
      var ch = t.charAt(i);
      if (q) {
        if (ch === '"') {
          if (t.charAt(i + 1) === '"') { cell += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        cell += ch; i++; continue;
      }
      if (ch === '"') { q = true; i++; continue; }
      if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
      cell += ch; i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  }

  function splitList(s) {
    return String(s == null ? '' : s).split(/[、,，;；\/|]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function isTrue(v) { return /^(1|是|true|y|yes|启用|开)$/i.test(String(v == null ? '' : v).trim()); }
  function isUrl(u) { return /^https?:\/\/[^\s\/]+\.[^\s]+$/i.test(String(u || '').trim()) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(String(u || '').trim()); }
  function num(v) { var n = Number(String(v == null ? '' : v).trim()); return isFinite(n) ? n : NaN; }
  function stamp() { var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); }
  function rid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

  /* ================= 入口 1：商品库 ================= */
  var PRODUCT_FIELDS = [
    { key: 'name', label: '名称', required: true, sample: '轻氧感 鹅绒羽绒服 90 白鸭绒', help: '必填' },
    { key: 'price', label: '售价', required: true, type: 'num', sample: '699', help: '大于 0' },
    { key: 'marketPrice', label: '原价', type: 'num', sample: '1299', help: '留空按售价计；填了就不能低于售价' },
    { key: 'cat', label: '品类', required: true, sample: '服饰鞋包', help: '可从已有品类里挑，也可以直接写新的' },
    { key: 'points', label: '卖点', type: 'list', sample: '90 白鸭绒、轻至 380g、可机洗', help: '用顿号分隔，建议 2–4 个' },
    { key: 'emoji', label: '图标', sample: '🧥', help: '留空默认 🛍️' }
  ];

  var ENTRIES = {};

  ENTRIES.products = {
    key: 'products', name: '商品库', file: '商品库', unit: '件', formats: ['csv', 'json'],
    desc: '一行一件商品。卖点用顿号分隔多个；导入前会逐行校验，价格非法、名称为空都会被列出行号。',
    fields: PRODUCT_FIELDS,
    sampleRows: [
      ['轻氧感 鹅绒羽绒服 90 白鸭绒', '699', '1299', '服饰鞋包', '90 白鸭绒、轻至 380g、可机洗', '🧥'],
      ['车载磁吸无线充电支架', '89', '159', '数码家电', '磁吸稳固、15W 快充、单手取放', '🔌']
    ],
    exportRows: function (cfg) {
      return (cfg.products || []).map(function (p) {
        return [p.name, p.price, p.marketPrice, p.cat, (p.points || []).join('、'), p.emoji || '🛍️'];
      });
    },
    exportJSON: function (cfg) {
      return { type: 'hotpulse.products', version: 1, exportedAt: new Date().toISOString(), products: cfg.products || [] };
    },
    jsonToList: function (json) {
      if (Array.isArray(json)) return json;
      if (json && Array.isArray(json.products)) return json.products;
      return null;
    },
    /* 把一行（CSV 或 JSON 对象）规整成待校验项 */
    normRow: function (o) {
      return {
        name: String(o.name == null ? '' : o.name).trim(),
        price: o.price, marketPrice: o.marketPrice,
        cat: String(o.cat == null ? '' : o.cat).trim(),
        points: Array.isArray(o.points) ? o.points.slice() : splitList(o.points),
        emoji: String(o.emoji == null ? '' : o.emoji).trim()
      };
    },
    validate: function (it) {
      var r = [];
      var price = num(it.price), market = (it.marketPrice === '' || it.marketPrice == null) ? null : num(it.marketPrice);
      if (!it.name) r.push('名称为空（必填）');
      if (!(price > 0)) r.push('售价必须是大于 0 的数字（当前：' + (it.price === '' || it.price == null ? '空' : it.price) + '）');
      if (market !== null && !(market > 0)) r.push('原价必须是大于 0 的数字（当前：' + it.marketPrice + '）');
      if (market !== null && market > 0 && price > 0 && market < price) r.push('原价（' + market + '）不能低于售价（' + price + '）');
      if (!it.cat) r.push('品类为空（必填）');
      return r;
    },
    toItem: function (it, cfg) {
      var price = num(it.price), market = (it.marketPrice === '' || it.marketPrice == null) ? price : num(it.marketPrice);
      var P = (HP.Products && HP.Products.nextId) ? HP.Products.nextId(cfg.products || []) : ('p' + ((cfg.products || []).length + 1));
      /* 背景渐变按名称散列轮换，保证卡片视图不是清一色 */
      var keys = (HP.Config && HP.Config.GRADIENTS) ? Object.keys(HP.Config.GRADIENTS) : ['indigo'];
      var h = 0, nm = String(it.name || '');
      for (var i = 0; i < nm.length; i++) h = (h * 31 + nm.charCodeAt(i)) % 100003;
      return {
        id: P, name: it.name, brand: '', cat: it.cat, price: price, marketPrice: market,
        stock: 0, rating: 0, sales30d: 0, conversion: 0,
        emoji: it.emoji || '🛍️', sku: '', gradient: keys[Math.abs(h) % keys.length], points: it.points
      };
    },
    apply: function (items, cfg, opt) {
      var mode = (opt && opt.mode) || 'replace';
      /* 逐件追加着算编号：否则同一批里每件都会拿到同一个 id（nextId 看到的还是旧列表） */
      var base = mode === 'append' ? (cfg.products || []).slice() : [];
      var made = [];
      items.forEach(function (it) {
        made.push(ENTRIES.products.toItem(it, { products: base.concat(made) }));
      });
      cfg.products = base.concat(made);
      return { added: mode === 'append' ? made.length : 0, replaced: mode === 'append' ? 0 : made.length, skipped: 0 };
    }
  };

  /* ================= 入口 2：抓取来源（自定义订阅源） ================= */
  ENTRIES.sources = {
    key: 'sources', name: '抓取来源', file: '抓取来源', unit: '个', formats: ['csv', 'json'],
    desc: '一行一个订阅源。内置平台热榜不允许删除（只能停用），所以模板里只需要填自己要加的订阅源；地址必须是 http/https。',
    fields: [
      { key: 'name', label: '名称', required: true, sample: '36氪快讯', help: '必填，同名会覆盖同地址的旧条目' },
      { key: 'url', label: '地址', required: true, sample: 'https://36kr.com/feed', help: 'RSS / Atom，或返回 JSON 列表的接口' },
      { key: 'kind', label: '类型', sample: 'feed', help: 'feed / json / auto，留空按 auto' },
      { key: 'enabled', label: '启用', sample: '是', help: '填「否」则添加后先停用' },
      { key: 'note', label: '备注', sample: '运营自己加的新闻订阅源' }
    ],
    sampleRows: [
      ['36氪快讯', 'https://36kr.com/feed', 'feed', '是', '科技 / 商业资讯'],
      ['本地演示源', 'http://127.0.0.1:8899/rss', 'feed', '否', '本地 RSS，用来验证链路']
    ],
    exportRows: function (cfg) {
      return (cfg.sources || []).filter(function (s) { return s.type !== 'builtin'; }).map(function (s) {
        return [s.name, s.url, s.type || 'auto', s.enabled ? '是' : '否', s.note || ''];
      });
    },
    exportJSON: function (cfg) {
      return {
        type: 'hotpulse.sources', version: 1, exportedAt: new Date().toISOString(),
        sources: (cfg.sources || []).filter(function (s) { return s.type !== 'builtin'; })
          .map(function (s) { return { name: s.name, url: s.url, kind: s.type, enabled: !!s.enabled, note: s.note || '' }; })
      };
    },
    jsonToList: function (json) { if (json && Array.isArray(json.sources)) return json.sources; if (Array.isArray(json)) return json; return null; },
    normRow: function (o) {
      return {
        name: String(o.name == null ? '' : o.name).trim(),
        url: String(o.url == null ? '' : o.url).trim(),
        kind: String(o.kind == null ? '' : o.kind).trim().toLowerCase() || 'auto',
        enabled: o.enabled === true ? true : isTrue(o.enabled),
        note: String(o.note == null ? '' : o.note).trim()
      };
    },
    validate: function (it) {
      var r = [];
      if (!it.name) r.push('名称为空（必填）');
      if (!it.url) r.push('地址为空（必填）');
      else if (!isUrl(it.url)) r.push('地址格式不对，需要以 http:// 或 https:// 开头的完整地址（当前：' + it.url + '）');
      if (['feed', 'json', 'auto', 'rss'].indexOf(it.kind) < 0) r.push('类型只能是 feed / json / auto（当前：' + it.kind + '）');
      return r;
    },
    toItem: function (it) {
      return {
        id: rid('src_'), name: it.name, type: 'custom', url: it.url,
        kind: it.kind === 'rss' ? 'feed' : it.kind, enabled: it.enabled, note: it.note, items: []
      };
    },
    apply: function (items, cfg, opt) {
      var list = cfg.sources || (cfg.sources = []);
      var byUrl = {};
      list.forEach(function (s) { byUrl[String(s.url || '').toLowerCase()] = s; });
      var added = 0, updated = 0, skipped = 0;
      items.forEach(function (it) {
        var key = it.url.toLowerCase();
        if (byUrl[key]) {
          if (byUrl[key].type !== 'builtin') {
            byUrl[key].name = it.name; byUrl[key].enabled = it.enabled; byUrl[key].note = it.note; updated++;
          } else { skipped++; }
          return;
        }
        var item = ENTRIES.sources.toItem(it);
        list.push(item); byUrl[key] = item; added++;
      });
      return { added: added, replaced: updated, skipped: skipped };
    }
  };

  /* ================= 入口 3：创作风格 ================= */
  ENTRIES.styles = {
    key: 'styles', name: '创作风格', file: '创作风格', unit: '个', formats: ['csv', 'json'],
    desc: '一行一个风格。「创作要求」会原样拼进素材里驱动模型；顺序就是工作台里的候选版本顺序。至少保留一个。',
    fields: [
      { key: 'order', label: '顺序', type: 'num', sample: '1', help: '留空按行号排序' },
      { key: 'name', label: '名称', required: true, sample: '热点借势' },
      { key: 'requirement', label: '创作要求', required: true, sample: '先接住热点情绪，再自然过渡到商品，重体验感。', help: '一句话到一段话都行' }
    ],
    sampleRows: [
      ['1', '热点借势', '先接住热点情绪，再自然过渡到商品，重体验感。'],
      ['2', '促销导向', '突出价格钩子和紧迫感，重转化。']
    ],
    exportRows: function (cfg) {
      return (cfg.styles || []).map(function (s, i) { return [String(i + 1), s.name, s.requirement]; });
    },
    exportJSON: function (cfg) { return { type: 'hotpulse.styles', version: 1, styles: cfg.styles || [] }; },
    jsonToList: function (json) { if (json && Array.isArray(json.styles)) return json.styles; if (Array.isArray(json)) return json; return null; },
    normRow: function (o, i) {
      return {
        order: (o.order === '' || o.order == null) ? (i + 1) : (num(o.order) || (i + 1)),
        name: String(o.name == null ? '' : o.name).trim(),
        requirement: String(o.requirement == null ? '' : o.requirement).trim(),
        id: o.id || ''
      };
    },
    validate: function (it) {
      var r = [];
      if (!it.name) r.push('名称为空（必填）');
      if (!it.requirement) r.push('创作要求为空（必填）');
      return r;
    },
    toItem: function (it, cfg) {
      var old = (cfg.styles || []).filter(function (s) { return s.name === it.name; })[0];
      return { id: (old && old.id) || rid('st_'), name: it.name, requirement: it.requirement, order: it.order };
    },
    apply: function (items, cfg) {
      if (!items.length) throw new Error('创作风格至少要保留一个');
      var seen = {};
      items.forEach(function (it) { if (seen[it.name]) throw new Error('风格名称重复：' + it.name); seen[it.name] = 1; });
      var ordered = items.slice().sort(function (a, b) { return a.order - b.order; });
      var before = (cfg.styles || []).length;
      cfg.styles = ordered.map(function (it) { return ENTRIES.styles.toItem(it, cfg); });
      return { added: Math.max(0, cfg.styles.length - before), replaced: cfg.styles.length, skipped: 0 };
    }
  };

  /* ================= 入口 4：语调预设 ================= */
  ENTRIES.tones = {
    key: 'tones', name: '语调预设', file: '语调预设', unit: '个', formats: ['csv', 'json'],
    desc: '一行一个语调标签。会出现在工作台的「主打语调」下拉里，并作为素材里的 {{语调}} 传给模型。至少保留一个。',
    fields: [{ key: 'name', label: '名称', required: true, sample: '热点借势' }],
    sampleRows: [['热点借势'], ['促销导向'], ['互动话题']],
    exportRows: function (cfg) { return (cfg.tones || []).map(function (t) { return [t.name]; }); },
    exportJSON: function (cfg) { return { type: 'hotpulse.tones', version: 1, tones: cfg.tones || [] }; },
    jsonToList: function (json) {
      if (json && Array.isArray(json.tones)) return json.tones;
      if (Array.isArray(json)) return json.map(function (x) { return typeof x === 'string' ? { name: x } : x; });
      return null;
    },
    normRow: function (o) { return { name: String(o.name == null ? '' : o.name).trim(), id: o.id || '' }; },
    validate: function (it) { return it.name ? [] : ['名称为空（必填）']; },
    toItem: function (it, cfg) {
      var old = (cfg.tones || []).filter(function (t) { return t.name === it.name; })[0];
      return { id: (old && old.id) || rid('tn_'), name: it.name };
    },
    apply: function (items, cfg) {
      if (!items.length) throw new Error('语调至少要保留一个');
      var seen = {};
      items.forEach(function (it) { if (seen[it.name]) throw new Error('语调重复：' + it.name); seen[it.name] = 1; });
      var before = (cfg.tones || []).length;
      cfg.tones = items.map(function (it) { return ENTRIES.tones.toItem(it, cfg); });
      return { added: Math.max(0, cfg.tones.length - before), replaced: cfg.tones.length, skipped: 0 };
    }
  };

  /* ================= 入口 5：评测用例 ================= */
  ENTRIES.cases = {
    key: 'cases', name: '评测用例', file: '评测用例', unit: '条', formats: ['csv', 'json'], listKey: 'cases',
    desc: '一条用例 = 一组素材（热点 + 商品 + 话题 + 语调）。热点ID 就是工作台/热点池里的条目编号（形如 sn_xxx）；商品编号用顿号或逗号分隔。',
    fields: [
      { key: 'name', label: '名称', required: true, sample: '冷空气×羽绒服' },
      { key: 'newsId', label: '热点ID', required: true, sample: 'sn_xxxxxxxxxxxx', help: '填热点池里的条目编号；不确定就先去工作台复制' },
      { key: 'productIds', label: '商品编号', required: true, type: 'list', sample: 'p1、p2', help: '最多 3 件，第一件为主推；编号见商品库' },
      { key: 'tags', label: '话题标签', type: 'list', sample: '#冷空气来了#、#一夜入秋#', help: '用顿号分隔；留空则用热点自带话题' },
      { key: 'tone', label: '语调', sample: '热点借势', help: '必须是语调预设里已有的名称' },
      { key: 'emojiLevel', label: '表情强度', sample: '1', help: '0 不用 / 1 适中 / 2 丰富' },
      { key: 'selected', label: '参与本轮', sample: '是', help: '填「否」则导入后不勾选' }
    ],
    sampleRows: [
      ['冷空气×羽绒服', 'sn_xxxxxxxxxxxx', 'p1、p2', '#冷空气来了#、#一夜入秋#', '热点借势', '1', '是']
    ],
    exportRows: function (cfg) {
      return (((cfg.evalConfig || {}).cases) || []).map(function (c) {
        return [c.name, c.newsId, (c.productIds || []).join('、'), (c.tags || []).join('、'), c.tone || '',
          String(c.emojiLevel == null ? 1 : c.emojiLevel), c.selected === false ? '否' : '是'];
      });
    },
    exportJSON: function (cfg) {
      return { type: 'hotpulse.evalcases', version: 1, exportedAt: new Date().toISOString(), cases: ((cfg.evalConfig || {}).cases) || [] };
    },
    jsonToList: function (json) { if (json && Array.isArray(json.cases)) return json.cases; if (Array.isArray(json)) return json; return null; },
    normRow: function (o) {
      var lv = String(o.emojiLevel == null ? '' : o.emojiLevel).trim();
      return {
        name: String(o.name == null ? '' : o.name).trim(),
        newsId: String(o.newsId == null ? '' : o.newsId).trim(),
        productIds: Array.isArray(o.productIds) ? o.productIds.slice() : splitList(o.productIds),
        tags: Array.isArray(o.tags) ? o.tags.slice() : splitList(o.tags),
        tone: String(o.tone == null ? '' : o.tone).trim(),
        emojiLevel: lv === '' ? 1 : Math.max(0, Math.min(2, num(lv) || 0)),
        selected: o.selected === false ? false : (o.selected === true ? true : !/^(否|false|0|no)$/i.test(String(o.selected == null ? '' : o.selected).trim()))
      };
    },
    validate: function (it, cfg) {
      var r = [];
      if (!it.name) r.push('名称为空（必填）');
      if (!it.newsId) r.push('热点ID 为空（必填）');
      if (!it.productIds.length) r.push('商品编号为空（必填，至少一件）');
      var known = {};
      ((cfg && cfg.products) || []).forEach(function (p) { known[p.id] = true; });
      var bad = it.productIds.filter(function (id) { return !known[id]; });
      if (bad.length) r.push('商品编号不存在：' + bad.join('、') + '（先去商品库确认编号）');
      if (it.productIds.length > 3) r.push('商品最多 3 件（当前 ' + it.productIds.length + ' 件）');
      var tones = {};
      ((cfg && cfg.tones) || []).forEach(function (t) { tones[t.name] = true; });
      if (it.tone && !tones[it.tone]) r.push('语调「' + it.tone + '」不在语调预设里（可先到创作风格页添加，或留空用默认）');
      return r;
    },
    toItem: function (it, cfg) {
      var tones = ((cfg && cfg.tones) || []);
      return {
        id: rid('case_'), name: it.name, newsId: it.newsId, productIds: it.productIds.slice(0, 3),
        tags: it.tags, tone: it.tone || (tones[0] || {}).name || '',
        emojiLevel: it.emojiLevel, selected: it.selected
      };
    },
    apply: function (items, cfg, opt) {
      cfg.evalConfig = cfg.evalConfig || {};
      var mode = (opt && opt.mode) || 'replace';
      var list = cfg.evalConfig.cases || [];
      var made = items.map(function (it) { return ENTRIES.cases.toItem(it, cfg); });
      if (mode === 'append') { cfg.evalConfig.cases = list.concat(made); return { added: made.length, replaced: 0, skipped: 0 }; }
      cfg.evalConfig.cases = made;
      return { added: 0, replaced: made.length, skipped: 0 };
    }
  };

  /* ================= 入口 6：提示词与模板（JSON） ================= */
  ENTRIES.prompt = {
    key: 'prompt', name: '提示词与模板', file: '提示词', unit: '块', formats: ['json'], jsonOnly: true,
    desc: '整块提示词导出成一个 JSON 文件，方便备份、版本对比和批量改。模板里的 {{占位符}} 请原样保留。',
    skeleton: function () {
      return {
        type: 'hotpulse.prompt', version: 1,
        prompt: {
          role: '',
          rules: [''],
          materialTemplate: '',
          productTemplate: '',
          reworkInstruction: '',
          reviewPrompt: '',
          example: '',
          reworkTemperature: 0.2,
          reviewTemperature: 0.2
        }
      };
    },
    exportJSON: function (cfg) {
      var p = cfg.prompt || {};
      return {
        type: 'hotpulse.prompt', version: 1, exportedAt: new Date().toISOString(),
        prompt: {
          role: p.role || '', rules: (p.rules || []).slice(),
          materialTemplate: p.materialTemplate || '', productTemplate: p.productTemplate || '',
          reworkInstruction: p.reworkInstruction || '', reviewPrompt: p.reviewPrompt || '',
          example: p.example || '',
          reworkTemperature: p.reworkTemperature, reviewTemperature: p.reviewTemperature
        }
      };
    },
    validateObject: function (json, cfg) {
      var errs = [], warns = [];
      var p = (json && json.prompt) || json;
      if (!p || typeof p !== 'object') { errs.push('文件里没有 prompt 对象'); return { errors: errs, warnings: warns }; }
      var strKeys = ['role', 'materialTemplate', 'productTemplate', 'reworkInstruction', 'reviewPrompt', 'example'];
      strKeys.forEach(function (k) {
        if (p[k] !== undefined && typeof p[k] !== 'string') errs.push('prompt.' + k + ' 必须是字符串');
      });
      if (p.rules !== undefined && !Array.isArray(p.rules)) errs.push('prompt.rules 必须是字符串数组');
      ['reworkTemperature', 'reviewTemperature'].forEach(function (k) {
        if (p[k] !== undefined && !(num(p[k]) >= 0 && num(p[k]) <= 2)) errs.push('prompt.' + k + ' 必须是 0–2 的数字');
      });
      if (typeof p.materialTemplate === 'string' && p.materialTemplate && p.materialTemplate.indexOf('{{商品清单}}') < 0)
        warns.push('素材模板里没有 {{商品清单}}，商品可能不会出现在素材里');
      if (Array.isArray(p.rules) && !p.rules.length) warns.push('写作规范是空的，模型将没有任何约束');
      return { errors: errs, warnings: warns };
    },
    applyObject: function (json, cfg) {
      var p = (json && json.prompt) || json;
      cfg.prompt = cfg.prompt || {};
      var n = 0;
      ['role', 'materialTemplate', 'productTemplate', 'reworkInstruction', 'reviewPrompt', 'example'].forEach(function (k) {
        if (typeof p[k] === 'string') { cfg.prompt[k] = p[k]; n++; }
      });
      if (Array.isArray(p.rules)) { cfg.prompt.rules = p.rules.map(String); n++; }
      ['reworkTemperature', 'reviewTemperature'].forEach(function (k) {
        if (p[k] !== undefined && num(p[k]) >= 0 && num(p[k]) <= 2) { cfg.prompt[k] = num(p[k]); n++; }
      });
      return { added: 0, replaced: n, skipped: 0 };
    }
  };

  /* ================= 入口 7：模型与接入（JSON） ================= */
  ENTRIES.model = {
    key: 'model', name: '模型与接入', file: '模型配置', unit: '项', formats: ['json'], jsonOnly: true,
    desc: '模型设置导出成 JSON（不含密钥，密钥不会写进文件）。导入时只覆盖文件里出现的字段。',
    skeleton: function () {
      return {
        type: 'hotpulse.model', version: 1,
        model: { mode: 'relay', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', temperature: 0.85, stream: false },
        note: '密钥不放在这个文件里：浏览器直连只存在本机浏览器；正式使用请在服务端配置环境变量。'
      };
    },
    exportJSON: function (cfg) {
      var m = cfg.model || {};
      return {
        type: 'hotpulse.model', version: 1, exportedAt: new Date().toISOString(),
        model: { mode: m.mode, provider: m.provider, baseUrl: m.baseUrl, model: m.model, temperature: m.temperature, stream: !!m.stream },
        note: '密钥未导出（浏览器直连只存在本机浏览器；正式使用请走服务端中转）'
      };
    },
    validateObject: function (json) {
      var errs = [], warns = [];
      var m = (json && json.model) || json;
      if (!m || typeof m !== 'object') { errs.push('文件里没有 model 对象'); return { errors: errs, warnings: warns }; }
      if (m.mode !== undefined && ['mock', 'relay', 'direct'].indexOf(m.mode) < 0)
        errs.push('mode 只能是 mock（本地模拟）/ relay（本地服务中转）/ direct（浏览器直连）');
      if (m.baseUrl !== undefined && m.mode !== 'mock' && m.baseUrl !== '' && !isUrl(m.baseUrl))
        errs.push('baseUrl 不是合法地址：' + m.baseUrl);
      if (m.temperature !== undefined && !(num(m.temperature) >= 0 && num(m.temperature) <= 2)) errs.push('temperature 必须是 0–2 的数字');
      if (m.model !== undefined && m.mode !== 'mock' && !String(m.model).trim()) errs.push('model（模型名）不能为空');
      if (json && json.apiKey) warns.push('文件里带了 apiKey，出于安全考虑不会被导入');
      return { errors: errs, warnings: warns };
    },
    applyObject: function (json, cfg) {
      var m = (json && json.model) || json;
      cfg.model = cfg.model || {};
      var n = 0;
      ['mode', 'provider', 'baseUrl', 'model'].forEach(function (k) {
        if (typeof m[k] === 'string') { cfg.model[k] = m[k]; n++; }
      });
      if (m.temperature !== undefined && num(m.temperature) >= 0 && num(m.temperature) <= 2) { cfg.model.temperature = num(m.temperature); n++; }
      if (m.stream !== undefined) { cfg.model.stream = !!m.stream; n++; }
      return { added: 0, replaced: n, skipped: 0 };
    }
  };

  /* ================= 引擎 ================= */
  function getEntry(key) {
    var e = ENTRIES[key];
    if (!e) throw new Error('未知的数据入口：' + key);
    return e;
  }
  function headersOf(e) { return (e.fields || []).map(function (f) { return f.label; }); }

  function rowToObj(e, row) {
    var o = {};
    (e.fields || []).forEach(function (f, i) { o[f.key] = row[i] == null ? '' : row[i]; });
    return o;
  }

  function detectFormat(text, filename) {
    var n = String(filename || '').toLowerCase();
    if (/\.json$/.test(n)) return 'json';
    if (/\.(csv|tsv|txt)$/.test(n)) return 'csv';
    var t = String(text || '').trim();
    return (t.charAt(0) === '{' || t.charAt(0) === '[') ? 'json' : 'csv';
  }

  /* 空白模板：只有表头 / 只有骨架，不含任何业务数据 */
  function blank(key, fmt) {
    var e = getEntry(key);
    if (fmt === 'json') {
      if (e.skeleton) return JSON.stringify(e.skeleton(), null, 2);
      var o = { type: 'hotpulse.' + key, version: 1 };
      o[e.listKey] = [];
      return JSON.stringify(o, null, 2);
    }
    return rowsToCSV(headersOf(e), []);
  }

  /* 示例模板：表头 + 一两行示范，示范行是通用写法，不是业务数据 */
  function sample(key, fmt) {
    var e = getEntry(key);
    if (fmt === 'json') {
      if (e.skeleton) return JSON.stringify(e.skeleton(), null, 2);
      var o = { type: 'hotpulse.' + key, version: 1 };
      o[e.listKey] = (e.sampleRows || []).map(function (r) { return rowToObj(e, r); });
      return JSON.stringify(o, null, 2);
    }
    return rowsToCSV(headersOf(e), e.sampleRows || []);
  }

  /* 导出当前配置里的这一块 */
  function exportCurrent(key, cfg, fmt) {
    var e = getEntry(key);
    if (fmt === 'json' || e.jsonOnly) return JSON.stringify(e.exportJSON(cfg), null, 2);
    return rowsToCSV(headersOf(e), e.exportRows(cfg));
  }

  function fileName(key, kind, fmt) {
    var e = getEntry(key);
    var tag = kind === 'blank' ? '空白模板' : kind === 'sample' ? '示例模板' : '导出';
    return 'HotPulse-' + e.file + '-' + tag + '-' + stamp() + '.' + (fmt === 'json' ? 'json' : 'csv');
  }

  /**
   * 解析并校验一个文件。返回：
   *  { ok, fmt, items, errors:[{row,reasons}], warnings, fatal, objectMode }
   *  · 不写入任何地方，只是先出报告（导入前校验，人决定要不要继续）
   */
  function preview(key, text, filename, cfg) {
    var e = getEntry(key);
    var fmt = detectFormat(text, filename);
    var items = [], errors = [], warnings = [], fatal = null, objectMode = false;

    if (fmt === 'json') {
      var json;
      try { json = JSON.parse(String(text || '')); }
      catch (err) { return { ok: false, fmt: fmt, fatal: '不是合法的 JSON 文件：' + err.message }; }
      if (e.jsonOnly) {
        var v = e.validateObject(json, cfg);
        objectMode = true;
        items = [json];
        errors = (v.errors || []).map(function (x) { return { row: 0, reasons: [x] }; });
        warnings = v.warnings || [];
        return { ok: !errors.length, fmt: fmt, items: items, errors: errors, warnings: warnings, fatal: null, objectMode: true };
      }
      var list = e.jsonToList(json);
      if (!list) {
        return { ok: false, fmt: fmt, fatal: 'JSON 里没有找到 ' + (e.listKey || 'items') + ' 数组，可能选错了文件（这份模板要求 ' + (e.listKey || 'items') + ' 字段）' };
      }
      items = list.map(function (o, i) { return e.normRow(o, i); });
    } else {
      var rows = parseCSV(text);
      if (!rows.length) return { ok: false, fmt: fmt, fatal: '文件是空的，或者不是逗号分隔的表格文件' };
      var header = rows[0].map(function (h) { return String(h).trim(); });
      var need = (e.fields || []).filter(function (f) { return f.required; }).map(function (f) { return f.label; });
      var missing = need.filter(function (h) { return header.indexOf(h) < 0; });
      if (missing.length) {
        return {
          ok: false, fmt: fmt,
          fatal: '表头不符合要求，缺少必需列：' + missing.join('、') + '\n当前表头：' + (header.join('、') || '（空）') +
            '\n要求的表头：' + headersOf(e).join('、') + '\n（建议先点「下载空白模板」，照表头填）'
        };
      }
      var idx = {};
      header.forEach(function (h, i) { idx[h] = i; });
      items = rows.slice(1).map(function (r) {
        var o = {};
        (e.fields || []).forEach(function (f) { o[f.key] = idx[f.label] === undefined ? '' : r[idx[f.label]]; });
        return e.normRow(o, 0);
      });
      if (!items.length) return { ok: false, fmt: fmt, fatal: '表格里只有表头，没有数据行' };
    }

    items.forEach(function (it, i) {
      var reasons = (e.validate ? e.validate(it, cfg) : []) || [];
      if (reasons.length) errors.push({ row: i + 1, reasons: reasons });
    });
    /* 额外提醒（不影响导入） */
    if (key === 'products') {
      items.forEach(function (it, i) {
        var n = (it.points || []).length;
        if (n && (n < 2 || n > 4)) warnings.push({ row: i + 1, msg: '卖点建议 2–4 个（当前 ' + n + ' 个）' });
      });
    }
    if (key === 'cases') {
      items.forEach(function (it, i) {
        if (!it.tone) warnings.push({ row: i + 1, msg: '没填语调，导入后用第一个语调预设' });
      });
    }
    return { ok: !errors.length, fmt: fmt, items: items, errors: errors, warnings: warnings, fatal: null, objectMode: objectMode };
  }

  /* 把校验通过的条目写进草稿（只改内存里的草稿，保存仍然走统一的「保存配置」） */
  function apply(key, items, cfg, opt) {
    var e = getEntry(key);
    if (!items || !items.length) throw new Error('没有可导入的条目');
    if (e.applyObject && (opt && opt.objectMode)) return e.applyObject(items[0], cfg);
    return e.apply(items, cfg, opt || {});
  }

  var API = {
    ENTRIES: ENTRIES,
    list: function () {
      return Object.keys(ENTRIES).map(function (k) {
        return { key: k, name: ENTRIES[k].name, desc: ENTRIES[k].desc, formats: ENTRIES[k].formats, fields: ENTRIES[k].fields };
      });
    },
    get: getEntry,
    headers: headersOf,
    blank: blank,
    sample: sample,
    exportCurrent: exportCurrent,
    fileName: fileName,
    preview: preview,
    apply: apply,
    parseCSV: parseCSV,
    rowsToCSV: rowsToCSV,
    detectFormat: detectFormat
  };

  HP.Templates = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
