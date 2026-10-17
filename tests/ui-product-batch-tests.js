/* 商品库：批量操作 + 导入导出 验收（真实浏览器 + 真实服务端）
   批量操作
     验收 1：多选后批量改品类，列表和统计同步更新
     验收 2：删除一件被热点推荐引用的商品，确认框里能看到引用数量提示
     验收 3：删除后回到工作台，原本推荐它的热点不再出现这件商品，且页面不报错
   导入导出
     验收 1：导出表格文件 → 改几行 → 导回来，改动生效
     验收 2：某行价格为负 → 导入前就能看到第几行、什么问题
     验收 3：导出再导入，商品数量和内容完全一致
   运行：node tests/ui-product-batch-tests.js */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const APP_PORT = 8814;
const APP = 'http://127.0.0.1:' + APP_PORT;
const TMP = path.join(ROOT, 'work', 'tmp');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
/* 就近查找 playwright-core：优先工作区内 .test-tools，其次旧的全局位置 */
const PW_CANDIDATES = [
  path.join(ROOT, '.test-tools', 'node_modules'),
  path.join(ROOT, 'node_modules'),
  path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'openclaw', 'node_modules')
];
function loadPlaywright() {
  for (const dir of PW_CANDIDATES) {
    try { return createRequire(path.join(dir, 'noop.js'))('playwright-core'); } catch (e) { /* 继续找下一个 */ }
  }
  throw new Error('没有找到 playwright-core；请先执行： npm install playwright-core --prefix .test-tools --no-save');
}

const out = { startedAt: new Date().toISOString(), checks: [], numbers: {} };
let pass = 0, fail = 0;
function check(name, cond, detail) {
  out.checks.push({ name, ok: !!cond, detail: detail === undefined ? '' : detail });
  if (cond) { pass++; console.log('  ✓ ' + name + '  → ' + detail); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + detail); }
}
async function getConfig() { return (await (await fetch(APP + '/api/config')).json()).config; }
async function putConfig(cfg) {
  const r = await fetch(APP + '/api/config', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: cfg })
  });
  return { status: r.status, json: await r.json() };
}
async function revertIfDirty(page) {
  const btn = page.locator('#btnRevert');
  if (await btn.isEnabled()) { await btn.click(); await page.waitForTimeout(600); }
  else { await page.waitForTimeout(200); }   // 内容和已保存一致时按钮是禁用的
}
async function draft(page) { return page.evaluate(() => window.HP.Admin.getDraft()); }
async function domCats(page) {
  return page.$$eval('#prList tbody tr', rows => {
    const s = new Set();
    rows.forEach(tr => s.add(tr.querySelector('.td-cat').textContent.trim()));
    return { rows: rows.length, cats: s.size };
  });
}

(async function run() {
  const { chromium } = loadPlaywright();
  fs.mkdirSync(TMP, { recursive: true });
  const app = spawn('node', [path.join(ROOT, 'server', 'server.js'), String(APP_PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) jsErrors.push(m.text());
  });

  const original = await getConfig();

  /* ================= 批量操作：多选 + 批量改品类 ================= */
  console.log('== 批量改品类（验收 1）==');
  await page.goto(APP + '/admin.html#/products');
  await page.waitForTimeout(1100);
  const beforeCats = (await domCats(page)).cats;

  /* 每次点击后列表会重绘，所以要用 locator 重新解析元素，不能用缓存的 handle */
  for (const i of [0, 1, 2]) {
    await page.locator('#prList tbody [data-pick]').nth(i).click();
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(400);
  const barText = await page.locator('#prBatchBar').innerText();
  check('多选后出现批量操作栏并显示已选数量', /已选 3 件/.test(barText),
    barText.replace(/\s+/g, ' ').slice(0, 60));

  await page.fill('#batchCat', '实测批量品类');
  await page.click('#batchSetCat');
  await page.waitForTimeout(600);
  const res1 = (await page.locator('.admin-modal').innerText()).replace(/\s+/g, ' ');
  check('批量改品类给出结果反馈（成功 / 跳过）', /成功 3 条/.test(res1) && /跳过 0 条/.test(res1),
    res1.slice(0, 60));
  await page.locator('.admin-modal .btn').first().click();
  await page.waitForTimeout(400);

  const afterRows = await page.$$eval('#prList tbody tr', rows => rows.slice(0, 3).map(tr => tr.querySelector('.td-cat').textContent.trim()));
  const domNow = await domCats(page);
  const statsCards = await page.$$eval('#prStats .card-mini', cs => cs.map(c => c.querySelector('.v').textContent.trim()));
  check('列表同步更新：前三件都变成新品类', afterRows.every(c => c === '实测批量品类'),
    '前三行品类：' + afterRows.join('、'));
  check('统计同步更新：品类数与列表实际一致',
    Number(statsCards[1].replace(/\D/g, '')) === domNow.cats,
    '统计品类数 ' + statsCards[1] + ' = 列表实际 ' + domNow.cats + ' 个（原 ' + beforeCats + ' 个）');
  out.numbers['批量改品类'] = '3 件 → 实测批量品类，统计品类数同步为 ' + domNow.cats;
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-23-批量改品类.png') });

  /* 重复操作走"跳过"分支，验证跳过原因 */
  await page.click('#batchClear');                       // 先清空选择（否则再点一次复选框会取消勾选）
  await page.waitForTimeout(300);
  for (const i of [0, 1, 2]) {
    await page.locator('#prList tbody [data-pick]').nth(i).click();
    await page.waitForTimeout(200);
  }
  await page.fill('#batchCat', '实测批量品类');
  await page.click('#batchSetCat');
  await page.waitForTimeout(600);
  const res2 = (await page.locator('.admin-modal').innerText()).replace(/\s+/g, ' ');
  check('重复改同一品类：成功 0 / 跳过 3，并说明原因',
    /成功 0 条/.test(res2) && /跳过 3 条/.test(res2) && /品类本来就是/.test(res2),
    res2.slice(0, 90));
  await page.locator('.admin-modal .btn').first().click();
  await page.waitForTimeout(300);
  await page.click('#batchClear');
  await page.waitForTimeout(300);
  check('取消选择后批量栏消失', (await page.locator('#prBatchBar').innerText()).trim() === '', '批量栏已收起');

  /* 撤销掉批量改品类的草稿，回到原始数据 */
  await revertIfDirty(page);
  check('撤销后回到原始品类', (await domCats(page)).cats === beforeCats,
    '品类数回到 ' + (await domCats(page)).cats + ' 个');

  /* ================= 删除前的引用检查（验收 2）================= */
  console.log('\n== 删除被热点引用的商品（验收 2）==');
  const refTarget = await page.evaluate(() => {
    const products = window.HP.Config.get().products;
    for (const p of products) {
      const r = window.HP.Products.refsOf(p.id, products);
      if (r.preset.length) return { id: p.id, name: p.name, refs: r.preset.length, titles: r.preset.map(x => x.title) };
    }
    return null;
  });
  check('找到一件被热点推荐引用的商品', !!refTarget,
    refTarget ? refTarget.id + ' ' + refTarget.name + '（被 ' + refTarget.refs + ' 条热点引用）' : '没找到');

  await page.fill('#prKeyword', refTarget.name.slice(0, 6));
  await page.waitForTimeout(500);
  await page.locator('#prList tbody [data-pick]').first().click();
  await page.waitForTimeout(300);
  await page.click('#batchDel');
  await page.waitForTimeout(600);
  const confirmText = (await page.locator('.admin-modal').innerText()).replace(/\s+/g, ' ');
  check('删除确认框里说清了引用数量',
    new RegExp('有 ' + refTarget.refs + ' 处热点推荐引用了这些商品').test(confirmText) &&
    /删除后这些推荐会失效/.test(confirmText),
    (confirmText.match(/[^。]*引用[^。]*。/) || [''])[0].slice(0, 80));
  check('确认框里列出了具体热点与引用条数',
    confirmText.indexOf(refTarget.titles[0].slice(0, 10)) > -1 && new RegExp(refTarget.refs + ' 条').test(confirmText),
    '涉及热点：' + refTarget.titles[0].slice(0, 18));
  check('删除要求二次确认', /确认删除这 1 件商品/.test(confirmText), '标题：确认删除这 1 件商品？');
  out.numbers['引用检查'] = refTarget.id + ' 被 ' + refTarget.refs + ' 条热点引用';
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-24-删除引用检查.png') });

  /* 先点取消，验证"二次确认"确实拦得住 */
  await page.locator('.admin-modal .btn', { hasText: '取消' }).click();
  await page.waitForTimeout(400);
  check('点取消后商品没有被删除', (await draft(page)).products.length === original.products.length,
    '商品数仍为 ' + (await draft(page)).products.length);

  /* 再走一次，确认删除（取消后选中状态仍保留，不需要重新勾选） */
  await page.click('#batchDel');
  await page.waitForTimeout(500);
  await page.locator('.admin-modal .btn', { hasText: '确认删除' }).click();
  await page.waitForTimeout(600);
  const delResult = (await page.locator('.admin-modal').innerText()).replace(/\s+/g, ' ');
  check('批量删除给出结果反馈', /成功 1 条/.test(delResult) && /跳过 0 条/.test(delResult),
    delResult.slice(0, 60));
  await page.locator('.admin-modal .btn', { hasText: '知道了' }).click();
  await page.waitForTimeout(300);
  await page.click('#btnSave');
  await page.waitForTimeout(1000);
  const afterDel = await getConfig();
  check('保存后服务端商品库里少了这一件',
    afterDel.products.length === original.products.length - 1 &&
    !afterDel.products.some(p => p.id === refTarget.id),
    original.products.length + ' → ' + afterDel.products.length + ' 件');

  /* ================= 验收 3：工作台不再推荐它，且不报错 ================= */
  console.log('\n== 删除后回工作台（验收 3）==');
  await page.goto(APP + '/index.html');
  await page.waitForTimeout(800);
  await page.locator('.news-item').first().click();
  await page.waitForTimeout(900);
  const wbCards = await page.$$eval('.product-card', els => els.map(el => el.dataset.pid));
  check('原本推荐它的热点不再出现这件商品',
    wbCards.indexOf(refTarget.id) < 0 && wbCards.length > 0,
    'Step 2 推荐 ' + wbCards.length + ' 件，其中不含 ' + refTarget.id);
  check('页面没有报错、推荐列表正常渲染', jsErrors.length === 0 && wbCards.length > 0,
    jsErrors.length ? jsErrors[0] : '无脚本异常');

  /* 已绑定商品被删除：进入 Step 3 自动清理，不报错 */
  await page.goto(APP + '/index.html');
  await page.waitForTimeout(700);
  await page.locator('.news-item').first().click();
  await page.waitForTimeout(800);
  const bindTarget = await page.locator('.product-card').first().getAttribute('data-pid');
  await page.locator('.product-card [data-pick]').first().click();
  await page.waitForTimeout(300);
  const victimName = await page.evaluate(id => window.HP.Config.get().products.filter(p => p.id === id)[0].name,
    await page.evaluate(() => window.HP.Config.get().products[0].id));
  /* 在另一个标签页删掉"当前被绑定"的那件商品并保存 */
  const page2 = await ctx.newPage();
  await page2.goto(APP + '/admin.html#/products');
  await page2.waitForTimeout(1000);
  const victimId = await page.evaluate(() => {
    const bound = window.HP.Config.get().products[0].id;
    return bound;
  });
  await page2.evaluate((id) => {
    const d = window.HP.Admin.getDraft();
    d.products = d.products.filter(p => p.id !== id);
    window.HP.Admin.markDirty();
  }, victimId);
  await page2.waitForTimeout(400);
  await page2.click('#btnSave');
  await page2.waitForTimeout(900);
  await page2.close();
  check('在另一个标签页删掉了工作台已绑定的商品', (await getConfig()).products.every(p => p.id !== victimId),
    '已删除 ' + victimId + ' ' + victimName);

  await page.locator('#view-2 .head-actions .btn.primary').click();   // 进 Step 3
  await page.waitForTimeout(700);
  const bindListText = await page.locator('#bindList').innerText();
  check('工作台自动清理了失效绑定且没有报错',
    /已从商品库删除，已自动移除/.test(bindListText) && jsErrors.length === 0,
    bindListText.replace(/\s+/g, ' ').slice(0, 50));
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'workbench-删除后自动清理绑定.png') });

  /* 恢复原始配置，保证可重复运行 */
  await putConfig(original);

  /* ================= 导入导出：验收 3（导出再导入一致）================= */
  console.log('\n== 导出再导入（验收 3）==');
  await page.goto(APP + '/admin.html#/products');
  await page.waitForTimeout(1000);
  const [dlJson] = await Promise.all([page.waitForEvent('download'), page.click('#prExpJson')]);
  const jsonFile = path.join(TMP, 'products-export.json');
  await dlJson.saveAs(jsonFile);
  const jsonText = fs.readFileSync(jsonFile, 'utf8');
  const jsonData = JSON.parse(jsonText);
  check('导出的结构化数据文件内容完整',
    jsonData.type === 'hotpulse.products' && jsonData.products.length === original.products.length,
    '文件 ' + fs.statSync(jsonFile).size + ' 字节，含 ' + jsonData.products.length + ' 件商品');

  await page.setInputFiles('#prFile', jsonFile);
  await page.waitForTimeout(800);
  const okModal = (await page.locator('.admin-modal').innerText()).replace(/\s+/g, ' ');
  check('导入前给出校验通过报告', /导入前校验通过/.test(okModal) && /可以导入/.test(okModal),
    okModal.slice(0, 60));
  await page.locator('.admin-modal .btn', { hasText: '导入并替换商品库' }).click();
  await page.waitForTimeout(800);
  const doneModal = (await page.locator('.admin-modal').innerText()).replace(/\s+/g, ' ');
  check('导入完成给出结果（成功条数）', /成功导入/.test(doneModal) && /跳过 0 条/.test(doneModal),
    doneModal.slice(0, 60));
  await page.locator('.admin-modal .btn', { hasText: '稍后保存' }).click();
  await page.waitForTimeout(400);
  const draftAfterImport = await draft(page);
  check('导出再导入：商品数量与内容完全一致',
    JSON.stringify(draftAfterImport.products) === JSON.stringify(original.products),
    draftAfterImport.products.length + ' 件逐字段比对一致');
  out.numbers['JSON 往返'] = draftAfterImport.products.length + ' 件完全一致';
  await revertIfDirty(page);

  /* ================= 导入导出：验收 1（CSV 往返 + 改几行）================= */
  console.log('\n== 表格文件往返（验收 1）==');
  const [dlCsv] = await Promise.all([page.waitForEvent('download'), page.click('#prExpCsv')]);
  const csvFile = path.join(TMP, 'products-export.csv');
  await dlCsv.saveAs(csvFile);
  const csvText = fs.readFileSync(csvFile, 'utf8');
  const csvLines = csvText.split('\r\n');
  check('表格文件格式正确（BOM + 中文表头 + CRLF + 行数）',
    csvText.charCodeAt(0) === 0xFEFF &&
    csvLines[0].replace('\ufeff', '') === '名称,售价,原价,品类,卖点,图标' &&
    csvLines.length === original.products.length + 1,
    '表头「' + csvLines[0].replace('\ufeff', '') + '」，共 ' + (csvLines.length - 1) + ' 行数据');
  check('每行列数一致（表格软件可正常按列打开）',
    csvLines.slice(1).every(l => l.trim() === '' || l.split(',').length >= 6 || l.indexOf('"') > -1),
    '示例行：' + csvLines[1].slice(0, 56));
  out.numbers['CSV 结构'] = (csvLines.length - 1) + ' 行 / 6 列 / 带 BOM';

  /* 模拟"用表格软件改几行"：改第 1 行售价、改第 2 行卖点 */
  const edited = csvLines.slice();
  edited[1] = edited[1].replace(',299,', ',288,');
  const second = original.products[1];
  edited[2] = '"' + second.name + '",' + second.price + ',' + second.marketPrice + ',' + second.cat +
    ',"表格里改过的卖点、第二个卖点",' + second.emoji;
  const editedFile = path.join(TMP, 'products-edited.csv');
  fs.writeFileSync(editedFile, edited.join('\r\n'), 'utf8');

  await page.setInputFiles('#prFile', editedFile);
  await page.waitForTimeout(800);
  await page.locator('.admin-modal .btn', { hasText: '导入并替换商品库' }).click();
  await page.waitForTimeout(700);
  await page.locator('.admin-modal .btn', { hasText: '稍后保存' }).click();
  await page.waitForTimeout(400);
  const editedDraft = await draft(page);
  check('表格里改过的售价生效',
    editedDraft.products[0].price === 288,
    '第 1 件售价 299 → ' + editedDraft.products[0].price);
  check('表格里改过的卖点生效',
    editedDraft.products[1].points.join('|') === '表格里改过的卖点|第二个卖点',
    '第 2 件卖点：' + editedDraft.products[1].points.join('、'));
  check('其它商品保持不变（数量与内容）',
    editedDraft.products.length === original.products.length &&
    editedDraft.products[2].name === original.products[2].name,
    '仍为 ' + editedDraft.products.length + ' 件');
  out.numbers['CSV 改行导回'] = '售价 299→288、第 2 件卖点替换生效';
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-25-导入报告.png') });
  await revertIfDirty(page);

  /* ================= 导入导出：验收 2（负数价格行）================= */
  console.log('\n== 价格为负数的文件（验收 2）==');
  const badRows = [
    '名称,售价,原价,品类,卖点,图标',
    '正常商品,99,199,家居日用,耐用、好看,🎁',
    '负价格商品,-5,199,家居日用,耐用、好看,🎁',
    '原价低于售价,299,199,家居日用,耐用、好看,🎁'
  ].join('\r\n');
  const badFile = path.join(TMP, 'products-negative.csv');
  fs.writeFileSync(badFile, '\ufeff' + badRows, 'utf8');
  const countBefore = (await draft(page)).products.length;
  await page.setInputFiles('#prFile', badFile);
  await page.waitForTimeout(800);
  const badModal = (await page.locator('.admin-modal').innerText()).replace(/\s+/g, ' ');
  check('导入前就能看到第几行、什么问题',
    /第 2 行/.test(badModal) && /售价必须是大于 0 的数字（当前：-5）/.test(badModal),
    (badModal.match(/第 2 行[^第]*/) || [''])[0].slice(0, 60));
  check('原价低于售价的行也被列出来', /第 3 行/.test(badModal) && /不能低于售价/.test(badModal),
    (badModal.match(/第 3 行[^第]*/) || [''])[0].slice(0, 50));
  check('明确说明导入已被阻止、原有配置未受影响',
    /导入已阻止/.test(badModal) && /原有商品库未受影响/.test(badModal),
    badModal.slice(0, 46));
  check('给出"只导入通过校验的行"的选择', /仅导入通过校验的 1 行/.test(badModal),
    '可选项：仅导入通过校验的 1 行');
  check('没有写入任何数据（商品数与导入前一致）',
    (await draft(page)).products.length === countBefore,
    '商品数仍为 ' + countBefore);
  out.numbers['负数价格拦截'] = '第 2 行售价 -5、第 3 行原价低于售价，均被列出';
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-26-导入校验报告.png') });
  await page.locator('.admin-modal .btn', { hasText: '取消，我去改文件' }).click();
  await page.waitForTimeout(400);

  /* ================= 收尾 ================= */
  await revertIfDirty(page);
  await putConfig(original);
  const finalCfg = await getConfig();
  check('测试收尾：服务端商品库恢复为原始 ' + original.products.length + ' 件',
    JSON.stringify(finalCfg.products) === JSON.stringify(original.products),
    '商品数 ' + finalCfg.products.length);
  check('全流程没有前端脚本报错', jsErrors.length === 0, jsErrors.length ? jsErrors.slice(0, 2).join(' | ') : '无脚本异常');

  await browser.close();
  await new Promise(function (resolve) {
    let done = false;
    app.once('exit', function () { done = true; resolve(); });
    app.kill();
    setTimeout(function () { if (!done) resolve(); }, 1200);
  });
  await new Promise(r => setTimeout(r, 200));

  out.finishedAt = new Date().toISOString();
  out.pass = pass;
  out.fail = fail;
  fs.writeFileSync(path.join(ROOT, 'work', 'ui-product-batch-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/ui-product-batch-results.json');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('验收异常：', e); process.exit(2); });
