/* 实时预览 + 试运行 验收（真实浏览器）
   验收 1：修改模板 → 预览立即变化、字数同步更新
   验收 2：配好密钥试运行能真出文案；模型名写错能看到「模型名不存在」；密钥错 → 密钥无效
   运行：node tests/ui-trial-tests.js
   链路：浏览器直连 → 本地 stub 服务商（真实 HTTP、真实状态码）
         本地服务中转 → hotpulse 服务端（密钥走环境变量，浏览器不接触） */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const STUB_PORT = 8794, APP_PORT = 8795;
const STUB = 'http://127.0.0.1:' + STUB_PORT + '/v1';
const APP = 'http://127.0.0.1:' + APP_PORT;
const FILE_ADMIN = 'file:///' + ROOT.replace(/\\/g, '/') + '/admin.html#/prompts';
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
const countChars = s => String(s || '').replace(/\s/g, '').length;

async function blocks(page) {
  const b = await page.locator('#promptPreviewBlocks .preview-block').all();
  const sysText = await b[0].locator('pre').innerText();
  const matText = await b[1].locator('pre').innerText();
  const sysBadge = parseInt((await b[0].locator('.char-count').innerText()).replace(/\D/g, ''), 10);
  const matBadge = parseInt((await b[1].locator('.char-count').innerText()).replace(/\D/g, ''), 10);
  return { sysText, matText, sysBadge, matBadge };
}

async function setField(page, sel, value) {
  await page.fill(sel, value);
  await page.evaluate(s => {
    const el = document.querySelector(s);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, sel);
  await page.waitForTimeout(200);
}

async function trial(page) {
  await page.locator('#trialRun').click();
  await page.waitForTimeout(2500);
  const host = page.locator('#trialResult');
  const text = (await host.innerText()).trim();
  return text;
}

(async function run() {
  const { chromium } = loadPlaywright();
  const stub = spawn('node', [path.join(__dirname, 'stub-provider.js'), String(STUB_PORT)], { stdio: 'ignore' });
  const app = spawn('node', [path.join(ROOT, 'server', 'server.js'), String(APP_PORT)], {
    cwd: ROOT, stdio: 'ignore', env: Object.assign({}, process.env, { HOTPULSE_API_KEY: 'sk-good-env-key' })
  });
  await new Promise(r => setTimeout(r, 1200));

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 } });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());   // 测试里跨页跳转按确认离开处理
  const jsErrors = [];        // 真正的脚本异常
  const httpLogs = [];        // 故意触发的 401/404 等状态日志（预期内）
  page.on('pageerror', e => jsErrors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(m.text())) httpLogs.push(m.text());
    else jsErrors.push('console: ' + m.text());
  });

  /* ================= 验收 1：实时预览 ================= */
  console.log('== 验收 1：改模板，预览立即变化、字数同步 ==');
  await page.goto(FILE_ADMIN);
  await page.waitForTimeout(1000);

  const b0 = await blocks(page);
  check('预览分块展示：规范说明一块 + 拼装素材一块，各自带字数',
    b0.sysText.length > 20 && b0.matText.length > 20 && b0.sysBadge === countChars(b0.sysText) && b0.matBadge === countChars(b0.matText),
    '规范块 ' + b0.sysBadge + ' 字（实测 ' + countChars(b0.sysText) + '）、素材块 ' + b0.matBadge + ' 字（实测 ' + countChars(b0.matText) + '）');

  /* 改角色设定 */
  await page.fill('#roleText', '你是电商媒体的资深微博内容运营，只写口语化短句。');
  await page.waitForTimeout(300);
  const b1 = await blocks(page);
  check('改「角色设定」后规范块立即变化、字数同步', b1.sysText.indexOf('只写口语化短句') > -1 && b1.sysBadge === countChars(b1.sysText),
    '规范块 ' + b0.sysBadge + ' → ' + b1.sysBadge + ' 字');

  /* 改写作规范 */
  await page.locator('[data-rule]').first().fill('金额只能原样使用素材里的数字，一个都不许自己编。');
  await page.waitForTimeout(300);
  const b2 = await blocks(page);
  check('改「写作规范」后规范块立即变化、字数同步',
    b2.sysText.indexOf('一个都不许自己编') > -1 && b2.sysBadge === countChars(b2.sysText),
    '规范块 ' + b1.sysBadge + ' → ' + b2.sysBadge + ' 字');

  /* 改素材模板 */
  await page.fill('#materialTpl', '【我来改过的素材模板】\n标题：{{热点标题}}\n可用话题：{{话题标签}}\n\n【商品】\n{{商品清单}}');
  await page.waitForTimeout(350);
  const b3 = await blocks(page);
  check('改「素材模板」后素材块立即变化、字数同步',
    b3.matText.indexOf('【我来改过的素材模板】') > -1 && b3.matBadge === countChars(b3.matText),
    '素材块 ' + b2.matBadge + ' → ' + b3.matBadge + ' 字，预览开头：' + b3.matText.split('\n')[0]);

  /* 改单件商品格式 */
  await page.fill('#productTpl', '{{序号}}.{{商品名称}}（{{品牌}}） 售价{{售价}} 原价{{原价}} 卖点:{{卖点列表}}');
  await page.waitForTimeout(350);
  const prodPreview = await page.locator('#productPreview pre').innerText();
  check('改「单件商品格式」后商品清单预览立即跟着变',
    prodPreview.split('\n')[0].indexOf('（') > -1 && prodPreview.split('\n').length >= 3,
    '第一行：' + prodPreview.split('\n')[0].slice(0, 46));

  /* ================= 验收 2：试运行（本地模拟） ================= */
  console.log('\n== 验收 2：试运行（本地模拟模式） ==');
  const mockTrial = await trial(page);
  check('模拟模式试运行出结果，并标注模型与接入方式',
    /本地模拟/.test(mockTrial) && /hotpulse-mock/.test(mockTrial),
    mockTrial.split('\n').slice(0, 3).join(' ｜ ').slice(0, 90));
  check('模拟模式明确提示「不代表真实模型效果」', /不代表真实模型效果/.test(mockTrial),
    (mockTrial.match(/[^\n]*不代表真实模型效果[^\n]*/) || [''])[0].slice(0, 60));
  check('结果里包含耗时与消耗量', /耗时：\s*\d+\s*ms/.test(mockTrial) && /tokens/.test(mockTrial),
    (mockTrial.match(/耗时：[^\n]*/) || [''])[0].slice(0, 60));
  check('结果标注「只用于调试、不写回工作台」', /不写回工作台|没有写回工作台/.test(mockTrial),
    (mockTrial.match(/[^\n]*写回工作台[^\n]*/) || [''])[0].slice(0, 40));
  out.numbers['模拟试运行'] = mockTrial.split('\n').slice(0, 2).join(' / ');
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-7-试运行-模拟.png') });

  /* ================= 验收 2：真实 HTTP 链路 ================= */
  console.log('\n== 验收 2：浏览器直连真实端点 ==');
  await page.goto(APP + '/admin.html#/prompts');
  await page.waitForTimeout(1000);
  await page.selectOption('#trialMode', 'direct');
  await page.waitForTimeout(400);
  await setField(page, '#trialBaseUrl', STUB);
  await setField(page, '#trialModel', 'stub-model');
  await setField(page, '#trialKey', 'sk-good-123');
  /* 在新页面上重新改一遍模板（改完不保存），验证"当前编辑中的模板"会被真实发出 */
  await page.fill('#roleText', '你是电商媒体编辑，只写口语化短句。');
  await page.fill('#materialTpl', '【直连试运行模板】\n标题：{{热点标题}}\n话题：{{话题标签}}\n\n{{商品清单}}');
  await page.fill('#productTpl', '{{序号}}.{{商品名称}}（{{品牌}}） 售价{{售价}} 原价{{原价}}');
  await page.waitForTimeout(350);
  await page.waitForTimeout(300);

  const directTrial = await trial(page);
  check('浏览器直连：配好密钥后试运行真出了一段文案',
    /stub-model/.test(directTrial) && /浏览器直连/.test(directTrial) && /stub-model 返回的示例文案/.test(directTrial),
    directTrial.split('\n').slice(0, 3).join(' ｜ ').slice(0, 100));
  check('真实链路下不再出现「模拟输出」提示', !/模拟输出/.test(directTrial), '结果里只有真实模型信息，没有模拟提示');
  const lastReq = await (await fetch('http://127.0.0.1:' + STUB_PORT + '/__last')).json();
  const lastMsgs = (lastReq.last && lastReq.last.messages) || [];
  const sentUser = String((lastMsgs.filter(m => m.role === 'user')[0] || {}).content || '');
  const sentSys = String((lastMsgs.filter(m => m.role === 'system')[0] || {}).content || '');
  check('发给模型的就是当前编辑中的模板（未保存也生效）',
    sentUser.indexOf('【直连试运行模板】') > -1 && sentSys.indexOf('只写口语化短句') > -1,
    '素材开头：' + sentUser.replace(/\s+/g, ' ').slice(0, 40));
  check('试运行带上「单件商品格式」渲染结果与真实价格',
    sentUser.indexOf('¥299') > -1 && (sentUser.split('\n').filter(l => l.indexOf('三合一') > -1)[0] || '').indexOf('（') > -1,
    (sentUser.split('\n').filter(l => l.indexOf('三合一') > -1)[0] || '').slice(0, 46));
  out.numbers['直连试运行'] = directTrial.split('\n').slice(0, 3).join(' / ');
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-8-试运行-真实链路.png') });

  console.log('\n== 验收 2：可读的失败原因 ==');
  await setField(page, '#trialModel', 'no-such-model-xyz');
  const badModel = await trial(page);
  check('模型名写错 → 提示「模型名不存在」', /模型名不存在/.test(badModel),
    (badModel.match(/[^\n]*模型名不存在[^\n]*/) || [''])[0].slice(0, 70));
  const rawDetail = await page.evaluate(() => {
    const d = document.querySelector('#trialResult details');
    return d ? { hasDetails: true, text: d.textContent } : { hasDetails: false, text: '' };
  });
  check('失败时原始报错被收进「技术细节」而不是直接甩出来',
    /技术细节/.test(badModel) && rawDetail.hasDetails && /404/.test(rawDetail.text) && /model_not_found/.test(rawDetail.text),
    '折叠区内容：' + rawDetail.text.replace(/\s+/g, ' ').slice(0, 70));

  await setField(page, '#trialModel', 'stub-model');
  await setField(page, '#trialKey', 'sk-bad-key');
  const badKey = await trial(page);
  check('密钥错误 → 提示「密钥无效」', /密钥无效/.test(badKey),
    (badKey.match(/[^\n]*密钥无效[^\n]*/) || [''])[0].slice(0, 70));

  await setField(page, '#trialKey', 'sk-good-123');
  await setField(page, '#trialModel', 'stub-rate-limit');
  const rateLimited = await trial(page);
  check('被限流 → 提示「限流」', /限流/.test(rateLimited),
    (rateLimited.match(/[^\n]*限流[^\n]*/) || [''])[0].slice(0, 60));

  await setField(page, '#trialModel', 'stub-no-balance');
  const noBalance = await trial(page);
  check('额度用尽 → 提示「余额不足」', /余额不足/.test(noBalance),
    (noBalance.match(/[^\n]*余额不足[^\n]*/) || [''])[0].slice(0, 60));

  /* 本地服务中转：密钥放服务端环境变量，浏览器不填密钥 */
  console.log('\n== 验收 2：本地服务中转（密钥不出现在浏览器） ==');
  await setField(page, '#trialModel', 'stub-model');
  await page.selectOption('#trialMode', 'proxy');
  await page.waitForTimeout(400);
  await setField(page, '#trialBaseUrl', STUB);
  await setField(page, '#trialModel', 'stub-model');
  await setField(page, '#trialKey', '');
  const proxyTrial = await trial(page);
  check('本地服务中转：浏览器不填密钥也能出文案', /本地服务中转/.test(proxyTrial) && /stub-model 返回的示例文案/.test(proxyTrial),
    proxyTrial.split('\n').slice(0, 3).join(' ｜ ').slice(0, 90));
  const proxyLast = await (await fetch('http://127.0.0.1:' + STUB_PORT + '/__last')).json();
  check('中转时密钥由服务端注入（stub 收到的是服务端环境变量里的密钥）',
    String(proxyLast.last && proxyLast.last.auth).indexOf('sk-good-env-key') > -1,
    'stub 收到的 Authorization：' + String((proxyLast.last && proxyLast.last.auth) || '').replace(/sk-[\w-]+/, 'sk-***'));
  out.numbers['中转试运行'] = proxyTrial.split('\n').slice(0, 2).join(' / ');

  /* ================= 试运行不写回工作台 ================= */
  console.log('\n== 试运行只用于调试，不写回工作台 ==');
  const serverCfg = await (await fetch(APP + '/api/config')).json();
  check('服务端配置没有被试运行改动（model.mode 仍为默认 mock）',
    serverCfg.ok && serverCfg.config.model.mode === 'mock',
    '服务端 model.mode = ' + serverCfg.config.model.mode + '（页面上只是未保存的草稿）');
  await page.goto(APP + '/index.html');
  await page.waitForTimeout(700);
  await page.locator('.news-item').first().click();
  await page.waitForTimeout(800);
  await page.locator('.product-card [data-pick]').first().click();
  await page.waitForTimeout(200);
  await page.locator('#view-2 .head-actions .btn.primary').click();
  await page.waitForTimeout(300);
  await page.locator('#view-3 .head-actions .btn.primary').click();
  await page.waitForTimeout(400);
  const emptyState = await page.locator('#versionList .empty-state').innerText().catch(() => '');
  check('工作台里没有出现试运行的结果（候选列表仍为空）', /尚未生成文案/.test(emptyState),
    emptyState.replace(/\n/g, ' ').slice(0, 50));

  check('全流程没有前端脚本报错', jsErrors.length === 0, jsErrors.length ? jsErrors.slice(0, 2).join(' | ') : '无脚本异常');
  check('故意触发的失败请求只留下 HTTP 状态日志（属于预期）', httpLogs.length >= 2,
    '预期内的状态日志 ' + httpLogs.length + ' 条（401/402/404/429）');

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
  fs.writeFileSync(path.join(ROOT, 'work', 'ui-trial-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/ui-trial-results.json');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('验收异常：', e); process.exit(2); });
