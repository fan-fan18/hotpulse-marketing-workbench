/* 模型与接入 验收（真实浏览器 + 真实 HTTP）
   验收 1：后台改模型名并保存 → 工作台下一次生成就用新模型
   验收 2：切换服务商时地址和模型名自动填好
   验收 3：填错密钥点测试连接 → 可读提示「密钥无效」
   另测：密钥警示、温度推荐值、以及「两边共用同一份配置」的双向同步
   运行：node tests/ui-model-tests.js */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const STUB_PORT = 8807, APP_PORT = 8806;
const STUB = 'http://127.0.0.1:' + STUB_PORT + '/v1';
const STUB_API = 'http://127.0.0.1:' + STUB_PORT;
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

const out = { startedAt: new Date().toISOString(), checks: [], numbers: {} };
let pass = 0, fail = 0;
function check(name, cond, detail) {
  out.checks.push({ name, ok: !!cond, detail: detail === undefined ? '' : detail });
  if (cond) { pass++; console.log('  ✓ ' + name + '  → ' + detail); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + detail); }
}
async function getConfig() { return (await (await fetch(APP + '/api/config')).json()).config; }
async function putConfig(config) {
  const r = await fetch(APP + '/api/config', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config })
  });
  return { status: r.status, json: await r.json() };
}
async function setField(page, sel, value) {
  await page.fill(sel, value);
  await page.evaluate(s => document.querySelector(s).dispatchEvent(new Event('change', { bubbles: true })), sel);
  await page.waitForTimeout(200);
}

(async function run() {
  const { chromium } = loadPlaywright();
  const stub = spawn('node', [path.join(__dirname, 'stub-provider.js'), String(STUB_PORT)], { stdio: 'ignore' });
  const app = spawn('node', [path.join(ROOT, 'server', 'server.js'), String(APP_PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 } });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());   // 测试里跨页跳转按确认离开处理
  const jsErrors = [], httpLogs = [];
  page.on('pageerror', e => jsErrors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(m.text())) httpLogs.push(m.text()); else jsErrors.push(m.text());
  });

  const original = await getConfig();

  /* ================= 验收 2：服务商预设 ================= */
  console.log('== 验收 2：切换服务商，地址与模型名自动填好 ==');
  await page.goto(APP + '/admin.html#/model');
  await page.waitForTimeout(1000);
  check('模型页包含四个配置区块', (await page.locator('.sec').count()) === 4,
    (await page.locator('.sec-head h3').allInnerTexts()).join(' / '));

  await page.selectOption('#providerPick', 'deepseek');
  await page.waitForTimeout(500);
  check('切到 DeepSeek：接口地址与模型名自动填好',
    (await page.locator('#mBaseUrl').inputValue()) === 'https://api.deepseek.com/v1' &&
    (await page.locator('#mModel').inputValue()) === 'deepseek-chat',
    '地址 ' + (await page.locator('#mBaseUrl').inputValue()) + '，模型 ' + (await page.locator('#mModel').inputValue()));

  await page.selectOption('#providerPick', 'moonshot');
  await page.waitForTimeout(500);
  check('切到 Moonshot：地址与模型名同样被预设覆盖',
    (await page.locator('#mBaseUrl').inputValue()) === 'https://api.moonshot.cn/v1' &&
    (await page.locator('#mModel').inputValue()) === 'moonshot-v1-8k',
    '地址 ' + (await page.locator('#mBaseUrl').inputValue()) + '，模型 ' + (await page.locator('#mModel').inputValue()));

  await setField(page, '#mBaseUrl', 'https://my-own-endpoint.example.com/v1');
  const manual = await page.evaluate(() => window.HP.Admin.getDraft().model.baseUrl);
  check('预设之后仍允许手动修改地址', manual === 'https://my-own-endpoint.example.com/v1', '草稿里的地址：' + manual);
  out.numbers['服务商预设'] = 'DeepSeek / Moonshot 均自动填好地址与模型名';
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-13-模型预设.png') });

  /* ================= 密钥警示 与 温度推荐值 ================= */
  console.log('\n== 密钥警示与温度推荐值 ==');
  const keyWarn = await page.locator('#sec-m-key .help.danger').innerText();
  check('密钥旁有「只存在本机浏览器 + 走服务端中转」的警示',
    /只存在你本机浏览器/.test(keyWarn) && /本地服务中转/.test(keyWarn) && /HOTPULSE_API_KEY/.test(keyWarn),
    keyWarn.replace(/\s+/g, ' ').slice(0, 70));
  const tempGuide = await page.locator('#sec-m-key table').innerText();
  check('温度旁注明不同任务的推荐值',
    /创作类/.test(tempGuide) && /0\.7 – 1\.0/.test(tempGuide) && /抽取 \/ 评审/.test(tempGuide),
    tempGuide.replace(/\s+/g, ' ').slice(0, 80));
  await page.locator('[data-temp="0.85"]').click();
  await page.waitForTimeout(400);
  check('点推荐值可一键设为该温度', Number(await page.locator('#mTemp').inputValue()) === 0.85,
    '当前温度 ' + (await page.locator('#mTemp').inputValue()));

  /* ================= 验收 3：测试连接 ================= */
  console.log('\n== 验收 3：错密钥 → 可读提示 ==');
  /* 补测（部署相关）：没有服务端时，中转选项要说清楚怎么部署，不能报"网络不可达" */
  const fileCtx = await browser.newContext({ viewport: { width: 1500, height: 980 } });
  const filePage = await fileCtx.newPage();
  await filePage.goto('file:///' + ROOT.replace(/\\/g, '/') + '/admin.html');
  await filePage.waitForTimeout(900);
  await filePage.evaluate(() => { location.hash = '#/model'; });
  await filePage.waitForTimeout(500);
  const noServerHint = await filePage.locator('[data-mode="proxy"] [data-noserver="1"]').count();
  check('file:// 下「本地服务中转」卡片明确提示没有服务端', noServerHint === 1,
    noServerHint ? (await filePage.locator('[data-mode="proxy"] [data-noserver="1"]').innerText()).replace(/\s+/g, ' ').slice(0, 60) : '没有找到提示');
  const proxyMsg = await filePage.evaluate(async () => {
    const r = await window.HP.LLM.call({ mode: 'proxy', model: 'x', system: 's', user: 'u' });
    return r.message || '';
  });
  check('没服务端时中转调用给人话引导，而不是"网络不可达"',
    /启动服务端/.test(proxyMsg) && /启动服务\.bat|server\.js/.test(proxyMsg) && !/网络不可达/.test(proxyMsg),
    proxyMsg.slice(0, 70));
  await filePage.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-14-中转需要先启动服务端.png') });
  await fileCtx.close();

  await page.locator('[data-mode="direct"]').click();
  await page.waitForTimeout(500);
  await setField(page, '#mBaseUrl', STUB);
  await setField(page, '#mModel', 'stub-model');
  await setField(page, '#mKey', 'sk-bad-key');
  await page.locator('#testConn').click();
  await page.waitForTimeout(2500);
  const connFail = (await page.locator('#connResult').innerText()).trim();
  check('错密钥：提示「密钥无效」而不是原始报错', /密钥无效/.test(connFail),
    (connFail.match(/[^\n]*密钥无效[^\n]*/) || [''])[0].slice(0, 60));
  const rawDetail = await page.evaluate(() => {
    const d = document.querySelector('#connResult details');
    return d ? d.textContent : '';
  });
  check('原始报错收进「技术细节」折叠区', /invalid_api_key/.test(rawDetail) || /401/.test(rawDetail),
    rawDetail.replace(/\s+/g, ' ').slice(0, 60));
  check('失败结果里也给出耗时', /耗时\s*\d+\s*ms/.test(connFail), (connFail.match(/耗时\s*\d+\s*ms/) || [''])[0]);
  out.numbers['错密钥提示'] = (connFail.match(/[^\n]*密钥无效[^\n]*/) || [''])[0].slice(0, 40);
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-14-测试连接-密钥无效.png') });

  await setField(page, '#mKey', 'sk-good-123');
  await page.locator('#testConn').click();
  await page.waitForTimeout(2500);
  const connOk = (await page.locator('#connResult').innerText()).trim();
  check('对密钥：显示成功、耗时与实际响应的模型名',
    /连接成功/.test(connOk) && /stub-model/.test(connOk) && /耗时\s*\d+\s*ms/.test(connOk),
    connOk.replace(/\s+/g, ' ').slice(0, 80));

  /* ================= 验收 1：后台改模型名 → 工作台下次生成生效 ================= */
  console.log('\n== 验收 1：后台改模型名并保存 → 工作台下一次生成生效 ==');
  await page.click('#btnSave');
  await page.waitForTimeout(900);
  const saved1 = await getConfig();
  check('保存后服务端配置为：浏览器直连 + stub-model',
    saved1.model.mode === 'direct' && saved1.model.model === 'stub-model',
    'mode=' + saved1.model.mode + '，model=' + saved1.model.model);

  /* 打开工作台（读到的是 stub-model），之后不再刷新这个页面 */
  await page.goto(APP + '/index.html');
  await page.waitForTimeout(700);
  await page.locator('.news-item').first().click();
  await page.waitForTimeout(750);
  await page.locator('.product-card [data-pick]').first().click();
  await page.waitForTimeout(250);
  await page.locator('#view-2 .head-actions .btn.primary').click();
  await page.waitForTimeout(350);
  await page.locator('#view-3 .head-actions .btn.primary').click();
  await page.waitForTimeout(400);
  check('工作台快捷设置里显示的就是后台保存的模型（同一份配置）',
    (await page.locator('#quickModel').inputValue()) === 'stub-model' &&
    (await page.locator('#quickMode').inputValue()) === 'direct',
    '模型 ' + (await page.locator('#quickModel').inputValue()) + '，接入方式 ' + (await page.locator('#quickMode').inputValue()));

  /* 另开一个标签页，在后台把模型名改成 stub-model-v2 并保存；工作台这个页面保持不刷新 */
  const page2 = await ctx.newPage();
  await page2.goto(APP + '/admin.html#/model');
  await page2.waitForTimeout(1000);
  await setField(page2, '#mModel', 'stub-model-v2');
  await page2.click('#btnSave');
  await page2.waitForTimeout(900);
  check('后台已把模型名改为 stub-model-v2', (await getConfig()).model.model === 'stub-model-v2',
    '服务端 model=' + (await getConfig()).model.model);
  await page2.close();

  await fetch(STUB_API + '/__reset');
  await page.locator('#generateBtn').click();
  await page.waitForTimeout(3200);
  const calls = await (await fetch(STUB_API + '/__all')).json();
  const usedModels = Array.from(new Set(calls.requests.map(r => r.model)));
  check('工作台页面未刷新，下一次生成已经用了新模型',
    usedModels.length === 1 && usedModels[0] === 'stub-model-v2',
    '实际调用模型：' + usedModels.join('、') + '（共调用 ' + calls.count + ' 次）');
  const banner = (await page.locator('#genState').innerText()).replace(/\n/g, ' ');
  check('工作台结果区标注了实际使用的模型', /stub-model-v2/.test(banner), banner.slice(0, 70));
  out.numbers['改模型后实际调用'] = usedModels.join('、');
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'workbench-新模型生效.png') });

  /* ================= 反向同步：工作台改 → 后台看到 ================= */
  console.log('\n== 两边共用一份配置：工作台改，后台也能看到 ==');
  await setField(page, '#quickTemp', '1.35');
  await page.waitForTimeout(1200);
  const cfgAfterQuick = await getConfig();
  check('在工作台改温度后，服务端配置同步变化', Number(cfgAfterQuick.model.temperature) === 1.35,
    '服务端温度 = ' + cfgAfterQuick.model.temperature);
  await page.goto(APP + '/admin.html#/model');
  await page.waitForTimeout(1000);
  check('后台打开后看到的是工作台刚改的温度',
    Number(await page.locator('#mTemp').inputValue()) === 1.35,
    '后台温度 = ' + (await page.locator('#mTemp').inputValue()));
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-15-模型与接入.png') });

  /* ================= 清理 ================= */
  await putConfig(original);
  const back = await getConfig();
  check('已恢复初始模型配置', back.model.mode === original.model.mode && back.model.model === original.model.model,
    'mode=' + back.model.mode + '，model=' + back.model.model);
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
  fs.writeFileSync(path.join(ROOT, 'work', 'ui-model-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/ui-model-results.json');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('验收异常：', e); process.exit(2); });
