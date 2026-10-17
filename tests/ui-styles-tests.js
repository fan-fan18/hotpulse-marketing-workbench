/* 创作风格与语调 验收（真实浏览器）
   验收 1：新增一个创作风格并保存 → 工作台生成时多出对应候选版本
   验收 2：新增一个语调并保存 → 工作台主打语调选项里出现它（并作为素材传给模型）
   验收 3：尝试删掉最后一个创作风格 → 被拦住并给出说明
   运行：node tests/ui-styles-tests.js */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const STUB_PORT = 8799, APP_PORT = 8798;
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

async function generateOnWorkbench(page) {
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
  await page.locator('#generateBtn').click();
  await page.waitForTimeout(3000);
  const labels = await page.locator('.version-head .vt strong').allInnerTexts();
  const styleTags = await page.locator('.version-head .vt .tag.brand').allInnerTexts();
  return { labels, styleTags };
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
  out.numbers['初始风格数'] = original.styles.length;
  out.numbers['初始语调数'] = original.tones.length;

  /* ============ 验收 3：删到零被拦住 ============ */
  console.log('== 验收 3：尝试删掉最后一个创作风格 ==');
  await page.goto(APP + '/admin.html#/styles');
  await page.waitForTimeout(1000);

  let guard = 0;
  while ((await page.locator('[data-sdel]').count()) > 1 && guard++ < 10) {
    const n = await page.locator('[data-sdel]').count();
    await page.locator('[data-sdel]').nth(n - 1).click();
    await page.waitForTimeout(250);
  }
  const leftBefore = await page.locator('[data-sdel]').count();
  check('可以先删到只剩 1 个风格', leftBefore === 1, '当前风格数 ' + leftBefore);

  await page.locator('[data-sdel]').first().click();
  await page.waitForTimeout(400);
  const modalText = await page.locator('.admin-modal').innerText().catch(() => '');
  check('删最后一个时被拦住并弹出说明', /不能删掉最后一个创作风格/.test(modalText),
    modalText.split('\n').slice(0, 2).join(' ').slice(0, 60));
  check('说明里讲清了原因与替代做法', /至少要保留一个风格/.test(modalText) && /先新增/.test(modalText),
    (modalText.match(/[^\n]*先新增[^\n]*/) || [''])[0].slice(0, 50));
  const leftAfter = await page.locator('[data-sdel]').count();
  check('被拦住后风格数量没有变化', leftAfter === 1, '仍为 ' + leftAfter + ' 个');
  out.numbers['删到最后一个被拦'] = '数量保持 ' + leftAfter + ' 个';
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-10-风格删到零被拦.png') });
  await page.locator('.admin-modal .btn').first().click();
  await page.waitForTimeout(300);

  /* 重新加载，丢弃刚才的删除草稿（注意：相同 URL 用 reload 才会真正重新加载文档） */
  await page.reload();
  await page.waitForTimeout(900);
  check('刷新后回到已保存的 ' + original.styles.length + ' 个风格（草稿未写回）',
    (await page.locator('[data-sdel]').count()) === original.styles.length,
    '当前 ' + (await page.locator('[data-sdel]').count()) + ' 个');

  /* ============ 验收 1：新增风格 → 工作台多一个候选版本 ============ */
  console.log('\n== 验收 1：新增创作风格并保存 ==');
  const NEW_STYLE = '实测新增风格A';
  const NEW_REQ = '实测要求：必须先点出直播间的限时福利，再用提问收尾。';
  await page.locator('#addStyle').click();
  await page.waitForTimeout(400);
  const rowsBefore = await page.locator('[data-sreq]').count();
  await page.locator('[data-sname]').nth(rowsBefore - 1).fill(NEW_STYLE);
  await page.locator('[data-sreq]').nth(rowsBefore - 1).fill(NEW_REQ);
  await page.waitForTimeout(400);
  const hint = await page.locator('#sec-st-list .help').first().innerText();
  check('页面提示候选版本数随之增加', new RegExp('产出\\s*' + rowsBefore + '\\s*个候选版本').test(hint.replace(/\s+/g, ' ')),
    hint.replace(/\s+/g, ' ').slice(0, 60));
  await page.click('#btnSave');
  await page.waitForTimeout(900);
  const savedCfg = await getConfig();
  check('保存成功，服务端配置里出现了新风格',
    savedCfg.styles.length === rowsBefore && savedCfg.styles[savedCfg.styles.length - 1].name === NEW_STYLE,
    '风格数 ' + savedCfg.styles.length + '，最后一个：' + savedCfg.styles[savedCfg.styles.length - 1].name);

  /* 让工作台的生成走真实 HTTP（本地 stub 服务商），以便验证"新风格的要求真的传给了模型" */
  const withDirect = JSON.parse(JSON.stringify(savedCfg));
  withDirect.model = Object.assign({}, withDirect.model, { mode: 'direct', baseUrl: STUB, model: 'stub-model', apiKey: 'sk-good-123' });
  await putConfig(withDirect);
  await fetch(STUB_API + '/__reset');

  const gen1 = await generateOnWorkbench(page);
  check('工作台按风格数量产出候选版本（新增风格后多出一版）',
    gen1.styleTags.length === rowsBefore + 0 || gen1.styleTags.length === savedCfg.styles.length,
    '风格 ' + savedCfg.styles.length + ' 个 → 候选版本 ' + gen1.styleTags.length + ' 个：' + gen1.styleTags.join('、'));
  check('新风格出现在候选版本里', gen1.styleTags.indexOf(NEW_STYLE) > -1,
    gen1.labels.length ? gen1.labels.join(' ｜ ') : '（无版本）');
  const calls1 = await (await fetch(STUB_API + '/__all')).json();
  const composeCalls = calls1.requests.filter(r => r.kind !== 'rework');
  const reworkCalls = calls1.requests.filter(r => r.kind === 'rework');
  const reqWithNewReq = composeCalls.filter(r => {
    const u = ((r.messages || []).filter(m => m.role === 'user')[0] || {}).content || '';
    return u.indexOf(NEW_REQ) > -1;
  });
  check('每个风格各调用一次模型（返工调用另算）', composeCalls.length === savedCfg.styles.length,
    '生成调用 ' + composeCalls.length + ' = 风格数 ' + savedCfg.styles.length +
    (reworkCalls.length ? '；另有 ' + reworkCalls.length + ' 次自动返工调用' : ''));
  check('新风格的创作要求原样进了这次调用的素材', reqWithNewReq.length >= 1,
    '含新要求的请求 ' + reqWithNewReq.length + ' 个；其中一段：' +
    ((((reqWithNewReq[0] || {}).messages || []).filter(m => m.role === 'user')[0] || {}).content || '').split('\n').filter(l => l.indexOf('风格要求') > -1)[0]);
  out.numbers['新增风格后候选版本'] = gen1.styleTags.length;
  out.numbers['生成调用次数'] = calls1.count;
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'workbench-新增风格候选版本.png') });

  /* ============ 验收 2：新增语调 → 工作台选项里出现它 ============ */
  console.log('\n== 验收 2：新增语调并保存 ==');
  const NEW_TONE = '实测新语调B';
  await page.goto(APP + '/admin.html#/styles');
  await page.waitForTimeout(900);
  await page.locator('#addTone').click();
  await page.waitForTimeout(350);
  const toneRows = await page.locator('[data-tone]').count();
  await page.locator('[data-tone]').nth(toneRows - 1).fill(NEW_TONE);
  await page.waitForTimeout(350);
  await page.click('#btnSave');
  await page.waitForTimeout(900);
  const cfg2 = await getConfig();
  check('保存成功，服务端配置里出现了新语调',
    cfg2.tones.some(t => t.name === NEW_TONE), '语调：' + cfg2.tones.map(t => t.name).join('、'));

  await page.goto(APP + '/index.html');
  await page.waitForTimeout(700);
  await page.locator('.news-item').first().click();
  await page.waitForTimeout(750);
  await page.locator('.product-card [data-pick]').first().click();
  await page.waitForTimeout(200);
  await page.locator('#view-2 .head-actions .btn.primary').click();
  await page.waitForTimeout(300);
  await page.locator('#view-3 .head-actions .btn.primary').click();
  await page.waitForTimeout(400);
  const toneOptions = await page.locator('#tonePick option').allInnerTexts();
  check('工作台「主打语调」下拉里出现新语调', toneOptions.indexOf(NEW_TONE) > -1,
    '可选：' + toneOptions.join('、'));
  await page.selectOption('#tonePick', NEW_TONE);
  await page.waitForTimeout(200);
  check('可以选中新语调', (await page.locator('#tonePick').inputValue()) === NEW_TONE, '当前选中：' + NEW_TONE);

  await fetch(STUB_API + '/__reset');
  await page.locator('#generateBtn').click();
  await page.waitForTimeout(3000);
  const calls2 = await (await fetch(STUB_API + '/__all')).json();
  const tonePassed = calls2.requests.filter(r => {
    const u = ((r.messages || []).filter(m => m.role === 'user')[0] || {}).content || '';
    return u.indexOf('主打语调：' + NEW_TONE) > -1;
  });
  check('新语调作为素材的一部分传给了模型', tonePassed.length >= 1,
    '含「主打语调：' + NEW_TONE + '」的请求 ' + tonePassed.length + ' 个');
  out.numbers['新增语调'] = NEW_TONE + '，可选 ' + toneOptions.length + ' 项';
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'workbench-新增语调.png') });

  /* ============ 清理：恢复默认风格/语调与模型配置 ============ */
  console.log('\n== 清理，恢复初始配置 ==');
  const back = JSON.parse(JSON.stringify(original));
  const r = await putConfig(back);
  const finalCfg = await getConfig();
  check('已恢复初始风格 / 语调 / 模型配置',
    r.status === 200 && finalCfg.styles.length === original.styles.length &&
    finalCfg.tones.length === original.tones.length && finalCfg.model.mode === original.model.mode,
    '风格 ' + finalCfg.styles.length + ' 个、语调 ' + finalCfg.tones.length + ' 个、模型模式 ' + finalCfg.model.mode);

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
  await new Promise(r2 => setTimeout(r2, 200));

  out.finishedAt = new Date().toISOString();
  out.pass = pass;
  out.fail = fail;
  fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'work', 'ui-styles-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/ui-styles-results.json');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('验收异常：', e); process.exit(2); });
