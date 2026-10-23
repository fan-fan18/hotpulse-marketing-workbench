/* 抓取来源 验收（真实浏览器 + 真实服务端）
   验收 1：停用一个来源并保存 → 工作台再抓取时该来源不再出现
   验收 2：添加一个新闻订阅源 → 测试能抓到条目 → 工作台里能看到来自它的新闻
   验收 3：添加一个不存在的地址 → 测试显示失败原因，且不影响其它来源
   另测：地址格式校验、自定义可删/内置不可删、合规提示与风险识别规则文案
   运行：node tests/ui-sources-tests.js */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const APP_PORT = 8816, STUB_PORT = 8817;
const APP = 'http://127.0.0.1:' + APP_PORT;
const STUB = 'http://127.0.0.1:' + STUB_PORT;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PW_CANDIDATES = [
  path.join(ROOT, '.test-tools', 'node_modules'),
  path.join(ROOT, 'node_modules'),
  path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'openclaw', 'node_modules')
];
function loadPlaywright() {
  for (const dir of PW_CANDIDATES) {
    try { return createRequire(path.join(dir, 'noop.js'))('playwright-core'); } catch (e) { /* 继续找 */ }
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
async function draft(page) { return page.evaluate(() => window.HP.Admin.getDraft()); }

(async function run() {
  const { chromium } = loadPlaywright();
  const app = spawn('node', [path.join(ROOT, 'server', 'server.js'), String(APP_PORT)], { cwd: ROOT, stdio: 'ignore' });
  const stub = spawn('node', [path.join(__dirname, 'stub-provider.js'), String(STUB_PORT)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1300));

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 } });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) jsErrors.push(m.text());
  });

  const original = await getConfig();

  /* ================= 页面与文案 ================= */
  console.log('== 页面结构、合规提示与风险规则 ==');
  await page.goto(APP + '/admin.html#/sources');
  await page.waitForTimeout(1100);
  check('来源页包含六个区块（新增"定时抓取与热点池"）', (await page.locator('.sec').count()) === 6,
    (await page.locator('.sec-head h3').allInnerTexts()).join(' / '));
  const builtinRows = await page.locator('#sec-so-list tbody tr').count();
  check('列出了全部来源（内置 + 自定义）', builtinRows === original.sources.length,
    '共 ' + builtinRows + ' 个来源（内置 ' + original.sources.filter(s => s.type === 'builtin').length + ' 个）');
  const compliance = await page.locator('#sec-so-compliance').innerText();
  check('写清了合规提示', /公开热榜接口只适合原型演示/.test(compliance) &&
    /官方开放平台|商业舆情服务/.test(compliance) && /爬虫协议与服务条款/.test(compliance),
    '包含"只适合原型演示 / 官方开放平台或商业舆情服务 / 遵守爬虫协议与服务条款"');
  /* 规则内容在输入框的 value 里，innerText 取不到，直接读值 */
  const risk = await page.evaluate(() => ({
    forbidden: Array.from(document.querySelectorAll('[data-rf]')).map(el => el.value),
    manual: Array.from(document.querySelectorAll('[data-rm]')).map(el => el.value)
  }));
  check('写清了风险识别规则（禁止借势 / 需人工判断）',
    risk.forbidden.length >= 4 && risk.manual.length >= 3 &&
    risk.forbidden.join(' ').indexOf('灾难事故') > -1 &&
    risk.manual.join(' ').indexOf('娱乐明星争议') > -1,
    '禁止借势 ' + risk.forbidden.length + ' 条（' + risk.forbidden[0] + '…）；需人工判断 ' + risk.manual.length + ' 条（' + risk.manual[1] + '）');
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-27-抓取来源.png') });

  /* ================= 地址格式校验 ================= */
  console.log('\n== 添加订阅源：地址格式校验 ==');
  await page.fill('#soNewName', '格式错误测试');
  await page.fill('#soNewUrl', 'htp:/bad url');
  await page.click('#soAdd');
  await page.waitForTimeout(500);
  const urlErr = await page.evaluate(() => {
    const el = document.getElementById('soUrlError');
    return el && !el.hidden ? el.textContent.trim() : '';
  });
  check('地址格式不对时在字段下方给出具体原因', /必须以 http:\/\/ 或 https:\/\/ 开头/.test(urlErr), urlErr);
  check('格式不对的来源没有被添加', (await draft(page)).sources.length === original.sources.length,
    '来源数仍为 ' + (await draft(page)).sources.length);

  /* ================= 准备测试用的来源集合 ================= */
  console.log('\n== 测试全部来源（成功 / 失败 / 耗时 / 原因）==');
  const RSS = STUB + '/rss';
  const CUSTOM_NAME = '实测订阅源X';
  const BAD_URL = 'https://this-domain-should-not-exist-xyz123.invalid/rss';
  /* 把内置来源指向本地 stub，保证测试快速可重复（真实场景下就是各自的站点地址） */
  await page.evaluate((rss) => {
    const d = window.HP.Admin.getDraft();
    d.sources.forEach(s => { if (s.type === 'builtin') s.url = rss; });
    window.HP.Admin.markDirty();
  }, RSS);
  await page.waitForTimeout(300);
  await page.fill('#soNewName', CUSTOM_NAME);
  await page.fill('#soNewUrl', RSS);
  await page.click('#soAdd');
  await page.waitForTimeout(500);
  await page.fill('#soNewName', '不存在的订阅源');
  await page.fill('#soNewUrl', BAD_URL);
  await page.click('#soAdd');
  await page.waitForTimeout(500);
  check('可以添加自定义订阅源（合法地址）',
    (await draft(page)).sources.some(s => s.name === CUSTOM_NAME && s.url === RSS),
    '已添加「' + CUSTOM_NAME + '」→ ' + RSS);

  await page.click('#soTestAll');
  /* 等真跑完（来源多、个别域名要等到超时上限时，固定等待会误判成"还在跑"） */
  await page.waitForFunction(() => document.body.dataset.testingSources !== '1', null, { timeout: 90000 });
  await page.waitForTimeout(600);
  const testTable = await page.locator('#soTestHost').innerText();
  check('逐个显示每个来源的结果与耗时',
    /来源/.test(testTable) && /结果/.test(testTable) && /条数/.test(testTable) && /耗时/.test(testTable) &&
    /成功/.test(testTable) && /ms/.test(testTable),
    testTable.replace(/\s+/g, ' ').slice(0, 70));
  const rssRow = await page.locator('#soTestHost tbody tr', { hasText: CUSTOM_NAME }).innerText();
  check('订阅源测试成功并解析出条目', /成功/.test(rssRow) && /3/.test(rssRow) && /解析出 3 条/.test(rssRow),
    rssRow.replace(/\s+/g, ' ').slice(0, 80));
  const badRow = await page.locator('#soTestHost tbody tr', { hasText: '不存在的订阅源' }).innerText();
  check('不存在的地址显示失败原因（可读）', /失败/.test(badRow) && /域名解析失败|网络不可达|超时/.test(badRow),
    badRow.replace(/\s+/g, ' ').slice(0, 80));
  const okCount = (testTable.match(/成功/g) || []).length;
  check('一个来源失败不影响其它来源（其它仍然是成功）', okCount >= 2 && /本地/.test(testTable + '') !== undefined,
    '结果表里出现「成功」' + okCount + ' 次');
  out.numbers['来源测试'] = '订阅源 3 条成功；不存在地址失败原因：' + badRow.replace(/\s+/g, ' ').slice(0, 40);
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-28-来源测试结果.png') });

  /* 抓到的条目写进配置 */
  const customRowIdx = await page.evaluate(name =>
    window.HP.Admin.getDraft().sources.findIndex(s => s.name === name), CUSTOM_NAME);
  const customRowText = (await page.locator('#sec-so-list tbody tr').nth(customRowIdx).innerText()).replace(/\s+/g, ' ');
  check('抓到的条目写入了编辑区（来源列表里能看到条数）',
    customRowText.indexOf('3 条') > -1,
    '第 ' + (customRowIdx + 1) + ' 行：' + customRowText.slice(0, 60));

  /* ================= 验收 2：保存后工作台能看到它的新闻 ================= */
  console.log('\n== 验收 2：工作台里能看到来自订阅源的新闻 ==');
  await page.click('#btnSave');
  await page.waitForTimeout(1000);
  const saved = await getConfig();
  check('保存后服务端配置里带上了抓到的条目',
    saved.sources.some(s => s.name === CUSTOM_NAME && (s.items || []).length === 3),
    CUSTOM_NAME + ' 条目数 ' + ((saved.sources.filter(s => s.name === CUSTOM_NAME)[0] || {}).items || []).length);

  await page.goto(APP + '/index.html');
  await page.waitForTimeout(900);
  const wbNews = await page.$$eval('.news-item', els => els.map(el => ({
    title: el.querySelector('.news-title').textContent.trim(),
    source: el.querySelector('.news-meta .src').textContent.trim()
  })));
  const custom = wbNews.filter(n => n.source === CUSTOM_NAME);
  check('工作台热点列表里出现来自该订阅源的新闻', custom.length === 3,
    '来自「' + CUSTOM_NAME + '」的新闻 ' + custom.length + ' 条，例如：' + (custom[0] || {}).title);
  check('订阅源新闻的标题来自真实抓取结果',
    custom.some(n => /秋季家居保暖小家电销量走高/.test(n.title)),
    (custom[0] || {}).title || '');
  out.numbers['订阅源新闻'] = custom.length + ' 条进入工作台';
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'workbench-订阅源新闻.png') });

  /* ================= 验收 1：停用来源后工作台不再出现 ================= */
  console.log('\n== 验收 1：停用来源后工作台不再出现它 ==');
  const beforeCount = wbNews.length;
  await page.goto(APP + '/admin.html#/sources');
  await page.waitForTimeout(1000);
  const weatherIdx = await page.evaluate(() =>
    window.HP.Admin.getDraft().sources.findIndex(s => s.name === '中国天气网'));
  check('找到「中国天气网」来源', weatherIdx >= 0, '索引 ' + weatherIdx);
  await page.locator('[data-sen="' + weatherIdx + '"]').click();
  await page.waitForTimeout(400);
  const enabledNow = await page.evaluate(i => window.HP.Admin.getDraft().sources[i].enabled, weatherIdx);
  check('停用该来源（草稿里 enabled = false）', enabledNow === false, 'enabled=' + enabledNow);
  await page.click('#btnSave');
  await page.waitForTimeout(1000);
  const savedCfg = await getConfig();
  check('保存后服务端配置里该来源已停用',
    savedCfg.sources.filter(s => s.name === '中国天气网')[0].enabled === false,
    '中国天气网 enabled=false');

  await page.goto(APP + '/index.html');
  await page.waitForTimeout(900);
  const afterNews = await page.$$eval('.news-item', els => els.map(el => ({
    title: el.querySelector('.news-title').textContent.trim(),
    source: el.querySelector('.news-meta .src').textContent.trim()
  })));
  check('工作台里不再出现该来源的新闻',
    afterNews.every(n => n.source !== '中国天气网'),
    '当前 ' + afterNews.length + ' 条（停用前 ' + beforeCount + ' 条），已无「中国天气网」');
  check('该来源的具体新闻（冷空气）也消失了',
    afterNews.every(n => !/冷空气来袭/.test(n.title)),
    '冷空气那条已不在列表里');
  check('其它来源的新闻不受影响',
    afterNews.some(n => n.source === '新浪科技') && afterNews.some(n => n.source === CUSTOM_NAME),
    '新浪科技与订阅源新闻仍在');
  /* 一键抓取也应尊重停用设置 */
  await page.click('#fetchBtn');
  /* 服务端模式下这是"真抓取"（会去访问启用中的来源），等它跑完再看结果 */
  await page.waitForFunction(() => document.body.dataset.fetching !== '1', null, { timeout: 60000 });
  await page.waitForTimeout(600);
  const afterFetch = await page.$$eval('.news-item', els => els.map(el => el.querySelector('.news-meta .src').textContent.trim()));
  check('「一键抓取」后依然不出现被停用的来源',
    afterFetch.indexOf('中国天气网') < 0 && afterFetch.length > 0,
    '抓取后 ' + afterFetch.length + ' 条，来源：' + Array.from(new Set(afterFetch)).join('、'));
  out.numbers['停用来源'] = '中国天气网停用后，工作台 ' + beforeCount + ' → ' + afterFetch.length + ' 条';
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'workbench-停用来源后.png') });

  /* ================= 删除自定义来源（内置不可删）================= */
  console.log('\n== 自定义来源可删除、内置来源不可删除 ==');
  await page.goto(APP + '/admin.html#/sources');
  await page.waitForTimeout(1000);
  const delButtons = await page.locator('[data-sdel]').count();
  const customCount = (await draft(page)).sources.filter(s => s.type === 'custom').length;
  check('只有自定义来源有删除按钮', delButtons === customCount,
    '删除按钮 ' + delButtons + ' 个 = 自定义来源 ' + customCount + ' 个（内置显示"不可删除"）');
  const targetIdx = await page.evaluate(() => window.HP.Admin.getDraft().sources.findIndex(s => s.name === '不存在的订阅源'));
  await page.locator('[data-sdel="' + targetIdx + '"]').click();
  await page.waitForTimeout(400);
  const delModal = await page.locator('.admin-modal').innerText();
  check('删除自定义来源需要确认', /删除自定义来源/.test(delModal), delModal.split('\n')[0].slice(0, 40));
  await page.locator('.admin-modal .btn', { hasText: '确认删除' }).click();
  await page.waitForTimeout(500);
  check('删除后自定义来源数量减少',
    (await draft(page)).sources.filter(s => s.type === 'custom').length === customCount - 1,
    '自定义来源 ' + customCount + ' → ' + (await draft(page)).sources.filter(s => s.type === 'custom').length);

  /* ================= 清理：恢复原始配置 ================= */
  await putConfig(original);
  const back = await getConfig();
  check('测试收尾：服务端来源配置恢复原样',
    JSON.stringify(back.sources) === JSON.stringify(original.sources),
    '来源数 ' + back.sources.length + '，中国天气网 enabled=' + back.sources.filter(s => s.name === '中国天气网')[0].enabled);
  check('全流程没有前端脚本报错', jsErrors.length === 0, jsErrors.length ? jsErrors.slice(0, 2).join(' | ') : '无脚本异常');

  await browser.close();
  for (const p of [app, stub]) {
    await new Promise(function (resolve) {
      let done = false;
      p.once('exit', function () { done = true; resolve(); });
      p.kill();
      setTimeout(function () { if (!done) resolve(); }, 1200);
    });
  }
  await new Promise(r => setTimeout(r, 200));

  out.finishedAt = new Date().toISOString();
  out.pass = pass;
  out.fail = fail;
  fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'work', 'ui-sources-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/ui-sources-results.json');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('验收异常：', e); process.exit(2); });
