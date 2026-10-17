/* =========================================================
   工作台「抓取」相关的 4 处修复 · 真浏览器验收
     1) 统计卡不再有假数字：当前热点列表 = 列表里真实条数（旧的"今日抓取热点 1,297"已删除）
     2) 顶部状态灯反映真实情况：file:// → 「演示模式 · 未连接服务端」；服务端模式 → 「抓取服务在线」
     3) 列表为空时说清真正原因，并给「恢复并启用内置来源」一键修复
     4) 服务端模式下「一键抓取」真的调抓取接口：用本地 stub 的 /rss 订阅源验证条目被写回并出现在列表
   运行：node tests/ui-fetch-tests.js
   ========================================================= */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const APP_PORT = 8836;
const STUB_PORT = 8837;
const APP = 'http://127.0.0.1:' + APP_PORT;
const RSS_URL = 'http://127.0.0.1:' + STUB_PORT + '/rss';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PW_CANDIDATES = [path.join(ROOT, '.test-tools', 'node_modules'), path.join(ROOT, 'node_modules')];
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
async function newsCount(page) { return page.locator('.news-item').count(); }
async function statNumbers(page) { return page.$$eval('#newsStats .stat-card .v', els => els.map(e => e.textContent.trim())); }
async function waitFetched(page) {
  await page.waitForFunction(() => document.body.dataset.fetching !== '1', null, { timeout: 60000 });
  await page.waitForTimeout(400);
}

(async function run() {
  const { chromium } = loadPlaywright();
  const stub = spawn('node', [path.join(__dirname, 'stub-provider.js'), String(STUB_PORT)], { stdio: 'ignore' });
  const app = spawn('node', [path.join(ROOT, 'server', 'server.js'), String(APP_PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1300));

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  fs.mkdirSync(path.join(ROOT, 'work', 'shots'), { recursive: true });

  /* ================= 演示模式（file:// 打开，没有服务端） ================= */
  console.log('\n================ A. 演示模式（file:// 直接打开） ================');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) jsErrors.push(m.text()); });
  const FILE_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
  await page.goto(FILE_URL);
  await page.waitForTimeout(900);

  const pillText = (await page.locator('#envPill').innerText()).trim();
  check('演示模式：顶部状态灯不再谎报"在线"',
    /演示模式/.test(pillText) && !/在线/.test(pillText),
    '状态灯：' + pillText);
  check('演示模式：状态灯带警示样式', await page.locator('#envPill.warn').count() === 1,
    'class=' + (await page.locator('#envPill').getAttribute('class')));

  const bodyText = await page.locator('body').innerText();
  check('旧的假数字"今日抓取热点 / 1,297 条"已经不存在',
    !/今日抓取热点/.test(bodyText) && !/1,297/.test(bodyText),
    '页面里已找不到"今日抓取热点"');

  const stat1 = await statNumbers(page);
  const n1 = await newsCount(page);
  check('统计卡「当前热点列表」= 列表真实条数',
    stat1.length === 4 && Number(String(stat1[0]).replace(/[^\d]/g, '')) === n1 && n1 > 0,
    '统计卡 ' + stat1[0] + ' ｜ 列表 ' + n1 + ' 条');
  const statDesc = await page.locator('#newsStats .stat-card').first().innerText();
  check('统计卡副文案写的是启用来源与"其中有条目"的真实数量',
    /启用来源 \d+ 个 · 其中有条目 \d+ 个/.test(statDesc.replace(/\s+/g, ' ')),
    (statDesc.match(/启用来源[^\n]*/) || [''])[0]);

  await page.click('#fetchBtn');
  await waitFetched(page);
  const n2 = await newsCount(page);
  const toast1 = await page.locator('#toastWrap').innerText().catch(() => '');
  check('演示模式点「一键抓取」：不伪造条数，并明确说明没有真抓',
    n2 === n1 && /演示模式/.test(toast1) && /没有真的抓取/.test(toast1),
    '抓取前后都是 ' + n2 + ' 条；提示：' + toast1.replace(/\s+/g, ' ').slice(0, 60));
  const stat2 = await statNumbers(page);
  check('抓取后统计卡数字没有"凭空增长"',
    Number(String(stat2[0]).replace(/[^\d]/g, '')) === n2,
    '统计卡 ' + stat2[0] + ' ｜ 列表 ' + n2 + ' 条');
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'fetch-1-演示模式.png') });

  /* --------- 情况 1：配置里内置来源整条丢了（用户实际遇到的那种）→ 自动补回 --------- */
  console.log('\n== 情况 1：内置来源整条缺失 → 自动补回 ==');
  const fullCfg = JSON.parse(JSON.stringify(await page.evaluate(() => window.HP.Config.get())));
  const lostBuiltin = JSON.parse(JSON.stringify(fullCfg));
  lostBuiltin.sources = [
    { id: 'src_hot_weibo', name: '微博热搜榜', type: 'custom', url: 'https://s.weibo.com/top/summary', enabled: true, note: '运营自定义', items: [] },
    { id: 'src_hot_baidu', name: '百度热搜榜', type: 'custom', url: 'https://top.baidu.com/board', enabled: true, note: '运营自定义', items: [] }
  ];
  await page.addInitScript(function (json) {
    try { window.localStorage.setItem('hotpulse.config.v1', json); } catch (e) {}
  }, JSON.stringify(lostBuiltin));
  await page.reload();
  await page.waitForTimeout(1000);
  const nHeal = await newsCount(page);
  const healToast = (await page.locator('#toastWrap').innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('内置来源整条缺失时自动补回：列表直接有 8 条内置热点',
    nHeal === 8, '列表 ' + nHeal + ' 条');
  check('并明确告诉用户补回了几个：' + healToast.slice(0, 46),
    /缺少 8 个内置来源/.test(healToast) && /已自动补回并启用/.test(healToast), healToast.slice(0, 70));
  const healedLocal = await page.evaluate(() => {
    const c = window.HP.Config.get();
    return { total: (c.sources || []).length, custom: (c.sources || []).filter(s => s.type === 'custom').length };
  });
  check('补回时不会删掉运营自己的自定义来源',
    healedLocal.total === 10 && healedLocal.custom === 2, '来源共 ' + healedLocal.total + ' 个（自定义 ' + healedLocal.custom + ' 个）');
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'fetch-2-内置来源自动补回.png') });

  /* --------- 情况 2：来源都在，但启用的那几个底下一无所有 → 空列表说清原因 + 一键启用 --------- */
  console.log('\n== 情况 2：启用的来源没有条目 → 空列表说清原因 + 一键修复 ==');
  const noItems = JSON.parse(JSON.stringify(fullCfg));
  noItems.sources = (fullCfg.sources || []).map(function (s) {
    return Object.assign({}, s, { enabled: false, items: [] });
  }).filter(function (s) { return s.type === 'builtin'; });
  noItems.sources.push(
    { id: 'src_hot_weibo', name: '微博热搜榜', type: 'custom', url: 'https://s.weibo.com/top/summary', enabled: true, note: '运营自定义', items: [] },
    { id: 'src_hot_baidu', name: '百度热搜榜', type: 'custom', url: 'https://top.baidu.com/board', enabled: true, note: '运营自定义', items: [] }
  );
  await page.addInitScript(function (json) {
    try { window.localStorage.setItem('hotpulse.config.v1', json); } catch (e) {}
  }, JSON.stringify(noItems));
  await page.reload();
  await page.waitForTimeout(1000);
  const nEmpty = await newsCount(page);
  const emptyText = (await page.locator('#newsList').innerText()).replace(/\s+/g, ' ');
  check('复现"启用的来源没有条目"：列表为空', nEmpty === 0, '列表 ' + nEmpty + ' 条');
  check('空列表不再只说"没有匹配的热点"，而是点明来源里没有条目',
    /底下一共 0 条条目/.test(emptyText) && /微博热搜榜/.test(emptyText) && /百度热搜榜/.test(emptyText),
    emptyText.slice(0, 78));
  const beforeFix = await statNumbers(page);
  check('统计卡同步显示"启用来源 2 个 · 其中有条目 0 个"',
    /启用来源 2 个 · 其中有条目 0 个/.test((await page.locator('#newsStats').innerText()).replace(/\s+/g, ' ')),
    '统计卡 ' + beforeFix[0]);
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'fetch-3-空列表说清原因.png') });

  await page.click('#fixSourcesBtn');
  await page.waitForTimeout(1200);
  const nFixed = await newsCount(page);
  const fixToast = (await page.locator('#toastWrap').innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('点「恢复并启用内置来源」后列表恢复（内置 8 条回来，自定义来源保留）',
    nFixed === 8 && /已恢复内置来源/.test(fixToast),
    '修复后 ' + nFixed + ' 条；提示：' + fixToast.slice(0, 46));
  const savedLocal = await page.evaluate(() => {
    const c = JSON.parse(window.localStorage.getItem('hotpulse.config.v1') || '{}');
    return { total: (c.sources || []).length, on: (c.sources || []).filter(s => s.enabled).length, custom: (c.sources || []).filter(s => s.type === 'custom').length };
  });
  check('修复结果已写回本机浏览器配置，且没删掉运营的自定义来源',
    savedLocal.total >= 10 && savedLocal.custom === 2, '来源共 ' + savedLocal.total + ' 个（自定义 ' + savedLocal.custom + ' 个），启用 ' + savedLocal.on + ' 个');
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'fetch-4-一键恢复内置来源.png') });

  /* ================= 服务端模式（真抓取） ================= */
  console.log('\n================ B. 服务端模式：一键抓取真的去抓 ================');
  const base = JSON.parse(JSON.stringify(await getConfig()));
  const cfg = JSON.parse(JSON.stringify(base));
  cfg.sources = (cfg.sources || []).map(function (s) { return Object.assign({}, s, { enabled: false }); });
  cfg.sources.push({
    id: 'src_acceptance_rss', name: '验收订阅源', type: 'custom', url: RSS_URL,
    enabled: true, note: '本地 stub 提供的 RSS', items: []
  });
  const put = await putConfig(cfg);
  check('服务端配置已就绪（只启用一个本地 RSS 订阅源，其余停用）', put.status === 200 && put.json.ok,
    'HTTP ' + put.status + '；启用来源：验收订阅源');

  const page2 = await ctx.newPage();
  page2.on('pageerror', e => jsErrors.push('pageerror: ' + e.message));
  await page2.goto(APP + '/index.html');
  await page2.waitForTimeout(1000);
  const pill2 = (await page2.locator('#envPill').innerText()).trim();
  check('服务端模式：状态灯显示「抓取服务在线」且不带警示样式',
    /抓取服务在线/.test(pill2) && (await page2.locator('#envPill.warn').count()) === 0, '状态灯：' + pill2);
  const nBefore = await newsCount(page2);
  check('抓之前：启用来源没有条目 → 列表为空，且说明了原因',
    nBefore === 0 && /0 条条目/.test((await page2.locator('#newsList').innerText()).replace(/\s+/g, ' ')),
    '列表 ' + nBefore + ' 条');

  await page2.click('#fetchBtn');
  await waitFetched(page2);
  const nAfter = await newsCount(page2);
  const toast2 = (await page2.locator('#toastWrap').innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('服务端模式点「一键抓取」：真的抓到订阅条目并出现在列表里',
    nAfter === 3, '抓取后列表 ' + nAfter + ' 条（订阅源提供 3 条）');
  check('提示里给出真实来源数与写入条数', /真抓取完成/.test(toast2) && /3 条条目/.test(toast2), toast2.slice(0, 70));
  const srcNames = await page2.$$eval('.news-item .news-meta .src', els => els.map(e => e.textContent.trim()));
  check('列表里的新闻确实标着这个订阅源的名字',
    srcNames.length === 3 && srcNames.every(x => x === '验收订阅源'),
    '来源：' + Array.from(new Set(srcNames)).join('、'));
  const titles = await page2.$$eval('.news-item .news-title', els => els.map(e => e.textContent.trim()));
  check('抓到的是订阅源里的标题（不是内置演示新闻）',
    titles.every(t => /订阅源测试/.test(t)), titles[0] || '（无）');
  const statAfter = await statNumbers(page2);
  check('统计卡跟着变成真实数字 3 条',
    Number(String(statAfter[0]).replace(/[^\d]/g, '')) === 3, '统计卡 ' + statAfter[0]);

  const serverCfg = await getConfig();
  const rssSrc = (serverCfg.sources || []).filter(s => s.id === 'src_acceptance_rss')[0] || {};
  check('抓到的条目已写回服务端配置（刷新/换页面也不丢）',
    (rssSrc.items || []).length === 3, '服务端配置里该来源存了 ' + (rssSrc.items || []).length + ' 条');
  await page2.screenshot({ path: path.join(ROOT, 'work', 'shots', 'fetch-4-服务端真抓取.png') });

  /* 换一个页面重新打开，验证条目来自配置而不只是内存 */
  const page3 = await ctx.newPage();
  await page3.goto(APP + '/index.html');
  await page3.waitForTimeout(1000);
  check('重新打开页面：抓到的订阅新闻依然在（来自配置，不是内存假象）',
    (await page3.locator('.news-item').count()) === 3, '重新打开后 ' + (await page3.locator('.news-item').count()) + ' 条');

  check('整个流程没有前端脚本报错', jsErrors.length === 0, jsErrors.length ? jsErrors.slice(0, 2).join(' ｜ ') : '无报错');

  out.numbers['演示模式'] = '状态灯「' + pillText + '」；抓取前后都是 ' + n1 + ' 条，不伪造数字';
  out.numbers['空列表修复'] = '启用 2 个无条目来源 → 0 条 → 一键恢复内置来源后 8 条';
  out.numbers['服务端真抓取'] = '启用 1 个本地 RSS → 抓取前 0 条 → 抓取后 3 条（已写回服务端配置）';
  out.finishedAt = new Date().toISOString();
  out.pass = pass; out.fail = fail;
  fs.writeFileSync(path.join(ROOT, 'work', 'ui-fetch-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n================ 汇总 ================');
  console.log('通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/ui-fetch-results.json');
  await browser.close();
  app.kill(); stub.kill();
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('验收脚本异常：', e); process.exit(2); });
