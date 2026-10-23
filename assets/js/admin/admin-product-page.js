/* =========================================================
   后台页面：商品库（只读）
   · 统计：商品总数 / 品类数 / 价格区间 / 平均折扣率
   · 搜索（名称 + 卖点）、按品类筛选、按价格或品类排序
   · 表格视图 / 卡片视图切换；卡片与工作台商品卡同源（HP.Products.cardHtml）
   ========================================================= */
window.HP = window.HP || {};
HP.AdminPages = HP.AdminPages || {};

(function () {
  'use strict';

  function A() { return HP.Admin; }
  function esc(s) { return HP.Products.esc(s); }

  /* 只读页的界面状态 */
  var view = { mode: 'table', keyword: '', cat: '全部', sort: 'default', selected: [] };

  function currentList() {
    return HP.Products.filter(A().getDraft().products || [], {
      keyword: view.keyword, cat: view.cat, sort: view.sort
    });
  }

  function statCards(stats, allCount, from) {
    function card(k, v, d) {
      return '<div class="card-mini"><div class="k">' + esc(k) + '</div>' +
        '<div class="v">' + esc(v) + '</div><div class="d">' + esc(d) + '</div></div>';
    }
    return '<div class="stat-grid">' +
      card('商品总数', stats.total + ' 件', '当前列表；全库共 ' + allCount + ' 件') +
      card('品类数', stats.cats + ' 个', '按品类字段去重统计') +
      card('价格区间', '¥' + stats.minPrice + '–' + stats.maxPrice, '平均售价 ¥' + stats.avgPrice) +
      card('平均折扣率', stats.avgDiscount + '%', '按 (1 − 售价/原价) 计算') +
    '</div>' +
    '<div class="help" style="margin-top:10px">数据来源：<b>' + esc(from) + '</b>（与顶栏徽章一致）' +
      (view.keyword || view.cat !== '全部' ? '；统计随当前筛选结果变化' : '；未筛选时等于整个商品库') + '</div>';
  }

  function tableHtml(list) {
    if (!list.length) return '<div class="empty">没有符合条件的商品，试试换个关键词或放宽筛选。</div>';
    var allChecked = list.length > 0 && list.every(function (p) { return view.selected.indexOf(p.id) > -1; });
    return '<div class="table-scroll"><table class="admin-table"><thead><tr>' +
      '<th style="width:40px"><input type="checkbox" id="prCheckAll" ' + (allChecked ? 'checked' : '') + ' /></th>' +
      '<th>商品</th><th style="width:110px">品类</th><th class="num" style="width:90px">售价</th>' +
      '<th class="num" style="width:90px">原价</th><th class="num" style="width:90px">折扣率</th>' +
      '<th class="num" style="width:90px">近30天</th><th class="num" style="width:80px">库存</th><th>卖点</th>' +
      '<th style="width:80px">操作</th>' +
    '</tr></thead><tbody>' + list.map(function (p) {
      return '<tr><td><input type="checkbox" data-pick="' + esc(p.id) + '" ' + (view.selected.indexOf(p.id) > -1 ? 'checked' : '') + ' /></td>' +
        '<td><div style="display:flex;gap:10px;align-items:center">' +
          '<span class="mini-thumb" style="width:38px;height:38px;border-radius:9px;display:grid;place-items:center;font-size:19px;background:' +
            HP.Products.gradientOf(p) + '">' + esc(p.emoji) + '</span>' +
          '<div><b style="font-size:13px">' + esc(p.name) + '</b>' +
            '<div class="help" style="margin:0">' + esc(p.brand || '—') + ' · ' + esc(p.sku || p.id) + '</div></div></div></td>' +
        '<td class="td-cat"><span class="badge brand">' + esc(p.cat || '未分类') + '</span></td>' +
        '<td class="num td-price">¥' + p.price + '</td>' +
        '<td class="num td-market" style="color:var(--ink-3);text-decoration:line-through">¥' + p.marketPrice + '</td>' +
        '<td class="num td-off">' + HP.Products.discountOf(p) + '%</td>' +
        '<td class="num td-sales">' + HP.Products.fmtNum(p.sales30d) + '</td>' +
        '<td class="num td-stock">' + p.stock + '</td>' +
        '<td class="td-points">' + (p.points || []).map(function (t) { return '<span class="badge gray" style="margin:0 4px 4px 0">' + esc(t) + '</span>'; }).join('') + '</td>' +
        '<td><button class="btn ghost tiny" data-edit="' + esc(p.id) + '">编辑</button></td>' +
      '</tr>';
    }).join('') + '</tbody></table></div>';
  }

  function cardListHtml(list) {
    if (!list.length) return '<div class="empty">没有符合条件的商品，试试换个关键词或放宽筛选。</div>';
    return '<div class="product-grid">' + list.map(function (p) {
      /* 卡片本身与工作台完全一致；编辑入口挂在卡片外层，避免改动卡片结构 */
      return '<div class="card-edit-wrap" data-edit="' + esc(p.id) + '" title="点击编辑这件商品">' +
        '<label class="card-pick" title="选中这件商品"><input type="checkbox" data-pick="' + esc(p.id) + '" ' +
          (view.selected.indexOf(p.id) > -1 ? 'checked' : '') + ' /></label>' +
        HP.Products.cardHtml(p, {}) + '</div>';
    }).join('') + '</div>';
  }

  function paint(ctx) {
    var all = ctx.draft.products || [];
    var list = currentList();
    var statsHost = document.getElementById('prStats');
    var listHost = document.getElementById('prList');
    var countHost = document.getElementById('prCount');
    if (statsHost) statsHost.innerHTML = statCards(HP.Products.stats(list), all.length, HP.Config.sourceLabel());
    if (countHost) {
      countHost.textContent = '当前显示 ' + list.length + ' / ' + all.length + ' 件' +
        (view.keyword ? '（搜索："' + view.keyword + '"）' : '') +
        (view.cat !== '全部' ? '（品类：' + view.cat + '）' : '') +
        '（' + (view.mode === 'card' ? '卡片视图' : '表格视图') + '）';
    }
    if (listHost) listHost.innerHTML = view.mode === 'card' ? cardListHtml(list) : tableHtml(list);
    if (listHost) {
      listHost.querySelectorAll('[data-edit]').forEach(function (el) {
        el.addEventListener('click', function () { openEditor(ctx, el.dataset.edit); });
      });
      listHost.querySelectorAll('[data-pick]').forEach(function (cb) {
        cb.addEventListener('click', function (e) {
          e.stopPropagation();                      // 勾选不算"点卡片编辑"
          var id = cb.dataset.pick, i = view.selected.indexOf(id);
          if (cb.checked && i < 0) view.selected.push(id);
          if (!cb.checked && i > -1) view.selected.splice(i, 1);
          paint(ctx);
        });
      });
      var checkAll = listHost.querySelector('#prCheckAll');
      if (checkAll) {
        checkAll.addEventListener('change', function () {
          if (checkAll.checked) {
            list.forEach(function (p) { if (view.selected.indexOf(p.id) < 0) view.selected.push(p.id); });
          } else {
            view.selected = view.selected.filter(function (id) { return !list.some(function (p) { return p.id === id; }); });
          }
          paint(ctx);
        });
      }
    }
    paintBatchBar(ctx, all, list);
  }

  /* 批量操作栏：选中商品后出现 */
  function paintBatchBar(ctx, allProducts, list) {
    var host = document.getElementById('prBatchBar');
    if (!host) return;
    var n = view.selected.length;
    if (!n) { host.innerHTML = ''; return; }
    var cats = HP.Products.catList(allProducts);
    var refs = view.selected.reduce(function (sum, id) { return sum + HP.Products.refsOf(id, allProducts).preset.length; }, 0);
    host.innerHTML = '<div class="batch-bar">' +
      '<b>已选 ' + n + ' 件</b>' +
      '<span class="help" style="margin:0">其中 ' + refs + ' 处热点推荐引用了这些商品</span>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-left:auto;flex-wrap:wrap">' +
        '<input class="input" id="batchCat" list="batchCats" placeholder="批量改成的品类" style="width:190px" />' +
        '<datalist id="batchCats">' + cats.map(function (c) { return '<option value="' + esc(c) + '"></option>'; }).join('') + '</datalist>' +
        '<button class="btn soft tiny" id="batchSetCat">批量修改品类</button>' +
        '<button class="btn ghost tiny" id="batchDel">批量删除</button>' +
        '<button class="btn ghost tiny" id="batchClear">取消选择</button>' +
      '</div></div>';
    host.querySelector('#batchSetCat').addEventListener('click', function () { batchSetCategory(ctx); });
    host.querySelector('#batchDel').addEventListener('click', function () { askBatchDelete(ctx); });
    host.querySelector('#batchClear').addEventListener('click', function () { view.selected = []; paint(ctx); });
  }

  /* 批量修改品类 */
  function batchSetCategory(ctx) {
    var input = document.getElementById('batchCat');
    var target = (input.value || '').trim();
    if (!target) { A().toast('请先填写要改成的品类（可从已有品类里选，也可以直接输入新品类）', 'warn'); return; }

    var ok = 0, skipped = [];
    view.selected.slice().forEach(function (id) {
      var p = ctx.draft.products.filter(function (x) { return x.id === id; })[0];
      if (!p) { skipped.push(id + '：商品已不存在'); return; }
      if (p.cat === target) { skipped.push(p.name + '：品类本来就是「' + target + '」'); return; }
      p.cat = target;
      ok++;
    });
    ctx.markDirty();
    paint(ctx);
    resultModal('批量修改品类完成',
      '目标品类：<b>' + esc(target) + '</b>',
      ok, skipped,
      '列表与统计已经同步更新；记得点底部「保存配置」写回' + esc(HP.Config.sourceLabel()) + '。');
  }

  /* 批量删除：先做引用检查，再二次确认 */
  function askBatchDelete(ctx) {
    var ids = view.selected.slice();
    var all = ctx.draft.products;
    var picked = ids.map(function (id) { return all.filter(function (p) { return p.id === id; })[0]; }).filter(Boolean);
    if (!picked.length) { A().toast('选中的商品已经不在列表里了', 'warn'); return; }

    if (picked.length >= all.length) {
      A().modal({
        title: '不能清空商品库',
        sub: '删除后商品库会变成空的，工作台将无法匹配任何商品。',
        body: '<div class="help warn">这次批量删除已被拦住。建议至少保留一件商品。</div>',
        actions: [{ label: '知道了', kind: 'primary' }]
      });
      return;
    }

    var refRows = [];
    var refTotal = 0, semTotal = 0;
    picked.forEach(function (p) {
      var r = HP.Products.refsOf(p.id, all);
      refTotal += r.preset.length;
      semTotal += r.semantic.length;
      if (r.preset.length || r.semantic.length) refRows.push({ p: p, r: r });
    });

    var body = '<div class="help danger">即将删除 <b>' + picked.length + '</b> 件商品，删除后需要点「保存配置」才真正生效；这部分操作不可撤销（建议先导出备份）。</div>';
    if (refTotal || semTotal) {
      body += '<div class="help warn" style="margin-top:10px"><b>引用检查：</b>' +
        (refTotal ? '有 ' + refTotal + ' 处热点推荐引用了这些商品，删除后这些推荐会失效。' : '') +
        (semTotal ? (refTotal ? '　' : '') + '另有 ' + semTotal + ' 处语义匹配会带上它们。' : '') +
        '</div>';
      body += '<div class="table-scroll" style="margin-top:8px"><table class="admin-table"><thead><tr>' +
        '<th>商品</th><th style="width:130px">被热点推荐引用</th><th>涉及热点</th></tr></thead><tbody>' +
        refRows.map(function (x) {
          return '<tr><td>' + esc(x.p.name) + '</td>' +
            '<td>' + (x.r.preset.length ? '<b>' + x.r.preset.length + ' 条</b>' : '0 条') +
              (x.r.semantic.length ? '<div class="help" style="margin:0">语义匹配 ' + x.r.semantic.length + ' 条</div>' : '') + '</td>' +
            '<td class="help">' + esc(x.r.preset.concat(x.r.semantic).map(function (n) { return n.title; }).slice(0, 3).join('；')) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    } else {
      body += '<div class="help" style="margin-top:10px">引用检查：这些商品没有被任何热点推荐引用。</div>';
    }

    A().modal({
      title: '确认删除这 ' + picked.length + ' 件商品？',
      sub: '删除是批量操作，确认后会从商品库移除；保存配置后不可恢复。',
      body: body,
      actions: [
        { label: '取消', kind: 'ghost' },
        {
          label: '确认删除', kind: 'primary', handler: function () {
            var ok = 0, skipped = [];
            picked.forEach(function (p) {
              var i = ctx.draft.products.findIndex(function (x) { return x.id === p.id; });
              if (i < 0) { skipped.push(p.name + '：商品已不存在'); return; }
              ctx.draft.products.splice(i, 1);
              ok++;
            });
            view.selected = [];
            ctx.markDirty();
            ctx.rerender();
            resultModal('批量删除完成', '共提交 ' + picked.length + ' 件', ok, skipped,
              '相关热点推荐已同步失效；记得点底部「保存配置」' +
              (refTotal ? '（有 ' + refTotal + ' 处热点推荐因此失效）' : '') + '。');
          }
        }
      ]
    });
  }

  /* 批量操作结果反馈：成功几条、跳过几条及原因 */
  function resultModal(title, sub, okCount, skipped, footer) {
    A().modal({
      title: title,
      sub: sub,
      body: '<div class="ok-note"><span>✓</span><div>成功 <b>' + okCount + '</b> 条' +
        (skipped.length ? '；跳过 <b>' + skipped.length + '</b> 条' : '；跳过 0 条') + '</div></div>' +
        (skipped.length
          ? '<div class="help" style="margin-top:10px">跳过原因：<br />· ' + skipped.map(esc).join('<br />· ') + '</div>'
          : '') +
        (footer ? '<div class="help" style="margin-top:10px">' + footer + '</div>' : ''),
      actions: [{ label: '知道了', kind: 'primary' }]
    });
  }

  /* =========================================================
     导入：先出报告，人决定怎么处理
     ========================================================= */
  function showImportReport(ctx, r) {
    /* 1) 文件本身读不了 / 表头不对 */
    if (r.fatal) {
      A().modal({
        title: '导入失败：文件格式有问题',
        sub: '文件：' + esc(r.fileName || ''),
        body: '<div class="err-note"><span>!</span><div>' + esc(r.fatal).replace(/\n/g, '<br />') + '</div></div>' +
          '<div class="help" style="margin-top:10px">原有商品库没有受到任何影响。</div>',
        actions: [{ label: '知道了', kind: 'primary' }]
      });
      return;
    }

    var total = r.totalRows || (r.items.length + r.rowErrors.length);
    var preview = '<div class="table-scroll" style="margin-top:10px;max-height:260px"><table class="admin-table"><thead><tr>' +
      '<th style="width:52px">行</th><th>名称</th><th class="num">售价</th><th class="num">原价</th><th>品类</th><th>卖点</th><th>图标</th>' +
      '</tr></thead><tbody>' +
      r.items.slice(0, 50).map(function (p, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + esc(p.name) + '</td><td class="num">' + p.price + '</td>' +
          '<td class="num">' + p.marketPrice + '</td><td>' + esc(p.cat) + '</td>' +
          '<td>' + esc((p.points || []).join('、')) + '</td><td>' + esc(p.emoji) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (r.items.length > 50 ? '<div class="help">（仅预览前 50 行，共 ' + r.items.length + ' 行可导入）</div>' : '');

    /* 2) 有问题的行：列出全部问题 → 由人决定 */
    if (!r.ok) {
      var list = r.rowErrors.map(function (e) {
        return '<li style="margin-bottom:4px"><b>第 ' + e.row + ' 行</b>（' + esc(e.name) + '）：' + esc(e.reasons.join('；')) + '</li>';
      }).join('');
      A().modal({
        title: '导入前校验没有通过，尚未写入任何数据',
        sub: '文件：' + esc(r.fileName || '') + '　共 ' + total + ' 行，其中 <b>' + r.rowErrors.length + '</b> 行有问题',
        body: '<div class="err-note"><span>!</span><div>导入已阻止，原有商品库未受影响。修好文件后可以重新导入，' +
            '也可以选择"只导入通过校验的行"。</div></div>' +
          '<div class="help" style="margin-top:10px;max-height:200px;overflow:auto"><ul style="margin:0;padding-left:16px">' + list + '</ul></div>' +
          (r.items.length ? preview : '<div class="help" style="margin-top:10px">没有任何一行通过校验。</div>'),
        actions: [
          { label: '取消，我去改文件', kind: 'ghost' },
          r.items.length ? {
            label: '仅导入通过校验的 ' + r.items.length + ' 行', kind: 'primary',
            handler: function () { askImportMode(ctx, r, r.items.length + ' 行（跳过有问题的 ' + r.rowErrors.length + ' 行）'); }
          } : null
        ].filter(Boolean)
      });
      return;
    }

    /* 3) 全部通过 */
    A().modal({
      title: '导入前校验通过',
      sub: '文件：' + esc(r.fileName || '') + '　共 ' + total + ' 行，全部通过校验',
      body: '<div class="ok-note"><span>✓</span><div>可以导入 <b>' + r.items.length + '</b> 行' +
        (r.warnings && r.warnings.length ? '；有 ' + r.warnings.length + ' 条提醒（不影响导入）' : '') + '</div></div>' +
        (r.warnings && r.warnings.length ? '<div class="help" style="margin-top:8px">' + esc(r.warnings.slice(0, 5).join('；')) + '</div>' : '') +
        preview,
      actions: [
        { label: '取消', kind: 'ghost' },
        { label: '导入并替换商品库', kind: 'primary', handler: function () { askImportMode(ctx, r, total + ' 行（全覆盖）', 'replace'); } }
      ]
    });
  }

  /* 选择导入方式：替换 / 追加 */
  function askImportMode(ctx, r, label, presetMode) {
    function doImport(mode) {
      var assigned = HP.Products.assignIds(r.items, ctx.draft.products, mode);
      if (mode === 'replace') ctx.draft.products = assigned;
      else ctx.draft.products = ctx.draft.products.concat(assigned);
      view.selected = [];
      ctx.markDirty();
      ctx.rerender();
      A().modal({
        title: '导入完成',
        sub: '文件：' + esc(r.fileName || '') + '　方式：' + (mode === 'replace' ? '替换整个商品库' : '追加到现有商品库'),
        body: '<div class="ok-note"><span>✓</span><div>成功导入 <b>' + assigned.length + '</b> 条' +
          (r.rowErrors && r.rowErrors.length ? '；跳过 <b>' + r.rowErrors.length + '</b> 条（校验没通过）' : '；跳过 0 条') + '</div></div>' +
          '<div class="help" style="margin-top:10px">商品库现在共 ' + ctx.draft.products.length + ' 件。' +
          '导入只写入编辑区，<b>还没保存到 ' + esc(HP.Config.sourceLabel()) + '</b>，确认无误后点底部「保存配置」。</div>' +
          (r.rowErrors && r.rowErrors.length
            ? '<div class="help" style="margin-top:8px">被跳过的行：' + esc(r.rowErrors.map(function (e) { return '第 ' + e.row + ' 行'; }).join('、')) + '</div>'
            : ''),
        actions: [{ label: '稍后保存', kind: 'ghost' }, { label: '立即保存', kind: 'primary', handler: function () { A().saveConfig(); } }]
      });
    }
    if (presetMode) { doImport(presetMode); return; }
    A().modal({
      title: '怎么导入这 ' + r.items.length + ' 行？',
      sub: '合计 ' + label,
      body: '<div class="help">' +
        '<b>替换整个商品库</b>：用文件内容覆盖现有 ' + ctx.draft.products.length + ' 件商品（同名的会沿用原编号）。<br />' +
        '<b>追加到现有商品库</b>：保留现有商品，新商品自动分配不重复编号。' +
        '</div>',
      actions: [
        { label: '取消', kind: 'ghost' },
        { label: '追加到现有商品库', kind: 'ghost', handler: function () { doImport('append'); } },
        { label: '替换整个商品库', kind: 'primary', handler: function () { doImport('replace'); } }
      ]
    });
  }

  HP.AdminPages.products = {
    key: 'products', name: '商品库', icon: '4',
    title: '商品库',
    subtitle: '商品库从代码里搬到后台由运营维护。本段先做只读浏览：统计、搜索、筛选、排序，以及表格 / 卡片两种视图。',
    sections: [
      {
        id: 'sec-pr-stats', short: '统计概览',
        title: '统计概览',
        desc: '商品总数、品类数、价格区间与平均折扣率，按当前列表实时计算。',
        render: function () { return '<div id="prStats"></div>'; },
        mount: function (body, ctx) { paint(ctx); }
      },
      {
        id: 'sec-pr-filter', short: '搜索与视图',
        title: '搜索、筛选与视图',
        desc: '支持按名称与卖点搜索、按品类筛选、按价格或品类排序；表格视图与卡片视图可切换。',
        actions: '<button class="btn soft tiny" id="addProduct">+ 新增商品</button>',
        render: function (ctx) {
          var all = A().getDraft().products || [];
          var cats = ['全部'].concat(HP.Products.catList(all));
          return '<div class="row" style="align-items:flex-end">' +
              '<div class="col"><label class="label">搜索 <em>名称 / 卖点 / 品牌 / SKU</em></label>' +
                '<input class="input" id="prKeyword" value="' + esc(view.keyword) + '" placeholder="试试搜卖点里的词，例如「加绒」" /></div>' +
              '<div class="col narrow"><label class="label">品类</label>' +
                '<select class="select" id="prCat">' + cats.map(function (c) {
                  return '<option value="' + esc(c) + '"' + (c === view.cat ? ' selected' : '') + '>' + esc(c) + '</option>';
                }).join('') + '</select></div>' +
              '<div class="col narrow"><label class="label">排序</label>' +
                '<select class="select" id="prSort">' + HP.Products.SORTS.map(function (s) {
                  return '<option value="' + s.id + '"' + (s.id === view.sort ? ' selected' : '') + '>' + esc(s.name) + '</option>';
                }).join('') + '</select></div>' +
              '<div class="col narrow"><label class="label">视图</label>' +
                '<div class="seg" id="prViewSeg">' +
                  '<button data-view="table" class="' + (view.mode === 'table' ? 'active' : '') + '">表格</button>' +
                  '<button data-view="card" class="' + (view.mode === 'card' ? 'active' : '') + '">卡片</button>' +
                '</div></div>' +
            '</div>' +
            '<div class="help" id="prCount" style="margin-top:10px"></div>';
        },
        mount: function (body, ctx) {
          body.querySelector('#prKeyword').addEventListener('input', function (e) {
            view.keyword = e.target.value;
            paint(ctx);
          });
          body.querySelector('#prCat').addEventListener('change', function (e) {
            view.cat = e.target.value;
            paint(ctx);
          });
          body.querySelector('#prSort').addEventListener('change', function (e) {
            view.sort = e.target.value;
            paint(ctx);
          });
          body.querySelectorAll('#prViewSeg button').forEach(function (b) {
            b.addEventListener('click', function () {
              view.mode = b.dataset.view;
              body.querySelectorAll('#prViewSeg button').forEach(function (x) {
                x.classList.toggle('active', x === b);
              });
              paint(ctx);
            });
          });
          var addBtn = document.getElementById('addProduct');
          if (addBtn) addBtn.addEventListener('click', function () { openEditor(ctx, null); });
        }
      },
      {
        id: 'sec-pr-list', short: '商品列表',
        title: '商品列表',
        desc: '卡片视图与工作台里的商品卡用的是同一段渲染代码：同样的图标、渐变底色、品类徽章、卖点标签、价格与划线价。',
        render: function () { return '<div id="prBatchBar"></div><div id="prList"></div>'; },
        mount: function (body, ctx) { paint(ctx); }
      },
      {
        id: 'sec-pr-io', short: '导入导出',
        title: '导入与导出',
        desc: '两种格式：结构化数据文件（JSON，适合备份迁移，完整保真）与表格文件（CSV，适合用表格软件批量编辑）。导入前先逐行校验，有问题的行会列出行号和原因，由你决定怎么处理。',
        actions: '<button class="btn ghost tiny" data-tpl="products">填写模板</button>',
        render: function () {
          return '<div class="row">' +
              '<div class="col"><label class="label">导出</label>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                  '<button class="btn ghost tiny" id="prExpJson">导出结构化数据（JSON）</button>' +
                  '<button class="btn ghost tiny" id="prExpCsv">导出表格文件（CSV）</button>' +
                '</div>' +
                '<div class="help">CSV 表头固定为：名称、售价、原价、品类、卖点、图标；卖点用顿号分隔；含逗号或引号的字段会自动加引号包裹，并带 BOM，Excel / WPS 打开不乱码。</div></div>' +
              '<div class="col"><label class="label">导入</label>' +
                '<input type="file" id="prFile" accept=".json,.csv,text/csv,application/json" class="input" style="padding:6px" />' +
                '<div class="help">支持 JSON 与 CSV。导入前会逐行校验：必填项缺失、价格非法、格式不对都会被列出来。</div></div>' +
            '</div>';
        },
        mount: function (body, ctx) {
          body.querySelector('#prExpJson').addEventListener('click', function () {
            A().download('hotpulse-products-' + A().stamp() + '.json', HP.Products.toJSON(ctx.draft.products), 'application/json;charset=utf-8');
            A().toast('已导出结构化数据（' + ctx.draft.products.length + ' 件）', 'ok');
          });
          body.querySelector('#prExpCsv').addEventListener('click', function () {
            A().download('hotpulse-products-' + A().stamp() + '.csv', HP.Products.toCSV(ctx.draft.products), 'text/csv;charset=utf-8');
            A().toast('已导出表格文件（' + ctx.draft.products.length + ' 件），可直接用 Excel / WPS 打开', 'ok');
          });
          body.querySelector('#prFile').addEventListener('change', function (e) {
            var file = e.target.files[0];
            e.target.value = '';
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function () {
              var text = String(reader.result);
              var isCsv = /\.csv$/i.test(file.name);
              var result = isCsv
                ? HP.Products.importCSV(text, ctx.draft.products)
                : HP.Products.importJSON(text, ctx.draft.products);
              result.fileName = file.name;
              result.isCsv = isCsv;
              showImportReport(ctx, result);
            };
            reader.readAsText(file, 'utf-8');
          });
        }
      }
    ]
  };

  /* =========================================================
     新增 / 编辑商品：弹窗 + 实时预览卡片 + 逐字段校验
     ========================================================= */
  var EMOJI_POOL = ['🧥', '👕', '👖', '👗', '👟', '🧣', '🧤', '🧦', '🛏️', '🛋️', '🕯️', '🧹',
    '🍵', '🥤', '🍯', '🍐', '🫖', '🍱', '🔥', '💡', '🔌', '🔋', '📱', '⌨️',
    '🖱️', '💽', '🎧', '📷', '🧖', '🧴', '👁️', '🪑', '⛺', '🎒', '🧳', '🛍️'];

  function blankProduct(all) {
    return {
      id: HP.Products.nextId(all),
      name: '', brand: '', cat: '', sku: '',
      price: 0, marketPrice: 0,
      stock: 800, sales30d: 1500, conversion: 4.5, rating: 4.8,
      emoji: '🛍️', gradient: 'indigo', points: []
    };
  }

  function editorHtml(ctx, work, isNew) {
    var cats = HP.Products.catList(ctx.draft.products);
    return '<div class="row" style="align-items:flex-start">' +
      '<div class="col" style="flex:1.15">' +
        '<div class="row">' +
          '<div class="col narrow"><label class="label">编号 <em>' + (isNew ? '自动生成' : '不可修改') + '</em></label>' +
            '<input class="input" id="f-id" value="' + esc(work.id) + '" readonly />' +
            '<div class="field-error" id="e-id" hidden></div></div>' +
          '<div class="col"><label class="label">名称 <em>必填</em></label>' +
            '<input class="input" id="f-name" value="' + esc(work.name) + '" placeholder="例如：三合一防风冲锋衣 加绒可拆内胆" />' +
            '<div class="field-error" id="e-name" hidden></div></div>' +
        '</div>' +
        '<div class="row" style="margin-top:12px">' +
          '<div class="col narrow"><label class="label">售价 <em>大于 0</em></label>' +
            '<input class="input" id="f-price" type="number" min="0" step="0.01" value="' + work.price + '" />' +
            '<div class="field-error" id="e-price" hidden></div></div>' +
          '<div class="col narrow"><label class="label">原价 <em>不低于售价</em></label>' +
            '<input class="input" id="f-market" type="number" min="0" step="0.01" value="' + work.marketPrice + '" />' +
            '<div class="field-error" id="e-market" hidden></div></div>' +
          '<div class="col narrow"><label class="label">折扣率 <em>实时计算</em></label>' +
            '<input class="input" id="f-off" value="—" readonly /></div>' +
          '<div class="col narrow"><label class="label">品类 <em>可选可填新</em></label>' +
            '<input class="input" id="f-cat" list="catOptions" value="' + esc(work.cat) + '" placeholder="如：服饰鞋包" />' +
            '<datalist id="catOptions">' + cats.map(function (c) { return '<option value="' + esc(c) + '"></option>'; }).join('') + '</datalist>' +
            '<div class="field-error" id="e-cat" hidden></div></div>' +
        '</div>' +
        '<div style="margin-top:12px"><label class="label">卖点 <em>回车添加、点 × 删除；建议 2–4 个</em></label>' +
          '<div class="tag-editor" id="pointEditor"></div>' +
          '<div class="field-error" id="e-points" hidden></div></div>' +
        '<div style="margin-top:12px"><label class="label">图标 <em>点选常用电商表情，也可以手动输入</em></label>' +
          '<input class="input" id="f-emoji" value="' + esc(work.emoji) + '" style="max-width:120px;font-size:18px" />' +
          '<div class="emoji-grid" id="emojiGrid">' + EMOJI_POOL.map(function (e) {
            return '<button type="button" class="emoji-btn' + (e === work.emoji ? ' active' : '') + '" data-emoji="' + e + '">' + e + '</button>';
          }).join('') + '</div>' +
          '<div class="field-error" id="e-emoji" hidden></div></div>' +
        '<div style="margin-top:12px"><label class="label">背景渐变 <em>选中即时反映到右侧预览卡片</em></label>' +
          '<div class="grad-grid" id="gradGrid">' + HP.Config.GRADIENT_KEYS.map(function (k) {
            return '<button type="button" class="grad-btn' + (k === work.gradient ? ' active' : '') + '" data-grad="' + k +
              '" style="background:' + HP.Config.GRADIENTS[k] + '" title="' + k + '"></button>';
          }).join('') + '</div></div>' +
        '<details style="margin-top:12px"><summary class="help" style="cursor:pointer">更多字段（选填：品牌 / SKU / 库存 / 销量 / 转化率 / 评分）</summary>' +
          '<div class="row" style="margin-top:10px">' +
            '<div class="col narrow"><label class="label">品牌</label><input class="input" id="f-brand" value="' + esc(work.brand) + '" /></div>' +
            '<div class="col narrow"><label class="label">SKU</label><input class="input" id="f-sku" value="' + esc(work.sku) + '" /></div>' +
            '<div class="col narrow"><label class="label">库存</label><input class="input" id="f-stock" type="number" min="0" value="' + work.stock + '" /></div>' +
            '<div class="col narrow"><label class="label">近30天销量</label><input class="input" id="f-sales" type="number" min="0" value="' + work.sales30d + '" /></div>' +
            '<div class="col narrow"><label class="label">转化率 %</label><input class="input" id="f-conv" type="number" min="0" step="0.1" value="' + work.conversion + '" /></div>' +
            '<div class="col narrow"><label class="label">评分</label><input class="input" id="f-rating" type="number" min="0" max="5" step="0.1" value="' + work.rating + '" /></div>' +
          '</div></details>' +
      '</div>' +
      '<div class="col" style="flex:0 0 320px;position:sticky;top:0">' +
        '<label class="label">实时预览 <em>改哪一项立刻变化</em></label>' +
        '<div id="editorPreview"></div>' +
        '<div class="help" style="margin-top:8px">这张卡与工作台里的商品卡是同一段渲染代码，所见即所得。</div>' +
      '</div>' +
    '</div>';
  }

  function readEditor(m, work) {
    function val(id) { var el = m.querySelector('#' + id); return el ? el.value : ''; }
    function num(id) { var v = val(id); return v === '' ? 0 : Number(v); }
    work.name = val('f-name').trim();
    work.brand = val('f-brand').trim();
    work.sku = val('f-sku').trim();
    work.cat = val('f-cat').trim();
    work.price = num('f-price');
    work.marketPrice = num('f-market');
    work.stock = num('f-stock');
    work.sales30d = num('f-sales');
    work.conversion = num('f-conv');
    work.rating = num('f-rating');
    work.emoji = val('f-emoji').trim() || '🛍️';
    var off = HP.Products.discountOf(work);
    var offEl = m.querySelector('#f-off');
    if (offEl) offEl.value = off > 0 ? off + '%' : '—';
    return work;
  }

  function validateEditor(m, work, ctx, isNew) {
    var errors = [];
    function err(fieldId, msg) {
      var box = m.querySelector('#e-' + fieldId);
      if (box) {
        box.hidden = !msg;
        box.textContent = msg || '';
      }
      var input = m.querySelector('#f-' + fieldId) || (fieldId === 'points' ? m.querySelector('#pointEditor') : null);
      if (input) input.classList.toggle('invalid', !!msg);
      if (msg) errors.push(msg);
    }

    err('name', work.name ? '' : '名称必填，不能为空');
    var dup = isNew && ctx.draft.products.some(function (p) { return p.id === work.id; });
    err('id', !work.id ? '编号不能为空' : (dup ? '编号 ' + work.id + ' 已存在，请换一个（编号不能重复）' : ''));
    err('cat', work.cat ? '' : '品类不能为空：可以从已有品类里选，也可以直接输入新的');

    err('price', work.price > 0 ? '' : '售价必须是大于 0 的数字（当前：' + (work.price || '空') + '）');
    var marketMsg = !(work.marketPrice > 0)
      ? '原价必须是大于 0 的数字（当前：' + (work.marketPrice || '空') + '）'
      : (work.marketPrice < work.price
        ? '原价 ' + work.marketPrice + ' 低于售价 ' + work.price + '，保存被拦住：请把原价调高到不低于售价（例如 ¥' + work.price + '）'
        : '');
    err('market', marketMsg);

    var pts = (work.points || []).filter(function (t) { return String(t).trim(); });
    var ptMsg = !pts.length ? '至少要写 1 个卖点（建议 2–4 个）'
      : (pts.length > 6 ? '卖点有 ' + pts.length + ' 个，太多了，建议精简到 2–4 个' : '');
    err('points', ptMsg);

    var emojiMsg = work.emoji ? '' : '图标不能为空（可从快捷面板选，或手动输入一个 emoji）';
    err('emoji', emojiMsg);

    return errors;
  }

  function openEditor(ctx, pid) {
    var isNew = !pid;
    var existing = isNew ? null : ctx.draft.products.filter(function (p) { return p.id === pid; })[0];
    var work = isNew ? blankProduct(ctx.draft.products) : JSON.parse(JSON.stringify(existing));
    var ui = { touched: false };            // 首次点保存后才开始显示字段错误

    A().modal({
      title: isNew ? '新增商品' : '编辑商品 · ' + existing.name,
      sub: '右侧预览卡片与工作台里的商品卡同源，改哪一项都会立刻反映出来。校验不通过时会在对应字段下方给出具体原因。',
      wide: true,
      body: editorHtml(ctx, work, isNew),
      dismissable: false,
      actions: [
        { label: '取消', kind: 'ghost' },
        {
          label: isNew ? '保存新增' : '保存修改', kind: 'primary',
          handler: function (m) {
            readEditor(m, work);
            ui.touched = true;
            var errors = validateEditor(m, work, ctx, isNew);
            if (errors.length) {
              A().toast('还有 ' + errors.length + ' 项没填对，请看字段下方的提示', 'warn');
              return false;
            }
            if (isNew) {
              ctx.draft.products.push(work);
            } else {
              var i = ctx.draft.products.findIndex(function (p) { return p.id === pid; });
              ctx.draft.products[i] = work;
            }
            ctx.markDirty();
            ctx.rerender();
            A().toast((isNew ? '已新增商品：' : '已更新商品：') + work.name + '（还没保存到 ' +
              HP.Config.sourceLabel() + '，记得点底部「保存配置」）', 'ok');
          }
        }
      ],
      onMount: function (m) {
        var preview = m.querySelector('#editorPreview');
        function repaint() {
          readEditor(m, work);
          preview.innerHTML = HP.Products.cardHtml(work, {});
          /* 刚打开时不急着报错；点过一次保存后就实时校验，改对了错误立即消失 */
          if (ui.touched) validateEditor(m, work, ctx, isNew);
        }
        /* 每改一项：更新数值 → 重画预览 → 重新校验 */
        ['f-name', 'f-price', 'f-market', 'f-cat', 'f-brand', 'f-sku', 'f-stock', 'f-sales', 'f-conv', 'f-rating', 'f-emoji'].forEach(function (id) {
          var el = m.querySelector('#' + id);
          if (el) el.addEventListener('input', repaint);
        });
        m.querySelectorAll('[data-emoji]').forEach(function (b) {
          b.addEventListener('click', function () {
            work.emoji = b.dataset.emoji;
            m.querySelector('#f-emoji').value = work.emoji;
            m.querySelectorAll('[data-emoji]').forEach(function (x) { x.classList.toggle('active', x === b); });
            repaint();
          });
        });
        m.querySelectorAll('[data-grad]').forEach(function (b) {
          b.addEventListener('click', function () {
            work.gradient = b.dataset.grad;
            m.querySelectorAll('[data-grad]').forEach(function (x) { x.classList.toggle('active', x === b); });
            repaint();
          });
        });
        /* 卖点：回车添加、点 × 删除 */
        var box = m.querySelector('#pointEditor');
        function paintPoints() {
          box.innerHTML = (work.points || []).map(function (t, i) {
            return '<span class="tag-pill">' + esc(t) + '<button type="button" data-delpoint="' + i + '">×</button></span>';
          }).join('') + '<input id="pointInput" placeholder="输入卖点后回车添加" />';
          box.querySelectorAll('[data-delpoint]').forEach(function (b) {
            b.addEventListener('click', function () {
              work.points.splice(Number(b.dataset.delpoint), 1);
              paintPoints(); repaint();
              var ni = box.querySelector('#pointInput'); if (ni) ni.focus();
            });
          });
          var input = box.querySelector('#pointInput');
          input.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            var v = input.value.trim();
            if (!v) return;
            work.points.push(v);
            input.value = '';
            paintPoints(); repaint();
            var ni = box.querySelector('#pointInput'); if (ni) ni.focus();
          });
        }
        paintPoints();
        repaint();
      }
    });
  }
})();
