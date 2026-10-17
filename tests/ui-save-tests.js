/* 统一保存机制 验收（真实浏览器 + 真实服务端）
   验收 1：改了不保存直接刷新，会被提醒
   验收 2：手动删掉服务端配置里的一段，重开后台能自动补齐并正常工作
   验收 3：导入格式错误的文件，给出明确错误且原配置不受影响
   另测：未保存提示、Ctrl+S、离开页面拦截、分区块恢复默认、导出再导入
   运行：node tests/ui-save-tests.js */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const APP_PORT = 8808;
const APP = 'http://127.0.0.1:' + APP_PORT;
const CONFIG_FILE = path.join(ROOT, 'data', 'config.json');
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
async function cfgHash() { return JSON.stringify(await getConfig()); }

(async function run() {
  const { chromium } = loadPlaywright();
  fs.mkdirSync(TMP, { recursive: true });
  const app = spawn('node', [path.join(ROOT, 'server', 'server.js'), String(APP_PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) jsErrors.push(m.text());
  });

  /* ================= 未保存提示 ================= */
  console.log('== 未保存改动提示 ==');
  await page.goto(APP + '/admin.html#/prompts');
  await page.waitForTimeout(1000);
  check('初始状态：底部操作栏显示「已保存」',
    (await page.locator('#barTitle').innerText()).trim() === '已保存' &&
    !(await page.locator('#dirtyFlag').isVisible()),
    '状态栏「' + (await page.locator('#barTitle').innerText()).trim() + '」');

  await page.fill('#roleText', '你是电商媒体编辑，只写口语化短句。');
  await page.waitForTimeout(300);
  check('改动后：底部操作栏显示「有未保存的改动」并出现标记',
    (await page.locator('#barTitle').innerText()).trim() === '有未保存的改动' &&
    (await page.locator('#dirtyFlag').isVisible()),
    '状态栏「' + (await page.locator('#barTitle').innerText()).trim() + '」，提示条可见=' + (await page.locator('#dirtyFlag').isVisible()));

  /* ================= 验收 1：刷新被提醒 ================= */
  console.log('\n== 验收 1：改了不保存直接刷新 ==');
  let dialogType = null, dialogText = '';
  page.once('dialog', async d => { dialogType = d.type(); dialogText = d.message(); await d.dismiss(); });
  await page.reload({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);
  check('刷新时弹出拦截提醒（beforeunload）', dialogType === 'beforeunload',
    '对话框类型：' + dialogType + '，文案：' + String(dialogText).slice(0, 30));
  check('选择「留下」后页面没有跳走，改动还在',
    (await page.locator('#barTitle').innerText()).trim() === '有未保存的改动' &&
    (await page.locator('#roleText').inputValue()) === '你是电商媒体编辑，只写口语化短句。',
    '仍在当前页，输入框内容保留');
  out.numbers['刷新拦截'] = 'beforeunload 已弹出';
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-16-未保存提示.png') });

  /* ================= Ctrl+S 保存 ================= */
  console.log('\n== 保存快捷键 Ctrl+S ==');
  await page.keyboard.press('Control+S');
  await page.waitForTimeout(1000);
  const toastText = (await page.locator('#toastWrap').innerText().catch(() => '')).replace(/\n/g, ' ').trim();
  check('Ctrl+S 能保存，并说明写回了哪里', /已保存到/.test(toastText) && /服务端/.test(toastText),
    toastText.slice(0, 60));
  check('保存后状态回到「已保存」', (await page.locator('#barTitle').innerText()).trim() === '已保存');
  check('保存内容真的写到了服务端', (await getConfig()).prompt.role === '你是电商媒体编辑，只写口语化短句。',
    '服务端 prompt.role = ' + (await getConfig()).prompt.role.slice(0, 18));
  out.numbers['保存提示'] = toastText.slice(0, 50);

  /* 保存后再刷新，不应再拦 */
  let dialog2 = null;
  page.once('dialog', async d => { dialog2 = d.type(); await d.accept(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  check('保存后再刷新不再拦截', dialog2 === null, '对话框：' + dialog2);

  /* ================= 离开页面拦截 ================= */
  console.log('\n== 离开页面拦截 ==');
  await page.fill('#roleText', '改一下但先不保存');
  await page.waitForTimeout(300);
  await page.click('#navPages [data-page="styles"]');
  await page.waitForTimeout(500);
  const modalText = await page.locator('.admin-modal').innerText().catch(() => '');
  check('点其它后台页面时先问一下', /有未保存的改动/.test(modalText),
    modalText.split('\n').slice(0, 2).join(' ').slice(0, 50));
  check('提示里给出了三个选择', /留在本页/.test(modalText) && /放弃改动并离开/.test(modalText) && /保存并离开/.test(modalText),
    '留在本页 / 放弃改动并离开 / 保存并离开');
  check('提示里说明改了哪些区块', /提示词与模板/.test(modalText),
    (modalText.match(/改动内容：[^\n]*/) || [''])[0].slice(0, 40));
  await page.locator('.admin-modal .btn', { hasText: '留在本页' }).click();
  await page.waitForTimeout(400);
  check('选「留在本页」后没有跳走，改动还在',
    (await page.evaluate(() => location.hash)) === '#/prompts' &&
    (await page.locator('#roleText').inputValue()) === '改一下但先不保存',
    '地址仍在 ' + (await page.evaluate(() => location.hash)));
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-17-离开页面拦截.png') });

  await page.click('#navPages [data-page="styles"]');
  await page.waitForTimeout(400);
  await page.locator('.admin-modal .btn', { hasText: '放弃改动并离开' }).click();
  await page.waitForTimeout(600);
  check('选「放弃改动并离开」后跳转成功且改动被丢弃',
    (await page.evaluate(() => location.hash)) === '#/styles' &&
    (await page.evaluate(() => window.HP.Admin.getDraft().prompt.role)) === '你是电商媒体编辑，只写口语化短句。',
    '已跳到 #/styles，草稿恢复为已保存内容');

  /* ================= 验收 2：服务端配置缺一段 → 自动补齐 ================= */
  console.log('\n== 验收 2：服务端配置被删掉一段 ==');
  const full = await getConfig();
  const broken = JSON.parse(JSON.stringify(full));
  delete broken.tones;
  delete broken.model;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(broken, null, 2), 'utf8');
  const afterDelete = await (await fetch(APP + '/api/config')).json();
  check('服务端读取时补上了被删掉的区块', afterDelete.filled.indexOf('tones') > -1 && afterDelete.filled.indexOf('model') > -1,
    '补齐区块：' + JSON.stringify(afterDelete.filled));

  /* 注意：地址与当前完全相同时，goto 属于同文档跳转不会重新加载文档，这里必须用 reload */
  await page.reload();
  await page.waitForTimeout(1000);
  const notice = await page.locator('#adminMain .help.info').first().innerText().catch(() => '');
  check('后台页面顶部提示「已自动补齐」', /自动用内置默认值补齐/.test(notice),
    notice.replace(/\s+/g, ' ').slice(0, 60));
  check('被删区块的默认值生效（语调重新出现 4 个）',
    (await page.locator('[data-tone]').count()) === 4,
    '语调数量 ' + (await page.locator('[data-tone]').count()));
  await page.goto(APP + '/admin.html#/model');
  await page.waitForTimeout(900);
  check('模型页也能正常工作（区块不缺）',
    (await page.locator('#mModel').inputValue()).length > 0 && (await page.locator('.sec').count()) === 4,
    '模型名 ' + (await page.locator('#mModel').inputValue()) + '，区块数 ' + (await page.locator('.sec').count()));
  out.numbers['自动补齐区块'] = afterDelete.filled;

  /* ================= 验收 3：导入坏文件 ================= */
  console.log('\n== 验收 3：导入格式错误的文件 ==');
  const bad1 = path.join(TMP, 'bad-syntax.json');
  const bad2 = path.join(TMP, 'bad-structure.json');
  fs.writeFileSync(bad1, '{ 这不是合法的 JSON ', 'utf8');
  fs.writeFileSync(bad2, JSON.stringify({ hello: 'world', foo: 1 }), 'utf8');

  const beforeImport = await cfgHash();
  await page.setInputFiles('#filePicker', bad1);
  await page.waitForTimeout(700);
  const err1 = await page.locator('.admin-modal').innerText().catch(() => '');
  check('JSON 语法错误：给出明确错误说明', /导入失败/.test(err1) && /不是合法的 JSON/.test(err1),
    err1.split('\n').slice(0, 3).join(' ').slice(0, 70));
  check('并说明原配置没有受影响', /原有配置没有受到任何影响/.test(err1),
    (err1.match(/[^\n]*原有配置[^\n]*/) || [''])[0].slice(0, 40));
  await page.locator('.admin-modal .btn').first().click();
  await page.waitForTimeout(300);

  await page.setInputFiles('#filePicker', bad2);
  await page.waitForTimeout(700);
  const err2 = await page.locator('.admin-modal').innerText().catch(() => '');
  check('结构不对：给出可识别的配置项错误', /没有可识别的配置项|没有找到/.test(err2),
    err2.split('\n').slice(0, 3).join(' ').slice(0, 70));
  await page.locator('.admin-modal .btn').first().click();
  await page.waitForTimeout(300);
  check('两次坏文件导入后，服务端配置没有变化', (await cfgHash()) === beforeImport,
    '配置内容与本轮开始时一致');
  out.numbers['坏文件错误'] = '语法错误 / 结构错误 均被拦住';

  /* 导出再导入（好文件） */
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btnExport')]);
  const exported = path.join(TMP, 'exported-config.json');
  await download.saveAs(exported);
  check('导出配置成功生成文件', fs.existsSync(exported) && fs.statSync(exported).size > 100,
    '导出文件 ' + (fs.statSync(exported).size) + ' 字节');
  await page.setInputFiles('#filePicker', exported);
  await page.waitForTimeout(800);
  const importOk = await page.locator('.admin-modal').innerText().catch(() => '');
  check('导出的文件能原样再导回来', /导入成功/.test(importOk),
    importOk.split('\n').slice(0, 3).join(' ').slice(0, 60));
  await page.locator('.admin-modal .btn', { hasText: '稍后保存' }).click();
  await page.waitForTimeout(300);
  check('导回后配置内容与导出前一致', (await cfgHash()) === beforeImport, '配置未发生变化');

  /* ================= 分区块恢复默认 ================= */
  console.log('\n== 分区块恢复默认 ==');
  await page.goto(APP + '/admin.html#/prompts');
  await page.waitForTimeout(900);
  const defaultRole = await page.evaluate(() => window.HP.Config.DEFAULTS.prompt.role);
  await page.fill('#roleText', '随便改一下');
  await page.evaluate(() => { window.HP.Admin.getDraft().styles[0].name = '被改过的风格名'; });
  await page.waitForTimeout(300);
  await page.locator('[data-reset="prompt"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('.admin-modal .btn', { hasText: '恢复该区块默认' }).click();
  await page.waitForTimeout(600);
  const afterReset = await page.evaluate(() => ({
    role: window.HP.Admin.getDraft().prompt.role,
    styleName: window.HP.Admin.getDraft().styles[0].name
  }));
  check('恢复「提示词与模板」区块后，只有该区块回到默认值',
    afterReset.role === defaultRole && afterReset.styleName === '被改过的风格名',
    'role 已还原；风格名仍为「' + afterReset.styleName + '」（未被牵连）');
  check('恢复默认后状态变为未保存', (await page.locator('#barTitle').innerText()).trim() === '有未保存的改动',
    '状态栏「' + (await page.locator('#barTitle').innerText()).trim() + '」');
  await page.click('#btnRevert');
  await page.waitForTimeout(500);
  check('撤销未保存改动后回到已保存状态',
    (await page.locator('#barTitle').innerText()).trim() === '已保存' &&
    (await page.evaluate(() => window.HP.Admin.getDraft().styles[0].name)) === (await getConfig()).styles[0].name,
    '状态栏「已保存」');
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-18-分区块恢复默认.png') });

  /* 底部操作栏的「恢复本页默认」 */
  await page.goto(APP + '/admin.html#/styles');
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    window.HP.Admin.getDraft().styles[0].name = '再改一次';
    window.HP.Admin.getDraft().tones[0].name = '语调也改';
  });
  await page.click('#btnResetPage');
  await page.waitForTimeout(400);
  await page.locator('.admin-modal .btn', { hasText: '恢复默认' }).click();
  await page.waitForTimeout(600);
  const pageReset = await page.evaluate(() => ({
    style: window.HP.Admin.getDraft().styles[0].name,
    tone: window.HP.Admin.getDraft().tones[0].name
  }));
  check('底部「恢复本页默认」把本页两个区块一起还原',
    pageReset.style === '热点借势' && pageReset.tone === '热点借势',
    '风格「' + pageReset.style + '」、语调「' + pageReset.tone + '」');
  /* 若整页默认值与已保存值一致，就没有"未保存改动"可撤销，按钮会处于禁用状态 */
  if (await page.locator('#btnRevert').isEnabled()) {
    await page.click('#btnRevert');
    await page.waitForTimeout(400);
  }

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
  fs.writeFileSync(path.join(ROOT, 'work', 'ui-save-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/ui-save-results.json');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('验收异常：', e); process.exit(2); });
