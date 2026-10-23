/* =========================================================
   HP.Workspace —— 工作区状态（选题池 + 待审队列 + 生产指标）
   · 存在本机浏览器（localStorage），刷新不丢；服务端持久化留给"发布记录"那一版
   · 所有变更都走这里，视图订阅 onChange 后重绘
   ========================================================= */
var HP_ROOT = (typeof window !== 'undefined') ? window : (typeof global !== 'undefined' ? global : this);
HP_ROOT.HP = HP_ROOT.HP || {};

(function () {
  'use strict';
  var KEY = 'hotpulse.workspace.v1';
  var MAX_QUEUE = 200, MAX_POOL = 200;
  var W = HP_ROOT.HP.Workflow;

  var state = {
    pool: [],
    queue: [],
    metrics: { generated: 0, reworked: 0, passed: 0, rejected: 0, published: 0, batches: 0, batchTasks: 0 },
    updatedAt: null
  };
  var listeners = [];

  function storage() {
    try { var ls = window.localStorage; ls.setItem('__hp_ws__', '1'); ls.removeItem('__hp_ws__'); return ls; } catch (e) { return null; }
  }
  function load() {
    var ls = storage();
    if (!ls) return state;
    try {
      var raw = JSON.parse(ls.getItem(KEY) || 'null');
      if (raw && typeof raw === 'object') {
        state.pool = Array.isArray(raw.pool) ? raw.pool : [];
        state.queue = Array.isArray(raw.queue) ? raw.queue : [];
        state.metrics = Object.assign(state.metrics, raw.metrics || {});
        state.updatedAt = raw.updatedAt || null;
      }
    } catch (e) { /* 坏数据就当空 */ }
    return state;
  }
  function save() {
    var ls = storage();
    state.updatedAt = new Date().toISOString();
    if (!ls) return false;
    try {
      ls.setItem(KEY, JSON.stringify({
        pool: state.pool.slice(0, MAX_POOL),
        queue: state.queue.slice(0, MAX_QUEUE),
        metrics: state.metrics,
        updatedAt: state.updatedAt
      }));
      return true;
    } catch (e) { return false; }
  }
  function emit() { save(); listeners.forEach(function (fn) { try { fn(state); } catch (e) {} }); }
  function onChange(fn) { listeners.push(fn); }

  /* ---------------- 选题池 ---------------- */
  function addPool(news, extra) {
    var exist = state.pool.find(function (x) { return x.newsId === news.id && x.status !== '已发'; });
    if (exist) return { ok: false, reason: 'already', item: exist };
    var item = W.newPoolItem(news, extra);
    state.pool = W.upsert(state.pool, item);
    emit();
    return { ok: true, item: item };
  }
  function updatePool(id, patch) {
    var hit = state.pool.find(function (x) { return x.id === id; });
    if (!hit) return null;
    state.pool = W.upsert(state.pool, Object.assign({}, hit, patch));
    emit();
    return state.pool.find(function (x) { return x.id === id; });
  }
  function setPoolStatus(id, status) {
    state.pool = W.setStatus(state.pool, id, status);
    emit();
  }
  function removePool(id) { state.pool = W.remove(state.pool, id); emit(); }
  function conflictsFor(newsId, productId, withinDays) {
    return W.conflicts(state.pool, { newsId: newsId, productId: productId, withinDays: withinDays || 7 });
  }

  /* ---------------- 待审队列 ---------------- */
  function enqueue(items) {
    var before = state.queue.length;
    state.queue = W.enqueue(state.queue, items).slice(-MAX_QUEUE);
    var added = state.queue.length - before;
    if (added > 0) emit();
    return added;
  }
  function setQueueStatus(id, status, extra) {
    state.queue = W.setQueueStatus(state.queue, id, status, extra);
    if (status === '已通过') state.metrics.passed++;
    if (status === '已打回') state.metrics.rejected++;
    if (status === '已发布') state.metrics.published++;
    emit();
  }
  function nextInQueue(currentId, dir) { return W.next(state.queue, currentId, dir); }
  function queueStats() { return W.queueStats(state.queue); }
  function currentQueueItem(id) { return state.queue.find(function (x) { return x.id === id; }) || null; }

  /* ---------------- 指标 ---------------- */
  function bump(key, n) {
    state.metrics[key] = (Number(state.metrics[key]) || 0) + (n == null ? 1 : n);
    emit();
  }
  function batchDone(tasks, okCount) {
    state.metrics.batches++;
    state.metrics.batchTasks += tasks;
    state.metrics.generated += okCount;
    emit();
  }

  function reset() {
    state.pool = []; state.queue = [];
    state.metrics = { generated: 0, reworked: 0, passed: 0, rejected: 0, published: 0, batches: 0, batchTasks: 0 };
    emit();
  }
  function snapshot() { return { pool: state.pool.slice(), queue: state.queue.slice(), metrics: Object.assign({}, state.metrics), updatedAt: state.updatedAt }; }

  var API = {
    KEY: KEY,
    load: load, save: save, onChange: onChange, snapshot: snapshot, reset: reset,
    addPool: addPool, updatePool: updatePool, setPoolStatus: setPoolStatus, removePool: removePool,
    conflictsFor: conflictsFor, pool: function () { return state.pool.slice(); },
    enqueue: enqueue, setQueueStatus: setQueueStatus, nextInQueue: nextInQueue,
    queueStats: queueStats, currentQueueItem: currentQueueItem, queue: function () { return state.queue.slice(); },
    metrics: function () { return Object.assign({}, state.metrics); },
    bump: bump, batchDone: batchDone
  };
  HP_ROOT.HP.Workspace = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();