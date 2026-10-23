/* =========================================================
   热点池 + 定时抓取（零依赖）
   · 去重：同一条新闻被多个来源抓到只留一条（复用 assets/js/core/workflow.js 的指纹规则）
   · 热度：来源给了 heat 就用真值，否则按"来源权重 + 榜单位置 + 被重复抓到的次数"估算
   · 趋势：每次抓取往 history 里追加一个采样点，工作台据此画迷你走势
   · 存储：data/news.json（原子写：先写 .tmp 再 rename，避免写一半断电留下坏文件）
   ========================================================= */
const fs = require('fs');
const path = require('path');
const W = require('../assets/js/core/workflow.js');
const { fetchSource } = require('./sources');

const FILE_VERSION = 1;
const MAX_ITEMS = 300;
const MAX_RUNS = 30;
const MAX_POINTS = 24;

function createNewsStore(opts) {
  const o = opts || {};
  const dataDir = o.dataDir;
  const file = path.join(dataDir, 'news.json');
  const getConfig = o.getConfig || function () { return {}; };
  const log = o.log || function () {};

  let state = { version: FILE_VERSION, updatedAt: null, items: [], runs: [] };
  let running = false;
  let timer = null;
  let nextRunAt = null;

  function load() {
    try {
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (raw && Array.isArray(raw.items)) state = { version: FILE_VERSION, updatedAt: raw.updatedAt || null, items: raw.items, runs: raw.runs || [] };
      }
    } catch (e) {
      log('news.json 读取失败，按空池启动：' + e.message);
    }
    return state;
  }

  function save() {
    try {
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    } catch (e) {
      log('news.json 写入失败：' + e.message);
    }
  }

  /* 没有真实热度时的估算：位置越靠前越高，被反复抓到会持续加热 */
  function heatOf(sourceId, idx, seenCount) {
    const base = 690 + (10 - Math.min(9, idx)) * 6;
    const seen = Math.min(60, (Number(seenCount) || 1) * 9);
    const jitter = Math.abs(Number(String(sourceId).split('').reduce(function (a, c) { return (a * 31 + c.charCodeAt(0)) % 997; }, 7))) % 40;
    return Math.max(600, Math.min(990, base + seen + jitter));
  }

  function iso(d) { return new Date(d).toISOString(); }

  async function refresh(opts) {
    if (running) return { ok: false, reason: '正在抓取中，请稍候', running: true };
    running = true;
    const started = Date.now();
    const cfg = getConfig() || {};
    const all = (cfg.sources || []).filter(function (s) { return s.enabled && /^https?:\/\//i.test(String(s.url || '')); });
    const results = [];
    try {
      /* 串行抓：来源通常只有几个，串行对对方更友好，也方便逐个记录耗时 */
      for (const s of all) {
        const r = await fetchSource(s, 6000);
        results.push(r);
      }
      const now = new Date();
      const nowIso = iso(now);
      let added = 0, merged = 0;
      const byFp = new Map();
      state.items.forEach(function (it) { byFp.set(it.fp || W.fingerprint(it.title), it); });

      results.forEach(function (r) {
        if (!r.ok || !r.items || !r.items.length) return;
        r.items.forEach(function (it, idx) {
          const fp = W.fingerprint(it.title);
          if (!fp) return;
          const heat = Number(it.heat) > 0 ? Math.min(999, Number(it.heat)) : heatOf(r.id, idx, 1);
          const exist = byFp.get(fp);
          if (exist) {
            merged++;
            exist.lastSeen = nowIso;
            exist.seenCount = (Number(exist.seenCount) || 1) + 1;
            exist.heat = Math.max(Number(exist.heat) || 0, heat);
            exist.summary = exist.summary || it.summary || '';
            exist.link = exist.link || it.link || '';
            exist.history = (exist.history || []).concat([{ t: nowIso, heat: exist.heat }]).slice(-MAX_POINTS);
            if (exist.sources && r.name && exist.sources.indexOf(r.name) < 0) exist.sources.push(r.name);
            /* 同一条新闻可能被多个来源抓到：来源 id 也合并，统计"覆盖几个来源"才准 */
            exist.sourceIds = exist.sourceIds || (exist.sourceId ? [exist.sourceId] : []);
            if (r.id && exist.sourceIds.indexOf(r.id) < 0) exist.sourceIds.push(r.id);
            return;
          }
          const item = {
            id: 'sn_' + fp.slice(0, 12) + '_' + Math.abs(fp.length * 31 + (r.id || '').length).toString(36),
            fp: fp,
            title: String(it.title || '').slice(0, 140),
            summary: String(it.summary || '').slice(0, 240),
            link: String(it.link || '').slice(0, 300),
            sourceId: r.id,
            source: r.name,
            sources: [r.name],
            sourceIds: [r.id],
            firstSeen: nowIso,
            lastSeen: nowIso,
            seenCount: 1,
            heat: heat,
            history: [{ t: nowIso, heat: heat }]
          };
          added++;
          byFp.set(fp, item);
          state.items.push(item);
        });
      });

      /* 清理：超过保留天数的丢掉；再按热度截断到上限 */
      const keepDays = Math.max(1, Number((cfg.fetch || {}).keepDays) || 7);
      const cutoff = now.getTime() - keepDays * 86400000;
      state.items = state.items.filter(function (it) { return new Date(it.lastSeen || it.firstSeen).getTime() >= cutoff; })
        .sort(function (a, b) { return (b.heat || 0) - (a.heat || 0); })
        .slice(0, MAX_ITEMS);

      const run = {
        at: nowIso,
        ms: Date.now() - started,
        sources: results.map(function (r) {
          return { id: r.id, name: r.name, ok: r.ok, count: r.count || 0, ms: r.ms || 0, reason: r.reason || '' };
        }),
        okSources: results.filter(function (r) { return r.ok && r.count > 0; }).length,
        failedSources: results.filter(function (r) { return !r.ok; }).length,
        added: added,
        merged: merged,
        total: state.items.length
      };
      state.runs = [run].concat(state.runs || []).slice(0, MAX_RUNS);
      state.updatedAt = nowIso;
      save();
      log('定时抓取完成：新增 ' + added + ' 条、合并重复 ' + merged + ' 条，池内共 ' + state.items.length + ' 条');
      return { ok: true, run: run };
    } catch (e) {
      log('定时抓取异常：' + e.message);
      return { ok: false, reason: '抓取异常：' + e.message };
    } finally {
      running = false;
    }
  }

  function list() {
    return state.items.slice().sort(function (a, b) { return (b.heat || 0) - (a.heat || 0); });
  }

  function stats() {
    const today = W.dayKey(new Date());
    const items = state.items;
    const up = items.filter(function (it) { return W.trendOf(it.history).label === 'up'; }).length;
    const last = (state.runs || [])[0] || null;
    return {
      total: items.length,
      today: items.filter(function (it) { return W.dayKey(it.firstSeen) === today; }).length,
      up: up,
      sources: new Set(items.reduce(function (acc, it) {
        return acc.concat((it.sourceIds && it.sourceIds.length) ? it.sourceIds : [it.sourceId]);
      }, [])).size,
      lastRun: last,
      updatedAt: state.updatedAt,
      running: running,
      nextRunAt: nextRunAt,
      intervalMin: intervalMin()
    };
  }

  function intervalMin() {
    const cfg = getConfig() || {};
    const f = cfg.fetch || {};
    const n = Number(f.intervalMin);
    return n >= 1 ? Math.min(240, n) : 10;
  }

  function enabled() {
    const cfg = getConfig() || {};
    return !(cfg.fetch && cfg.fetch.enabled === false);
  }

  function schedule(delayMs) {
    if (timer) clearTimeout(timer);
    if (!enabled()) { nextRunAt = null; return; }
    const ms = delayMs == null ? intervalMin() * 60000 : delayMs;
    nextRunAt = new Date(Date.now() + ms).toISOString();
    timer = setTimeout(async function () {
      timer = null;
      if (enabled()) await refresh();
      schedule();
    }, ms);
    if (timer.unref) timer.unref();   /* 不阻止进程退出 */
  }

  function start() {
    if (!enabled()) { nextRunAt = null; return { ok: false, reason: '定时抓取已关闭' }; }
    schedule(3000);   /* 启动 3 秒后先跑一次，之后按配置间隔 */
    return { ok: true, firstRunInMs: 3000, intervalMin: intervalMin() };
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
    nextRunAt = null;
  }

  /* 配置改了（间隔/开关）→ 立刻按新配置重排下一次 */
  function reschedule() {
    schedule();
    return { ok: true, intervalMin: intervalMin(), enabled: enabled(), nextRunAt: nextRunAt };
  }

  function runs() { return (state.runs || []).slice(0, MAX_RUNS); }

  return { load, save, refresh, list, stats, runs, start, stop, reschedule, intervalMin, enabled, file };
}

module.exports = { createNewsStore };