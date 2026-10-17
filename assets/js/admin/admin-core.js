/* =========================================================
   HP.Admin —— 后台外壳
   顶栏（标识 / 数据来源徽章 / 返回工作台）
   左侧两组导航（本页配置区块 + 其它后台页面）
   内容区卡片式分节（每节标题 + 一句说明）
   底部固定操作栏（保存等主操作，滚动时不消失）
   ========================================================= */
window.HP = window.HP || {};

(function () {
  'use strict';

  var A = { pages: {}, order: [], draft: null, page: 'overview', dirty: false, saving: false };

  /* 分区块恢复默认：sectionKey → 中文名（用于确认提示） */
  var SECTION_LABEL = {
    prompt: '提示词与模板', styles: '创作风格', tones: '语调预设', model: '模型与接入',
    limits: '生成与校验阈值', products: '商品库', sources: '抓取来源',
    evalConfig: '评测设置', riskRules: '风险识别规则'
  };
  function sectionLabel(key) { return SECTION_LABEL[key] || key; }
  var leaveGuard = { allow: false };

  /* ---------------- 基础工具 ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function toast(msg, type) {
    var wrap = $('#toastWrap');
    var t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.innerHTML = '<span class="ti">' + (type === 'warn' ? '!' : type === 'ok' ? '✓' : 'i') + '</span><span>' + esc(msg) + '</span>';
    wrap.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 260); }, 2600);
  }

  function modal(opt) {
    var host = $('#modalHost');
    var acts = opt.actions || [{ label: '知道了', kind: 'primary' }];
    host.innerHTML =
      '<div class="admin-modal-mask"><div class="admin-modal">' +
        '<h3>' + esc(opt.title || '') + '</h3>' +
        (opt.sub ? '<p class="sub">' + opt.sub + '</p>' : '') +
        '<div>' + (opt.body || '') + '</div>' +
        '<div class="admin-modal-actions">' +
          acts.map(function (a, i) { return '<button class="btn ' + (a.kind || 'ghost') + '" data-act="' + i + '">' + esc(a.label) + '</button>'; }).join('') +
        '</div>' +
      '</div></div>';
    var mask = $('.admin-modal-mask', host);
    function close() { host.innerHTML = ''; document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    $$('[data-act]', mask).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var a = acts[Number(btn.dataset.act)];
        var before = host.innerHTML;
        var shouldClose = !a || !a.handler || a.handler(mask, close) !== false;
        /* 处理函数里可能又开了新弹窗（例如"确认删除 → 结果反馈"）：
           这时不能再执行关闭，否则会把新弹窗一起清掉 */
        if (shouldClose && host.innerHTML === before) close();
      });
    });
    if (opt.onMount) opt.onMount(mask, close);
  }

  /* ---------------- 页面注册 ---------------- */
  function register(page) { A.pages[page.key] = page; A.order.push(page.key); }

  function todo(items) {
    return '<div class="placeholder"><b>该区块功能待填充（本次只搭外壳）</b><ul>' +
      items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>';
  }

  /* ---------- 页面 1：配置总览（用于验证三级读取与页面跳转） ---------- */
  register({
    key: 'overview', name: '配置总览', icon: 'i',
    title: '配置总览',
    subtitle: '后台与工作台读取的是同一份配置；读取顺序为 服务端 → 本机浏览器 → 内置默认值，拿得到哪级用哪级。',
    sections: [
      { id: 'sec-source', short: '数据来源', title: '数据来源与保存位置', desc: '当前这份配置来自哪一级，以及点「保存配置」时会写回哪一级。', render: function () { return '<div id="overviewSource"></div>'; } },
      { id: 'sec-levels', short: '三级读取说明', title: '三级读取是怎么工作的', desc: '服务端可用就用服务端；连不上服务端就用本机浏览器；浏览器存储不可用时退回内置默认值。', render: function () { return '<div id="overviewLevels"></div>'; } },
      { id: 'sec-pages', short: '后台页面清单', title: '后台页面清单', desc: '左侧第二组导航就是这些页面，内容区里也可以直接跳转。', render: function () { return '<div id="overviewPages"></div>'; } }
    ]
  });

  /* ---------- 页面 2：提示词与模板（已实现，定义在 admin-prompt-page.js） ---------- */
  register(HP.AdminPages.prompts);

  /* ---------- 页面 3：创作风格与语调（已实现，定义在 admin-style-page.js） ---------- */
  register(HP.AdminPages.styles);

  /* ---------- 页面 4：模型与接入（已实现，定义在 admin-model-page.js） ---------- */
  register(HP.AdminPages.model);

  /* ---------- 页面 5：商品库（只读版，定义在 admin-product-page.js） ---------- */
  register(HP.AdminPages.products);

  /* ---------- 页面 6：抓取来源（已实现，定义在 admin-source-page.js） ---------- */
  register(HP.AdminPages.sources);

  /* ---------- 页面 7：评测台（已实现，定义在 admin-eval-page.js） ---------- */
  register(HP.AdminPages.eval);

  /* ---------------- 脏数据与保存 ---------------- */
  function isDirty() { return !!A.draft && JSON.stringify(A.draft) !== JSON.stringify(HP.Config.get()); }

  function updateStatus() {
    var st = HP.Config.snapshot();
    A.dirty = isDirty();

    var badge = $('#srcBadge');
    badge.className = 'src-badge ' + st.source;
    $('#srcName').textContent = st.sourceLabel;
    $$('#srcLevel i').forEach(function (i, idx) {
      i.className = (idx < st.sourceLevel ? 'on ' : '') + (idx === 1 ? 'mid' : idx === 2 ? 'top' : '');
    });
    badge.title = '配置读取顺序：服务端 → 本机浏览器 → 内置默认值\n当前生效：' + st.sourceLabel +
      (st.serverSavedAt ? '\n服务端保存时间：' + new Date(st.serverSavedAt).toLocaleString('zh-CN') : '');

    $('#dirtyFlag').hidden = !A.dirty;
    $('#adminBar').className = 'admin-bar' + (A.dirty ? ' dirty' : '');
    $('#barTitle').textContent = A.dirty ? '有未保存的改动' : '已保存';
    $('#barHint').innerHTML = A.dirty
      ? '改动还没有写回「' + esc(st.sourceLabel) + '」。按 <span class="kbd">Ctrl</span> + <span class="kbd">S</span> 保存。'
      : '当前配置来自「' + esc(st.sourceLabel) + '」。修改后按 <span class="kbd">Ctrl</span> + <span class="kbd">S</span> 保存。';
    $('#btnRevert').disabled = !A.dirty;
  }

  function markDirty() { A.dirty = isDirty(); updateStatus(); }

  function saveConfig() {
    if (A.saving) return Promise.resolve();
    var check = HP.Config.validate(A.draft);
    if (!check.ok) {
      modal({
        title: '保存被拦住了',
        sub: '以下内容不合法，修正后才能写入。',
        body: '<div class="help warn">' + check.errors.map(esc).join('<br />') + '</div>'
      });
      return Promise.resolve();
    }
    A.saving = true;
    $('#btnSave').disabled = true;
    $('#btnSave').textContent = '保存中…';
    return HP.Config.save(A.draft).then(function (r) {
      A.saving = false;
      $('#btnSave').disabled = false;
      $('#btnSave').textContent = '保存配置';
      if (r.ok) {
        A.draft = clone(HP.Config.get());
        if (HP.Config.clearFilled) HP.Config.clearFilled();   // 补齐提示只在读取后显示一次
        updateStatus();
        rerender();
        toast('已保存到「' + r.targetLabel + '」' + (r.backup ? '（写入前已备份上一版：' + r.backup + '）' : ''), 'ok');
      } else {
        modal({
          title: '保存失败',
          sub: '写入「' + (r.targetLabel || '') + '」时被拒绝。',
          body: '<div class="help warn">' + (r.errors || ['未知错误']).map(esc).join('<br />') + '</div>'
        });
      }
    });
  }

  /* ---------------- 离开拦截：有未保存改动时先问一下 ---------------- */
  function guardLeave(next) {
    if (!isDirty()) { next(); return; }
    modal({
      title: '有未保存的改动',
      sub: '当前改动还没有写回「' + HP.Config.sourceLabel() + '」。',
      body: '<div class="help warn">离开这些改动会丢失。你可以先保存，也可以放弃改动再离开。</div>' +
        '<div class="help" style="margin-top:8px">改动内容：' + (draftSummary() || '（无）') + '</div>',
      actions: [
        { label: '留在本页', kind: 'ghost' },
        {
          label: '放弃改动并离开', kind: 'ghost', handler: function () {
            A.draft = clone(HP.Config.get());
            A.dirty = false;
            updateStatus();
            next();
          }
        },
        {
          label: '保存并离开', kind: 'primary', handler: function () {
            saveConfig().then(function () { if (!isDirty()) next(); });
            return false;
          }
        }
      ]
    });
  }

  /* 简要说明改了哪些区块，帮助运营判断 */
  function draftSummary() {
    var saved = HP.Config.get();
    var changed = [];
    Object.keys(HP.Config.DEFAULTS).forEach(function (k) {
      if (JSON.stringify(A.draft[k]) !== JSON.stringify(saved[k])) changed.push(sectionLabel(k));
    });
    return changed.length ? changed.join('、') + '（共 ' + changed.length + ' 个区块）' : '';
  }

  function resetSection(key) {
    if (!Object.prototype.hasOwnProperty.call(HP.Config.DEFAULTS, key)) return;
    A.draft[key] = clone(HP.Config.DEFAULTS[key]);
    A.dirty = true;
    updateStatus();
    rerender();
    toast('已把「' + sectionLabel(key) + '」恢复为默认值（还没保存，确认无误再点保存）', 'ok');
  }

  function revert() {
    A.draft = clone(HP.Config.get());
    updateStatus();
    rerender();
    toast('已撤销未保存的改动', '');
  }

  /* ---------------- 导出 / 导入 ---------------- */
  function stamp() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ---------------- 渲染 ---------------- */
  function currentPage() { return A.pages[A.page] || A.pages[A.order[0]]; }

  function renderNav() {
    var page = currentPage();
    $('#navSections').innerHTML = (page.sections || []).map(function (s, i) {
      return '<a class="side-link" data-scroll="' + s.id + '"><span class="idx">' + (i + 1) + '</span><span>' + esc(s.short || s.title) + '</span></a>';
    }).join('');
    $('#navSectionsNote').textContent = (page.sections || []).length ? '点击可滚动到对应区块。' : '本页暂无配置区块。';

    $('#navPages').innerHTML = A.order.map(function (k) {
      var p = A.pages[k];
      return '<a class="side-link ' + (k === A.page ? 'active' : '') + '" data-page="' + k + '">' +
        '<span class="idx">' + esc(p.icon || '·') + '</span><span>' + esc(p.name) + '</span></a>';
    }).join('');

    $$('#navPages [data-page]').forEach(function (a) {
      a.addEventListener('click', function () {
        if (a.dataset.page === A.page) return;
        var target = a.dataset.page;
        guardLeave(function () {
          leaveGuard.allow = true;
          location.hash = '#/' + target;
        });
      });
    });
    $$('#navSections [data-scroll]').forEach(function (a) {
      a.addEventListener('click', function () {
        var el = document.getElementById(a.dataset.scroll);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        $$('#navSections [data-scroll]').forEach(function (x) { x.classList.remove('active'); });
        a.classList.add('active');
      });
    });
  }

  function sectionHtml(s, i) {
    return '<section class="sec" id="' + s.id + '">' +
      '<div class="sec-head"><span class="num">' + (i + 1) + '</span>' +
        '<div><h3>' + esc(s.title) + '</h3><div class="desc">' + esc(s.desc) + '</div></div>' +
        '<div class="sec-actions">' +
          (s.actions || '') +
          (s.sectionKey ? '<button class="btn ghost tiny" data-reset="' + s.sectionKey + '">恢复本区块默认</button>' : '') +
        '</div>' +
      '</div>' +
      '<div class="sec-body' + (s.tight ? ' tight' : '') + '" id="' + s.id + '-body"></div>' +
    '</section>';
  }

  function ctx() {
    return {
      draft: A.draft,
      page: currentPage(),
      markDirty: markDirty,
      rerender: rerender,
      toast: toast,
      modal: modal,
      download: download
    };
  }

  function rerender() {
    var page = currentPage();
    var main = $('#adminMain');
    var st = HP.Config.snapshot();
    var autoSrc = (HP.Config.sourcesAutoFilled && HP.Config.sourcesAutoFilled()) || [];
    var fillNotice = (st.serverFilled && st.serverFilled.length)
      ? '<div class="help info" style="margin-bottom:12px">检测到服务端配置缺少 ' + st.serverFilled.length +
        ' 个区块（' + st.serverFilled.map(sectionLabel).join('、') +
        '），已自动用内置默认值补齐，页面可正常工作。</div>'
      : '';
    if (autoSrc.length) {
      fillNotice += '<div class="help info" style="margin-bottom:12px">配置里缺少 ' + autoSrc.length +
        ' 个内置抓取来源（' + esc(autoSrc.join('、')) +
        '），已自动补回并启用——内置来源只允许停用、不允许删除。点底部「保存配置」可以把补齐结果写回。</div>';
    }
    main.innerHTML =
      fillNotice +
      '<div class="page-head"><h1>' + esc(page.title) + '</h1><p>' + page.subtitle + '</p></div>' +
      (page.sections || []).map(sectionHtml).join('');

    /* 先渲染内容，再绑事件：每个区块自己负责自己的交互 */
    (page.sections || []).forEach(function (s) {
      var body = document.getElementById(s.id + '-body');
      if (!body) return;
      try {
        var html = s.render(body, ctx());
        if (typeof html === 'string') body.innerHTML = html;
        if (s.mount) s.mount(body, ctx());
      } catch (e) {
        /* 单个区块出错不影响整页：把错误显示在该区块里，方便定位 */
        body.innerHTML = '<div class="help warn">该区块渲染出错：' + esc(e.message) + '</div>';
        if (window.console) console.error('区块渲染失败：' + s.id, e);
      }
    });

    if (page.key === 'overview') renderOverview();
    wireSectionResets();
    renderNav();
    updateStatus();
  }

  /* 分区块「恢复默认」：只影响这一个区块 */
  function wireSectionResets() {
    $$('#adminMain [data-reset]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.dataset.reset;
        modal({
          title: '把「' + sectionLabel(key) + '」恢复为默认值？',
          sub: '只影响这一个区块，其它配置保持不变。',
          body: '<div class="help warn">恢复后是"未保存"状态——确认无误再点底部「保存配置」写回 ' +
            esc(HP.Config.sourceLabel()) + '。</div>',
          actions: [
            { label: '取消', kind: 'ghost' },
            { label: '恢复该区块默认', kind: 'primary', handler: function () { resetSection(key); } }
          ]
        });
      });
    });
  }

  function renderOverview() {
    var st = HP.Config.snapshot();
    function card(k, v, d) {
      return '<div class="card-mini"><div class="k">' + esc(k) + '</div>' +
        '<div class="v">' + esc(v) + '</div><div class="d">' + esc(d) + '</div></div>';
    }
    $('#overviewSource').innerHTML =
      '<div class="stat-grid">' +
        card('当前数据来源', st.sourceLabel, '第 ' + st.sourceLevel + ' 级（共 3 级）') +
        card('服务端', st.serverAvailable ? '可用' : '未连接', st.serverAvailable ? '配置保存在服务端配置文件里' : '未启动 node server/server.js') +
        card('保存目标', st.serverAvailable ? '服务端' : '本机浏览器', st.serverAvailable ? '写入前会自动备份上一版' : '保存在浏览器 localStorage') +
        card('最近保存', st.serverSavedAt ? new Date(st.serverSavedAt).toLocaleTimeString('zh-CN')
          : (st.config.updatedAt ? new Date(st.config.updatedAt).toLocaleTimeString('zh-CN') : '—'),
          st.serverAvailable ? '服务端配置文件的修改时间' : '本机浏览器的保存时间') +
      '</div>' +
      '<div style="margin-top:14px">' +
        '<div class="kv"><span>本机浏览器存储键</span><b>' + esc(st.storageKey) + '</b></div>' +
        '<div class="kv"><span>内置默认值顶层配置项</span><b>' + Object.keys(HP.Config.DEFAULTS).length + ' 项</b></div>' +
        '<div class="kv"><span>服务端自动补齐的区块</span><b>' + (st.serverFilled.length ? esc(st.serverFilled.join('、')) : '（无需补齐）') + '</b></div>' +
      '</div>';

    $('#overviewLevels').innerHTML =
      '<div class="kv"><span>第 3 级 · 服务端</span><b>' + (st.serverAvailable ? '✅ 当前生效（GET /api/config）' : '未连接，已跳过') + '</b></div>' +
      '<div class="kv"><span>第 2 级 · 本机浏览器</span><b>' + (st.source === 'local' ? '✅ 当前生效（localStorage）' : (st.serverAvailable ? '备用' : '不可用')) + '</b></div>' +
      '<div class="kv"><span>第 1 级 · 内置默认值</span><b>' + (st.source === 'defaults' ? '✅ 当前生效' : '兜底') + '</b></div>' +
      '<div class="help ' + (st.serverAvailable ? 'info' : 'warn') + '" style="margin-top:12px">' +
        (st.serverAvailable
          ? '服务端已连接：读取与保存都走服务端。关掉服务端再刷新，徽章会自动变成「本机浏览器」。'
          : '当前没有服务端，配置来自本机浏览器。启动方式：在项目目录执行 <code>node server/server.js</code>，然后刷新页面，徽章会变成「服务端」。') +
      '</div>';

    $('#overviewPages').innerHTML = '<div class="stat-grid">' + A.order.map(function (k) {
      var p = A.pages[k];
      return '<div class="card-mini"><div class="k">' + esc(p.name) + '</div>' +
        '<div class="d">' + (p.sections || []).length + ' 个配置区块</div>' +
        '<button class="btn ghost tiny" style="margin-top:8px" data-goto="' + k + '">进入该页</button></div>';
    }).join('') + '</div>';

    $$('#overviewPages [data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { location.hash = '#/' + b.dataset.goto; });
    });
  }

  /* ---------------- 路由与事件 ---------------- */
  function parseHash() {
    var m = String(location.hash || '').match(/^#\/([a-z0-9_-]+)/i);
    return m && A.pages[m[1]] ? m[1] : null;
  }

  function boot() {
    HP.Config.load().then(function () {
      A.draft = clone(HP.Config.get());
      A.page = parseHash() || A.order[0];
      rerender();
      wire();
    });
  }

  function wire() {
    window.addEventListener('hashchange', function () {
      var p = parseHash();
      if (!p || p === A.page) return;
      /* 地址栏被直接改 / 浏览器前进后退：有未保存改动时先问一下 */
      if (isDirty() && !leaveGuard.allow) {
        var target = p;
        leaveGuard.allow = true;
        location.hash = '#/' + A.page;      // 先把地址栏还原回当前页
        leaveGuard.allow = false;
        guardLeave(function () {
          leaveGuard.allow = true;
          location.hash = '#/' + target;
        });
        return;
      }
      leaveGuard.allow = false;
      A.page = p;
      rerender();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    /* 刷新 / 关闭标签页 / 跳走：浏览器层面的提醒 */
    window.addEventListener('beforeunload', function (e) {
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = '有未保存的配置改动，确定离开吗？';
      return e.returnValue;
    });

    /* 顶栏「返回工作台」同样先问一下 */
    $('#backBtn').addEventListener('click', function (e) {
      if (!isDirty()) return;
      e.preventDefault();
      guardLeave(function () { window.location.href = 'index.html'; });
    });

    $('#btnSave').addEventListener('click', function () { saveConfig(); });
    $('#btnRevert').addEventListener('click', function () { if (A.dirty) revert(); });
    var resetPageBtn = $('#btnResetPage');
    if (resetPageBtn) {
      resetPageBtn.addEventListener('click', function () {
        var page = currentPage();
        var keys = (page.sections || []).map(function (s) { return s.sectionKey; }).filter(Boolean);
        var uniq = keys.filter(function (k, i) { return keys.indexOf(k) === i; });
        if (!uniq.length) { toast('本页没有可恢复的配置区块', 'warn'); return; }
        modal({
          title: '把本页涉及的区块恢复为默认值？',
          sub: '将恢复：' + uniq.map(sectionLabel).join('、') + '。其它页面的配置不受影响。',
          body: '<div class="help warn">恢复后是"未保存"状态，确认无误再点「保存配置」。</div>',
          actions: [
            { label: '取消', kind: 'ghost' },
            {
              label: '恢复默认', kind: 'primary', handler: function () {
                uniq.forEach(function (k) { A.draft[k] = clone(HP.Config.DEFAULTS[k]); });
                A.dirty = true;
                updateStatus();
                rerender();
                toast('已恢复本页默认值（还没保存）', 'ok');
              }
            }
          ]
        });
      });
    }

    $('#btnExport').addEventListener('click', function () {
      var f = 'hotpulse-config-' + stamp() + '.json';
      download(f, HP.Config.exportJSON(A.draft));
      toast('已导出配置文件：' + f, 'ok');
    });

    $('#btnImport').addEventListener('click', function () { $('#filePicker').click(); });
    $('#filePicker').addEventListener('change', function (e) {
      var file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var r = HP.Config.importJSON(String(reader.result));
        if (!r.ok) {
          modal({
            title: '导入失败：文件格式有问题',
            sub: '原有配置没有受到任何影响，修好文件后可以再导入。',
            body: '<div class="help warn">' + esc(r.error).replace(/\n/g, '<br />') + '</div>'
          });
          return;
        }
        A.draft = r.config;
        updateStatus();
        rerender();
        modal({
          title: '导入成功，等待保存',
          sub: '文件已通过校验，内容已载入编辑区（<b>还没有写回 ' + esc(HP.Config.sourceLabel()) + '</b>）。',
          body: '<div class="ok-note"><span>✓</span><div>商品 ' + r.config.products.length + ' 件 · 创作风格 ' + r.config.styles.length +
            ' 个 · 语调 ' + r.config.tones.length + ' 个 · 抓取来源 ' + r.config.sources.length + ' 个</div></div>' +
            '<div class="help" style="margin-top:8px">确认无误后点「立即保存」，或先关掉逐项检查再保存。</div>',
          actions: [
            { label: '稍后保存', kind: 'ghost' },
            { label: '立即保存', kind: 'primary', handler: function () { saveConfig(); } }
          ]
        });
      };
      reader.readAsText(file, 'utf-8');
    });

    $('#shortcutBtn').addEventListener('click', function () {
      modal({
        title: '快捷键',
        body: '<div class="help" style="line-height:2">' +
          '<span class="kbd">Ctrl</span> + <span class="kbd">S</span> 保存配置<br />' +
          '<span class="kbd">Alt</span> + <span class="kbd">1</span> ~ <span class="kbd">7</span> 切换后台页面<br />' +
          '<span class="kbd">Esc</span> 关闭弹窗</div>'
      });
    });

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveConfig(); }
      if (e.altKey && /^[1-9]$/.test(e.key)) {
        var key = A.order[Number(e.key) - 1];
        if (key) location.hash = '#/' + key;
      }
    });
  }

  A.register = register;
  A.boot = boot;
  A.rerender = rerender;
  A.markDirty = markDirty;
  A.saveConfig = saveConfig;
  A.getDraft = function () { return A.draft; };
  /* 供各页面模块复用的工具 */
  A.$ = $;
  A.$$ = $$;
  A.esc = esc;
  A.clone = clone;
  A.toast = toast;
  A.modal = modal;
  A.download = download;
  A.stamp = stamp;
  A.saveConfig = saveConfig;
  A.updateStatus = updateStatus;
  A.ctx = ctx;
  window.HP.Admin = A;
})();
