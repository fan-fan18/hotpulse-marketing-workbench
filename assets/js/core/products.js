/* =========================================================
   HP.Products —— 商品库工具（工作台与后台共用）
   · cardHtml：商品卡的唯一渲染入口（后台卡片视图与工作台完全同源）
   · stats / filter：统计与搜索、筛选、排序
   ========================================================= */
window.HP = window.HP || {};

(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtNum(n) {
    n = Number(n) || 0;
    return n >= 10000 ? (n / 10000).toFixed(1) + ' 万' : String(n);
  }
  function gradientOf(p) {
    var g = (window.HP.Config && HP.Config.GRADIENTS) || {};
    return g[(p && p.gradient) || 'indigo'] || g.indigo || 'linear-gradient(135deg,#eef0ff,#f7f4ff)';
  }
  function discountOf(p) {
    var price = Number(p.price), market = Number(p.marketPrice);
    if (!price || !market || market < price) return 0;
    return Math.round((1 - price / market) * 1000) / 10;   // 折扣率（%）
  }
  function offText(p) {
    var d = discountOf(p);
    return d > 0 ? d + '% OFF' : '—';
  }

  /**
   * 商品卡：工作台与后台卡片视图共用这一段渲染，保证长得一模一样。
   * opt: { score, reason, actions, picked, stats }
   *   score   匹配度（工作台 Step 2 用）
   *   reason  推荐理由 HTML（工作台 Step 2 用）
   *   actions 底部按钮 HTML（工作台用；商品库只读时传空）
   */
  function cardHtml(p, opt) {
    opt = opt || {};
    var points = (p.points || []).map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('');
    return '<article class="product-card' + (opt.picked ? ' picked' : '') + '" data-pid="' + esc(p.id) + '">' +
      '<div class="thumb" style="background:' + gradientOf(p) + '">' +
        '<span>' + esc(p.emoji || '🛍️') + '</span>' +
        '<span class="sku">' + esc(p.sku || p.id) + '</span>' +
        '<span class="cat-tag">' + esc(p.cat || '未分类') + '</span>' +
        (opt.score != null ? '<span class="score">匹配度 ' + opt.score + '%</span>' : '') +
      '</div>' +
      '<div class="product-body">' +
        '<h4 class="product-name">' + esc(p.name) + '</h4>' +
        '<div class="price-row">' +
          '<span class="price"><small>¥</small>' + p.price + '</span>' +
          '<span class="price-old">¥' + p.marketPrice + '</span>' +
          '<span class="tag ok">' + offText(p) + '</span>' +
        '</div>' +
        (opt.reason ? '<div class="reason">' + opt.reason + '</div>' : '') +
        '<div class="selling">' + points + '</div>' +
        (opt.stats === false ? '' :
          '<div class="product-stats">' +
            '<span>近30天 <b>' + fmtNum(p.sales30d) + '</b> 件</span>' +
            '<span>转化率 <b>' + (p.conversion || 0) + '%</b></span>' +
            '<span>库存 <b>' + (p.stock || 0) + '</b></span>' +
          '</div>') +
        (opt.actions ? '<div class="product-actions">' + opt.actions + '</div>' : '') +
      '</div></article>';
  }

  /* ---------------- 统计 ---------------- */
  function stats(list) {
    list = list || [];
    var cats = {}, sumDisc = 0, discCount = 0, sumPrice = 0;
    var minPrice = Infinity, maxPrice = 0;
    list.forEach(function (p) {
      cats[p.cat || '未分类'] = true;
      var price = Number(p.price) || 0;
      if (price > 0) minPrice = Math.min(minPrice, price);
      maxPrice = Math.max(maxPrice, price);
      sumPrice += price;
      var d = discountOf(p);
      if (d > 0) { sumDisc += d; discCount++; }
    });
    return {
      total: list.length,
      cats: Object.keys(cats).length,
      minPrice: list.length && minPrice !== Infinity ? minPrice : 0,
      maxPrice: maxPrice,
      avgPrice: list.length ? Math.round(sumPrice / list.length) : 0,
      avgDiscount: discCount ? Math.round(sumDisc / discCount * 10) / 10 : 0
    };
  }

  /* ---------------- 搜索 / 筛选 / 排序 ---------------- */
  var SORTS = [
    { id: 'default', name: '默认（录入顺序）' },
    { id: 'priceAsc', name: '价格从低到高' },
    { id: 'priceDesc', name: '价格从高到低' },
    { id: 'cat', name: '按品类' },
    { id: 'discount', name: '折扣力度从大到小' }
  ];

  function filter(list, opt) {
    opt = opt || {};
    var out = (list || []).slice();
    if (opt.cat && opt.cat !== '全部') {
      out = out.filter(function (p) { return p.cat === opt.cat; });
    }
    if (opt.keyword) {
      var k = String(opt.keyword).toLowerCase().trim();
      out = out.filter(function (p) {
        var hay = [p.name, (p.points || []).join(' '), p.brand, p.sku, p.cat].join(' ').toLowerCase();
        return hay.indexOf(k) > -1;
      });
    }
    if (opt.sort === 'priceAsc') out.sort(function (a, b) { return a.price - b.price; });
    else if (opt.sort === 'priceDesc') out.sort(function (a, b) { return b.price - a.price; });
    else if (opt.sort === 'cat') out.sort(function (a, b) { return String(a.cat).localeCompare(String(b.cat), 'zh'); });
    else if (opt.sort === 'discount') out.sort(function (a, b) { return discountOf(b) - discountOf(a); });
    return out;
  }

  function catList(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (p) {
      var c = p.cat || '未分类';
      if (!seen[c]) { seen[c] = true; out.push(c); }
    });
    return out;
  }

  /* 自动编号：取现有最大序号 +1，并保证与现有编号不重复 */
  function nextId(list) {
    var used = {}, max = 0;
    (list || []).forEach(function (p) {
      var id = String((p && p.id) || '');
      if (id) used[id] = true;
      var m = id.match(/(\d+)/);
      if (m) max = Math.max(max, Number(m[1]));
    });
    var n = max + 1;
    var id = 'p' + n;
    while (used[id]) { n++; id = 'p' + n; }
    return id;
  }

  /* ---------------- 热点-商品语义匹配（工作台与"引用检查"共用同一套口径） ---------------- */
  function hash(s) { var h = 0, t = String(s || ''); for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 100003; return h; }

  function matchScore(p, news) {
    if (!p || !news) return 0;
    var kw = (news.keywords || []).concat([news.cat]);
    var text = (p.name + (p.brand || '') + (p.cat || '') + (p.points || []).join('') + (p.emoji || '')).toLowerCase();
    var overlap = 0;
    kw.forEach(function (k) { if (k && text.indexOf(String(k).slice(0, 2).toLowerCase()) > -1) overlap++; });
    return Math.min(94, 58 + overlap * 11 + Math.round(((p.rating || 4.8) - 4.5) * 12) + (hash(p.id + news.id) % 7));
  }

  function matchReason(p, news) {
    return '系统按「' + (news.keywords && news.keywords[0] ? esc(news.keywords[0]) : esc(news.cat || '热点')) +
      '」等关键词与品类语义匹配到的' + esc((p && p.cat) || '商品') + '，近 30 天转化率 ' +
      ((p && p.conversion) || 0) + '%，可作为热点延展的备选。';
  }

  /**
   * 引用检查：这件商品被哪些热点"推荐关系"引用。
   * preset   —— 预设的热点-商品关系（data.js 里的 MATCH_MAP），删除后这些推荐会失效
   * semantic —— 仅靠语义匹配会被带出来的热点（动态计算，不代表固定关系）
   */
  function refsOf(productId, products) {
    var map = (window.MOCK && window.MOCK.MATCH_MAP) || {};
    var news = (window.MOCK && window.MOCK.NEWS) || [];
    var product = (products || []).filter(function (p) { return p.id === productId; })[0];
    var preset = [];
    Object.keys(map).forEach(function (nid) {
      var hit = (map[nid] || []).filter(function (m) { return m.pid === productId; });
      if (hit.length) {
        var n = news.filter(function (x) { return x.id === nid; })[0];
        preset.push({ newsId: nid, title: n ? n.title : nid, score: hit[0].score });
      }
    });
    var semantic = [];
    if (product) {
      news.forEach(function (n) {
        if (preset.some(function (x) { return x.newsId === n.id; })) return;
        var s = matchScore(product, n);
        if (s >= 62) semantic.push({ newsId: n.id, title: n.title, score: s });
      });
    }
    return { preset: preset, semantic: semantic, total: preset.length };
  }

  /* =========================================================
     导入 / 导出
     · 结构化数据文件（JSON）：完整保真，适合备份与迁移
     · 表格文件（CSV）：中文表头，适合用表格软件批量编辑
     ========================================================= */
  var CSV_HEADERS = ['名称', '售价', '原价', '品类', '卖点', '图标'];

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(list) {
    var lines = [CSV_HEADERS.join(',')];
    (list || []).forEach(function (p) {
      lines.push([
        csvCell(p.name), csvCell(p.price), csvCell(p.marketPrice),
        csvCell(p.cat), csvCell((p.points || []).join('、')), csvCell(p.emoji || '🛍️')
      ].join(','));
    });
    return '\ufeff' + lines.join('\r\n');   // 带 BOM，Excel / WPS 打开不乱码
  }

  /* 状态机解析：支持引号包裹、字段内逗号、转义引号（""）、CRLF */
  function parseCSV(text) {
    var t = String(text || '').replace(/^\ufeff/, '');
    var rows = [], row = [], cell = '', inQuotes = false, i = 0;
    while (i < t.length) {
      var ch = t[i];
      if (inQuotes) {
        if (ch === '"') {
          if (t[i + 1] === '"') { cell += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        cell += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
      cell += ch; i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  }

  /* 逐行校验：返回 { ok, items, errors, rowErrors, warnings } */
  function validateRows(rows, existing) {
    var items = [], errors = [], rowErrors = [], warnings = [];
    var used = {};
    (existing || []).forEach(function (p) { used[p.id] = true; });

    rows.forEach(function (raw, idx) {
      var rowNo = idx + 1;                       // 数据行号（不含表头）
      var p = raw || {};
      var name = String(p.name == null ? '' : p.name).trim();
      var cat = String(p.cat == null ? '' : p.cat).trim();
      var price = Number(p.price), market = Number(p.marketPrice);
      var points = Array.isArray(p.points) ? p.points.slice()
        : String(p.points == null ? '' : p.points).split(/[、,;；]/).map(function (s) { return s.trim(); }).filter(Boolean);
      var reasons = [];

      if (!name) reasons.push('名称为空（必填）');
      if (!(price > 0)) reasons.push('售价必须是大于 0 的数字（当前：' + (p.price === '' || p.price == null ? '空' : p.price) + '）');
      if (!(market > 0)) reasons.push('原价必须是大于 0 的数字（当前：' + (p.marketPrice === '' || p.marketPrice == null ? '空' : p.marketPrice) + '）');
      if (price > 0 && market > 0 && market < price) reasons.push('原价（' + market + '）不能低于售价（' + price + '）');
      if (!cat) reasons.push('品类为空（必填）');
      if (!points.length) reasons.push('卖点为空（至少 1 个，建议 2–4 个）');

      if (reasons.length) {
        rowErrors.push({ row: rowNo, reasons: reasons, raw: p, name: name || '（未命名）' });
        errors.push('第 ' + rowNo + ' 行：' + reasons.join('；'));
        return;
      }
      if (points.length < 2 || points.length > 4) warnings.push('第 ' + rowNo + ' 行：卖点 ' + points.length + ' 个，建议 2–4 个');

      items.push({
        id: String(p.id || '').trim(),
        name: name,
        brand: String(p.brand == null ? '' : p.brand).trim(),
        cat: cat,
        price: price,
        marketPrice: market,
        stock: Number(p.stock) > 0 ? Number(p.stock) : 800,
        rating: Number(p.rating) > 0 ? Number(p.rating) : 4.8,
        sales30d: Number(p.sales30d) > 0 ? Number(p.sales30d) : 1500,
        conversion: Number(p.conversion) > 0 ? Number(p.conversion) : 4.5,
        emoji: String(p.emoji == null ? '🛍️' : p.emoji).trim() || '🛍️',
        sku: String(p.sku || '').trim(),
        gradient: p.gradient || 'indigo',
        points: points
      });
    });
    return { ok: errors.length === 0, items: items, errors: errors, rowErrors: rowErrors, warnings: warnings };
  }

  /* 从 CSV 文本导入：先校验，再把问题行一次性列出来 */
  function importCSV(text, existing) {
    var rows = parseCSV(text);
    if (!rows.length) return { ok: false, fatal: '文件是空的，或者不是逗号分隔的表格文件' };
    var header = rows[0].map(function (h) { return String(h).trim(); });
    var missing = CSV_HEADERS.filter(function (h) { return header.indexOf(h) < 0; });
    if (missing.length) {
      return {
        ok: false,
        fatal: '表头不符合要求，缺少列：' + missing.join('、') +
          '\n当前表头：' + (header.join('、') || '（空）') +
          '\n要求的表头：' + CSV_HEADERS.join('、')
      };
    }
    var idx = {};
    CSV_HEADERS.forEach(function (h) { idx[h] = header.indexOf(h); });
    var rowsData = rows.slice(1).map(function (r) {
      return {
        name: r[idx['名称']], price: r[idx['售价']], marketPrice: r[idx['原价']],
        cat: r[idx['品类']], points: r[idx['卖点']], emoji: r[idx['图标']]
      };
    });
    if (!rowsData.length) return { ok: false, fatal: '表格里只有表头，没有数据行' };
    var v = validateRows(rowsData, existing);
    v.totalRows = rowsData.length;
    return v;
  }

  function toJSON(list) {
    return JSON.stringify({ type: 'hotpulse.products', version: 1, exportedAt: new Date().toISOString(), products: list }, null, 2);
  }

  function importJSON(text, existing) {
    var parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { return { ok: false, fatal: '不是合法的 JSON 文件：' + e.message }; }
    var list = Array.isArray(parsed) ? parsed : (parsed && parsed.products);
    if (!Array.isArray(list)) return { ok: false, fatal: '文件里没有找到商品数组（应为 { products: [...] } 或直接是数组）' };
    if (!list.length) return { ok: false, fatal: '文件里的商品数组是空的' };
    var v = validateRows(list, existing);
    v.totalRows = list.length;
    v.isStructured = true;
    return v;
  }

  /* 把导入结果落成商品对象：优先复用同名的原编号，其余按顺序分配新编号 */
  function assignIds(items, existing, mode) {
    var pool = mode === 'replace' ? [] : (existing || []).slice();
    var byName = {};
    (existing || []).forEach(function (p) { byName[p.name] = p.id; });
    return (items || []).map(function (it) {
      var item = JSON.parse(JSON.stringify(it));
      var reused = item.id && pool.some(function (p) { return p.id === item.id; }) ? item.id
        : (byName[item.name] || '');
      if (mode === 'replace' && byName[item.name]) reused = byName[item.name];
      item.id = reused || nextId(pool);
      pool.push(item);
      return item;
    });
  }

  window.HP.Products = {
    SORTS: SORTS,
    cardHtml: cardHtml,
    gradientOf: gradientOf,
    discountOf: discountOf,
    offText: offText,
    stats: stats,
    filter: filter,
    catList: catList,
    nextId: nextId,
    matchScore: matchScore,
    matchReason: matchReason,
    refsOf: refsOf,
    CSV_HEADERS: CSV_HEADERS,
    toCSV: toCSV,
    parseCSV: parseCSV,
    validateRows: validateRows,
    importCSV: importCSV,
    toJSON: toJSON,
    importJSON: importJSON,
    assignIds: assignIds,
    esc: esc,
    fmtNum: fmtNum
  };
})();
