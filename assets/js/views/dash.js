/* =========================================================
   数据看板：抓取 / 生产 / 审核 三段效率指标
   数据来源：服务端 /api/news（真实抓取记录）+ 本机工作区指标 + 待审队列
   ========================================================= */
(function () {
  'use strict';
  var HP = window.HP;
  var W = HP.Workflow;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  function card(k, v, unit, d, cls) {
    return '<div class="stat-card"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) +
      (unit ? '<small>' + esc(unit) + '</small>' : '') + '</div><div class="d ' + (cls || '') + '">' + esc(d) + '</div></div>';
  }
  function timeOf(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  function bars(arr, cls) {
    var hs = W.sparkBars(arr);
    if (!hs.length) return '<span class="muted">—</span>';
    return '<div class="mini-bars">' + hs.map(function (h) { return '<i class="' + (cls || '') + '" style="height:' + Math.round(h / 100 * 26) + 'px"></i>'; }).join('') + '</div>';
  }

  function render(root) {
    var st = HP.AppCtx.newsStats ? HP.AppCtx.newsStats() : null;
    var runs = HP.AppCtx.newsRuns ? HP.AppCtx.newsRuns() : [];
    var news = HP.AppCtx.news ? HP.AppCtx.news() : [];
    var m = HP.Workspace.metrics();
    var q = HP.Workspace.queueStats();
    var server = !!(st && st.total != null);

    var reviewed = m.passed + m.rejected;
    var passRate = reviewed ? Math.round(m.passed / reviewed * 100) : 0;
    var last = (st && st.lastRun) || runs[0] || null;

    /* 只有真的抓到过两次以上的条目才有"涨幅"；演示数据没有采样点，标成"新上榜"，不编涨幅 */
    var top = news.slice().map(function (n) {
      var real = (n.history || []).length > 1;
      var tr = real ? W.trendOf(n.history) : { label: 'new', pct: 0, delta: 0 };
      return { n: n, tr: tr, real: real };
    }).sort(function (a, b) {
      if (a.real !== b.real) return a.real ? -1 : 1;
      return (b.tr.pct || 0) - (a.tr.pct || 0);
    }).slice(0, 8);

    root.innerHTML =
      '<div class="view-head"><div><h1>数据看板</h1>' +
        '<p class="sub">抓取、生产、审核三段效率一屏看完。抓取数据来自服务端热点池，生产与审核数据来自本机工作区。</p></div>' +
        '<div class="head-actions"><button class="btn ghost" id="dashRefresh">刷新</button></div></div>' +
      '<div class="stat-row">' +
        card('热点池总量', server ? st.total : news.length, '条', server ? '服务端 data/news.json' : '演示模式 · 仅当前列表', '') +
        card('今日新增', server ? st.today : '—', '条', '首次抓到的时间在今天') +
        card('上升中', server ? st.up : news.filter(function (n) { return n.growth > 20; }).length, '条', '采样点比较最近涨幅 ≥ 8%', 'trend-up') +
        card('最近抓取', last ? timeOf(last.at) : '—', '', last ? ('成功 ' + (last.okSources || 0) + ' / 失败 ' + (last.failedSources || 0) + ' 个来源') : '还没跑过定时抓取', '') +
      '</div>' +
      '<div class="stat-row">' +
        card('已生成文案', m.generated, '版', '工作台单次 + 批量生成合计') +
        card('审核通过率', reviewed ? passRate + '%' : '—', '', reviewed ? ('通过 ' + m.passed + ' / 打回 ' + m.rejected) : '还没有审核记录') +
        card('待审队列', q.wait, '条', '已通过 ' + q.pass + ' · 已发布 ' + q.published) +
        card('已发布', m.published, '条', '审核通过后模拟发送') +
      '</div>' +
      '<div class="split">' +
        '<div class="split-main">' +
          '<div class="card"><div class="card-head"><h3>抓取趋势</h3><span class="hint">最近 ' + Math.min(6, runs.length || 0) + ' 次</span></div>' +
            (runs.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>时间</th><th class="num">新增</th><th class="num">合并重复</th><th>来源</th><th class="num">耗时</th></tr></thead><tbody>' +
              runs.slice(0, 6).map(function (r) {
                return '<tr><td>' + timeOf(r.at) + '</td><td class="num">+' + (r.added || 0) + '</td><td class="num">' + (r.merged || 0) + '</td>' +
                  '<td>成功 ' + (r.okSources || 0) + ' · 失败 ' + (r.failedSources || 0) + ' / 共 ' + (r.sources || []).length + '</td>' +
                  '<td class="num">' + (r.ms || 0) + ' ms</td></tr>';
              }).join('') + '</tbody></table></div>'
              : '<div class="empty-state"><b>还没有抓取记录</b>' + (server ? '服务端启动 3 秒后会先跑一次；也可以在后台「抓取来源」页点「测试全部来源」。' : '当前是演示模式（直接打开文件），没有服务端就不会有定时抓取。启动 node server/server.js 后用 http://localhost:8787 打开。') + '</div>') +
          '</div>' +
          '<div class="card"><div class="card-head"><h3>热点涨得最快</h3><span class="hint">按最近采样涨幅排序</span></div>' +
            (top.length ? '<div class="trend-list">' + top.map(function (x) {
              return '<div class="trend-row"><span class="tr-title">' + esc(x.n.title) + '</span>' +
                bars(x.n.history ? x.n.history.map(function (h) { return h.heat; }) : x.n.spark, x.tr.label) +
                '<span class="tr-tag ' + x.tr.label + '">' + W.trendText(x.tr) + '</span>' +
                '<span class="tr-heat">' + esc(x.n.heat) + '</span></div>';
            }).join('') + '</div>' : '<div class="empty-state">暂无热点</div>') +
          '</div>' +
        '</div>' +
        '<aside class="split-side">' +
          '<div class="card side-card"><div class="side-head"><h3>审核漏斗</h3></div><div class="funnel">' +
            [['待审', q.wait, 'wait'], ['已通过', q.pass, 'doing'], ['已发布', q.published, 'done'], ['已打回', q.rejected, 'hold']].map(function (r) {
              var total = q.total || 1;
              return '<div class="funnel-row"><span>' + r[0] + '</span><div class="funnel-bar"><i class="' + r[2] + '" style="width:' + Math.round(r[1] / total * 100) + '%"></i></div><b>' + r[1] + '</b></div>';
            }).join('') + '</div>' +
            '<div class="help" style="margin-top:10px">返工次数 ' + (m.reworked || 0) + ' 次 · 批量任务 ' + (m.batches || 0) + ' 批 / ' + (m.batchTasks || 0) + ' 条</div>' +
          '</div>' +
          '<div class="card side-card"><div class="side-head"><h3>数据从哪来</h3></div>' +
            '<div class="help info">' + (server
              ? '抓取类指标来自服务端热点池（真实抓取 + 去重 + 每轮热度采样）。生产与审核指标来自本机浏览器的工作区记录。'
              : '当前没有连上服务端，抓取类指标为空；生产与审核指标仍然可用（存在本机浏览器）。') + '</div></div>' +
        '</aside>' +
      '</div>';

    var btn = root.querySelector('#dashRefresh');
    if (btn) btn.addEventListener('click', function () {
      if (HP.AppCtx.refreshServerNews) HP.AppCtx.refreshServerNews().then(function () { render(root); HP.AppCtx.toast('看板已刷新', 'ok'); });
      else render(root);
    });
  }

  HP.Views = HP.Views || {};
  HP.Views.dash = { render: render };
})();