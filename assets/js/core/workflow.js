/* =========================================================
   HP.Workflow —— 运营效率内核（纯逻辑，工作台与后台共用，可单测）
   · fingerprint / dedupe  热点去重（同一条新闻被多个来源抓到只留一条）
   · trendOf               热度趋势（升 / 平 / 落 + 迷你走势）
   · Pool                  选题池：状态流转、按月排期、撞车检查
   · Queue                 待审队列：上下条、状态流转、统计
   · planBatch             批量任务计划（热点 × 风格，商品轮转）
   ========================================================= */
var HP_ROOT = (typeof window !== 'undefined') ? window : (typeof global !== 'undefined' ? global : this);
HP_ROOT.HP = HP_ROOT.HP || {};

(function () {
  'use strict';

  /* ---------------- 去重 ---------------- */
  /* 标题归一：去掉括号、标点、空白、大小写差异，留下"内容骨架" */
  function normTitle(t) {
    return String(t == null ? '' : t)
      .replace(/[【】\[\]（）()「」『』《》〈〉]/g, '')
      .replace(/[\s\u3000]+/g, '')
      .replace(/[，,。.！!？?：:；;、~～|丨\-—_…·•"'“”‘’]/g, '')
      .toLowerCase();
  }
  function fingerprint(title) {
    var s = normTitle(title);
    return s.slice(0, 60);
  }
  /* 合并同指纹条目：保留最早 firstSeen、最新 lastSeen，seenCount 累加，history 合并 */
  function dedupe(list, opts) {
    var o = opts || {};
    var byKey = {}, out = [], dup = 0;
    (list || []).forEach(function (it) {
      var key = fingerprint(it.title || it.name || '');
      if (!key) { out.push(it); return; }
      var hit = byKey[key];
      if (!hit) { byKey[key] = it; out.push(it); return; }
      dup++;
      hit.seenCount = (Number(hit.seenCount) || 1) + (Number(it.seenCount) || 1);
      if (it.firstSeen && (!hit.firstSeen || it.firstSeen < hit.firstSeen)) hit.firstSeen = it.firstSeen;
      if (it.lastSeen && (!hit.lastSeen || it.lastSeen > hit.lastSeen)) hit.lastSeen = it.lastSeen;
      if (it.heat && (!hit.heat || it.heat > hit.heat)) hit.heat = it.heat;
      if (Array.isArray(it.history) && it.history.length) hit.history = (hit.history || []).concat(it.history);
      if (o.keepSources !== false) {
        /* 保留项自己也要有 sources：否则合并后只剩后来者的来源 */
        hit.sources = (hit.sources || (hit.source ? [hit.source] : [])).slice();
        var add = it.sources || (it.source ? [it.source] : []);
        add.forEach(function (s) { if (hit.sources.indexOf(s) < 0) hit.sources.push(s); });
      }
    });
    return { items: out, duplicates: dup, input: (list || []).length, unique: out.length };
  }

  /* ---------------- 趋势 ---------------- */
  function trendOf(history) {
    var h = (history || []).filter(function (x) { return x && isFinite(x.heat); });
    if (h.length < 2) return { label: 'new', delta: 0, pct: 0, spark: h.map(function (x) { return x.heat; }) };
    var first = Number(h[0].heat), last = Number(h[h.length - 1].heat);
    var delta = last - first;
    var pct = first ? Math.round((delta / first) * 1000) / 10 : 0;
    var label = pct >= 8 ? 'up' : pct <= -8 ? 'down' : 'flat';
    return { label: label, delta: delta, pct: pct, spark: h.slice(-8).map(function (x) { return Number(x.heat); }) };
  }
  function trendText(tr) {
    if (!tr || tr.label === 'new') return '新上榜';
    if (tr.label === 'up') return '↑ ' + tr.pct + '%';
    if (tr.label === 'down') return '↓ ' + Math.abs(tr.pct) + '%';
    return '→ 持平';
  }
  function sparkBars(spark, max) {
    var arr = (spark || []).slice(-8);
    if (!arr.length) return [];
    var hi = max || Math.max.apply(null, arr) || 1;
    return arr.map(function (v) { return Math.max(6, Math.round((v / hi) * 100)); });
  }

  /* ---------------- 选题池 ---------------- */
  var POOL_STATUS = ['待办', '进行中', '已发', '搁置'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(d) {
    var x = d instanceof Date ? d : new Date(d);
    if (isNaN(x.getTime())) return '';
    return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
  }
  function daysBetween(a, b) {
    var t1 = new Date(a).getTime(), t2 = new Date(b).getTime();
    if (isNaN(t1) || isNaN(t2)) return Infinity;
    return Math.round(Math.abs(t2 - t1) / 86400000);
  }
  function newPoolItem(news, extra) {
    var now = new Date().toISOString();
    return Object.assign({
      id: 'po_' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36),
      newsId: news && news.id || '',
      title: news && news.title || '',
      cat: news && news.cat || '',
      source: news && news.source || '',
      heat: news && news.heat || 0,
      status: '待办',
      planDate: dayKey(new Date()),
      note: '',
      productId: '',
      createdAt: now,
      updatedAt: now
    }, extra || {});
  }
  function upsert(pool, item) {
    var list = (pool || []).slice();
    var i = list.findIndex(function (x) { return x.id === item.id; });
    item.updatedAt = new Date().toISOString();
    if (i >= 0) list[i] = Object.assign({}, list[i], item);
    else list.unshift(item);
    return list;
  }
  function remove(pool, id) {
    return (pool || []).filter(function (x) { return x.id !== id; });
  }
  function setStatus(pool, id, status, when) {
    if (POOL_STATUS.indexOf(status) < 0) return pool;
    return (pool || []).map(function (x) {
      if (x.id !== id) return x;
      var next = Object.assign({}, x, { status: status, updatedAt: new Date().toISOString() });
      if (status === '已发') next.publishedAt = when || new Date().toISOString();
      return next;
    });
  }
  function filterPool(pool, f) {
    var q = f || {};
    var list = (pool || []).slice();
    if (q.status && q.status !== '全部') list = list.filter(function (x) { return x.status === q.status; });
    if (q.keyword) {
      var k = String(q.keyword).toLowerCase();
      list = list.filter(function (x) { return (x.title + x.cat + x.note).toLowerCase().indexOf(k) > -1; });
    }
    if (q.from) list = list.filter(function (x) { return (x.planDate || '') >= q.from; });
    if (q.to) list = list.filter(function (x) { return (x.planDate || '') <= q.to; });
    list.sort(function (a, b) {
      var d = String(a.planDate || '').localeCompare(String(b.planDate || ''));
      if (d !== 0) return d;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    return list;
  }
  /* 月历：6 行 × 7 列，周一开头 */
  function calendar(pool, year, month) {
    var first = new Date(year, month - 1, 1);
    var startPad = (first.getDay() + 6) % 7;
    var byDay = {};
    (pool || []).forEach(function (x) {
      if (!x.planDate) return;
      (byDay[x.planDate] = byDay[x.planDate] || []).push(x);
    });
    var cells = [];
    var start = new Date(year, month - 1, 1 - startPad);
    for (var i = 0; i < 42; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var key = dayKey(d);
      cells.push({ date: key, day: d.getDate(), inMonth: d.getMonth() === month - 1, items: byDay[key] || [] });
    }
    var weeks = [];
    for (var w = 0; w < 6; w++) weeks.push(cells.slice(w * 7, w * 7 + 7));
    return { year: year, month: month, label: year + ' 年 ' + month + ' 月', weeks: weeks };
  }
  /* 撞车检查：同一条热点、或同一件商品，在 N 天内已经排过 / 发过 */
  function conflicts(pool, opts) {
    var o = opts || {};
    var now = o.now ? new Date(o.now) : new Date();
    var within = o.withinDays == null ? 7 : o.withinDays;
    return (pool || []).filter(function (x) {
      if (x.status === '搁置') return false;
      var sameNews = o.newsId && x.newsId === o.newsId;
      var sameProduct = o.productId && x.productId && x.productId === o.productId;
      if (!sameNews && !sameProduct) return false;
      var ref = x.publishedAt || x.planDate || x.createdAt;
      return daysBetween(ref, now) <= within;
    });
  }

  /* ---------------- 待审队列 ---------------- */
  var QUEUE_STATUS = ['待审', '已通过', '已发布', '已打回'];
  function enqueue(queue, items) {
    var list = (queue || []).slice();
    (items || []).forEach(function (it) {
      if (!it || !it.id) return;
      if (list.some(function (x) { return x.id === it.id; })) return;
      list.push(Object.assign({ status: '待审', createdAt: new Date().toISOString() }, it));
    });
    return list;
  }
  function queueStats(queue) {
    var s = { total: (queue || []).length, wait: 0, pass: 0, published: 0, rejected: 0 };
    (queue || []).forEach(function (x) {
      if (x.status === '已通过') s.pass++;
      else if (x.status === '已发布') s.published++;
      else if (x.status === '已打回') s.rejected++;
      else s.wait++;
    });
    return s;
  }
  function next(queue, currentId, dir) {
    var list = (queue || []).filter(function (x) { return x.status === '待审'; });
    if (!list.length) return null;
    var i = list.findIndex(function (x) { return x.id === currentId; });
    if (i < 0) return list[0];
    var n = i + (dir < 0 ? -1 : 1);
    if (n < 0) n = list.length - 1;
    if (n >= list.length) n = 0;
    return list[n];
  }
  function setQueueStatus(queue, id, status, extra) {
    if (QUEUE_STATUS.indexOf(status) < 0) return queue;
    return (queue || []).map(function (x) {
      if (x.id !== id) return x;
      var n2 = Object.assign({}, x, extra || {}, { status: status });
      if (status === '已通过' || status === '已打回') n2.reviewedAt = new Date().toISOString();
      if (status === '已发布') n2.publishedAt = new Date().toISOString();
      return n2;
    });
  }

  /* ---------------- 批量计划 ---------------- */
  function planBatch(opts) {
    var o = opts || {};
    var newsIds = o.newsIds || [], styleIds = o.styleIds || [], productIds = o.productIds || [];
    var tasks = [];
    newsIds.forEach(function (nid, ni) {
      styleIds.forEach(function (sid, si) {
        tasks.push({
          newsId: nid,
          styleId: sid,
          productId: productIds.length ? productIds[(ni + si) % productIds.length] : ''
        });
      });
    });
    return tasks;
  }
  function estimateMs(count, concurrency, perTaskMs) {
    var c = Math.max(1, Number(concurrency) || 1);
    return Math.ceil((Number(count) || 0) / c) * (Number(perTaskMs) || 1500);
  }

  var API = {
    normTitle: normTitle, fingerprint: fingerprint, dedupe: dedupe,
    trendOf: trendOf, trendText: trendText, sparkBars: sparkBars,
    POOL_STATUS: POOL_STATUS, dayKey: dayKey, daysBetween: daysBetween,
    newPoolItem: newPoolItem, upsert: upsert, remove: remove, setStatus: setStatus,
    filterPool: filterPool, calendar: calendar, conflicts: conflicts,
    QUEUE_STATUS: QUEUE_STATUS, enqueue: enqueue, queueStats: queueStats,
    next: next, setQueueStatus: setQueueStatus,
    planBatch: planBatch, estimateMs: estimateMs
  };

  /* 浏览器：挂到 HP.Workflow；Node：可以直接 require（服务端与测试共用同一份逻辑） */
  HP_ROOT.HP.Workflow = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
