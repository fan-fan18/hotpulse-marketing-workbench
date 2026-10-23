/* =========================================================
   HP.AdminTemplates —— 每个数据入口的「填写模板」弹窗
   · 下载空白模板 / 示例模板（CSV、JSON）
   · 导入：先逐行校验出报告，人决定要不要写入
   · 导出：把当前配置里的这一块导成文件
   写入只改编辑区，真正落库仍然走底部「保存配置」
   ========================================================= */
window.HP = window.HP || {};

(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function saveFile(name, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { reject(new Error('读不到这个文件')); };
      fr.readAsText(file, 'utf-8');
    });
  }

  function open(key, ctx) {
    var T = window.HP.Templates;
    if (!T) { ctx.toast('模板模块没有加载', 'warn'); return; }
    var e = T.get(key);
    var fmts = e.formats || ['csv'];
    var hasCsv = fmts.indexOf('csv') >= 0;

    var body =
      '<div class="tpl-block">' +
        '<div class="tpl-h">① 下载模板</div>' +
        '<div class="tpl-p">空白模板只有表头，照着自己填；示例模板带一两行示范写法（不是业务数据，填之前请删掉）。</div>' +
        '<div class="tpl-btns">' +
          (hasCsv ? '<button class="btn ghost tiny" data-dl="blank" data-fmt="csv">空白模板 · CSV</button>' +
                    '<button class="btn ghost tiny" data-dl="sample" data-fmt="csv">示例模板 · CSV</button>' : '') +
          '<button class="btn ghost tiny" data-dl="blank" data-fmt="json">空白模板 · JSON</button>' +
          '<button class="btn ghost tiny" data-dl="sample" data-fmt="json">示例模板 · JSON</button>' +
        '</div>' +
        '<div class="tpl-p">' + (hasCsv ? 'CSV 带 BOM，Excel / WPS 直接打开不乱码；卖点等多项内容用顿号分隔。' : '这一块是多行文本，用 JSON 更好维护。') + '</div>' +
      '</div>' +
      '<div class="tpl-block">' +
        '<div class="tpl-h">② 导入（先校验，再决定）</div>' +
        '<div class="tpl-p">选文件后先出校验报告：有问题的行会列出行号和原因，确认后再写入编辑区。写入只改编辑区，底部「保存配置」才真正落库。</div>' +
        '<input type="file" class="input" id="tplFile" accept=".csv,.json,.txt,text/csv,application/json" />' +
        '<div id="tplReport" style="margin-top:10px"></div>' +
      '</div>' +
      '<div class="tpl-block">' +
        '<div class="tpl-h">③ 导出当前数据</div>' +
        '<div class="tpl-p">把配置里这一块导成文件（' + esc(e.unit || '条') + '），可以改完再导回来。' +
          (e.jsonOnly ? '密钥不会被导出。' : '') + '</div>' +
        '<div class="tpl-btns">' +
          (hasCsv ? '<button class="btn ghost tiny" data-exp="csv">导出 CSV</button>' : '') +
          '<button class="btn ghost tiny" data-exp="json">导出 JSON</button>' +
        '</div>' +
      '</div>';

    ctx.modal({
      title: '「' + e.name + '」数据模板',
      sub: esc(e.desc || ''),
      body: body,
      actions: [{ label: '关闭', kind: 'ghost' }],
      onMount: function (mask, close) {
        var report = mask.querySelector('#tplReport');
        var pending = null;   // { items, errors, objectMode }

        mask.querySelectorAll('[data-dl]').forEach(function (b) {
          b.addEventListener('click', function () {
            var fmt = b.getAttribute('data-fmt');
            var kind = b.getAttribute('data-dl');
            var text = kind === 'blank' ? T.blank(key, fmt) : T.sample(key, fmt);
            saveFile(T.fileName(key, kind, fmt), text, fmt === 'json' ? 'application/json' : 'text/csv');
            ctx.toast('已下载' + (kind === 'blank' ? '空白模板' : '示例模板'), 'ok');
          });
        });

        mask.querySelectorAll('[data-exp]').forEach(function (b) {
          b.addEventListener('click', function () {
            var fmt = b.getAttribute('data-exp');
            var text = T.exportCurrent(key, ctx.draft, fmt);
            saveFile(T.fileName(key, 'export', fmt), text, fmt === 'json' ? 'application/json' : 'text/csv');
            ctx.toast('已导出当前' + e.name + '（' + fmt.toUpperCase() + '）', 'ok');
          });
        });

        mask.querySelector('#tplFile').addEventListener('change', function (ev) {
          var file = ev.target.files && ev.target.files[0];
          if (!file) return;
          readFile(file).then(function (text) {
            var r = T.preview(key, text, file.name, ctx.draft);
            pending = r;
            report.innerHTML = renderReport(key, e, r, file.name);
            wireApply(mask, report, ctx, e, function () { return pending; }, close);
          }).catch(function (err) {
            report.innerHTML = '<div class="err-note"><span>!</span><div>读文件失败：' + esc(err.message) + '</div></div>';
          });
        });
      }
    });
  }

  function renderReport(key, e, r, fileName) {
    if (r.fatal) {
      return '<div class="err-note"><span>!</span><div><b>这份文件不能导入：</b>' +
        esc(r.fatal).replace(/\n/g, '<br />') +
        '<div class="help" style="margin-top:8px">原有配置没有受到任何影响。改好文件后可以再选一次。</div></div></div>';
    }
    var total = r.items.length;
    var bad = r.errors.length;
    var okRows = total - bad;
    var html = '';
    if (r.objectMode) {
      html += r.ok
        ? '<div class="ok-note"><span>✓</span><div>文件格式正确，可以写入编辑区。</div></div>'
        : '<div class="err-note"><span>!</span><div><b>文件格式有问题：</b><br />' +
          r.errors.map(function (x) { return esc(x.reasons.join('；')); }).join('<br />') + '</div></div>';
    } else {
      html += '<div class="' + (bad ? 'err-note' : 'ok-note') + '"><span>' + (bad ? '!' : '✓') + '</span><div>' +
        '共 <b>' + total + '</b> 行数据：通过 <b>' + okRows + '</b> 行' + (bad ? '，有问题 <b>' + bad + '</b> 行' : '') + '。' +
        (bad ? '<div class="help" style="margin-top:6px">有问题的行不会被写入；修好文件重新导入，或只导入通过校验的行。</div>' : '') +
        '</div></div>';
      if (bad) {
        html += '<div class="tpl-errs"><table class="tbl"><thead><tr><th style="width:70px">行号</th><th>原因</th></tr></thead><tbody>' +
          r.errors.slice(0, 40).map(function (x) {
            return '<tr><td>第 ' + x.row + ' 行</td><td>' + esc(x.reasons.join('；')) + '</td></tr>';
          }).join('') + '</tbody></table>' +
          (r.errors.length > 40 ? '<div class="help">（只列前 40 行，共 ' + r.errors.length + ' 行有问题）</div>' : '') + '</div>';
      }
    }
    if (r.warnings && r.warnings.length) {
      html += '<div class="help info" style="margin-top:8px">提醒 ' + r.warnings.length + ' 条：' +
        r.warnings.slice(0, 6).map(function (w) {
          return '第 ' + w.row + ' 行 ' + esc(w.msg || '') ;
        }).join('；') + (r.warnings.length > 6 ? ' …' : '') + '</div>';
    }
    html += '<div class="tpl-apply">';
    if (!r.objectMode) {
      html += '<label class="label" style="margin:0">写入方式</label>' +
        '<select class="select" id="tplMode" style="max-width:260px">' +
        '<option value="replace">替换现有' + esc(e.name) + '</option>' +
        '<option value="append">追加到现有' + esc(e.name) + '</option></select>';
    }
    html += '<button class="btn primary tiny" id="tplApply"' + (r.ok ? '' : (okRows ? '' : ' disabled')) + '>' +
      (r.ok ? '写入编辑区' : (okRows ? '只写入通过校验的 ' + okRows + ' 行' : '没有可写入的行')) + '</button>' +
      '</div>';
    return html;
  }

  function wireApply(mask, report, ctx, e, getPending, close) {
    var btn = report.querySelector('#tplApply');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var r = getPending();
      if (!r || r.fatal) return;
      var modeEl = report.querySelector('#tplMode');
      var mode = modeEl ? modeEl.value : 'replace';
      var items = r.objectMode ? r.items : r.items.filter(function (_, i) {
        return !r.errors.some(function (x) { return x.row === i + 1; });
      });
      try {
        var stat = window.HP.Templates.apply(e.key, items, ctx.draft, { mode: mode, objectMode: r.objectMode });
        ctx.markDirty();
        ctx.rerender();
        var parts = [];
        if (stat.replaced) parts.push('覆盖 ' + stat.replaced + ' ' + (e.unit || '条'));
        if (stat.added) parts.push('新增 ' + stat.added + ' ' + (e.unit || '条'));
        if (stat.skipped) parts.push('跳过 ' + stat.skipped + ' ' + (e.unit || '条'));
        ctx.toast('已写入编辑区：' + (parts.join('，') || '无变化') + '（还没保存，记得点底部「保存配置」）', 'ok');
        close();
      } catch (err) {
        report.insertAdjacentHTML('afterbegin',
          '<div class="err-note"><span>!</span><div>' + esc(err.message) + '</div></div>');
      }
    });
  }

  window.HP.AdminTemplates = { open: open };
})();
