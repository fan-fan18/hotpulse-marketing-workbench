/* 提示词与模板页 UI 验收（真实浏览器）
   验收 1：改一句写作规范并保存 → 回工作台生成文案，新规范立即生效
   验收 2：点击占位符清单条目，插入到光标当前位置
   验收 3：故意写一个不存在的占位符，预览里原样显示（不变空白）
   运行：node tests/ui-prompt-tests.js */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const PORT = 8793;
const BASE = 'http://127.0.0.1:' + PORT;
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

async function runWorkbench(page, waitMs) {
  await page.goto(BASE + '/index.html');
  await page.waitForTimeout(600);
  await page.locator('.news-item').first().click();          // 选热点 → 自动进 Step 2
  await page.waitForTimeout(700);
  await page.locator('.product-card [data-pick]').first().click();
  await page.waitForTimeout(250);
  await page.locator('#view-2 .head-actions .btn.primary').click();
  await page.waitForTimeout(350);
  await page.locator('#view-3 .head-actions .btn.primary').click();
  await page.waitForTimeout(400);
  const styleCount = await page.locator('#styleGrid .style-card.active').count();
  await page.locator('#generateBtn').click();
  await page.waitForTimeout(waitMs || 2600);
  const texts = await page.locator('.version-body').allInnerTexts();
  const banner = (await page.locator('#genState').innerText().catch(() => '')).replace(/\n/g, ' ').trim();
  return { texts, styleCount, banner };
}

(async function run() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 } });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());   // 测试里跨页跳转按确认离开处理
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  /* ---------------- 验收 2：占位符插入到光标位置 ---------------- */
  console.log('== 验收 2：点占位符插入到光标当前位置 ==');
  await page.goto(FILE_ADMIN);
  await page.waitForTimeout(900);

  const before = await page.locator('#materialTpl').inputValue();
  await page.evaluate(() => {
    const ta = document.getElementById('materialTpl');
    ta.focus();
    ta.setSelectionRange(6, 6);            // 把光标放到第 6 个字后面
  });
  await page.locator('[data-ph="热点标题"]').first().click();
  await page.waitForTimeout(200);
  const after = await page.locator('#materialTpl').inputValue();
  const insertedAt = after.indexOf('{{热点标题}}');
  check('占位符插入到了光标位置（第 6 个字符处）', insertedAt === 6,
    '插入位置 = ' + insertedAt + '，插入结果：…' + after.slice(0, 24).replace(/\n/g, '⏎') + '…');
  check('插入后原内容没有被破坏', after.replace('{{热点标题}}', '') === before,
    '长度 ' + before.length + ' → ' + after.length + '（增加 ' + (after.length - before.length) + ' 字符）');
  out.numbers['插入位置'] = insertedAt;

  await page.evaluate(() => {
    const ta = document.getElementById('materialTpl');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  });
  await page.locator('[data-ph="语调"]').first().click();
  await page.waitForTimeout(150);
  const after2 = await page.locator('#materialTpl').inputValue();
  check('连续插入会接着光标往后排', after2.indexOf('{{语调}}') > insertedAt,
    '第二个占位符位置 = ' + after2.indexOf('{{语调}}'));

  const listBtn = page.locator('[data-phlist]').first();
  await listBtn.click();
  await page.waitForTimeout(300);
  const listRows = await page.locator('.admin-modal [data-insert]').count();
  check('「完整清单」弹窗列出了所有占位符及说明', listRows >= 30,
    '清单条目 ' + listRows + ' 条（含说明文字）');
  /* 弹窗里的「插入」按钮也要能用：点一条，占位符应落到光标位置 */
  await page.evaluate(() => {
    const ta = document.getElementById('materialTpl');
    ta.focus();
    ta.setSelectionRange(0, 0);
  });
  await page.locator('.admin-modal [data-insert="话题标签"]').click();
  await page.waitForTimeout(400);
  check('从清单弹窗点「插入」也能插到光标位置',
    (await page.locator('#materialTpl').inputValue()).indexOf('{{话题标签}}') === 0,
    '文本开头：' + (await page.locator('#materialTpl').inputValue()).slice(0, 22));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  /* ---------------- 验收 3：未知占位符原样显示 ---------------- */
  console.log('\n== 验收 3：写一个不存在的占位符，预览里原样显示 ==');
  await page.locator('#materialTpl').fill('【热点】{{热点标题}}\n\n{{这个占位符不存在}}\n\n{{商品清单}}');
  await page.waitForTimeout(400);
  const previewText = await page.locator('#promptPreviewBlocks .preview-block').nth(1).locator('pre').innerText();
  check('预览里原样显示未知占位符（没有变成空白）', previewText.indexOf('{{这个占位符不存在}}') > -1,
    '预览片段：' + previewText.split('\n').filter(l => l.indexOf('这个占位符') > -1)[0]);
  const tip = await page.locator('.unknown-tip').innerText().catch(() => '');
  check('页面顶部给出「不认识的占位符」提示', /不认识的占位符/.test(tip) && /这个占位符不存在/.test(tip),
    tip.replace(/\n/g, ' ').slice(0, 60));
  const marked = await page.locator('#promptPreviewBlocks .ph-bad').count();
  check('未知占位符在预览里被标红标出', marked >= 1, '标红元素 ' + marked + ' 个');
  out.numbers['未知占位符预览'] = '原样保留并标红';

  /* 恢复默认模板，避免影响后面的验收 */
  await page.locator('#materialTpl').fill('【热点素材】\n标题：{{热点标题}}\n摘要：{{热点摘要}}\n来源：{{来源}}\n可用话题：{{话题标签}}\n\n【商品素材】\n{{商品清单}}\n\n【本次要求】\n主打语调：{{语调}}\n创作风格：{{创作风格}}\n风格要求：{{风格要求}}\n字数要求：{{字数下限}}–{{字数上限}} 字\n表情强度：{{表情强度}}\n可用金额：{{可用金额}}');
  await page.waitForTimeout(300);

  /* ---------------- file:// 下跨页共享情况（信息项） ---------------- */
  const fileShared = await page.evaluate(() => {
    try {
      localStorage.setItem('hotpulse.__probe__', 'from-admin');
      return localStorage.getItem('hotpulse.__config_probe__') || 'written';
    } catch (e) { return 'blocked'; }
  });
  out.numbers['file:// localStorage'] = fileShared;

  /* ---------------- 验收 1：改规范 → 保存 → 工作台生效 ---------------- */
  console.log('\n== 验收 1：改一句写作规范并保存，回工作台生成立即生效 ==');
  const srv = spawn('node', [path.join(ROOT, 'server', 'server.js'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1000));

  /* 先跑一次基线（未加新规范） */
  const baseline = await runWorkbench(page);
  const baseEndsWithQuestion = baseline.texts.map(t => /[？?]\s*$/.test(t.trim()));
  check('基线：未加新规范时，生成结果不是以提问结尾', baseEndsWithQuestion.every(v => v === false),
    '版本数 ' + baseline.texts.length + '，结尾片段：' + JSON.stringify(baseline.texts[0].trim().slice(-12)));
  out.numbers['基线版本数'] = baseline.texts.length;
  out.numbers['基线结尾'] = baseline.texts[0].trim().slice(-12);

  /* 到后台加一条规范并保存 */
  await page.goto(BASE + '/admin.html#/prompts');
  await page.waitForTimeout(900);
  const badge = (await page.locator('#srcName').innerText()).trim();
  check('后台数据来源为「服务端」（配置能被两页共用）', badge === '服务端', '徽章：' + badge);

  await page.locator('#addRule').click();
  await page.waitForTimeout(300);
  const ruleCount = await page.locator('[data-rule]').count();
  await page.locator('[data-rule]').nth(ruleCount - 1).fill('结尾必须以提问结尾，让读者愿意在评论区回答。');
  await page.waitForTimeout(400);
  const sysPreview = await page.locator('#promptPreviewBlocks .preview-block').first().locator('pre').innerText();
  check('新增规范立即出现在实时预览的规范块里', sysPreview.indexOf('结尾必须以提问结尾') > -1,
    '规范块结尾：…' + sysPreview.trim().slice(-24));
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-3-提示词与模板.png') });

  await page.click('#btnSave');
  await page.waitForTimeout(900);
  const toast = (await page.locator('#toastWrap').innerText().catch(() => '')).replace(/\n/g, ' ').trim();
  check('保存成功并提示写回了哪里', /已保存到/.test(toast), toast.slice(0, 60));

  /* 回工作台生成，验证新规范真的生效 */
  const afterRule = await runWorkbench(page);
  const endsWithQuestion = afterRule.texts.map(t => /[？?]\s*$/.test(t.trim()));
  check('改动后：工作台生成的每个版本都以提问结尾', endsWithQuestion.every(v => v === true),
    '版本数 ' + afterRule.texts.length + '，各版本结尾：' + JSON.stringify(afterRule.texts.map(t => t.trim().slice(-10))));
  check('候选版本数 = 选中的创作风格数', afterRule.texts.length === afterRule.styleCount,
    '风格 ' + afterRule.styleCount + ' 个 → 版本 ' + afterRule.texts.length + ' 个');
  out.numbers['改规范后版本数'] = afterRule.texts.length;
  out.numbers['改规范后结尾'] = afterRule.texts.map(t => t.trim().slice(-8));
  out.numbers['生成结果条'] = afterRule.banner;
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'workbench-新规范生效.png') });

  /* 再加一条「不要使用 emoji」，验证另一类规范也立即生效 */
  await page.goto(BASE + '/admin.html#/prompts');
  await page.waitForTimeout(800);
  await page.locator('#addRule').click();
  await page.waitForTimeout(300);
  const rc2 = await page.locator('[data-rule]').count();
  await page.locator('[data-rule]').nth(rc2 - 1).fill('不要使用 emoji 表情符号。');
  await page.waitForTimeout(300);
  await page.click('#btnSave');
  await page.waitForTimeout(900);
  const noEmoji = await runWorkbench(page);
  const emojiTotal = noEmoji.texts.reduce((s, t) => s + (t.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length, 0);
  check('再加「不要使用 emoji」后，工作台输出里没有任何表情符号', emojiTotal === 0,
    '表情符号总数 ' + emojiTotal);
  out.numbers['禁用表情后表情数'] = emojiTotal;

  /* 清理：把刚才加的两条规范删掉，避免影响交付状态 */
  await page.goto(BASE + '/admin.html#/prompts');
  await page.waitForTimeout(700);
  for (let i = 0; i < 2; i++) {
    const n = await page.locator('[data-rdel]').count();
    await page.locator('[data-rdel]').nth(n - 1).click();
    await page.waitForTimeout(250);
  }
  await page.click('#btnSave');
  await page.waitForTimeout(700);
  const finalRules = await page.locator('[data-rule]').count();
  check('清理回默认规范条数', finalRules === 3, '规范当前 ' + finalRules + ' 条');

  check('全流程没有前端脚本报错', errs.length === 0, errs.length ? errs.slice(0, 2).join(' | ') : '无报错');

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
  fs.writeFileSync(path.join(ROOT, 'work', 'ui-prompt-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/ui-prompt-results.json');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('UI 验收异常：', e); process.exit(2); });
