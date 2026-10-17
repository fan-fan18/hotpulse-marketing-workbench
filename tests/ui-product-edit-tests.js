/* 商品新增 / 编辑 验收（真实浏览器 + 真实服务端）
   验收 1：新增一件商品后，工作台能搜到它，匹配算法也能把它推荐出来
   验收 2：原价填得比售价低 → 看到明确提示且保存被拦住
   验收 3：改图标或配色 → 预览卡片立即变化
   另测：编号自动生成不重复、名称/品类/卖点等字段级校验、编辑现有商品、预览卡与工作台同源
   运行：node tests/ui-product-edit-tests.js */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const APP_PORT = 8813;
const APP = 'http://127.0.0.1:' + APP_PORT;
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

const NEW_NAME = '实测新品 加绒保暖防风外套';
const NEW_POINTS = ['加绒保暖不透风', '防风防泼水面料'];

const out = { startedAt: new Date().toISOString(), checks: [], numbers: {} };
let pass = 0, fail = 0;
function check(name, cond, detail) {
  out.checks.push({ name, ok: !!cond, detail: detail === undefined ? '' : detail });
  if (cond) { pass++; console.log('  ✓ ' + name + '  → ' + detail); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + detail); }
}
async function getConfig() { return (await (await fetch(APP + '/api/config')).json()).config; }
async function draft(page) { return page.evaluate(() => window.HP.Admin.getDraft()); }
async function shadowErr(page, field) {
  return page.evaluate(f => {
    const el = document.getElementById('e-' + f);
    return el && !el.hidden ? el.textContent.trim() : '';
  }, field);
}
async function setInput(page, sel, value) {
  await page.fill(sel, value);
  await page.waitForTimeout(120);
}

(async function run() {
  const { chromium } = loadPlaywright();
  const app = spawn('node', [path.join(ROOT, 'server', 'server.js'), String(APP_PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 } });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) jsErrors.push(m.text());
  });

  const before = await getConfig();
  const beforeCount = before.products.length;
  const existingIds = before.products.map(p => p.id);

  /* ================= 打开新增弹窗 ================= */
  console.log('== 新增商品弹窗 ==');
  await page.goto(APP + '/admin.html#/products');
  await page.waitForTimeout(1100);
  await page.click('#addProduct');
  await page.waitForTimeout(600);
  check('点「新增商品」弹出弹窗', (await page.locator('.admin-modal').count()) === 1,
    (await page.locator('.admin-modal h3').innerText()).trim());

  const autoId = await page.locator('#f-id').inputValue();
  check('编号自动生成且不与现有编号重复',
    /^p\d+$/.test(autoId) && existingIds.indexOf(autoId) < 0,
    '自动编号 ' + autoId + '（现有最大编号 ' + existingIds[existingIds.length - 1] + '）');
  check('编号字段为只读', (await page.locator('#f-id').getAttribute('readonly')) !== null);

  const previewInfo0 = await page.evaluate(() => {
    const el = document.querySelector('#editorPreview .product-card');
    return el ? { exists: true, name: el.querySelector('.product-name').textContent, cat: el.querySelector('.cat-tag').textContent } : { exists: false };
  });
  check('弹窗右侧有实时预览卡片', previewInfo0.exists, '预览卡名称：' + previewInfo0.name);
  out.numbers['自动编号'] = autoId;
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-21-新增商品弹窗.png') });

  /* ================= 验收 3：改图标 / 配色，预览立即变 ================= */
  console.log('\n== 验收 3：改图标或配色，预览卡片立即变化 ==');
  const gradBefore = await page.evaluate(() => document.querySelector('#editorPreview .thumb').style.background);
  await page.locator('#emojiGrid [data-emoji="🧣"]').click();
  await page.waitForTimeout(250);
  const afterEmoji = await page.evaluate(() => ({
    input: document.getElementById('f-emoji').value,
    preview: document.querySelector('#editorPreview .thumb span').textContent
  }));
  check('点图标面板：输入框与预览卡同时变化',
    afterEmoji.input === '🧣' && afterEmoji.preview === '🧣',
    '输入框 ' + afterEmoji.input + '，预览卡 ' + afterEmoji.preview);

  await page.fill('#f-emoji', '🧤');
  await page.waitForTimeout(250);
  const manualEmoji = await page.evaluate(() => ({
    preview: document.querySelector('#editorPreview .thumb span').textContent
  }));
  check('手动输入图标同样即时生效', manualEmoji.preview === '🧤', '预览卡图标 ' + manualEmoji.preview);

  await page.locator('#gradGrid [data-grad="mint"]').click();
  await page.waitForTimeout(250);
  const gradAfter = await page.evaluate((beforeGrad) => {
    /* 浏览器会把渐变规范化（#e6f8f2 → rgb(230, 248, 242)），所以两边都过一遍 CSSOM 再比 */
    const probe = document.createElement('div');
    probe.style.background = window.HP.Config.GRADIENTS.mint;
    const thumb = document.querySelector('#editorPreview .thumb');
    return {
      preview: thumb.style.background,
      expect: probe.style.background,
      changed: thumb.style.background !== beforeGrad
    };
  }, gradBefore);
  check('点配色：预览卡背景立即切换', gradAfter.preview === gradAfter.expect && gradAfter.changed,
    '变化前 ' + gradBefore.replace(/\s/g, '').slice(0, 30) + ' → 变化后 ' + gradAfter.preview.replace(/\s/g, '').slice(0, 30));
  out.numbers['图标/配色'] = '🧣 / 🧤 / mint 均即时反映到预览卡';

  /* ================= 验收 2：原价低于售价被拦住 ================= */
  console.log('\n== 验收 2：原价低于售价 → 明确提示且保存被拦住 ==');
  await page.click('.admin-modal [data-act="1"]');       // 先点一次保存，触发校验
  await page.waitForTimeout(400);
  check('名称未填 → 提示「名称必填」', /名称必填/.test(await shadowErr(page, 'name')),
    await shadowErr(page, 'name'));
  check('品类未填 → 提示具体原因', /品类不能为空/.test(await shadowErr(page, 'cat')),
    await shadowErr(page, 'cat'));
  check('卖点未填 → 提示建议 2–4 个', /至少要写 1 个卖点/.test(await shadowErr(page, 'points')),
    await shadowErr(page, 'points'));
  check('保存被拦住，弹窗没有关闭', (await page.locator('.admin-modal').count()) === 1,
    '弹窗仍在');

  await setInput(page, '#f-name', NEW_NAME);
  await setInput(page, '#f-cat', '服饰鞋包');
  for (const t of NEW_POINTS) {
    await page.fill('#pointInput', t);
    await page.press('#pointInput', 'Enter');
    await page.waitForTimeout(150);
  }
  const pills = await page.locator('#pointEditor .tag-pill').count();
  check('卖点用标签输入（回车添加）', pills === 2, '已添加 ' + pills + ' 个卖点标签');

  await setInput(page, '#f-price', '299');
  await setInput(page, '#f-market', '199');
  await page.waitForTimeout(300);
  const marketErr = await shadowErr(page, 'market');
  const offText = await page.locator('#f-off').inputValue();
  check('原价低于售价 → 字段下方给出具体原因',
    /原价 199 低于售价 299/.test(marketErr) && /保存被拦住/.test(marketErr),
    marketErr);
  check('折扣率实时显示为 —（不合法时不显示折扣）', offText === '—', '折扣率字段：' + offText);

  const countBeforeSave = (await draft(page)).products.length;
  await page.click('.admin-modal [data-act="1"]');
  await page.waitForTimeout(500);
  const countAfterBlocked = (await draft(page)).products.length;
  check('点保存被拦住：商品数量没有变化、弹窗未关闭',
    countAfterBlocked === countBeforeSave && (await page.locator('.admin-modal').count()) === 1,
    '商品数仍为 ' + countAfterBlocked + '，弹窗仍在');
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-22-原价校验拦截.png') });

  const sellerToast = (await page.locator('#toastWrap').innerText().catch(() => '')).replace(/\n/g, ' ');
  check('同时给出总体提示（不只是字段级）', /没填对/.test(sellerToast), sellerToast.slice(0, 40));

  /* 修正后可以保存 */
  await setInput(page, '#f-market', '599');
  await page.waitForTimeout(300);
  check('修正原价后折扣率实时算出', (await page.locator('#f-off').inputValue()) === '50.1%',
    '折扣率 ' + (await page.locator('#f-off').inputValue()));
  await page.click('.admin-modal [data-act="1"]');
  await page.waitForTimeout(600);
  check('修正后保存成功：弹窗关闭、商品进入草稿',
    (await page.locator('.admin-modal').count()) === 0 &&
    (await draft(page)).products.length === beforeCount + 1,
    '商品数 ' + beforeCount + ' → ' + (await draft(page)).products.length);
  check('商品库页面出现新增提示（未保存）',
    (await page.locator('#barTitle').innerText()).trim() === '有未保存的改动',
    '状态栏：' + (await page.locator('#barTitle').innerText()).trim());
  out.numbers['校验拦截'] = marketErr.slice(0, 34) + '…';

  /* ================= 保存配置 + 验证工作台 ================= */
  console.log('\n== 验收 1：新增后工作台能搜到、也能被推荐 ==');
  await page.click('#btnSave');
  await page.waitForTimeout(1000);
  const saved = await getConfig();
  check('保存后服务端商品库里多了这件商品',
    saved.products.length === beforeCount + 1 && !!saved.products.filter(p => p.name === NEW_NAME).length,
    '商品数 ' + beforeCount + ' → ' + saved.products.length);
  const newProduct = saved.products.filter(p => p.name === NEW_NAME)[0];
  out.numbers['新增商品'] = newProduct.id + ' / ' + newProduct.name;

  /* 工作台 Step 3：搜到它 */
  await page.goto(APP + '/index.html');
  await page.waitForTimeout(800);
  await page.locator('.news-item').first().click();
  await page.waitForTimeout(800);
  await page.locator('.product-card [data-pick]').first().click();
  await page.waitForTimeout(200);
  await page.locator('#view-2 .head-actions .btn.primary').click();
  await page.waitForTimeout(400);
  await page.fill('#libKeyword', '实测新品');
  await page.waitForTimeout(500);
  const foundRows = await page.locator('#libBody tr').count();
  const foundName = foundRows ? (await page.locator('#libBody tr').first().locator('b').first().innerText()).trim() : '';
  check('工作台「匹配商品」里能搜到新增的商品',
    foundRows === 1 && foundName === NEW_NAME,
    '搜「实测新品」命中 ' + foundRows + ' 行：' + foundName);

  /* 工作台 Step 3：按卖点也能搜到 */
  await page.fill('#libKeyword', '加绒保暖不透风');
  await page.waitForTimeout(500);
  check('按卖点里的词也能搜到它', (await page.locator('#libBody tr').count()) >= 1,
    '搜卖点「加绒保暖不透风」命中 ' + (await page.locator('#libBody tr').count()) + ' 行');

  /* 工作台 Step 2：匹配算法把它推荐出来 */
  await page.goto(APP + '/index.html');
  await page.waitForTimeout(800);
  await page.locator('.news-item').first().click();      // 冷空气来袭（保暖类热点）
  await page.waitForTimeout(900);
  const matched = await page.$$eval('.product-card', els => els.map(el => ({
    id: el.dataset.pid,
    name: el.querySelector('.product-name').textContent.trim(),
    score: (el.querySelector('.score') || {}).textContent || ''
  })));
  const hit = matched.filter(m => m.name === NEW_NAME);
  check('匹配算法把新增商品推荐了出来',
    hit.length === 1,
    'Step 2 推荐 ' + matched.length + ' 件；新增商品：' + (hit[0] ? hit[0].id + ' ' + hit[0].score : '未出现'));
  out.numbers['工作台推荐'] = hit[0] ? (hit[0].id + ' ' + hit[0].score) : '未出现';
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'workbench-新增商品被推荐.png') });

  /* ================= 编辑现有商品 ================= */
  console.log('\n== 编辑现有商品 ==');
  await page.goto(APP + '/admin.html#/products');
  await page.waitForTimeout(1000);
  await page.locator('#prList tbody tr').first().locator('[data-edit]').click();
  await page.waitForTimeout(600);
  const editId = await page.locator('#f-id').inputValue();
  const editName = await page.locator('#f-name').inputValue();
  check('点「编辑」打开弹窗并带出原有数据',
    editId === saved.products[0].id && editName === saved.products[0].name,
    '编号 ' + editId + '，名称 ' + editName);
  check('编辑时编号不可修改',
    (await page.locator('#f-id').getAttribute('readonly')) !== null &&
    (await shadowErr(page, 'id')) === '',
    '编号只读，且不会误报"编号已存在"');
  await setInput(page, '#f-name', saved.products[0].name + '（改过）');
  await page.waitForTimeout(300);
  const editPreviewName = await page.locator('#editorPreview .product-name').innerText();
  check('改名称后预览卡片立即更新', editPreviewName.indexOf('（改过）') > -1, '预览卡：' + editPreviewName);
  await page.click('.admin-modal [data-act="1"]');
  await page.waitForTimeout(600);
  check('编辑保存后列表里显示新名称',
    (await page.locator('#prList tbody tr').first().locator('b').first().innerText()).indexOf('（改过）') > -1,
    (await page.locator('#prList tbody tr').first().locator('b').first().innerText()).trim());

  /* ================= 清理：丢弃草稿 + 把服务端配置恢复原样 ================= */
  await page.click('#btnRevert');
  await page.waitForTimeout(800);
  check('编辑的未保存改动被撤销：状态回到「已保存」',
    (await page.locator('#barTitle').innerText()).trim() === '已保存' &&
    (await draft(page)).products[0].name === saved.products[0].name,
    '状态栏「已保存」，第一件商品名称还原为「' + (await draft(page)).products[0].name + '」');

  /* 本轮新增的商品已经保存进服务端，测试结束前恢复原配置，保证可重复运行 */
  await fetch(APP + '/api/config', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: before })
  });
  const finalCfg = await getConfig();
  check('测试收尾：服务端配置恢复为原始 ' + beforeCount + ' 件商品',
    finalCfg.products.length === beforeCount,
    '服务端商品数 ' + finalCfg.products.length);
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
  fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'work', 'ui-product-edit-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/ui-product-edit-results.json');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('验收异常：', e); process.exit(2); });
