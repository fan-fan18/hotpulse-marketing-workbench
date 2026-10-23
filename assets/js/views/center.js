/* =========================================================
   内容中心：选题池 + 月度排期
   数据来自 HP.Workspace（本机持久化），新增入口在工作台 Step 1
   ========================================================= */
(function () {
  'use strict';
  var HP = window.HP;
  var W = HP.Workflow;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var STATUS_CLS = { '待办': 'wait', '进行中': 'doing', '已发': 'done', '搁置': 'hold' };

  var view = { month: null, status: '全部', keyword: '' };
  function monthOf(d) { var x = d || new Date(); return { y: x.getFullYear(), m: x.getMonth() + 1 }; }

  function card(k, v, unit, d, cls) {
    return '<div class="stat-card"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) +
      (unit ? '<small>' + esc(unit) + '</small>' : '') + '</div><div class="d ' + (cls || '') + '">' + esc(d) + '</div></div>';
  }
  function statsHtml(pool) {
    var s = { '待办': 0, '进行中': 0, '已发': 0, '搁置': 0 };
    pool.forEach(function (x) { s[x.status] = (s[x.status] || 0) + 1; });
    var ym = view.month.y + '-' + (view.month.m < 10 ? '0' : '') + view.month.m;
    var thisMonth = pool.filter(function (x) { return (x.planDate || '').slice(0, 7) === ym; }).length;
    var dup = {};
    pool.forEach(function (x) { dup[x.newsId] = (dup[x.newsId] || 0) + 1; });
    var dupCount = Object.keys(dup).filter(function (k) { return dup[k] > 1; }).length;
    return [
      card('选题总数', pool.length, '条', '全部状态合计'),
      card('待办 / 进行中', s['待办'] + ' / ' + s['进行中'], '条', '还没排上 / 正在做', 'trend-up'),
      card('本月已排期', thisMonth, '条', view.month.y + ' 年 ' + view.month.m + ' 月'),
      card('同热点重复', dupCount, '组', '同一热点排了多次，注意角度撞车', dupCount ? 'trend-warn' : '')
    ].join('');
  }

  function calHtml(pool) {
    var cal = W.calendar(pool, view.month.y, view.month.m);
    var today = W.dayKey(new Date());
    var head = ['一', '二', '三', '四', '五', '六', '日'].map(function (d) { return '<div class="cal-dow">' + d + '</div>'; }).join('');
    var body = cal.weeks.map(function (week) {
      return week.map(function (cell) {
        var items = cell.items.slice(0, 2).map(function (it) {
          return '<span class="cal-item ' + (STATUS_CLS[it.status] || '') + '" data-pool="' + esc(it.id) + '" title="' + esc(it.title) + '">' + esc(it.title.slice(0, 8)) + '</span>';
        }).join('');
        var more = cell.items.length > 2 ? '<span class="cal-more">+' + (cell.items.length - 2) + '</span>' : '';
        return '<div class="cal-cell' + (cell.inMonth ? '' : ' out') + (cell.date === today ? ' today' : '') + '" data-date="' + cell.date + '">' +
          '<span class="cal-day">' + cell.day + '</span>' + items + more + '</div>';
      }).join('');
    }).join('');
    return '<div class="cal-head"><button class="btn ghost sm" id="calPrev">‹</button>' +
      '<b id="calLabel">' + cal.label + '</b>' +
      '<button class="btn ghost sm" id="calNext">›</button>' +
      '<button class="btn ghost sm" id="calToday">回到本月</button></div>' +
      '<div class="cal-grid">' + head + body + '</div>';
  }

  function listHtml(pool) {
    var list = W.filterPool(pool, { status: view.status, keyword: view.keyword });
    if (!list.length) return '<div class="empty-state"><b>还没有选题</b>去工作台 Step 1 挑一条热点，点「加入选题池」就会出现在这里。</div>';
    var rows = list.map(function (x) {
      var sameNews = pool.filter(function (y) { return y.newsId === x.newsId; }).length;
      return '<tr data-row="' + esc(x.id) + '">' +
        '<td><div class="pool-title"><b>' + esc(x.title) + '</b><i>' + esc(x.cat || '—') + ' · ' + esc(x.source || '—') + ' · 热度 ' + esc(x.heat || '—') + '</i></div></td>' +
        '<td><span class="state-pill ' + (STATUS_CLS[x.status] || 'wait') + '">' + esc(x.status) + '</span>' +
          (sameNews > 1 ? '<span class="dup-flag" title="同一条热点在池子里出现 ' + sameNews + ' 次">同热点 ×' + sameNews + '</span>' : '') + '</td>' +
        '<td><input type="date" class="text-input sm" data-date-input="' + esc(x.id) + '" value="' + esc(x.planDate || '') + '" /></td>' +
        '<td class="num">' + esc(x.note || '—') + '</td>' +
        '<td class="col-act"><button class="btn ghost tiny" data-advance="' + esc(x.id) + '">推进</button>' +
          '<button class="btn ghost tiny" data-open="' + esc(x.id) + '">去工作台</button>' +
          '<button class="btn ghost tiny danger" data-del="' + esc(x.id) + '">删除</button></td>' +
        '</tr>';
    }).join('');
    return '<div class="table-wrap"><table class="table pool-table"><thead><tr>' +
      '<th>选题</th><th>状态</th><th>计划日期</th><th class="num">备注</th><th class="col-act">操作</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function render(root) {
    var pool = HP.Workspace.pool();
    if (!view.month) view.month = monthOf(new Date());
    root.innerHTML =
      '<div class="view-head"><div><h1>内容中心</h1>' +
        '<p class="sub">把值得做的热点先放进选题池，按日期排好，避免同一条热点被反复借势、角度撞车。</p></div>' +
        '<div class="head-actions"><button class="btn primary" id="centerGoNews">去挑热点</button></div></div>' +
      '<div class="stat-row">' + statsHtml(pool) + '</div>' +
      '<div class="split">' +
        '<div class="split-main">' +
          '<div class="card"><div class="card-head"><h3>排期日历</h3><span class="hint">点日历里的选题可跳到列表</span></div>' + calHtml(pool) + '</div>' +
          '<div class="card"><div class="card-head"><h3>选题列表 <em class="count-inline">' + pool.length + ' 条</em></h3>' +
            '<div class="pool-tools"><input class="text-input sm" id="poolSearch" placeholder="搜标题 / 品类 / 备注" value="' + esc(view.keyword) + '" />' +
            '<div class="seg" id="poolStatusSeg">' + ['全部'].concat(W.POOL_STATUS).map(function (s) {
              return '<button data-st="' + esc(s) + '" class="' + (view.status === s ? 'active' : '') + '">' + esc(s) + '</button>';
            }).join('') + '</div></div></div>' + listHtml(pool) + '</div>' +
        '</div>' +
        '<aside class="split-side">' +
          '<div class="card side-card"><div class="side-head"><h3>状态分布</h3></div><div class="funnel" id="poolFunnel">' +
            W.POOL_STATUS.map(function (s) {
              var n = pool.filter(function (x) { return x.status === s; }).length;
              var pct = pool.length ? Math.round(n / pool.length * 100) : 0;
              return '<div class="funnel-row"><span>' + esc(s) + '</span><div class="funnel-bar"><i class="' + (STATUS_CLS[s] || '') + '" style="width:' + pct + '%"></i></div><b>' + n + '</b></div>';
            }).join('') + '</div></div>' +
          '<div class="card side-card"><div class="side-head"><h3>排期建议</h3></div>' +
            '<div class="help info">同一条热点在 7 天内重复排期时，列表会标「同热点 ×N」。建议换个角度或换商品，避免自己跟自己抢流量。</div></div>' +
        '</aside>' +
      '</div>';
    wire(root);
  }

  function wire(root) {
    var pool = HP.Workspace.pool();
    var go = function (n) { if (HP.AppCtx && HP.AppCtx.goStep) HP.AppCtx.goStep(n); };
    root.querySelector('#centerGoNews').addEventListener('click', function () { go(1); });
    root.querySelector('#calPrev').addEventListener('click', function () {
      view.month.m--; if (view.month.m < 1) { view.month.m = 12; view.month.y--; } render(root);
    });
    root.querySelector('#calNext').addEventListener('click', function () {
      view.month.m++; if (view.month.m > 12) { view.month.m = 1; view.month.y++; } render(root);
    });
    root.querySelector('#calToday').addEventListener('click', function () { view.month = monthOf(new Date()); render(root); });
    root.querySelectorAll('#poolStatusSeg button').forEach(function (b) {
      b.addEventListener('click', function () { view.status = b.dataset.st; render(root); });
    });
    var search = root.querySelector('#poolSearch');
    search.addEventListener('input', function () {
      view.keyword = search.value;
      render(root);
      var s2 = root.querySelector('#poolSearch');
      s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length);
    });
    root.querySelectorAll('[data-pool]').forEach(function (el) {
      el.addEventListener('click', function () {
        var row = root.querySelector('[data-row="' + el.dataset.pool + '"]');
        if (row) { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); row.classList.add('flash'); setTimeout(function () { row.classList.remove('flash'); }, 1200); }
      });
    });
    root.querySelectorAll('[data-advance]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.advance;
        var it = pool.find(function (x) { return x.id === id; });
        if (!it) return;
        var order = ['待办', '进行中', '已发'];
        var idx = order.indexOf(it.status);
        var nextStatus = idx < 0 ? '待办' : order[Math.min(order.length - 1, idx + 1)];
        HP.Workspace.setPoolStatus(id, nextStatus);
        HP.AppCtx.toast('「' + it.title.slice(0, 12) + '…」状态改为 ' + nextStatus, 'ok');
        render(root);
      });
    });
    root.querySelectorAll('[data-open]').forEach(function (b) {
      b.addEventListener('click', function () {
        var it = pool.find(function (x) { return x.id === b.dataset.open; });
        if (it && HP.AppCtx.selectNewsById) HP.AppCtx.selectNewsById(it.newsId);
      });
    });
    root.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var it = pool.find(function (x) { return x.id === b.dataset.del; });
        HP.AppCtx.confirm('从选题池移除？', '「' + esc(it.title) + '」将从排期里移除，不影响已经生成的文案。', '移除', function () {
          HP.Workspace.removePool(it.id);
          HP.AppCtx.toast('已从选题池移除', '');
          render(root);
        });
      });
    });
    root.querySelectorAll('[data-date-input]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        HP.Workspace.updatePool(inp.dataset.dateInput, { planDate: inp.value });
        HP.AppCtx.toast('排期已改为 ' + (inp.value || '未排期'), 'ok');
        render(root);
      });
    });
  }

  HP.Views = HP.Views || {};
  HP.Views.center = { render: render, view: view };
})();