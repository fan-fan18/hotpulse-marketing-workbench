/* =========================================================
   运营效率 · 真浏览器验收
     1) 顶部导航四个视图互通（工作台 / 商品库 / 内容中心 / 数据看板），也能回到工作台
     2) Step 1 多选 → 批量生成（热点 × 风格），进度跑到 100%
     3) 待审队列：J/K 翻页、A 通过、R 打回（必须填原因）
     4) 选题池：加入 → 内容中心可见 → 日历排期 → 重复加入被拦住
     5) 数据看板数字与工作区指标对得上
   运行：node tests/ui-efficiency-tests.js
   ========================================================= */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const PORT = 8851;
const APP = 'http://127.0.0.1:' + PORT;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PW = [path.join(ROOT, '.test-tools', 'node_modules'), path.join(ROOT, 'node_modules')];
function loadPlaywright() {
  for (const dir of PW) {
    try { return createRequire(path.join(dir, 'noop.js'))('playwright-core'); } catch (e) {}
  }
  throw new Error('没有找到 playwright-core；请先执行： npm install playwright-core --prefix .test-tools --no-save');
}

const out = { startedAt: new Date().toISOString(), checks: [], numbers: {} };
let pass = 0, fail = 0;
function check(name, cond, detail) {
  out.checks.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
  if (cond) { pass++; console.log('  ✓ ' + name + '  → ' + detail); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + detail); }
}
async function getConfig() { return (await (await fetch(APP + '/api/config')).json()).config; }

(async function run() {
  const { chromium } = loadPlaywright();
  const app = spawn('node', [path.join(ROOT, 'server', 'server.js'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1400));

  /* 保证模型是本地模拟（批量 8 条也不会真花钱） */
  const cfg = JSON.parse(JSON.stringify(await getConfig()));
  cfg.model = Object.assign({}, cfg.model, { mode: 'mock' });
  (cfg.sources || []).forEach(function (s) { if (s.type === 'builtin') s.enabled = true; });
  await fetch(APP + '/api/config', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: cfg })
  });

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) jsErrors.push('console: ' + m.text()); });

  fs.mkdirSync(path.join(ROOT, 'work', 'shots'), { recursive: true });
  await page.goto(APP + '/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(1500);

  console.log('\n================ A. 顶部导航四个视图互通 ================');
  const navs = await page.$$eval('#topNav a', els => els.map(e => (e.textContent || '').trim()));
  check('顶部导航有 4 个视图入口 + 配置后台', navs.join('/') === '营销工作台/商品库/内容中心/数据看板/配置后台', navs.join(' / '));
  check('配置后台入口指向 admin.html',
    (await page.getAttribute('#topNav a[href="admin.html"]', 'href')) === 'admin.html', 'admin.html');

  const nNews = await page.locator('.news-item').count();
  await page.click('#topNav a[data-view="center"]');
  await page.waitForTimeout(500);
  check('切到内容中心：视图显示、左侧流程栏隐藏',
    await page.locator('#view-center').isVisible() && await page.evaluate(() => document.querySelector('.layout').hidden),
    '内容中心可见，sidebar hidden');
  check('内容中心有 42 格月历', await page.locator('.cal-cell').count() === 42, '42 格');
  check('内容中心统计卡 4 张', await page.locator('#view-center .stat-card').count() === 4, '4 张');

  await page.click('#topNav a[data-view="dash"]');
  await page.waitForTimeout(600);
  check('切到数据看板：8 张指标卡 + 抓取趋势表',
    await page.locator('#view-dash .stat-card').count() === 8 && await page.locator('#view-dash .split').count() === 1,
    '8 张卡 + 趋势区');
  const dashServer = (await page.locator('#view-dash .stat-row').first().innerText()).replace(/\s+/g, ' ');
  check('数据看板显示抓取来源是服务端热点池', /服务端 data\/news.json/.test(dashServer), dashServer.slice(0, 40));

  await page.click('#topNav a[data-view="products"]');
  await page.waitForTimeout(500);
  const pvCards = await page.locator('#view-products .product-card').count();
  check('商品库视图卡片数与配置一致', pvCards === (cfg.products || []).length, pvCards + ' 张 / 配置 ' + (cfg.products || []).length + ' 件');
  check('商品库卡片与工作台同款（.product-card 结构一致）',
    await page.locator('#view-products .product-card .pc-emoji, #view-products .product-card .p-emoji').count() > 0 ||
    await page.locator('#view-products .product-card').first().innerHTML().then(h => /gradient/.test(h)),
    '同款卡片');

  await page.click('#topNav a[data-view="work"]');
  await page.waitForTimeout(500);
  check('能切回工作台（Step 1 可见）', await page.locator('#view-1').isVisible(), 'Step 1 可见');

  console.log('\n================ B. 多选 + 批量生成 ================');
  check('Step 1 每张卡片都有勾选框', await page.locator('.news-check').count() === nNews, nNews + ' 个勾选框');
  await page.locator('.news-check').nth(0).check();
  await page.locator('.news-check').nth(1).check();
  check('勾选 2 条后出现多选操作条', await page.locator('#multiBar').isVisible() && (await page.locator('#multiCount').innerText()) === '2', '已选 2 条');
  await page.click('#multiBatch');
  await page.waitForTimeout(400);
  const styleN = (cfg.styles || []).length;
  const est = (await page.locator('#batchEst').innerText()).replace(/\s+/g, ' ');
  check('批量弹窗按"热点 × 风格"算出任务数', est.indexOf(String(2 * styleN)) === 0, est);
  check('并发数默认 3', (await page.inputValue('#batchConc')) === '3', '3');
  await page.click('#batchStart');
  await page.waitForFunction(() => !document.querySelector('#batchStart').hidden, null, { timeout: 90000 });
  await page.waitForTimeout(400);
  const rows = await page.locator('#batchBody tr').count();
  const prog = (await page.locator('#batchProgressTxt').innerText()).replace(/\s+/g, ' ');
  check('批量任务全部跑完，结果逐行填表', rows === 2 * styleN && new RegExp('^' + (2 * styleN) + ' / ' + (2 * styleN)).test(prog), prog);
  const qAfter = await page.evaluate(() => window.HP.Workspace.queueStats());
  check('结果全部进入待审队列', qAfter.total === 2 * styleN && qAfter.wait === 2 * styleN, JSON.stringify(qAfter));
  const mAfter = await page.evaluate(() => window.HP.Workspace.metrics());
  check('指标记了 1 批 / ' + (2 * styleN) + ' 条任务',
    mAfter.batches === 1 && mAfter.batchTasks === 2 * styleN, JSON.stringify(mAfter));
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'eff-batch.png') });
  await page.click('#batchCancel');

  console.log('\n================ C. 待审队列：J/K/A/R ================');
  await page.click('.step-item[data-step="5"]');
  await page.waitForTimeout(500);
  check('待审队列列出了刚生成的文案', await page.locator('.queue-item').count() === 2 * styleN, (await page.locator('.queue-item').count()) + ' 条');
  check('队列角标 = 待审条数', (await page.locator('#queueBadge').innerText()) === String(2 * styleN), '角标 ' + (await page.locator('#queueBadge').innerText()));
  await page.locator('.queue-item').first().click();
  await page.waitForTimeout(400);
  const firstQ = await page.evaluate(() => document.querySelector('.queue-item.active').dataset.q);
  check('点队列条目会把文案载入 Step 5 预览', (await page.locator('#weiboCard').innerText()).length > 60, '预览有内容');
  await page.keyboard.press('j');
  await page.waitForTimeout(400);
  const afterJ = await page.evaluate(() => document.querySelector('.queue-item.active').dataset.q);
  check('按 J 翻到下一条', afterJ !== firstQ, 'q=' + afterJ.slice(-6));
  await page.keyboard.press('k');
  await page.waitForTimeout(400);
  const afterK = await page.evaluate(() => document.querySelector('.queue-item.active').dataset.q);
  check('按 K 翻回上一条', afterK === firstQ, 'q=' + afterK.slice(-6));
  await page.keyboard.press('a');
  await page.waitForTimeout(600);
  const qA = await page.evaluate(() => window.HP.Workspace.queueStats());
  check('按 A 通过：待审 -1、已通过 +1', qA.wait === 2 * styleN - 1 && qA.pass === 1, JSON.stringify(qA));
  await page.keyboard.press('r');
  await page.waitForTimeout(300);
  check('按 R 弹出打回原因输入框', await page.locator('#queueReject').isVisible(), '打回框可见');
  await page.fill('#rejectReason', '卖点写成说明书，重写');
  await page.click('#rejectOk');
  await page.waitForTimeout(600);
  const qR = await page.evaluate(() => window.HP.Workspace.queueStats());
  check('填原因后打回生效', qR.rejected === 1, JSON.stringify(qR));
  const rejReason = await page.evaluate(() => (window.HP.Workspace.queue().filter(x => x.status === '已打回')[0] || {}).reason);
  check('打回原因被记录下来', rejReason === '卖点写成说明书，重写', rejReason);
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'eff-queue-ui.png') });

  console.log('\n================ D. 选题池 → 内容中心 ================');
  await page.click('.step-item[data-step="1"]');
  await page.waitForTimeout(400);
  const newsTitle = (await page.locator('.news-item .news-title').first().innerText()).trim();
  await page.locator('.news-item').first().locator('[data-pooladd]').click();
  await page.waitForTimeout(500);
  const pool1 = await page.evaluate(() => window.HP.Workspace.pool());
  check('加入选题池成功', pool1.length === 1 && pool1[0].title === newsTitle, pool1.length + ' 条：' + (pool1[0] || {}).title);
  await page.locator('.news-item').first().locator('[data-pooladd]').click();
  await page.waitForTimeout(400);
  const toastTxt = (await page.locator('#toastWrap').innerText()).replace(/\s+/g, ' ');
  check('同一条热点重复加入被拦住并说明', /已经在选题池里/.test(toastTxt) && (await page.evaluate(() => window.HP.Workspace.pool().length)) === 1, '仍是 1 条');
  await page.click('#topNav a[data-view="center"]');
  await page.waitForTimeout(600);
  check('内容中心能看到这条选题', await page.locator('.pool-table tbody tr').count() === 1, '1 行');
  check('日历上出现排期块', await page.locator('.cal-item').count() === 1, '1 个排期块');
  const centerStats = (await page.locator('#view-center .stat-row').innerText()).replace(/\s+/g, ' ');
  check('内容中心统计与池子一致（选题总数 1）', /选题总数 1/.test(centerStats), centerStats.slice(0, 30));
  await page.locator('[data-advance]').first().click();
  await page.waitForTimeout(500);
  check('点「推进」把状态从待办改成进行中',
    (await page.evaluate(() => window.HP.Workspace.pool()[0].status)) === '进行中',
    await page.evaluate(() => window.HP.Workspace.pool()[0].status));
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'eff-center-ui.png') });

  console.log('\n================ E. 数据看板与工作区口径一致 ================');
  await page.click('#topNav a[data-view="dash"]');
  await page.waitForTimeout(600);
  const wm = await page.evaluate(() => window.HP.Workspace.metrics());
  const wq = await page.evaluate(() => window.HP.Workspace.queueStats());
  const dashText = (await page.locator('#view-dash').innerText()).replace(/\s+/g, ' ');
  check('看板「已生成文案」= 工作区生成数', new RegExp('已生成文案 ' + wm.generated + '版').test(dashText), 'generated=' + wm.generated);
  check('看板「待审队列」= 工作区待审数', new RegExp('待审队列 ' + wq.wait + '条').test(dashText), 'wait=' + wq.wait);
  check('看板审核漏斗与队列口径一致',
    new RegExp('已通过 ' + wq.pass).test(dashText) || new RegExp('已通过' + wq.pass).test(dashText),
    'pass=' + wq.pass);
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'eff-dash-ui.png') });

  check('整个流程没有前端脚本报错', jsErrors.length === 0, jsErrors.length ? jsErrors.slice(0, 2).join(' ｜ ') : '无报错');

  out.numbers = {
    '导航': '工作台 / 商品库 / 内容中心 / 数据看板 四视图互通 + 配置后台入口',
    '批量': '2 热点 × ' + styleN + ' 风格 = ' + (2 * styleN) + ' 个任务，进度 100%，全部进待审队列',
    '队列': 'J/K 翻页正确；A 通过 1 条；R 打回 1 条并记录原因',
    '选题池': '加入 1 条 → 内容中心 1 行 + 日历 1 块；重复加入被拦住',
    '看板': '已生成 ' + wm.generated + ' 版 / 待审 ' + wq.wait + ' 条 / 已通过 ' + wq.pass + ' 条，与工作区一致'
  };
  out.finishedAt = new Date().toISOString();
  out.pass = pass; out.fail = fail;
  fs.writeFileSync(path.join(ROOT, 'work', 'ui-efficiency-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n================ 汇总 ================');
  console.log('通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/ui-efficiency-results.json');
  await browser.close();
  app.kill();
  setTimeout(function () { process.exit(fail ? 1 : 0); }, 250);
})().catch(function (e) { console.error('验收脚本异常：', e); process.exit(2); });
