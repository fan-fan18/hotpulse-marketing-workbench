/* =========================================================
   后台页面：创作风格与语调
   · 创作风格：名称 + 创作要求，可增删改与调整顺序；至少保留一个
   · 语调预设：一组标签，可增删；在工作台里作为「主打语调」的可选项
   ========================================================= */
window.HP = window.HP || {};
HP.AdminPages = HP.AdminPages || {};

(function () {
  'use strict';

  /* 本文件比外壳先加载，统一惰性取用 HP.Admin */
  function A() { return HP.Admin; }
  function esc(s) { return A().esc(s); }

  function nextId(prefix) {
    return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
  }

  /* 工作台里风格卡片长这样（用于预览） */
  function styleCardPreview(styles, selectedAll) {
    return '<div class="style-grid">' + styles.map(function (s, i) {
      var on = selectedAll || i < 2;
      return '<button class="style-card ' + (on ? 'active' : '') + '" type="button">' +
        '<b>' + esc(s.name || '未命名风格') + '</b><i>' + esc((s.requirement || '（还没有写创作要求）').slice(0, 18)) + '</i></button>';
    }).join('') + '</div>';
  }

  /* 局部刷新：只更新统计文字与预览，不动正在编辑的输入框 */
  function refreshStyleSummary(ctx) {
    var styles = ctx.draft.styles || [];
    var hint = document.getElementById('styleSummary');
    if (hint) {
      hint.innerHTML = '当前 <b>' + styles.length + '</b> 个风格：工作台生成文案时每个风格独立跑一次，产出 <b>' +
        styles.length + '</b> 个候选版本（工作台里可以取消勾选）。';
    }
    var preview = document.getElementById('stylePreview');
    if (preview) preview.innerHTML = styleCardPreview(styles, true);
  }

  function refreshToneSummary(ctx) {
    var tones = ctx.draft.tones || [];
    var hint = document.getElementById('toneSummary');
    if (hint) {
      hint.innerHTML = '当前 <b>' + tones.length + '</b> 个语调。工作台里作为「主打语调」的可选项出现，选中后写进素材的「主打语调：」一行传给模型。';
    }
    var sel = document.getElementById('tonePreview');
    if (sel) {
      sel.innerHTML = tones.map(function (t) { return '<option>' + esc(t.name || '') + '</option>'; }).join('');
    }
  }

  HP.AdminPages.styles = {
    key: 'styles', name: '创作风格与语调', icon: '2',
    title: '创作风格与语调',
    subtitle: '一条热点出多个版本，每个版本由一个创作风格驱动；语调预设会作为素材的一部分传给模型。改完保存后，工作台下一次生成立即生效。',
    sections: [
      {
        id: 'sec-st-list', sectionKey: 'styles', short: '创作风格',
        title: '创作风格',
        desc: '每个风格 = 一个名称 + 一段创作要求。工作台里勾选几个风格，就会生成几个候选版本；至少保留一个。',
        actions: '<button class="btn ghost tiny" data-tpl="styles">填写模板</button>' + '<button class="btn soft tiny" id="addStyle">+ 新增创作风格</button>',
        render: function () {
          var draft = A().getDraft();
          var styles = draft.styles || [];
          return '<div class="rule-list" id="styleList">' + styles.map(function (s, i) {
            return '<div class="style-row">' +
              '<span class="grip">' + (i + 1) + '</span>' +
              '<input class="input" style="flex:0 0 190px" data-sname="' + i + '" value="' + esc(s.name || '') + '" placeholder="风格名称，如「热点借势」" />' +
              '<textarea class="textarea" style="flex:1;min-height:40px" rows="2" data-sreq="' + i + '" placeholder="创作要求，例如：先接住热点情绪再自然过渡到商品，重体验感">' + esc(s.requirement || '') + '</textarea>' +
              '<div class="mini" style="display:flex;flex-direction:column;gap:4px">' +
                '<button type="button" class="icon-mini" data-sup="' + i + '" title="上移">↑</button>' +
                '<button type="button" class="icon-mini" data-sdown="' + i + '" title="下移">↓</button>' +
                '<button type="button" class="icon-mini danger" data-sdel="' + i + '" title="删除">×</button>' +
              '</div></div>';
          }).join('') + '</div>' +
          '<div class="help" style="margin-top:10px" id="styleSummary">当前 <b>' + styles.length + '</b> 个风格：工作台生成文案时每个风格独立跑一次，产出 <b>' + styles.length + '</b> 个候选版本（工作台里可以取消勾选）。</div>' +
          '<div style="margin-top:14px"><label class="label">在工作台里的效果预览 <em>左侧参数区</em></label><div id="stylePreview">' + styleCardPreview(styles, true) + '</div></div>';
        },
        mount: function (body, ctx) {
          body.querySelectorAll('[data-sname]').forEach(function (el) {
            el.addEventListener('input', function () {
              ctx.draft.styles[Number(el.dataset.sname)].name = el.value;
              ctx.markDirty();
              refreshStyleSummary(ctx);
            });
          });
          body.querySelectorAll('[data-sreq]').forEach(function (el) {
            el.addEventListener('input', function () {
              ctx.draft.styles[Number(el.dataset.sreq)].requirement = el.value;
              ctx.markDirty();
              refreshStyleSummary(ctx);
            });
          });
          body.querySelectorAll('[data-sup],[data-sdown],[data-sdel]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var list = ctx.draft.styles;
              var i = Number(btn.dataset.sup != null ? btn.dataset.sup : (btn.dataset.sdown != null ? btn.dataset.sdown : btn.dataset.sdel));
              if (btn.dataset.sdel != null) {
                if (list.length <= 1) {
                  /* 删到零要拦住，并说清楚为什么 */
                  A().modal({
                    title: '不能删掉最后一个创作风格',
                    sub: '至少要保留一个风格，工作台才有生成文案的依据。',
                    body: '<div class="help warn">删除操作已被拦住，当前风格数量仍为 ' + list.length + ' 个。' +
                      '<br /><br />如果确实要换风格，可以：① 直接改这个风格的名称与创作要求；' +
                      '② 先新增一个新风格，再把旧的那个删掉。</div>',
                    actions: [{ label: '知道了', kind: 'primary' }]
                  });
                  return;
                }
                list.splice(i, 1);
              } else if (btn.dataset.sup != null && i > 0) {
                var t = list[i - 1]; list[i - 1] = list[i]; list[i] = t;
              } else if (btn.dataset.sdown != null && i < list.length - 1) {
                var t2 = list[i + 1]; list[i + 1] = list[i]; list[i] = t2;
              }
              ctx.markDirty();
              ctx.rerender();
            });
          });
          document.getElementById('addStyle').addEventListener('click', function () {
            ctx.draft.styles.push({
              id: nextId('st_'),
              name: '新创作风格',
              requirement: '',
              enabled: true
            });
            ctx.markDirty();
            ctx.rerender();
            A().toast('已新增一个创作风格，记得写创作要求再保存', 'ok');
          });
        }
      },
      {
        id: 'sec-st-tone', sectionKey: 'tones', short: '语调预设',
        title: '语调预设',
        desc: '这组标签会出现在工作台的「主打语调」下拉里，并作为素材里的 {{语调}} 传给模型。',
        actions: '<button class="btn ghost tiny" data-tpl="tones">填写模板</button>' + '<button class="btn soft tiny" id="addTone">+ 新增语调</button>',
        render: function () {
          var tones = A().getDraft().tones || [];
          return '<div class="rule-list" id="toneList">' + tones.map(function (t, i) {
            return '<div style="display:flex;gap:8px;align-items:center">' +
              '<span class="grip" style="height:34px">' + (i + 1) + '</span>' +
              '<input class="input" style="max-width:280px" data-tone="' + i + '" value="' + esc(t.name || '') + '" placeholder="语调名称，如「互动话题」" />' +
              '<button class="icon-mini danger" data-tdel="' + i + '" title="删除">×</button>' +
            '</div>';
          }).join('') + '</div>' +
          '<div class="help" style="margin-top:10px" id="toneSummary">当前 <b>' + tones.length + '</b> 个语调。工作台里作为「主打语调」的可选项出现，选中后写进素材的「主打语调：」一行传给模型。</div>' +
          '<div style="margin-top:14px"><label class="label">在工作台里的效果预览 <em>Step 4 参数区</em></label>' +
            '<select class="select" style="max-width:320px" id="tonePreview">' + tones.map(function (t) {
              return '<option>' + esc(t.name || '') + '</option>';
            }).join('') + '</select></div>';
        },
        mount: function (body, ctx) {
          body.querySelectorAll('[data-tone]').forEach(function (el) {
            el.addEventListener('input', function () {
              ctx.draft.tones[Number(el.dataset.tone)].name = el.value;
              ctx.markDirty();
              refreshToneSummary(ctx);
            });
          });
          body.querySelectorAll('[data-tdel]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var list = ctx.draft.tones;
              if (list.length <= 1) {
                A().modal({
                  title: '不能删掉最后一个语调',
                  sub: '工作台的「主打语调」需要至少有一个可选项，素材里的 {{语调}} 才不会为空。',
                  body: '<div class="help warn">删除操作已被拦住，当前语调数量仍为 ' + list.length + ' 个。</div>',
                  actions: [{ label: '知道了', kind: 'primary' }]
                });
                return;
              }
              list.splice(Number(btn.dataset.tdel), 1);
              ctx.markDirty();
              ctx.rerender();
            });
          });
          document.getElementById('addTone').addEventListener('click', function () {
            ctx.draft.tones.push({ id: nextId('tn_'), name: '新语调' });
            ctx.markDirty();
            ctx.rerender();
            A().toast('已新增一个语调，保存后工作台里就能选到它', 'ok');
          });
        }
      }
    ]
  };
})();
