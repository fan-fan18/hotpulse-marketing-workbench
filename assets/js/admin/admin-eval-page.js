/* =========================================================
   后台页面：评测台（三个视图）
   · 用例管理：用例 = 一组素材 + 语调，可增删改、勾选参与、从真实业务数据生成种子用例
   · 跑评测：配置 → 预估任务数与花费 → 并发可控、可中途叫停 → 边跑边填表 → 汇总看板 → 明细可展开
   · 历史与对比：每轮保存提示词快照 + 短标识 → A/B 指标涨跌、逐条用例对比、提示词差异
   评测核心逻辑全部来自 HP.Eval（与工作台共用同一份）
   ========================================================= */
window.HP = window.HP || {};
HP.AdminPages = HP.AdminPages || {};

(function () {
  'use strict';

  function A() { return HP.Admin; }
  function esc(s) { return A().esc(s); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var RUNS_KEY = 'hotpulse.eval.runs.v1';

  var view = {
    tab: 'cases',
    selectedStyles: [],
    concurrency: 3,
    repeats: 1,
    enableReview: true,
    weights: { machine: 0.5, review: 0.5 },
    autoRework: true,
    maxReworkRounds: 2,
    running: false,
    stopRequested: false,
    progress: { done: 0, total: 0 },
    results: [],
    summary: null,
    expanded: {},
    votes: {},
    ab: { a: null, b: null },
    lastRun: null
  };

  /* ---------------- 用例：轻存储 + 运行期解析 ---------------- */
  function casesOf(ctx) {
    var e = ctx.draft.evalConfig || (ctx.draft.evalConfig = {});
    if (!Array.isArray(e.cases)) e.cases = [];
    return e.cases;
  }

  function resolveCase(ctx, c) {
    var cfg = ctx.draft;
    var news = (window.MOCK.NEWS || []).filter(function (n) { return n.id === c.newsId; })[0] || (window.MOCK.NEWS || [])[0];
    var prods = (c.productIds || []).map(function (id) {
      return (cfg.products || []).filter(function (p) { return p.id === id; })[0];
    }).filter(Boolean);
    if (!prods.length) prods = (cfg.products || []).slice(0, 2);
    return {
      id: c.id, name: c.name, news: news, products: prods,
      tags: (c.tags && c.tags.length ? c.tags : (news.topics || [])).slice(0, 3),
      tone: c.tone || ((cfg.tones || [])[0] || {}).name || '',
      emojiLevel: c.emojiLevel == null ? 1 : c.emojiLevel,
      extra: c.extra || ''
    };
  }

  function selectedCases(ctx) {
    return casesOf(ctx).filter(function (c) { return c.selected !== false; });
  }

  function selectedStyles(ctx) {
    var all = ctx.draft.styles || [];
    var picked = all.filter(function (s) { return view.selectedStyles.indexOf(s.id) > -1; });
    /* 一个都没点过时按「全部参与」处理 —— 和界面上高亮的那些风格保持一致，
       否则预估任务数会比看到的少，运营会以为跑漏了。 */
    return picked.length ? picked : all.slice();
  }

  function plannedTasks(ctx) {
    return selectedCases(ctx).length * selectedStyles(ctx).length * Math.max(1, view.repeats);
  }

  function estimateCost(ctx, tasks) {
    var m = ctx.draft.model || {};
    var inTok = 900 + (view.enableReview ? 700 : 0);
    var outTok = 320 + (view.enableReview ? 90 : 0);
    var per = (inTok / 1000) * Number(m.priceIn || 0) + (outTok / 1000) * Number(m.priceOut || 0);
    return Math.round(per * tasks * 10000) / 10000;
  }

  function readRuns() {
    try { return JSON.parse(window.localStorage.getItem(RUNS_KEY) || '[]'); } catch (e) { return []; }
  }
  function writeRuns(list) {
    try { window.localStorage.setItem(RUNS_KEY, JSON.stringify(list.slice(0, 10))); } catch (e) {}
  }

  /* =========================================================
     页面定义
     ========================================================= */
  HP.AdminPages.eval = {
    key: 'eval', name: '评测台', icon: '6',
    title: '文案效果评测与自动返工',
    subtitle: '用数据证明提示词改动确实变好了：机器校验 + 模型评审 + 自动返工，跑完还能做 A/B 对比。评测核心与工作台共用同一份逻辑。',
    sections: [
      {
        id: 'sec-ev-tabs', short: '视图切换',
        title: '三个视图',
        desc: '用例管理 → 跑评测 → 历史与对比。',
        tight: true,
        render: function () {
          return '<div class="seg-tabs" id="evTabs">' +
            [['cases', '用例管理'], ['run', '跑评测'], ['history', '历史与对比']].map(function (x) {
              return '<button data-tab="' + x[0] + '" class="' + (view.tab === x[0] ? 'active' : '') + '">' + x[1] + '</button>';
            }).join('') + '</div>' +
            '<div id="evBody"></div>';
        },
        mount: function (body, ctx) {
          body.querySelectorAll('#evTabs [data-tab]').forEach(function (b) {
            b.addEventListener('click', function () {
              view.tab = b.dataset.tab;
              paint(ctx);
            });
          });
          paint(ctx);
        }
      }
    ]
  };

  function paint(ctx) {
    var host = document.getElementById('evBody');
    if (!host) return;
    document.querySelectorAll('#evTabs [data-tab]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === view.tab);
    });
    if (view.tab === 'cases') paintCases(host, ctx);
    else if (view.tab === 'run') paintRun(host, ctx);
    else paintHistory(host, ctx);
  }

  /* ---------------- 视图一：用例管理 ---------------- */
  function paintCases(host, ctx) {
    var list = casesOf(ctx);
    var sel = selectedCases(ctx).length;
    host.innerHTML =
      '<div class="row" style="align-items:center;gap:8px;margin-bottom:12px">' +
        '<button class="btn primary tiny" id="evSeed">从真实业务数据生成种子用例</button>' +
        '<button class="btn ghost tiny" id="evAddCase">+ 新增用例</button>' +
        '<button class="btn ghost tiny" id="evClearCases">清空</button>' +
        '<span class="help" style="margin-left:auto">共 ' + list.length + ' 条，勾选参与本轮 ' + sel + ' 条</span>' +
      '</div>' +
      (list.length
        ? '<div class="table-scroll"><table class="admin-table"><thead><tr>' +
            '<th style="width:50px">参与</th><th style="width:170px">用例名称</th><th>热点</th><th style="width:200px">商品</th>' +
            '<th style="width:170px">话题</th><th style="width:100px">语调</th><th style="width:110px">操作</th>' +
          '</tr></thead><tbody>' + list.map(function (c, i) {
            var r = resolveCase(ctx, c);
            return '<tr><td><input type="checkbox" data-csel="' + i + '" ' + (c.selected !== false ? 'checked' : '') + ' /></td>' +
              '<td>' + esc(c.name) + '</td>' +
              '<td class="help">' + esc((r.news || {}).title || '—') + '</td>' +
              '<td class="help">' + esc(r.products.map(function (p) { return p.name.slice(0, 9); }).join('、')) + '</td>' +
              '<td class="help">' + esc(r.tags.join(' ')) + '</td>' +
              '<td>' + esc(r.tone) + '</td>' +
              '<td><button class="btn ghost tiny" data-cedit="' + i + '">编辑</button> ' +
                '<button class="btn ghost tiny" data-cdel="' + i + '">删除</button></td></tr>';
          }).join('') + '</tbody></table></div>'
        : '<div class="help">还没有用例。点「从真实业务数据生成种子用例」可以用当前热点与商品一键生成 6 条。</div>');

    host.querySelectorAll('[data-csel]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        casesOf(ctx)[Number(cb.dataset.csel)].selected = cb.checked;
        ctx.markDirty();
        paintCases(host, ctx);
      });
    });
    host.querySelectorAll('[data-cedit]').forEach(function (b) {
      b.addEventListener('click', function () { openCaseEditor(ctx, Number(b.dataset.cedit)); });
    });
    host.querySelectorAll('[data-cdel]').forEach(function (b) {
      b.addEventListener('click', function () {
        casesOf(ctx).splice(Number(b.dataset.cdel), 1);
        ctx.markDirty(); paintCases(host, ctx);
      });
    });
    host.querySelector('#evSeed').addEventListener('click', function () {
      var seeded = HP.Eval.seedCases();
      var existing = {};
      casesOf(ctx).forEach(function (c) { existing[c.id] = true; });
      var added = seeded.filter(function (c) { return !existing[c.id]; });
      ctx.draft.evalConfig.cases = casesOf(ctx).concat(added);
      ctx.markDirty(); paintCases(host, ctx);
      A().toast('已从真实业务数据生成 ' + added.length + ' 条种子用例', 'ok');
    });
    host.querySelector('#evAddCase').addEventListener('click', function () { openCaseEditor(ctx, -1); });
    host.querySelector('#evClearCases').addEventListener('click', function () {
      if (!casesOf(ctx).length) return;
      A().confirm({ title: '清空全部用例？', sub: '共 ' + casesOf(ctx).length + ' 条，清空后需要重新生成或新增。', okLabel: '清空' })
        .then(function (ok) {
          if (!ok) return;
          ctx.draft.evalConfig.cases = [];
          ctx.markDirty(); paintCases(host, ctx);
        });
    });
  }

  function openCaseEditor(ctx, index) {
    var isNew = index < 0;
    var news = window.MOCK.NEWS || [];
    var tones = ctx.draft.tones || [];
    var base = isNew
      ? {
        id: 'case_' + Date.now().toString(36), name: '新用例', newsId: news[0].id,
        productIds: (ctx.draft.products || []).slice(0, 2).map(function (p) { return p.id; }),
        tags: (news[0].topics || []).slice(0, 2), tone: (tones[0] || {}).name || '',
        emojiLevel: 1, selected: true
      }
      : clone(casesOf(ctx)[index]);
    var work = clone(base);

    A().modal({
      title: isNew ? '新增用例' : '编辑用例 · ' + base.name,
      sub: '用例 = 一组素材（热点 + 商品 + 话题 + 语调）。跑评测时每个创作风格都会基于它生成一条文案。',
      body:
        '<div class="row"><div class="col"><label class="label">用例名称</label>' +
          '<input class="input" id="c-name" value="' + esc(work.name) + '" /></div>' +
          '<div class="col"><label class="label">热点</label><select class="select" id="c-news">' +
            news.map(function (n) {
              return '<option value="' + n.id + '"' + (n.id === work.newsId ? ' selected' : '') + '>' + esc(n.title) + '</option>';
            }).join('') + '</select></div></div>' +
        '<div style="margin-top:12px"><label class="label">商品 <em>最多 3 件，第一件为主推</em></label>' +
          '<div class="ph-list" id="c-prods">' + (ctx.draft.products || []).map(function (p) {
            var on = work.productIds.indexOf(p.id) > -1;
            return '<button type="button" class="tag-pick ' + (on ? 'on' : '') + '" data-cprod="' + p.id + '">' +
              esc(p.emoji + ' ' + p.name.slice(0, 12)) + '</button>';
          }).join('') + '</div></div>' +
        '<div class="row" style="margin-top:12px">' +
          '<div class="col"><label class="label">话题标签 <em>空格分隔</em></label>' +
            '<input class="input" id="c-tags" value="' + esc((work.tags || []).join(' ')) + '" /></div>' +
          '<div class="col narrow"><label class="label">主打语调</label><select class="select" id="c-tone">' +
            tones.map(function (t) { return '<option' + (t.name === work.tone ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="col narrow"><label class="label">表情强度</label><select class="select" id="c-emoji">' +
            [['0', '不使用'], ['1', '适中'], ['2', '丰富']].map(function (x) {
              return '<option value="' + x[0] + '"' + (String(work.emojiLevel) === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
            }).join('') + '</select></div>' +
        '</div>',
      actions: [
        { label: '取消', kind: 'ghost' },
        {
          label: isNew ? '新增用例' : '保存用例', kind: 'primary', handler: function (m) {
            work.name = m.querySelector('#c-name').value.trim() || '未命名用例';
            work.newsId = m.querySelector('#c-news').value;
            work.tags = m.querySelector('#c-tags').value.split(/\s+/).filter(Boolean);
            work.tone = m.querySelector('#c-tone').value;
            work.emojiLevel = Number(m.querySelector('#c-emoji').value);
            if (isNew) casesOf(ctx).push(work);
            else ctx.draft.evalConfig.cases[index] = work;
            ctx.markDirty();
            paint(ctx);
          }
        }
      ],
      onMount: function (m) {
        m.querySelectorAll('[data-cprod]').forEach(function (b) {
          b.addEventListener('click', function () {
            var id = b.dataset.cprod, i = work.productIds.indexOf(id);
            if (i > -1) work.productIds.splice(i, 1);
            else {
              if (work.productIds.length >= 3) { A().toast('一个用例最多选 3 件商品', 'warn'); return; }
              work.productIds.push(id);
            }
            b.classList.toggle('on', work.productIds.indexOf(id) > -1);
          });
        });
      }
    });
  }

  /* ---------------- 视图二：跑评测 ---------------- */
  function scoreClass(n) { return n >= 90 ? 'score-hi' : n >= 75 ? 'score-mid' : 'score-low'; }

  function paintRun(host, ctx) {
    var tasks = plannedTasks(ctx);
    var est = estimateCost(ctx, tasks);
    var m = ctx.draft.model || {};
    var styles = ctx.draft.styles || [];
    var allStyles = view.selectedStyles.length ? view.selectedStyles : styles.map(function (s) { return s.id; });

    host.innerHTML =
      '<div class="card-mini" style="margin-bottom:12px">' +
        '<div class="row">' +
          '<div class="col"><label class="label">参与的创作风格 <em>每个风格独立跑一次</em></label>' +
            '<div class="ph-list" id="evStyles">' + styles.map(function (s) {
              return '<button type="button" class="tag-pick ' + (allStyles.indexOf(s.id) > -1 ? 'on' : '') +
                '" data-evs="' + esc(s.id) + '">' + esc(s.name) + '</button>';
            }).join('') + '</div></div>' +
        '</div>' +
        '<div class="row" style="margin-top:12px">' +
          '<div class="col narrow"><label class="label">同时跑几条 <em>默认 3</em></label>' +
            '<input class="input" type="number" min="1" max="10" id="evConc" value="' + view.concurrency + '" /></div>' +
          '<div class="col narrow"><label class="label">每条重复次数</label>' +
            '<input class="input" type="number" min="1" max="5" id="evRep" value="' + view.repeats + '" /></div>' +
          '<div class="col narrow"><label class="label">模型评审</label>' +
            '<label class="checkline" style="margin:0"><input type="checkbox" id="evReview" ' + (view.enableReview ? 'checked' : '') + ' />' +
              '<span>启用（低温度四维打分）</span></label></div>' +
          '<div class="col narrow"><label class="label">自动返工</label>' +
            '<label class="checkline" style="margin:0"><input type="checkbox" id="evRework" ' + (view.autoRework ? 'checked' : '') + ' />' +
              '<span>校验没过先返工</span></label>' +
            '<input class="input" type="number" min="0" max="4" id="evRounds" value="' + view.maxReworkRounds + '" title="最多返工轮数" style="margin-top:6px" /></div>' +
          '<div class="col narrow"><label class="label">权重（机器 : 评审）</label>' +
            '<div style="display:flex;gap:6px">' +
              '<input class="input" type="number" min="0" max="1" step="0.05" id="evWm" value="' + view.weights.machine + '" />' +
              '<input class="input" type="number" min="0" max="1" step="0.05" id="evWr" value="' + view.weights.review + '" /></div></div>' +
          '<div class="col narrow"><label class="label">单价（元 / 千 tokens）</label>' +
            '<input class="input" value="' + (m.priceIn == null ? 0 : m.priceIn) + ' / ' + (m.priceOut == null ? 0 : m.priceOut) + '" readonly />' +
            '<div class="help">参考价，以服务商官网为准，可自行修改（在「模型与接入」页）。</div></div>' +
          '<div class="col narrow"><label class="label">当前模型</label>' +
            '<input class="input" value="' + esc((m.model || '—') + ' · ' + (HP.LLM.MODE_LABEL[m.mode] || m.mode)) + '" readonly /></div>' +
        '</div>' +
      '</div>' +
      '<div class="card-mini" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
        '<div><b style="font-size:18px">' + tasks + '</b> <span class="help">个任务</span></div>' +
        '<div><b style="font-size:18px">¥' + est + '</b> <span class="help">预计花费（估算）</span></div>' +
        '<div class="help">= 用例 ' + selectedCases(ctx).length + ' × 风格 ' + selectedStyles(ctx).length +
          ' × 重复 ' + view.repeats + (view.autoRework ? '，含自动返工' : '') + '</div>' +
        '<div style="margin-left:auto;display:flex;gap:8px">' +
          '<button class="btn primary" id="evStart" ' + (view.running ? 'disabled' : '') + '>' + (view.running ? '运行中…' : '开始评测') + '</button>' +
          '<button class="btn ghost" id="evStop" ' + (view.running ? '' : 'disabled') + '>叫停</button>' +
        '</div>' +
      '</div>' +
      '<div class="progress-wrap"><span id="evBar" style="width:' +
        (view.progress.total ? Math.round(view.progress.done / view.progress.total * 100) : 0) + '%"></span></div>' +
      '<div class="help" id="evProgress">' + (view.progress.total
        ? ('已完成 ' + view.progress.done + ' / ' + view.progress.total + (view.running ? '（进行中）' : ''))
        : '尚未开始') + '</div>' +
      '<div id="evSummary"></div><div id="evSuggest"></div><div id="evDetail"></div>';

    host.querySelectorAll('[data-evs]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.evs, i = allStyles.indexOf(id);
        if (i > -1) { if (allStyles.length <= 1) { A().toast('至少要留一个创作风格参与评测', 'warn'); return; } allStyles.splice(i, 1); }
        else allStyles.push(id);
        view.selectedStyles = allStyles.slice();
        paintRun(host, ctx);
      });
    });
    host.querySelector('#evConc').addEventListener('change', function (e) {
      view.concurrency = Math.max(1, Math.min(10, Number(e.target.value) || 3));
      persistRunConfig(ctx);
      paintRun(host, ctx);
    });
    host.querySelector('#evRep').addEventListener('change', function (e) {
      view.repeats = Math.max(1, Math.min(5, Number(e.target.value) || 1));
      persistRunConfig(ctx);
      paintRun(host, ctx);
    });
    host.querySelector('#evReview').addEventListener('change', function (e) {
      view.enableReview = e.target.checked; persistRunConfig(ctx); paintRun(host, ctx);
    });
    host.querySelector('#evRework').addEventListener('change', function (e) {
      view.autoRework = e.target.checked; persistRunConfig(ctx); paintRun(host, ctx);
    });
    host.querySelector('#evRounds').addEventListener('change', function (e) {
      view.maxReworkRounds = Math.max(0, Math.min(4, Number(e.target.value) || 0));
      persistRunConfig(ctx);
    });
    host.querySelector('#evWm').addEventListener('change', function (e) {
      var v = Math.max(0, Math.min(1, Number(e.target.value) || 0));
      view.weights = { machine: Math.round(v * 100) / 100, review: Math.round((1 - v) * 100) / 100 };
      persistRunConfig(ctx);
      paintRun(host, ctx);
    });
    host.querySelector('#evWr').addEventListener('change', function (e) {
      var v = Math.max(0, Math.min(1, Number(e.target.value) || 0));
      view.weights = { machine: Math.round((1 - v) * 100) / 100, review: Math.round(v * 100) / 100 };
      persistRunConfig(ctx);
      paintRun(host, ctx);
    });
    host.querySelector('#evStart').addEventListener('click', function () { startRun(ctx); });
    host.querySelector('#evStop').addEventListener('click', function () {
      view.stopRequested = true;
      A().toast('已发出叫停信号：正在跑的几条跑完就停，不再派发新任务', 'warn');
    });

    if (view.results.length) { renderSummary(ctx); renderSuggest(ctx); renderDetail(ctx); }
  }

  /* 评测配置写回共用配置（与工作台同一份） */
  function persistRunConfig(ctx) {
    ctx.draft.evalConfig = Object.assign({}, ctx.draft.evalConfig, {
      concurrency: view.concurrency, repeats: view.repeats,
      enableReview: view.enableReview, autoRework: view.autoRework,
      maxReworkRounds: view.maxReworkRounds, weights: view.weights
    });
    ctx.markDirty();
  }

  function startRun(ctx) {
    var cases = selectedCases(ctx).map(function (c) { return resolveCase(ctx, c); });
    if (!cases.length) { A().toast('至少勾选一条用例', 'warn'); return; }
    var styles = selectedStyles(ctx);
    view.running = true;
    view.stopRequested = false;
    view.results = [];
    view.summary = null;
    view.expanded = {};
    view.progress = { done: 0, total: plannedTasks(ctx) };
    paint(ctx);

    HP.Eval.runEval({
      cases: cases, styles: styles, repeats: view.repeats,
      concurrency: view.concurrency, enableReview: view.enableReview,
      weights: view.weights, autoRework: view.autoRework, maxReworkRounds: view.maxReworkRounds,
      config: ctx.draft,
      isStopped: function () { return view.stopRequested; },
      onProgress: function (p) {
        view.progress = { done: p.done, total: p.total };
        view.results.push(p.record);
        var bar = document.getElementById('evBar');
        var txt = document.getElementById('evProgress');
        if (bar) bar.style.width = Math.round(p.done / p.total * 100) + '%';
        if (txt) txt.textContent = '已完成 ' + p.done + ' / ' + p.total + '（最近：' + p.record.caseName + ' · ' + p.record.style + '）';
        renderSummary(ctx); renderSuggest(ctx); renderDetail(ctx);
      }
    }).then(function (r) {
      view.running = false;
      view.summary = r.summary;
      view.results = r.results;
      var promptSnapshot = clone(ctx.draft.prompt);
      var run = {
        id: 'run_' + Date.now().toString(36),
        shortId: HP.Eval.shortId(promptSnapshot),
        time: new Date().toISOString(),
        stopped: r.stopped,
        summary: r.summary,
        results: r.results,
        promptSnapshot: promptSnapshot,
        config: {
          model: (ctx.draft.model || {}).model,
          mode: (ctx.draft.model || {}).mode,
          styles: styles.map(function (s) { return s.name; }),
          weights: view.weights, concurrency: view.concurrency, repeats: view.repeats,
          enableReview: view.enableReview, autoRework: view.autoRework, maxReworkRounds: view.maxReworkRounds
        }
      };
      view.lastRun = run;
      writeRuns([run].concat(readRuns()));
      paint(ctx);
      A().toast('评测完成：' + r.summary.done + ' 条，平均总分 ' + r.summary.avgScore +
        '，已存入历史（短标识 ' + run.shortId + '）', 'ok');
    }).catch(function (e) {
      view.running = false;
      paint(ctx);
      A().toast('评测中断：' + e.message, 'warn');
    });
  }

  /* 汇总看板 */
  function renderSummary(ctx) {
    var host = document.getElementById('evSummary');
    if (!host) return;
    var s = view.summary || HP.Eval.summarize(view.results, view.progress.total || view.results.length, 0);
    var est = estimateCost(ctx, view.progress.total || plannedTasks(ctx));
    function card(k, v, cls, d) {
      return '<div class="card-mini"><div class="k">' + esc(k) + '</div>' +
        '<div class="v">' + (cls ? '<span class="score-pill ' + cls + '">' + esc(v) + '</span>' : esc(v)) + '</div>' +
        (d ? '<div class="d">' + esc(d) + '</div>' : '') + '</div>';
    }
    host.innerHTML = '<div class="card-mini" style="margin-top:14px">' +
      '<b style="display:block;margin-bottom:10px">汇总看板</b>' +
      '<div class="stat-grid">' +
        card('平均总分', s.avgScore, scoreClass(s.avgScore)) +
        card('机器校验通过率', s.machinePassRate + ' %') +
        card('评审均分', s.reviewAvg == null ? '—' : s.reviewAvg + ' / 5') +
        card('违禁词命中数', s.forbiddenHits, s.forbiddenHits ? 'score-low' : 'score-hi') +
        card('编造价格数', s.fakePriceCount, s.fakePriceCount ? 'score-low' : 'score-hi') +
        card('总消耗', s.tokens + ' tokens') +
        card('总耗时', s.elapsedMs + ' ms') +
        card('预估花费', '¥' + (s.cost || est), null, '估算值（' + (s.cost ? '按实际 tokens' : '按预设 tokens') + '）') +
      '</div>' +
      '<div class="help" style="margin-top:10px">已完成 ' + s.completed + ' 条 / 计划 ' +
        (s.planned || s.total || 0) + ' 条；失败 ' + s.failed +
        '；自动返工提升 ' + (s.reworkImproved || 0) + ' 条；评审失败 ' + (s.reviewFailed || 0) +
        ' 条（解析不了会跳过，不中断整轮）。' + (view.running ? '　运行中…' : '') + '</div>' +
    '</div>';
  }

  /* 改进建议：把评测结果反过来变成提示词改动 */
  function renderSuggest(ctx) {
    var host = document.getElementById('evSuggest');
    if (!host) return;
    var list = HP.Eval.suggestFixes(view.results);
    if (!list.length) {
      host.innerHTML = '<div class="card-mini" style="margin-top:12px"><b>改进建议</b>' +
        '<div class="help" style="margin-top:6px">本轮没有发现需要改进的问题（没有未通过项）。</div></div>';
      return;
    }
    host.innerHTML = '<div class="card-mini" style="margin-top:12px"><b>改进建议（按未通过项统计）</b>' +
      '<div class="help" style="margin-top:4px">这些建议可以直接写进提示词规范，改完再跑同一批用例，在「历史与对比」里验证分数是否真的涨了。</div>' +
      list.map(function (it, i) {
        return '<div class="card-mini" style="margin-top:10px;background:var(--panel-2)">' +
          '<b style="font-size:13px">' + esc(it.title) + '（' + it.count + ' 条）</b>' +
          '<div class="help" style="margin-top:4px">' + esc(it.reason) + '</div>' +
          (it.rule ? '<div class="help" style="margin-top:6px;background:#fff;border:1px solid var(--line-2);border-radius:8px;padding:8px">' +
              esc(it.rule) + '</div>' : '') +
          '<div style="margin-top:8px;display:flex;gap:8px">' +
            (it.rule ? '<button class="btn soft tiny" data-applyrule="' + i + '">写入写作规范</button>' : '') +
            (it.rule ? '' : '<button class="btn soft tiny" data-applyexample="1">把本轮最高分文案设为范例</button>') +
          '</div></div>';
      }).join('') + '</div>';

    host.querySelectorAll('[data-applyrule]').forEach(function (b) {
      b.addEventListener('click', function () {
        var it = list[Number(b.dataset.applyrule)];
        ctx.draft.prompt.rules.push(it.rule);
        ctx.markDirty();
        A().toast('已把这条规范写进「写作规范」（还没保存，保存后再跑一轮对比）', 'ok');
      });
    });
    host.querySelectorAll('[data-applyexample]').forEach(function (b) {
      b.addEventListener('click', function () {
        var best = view.results.filter(function (r) { return r.machine && r.machine.pass; })
          .sort(function (a, b2) { return (b2.totalScore || 0) - (a.totalScore || 0); })[0];
        if (!best) { A().toast('本轮还没有通过校验的文案，先修好再用它当范例', 'warn'); return; }
        ctx.draft.prompt.example = best.copy;
        ctx.markDirty();
        A().toast('已把最高分文案（' + best.totalScore + ' 分）设为范例（还没保存）', 'ok');
      });
    });
  }

  /* 明细表：每行可展开 */
  function renderDetail(ctx) {
    var host = document.getElementById('evDetail');
    if (!host) return;
    if (!view.results.length) { host.innerHTML = ''; return; }
    host.innerHTML = '<div class="table-scroll" style="margin-top:14px"><table class="admin-table"><thead><tr>' +
      '<th style="width:60px">展开</th><th>用例</th><th style="width:110px">风格</th>' +
      '<th class="num" style="width:90px">机器分</th><th class="num" style="width:90px">评审</th>' +
      '<th class="num" style="width:90px">总分</th><th class="num" style="width:80px">返工</th>' +
      '<th class="num" style="width:100px">耗时</th><th class="num" style="width:90px">tokens</th>' +
    '</tr></thead><tbody>' + view.results.map(function (r, i) {
      var total = typeof r.totalScore === 'number' ? r.totalScore : 0;
      var open = !!view.expanded[r.key];
      var rows = '<tr' + (open ? ' class="detail-row"' : '') + '>' +
        '<td><button class="btn ghost tiny" data-exp="' + i + '">' + (open ? '收起' : '展开') + '</button></td>' +
        '<td>' + esc(r.caseName) + '</td><td>' + esc(r.style) + '</td>' +
        '<td class="num">' + (r.machine ? r.machine.score : '—') + '</td>' +
        '<td class="num">' + (r.review && r.review.ok ? r.review.avg : '—') + '</td>' +
        '<td class="num"><span class="score-pill ' + scoreClass(total) + '">' + total + '</span></td>' +
        '<td class="num">' + (r.rework ? (r.rework.acceptedRounds ? r.rework.before + '→' + r.rework.after : '未采纳') : '未触发') + '</td>' +
        '<td class="num">' + (r.latencyMs || 0) + ' ms</td>' +
        '<td class="num">' + ((r.tokens && (r.tokens.input + r.tokens.output)) || 0) + '</td></tr>';
      if (open) rows += '<tr class="detail-row"><td colspan="9">' + detailHtml(r, i) + '</td></tr>';
      return rows;
    }).join('') + '</tbody></table></div>';

    host.querySelectorAll('[data-exp]').forEach(function (b) {
      b.addEventListener('click', function () {
        var r = view.results[Number(b.dataset.exp)];
        view.expanded[r.key] = !view.expanded[r.key];
        renderDetail(ctx);
      });
    });
    host.querySelectorAll('[data-vote]').forEach(function (b) {
      b.addEventListener('click', function () {
        var r = view.results[Number(b.dataset.vidx)];
        view.votes[r.key] = view.votes[r.key] || {};
        view.votes[r.key].vote = b.dataset.vote;
        renderDetail(ctx);
      });
    });
    host.querySelectorAll('[data-note]').forEach(function (el) {
      el.addEventListener('change', function () {
        var r = view.results[Number(el.dataset.note)];
        view.votes[r.key] = view.votes[r.key] || {};
        view.votes[r.key].note = el.value;
        A().toast('备注已记录', 'ok');
      });
    });
  }

  function detailHtml(r, idx) {
    var v = view.votes[r.key] || {};
    var checks = r.machine ? r.machine.items.map(function (i) {
      var cls = i.pass ? 'pass' : (i.level === 'hard' ? 'hard' : 'fail');
      return '<div class="check-line ' + cls + '"><span class="mark">' + (i.pass ? '✓' : '！') + '</span>' +
        '<span class="txt"><b>' + esc(i.label) + (i.level === 'hard' ? '（硬伤）' : '') +
        '　<em style="font-style:normal;color:var(--ink-3)">权重 ' + i.weight + '</em></b>' +
        '<i>' + esc(i.reason) + '</i></span></div>';
    }).join('') : '';
    var review = r.review && r.review.ok
      ? '<div class="check-line pass"><span class="mark">✓</span><span class="txt"><b>模型评审 ' + r.review.avg + ' / 5</b>' +
        '<i>热点关联度 ' + r.review.dims.hot + '｜素材还原度 ' + r.review.dims.material +
        '｜传播吸引力 ' + r.review.dims.appeal + '｜语气自然度 ' + r.review.dims.natural +
        '｜点评：' + esc(r.review.dims.comment || '（无）') + '</i></span></div>'
      : '<div class="check-line fail"><span class="mark">！</span><span class="txt"><b>评审未完成</b>' +
        '<i>' + esc((r.review && r.review.reason) || '未启用或调用失败') + '</i></span></div>';
    var rework = r.rework
      ? '<div class="help" style="margin-top:8px">返工轨迹：' + r.rework.rounds.map(function (x) {
        return '第 ' + x.round + ' 轮' + (x.accepted ? '（采纳 ' + x.scoreBefore + '→' + x.scoreAfter + '）' : '（驳回）') +
          ' 修好：' + (x.fixed.join('、') || '无') + '；剩余：' + (x.remaining.join('、') || '无');
      }).join('；') + '</div>' : '';
    return '<div class="detail-box"><div>' +
        '<div class="help" style="margin-bottom:6px">文案全文' + (r.rework && r.rework.improved ? '（含自动返工后的版本）' : '') + '</div>' +
        '<div class="copy">' + esc(r.copy || r.error || '（无内容）') + '</div>' + rework + '</div>' +
      '<div><div class="help" style="margin-bottom:6px">逐条校验结果</div>' + checks + review +
        '<div class="vote-row">' +
          '<button data-vote="up" data-vidx="' + idx + '" class="' + (v.vote === 'up' ? 'on up' : '') + '">👍 点赞</button>' +
          '<button data-vote="down" data-vidx="' + idx + '" class="' + (v.vote === 'down' ? 'on down' : '') + '">👎 点踩</button>' +
          '<input class="input" style="flex:1" placeholder="人工备注" data-note="' + idx + '" value="' + esc(v.note || '') + '" />' +
        '</div></div></div>';
  }

  /* ---------------- 视图三：历史与对比 ---------------- */
  function paintHistory(host, ctx) {
    var runs = readRuns();
    if (!runs.length) {
      host.innerHTML = '<div class="help">还没有历史记录。去「跑评测」跑一轮，跑完会自动保存：' +
        '包含当时的提示词快照，并给这一版一个短标识（做对比的锚点）。</div>';
      return;
    }
    var a = runs.filter(function (r) { return r.id === view.ab.a; })[0];
    var b = runs.filter(function (r) { return r.id === view.ab.b; })[0];
    var cmp = (a && b) ? HP.Eval.compareRuns(a, b) : null;

    host.innerHTML =
      '<div class="help" style="margin-bottom:10px">每轮都会把当时用的提示词原样存一份并给一个短标识（提示词哈希 + 日期时间）。' +
        '选两次运行做 A/B：上面看提示词差在哪，中间看指标涨跌，下面看逐条用例。' + '</div>' +
      '<div class="table-scroll"><table class="admin-table"><thead><tr>' +
        '<th style="width:50px">A</th><th style="width:50px">B</th><th style="width:130px">短标识</th>' +
        '<th style="width:150px">时间</th><th>模型 / 风格</th>' +
        '<th class="num" style="width:90px">总分</th><th class="num" style="width:90px">通过率</th>' +
        '<th class="num" style="width:70px">条数</th><th style="width:70px"></th>' +
      '</tr></thead><tbody>' + runs.map(function (r) {
        return '<tr><td><input type="radio" name="evA" data-aba="' + r.id + '" ' + (view.ab.a === r.id ? 'checked' : '') + ' /></td>' +
          '<td><input type="radio" name="evB" data-abb="' + r.id + '" ' + (view.ab.b === r.id ? 'checked' : '') + ' /></td>' +
          '<td><b>' + esc(r.shortId) + '</b>' + (r.stopped ? ' <span class="badge warn">已叫停</span>' : '') + '</td>' +
          '<td class="help">' + new Date(r.time).toLocaleString('zh-CN') + '</td>' +
          '<td class="help">' + esc((r.config.model || '—') + ' · ' + (HP.LLM.MODE_LABEL[r.config.mode] || r.config.mode)) +
            '<br />' + esc((r.config.styles || []).join('、')) + '</td>' +
          '<td class="num"><span class="score-pill ' + scoreClass(r.summary.avgScore) + '">' + r.summary.avgScore + '</span></td>' +
          '<td class="num">' + r.summary.machinePassRate + ' %</td>' +
          '<td class="num">' + r.summary.done + '</td>' +
          '<td><button class="btn ghost tiny" data-delrun="' + r.id + '">删除</button></td></tr>';
      }).join('') + '</tbody></table></div>' +
      (cmp ? '<div id="evCompare" style="margin-top:16px">' + renderCompare(a, b, cmp) + '</div>'
        : '<div class="help" style="margin-top:14px">选两次运行（左 A 右 B）后，这里会显示：提示词差在哪、指标涨跌、以及这次改动导致变差的用例。</div>');

    host.querySelectorAll('[data-aba]').forEach(function (el) {
      el.addEventListener('change', function () { view.ab.a = el.dataset.aba; paintHistory(host, ctx); });
    });
    host.querySelectorAll('[data-abb]').forEach(function (el) {
      el.addEventListener('change', function () { view.ab.b = el.dataset.abb; paintHistory(host, ctx); });
    });
    host.querySelectorAll('[data-delrun]').forEach(function (el) {
      el.addEventListener('click', function () {
        writeRuns(readRuns().filter(function (r) { return r.id !== el.dataset.delrun; }));
        if (view.ab.a === el.dataset.delrun) view.ab.a = null;
        if (view.ab.b === el.dataset.delrun) view.ab.b = null;
        paintHistory(host, ctx);
      });
    });
  }

  function renderCompare(a, b, cmp) {
    return '<div class="card-mini"><b>提示词差在哪（' + esc(a.shortId) + ' → ' + esc(b.shortId) + '）</b>' +
        '<div style="margin-top:10px">' + cmp.promptDiff.map(function (d) {
          return '<div class="check-line"><span class="mark" style="background:var(--brand)">i</span>' +
            '<span class="txt"><b>' + esc(d.label) + '（' + d.aLen + ' → ' + d.bLen + ' 字）</b>' +
            '<i>A：' + esc(d.a || '（空）') + '<br />B：' + esc(d.b || '（空）') + '</i></span></div>';
        }).join('') + '</div></div>' +
      '<div class="table-scroll" style="margin-top:14px"><table class="admin-table"><thead><tr>' +
        '<th>指标</th><th class="num">A（' + esc(a.shortId) + '）</th><th class="num">B（' + esc(b.shortId) + '）</th><th class="num">变化</th>' +
      '</tr></thead><tbody>' + cmp.metrics.map(function (m) {
        var arrow = m.delta === 0 ? '→' : (m.better === true ? '↑' : '↓');
        var cls = m.delta === 0 ? 'diff-flat' : (m.better ? 'diff-up' : 'diff-down');
        return '<tr><td>' + esc(m.label) + '</td><td class="num">' + m.a + (m.unit ? ' ' + m.unit : '') + '</td>' +
          '<td class="num">' + m.b + (m.unit ? ' ' + m.unit : '') + '</td>' +
          '<td class="num ' + cls + '">' + arrow + ' ' + (m.delta > 0 ? '+' : '') + m.delta + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="card-mini" style="margin-top:14px"><b>这次改动导致变差的用例：' + cmp.worse.length + ' 条</b>' +
        '<div class="help">' + (cmp.worse.length ? '已在下表高亮，建议先看这些用例的文案差异。' : '没有变差的用例。') + '</div></div>' +
      '<div class="table-scroll" style="margin-top:10px"><table class="admin-table"><thead><tr>' +
        '<th>用例</th><th style="width:110px">风格</th><th class="num" style="width:80px">A</th>' +
        '<th class="num" style="width:80px">B</th><th class="num" style="width:100px">变化</th>' +
      '</tr></thead><tbody>' + cmp.perCase.map(function (p) {
        var cls = p.delta == null ? 'diff-flat' : p.delta > 0 ? 'diff-up' : p.delta < 0 ? 'diff-down' : 'diff-flat';
        var arrow = p.delta == null ? '' : (p.delta > 0 ? '↑' : p.delta < 0 ? '↓' : '→');
        return '<tr class="' + (p.worse ? 'worse-row' : '') + '"><td>' + esc(p.caseName) + '</td><td>' + esc(p.style) + '</td>' +
          '<td class="num">' + (p.a == null ? '—' : p.a) + '</td><td class="num">' + (p.b == null ? '—' : p.b) + '</td>' +
          '<td class="num ' + cls + '">' + arrow + ' ' + (p.delta == null ? '' : (p.delta > 0 ? '+' : '') + p.delta) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
})();
