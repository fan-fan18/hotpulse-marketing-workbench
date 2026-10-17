/* 评测体系 + 自动返工 在工作台里的验收（真实浏览器 + 真实服务端）
   · 生成后每个版本显示机器校验分与校验明细（同一套内核）
   · 自动返工开关打开时：初稿违规 → 自动改好，分数提升并显示轨迹
   · 关掉自动返工：只校验不改；点「一键修正」同样能修好（改不好则保留上一版）
   · 第 5 步合规审核用的是同一份内核（8 项检查 + 机器分）
   · 工作台里的自动返工开关与后台配置共用同一份（改哪边都生效）
   运行：node tests/ui-eval-workbench-tests.js */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const APP_PORT = 8818;
const APP = 'http://127.0.0.1:' + APP_PORT;
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

async function gotoStep4(page) {
  await page.goto(APP + '/index.html');
  await page.waitForTimeout(800);
  await page.locator('.news-item').first().click();
  await page.waitForTimeout(800);
  await page.locator('.product-card [data-pick]').first().click();
  await page.waitForTimeout(250);
  await page.locator('#view-2 .head-actions .btn.primary').click();
  await page.waitForTimeout(350);
  await page.locator('#view-3 .head-actions .btn.primary').click();
  await page.waitForTimeout(450);
}

(async function run() {
  const { chromium } = loadPlaywright();
  const app = spawn('node', [path.join(ROOT, 'server', 'server.js'), String(APP_PORT)], { cwd: ROOT, stdio: 'ignore' });
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

  /* ================= 自动返工：开启 ================= */
  console.log('== 自动返工开启：初稿违规 → 自动改好 ==');
  await gotoStep4(page);
  check('生成参数里有自动返工开关，默认与后台配置一致',
    (await page.locator('#autoRework').isChecked()) === (original.evalConfig.autoRework !== false) &&
    Number(await page.locator('#reworkRounds').inputValue()) === (original.evalConfig.maxReworkRounds == null ? 2 : original.evalConfig.maxReworkRounds),
    '自动返工=' + (await page.locator('#autoRework').isChecked()) + '，最多 ' + (await page.locator('#reworkRounds').inputValue()) + ' 轮');

  await page.fill('#extraPrompt', '全网最低价，仅限今天，错过再等一年');
  await page.waitForTimeout(200);
  await page.locator('#generateBtn').click();
  await page.waitForTimeout(9000);

  /* 只统计"机器校验"徽章：开启模型评审时还会多出"综合"徽章 */
  const allBadges = await page.locator('.score-badge').allInnerTexts();
  const badges = allBadges.filter(t => /机器校验/.test(t));
  check('每个版本都显示机器校验分', badges.length === 4 && badges.every(t => /机器校验\s*[\d.]+\s*分/.test(t)),
    badges.join(' ｜ '));

  const reworkTags = await page.locator('.eval-row .mini-tag').allInnerTexts();
  const reworkTag = reworkTags.filter(t => /自动返工/.test(t));
  check('初稿违规的版本触发了自动返工并显示前后分数', reworkTag.length >= 1,
    reworkTag[0] || '（没有触发自动返工）');
  const texts = await page.locator('.version-body').allInnerTexts();
  check('自动返工后文案里不再有违禁词',
    texts.every(t => t.indexOf('全网最低') < 0),
    '检查 ' + texts.length + ' 个版本，均不含「全网最低」');
  const m = reworkTag[0] && reworkTag[0].match(/([\d.]+)\s*→\s*([\d.]+)/);
  check('返工后分数确实高于初稿', m && Number(m[2]) > Number(m[1]),
    m ? ('初稿 ' + m[1] + ' → 返工后 ' + m[2]) : '（无法解析）');
  out.numbers['自动返工'] = reworkTag[0] || '';
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'workbench-自动返工.png') });

  /* 校验明细 */
  await page.locator('#versionList [data-checks]').first().click();
  await page.waitForTimeout(400);
  const detail = await page.locator('.eval-detail').first().innerText();
  check('校验明细列出 8 项检查与权重',
    /字数区间/.test(detail) && /广告法违禁词/.test(detail) && /编造价格/.test(detail) &&
    /是否提到商品/.test(detail) && /权重/.test(detail),
    detail.replace(/\s+/g, ' ').slice(0, 80));
  check('明细里标出可返工 / 不返工',
    /可返工/.test(detail) && /不返工/.test(detail),
    (detail.match(/[^\n]*不返工[^\n]*/) || [''])[0].slice(0, 40));
  const itemCount = await page.locator('.eval-detail .check-item').count();
  check('明细项数与内核一致（8 项）', itemCount === 8, '共 ' + itemCount + ' 项');
  out.numbers['校验明细'] = itemCount + ' 项';
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'workbench-校验明细.png') });

  /* ================= 自动返工：关闭 + 一键修正 ================= */
  console.log('\n== 自动返工关闭：只校验，手动一键修正 ==');
  await page.uncheck('#autoRework');
  await page.waitForTimeout(900);
  const cfgAfterToggle = await getConfig();
  check('工作台里的开关改动写回了共用配置', cfgAfterToggle.evalConfig.autoRework === false,
    '服务端 evalConfig.autoRework = ' + cfgAfterToggle.evalConfig.autoRework);

  await gotoStep4(page);
  await page.fill('#extraPrompt', '全网最低价，仅限今天');
  await page.waitForTimeout(200);
  await page.locator('#generateBtn').click();
  await page.waitForTimeout(7000);
  const tags2 = await page.locator('.eval-row .mini-tag').allInnerTexts();
  check('关掉后不再自动返工', tags2.filter(t => /自动返工/.test(t)).length === 0,
    '版本上只有校验分与待改进项：' + tags2.filter(t => /待改进|硬伤|全部通过/.test(t)).slice(0, 3).join(' ｜ '));
  const texts2 = await page.locator('.version-body').allInnerTexts();
  check('初稿里的违禁词保留着（说明确实没自动改）', texts2.some(t => t.indexOf('全网最低') > -1),
    '仍有版本含「全网最低」');
  const scoreBefore = (await page.locator('.score-badge').first().innerText()).match(/[\d.]+/)[0];
  const hardTag = await page.locator('.eval-row .mini-tag.hard').count();
  check('硬伤被明确标出', hardTag >= 1, '标出「存在硬伤」的版本 ' + hardTag + ' 个');

  await page.locator('[data-fix]').first().click();
  await page.waitForTimeout(6000);
  const scoreAfter = (await page.locator('.score-badge').first().innerText()).match(/[\d.]+/)[0];
  const texts3 = await page.locator('.version-body').allInnerTexts();
  check('点「一键修正」后分数提升且该版本的违禁词被清掉',
    Number(scoreAfter) > Number(scoreBefore) && texts3[0].indexOf('全网最低') < 0,
    '第 1 个版本机器分 ' + scoreBefore + ' → ' + scoreAfter + '（其余 ' + (texts3.length - 1) + ' 个未点修正、保持原样）');
  check('没点修正的其它版本保持原样（没有被连带修改）',
    texts3.slice(1).some(t => t.indexOf('全网最低') > -1),
    '其余版本仍保留原初稿');
  out.numbers['一键修正'] = scoreBefore + ' → ' + scoreAfter;

  /* ================= 第 5 步：同一套内核 ================= */
  console.log('\n== 第 5 步合规审核用的是同一套内核 ==');
  await page.locator('[data-audit]').first().click();
  await page.waitForTimeout(800);
  const reviewItems = await page.locator('#checkList .check-item').count();
  const checkListText = await page.locator('#checkList').innerText();
  check('审核清单项数与内核一致（8 项）', reviewItems === 8, '共 ' + reviewItems + ' 项');
  check('清单里是内核的检查项名称',
    /字数区间/.test(checkListText) && /话题标签/.test(checkListText) && /编造价格/.test(checkListText) &&
    /排版残留/.test(checkListText) && /是否提到商品/.test(checkListText),
    (await page.locator('#checkList .check-item b').allInnerTexts()).join('、'));
  const riskBadge = await page.locator('#riskBadge').innerText();
  check('风险徽章里带上了机器校验分', /机器校验\s*[\d.]+\s*分/.test(riskBadge), riskBadge.replace(/\s+/g, ' '));
  out.numbers['第5步审核'] = reviewItems + ' 项 · ' + riskBadge.replace(/\s+/g, ' ');
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'workbench-审核用同一内核.png') });

  /* ================= 模型评审：四维分 + 点评 + 综合分 ================= */
  console.log('\n== 模型评审：四维打分 + 点评 + 综合分 ==');
  await page.evaluate(() => { location.hash = '#/'; });
  await page.goto(APP + '/index.html');
  await page.waitForTimeout(700);
  await page.locator('.news-item').first().click();
  await page.waitForTimeout(800);
  await page.locator('.product-card [data-pick]').first().click();
  await page.waitForTimeout(250);
  await page.locator('#view-2 .head-actions .btn.primary').click();
  await page.waitForTimeout(350);
  await page.locator('#view-3 .head-actions .btn.primary').click();
  await page.waitForTimeout(450);
  check('生成参数里有「生成后同时跑模型评审」开关',
    (await page.locator('#autoReview').count()) === 1,
    '开关状态：' + (await page.locator('#autoReview').isChecked()));

  /* 单个版本手动评审 */
  await page.locator('#generateBtn').click();
  await page.waitForTimeout(7000);
  await page.locator('[data-review]').first().click();
  await page.waitForTimeout(3000);
  const reviewText = await page.locator('#versionList').innerText();
  check('点「模型评审」后显示四维分与均分',
    /热点\s*\d｜素材\s*\d｜传播\s*\d｜语气\s*\d/.test(reviewText) && /评审均分\s*[\d.]+\s*\/\s*5/.test(reviewText),
    (reviewText.match(/热点 \d｜素材 \d｜传播 \d｜语气 \d/) || [''])[0] + '　' +
    (reviewText.match(/评审均分 [\d.]+ \/ 5/) || [''])[0]);
  check('显示模型给出的点评', /评审点评/.test(reviewText),
    (reviewText.match(/评审点评[\s\S]{0,40}/) || [''])[0].replace(/\n/g, ' ').slice(0, 50));
  const totalMatch = reviewText.match(/综合\s*([\d.]+)\s*分/);
  const machineMatch = reviewText.match(/机器校验\s*([\d.]+)\s*分/);
  const reviewAvgMatch = reviewText.match(/评审均分\s*([\d.]+)\s*\/\s*5/);
  check('综合分 = 机器分与评审分按权重算出来的',
    totalMatch && machineMatch && reviewAvgMatch &&
    Math.abs(Number(totalMatch[1]) - (Number(machineMatch[1]) + Number(reviewAvgMatch[1]) / 5 * 100) / 2) < 0.6,
    '机器 ' + (machineMatch || [])[1] + ' + 评审均分 ' + (reviewAvgMatch || [])[1] + '/5 → 综合 ' + (totalMatch || [])[1]);
  out.numbers['模型评审'] = (reviewText.match(/热点 \d｜素材 \d｜传播 \d｜语气 \d/) || [''])[0] +
    '，综合 ' + (totalMatch || [])[1] + ' 分';
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'workbench-模型评审.png') });

  /* 生成时自动跑评审 */
  await page.check('#autoReview');
  await page.waitForTimeout(900);
  const cfgReview = await getConfig();
  check('评审开关写回了共用配置', cfgReview.evalConfig.enableReview === true,
    '服务端 evalConfig.enableReview = ' + cfgReview.evalConfig.enableReview);
  await page.locator('#generateBtn').click();
  await page.waitForTimeout(11000);
  const autoReviewed = await page.locator('#versionList').innerText();
  const totalCount = (autoReviewed.match(/综合\s*[\d.]+\s*分/g) || []).length;
  check('开启后每个版本都自动跑了评审', totalCount === 4,
    '出现「综合 N 分」的版本 ' + totalCount + ' 个');
  out.numbers['自动评审'] = totalCount + ' 个版本自动完成评审';

  /* 权重可调：0.8 : 0.2 后综合分随之变化，并写回配置 */
  const beforeWeights = await page.locator('#versionList').innerText();
  const totalBefore = (beforeWeights.match(/综合\s*([\d.]+)\s*分/) || [])[1];
  const machineScore = (beforeWeights.match(/机器校验\s*([\d.]+)\s*分/) || [])[1];
  const reviewScore = (beforeWeights.match(/评审均分\s*([\d.]+)\s*\/\s*5/) || [])[1];
  await page.fill('#wMachine', '0.8');
  await page.evaluate(() => document.querySelector('#wMachine').dispatchEvent(new Event('change', { bubbles: true })));
  await page.waitForTimeout(1200);
  const afterWeights = await page.locator('#versionList').innerText();
  const totalAfter = (afterWeights.match(/综合\s*([\d.]+)\s*分/) || [])[1];
  const expectAfter = Math.round((Number(machineScore) * 0.8 + Number(reviewScore) / 5 * 100 * 0.2) * 10) / 10;
  check('权重可调：改成 0.8 : 0.2 后综合分按新权重重算',
    Math.abs(Number(totalAfter) - expectAfter) < 0.11 && Number(totalAfter) !== Number(totalBefore),
    '机器 ' + machineScore + '×0.8 + 评审 ' + reviewScore + '/5×0.2 → ' + totalAfter + '（原 ' + totalBefore + '）');
  const savedWeights = (await getConfig()).evalConfig.weights;
  check('权重写回了共用配置', Number(savedWeights.machine) === 0.8 && Number(savedWeights.review) === 0.2,
    '服务端 weights = ' + JSON.stringify(savedWeights));
  out.numbers['权重'] = '0.8 : 0.2 → 综合 ' + totalAfter;

  /* ================= 收尾 ================= */
  /* 评审提示词可在后台编辑并保存（页面上有实时预览） */
  console.log('\n== 评审提示词可在页面上编辑并保存 ==');
  await page.goto(APP + '/admin.html#/prompts');
  await page.waitForTimeout(1100);
  const reviewSection = await page.locator('#sec-p-review').innerText();
  check('提示词页有「返工说明与模型评审提示词」区块',
    /返工说明/.test(reviewSection) && /模型评审提示词/.test(reviewSection) && /评审提示词预览/.test(reviewSection),
    reviewSection.split('\n').slice(0, 2).join(' ').slice(0, 50));
  const originalPrompt = await page.locator('#reviewText').inputValue();
  check('评审提示词里带 {{素材}} 与 {{文案}} 占位符',
    originalPrompt.indexOf('{{素材}}') > -1 && originalPrompt.indexOf('{{文案}}') > -1,
    '预览里占位符已被替换：' + (await page.locator('#reviewPreviewPre').innerText()).indexOf('{{') < 0);
  await page.fill('#reviewText', originalPrompt.replace('四个维度各 1–5 分', '四个维度各 1–5 分（本次口径：严格打分）'));
  await page.waitForTimeout(500);
  const previewAfter = await page.locator('#reviewPreviewPre').innerText();
  check('改提示词后页面上的预览立即跟着变', /本次口径：严格打分/.test(previewAfter),
    (previewAfter.match(/[^\n]*本次口径[^\n]*/) || [''])[0].slice(0, 40));
  await page.click('#btnSave');
  await page.waitForTimeout(1000);
  const savedPrompt = (await getConfig()).prompt.reviewPrompt;
  check('保存后评审提示词写进了服务端配置', /本次口径：严格打分/.test(savedPrompt),
    savedPrompt.split('\n')[0].slice(0, 44));
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-29-评审提示词.png') });
  const reworkPreview = await page.locator('#reworkPreviewPre').innerText();
  check('返工说明旁边能看到"发给模型的完整返工提示"',
    /【未通过清单】/.test(reworkPreview) && /【素材/.test(reworkPreview) && /【待修改文案】/.test(reworkPreview),
    reworkPreview.split('\n').slice(0, 3).join(' ').slice(0, 50));
  check('返工提示预览里带上了具体失败原因示例',
    /命中违禁词/.test(reworkPreview) && /编造价格/.test(reworkPreview) && /超出上限/.test(reworkPreview),
    (reworkPreview.match(/\[[^\]]+\]/g) || []).join(' ').slice(0, 60));

  await fetch(APP + '/api/config', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: original })
  });
  const back = await getConfig();
  check('测试收尾：评测配置恢复原样', back.evalConfig.autoRework === original.evalConfig.autoRework,
    'evalConfig.autoRework = ' + back.evalConfig.autoRework);
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
  fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'work', 'ui-eval-workbench-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/ui-eval-workbench-results.json');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('验收异常：', e); process.exit(2); });
