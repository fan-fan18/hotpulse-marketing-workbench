/* 后台外壳 UI 实测（真实浏览器）
   验证：
     1) 后台各页之间能互相跳转，也能跳回工作台；左侧两组导航都工作
     2) 不启动服务时徽章显示「本机浏览器」；启动后显示「服务端」
   运行：node tests/ui-smoke.js
   说明：仅测试用 playwright-core 驱动本机 Chrome；产物本身不依赖任何第三方库 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const PORT = 8792;
const BASE = 'http://127.0.0.1:' + PORT;
const FILE_URL = 'file:///' + ROOT.replace(/\\/g, '/') + '/admin.html';
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

(async function run() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  console.log('== 场景 1：不启动服务端（直接打开 admin.html） ==');
  await page.goto(FILE_URL);
  await page.waitForTimeout(900);
  const badge1 = (await page.locator('#srcName').innerText()).trim();
  const lsOk = await page.evaluate(() => {
    try { localStorage.setItem('__probe__', '1'); localStorage.removeItem('__probe__'); return true; } catch (e) { return false; }
  });
  check('不启动服务时徽章显示「本机浏览器」', badge1 === '本机浏览器',
    '徽章文本：' + badge1 + '（file:// 下 localStorage 可用=' + lsOk + '）');
  out.numbers['无服务端徽章'] = badge1;
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-1-本机浏览器.png') });

  console.log('\n== 场景 1：页面跳转与左侧两组导航 ==');
  const pages = [
    ['prompts', '提示词与模板'], ['styles', '创作风格与语调'], ['model', '模型与接入设置'],
    ['products', '商品库'], ['sources', '抓取来源配置'], ['eval', '文案效果评测与自动返工'], ['overview', '配置总览']
  ];
  let navOk = true;
  const navDetail = [];
  for (const [key, expectTitle] of pages) {
    await page.click('#navPages [data-page="' + key + '"]');
    await page.waitForTimeout(180);
    const h = (await page.locator('.page-head h1').innerText()).trim();
    const hash = await page.evaluate(() => location.hash);
    if (h !== expectTitle || hash !== '#/' + key) {
      navOk = false;
      navDetail.push(key + '→标题"' + h + '"/hash"' + hash + '"');
    }
  }
  check('左侧「其它后台页面」7 个页面都能互相跳转', navOk,
    navOk ? '依次跳转 7 页，标题与地址栏都正确' : navDetail.join('；'));

  const sectionCount = await page.locator('.sec').count();
  const firstTitle = (await page.locator('.sec-head h3').first().innerText()).trim();
  const firstDesc = (await page.locator('.sec-head .desc').first().innerText()).trim();
  check('内容区是卡片式分节（每节含标题与一句说明）', sectionCount >= 3 && firstTitle.length > 0 && firstDesc.length > 0,
    '当前页区块数 ' + sectionCount + '，首节："' + firstTitle + '" / "' + firstDesc + '"');

  await page.click('#navSections [data-scroll="sec-pages"]');
  await page.waitForTimeout(700);
  const scrollY = await page.evaluate(() => Math.round(window.scrollY));
  check('左侧「本页配置区块」能滚动定位', scrollY > 0, '点击后 scrollY=' + scrollY);

  const backHref = await page.getAttribute('#backBtn', 'href');
  const hasWorkbench = fs.existsSync(path.join(ROOT, 'index.html'));
  check('顶栏有返回工作台入口且目标存在', backHref === 'index.html' && hasWorkbench, '返回链接 href=' + backHref);

  const barPos = await page.evaluate(() => getComputedStyle(document.getElementById('adminBar')).position);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  const barVisible = await page.locator('#adminBar').isVisible();
  check('底部操作栏固定在底部、滚动时不消失', barPos === 'fixed' && barVisible,
    'position=' + barPos + '，滚动到底部仍可见=' + barVisible);

  console.log('\n== 场景 2：启动本地服务端 ==');
  const srv = spawn('node', [path.join(ROOT, 'server', 'server.js'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1000));

  await page.goto(BASE + '/admin.html');
  await page.waitForTimeout(900);
  const badge2 = (await page.locator('#srcName').innerText()).trim();
  check('启动服务端后徽章显示「服务端」', badge2 === '服务端', '徽章文本：' + badge2);
  out.numbers['有服务端徽章'] = badge2;
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-2-服务端.png') });

  const levelOn = await page.evaluate(() => document.querySelectorAll('#srcLevel i.on').length);
  check('徽章上的级别指示器点亮 3 格', levelOn === 3, '点亮格数 ' + levelOn + '/3');

  await page.evaluate(() => { location.hash = '#/prompts'; });
  await page.waitForTimeout(300);
  await page.click('#btnSave');
  await page.waitForTimeout(900);
  const barText = (await page.locator('#barTitle').innerText()).trim();
  const toastText = (await page.locator('#toastWrap').innerText().catch(() => '')).replace(/\n/g, ' ').trim();
  check('底部操作栏保存按钮可用且提示写回位置', /已保存/.test(barText) && /服务端/.test(toastText),
    '状态栏"' + barText + '"，提示"' + toastText + '"');

  const savedOnServer = await page.evaluate(async () => {
    const r = await fetch('api/config');
    const j = await r.json();
    return !!(j.ok && j.config && j.config.ui);
  });
  check('保存后服务端配置文件可读回', savedOnServer, 'GET /api/config 返回正常');
  check('整个流程没有前端脚本报错', errs.length === 0, errs.length ? errs.slice(0, 3).join(' | ') : '无报错');

  await browser.close();
  await new Promise(function (resolve) {
    let done = false;
    srv.once('exit', function () { done = true; resolve(); });
    srv.kill();
    setTimeout(function () { if (!done) resolve(); }, 1500);
  });
  await new Promise(r => setTimeout(r, 200));

  out.finishedAt = new Date().toISOString();
  out.pass = pass;
  out.fail = fail;
  fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'work', 'ui-smoke-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/ui-smoke-results.json');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('UI 测试异常：', e); process.exit(2); });
