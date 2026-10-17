/* 部署后界面实测（真实浏览器 + 真实服务端，不需要任何第三方库参与运行）
   验证：
     1) 从 http:// 打开时，工作台状态灯显示"抓取服务在线"（不是演示模式）
     2) 后台顶栏徽章显示"服务端"，保存真的写回服务端并留下备份
     3) 静态收口在浏览器里也成立：/data/config.json 返回 403 页面
     4) 整站资源无 404、控制台无报错
   运行：node tests/ui-deploy-tests.js
   说明：仅测试用 playwright-core 驱动本机 Chrome；产物本身不依赖第三方库 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const PORT = 8797;
const BASE = 'http://127.0.0.1:' + PORT;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PW_CANDIDATES = [
  path.join(ROOT, '.test-tools', 'node_modules'),
  path.join(ROOT, 'node_modules'),
  path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'openclaw', 'node_modules')
];
function loadPlaywright() {
  for (const dir of PW_CANDIDATES) {
    try { return createRequire(path.join(dir, 'noop.js'))('playwright-core'); } catch (e) { /* 找下一个 */ }
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CONFIG_FILE = path.join(ROOT, 'data', 'config.json');
const BACKUP_DIR = path.join(ROOT, 'data', 'backups');

/* 保住用户现有配置：跑完还原 */
let savedConfig = null, savedBackups = [];
function snapshot() {
  if (fs.existsSync(CONFIG_FILE)) savedConfig = fs.readFileSync(CONFIG_FILE, 'utf8');
  if (fs.existsSync(BACKUP_DIR)) savedBackups = fs.readdirSync(BACKUP_DIR).map(f => path.join(BACKUP_DIR, f));
  if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
  if (fs.existsSync(BACKUP_DIR)) fs.readdirSync(BACKUP_DIR).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
}
function restore() {
  if (savedConfig !== null) fs.writeFileSync(CONFIG_FILE, savedConfig, 'utf8');
  savedBackups.forEach(src => { try { fs.copyFileSync(src, path.join(BACKUP_DIR, path.basename(src))); } catch (e) {} });
}

(async function run() {
  const { chromium } = loadPlaywright();
  const shots = path.join(ROOT, 'work', 'shots');
  fs.mkdirSync(shots, { recursive: true });
  snapshot();

  const env = Object.assign({}, process.env);
  delete env.PORT; delete env.HOST;
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js'), String(PORT)], { cwd: ROOT, env: env, stdio: 'ignore' });
  await sleep(1200);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 } });
  const page = await ctx.newPage();
  const errs = [];
  const notFound = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('response', r => { if (r.status() === 404) notFound.push(new URL(r.url()).pathname); });

  try {
    console.log('== 1. 服务端模式下的工作台 ==');
    await page.goto(BASE + '/index.html');
    await page.waitForTimeout(1200);
    const pill = (await page.locator('#envPill').innerText()).trim();
    check('工作台状态灯显示"抓取服务在线"（不是演示模式）', /抓取服务在线/.test(pill), '状态灯文本：' + pill);
    const dark = await page.evaluate(() => document.querySelector('#envPill').className);
    check('状态灯用正常样式而不是黄色警示样式', dark.indexOf('warn') < 0, 'class=' + dark);
    const badge = (await page.evaluate(async () => {
      const r = await fetch('api/config'); const j = await r.json();
      return j.ok ? (j.config.products || []).length : -1;
    }));
    check('页面能通过 http 读到服务端配置', badge > 0, '服务端配置里商品 ' + badge + ' 件');
    await page.screenshot({ path: path.join(shots, 'deploy-1-工作台-服务端模式.png') });

    console.log('\n== 2. 服务端模式下的后台 ==');
    await page.goto(BASE + '/admin.html');
    await page.waitForTimeout(1000);
    const srcName = (await page.locator('#srcName').innerText()).trim();
    check('后台顶栏徽章显示"服务端"', srcName === '服务端', '徽章文本：' + srcName);
    const lit = await page.evaluate(() => document.querySelectorAll('#srcLevel i.on').length);
    check('级别指示器点亮 3 格（最高一级）', lit === 3, '点亮 ' + lit + '/3');
    await page.screenshot({ path: path.join(shots, 'deploy-2-后台-服务端徽章.png') });

    console.log('\n== 3. 保存真的写到服务端 ==');
    const before = fs.existsSync(CONFIG_FILE) ? fs.statSync(CONFIG_FILE).mtimeMs : 0;
    const beforeBackups = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).length : 0;
    await page.evaluate(() => { location.hash = '#/model'; });
    await page.waitForTimeout(400);
    await page.click('#btnSave');
    await page.waitForTimeout(1400);
    const toast = (await page.locator('#toastWrap').innerText().catch(() => '')).replace(/\n/g, ' ').trim();
    const after = fs.existsSync(CONFIG_FILE) ? fs.statSync(CONFIG_FILE).mtimeMs : 0;
    const afterBackups = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).length : 0;
    check('保存后页面提示写到服务端', /服务端/.test(toast), toast ? '提示：' + toast.slice(0, 40) : '（没读到提示文本）');
    check('磁盘上的 data/config.json 真的被写了一次', after > before || (before === 0 && after > 0),
      'mtime ' + (before ? new Date(before).toLocaleTimeString('zh-CN') : '不存在') + ' → ' + new Date(after).toLocaleTimeString('zh-CN'));
    /* 再存一次：这时候磁盘上已经有上一版，必须能留下备份 */
    await page.click('#btnSave');
    await page.waitForTimeout(1200);
    const afterBackups2 = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).length : 0;
    check('第二次保存给上一版留下备份', afterBackups2 > afterBackups, '备份 ' + afterBackups + ' → ' + afterBackups2 + ' 份');
    out.numbers['保存写盘'] = 'data/config.json 已更新，备份 ' + afterBackups2 + ' 份';
    await page.screenshot({ path: path.join(shots, 'deploy-3-后台-保存到服务端.png') });

    console.log('\n== 4. 静态收口在浏览器里的表现 ==');
    const errsBeforeProbe = errs.length;   /* 下面两次 403 是有意为之，浏览器会记一条资源加载失败，不算脚本报错 */
    const resp = await page.goto(BASE + '/data/config.json');
    check('浏览器直接访问 /data/config.json 得到 403', resp.status() === 403, 'HTTP ' + resp.status());
    const bodyText = (await page.locator('body').innerText()).trim();
    check('403 页面给出可读说明', /Forbidden/.test(bodyText) && /不对静态访问开放/.test(bodyText), bodyText.slice(0, 50));
    await page.screenshot({ path: path.join(shots, 'deploy-4-敏感路径403.png') });
    const resp2 = await page.goto(BASE + '/server/server.js');
    check('服务端源码同样拿不到', resp2.status() === 403, 'GET /server/server.js → ' + resp2.status());

    console.log('\n== 5. 整站健康 ==');
    await page.goto(BASE + '/index.html');
    await page.waitForTimeout(900);
    check('页面加载过程中没有 404 资源', notFound.length === 0, notFound.length ? notFound.slice(0, 4).join('、') : '0 个 404');
    const realErrs = errs.slice(0, errsBeforeProbe).filter(e => !/favicon/i.test(e));
    check('控制台没有脚本报错', realErrs.length === 0, realErrs.length ? realErrs.slice(0, 2).join(' | ') : '无报错');
  } catch (e) {
    check('部署界面实测未抛出异常', false, e.message);
  } finally {
    await browser.close().catch(() => {});
    await new Promise(resolve => {
      let done = false;
      srv.once('exit', () => { done = true; resolve(); });
      srv.kill();
      setTimeout(() => { if (!done) resolve(); }, 1500);
    });
    restore();
  }

  out.finishedAt = new Date().toISOString();
  out.pass = pass; out.fail = fail;
  fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'work', 'ui-deploy-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/ui-deploy-results.json');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('UI 测试异常：', e); process.exit(2); });
