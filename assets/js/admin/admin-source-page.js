/* =========================================================
   后台页面：抓取来源
   · 来源列表：内置平台热榜 + 运营自定义订阅源；可启用/停用，自定义可删除
   · 添加订阅源：校验地址格式
   · 测试全部来源：真发一次抓取，逐个显示成功/失败、条数、耗时、失败原因
   · 合规提示 + 风险识别规则（禁止借势 / 需人工判断）
   ========================================================= */
window.HP = window.HP || {};
HP.AdminPages = HP.AdminPages || {};

(function () {
  'use strict';

  function A() { return HP.Admin; }
  function esc(s) { return A().esc(s); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var ui = { testing: false, results: null, via: '', urlError: '' };

  HP.AdminPages.sources = {
    key: 'sources', name: '抓取来源', icon: '5',
    title: '抓取来源配置',
    subtitle: '来源不再写死在代码里：内置平台热榜可以启停，运营也可以添加自己的新闻订阅源。工作台抓取时只会使用启用中的来源。',
    sections: [
      {
        id: 'sec-so-list', sectionKey: 'sources', short: '来源列表',
        title: '来源列表',
        desc: '内置来源不能删除（可以停用）；自定义订阅源可以编辑和删除。停用后工作台不会再抓取它。',
        actions: '<button class="btn soft tiny" id="soRefreshFromTest">按测试结果更新条目</button>',
        render: function () {
          var list = A().getDraft().sources || [];
          var enabled = list.filter(function (s) { return s.enabled; }).length;
          return '<div class="table-scroll"><table class="admin-table"><thead><tr>' +
              '<th style="width:70px">启用</th><th style="width:200px">名称</th><th style="width:80px">类型</th>' +
              '<th>地址</th><th style="width:190px">备注</th><th style="width:110px">已抓条目</th><th style="width:80px">操作</th>' +
            '</tr></thead><tbody>' + list.map(function (s, i) {
              return '<tr><td><label class="checkline" style="margin:0"><input type="checkbox" data-sen="' + i + '" ' +
                  (s.enabled ? 'checked' : '') + ' /></label></td>' +
                '<td><input class="input" data-sname="' + i + '" value="' + esc(s.name || '') + '" /></td>' +
                '<td><span class="badge ' + (s.type === 'builtin' ? 'brand' : 'gray') + '">' + (s.type === 'builtin' ? '内置' : '自定义') + '</span></td>' +
                '<td><input class="input" data-surl="' + i + '" value="' + esc(s.url || '') + '" /></td>' +
                '<td><input class="input" data-snote="' + i + '" value="' + esc(s.note || '') + '" /></td>' +
                '<td>' + ((s.items || []).length ? '<span class="badge ok">' + s.items.length + ' 条</span>' : '<span class="help">—</span>') + '</td>' +
                '<td>' + (s.type === 'builtin'
                  ? '<span class="help">不可删除</span>'
                  : '<button class="btn ghost tiny" data-sdel="' + i + '">删除</button>') + '</td></tr>';
            }).join('') + '</tbody></table></div>' +
            '<div class="help" style="margin-top:10px">当前启用 <b>' + enabled + '</b> / ' + list.length +
            ' 个来源。停用后保存配置，工作台的热点列表里就不会再出现这些来源的新闻。</div>';
        },
        mount: function (body, ctx) {
          body.querySelectorAll('[data-sen]').forEach(function (el) {
            el.addEventListener('change', function () {
              ctx.draft.sources[Number(el.dataset.sen)].enabled = el.checked;
              ctx.markDirty();
              ctx.rerender();
              A().toast(el.checked ? '已启用该来源（保存后对工作台生效）' : '已停用该来源（保存后工作台不再抓取它）', 'ok');
            });
          });
          ['sname', 'surl', 'snote'].forEach(function (key) {
            body.querySelectorAll('[data-' + key + ']').forEach(function (el) {
              el.addEventListener('input', function () {
                var i = Number(el.dataset[key]);
                var field = key === 'sname' ? 'name' : key === 'surl' ? 'url' : 'note';
                ctx.draft.sources[i][field] = el.value;
                ctx.markDirty();
              });
            });
          });
          body.querySelectorAll('[data-sdel]').forEach(function (b) {
            b.addEventListener('click', function () {
              var i = Number(b.dataset.sdel);
              var s = ctx.draft.sources[i];
              if (s.type === 'builtin') { A().toast('内置来源不能删除，可以停用', 'warn'); return; }
              A().modal({
                title: '删除自定义来源？',
                sub: '来源：' + esc(s.name) + '（' + esc(s.url) + '）',
                body: '<div class="help warn">删除后这个来源不再参与抓取，它抓到的条目也会一起从配置里移除。保存配置后不可恢复。</div>' +
                  (ui.results ? '<div class="help" style="margin-top:8px">提示：可以先用「测试全部来源」确认其它来源正常，再删除。</div>' : ''),
                actions: [
                  { label: '取消', kind: 'ghost' },
                  {
                    label: '确认删除', kind: 'primary', handler: function () {
                      ctx.draft.sources.splice(i, 1);
                      ctx.markDirty();
                      ctx.rerender();
                      A().toast('已删除来源「' + s.name + '」（还没保存）', 'ok');
                    }
                  }
                ]
              });
            });
          });
          var refresh = document.getElementById('soRefreshFromTest');
          if (refresh) refresh.addEventListener('click', function () { applyResultsToDraft(ctx); });
        }
      },
      {
        id: 'sec-so-add', short: '添加订阅源',
        title: '添加新闻订阅源',
        desc: '填 RSS / Atom 地址，或返回 JSON 列表的接口地址。添加时会先校验地址格式。',
        render: function () {
          return '<div class="row" style="align-items:flex-end">' +
              '<div class="col narrow"><label class="label">来源名称</label>' +
                '<input class="input" id="soNewName" placeholder="例如：行业媒体 RSS" /></div>' +
              '<div class="col"><label class="label">订阅地址 <em>必填，http(s) 开头</em></label>' +
                '<input class="input" id="soNewUrl" placeholder="https://example.com/rss.xml" />' +
                '<div class="field-error" id="soUrlError" ' + (ui.urlError ? '' : 'hidden') + '>' + esc(ui.urlError) + '</div></div>' +
              '<div class="col narrow"><button class="btn primary" id="soAdd">添加</button></div>' +
            '</div>' +
            '<div class="help" style="margin-top:10px">添加后建议立刻点「测试全部来源」验证一次：能解析出条目的来源，抓到的条目会写进编辑区，保存后工作台就能看到来自它的新闻。</div>';
        },
        mount: function (body, ctx) {
          function add() {
            var url = body.querySelector('#soNewUrl').value.trim();
            var name = body.querySelector('#soNewName').value.trim();
            var err = body.querySelector('#soUrlError');
            if (!/^https?:\/\/.+/i.test(url)) {
              ui.urlError = '地址格式不对：必须以 http:// 或 https:// 开头（当前：' + (url || '空') + '）';
              err.hidden = false;
              err.textContent = ui.urlError;
              body.querySelector('#soNewUrl').classList.add('invalid');
              A().toast('地址格式不对，请检查后重试', 'warn');
              return;
            }
            ui.urlError = '';
            err.hidden = true;
            body.querySelector('#soNewUrl').classList.remove('invalid');
            ctx.draft.sources.push({
              id: 'src_' + Date.now().toString(36),
              name: name || ('自定义订阅 ' + (ctx.draft.sources.length + 1)),
              type: 'custom', url: url, enabled: true, note: '运营自定义订阅源', items: []
            });
            ctx.markDirty();
            ctx.rerender();
            A().toast('已添加订阅源，建议点「测试全部来源」验证一次', 'ok');
          }
          document.getElementById('soAdd').addEventListener('click', add);
          body.querySelector('#soNewUrl').addEventListener('keydown', function (e) { if (e.key === 'Enter') add(); });
        }
      },
      {
        id: 'sec-so-test', short: '测试全部来源',
        title: '测试全部来源',
        desc: '对每个来源真发起一次抓取，逐个显示成功或失败、抓到多少条、耗时多久，失败会说明原因（超时 / 地址不对 / 对方拒绝等）。',
        actions: '<button class="btn primary tiny" id="soTestAll">测试全部来源</button>',
        render: function () {
          var list = A().getDraft().sources || [];
          return '<div class="help" style="margin-bottom:10px">将测试全部 ' + list.length + ' 个来源（含停用中的，方便决定要不要重新启用）。' +
              (HP.Config.isServer()
                ? '当前有本地服务端，抓取走服务端（不受浏览器跨域限制）。'
                : '当前没有启动本地服务端，抓取会从浏览器直接发起，公开站点通常会被跨域策略拦截——启动 <code>node server/server.js</code> 后再测更接近真实情况。') +
            '</div>' +
            '<div id="soTestHost">' + (ui.results ? '' : '<div class="help">还没有测试结果，点右上角「测试全部来源」开始。</div>') + '</div>';
        },
        mount: function (body, ctx) {
          var host = body.querySelector('#soTestHost');
          if (ui.results) paintResults(host, ctx);
          document.getElementById('soTestAll').addEventListener('click', function () {
            var btn = document.getElementById('soTestAll');
            btn.disabled = true;
            btn.textContent = '测试中…';
            /* 给自动化测试/联调一个可观测的"进行中"标记（来源多了可能要跑到超时上限） */
            document.body.dataset.testingSources = '1';
            host.innerHTML = '<div class="run-result"><div class="progress-line"><span class="spinner"></span><span>正在逐个抓取来源…</span></div></div>';
            runTest(ctx.draft.sources).then(function (r) {
              btn.disabled = false;
              btn.textContent = '测试全部来源';
              document.body.dataset.testingSources = '0';
              ui.results = r.results;
              ui.via = r.via;
              paintResults(host, ctx);
              applyResultsToDraft(ctx, true);
            });
          });
        }
      },
      {
        id: 'sec-so-fetch', sectionKey: 'fetch', short: '定时抓取',
        title: '定时抓取与热点池',
        desc: '服务端按固定间隔自动抓取启用中的来源，条目先去重再进热点池（data/news.json）。关掉开关后不再自动抓，工作台的「一键抓取」仍然可以手动触发。',
        render: function () {
          var f = A().getDraft().fetch || {};
          var on = f.enabled !== false;
          return '<div class="row" style="align-items:center">' +
              '<label style="display:flex;align-items:center;gap:8px;font-size:13.5px">' +
                '<input type="checkbox" id="soFetchOn" ' + (on ? 'checked' : '') + ' /> 启用定时抓取（服务端）' +
              '</label>' +
            '</div>' +
            '<div class="row" style="margin-top:12px;align-items:flex-end">' +
              '<div class="col narrow"><label class="label">抓取间隔（分钟）<em>1–240</em></label>' +
                '<input class="input" id="soFetchInterval" type="number" min="1" max="240" value="' + esc(f.intervalMin || 10) + '" /></div>' +
              '<div class="col narrow"><label class="label">热点保留天数<em>1–30</em></label>' +
                '<input class="input" id="soFetchKeep" type="number" min="1" max="30" value="' + esc(f.keepDays || 7) + '" /></div>' +
              '<div class="col"><label class="label">服务端当前状态</label>' +
                '<div class="help" id="soFetchStatus">正在读取服务端状态…</div></div>' +
            '</div>' +
            '<div class="help" style="margin-top:10px">服务端启动 3 秒后先跑一次，之后按上面的间隔重复；抓取串行发起（对对方站点更友好），单个来源超时 6 秒，' +
            '失败会记进抓取记录但不影响其它来源。热点池超过保留天数的条目会在下一轮抓取时清掉。</div>';
        },
        mount: function (body, ctx) {
          var cb = body.querySelector('#soFetchOn');
          if (cb) cb.addEventListener('change', function () {
            ctx.draft.fetch = ctx.draft.fetch || {};
            ctx.draft.fetch.enabled = cb.checked;
            ctx.markDirty();
            A().toast(cb.checked ? '已开启定时抓取（保存后生效）' : '已关闭定时抓取（保存后生效；工作台的手动抓取仍可用）', 'ok');
          });
          var iv = body.querySelector('#soFetchInterval');
          if (iv) iv.addEventListener('change', function () {
            var v = Math.max(1, Math.min(240, Number(iv.value) || 10));
            iv.value = v;
            ctx.draft.fetch = ctx.draft.fetch || {};
            ctx.draft.fetch.intervalMin = v;
            ctx.markDirty();
            A().toast('抓取间隔改为 ' + v + ' 分钟（保存后重排定时器）', 'ok');
          });
          var kd = body.querySelector('#soFetchKeep');
          if (kd) kd.addEventListener('change', function () {
            var v = Math.max(1, Math.min(30, Number(kd.value) || 7));
            kd.value = v;
            ctx.draft.fetch = ctx.draft.fetch || {};
            ctx.draft.fetch.keepDays = v;
            ctx.markDirty();
          });
          var st = body.querySelector('#soFetchStatus');
          if (!st) return;
          if (!HP.Config.isServer()) {
            st.innerHTML = '<span style="color:var(--warn)">没有连上本地服务端（演示模式）</span>：定时抓取只在服务端运行，这里仅展示配置。';
            return;
          }
          fetch('api/health').then(function (r) { return r.json(); }).then(function (d) {
            var n = (d && d.news) || {};
            var last = n.lastRun;
            st.innerHTML = '池内 <b>' + (n.total == null ? '—' : n.total) + '</b> 条 · 今日新增 <b>' + (n.today == null ? '—' : n.today) + '</b> 条' +
              (last ? '<br />最近一次：' + new Date(last.at).toLocaleString('zh-CN') + '，新增 ' + (last.added || 0) + ' / 合并 ' + (last.merged || 0) +
                '，耗时 ' + (last.ms || 0) + ' ms' : '<br />还没有抓取记录') +
              (n.nextRunAt ? '<br />下次自动抓取：' + new Date(n.nextRunAt).toLocaleTimeString('zh-CN') : '');
          }).catch(function () { st.textContent = '读取服务端状态失败（服务端可能刚重启）'; });
        }
      },
      {
        id: 'sec-so-compliance', short: '合规提示',
        title: '合规提示（务必先读）',
        desc: '关于能抓什么、不能抓什么。',
        render: function () {
          return '<div class="help danger">' +
              '<b>公开热榜接口只适合原型演示。</b>正式上线应改用官方开放平台（如平台官方 API）或商业舆情服务，并遵守对方的爬虫协议与服务条款。' +
              '<br /><br />具体要求：' +
              '<br />· 不绕过反爬机制、不伪造身份高频抓取、不抓取需要登录或明确付费的内容；' +
              '<br />· 不抓取用户隐私数据（手机号、身份信息、私信内容等）；' +
              '<br />· 抓取频率控制在对方许可范围内，保留来源标注与原文链接；' +
              '<br />· 商用前确认内容的转载授权，涉及新闻作品时尤其注意版权。' +
            '</div>' +
            '<div class="help info" style="margin-top:10px">本页的「测试全部来源」只对填写的地址发一次 GET 请求，用于验证连通性，不做批量或定时抓取。</div>';
        }
      },
      {
        id: 'sec-so-risk', sectionKey: 'riskRules', short: '风险识别规则',
        title: '风险识别规则说明',
        desc: '哪些类型的热点会被判为禁止借势、哪些需要人工判断。这两份清单可以直接维护，供运营在借势前对照。',
        render: function () {
          var r = A().getDraft().riskRules || { forbidden: [], manual: [] };
          return '<div class="row">' +
              '<div class="col"><label class="label">禁止借势 <em>命中即不建议参与</em></label>' +
                '<div class="rule-list" id="riskForbidden">' + r.forbidden.map(function (t, i) {
                  return '<div style="display:flex;gap:8px;align-items:center">' +
                    '<input class="input" data-rf="' + i + '" value="' + esc(t) + '" />' +
                    '<button class="icon-mini danger" data-rfdel="' + i + '">×</button></div>';
                }).join('') + '</div>' +
                '<button class="btn ghost tiny" id="addRf" style="margin-top:8px">+ 新增一条</button></div>' +
              '<div class="col"><label class="label">需人工判断 <em>谨慎参与，先看口径</em></label>' +
                '<div class="rule-list" id="riskManual">' + r.manual.map(function (t, i) {
                  return '<div style="display:flex;gap:8px;align-items:center">' +
                    '<input class="input" data-rm="' + i + '" value="' + esc(t) + '" />' +
                    '<button class="icon-mini danger" data-rmdel="' + i + '">×</button></div>';
                }).join('') + '</div>' +
                '<button class="btn ghost tiny" id="addRm" style="margin-top:8px">+ 新增一条</button></div>' +
            '</div>';
        },
        mount: function (body, ctx) {
          body.querySelectorAll('[data-rf]').forEach(function (el) {
            el.addEventListener('input', function () { ctx.draft.riskRules.forbidden[Number(el.dataset.rf)] = el.value; ctx.markDirty(); });
          });
          body.querySelectorAll('[data-rm]').forEach(function (el) {
            el.addEventListener('input', function () { ctx.draft.riskRules.manual[Number(el.dataset.rm)] = el.value; ctx.markDirty(); });
          });
          body.querySelectorAll('[data-rfdel]').forEach(function (b) {
            b.addEventListener('click', function () { ctx.draft.riskRules.forbidden.splice(Number(b.dataset.rfdel), 1); ctx.markDirty(); ctx.rerender(); });
          });
          body.querySelectorAll('[data-rmdel]').forEach(function (b) {
            b.addEventListener('click', function () { ctx.draft.riskRules.manual.splice(Number(b.dataset.rmdel), 1); ctx.markDirty(); ctx.rerender(); });
          });
          document.getElementById('addRf').addEventListener('click', function () { ctx.draft.riskRules.forbidden.push('新的禁止借势类型'); ctx.markDirty(); ctx.rerender(); });
          document.getElementById('addRm').addEventListener('click', function () { ctx.draft.riskRules.manual.push('新的需人工判断类型'); ctx.markDirty(); ctx.rerender(); });
        }
      }
    ]
  };

  /* ---------------- 抓取测试：优先服务端，退化为浏览器直连 ---------------- */
  function runTest(sources) {
    if (HP.Config.isServer()) {
      return fetch('api/sources/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: sources })
      }).then(function (r) { return r.json(); })
        .catch(function (e) { return { ok: false, via: 'server', results: [], error: e.message }; });
    }
    return Promise.all(sources.map(browserProbe)).then(function (results) {
      return { ok: true, via: 'browser', results: results };
    });
  }

  function browserProbe(s) {
    var started = Date.now();
    var url = String(s.url || '').trim();
    if (!/^https?:\/\/.+/i.test(url)) {
      return Promise.resolve({ id: s.id, name: s.name, ok: false, ms: 0, count: 0, items: [], reason: '地址格式不对：必须以 http:// 或 https:// 开头' });
    }
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 6000);
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.text().then(function (t) {
        clearTimeout(timer);
        if (!r.ok) return { id: s.id, name: s.name, ok: false, ms: Date.now() - started, count: 0, items: [], reason: '对方返回 HTTP ' + r.status };
        var isFeed = /<rss|<feed|<channel/i.test(t);
        var count = isFeed ? (t.match(/<item[\s>]/gi) || []).length + (t.match(/<entry[\s>]/gi) || []).length
          : Math.min(500, (t.match(/<a\s[^>]*href=/gi) || []).length);
        return {
          id: s.id, name: s.name, ok: true, ms: Date.now() - started, count: count, items: [], kind: isFeed ? 'feed' : 'html',
          reason: isFeed ? ('订阅源解析出 ' + count + ' 条（浏览器直连模式只统计条数，标题解析请用本地服务端）')
            : ('页面可访问，粗略识别 ' + count + ' 个链接')
        };
      }); })
      .catch(function (e) {
        clearTimeout(timer);
        var reason = e.name === 'AbortError' ? '超时（6 秒未响应）'
          : '浏览器直连失败：' + (e.message || '') + '（公开站点通常会被跨域 CORS 拦截，建议启动本地服务端后再测）';
        return { id: s.id, name: s.name, ok: false, ms: Date.now() - started, count: 0, items: [], reason: reason };
      });
  }

  function paintResults(host, ctx) {
    var rs = ui.results || [];
    var okN = rs.filter(function (x) { return x.ok; }).length;
    var itemN = rs.reduce(function (n, x) { return n + ((x.items || []).length); }, 0);
    host.innerHTML =
      (ui.via === 'browser'
        ? '<div class="mock-note"><span>!</span><div>当前没有本地服务端，下面是浏览器直连的实测结果：多数公开站点会被跨域拦截，这属于预期现象。</div></div>'
        : '') +
      '<div class="help" style="margin-bottom:8px">共 ' + rs.length + ' 个来源：成功 <b>' + okN + '</b> 个，失败 <b>' + (rs.length - okN) + '</b> 个' +
        (itemN ? '；解析出条目 <b>' + itemN + '</b> 条' : '') + '。</div>' +
      '<div class="table-scroll"><table class="admin-table"><thead><tr>' +
        '<th>来源</th><th style="width:76px">结果</th><th class="num" style="width:70px">条数</th>' +
        '<th class="num" style="width:80px">耗时</th><th>说明</th><th style="width:120px">抓到条目</th>' +
      '</tr></thead><tbody>' + rs.map(function (r) {
        return '<tr><td>' + esc(r.name) + '</td>' +
          '<td>' + (r.ok ? '<span class="badge ok">成功</span>' : '<span class="badge danger">失败</span>') + '</td>' +
          '<td class="num">' + (r.count || 0) + '</td>' +
          '<td class="num">' + (r.ms || 0) + ' ms</td>' +
          '<td>' + esc(r.reason || '') + '</td>' +
          '<td>' + ((r.items || []).length
            ? '<span class="badge ok">' + r.items.length + ' 条</span>'
            : '<span class="help">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="help" style="margin-top:10px">成功解析出条目的来源，其条目会自动写入编辑区（见「来源列表」的"已抓条目"列），' +
        '点底部「保存配置」后工作台就能看到来自它的新闻。</div>';
  }

  /* 把测试抓到的条目写进草稿（每个来源最多保留 10 条） */
  function applyResultsToDraft(ctx, silent) {
    var rs = ui.results || [];
    var wrote = 0, total = 0;
    rs.forEach(function (r) {
      if (!r.items || !r.items.length) return;
      var s = ctx.draft.sources.filter(function (x) { return x.id === r.id; })[0];
      if (!s) return;
      s.items = r.items.slice(0, 10).map(function (it) {
        return { title: it.title, summary: it.summary || '', link: it.link || '', fetchedAt: new Date().toISOString() };
      });
      wrote++; total += s.items.length;
    });
    if (!wrote) {
      if (!silent) A().toast('这次测试没有解析出可写入的条目（公开热榜多为前端渲染，拿不到标题）', 'warn');
      return;
    }
    ctx.markDirty();
    ctx.rerender();
    A().toast('已把 ' + wrote + ' 个来源的共 ' + total + ' 条条目写入编辑区，保存配置后工作台可见', 'ok');
  }
})();
