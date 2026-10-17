/* =========================================================
   后台页面：模型与接入
   · 接入方式 / 服务商 / 接口地址 / 模型名 / 密钥 / 创作温度 / 流式输出
   · 与工作台 Step 4 的模型快捷设置共用同一份配置（config.model）
   ========================================================= */
window.HP = window.HP || {};
HP.AdminPages = HP.AdminPages || {};

(function () {
  'use strict';

  function A() { return HP.Admin; }
  function esc(s) { return A().esc(s); }

  var MODES = [
    { id: 'mock', name: '本地模拟', desc: '不发网络请求，用本地模拟模型走完整流程，用于验证模板与链路。' },
    { id: 'proxy', name: '本地服务中转', desc: '浏览器 → 本机服务端 → 服务商。密钥放服务端环境变量，浏览器不接触密钥（推荐正式使用）。' },
    { id: 'direct', name: '浏览器直连', desc: '请求直接从浏览器发往服务商，可能被跨域策略拦截；密钥会保存在本机浏览器。' }
  ];

  function preset(id) { return HP.LLM.providerPreset ? HP.LLM.providerPreset(id) : (HP.LLM.PROVIDERS.filter(function (p) { return p.id === id; })[0] || null); }

  HP.AdminPages.model = {
    key: 'model', name: '模型与接入', icon: '3',
    title: '模型与接入设置',
    subtitle: '模型配置集中在这里，并与工作台 Step 4 的模型快捷设置共用同一份配置：两边改哪边都生效，不会各存一份。',
    sections: [
      {
        id: 'sec-m-mode', sectionKey: 'model', short: '接入方式',
        title: '接入方式',
        desc: '决定模型请求从哪里发出。正式使用建议选「本地服务中转」，密钥不会出现在浏览器里。',
        render: function () {
          var m = A().getDraft().model || {};
          var noServer = !(HP.Config.isServer && HP.Config.isServer());
          return '<div class="row">' + MODES.map(function (x) {
            var on = m.mode === x.id;
            return '<div class="col"><button type="button" class="card-mini" data-mode="' + x.id + '" style="text-align:left;width:100%;' +
              (on ? 'border-color:var(--brand);box-shadow:0 0 0 2px rgba(26,77,46,.12);background:#f7faf8' : '') + '">' +
              '<b style="display:block;font-size:13.5px;margin-bottom:4px">' + esc(x.name) + (on ? ' ✓ 当前' : '') + '</b>' +
              '<span class="help" style="display:block;margin:0">' + esc(x.desc) + '</span>' +
              (x.id === 'proxy' && noServer
                ? '<span class="help" data-noserver="1" style="display:block;margin:6px 0 0;color:var(--warn,#b45309)">'
                  + '⚠ 没有检测到服务端：先双击「启动服务.bat」或执行 node server/server.js，再用 http://localhost:8787 打开本页；否则这个选项发不出请求。</span>'
                : '') +
              '</button></div>';
          }).join('') + '</div>' +
          '<div class="help info" style="margin-top:12px">当前生效：<b>' + esc(HP.LLM.MODE_LABEL[m.mode] || m.mode) + '</b>。' +
            '这份配置与工作台 Step 4 的模型快捷设置是<b>同一份</b>：这里改完保存，工作台下一次生成就用新配置；' +
            '在工作台里改，这里刷新后也是同一个值。</div>';
        },
        mount: function (body, ctx) {
          body.querySelectorAll('[data-mode]').forEach(function (b) {
            b.addEventListener('click', function () {
              ctx.draft.model.mode = b.dataset.mode;
              ctx.markDirty();
              ctx.rerender();
              A().toast('接入方式已切换为「' + HP.LLM.MODE_LABEL[b.dataset.mode] + '」，保存后对工作台生效', 'ok');
            });
          });
        }
      },
      {
        id: 'sec-m-provider', sectionKey: 'model', short: '服务商与地址',
        title: '服务商、接口地址与模型名',
        desc: '选了服务商会自动填好接口地址与常用模型名，也允许手动改。',
        render: function () {
          var m = A().getDraft().model || {};
          var p = preset(m.provider);
          return '<div class="row">' +
              '<div class="col narrow"><label class="label">服务商 <em>选择后自动填地址与模型名</em></label>' +
                '<select class="select" id="providerPick">' + HP.LLM.PROVIDERS.map(function (x) {
                  return '<option value="' + x.id + '"' + (x.id === m.provider ? ' selected' : '') + '>' + esc(x.name) + '</option>';
                }).join('') + '</select>' +
                (p && p.note ? '<div class="help">' + esc(p.note) + '</div>' : '') + '</div>' +
              '<div class="col"><label class="label">接口地址（baseUrl）</label>' +
                '<input class="input" id="mBaseUrl" value="' + esc(m.baseUrl || '') + '" placeholder="https://api.example.com/v1" /></div>' +
            '</div>' +
            '<div class="row" style="margin-top:12px">' +
              '<div class="col"><label class="label">模型名 <em>可直接输入，也可以点下面的常用模型</em></label>' +
                '<input class="input" id="mModel" value="' + esc(m.model || '') + '" />' +
                (p && p.models && p.models.length
                  ? '<div class="ph-list" style="margin-top:8px">' + p.models.map(function (x) {
                    return '<button type="button" class="ph-chip" data-model="' + esc(x) + '">' + esc(x) + '</button>';
                  }).join('') + '</div>'
                  : '<div class="help">该服务商为自定义，请自己填写模型名。</div>') + '</div>' +
            '</div>' +
            '<div class="help" style="margin-top:10px">切换服务商时，接口地址与模型名会被预设覆盖；覆盖后仍可手动修改。</div>';
        },
        mount: function (body, ctx) {
          var sel = body.querySelector('#providerPick');
          var base = body.querySelector('#mBaseUrl');
          var model = body.querySelector('#mModel');
          base.addEventListener('change', function () { ctx.draft.model.baseUrl = base.value; ctx.markDirty(); });
          model.addEventListener('change', function () { ctx.draft.model.model = model.value; ctx.markDirty(); });
          body.querySelectorAll('[data-model]').forEach(function (b) {
            b.addEventListener('click', function () {
              ctx.draft.model.model = b.dataset.model;
              ctx.markDirty();
              ctx.rerender();
              A().toast('已选择模型名：' + b.dataset.model, 'ok');
            });
          });
          sel.addEventListener('change', function () {
            var p = preset(sel.value);
            ctx.draft.model.provider = sel.value;
            var filled = [];
            if (p) {
              if (p.baseUrl) { ctx.draft.model.baseUrl = p.baseUrl; filled.push('接口地址'); }
              if (p.models && p.models.length) { ctx.draft.model.model = p.models[0]; filled.push('模型名'); }
            }
            ctx.markDirty();
            ctx.rerender();
            A().toast('已按「' + (p ? p.name : sel.value) + '」自动填好' + (filled.length ? filled.join('与') : '（该服务商需自行填写）'), 'ok');
          });
        }
      },
      {
        id: 'sec-m-key', sectionKey: 'model', short: '密钥与温度',
        title: '密钥、创作温度与输出方式',
        desc: '密钥的存放位置、温度推荐值、以及是否流式输出，都在这里配置。',
        render: function () {
          var m = A().getDraft().model || {};
          return '<div class="row">' +
              '<div class="col"><label class="label">API 密钥</label>' +
                '<input class="input" type="password" id="mKey" value="' + esc(m.apiKey || '') + '" placeholder="sk-..." autocomplete="off" />' +
                '<div class="help danger" style="margin-top:8px"><b>密钥只存在你本机浏览器</b>（localStorage，页面代码不会上传到任何地方）。' +
                  '正式使用请走「本地服务中转」，把密钥放在服务端配置里：启动服务端时设置环境变量 ' +
                  '<code>HOTPULSE_API_KEY</code>，浏览器端留空即可。</div></div>' +
              '<div class="col narrow"><label class="label">流式输出</label>' +
                '<label class="checkline" style="margin:0"><input type="checkbox" id="mStream" ' + (m.stream ? 'checked' : '') + ' />' +
                  '<span>逐字返回</span></label>' +
                '<div class="help">原型里先记录配置项，界面后续接入逐字渲染。</div></div>' +
            '</div>' +
            '<div style="margin-top:14px"><label class="label">创作温度 <em id="tempVal">' + esc(String(m.temperature)) + '</em></label>' +
              '<input type="range" id="mTemp" min="0" max="2" step="0.05" value="' + esc(String(m.temperature)) + '" />' +
              '<div class="table-scroll" style="margin-top:10px"><table class="admin-table"><thead><tr>' +
                '<th>任务类型</th><th style="width:150px">推荐区间</th><th style="width:110px">一键设为</th></tr></thead><tbody>' +
                HP.LLM.TEMP_GUIDE.map(function (g) {
                  return '<tr><td>' + esc(g.task) + '</td><td>' + esc(g.range) + '</td>' +
                    '<td><button class="btn ghost tiny" data-temp="' + g.temp + '">' + g.temp + '</button></td></tr>';
                }).join('') + '</tbody></table></div>' +
              '<div class="help">创作类（写文案、想标题）建议高一些，抽取 / 评审 / 返工类建议低一些，保证结果稳定。</div></div>' +
            '<div class="row" style="margin-top:14px">' +
              '<div class="col narrow"><label class="label">输入单价 <em>元 / 千 tokens</em></label>' +
                '<input class="input" type="number" step="0.01" id="mPriceIn" value="' + esc(String(m.priceIn == null ? 0.15 : m.priceIn)) + '" /></div>' +
              '<div class="col narrow"><label class="label">输出单价 <em>元 / 千 tokens</em></label>' +
                '<input class="input" type="number" step="0.01" id="mPriceOut" value="' + esc(String(m.priceOut == null ? 0.6 : m.priceOut)) + '" /></div>' +
              '<div class="col"><div class="help" style="margin-top:22px">用于「试运行」和评测里估算花费。<b>参考价，以服务商官网为准，可自行修改。</b></div></div>' +
            '</div>';
        },
        mount: function (body, ctx) {
          var key = body.querySelector('#mKey');
          var stream = body.querySelector('#mStream');
          var temp = body.querySelector('#mTemp');
          var pin = body.querySelector('#mPriceIn');
          var pout = body.querySelector('#mPriceOut');
          key.addEventListener('change', function () { ctx.draft.model.apiKey = key.value; ctx.markDirty(); });
          stream.addEventListener('change', function () { ctx.draft.model.stream = stream.checked; ctx.markDirty(); });
          temp.addEventListener('input', function () {
            ctx.draft.model.temperature = Number(temp.value);
            body.querySelector('#tempVal').textContent = temp.value;
            ctx.markDirty();
          });
          pin.addEventListener('change', function () { ctx.draft.model.priceIn = Number(pin.value); ctx.markDirty(); });
          pout.addEventListener('change', function () { ctx.draft.model.priceOut = Number(pout.value); ctx.markDirty(); });
          body.querySelectorAll('[data-temp]').forEach(function (b) {
            b.addEventListener('click', function () {
              ctx.draft.model.temperature = Number(b.dataset.temp);
              ctx.markDirty();
              ctx.rerender();
            });
          });
        }
      },
      {
        id: 'sec-m-test', short: '测试连接',
        title: '测试连接',
        desc: '真发一次最小请求，显示成功与否、耗时，以及实际响应的模型名。',
        actions: '<button class="btn primary tiny" id="testConn">测试连接</button>',
        render: function () {
          var m = A().getDraft().model || {};
          return '<div class="run-meta">' +
              '<span>接入方式：<b>' + esc(HP.LLM.MODE_LABEL[m.mode] || m.mode) + '</b></span>' +
              '<span>服务商：<b>' + esc((preset(m.provider) || {}).name || m.provider || '—') + '</b></span>' +
              '<span>接口地址：<b>' + esc(m.baseUrl || '—') + '</b></span>' +
              '<span>模型：<b>' + esc(m.model || '—') + '</b></span>' +
              '<span>密钥：<b>' + (m.apiKey ? '已填写（仅本机浏览器）' : '未填写') + '</b></span>' +
            '</div>' +
            (m.mode === 'mock'
              ? '<div class="mock-note"><span>!</span><div>当前是本地模拟模式，测试连接不会发起真实网络请求。切到真实接入方式后再测才有意义。</div></div>'
              : '') +
            '<div id="connResult"><div class="help">点击右上角「测试连接」，会用上面这套配置真发一次最小请求（不会写回工作台）。</div></div>';
        },
        mount: function (body, ctx) {
          var btn = document.getElementById('testConn');
          if (!btn) return;
          btn.addEventListener('click', function () {
            var host = document.getElementById('connResult');
            btn.disabled = true;
            btn.textContent = '测试中…';
            host.innerHTML = '<div class="run-result"><div class="progress-line"><span class="spinner"></span><span>正在发送最小请求…</span></div></div>';
            HP.LLM.testConnection(ctx.draft.model).then(function (r) {
              btn.disabled = false;
              btn.textContent = '测试连接';
              if (r.mock || r.modeLabel === HP.LLM.MODE_LABEL.mock) {
                host.innerHTML = '<div class="mock-note"><span>!</span><div>' + esc(r.message) + '</div></div>';
                return;
              }
              if (r.ok) {
                host.innerHTML = '<div class="run-result"><div class="ok-note"><span>✓</span><div>' +
                  '<b>连接成功</b>　耗时 <b>' + r.latencyMs + ' ms</b>　实际响应模型：<b>' + esc(r.model) + '</b>' +
                  '<div class="help" style="margin-top:4px">接入方式：' + esc(r.modeLabel) +
                  (r.text ? '；返回内容：' + esc(r.text) : '') + '</div></div></div></div>';
                return;
              }
              host.innerHTML = '<div class="run-result">' +
                '<div class="err-note"><span>!</span><div><b>连接失败：' + esc(r.message) + '</b>' +
                  '<div class="help" style="margin-top:6px">已把服务商返回的错误转换成可读原因；下面可展开技术细节用于排查。' +
                  '耗时 ' + r.latencyMs + ' ms。</div></div></div>' +
                '<details style="margin-top:10px"><summary class="help" style="cursor:pointer">技术细节（可选）</summary>' +
                  '<pre style="white-space:pre-wrap;font-size:12px;background:var(--panel-2);border:1px solid var(--line-2);border-radius:9px;padding:10px;margin-top:8px">' +
                  esc('接入方式：' + (r.modeLabel || '') + (r.status ? '\nHTTP 状态码：' + r.status : '') + '\n' + (r.raw || '（无）')) +
                  '</pre></details></div>';
            });
          });
        }
      }
    ]
  };
})();
