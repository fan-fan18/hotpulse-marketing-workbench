/* =========================================================
   后台页面：提示词与模板
   · 可编辑三块：角色设定与写作规范 / 素材模板 / 单件商品呈现格式
   · 占位符清单：点击插入到光标当前位置（也提供完整清单弹窗）
   · 实时预览：按示例素材把最终发给模型的内容分块渲染出来，标注字数
   ========================================================= */
window.HP = window.HP || {};
HP.AdminPages = HP.AdminPages || {};

(function () {
  'use strict';

  /* 本文件比外壳先加载，因此这里不能直接缓存 HP.Admin，统一改成惰性调用 */
  function A() { return HP.Admin; }
  function $(sel, root) { return A().$(sel, root); }
  function $$(sel, root) { return A().$$(sel, root); }
  function esc(s) { return A().esc(s); }

  var view = { sampleId: null, styleId: null, lastInput: null };

  function sampleList() { return HP.Prompt.sampleList(); }
  function currentSample() {
    var list = sampleList();
    return list.filter(function (s) { return s.id === view.sampleId; })[0] || list[0];
  }
  function currentStyle(draft) {
    var list = draft.styles || [];
    return list.filter(function (s) { return s.id === view.styleId; })[0] || list[0] || { name: '热点借势', requirement: '' };
  }

  function insertAtCursor(text) {
    var el = view.lastInput;
    if (!el || !document.body.contains(el)) {
      A().toast('请先点一下要编辑的输入框，再点占位符', 'warn');
      return;
    }
    var start = el.selectionStart == null ? el.value.length : el.selectionStart;
    var end = el.selectionEnd == null ? el.value.length : el.selectionEnd;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    el.focus();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function palette(groups, hint) {
    var byGroup = {};
    HP.Prompt.PLACEHOLDERS.filter(function (p) { return groups.indexOf(p.group) > -1; })
      .forEach(function (p) { (byGroup[p.group] = byGroup[p.group] || []).push(p); });
    return '<div class="ph-panel">' +
      '<div class="help" style="margin:0 0 10px">' + (hint || '点一下占位符，插入到光标当前位置。') +
        '　<button class="btn ghost tiny" data-phlist="1">查看完整清单与说明</button></div>' +
      Object.keys(byGroup).map(function (g) {
        return '<div class="ph-group"><h5>' + esc(g) + '</h5><div class="ph-list">' +
          byGroup[g].map(function (p) {
            return '<button type="button" class="ph-chip" data-ph="' + esc(p.key) + '" title="' + esc(p.desc) + '">{{' + esc(p.key) + '}}</button>';
          }).join('') + '</div></div>';
      }).join('') + '</div>';
  }

  function wirePalette(root) {
    $$('[data-ph]', root).forEach(function (btn) {
      btn.addEventListener('click', function () { insertAtCursor('{{' + btn.dataset.ph + '}}'); });
    });
    $$('[data-phlist]', root).forEach(function (btn) {
      btn.addEventListener('click', function () { showList(); });
    });
  }

  function showList() {
    var groups = {};
    HP.Prompt.PLACEHOLDERS.forEach(function (p) { (groups[p.group] = groups[p.group] || []).push(p); });
    A().modal({
      title: '占位符清单',
      sub: '点「插入」把占位符放到光标位置。模板里遇到不认识的占位符会原样保留（不会被替换成空白），预览里会标红提示。',
      body: Object.keys(groups).map(function (g) {
        return '<div class="ph-group"><h5>' + esc(g) + '</h5><div class="table-scroll"><table class="admin-table">' +
          '<thead><tr><th style="width:170px">占位符</th><th>说明</th><th style="width:70px"></th></tr></thead><tbody>' +
          groups[g].map(function (p) {
            return '<tr><td><code>{{' + esc(p.key) + '}}</code></td><td>' + esc(p.desc) + '</td>' +
              '<td><button class="btn soft tiny" data-insert="' + esc(p.key) + '">插入</button></td></tr>';
          }).join('') + '</tbody></table></div></div>';
      }).join(''),
      actions: [{ label: '关闭', kind: 'ghost' }],
      onMount: function (m, close) {
        $$('[data-insert]', m).forEach(function (b) {
          b.addEventListener('click', function () { close(); insertAtCursor('{{' + b.dataset.insert + '}}'); });
        });
      }
    });
  }

  function trackFocus(root) {
    $$('textarea, input[type=text]', root).forEach(function (el) {
      el.addEventListener('focus', function () { view.lastInput = el; });
    });
  }

  /* ---------------- 预览 ---------------- */
  function buildPreview(draft) {
    var sample = currentSample();
    return {
      sample: sample,
      style: currentStyle(draft),
      compiled: HP.Prompt.compile(sample.news, sample.products, {
        style: currentStyle(draft),
        tone: (draft.tones[0] || { name: '热点借势' }).name,
        tags: (sample.news.topics || []).slice(0, 2),
        emojiLevel: 1, extra: ''
      }, draft)
    };
  }

  function highlightUnknown(text, unknown) {
    var html = esc(text);
    (unknown || []).forEach(function (k) {
      var token = esc('{{' + k + '}}');
      html = html.split(token).join('<span class="ph-bad">' + token + '</span>');
    });
    return html;
  }

  function paintPreview() {
    var host = document.getElementById('promptPreviewBlocks');
    if (!host) return;
    var ctx = A().ctx();
    var p = buildPreview(ctx.draft);
    var sysLen = HP.Prompt.charCount(p.compiled.system);
    var matLen = HP.Prompt.charCount(p.compiled.material);
    var unknown = p.compiled.unknown || [];
    host.innerHTML =
      '<div class="preview-grid">' +
        '<div class="preview-block"><header><b>① 给模型的规范说明</b><span class="char-count">' + sysLen + ' 字</span></header>' +
          '<pre>' + highlightUnknown(p.compiled.system, unknown) + '</pre></div>' +
        '<div class="preview-block"><header><b>② 拼装好的素材</b><span class="char-count">' + matLen + ' 字</span></header>' +
          '<pre>' + highlightUnknown(p.compiled.material, unknown) + '</pre></div>' +
      '</div>' +
      (unknown.length
        ? '<div class="unknown-tip">发现 ' + unknown.length + ' 个不认识的占位符：' +
          unknown.map(function (k) { return '<code>{{' + esc(k) + '}}</code>'; }).join('、') +
          '。它们会原样保留并发给模型，请检查是不是写错了。</div>'
        : '') +
      '<div class="help" style="margin-top:10px">示例素材：' + esc(p.sample.label) + '　｜　创作风格：' + esc(p.style.name) +
        '　｜　两块合计 ' + (sysLen + matLen) + ' 字（改上面三块模板，这里立即变化）</div>';
  }

  function paintProductPreview() {
    var host = document.getElementById('productPreview');
    if (!host) return;
    var ctx = A().ctx();
    var sample = currentSample();
    var prods = sample.products || [];
    var tpl = ctx.draft.prompt.productTemplate;
    var unknown = [];
    var lines = prods.map(function (p, i) {
      var base = HP.Prompt.contextFrom(sample.news, prods, { tags: (sample.news.topics || []).slice(0, 2) }, ctx.draft);
      var merged = Object.assign({}, base, HP.Prompt.productCtx(p, i, prods.length, prods[0] ? prods[0].id : null));
      return HP.Prompt.render(tpl, merged, { unknown: unknown }).text;
    });
    host.innerHTML = '<div class="preview-block"><header><b>按当前格式渲染出来的商品清单</b>' +
      '<span class="char-count">' + lines.length + ' 件</span></header>' +
      '<pre>' + highlightUnknown(lines.join('\n'), unknown) + '</pre></div>';
  }

  function paintAll() { paintPreview(); paintProductPreview(); }

  /* 范例自身的合规校验：范例不合规会把模型教坏 */
  function paintExampleCheck(ctx) {
    var el = document.getElementById('exampleCheck');
    if (!el) return;
    var text = String(ctx.draft.prompt.example || '');
    if (!text.trim()) {
      el.className = 'help';
      el.textContent = '还没有写范例。写一段合规范例能让格式更稳（注意：范例自己必须满足全部约束）。';
      return;
    }
    var sample = currentSample();
    var material = HP.Eval.materialFrom(sample.news, sample.products, {
      style: currentStyle(ctx.draft),
      tone: (ctx.draft.tones[0] || {}).name,
      tags: (sample.news.topics || []).slice(0, 2), emojiLevel: 1
    }, ctx.draft);
    var check = HP.Eval.machineCheck(text, material);
    var failed = check.items.filter(function (i) { return !i.pass; });
    el.className = 'help ' + (failed.length ? 'warn' : 'info');
    el.innerHTML = failed.length
      ? '范例自身有 ' + failed.length + ' 项不合规：' +
        failed.map(function (i) { return esc(i.label) + '（' + esc(i.reason) + '）'; }).join('；') +
        '　—— 范例不合规会把模型教坏，建议先改范例或调整阈值。'
      : '范例自身通过了全部 ' + check.items.length + ' 项检查（机器分 ' + check.score + '），可以放心作为示范。';
  }

  /* ---------------- 页面定义 ---------------- */
  HP.AdminPages.prompts = {
    key: 'prompts', name: '提示词与模板', icon: '1', pill: '核心',
    title: '提示词与模板',
    subtitle: '这里维护真正发给模型的内容。改完保存后，工作台下一次生成立即生效；右侧实时预览会按示例素材把最终内容拼出来。',
    sections: [
      {
        id: 'sec-p-role', sectionKey: 'prompt', short: '角色与写作规范',
        title: '角色设定与写作规范',
        desc: '模型的身份设定，以及逐条列举的写作规范。规范里同样可以用占位符（例如把字数区间写进去）。',
        actions: '<button class="btn soft tiny" id="addRule">+ 新增一条规范</button>',
        render: function () {
          var d = A().getDraft().prompt;
          return '<div style="margin-bottom:14px"><label class="label">角色设定 <em>模型的身份与输出格式要求</em></label>' +
              '<textarea class="textarea mono" id="roleText" rows="4">' + esc(d.role) + '</textarea></div>' +
            '<label class="label">写作规范 <em>逐条编辑，顺序即优先级</em></label>' +
            '<div class="rule-list" id="ruleList">' + (d.rules || []).map(function (r, i) {
              return '<div class="rule-item">' +
                '<span class="grip">' + (i + 1) + '</span>' +
                '<textarea class="textarea mono" data-rule="' + i + '" rows="2">' + esc(r) + '</textarea>' +
                '<div class="mini" style="display:flex;flex-direction:column;gap:4px">' +
                  '<button type="button" class="icon-mini" data-rup="' + i + '" title="上移">↑</button>' +
                  '<button type="button" class="icon-mini" data-rdown="' + i + '" title="下移">↓</button>' +
                  '<button type="button" class="icon-mini danger" data-rdel="' + i + '" title="删除">×</button>' +
                '</div></div>';
            }).join('') + '</div>' +
            '<div class="help" style="margin-top:10px">共 ' + (d.rules || []).length + ' 条。字数类要求建议写成硬要求，例如「写完自己数一遍，超了就删，宁可少写一个卖点也不能超」。</div>' +
            '<div style="margin-top:14px"><label class="label">范例 <em>会一并放进规范；范例本身必须满足所有约束，否则会把模型教坏</em></label>' +
              '<textarea class="textarea mono" id="exampleText" rows="4">' + esc(d.example || '') + '</textarea>' +
              '<div class="help" id="exampleCheck"></div></div>';
        },
        mount: function (body, ctx) {
          trackFocus(body);
          body.querySelector('#roleText').addEventListener('input', function (e) {
            ctx.draft.prompt.role = e.target.value; ctx.markDirty(); paintPreview();
          });
          var ex = body.querySelector('#exampleText');
          if (ex) {
            ex.addEventListener('focus', function () { view.lastInput = ex; });
            ex.addEventListener('input', function () {
              ctx.draft.prompt.example = ex.value;
              ctx.markDirty();
              paintExampleCheck(ctx);
              paintPreview();
            });
            paintExampleCheck(ctx);
          }
          $$('[data-rule]', body).forEach(function (ta) {
            ta.addEventListener('focus', function () { view.lastInput = ta; });
            ta.addEventListener('input', function () {
              ctx.draft.prompt.rules[Number(ta.dataset.rule)] = ta.value;
              ctx.markDirty(); paintPreview();
            });
          });
          $$('[data-rup],[data-rdown],[data-rdel]', body).forEach(function (btn) {
            btn.addEventListener('click', function () {
              var rules = ctx.draft.prompt.rules;
              var i = Number(btn.dataset.rup || btn.dataset.rdown || btn.dataset.rdel);
              if (btn.dataset.rdel !== undefined) rules.splice(i, 1);
              else if (btn.dataset.rup !== undefined && i > 0) { var t = rules[i - 1]; rules[i - 1] = rules[i]; rules[i] = t; }
              else if (btn.dataset.rdown !== undefined && i < rules.length - 1) { var t2 = rules[i + 1]; rules[i + 1] = rules[i]; rules[i] = t2; }
              ctx.markDirty(); ctx.rerender();
            });
          });
          document.getElementById('addRule').addEventListener('click', function () {
            ctx.draft.prompt.rules.push('新增规范：在这里写清楚要求。');
            ctx.markDirty(); ctx.rerender();
          });
        }
      },
      {
        id: 'sec-p-material', sectionKey: 'prompt', short: '素材模板',
        title: '素材模板',
        desc: '每次调用时用来拼装素材的模板。运行时才知道的内容用占位符表示；商品清单是一个整体占位符，内部会逐件渲染后拼起来。',
        render: function () {
          var d = A().getDraft().prompt;
          return '<textarea class="textarea mono" id="materialTpl" rows="14">' + esc(d.materialTemplate) + '</textarea>' +
            '<div class="help" style="display:flex;justify-content:space-between;margin-top:6px">' +
              '<span>支持嵌套：{{商品清单}} 里每一件都按下面「单件商品呈现格式」渲染。</span>' +
              '<span class="char-count" id="materialLen">' + HP.Prompt.charCount(d.materialTemplate) + ' 字</span></div>' +
            '<div style="margin-top:12px">' + palette(['热点素材', '商品素材', '本次要求']) + '</div>';
        },
        mount: function (body, ctx) {
          trackFocus(body);
          var ta = body.querySelector('#materialTpl');
          ta.addEventListener('focus', function () { view.lastInput = ta; });
          ta.addEventListener('input', function () {
            ctx.draft.prompt.materialTemplate = ta.value;
            body.querySelector('#materialLen').textContent = HP.Prompt.charCount(ta.value) + ' 字';
            ctx.markDirty(); paintPreview();
          });
          wirePalette(body);
        }
      },
      {
        id: 'sec-p-product', sectionKey: 'prompt', short: '单件呈现格式',
        title: '单件商品在素材里的呈现格式',
        desc: '决定商品清单里「每一件」长什么样。这里的占位符只对单件生效，{{商品清单}} 会把它们逐件渲染后拼起来。',
        render: function () {
          var d = A().getDraft().prompt;
          return '<textarea class="textarea mono" id="productTpl" rows="3">' + esc(d.productTemplate) + '</textarea>' +
            '<div class="help" style="display:flex;justify-content:space-between;margin-top:6px">' +
              '<span>建议保留售价、原价与卖点：金额越明确，模型越不容易编造价格。</span>' +
              '<span class="char-count" id="productLen">' + HP.Prompt.charCount(d.productTemplate) + ' 字</span></div>' +
            '<div style="margin-top:12px">' + palette(['单件商品格式'], '这里的占位符只作用于单件商品。') + '</div>' +
            '<div style="margin-top:12px" id="productPreview"></div>';
        },
        mount: function (body, ctx) {
          trackFocus(body);
          var ta = body.querySelector('#productTpl');
          ta.addEventListener('focus', function () { view.lastInput = ta; });
          ta.addEventListener('input', function () {
            ctx.draft.prompt.productTemplate = ta.value;
            body.querySelector('#productLen').textContent = HP.Prompt.charCount(ta.value) + ' 字';
            ctx.markDirty(); paintAll();
          });
          wirePalette(body);
          paintProductPreview();
        }
      },
      {
        id: 'sec-p-review', sectionKey: 'prompt', short: '返工与评审提示词',
        title: '自动返工说明与模型评审提示词',
        desc: '返工说明用来"照着清单改错"；评审提示词用来给文案打分。两处都支持编辑并保存，改完工作台下一次生成/评审立即生效。',
        render: function () {
          var d = A().getDraft().prompt;
          var sample = currentSample();
          var style = currentStyle(A().getDraft());
          var previewCopy = '【' + String(sample.news.title).split(/[：:！!，,；;]/)[0].slice(0, 18) + '】🥶 ' +
            (sample.products[0] ? sample.products[0].name : '商品') + '，加绒内胆可拆，防风防泼水面料。' +
            '现在 ¥' + (sample.products[0] ? sample.products[0].price : 299) + '。你们那边几度？评论区报个数 👇\n' +
            (sample.news.topics || []).slice(0, 2).join(' ');
          var sampleMaterial = HP.Prompt.compile(sample.news, sample.products, {
            style: style, tone: (A().getDraft().tones[0] || {}).name, tags: (sample.news.topics || []).slice(0, 2)
          }, A().getDraft()).material;
          var rendered = String(d.reviewPrompt || '')
            .split('{{素材}}').join('（此处插入组装好的素材，共 ' + HP.Prompt.charCount(sampleMaterial) + ' 字）')
            .split('{{文案}}').join(previewCopy);
          return '<div style="margin-bottom:14px"><label class="label">返工说明 <em>自动返工时，"未通过清单"会拼在它的后面</em></label>' +
              '<textarea class="textarea mono" id="reworkText" rows="4">' + esc(d.reworkInstruction || '') + '</textarea></div>' +
            '<div><label class="label">模型评审提示词 <em>用 {{素材}} 与 {{文案}} 两个占位符；要求低温度、只输出结构化结果</em></label>' +
              '<textarea class="textarea mono" id="reviewText" rows="12">' + esc(d.reviewPrompt || '') + '</textarea>' +
              '<div class="help" style="margin-top:6px">点下面占位符可直接插入：' +
                '<button class="ph-chip" data-ph="素材">' + '{{素材}}' + '</button> ' +
                '<button class="ph-chip" data-ph="文案">' + '{{文案}}' + '</button></div></div>' +
            '<div class="row" style="margin-top:12px">' +
              '<div class="col narrow"><label class="label">返工温度 <em>建议 0.1–0.3</em></label>' +
                '<input class="input" type="number" min="0" max="2" step="0.05" data-bind="prompt.reworkTemperature" data-number="1" value="' +
                esc(String(d.reworkTemperature)) + '" /></div>' +
              '<div class="col narrow"><label class="label">评审温度 <em>建议 0–0.3</em></label>' +
                '<input class="input" type="number" min="0" max="2" step="0.05" data-bind="prompt.reviewTemperature" data-number="1" value="' +
                esc(String(d.reviewTemperature)) + '" /></div>' +
              '<div class="col"><div class="help" style="margin-top:22px">温度和提示词都会即时保存到配置；' +
                '工作台里点「模型评审」用的就是这里的提示词与温度。</div></div>' +
            '</div>' +
            '<div style="margin-top:14px"><label class="label">评审提示词预览 <em>按示例素材渲染后的最终内容</em></label>' +
              '<div class="preview-block"><header><b>发给评审模型的内容</b>' +
              '<span class="char-count" id="reviewPreviewCount">' + HP.Prompt.charCount(rendered) + ' 字</span></header>' +
              '<pre id="reviewPreviewPre">' + esc(rendered) + '</pre></div></div>' +
            '<div style="margin-top:14px"><label class="label">返工提示预览 <em>校验没过时，发给模型的内容长这样</em></label>' +
              '<div class="preview-block"><header><b>返工调用（低温度 ' + esc(String(d.reworkTemperature)) + '）</b>' +
              '<span class="char-count">引导语 + 未通过清单 + 素材 + 待改文案</span></header>' +
              '<pre id="reworkPreviewPre">' + esc([
                d.reworkInstruction || '',
                '',
                '【未通过清单】（示例）',
                '· [广告法违禁词] 命中违禁词：全网最低（硬伤）',
                '· [编造价格] 文案出现素材里没有的金额：¥66；素材里真实可用的金额：¥299、¥599',
                '· [字数区间] 字数 425 字，超出上限 320 字',
                '',
                '【素材（商品、价格、话题只能来自这里）】',
                sampleMaterial,
                '',
                '【待修改文案】',
                previewCopy
              ].join('\n')) + '</pre></div></div>';
        },
        mount: function (body, ctx) {
          trackFocus(body);
          var rw = body.querySelector('#reworkText');
          var rv = body.querySelector('#reviewText');
          rw.addEventListener('input', function () {
            ctx.draft.prompt.reworkInstruction = rw.value;
            ctx.markDirty();
            var pre = body.querySelector('#reworkPreviewPre');
            if (pre) {
              pre.innerHTML = esc([rw.value, '', '【未通过清单】（示例）',
                '· [广告法违禁词] 命中违禁词：全网最低（硬伤）',
                '· [编造价格] 文案出现素材里没有的金额：¥66；素材里真实可用的金额：¥299、¥599',
                '· [字数区间] 字数 425 字，超出上限 320 字',
                '', '【素材（商品、价格、话题只能来自这里）】', currentSample().products.length ? HP.Prompt.compile(
                  currentSample().news, currentSample().products,
                  { style: currentStyle(ctx.draft), tone: (ctx.draft.tones[0] || {}).name, tags: (currentSample().news.topics || []).slice(0, 2) },
                  ctx.draft
                ).material : '', '', '【待修改文案】', '（待修改的文案原文）'].join('\n'));
            }
          });
          rw.addEventListener('focus', function () { view.lastInput = rw; });
          rv.addEventListener('input', function () { ctx.draft.prompt.reviewPrompt = rv.value; ctx.markDirty(); });
          rv.addEventListener('focus', function () { view.lastInput = rv; });
          /* 改提示词时局部刷新预览与字数（不整页重渲染，避免打断输入） */
          function refreshReviewPreview() {
            var pre = body.querySelector('#reviewPreviewPre');
            var cnt = body.querySelector('#reviewPreviewCount');
            if (!pre) return;
            var sample = currentSample();
            var html = String(ctx.draft.prompt.reviewPrompt || '')
              .split('{{素材}}').join('（此处插入组装好的素材）')
              .split('{{文案}}').join('（此处插入待评审文案）');
            pre.innerHTML = esc(html);
            if (cnt) cnt.textContent = HP.Prompt.charCount(html) + ' 字';
          }
          rv.addEventListener('input', refreshReviewPreview);
          rw.addEventListener('input', refreshReviewPreview);
          /* 两个温度输入 */
          body.querySelectorAll('[data-bind]').forEach(function (el) {
            el.addEventListener('change', function () {
              var parts = el.dataset.bind.split('.');
              var v = Number(el.value);
              if (isNaN(v)) return;
              v = Math.max(0, Math.min(2, v));
              el.value = v;
              ctx.draft[parts[0]][parts[1]] = v;
              ctx.markDirty();
            });
          });
          body.querySelectorAll('[data-ph]').forEach(function (b) {
            b.addEventListener('click', function () {
              view.lastInput = rv;
              insertAtCursor('{{' + b.dataset.ph + '}}');
            });
          });
        }
      },
      {
        id: 'sec-p-preview', short: '实时预览',
        title: '实时预览',
        desc: '按示例素材把最终会发给模型的完整内容渲染出来：左边是规范说明，右边是拼装好的素材，各自显示字数。',
        render: function () {
          var draft = A().getDraft();
          return '<div class="row" style="align-items:flex-end;margin-bottom:12px">' +
              '<div class="col"><label class="label">示例素材</label><select class="select" id="samplePick">' +
                sampleList().map(function (s) { return '<option value="' + s.id + '">' + esc(s.label) + '</option>'; }).join('') +
              '</select></div>' +
              '<div class="col"><label class="label">创作风格</label><select class="select" id="stylePick">' +
                (draft.styles || []).map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('') +
              '</select></div>' +
            '</div>' +
            '<div id="promptPreviewBlocks"></div>';
        },
        mount: function (body, ctx) {
          var sp = body.querySelector('#samplePick'), st = body.querySelector('#stylePick');
          var list = sampleList();
          view.sampleId = (currentSample() || list[0]).id;
          view.styleId = currentStyle(ctx.draft).id;
          sp.value = view.sampleId;
          st.value = view.styleId;
          sp.addEventListener('change', function () { view.sampleId = sp.value; paintAll(); });
          st.addEventListener('change', function () { view.styleId = st.value; paintAll(); });
          paintAll();
        }
      },
      {
        id: 'sec-p-trial', short: '试运行',
        title: '试运行（用当前模板真调一次）',
        desc: '用当前的模板和模型配置真发一次请求，查看生成结果、耗时、消耗量，以及这次用的是哪个模型、哪种接入方式。结果只用于调试，不写回工作台。',
        actions: '<button class="btn primary tiny" id="trialRun">试运行一次</button>',
        render: function () {
          var m = A().getDraft().model || {};
          var modeLabel = (HP.LLM.MODE_LABEL[m.mode] || m.mode);
          return '<div class="row" style="align-items:flex-end">' +
              '<div class="col narrow"><label class="label">接入方式</label>' +
                '<select class="select" id="trialMode">' +
                  ['mock', 'proxy', 'direct'].map(function (k) {
                    return '<option value="' + k + '"' + (m.mode === k ? ' selected' : '') + '>' + esc(HP.LLM.MODE_LABEL[k]) + '</option>';
                  }).join('') +
                '</select></div>' +
              '<div class="col"><label class="label">接口地址（baseUrl）</label>' +
                '<input class="input" id="trialBaseUrl" value="' + esc(m.baseUrl || '') + '" placeholder="https://api.example.com/v1" /></div>' +
              '<div class="col narrow"><label class="label">模型名</label>' +
                '<input class="input" id="trialModel" value="' + esc(m.model || '') + '" /></div>' +
            '</div>' +
            '<div class="row" style="align-items:flex-end;margin-top:10px">' +
              '<div class="col"><label class="label">API 密钥 <em>只存在本机浏览器；正式使用请走本地服务中转</em></label>' +
                '<input class="input" type="password" id="trialKey" value="' + esc(m.apiKey || '') + '" placeholder="sk-..." autocomplete="off" /></div>' +
              '<div class="col narrow"><label class="label">温度</label>' +
                '<input class="input" type="number" step="0.05" min="0" max="2" id="trialTemp" value="' + esc(String(m.temperature)) + '" /></div>' +
              '<div class="col narrow"><div class="help">当前：<b id="trialModeLabel">' + esc(modeLabel) + '</b></div></div>' +
            '</div>' +
            (m.mode === 'mock'
              ? '<div class="mock-note" style="margin-top:12px"><span>!</span><div><b>当前是本地模拟模式。</b>试运行不会发起真实网络请求，结果是模拟输出，不代表真实模型效果。' +
                '要验证真实效果，请把接入方式切到「本地服务中转」或「浏览器直连」并填写服务商、模型与密钥。</div></div>'
              : '<div class="help info" style="margin-top:12px">' +
                (m.mode === 'proxy'
                  ? '本地服务中转：浏览器把请求发给本机服务端（需要先启动 <code>node server/server.js</code>），密钥由服务端环境变量 HOTPULSE_API_KEY 提供，浏览器不接触密钥。'
                  : '浏览器直连：请求直接从浏览器发往服务商，可能遇到跨域限制；密钥会保存在本机浏览器。') +
                '</div>') +
            '<div class="help" style="margin:10px 0">调用使用的素材与上面预览一致（示例素材 + 创作风格），提示词就是当前编辑中的内容（<b>不用先保存</b>）。</div>' +
            '<div id="trialResult"><div class="help">点击右上角「试运行一次」开始。</div></div>';
        },
        mount: function (body, ctx) {
          var btn = body.parentNode.querySelector('#trialRun') || document.getElementById('trialRun');
          if (!btn) return;
          var bind = { trialMode: 'mode', trialBaseUrl: 'baseUrl', trialModel: 'model', trialKey: 'apiKey', trialTemp: 'temperature' };
          Object.keys(bind).forEach(function (id) {
            var el = body.querySelector('#' + id);
            if (!el) return;
            el.addEventListener('change', function () {
              var v = id === 'trialTemp' ? Number(el.value) : el.value;
              ctx.draft.model[bind[id]] = v;
              ctx.markDirty();
              if (id === 'trialMode') { ctx.rerender(); }
              else {
                var lb = document.getElementById('trialModeLabel');
                if (lb) lb.textContent = HP.LLM.MODE_LABEL[ctx.draft.model.mode] || ctx.draft.model.mode;
              }
            });
          });
          btn.addEventListener('click', function () { runTrial(body, ctx, btn); });
        }
      }
    ]
  };

  /* ---------------- 试运行 ---------------- */
  function runTrial(body, ctx, btn) {
    var host = document.getElementById('trialResult');
    var p = buildPreview(ctx.draft);
    var m = ctx.draft.model || {};
    var t0 = Date.now();

    btn.disabled = true;
    btn.textContent = '调用中…';
    host.innerHTML = '<div class="run-result"><div class="progress-line"><span class="spinner"></span>' +
      '<span>正在用「' + esc(HP.LLM.MODE_LABEL[m.mode] || m.mode) + '」调用 ' + esc(m.model || '') + ' …</span></div></div>';

    HP.LLM.call({
      mode: m.mode, baseUrl: m.baseUrl, model: m.model, apiKey: m.apiKey,
      temperature: m.temperature,
      system: p.compiled.system, user: p.compiled.material,
      meta: {
        kind: 'compose', news: p.sample.news, products: p.sample.products,
        limits: ctx.draft.limits, style: p.style,
        tone: (ctx.draft.tones[0] || {}).name || '',
        tags: (p.sample.news.topics || []).slice(0, 2), emojiLevel: 1, extra: '',
        system: p.compiled.system, user: p.compiled.material
      }
    }).then(function (r) {
      btn.disabled = false;
      btn.textContent = '试运行一次';

      if (!r.ok) {
        host.innerHTML = '<div class="run-result">' +
          '<div class="err-note"><span>!</span><div><b>调用失败：' + esc(r.message) + '</b>' +
            '<div class="help" style="margin-top:6px">已把服务商返回的错误转换成可读原因；下面可展开技术细节用于排查。</div>' +
          '</div></div>' +
          '<details style="margin-top:10px"><summary class="help" style="cursor:pointer">技术细节（可选）</summary>' +
            '<pre style="white-space:pre-wrap;font-size:12px;background:var(--panel-2);border:1px solid var(--line-2);border-radius:9px;padding:10px;margin-top:8px">' +
            esc('接入方式：' + (r.modeLabel || '') + (r.status ? '\nHTTP 状态码：' + r.status : '') + '\n' + (r.raw || '（无）')) +
            '</pre></details>' +
          '<div class="help" style="margin-top:10px">这次试运行只用于调试，没有写回工作台。</div>' +
          '</div>';
        return;
      }

      var usage = r.usage || {};
      var cost = HP.LLM.priceOf(usage.inputTokens || 0, usage.outputTokens || 0, m);
      var elapsed = Date.now() - t0;
      host.innerHTML = '<div class="run-result">' +
        '<div class="run-meta">' +
          '<span>接入方式：<b>' + esc(r.modeLabel) + '</b></span>' +
          '<span>实际模型：<b>' + esc(r.model) + '</b></span>' +
          '<span>耗时：<b>' + elapsed + ' ms</b></span>' +
          '<span>消耗：<b>' + (usage.inputTokens || 0) + ' in / ' + (usage.outputTokens || 0) + ' out tokens</b></span>' +
          '<span>预估花费：<b>¥' + cost + '</b></span>' +
        '</div>' +
        (r.mode === 'mock'
          ? '<div class="mock-note"><span>!</span><div><b>现在是模拟输出，不代表真实模型效果。</b>' +
            '它只用来验证模板拼装与链路是否通顺。切换到「本地服务中转」或「浏览器直连」并配置密钥后，这里就是真实模型的结果。</div></div>'
          : '') +
        '<div class="run-text">' + esc(r.text) + '</div>' +
        '<div class="help" style="margin-top:10px">结果只用于调试，<b>没有写回工作台</b>；工作台里的候选文案不受这次试运行影响。</div>' +
        '</div>';
    });
  }
})();
