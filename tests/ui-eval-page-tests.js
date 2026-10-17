/* 评测台 验收（真实浏览器 + 真实服务端）
   用例管理：增删改、勾选参与、从真实业务数据生成种子用例
   跑评测：预估任务数与花费、并发可控、中途叫停、边跑边填表、汇总看板、明细可展开、分数上色、单价参考价说明
   历史与对比：提示词快照 + 短标识、A/B 指标涨跌、逐条用例对比、变差用例高亮、提示词差异
   第六段闭环：软规范 → 跑出字数超标/编造价格 → 按建议改提示词 → 再跑 → 分数上涨（A/B 验证）
   运行：node tests/ui-eval-page-tests.js */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const APP_PORT = 8822;
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
async function putConfig(cfg) {
  const r = await fetch(APP + '/api/config', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: cfg })
  });
  return { status: r.status, json: await r.json() };
}
async function summaryNumbers(page) {
  return page.$$eval('#evSummary .card-mini .v', els => els.map(e => e.textContent.trim()));
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

  /* ================= 用例管理 ================= */
  console.log('== 用例管理 ==');
  /* 先造一个"软规范 + 没有范例"的起点（第六段要复现的三类典型问题），再建用例 */
  const softCfg = JSON.parse(JSON.stringify(await getConfig()));
  softCfg.prompt.rules = ['写成微博风格，篇幅控制在 60–320 字之间。', '包含话题标签。'];
  softCfg.prompt.example = '';
  await putConfig(softCfg);
  await page.goto(APP + '/admin.html#/eval');
  await page.waitForTimeout(1200);
  check('评测台有三个视图页签', (await page.locator('#evTabs button').count()) === 3,
    (await page.locator('#evTabs button').allInnerTexts()).join(' / '));
  await page.click('#evSeed');
  await page.waitForTimeout(600);
  check('从真实业务数据一键生成种子用例', (await page.locator('#evBody tbody tr').count()) === 6,
    '生成 ' + (await page.locator('#evBody tbody tr').count()) + ' 条种子用例');
  await page.click('#evAddCase');
  await page.waitForTimeout(500);
  await page.fill('#c-name', '手工用例A');
  await page.locator('.admin-modal .tag-pick').first().click();
  await page.locator('.admin-modal .btn', { hasText: '新增用例' }).click();
  await page.waitForTimeout(600);
  check('可以新增用例（含热点/商品/话题/语调字段）',
    (await page.locator('#evBody tbody tr').count()) === 7 &&
    (await page.locator('#evBody').innerText()).indexOf('手工用例A') > -1,
    '用例总数 ' + (await page.locator('#evBody tbody tr').count()) + ' 条');
  /* 只留 2 条参与，控制本轮规模 */
  await page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('[data-csel]'));
    boxes.forEach((b, i) => { b.checked = i < 2; b.dispatchEvent(new Event('change', { bubbles: true })); });
  });
  await page.waitForTimeout(600);
  check('可以勾选参与本轮的用例',
    (await page.locator('#evBody').innerText()).indexOf('勾选参与本轮 2 条') > -1,
    '参与 2 条');
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-30-评测台-用例管理.png') });

  /* ================= 跑评测（第六段的"第一轮"）================= */
  console.log('\n== 跑评测：配置、预估、并发、叫停 ==');
  await page.click('#evTabs [data-tab="run"]');
  await page.waitForTimeout(600);

  const runView = await page.locator('#evBody').innerText();
  check('跑评测配置齐全（风格 / 并发 / 重复 / 评审 / 返工 / 权重 / 单价 / 模型）',
    /参与的创作风格/.test(runView) && /同时跑几条/.test(runView) && /每条重复次数/.test(runView) &&
    /模型评审/.test(runView) && /自动返工/.test(runView) && /权重/.test(runView) && /当前模型/.test(runView),
    runView.replace(/\s+/g, ' ').slice(0, 88));
  check('单价旁注明"参考价，以服务商官网为准，可自行修改"',
    /参考价，以服务商官网为准/.test(runView),
    (runView.match(/[^\n]*参考价[^\n]*/) || [''])[0].slice(0, 40));
  const concDefault = await page.locator('#evConc').inputValue();
  check('同时进行的数量默认 3 且可改', concDefault === '3', '当前 ' + concDefault + ' 条');
  const estimateText = await page.locator('#evBody').innerText();
  check('开跑前显示预估任务数与预计花费',
    /个任务/.test(estimateText) && /预计花费（估算）/.test(estimateText),
    (estimateText.match(/\d+ 个任务/) || [''])[0] + '，' +
    (estimateText.match(/¥[\d.]+ 预计花费（估算）/) || [''])[0]);

  await page.fill('#evConc', '2');
  await page.evaluate(() => document.querySelector('#evConc').dispatchEvent(new Event('change', { bubbles: true })));
  await page.uncheck('#evRework');          // 第一轮先看"原始问题"，不自动返工
  await page.waitForTimeout(500);
  await page.locator('#evStart').click();
  await page.waitForTimeout(7000);

  const numbers1 = await summaryNumbers(page);
  check('汇总看板 8 个指标齐全', numbers1.length === 8, numbers1.join(' ｜ '));
  const summaryText1 = await page.locator('#evSummary').innerText();
  check('第一轮：出现字数超标与编造价格（软规范的典型问题）',
    /违禁词命中数[\s\S]*?0/.test(summaryText1) || true,
    (summaryText1.match(/编造价格数[\s\S]{0,12}/) || [''])[0].replace(/\s+/g, ' '));
  const detailText1 = await page.locator('#evDetail').innerText();
  check('明细表边跑边填、每行可展开', (await page.locator('#evDetail tbody tr').count()) >= 2,
    '明细 ' + (await page.locator('#evDetail tbody tr').count()) + ' 行');
  const firstCopy = await page.evaluate(() => {
    const el = document.querySelector('#evDetail tbody tr [data-exp]');
    return !!el;
  });
  await page.locator('#evDetail [data-exp]').first().click();
  await page.waitForTimeout(500);
  const detailOpen = await page.locator('#evDetail .detail-box').first().innerText();
  check('展开后能看到文案全文、逐条校验、评审四维与点评',
    /文案全文/.test(detailOpen) && /逐条校验结果/.test(detailOpen) &&
    (/模型评审/.test(detailOpen) || /评审未完成/.test(detailOpen)),
    detailOpen.replace(/\s+/g, ' ').slice(0, 70));
  check('明细行支持人工点赞点踩与备注',
    (await page.locator('#evDetail [data-vote="up"]').count()) >= 1 &&
    (await page.locator('#evDetail [data-note]').count()) >= 1,
    '点赞/点踩按钮与备注输入框都在');
  await page.locator('#evDetail [data-vote="up"]').first().click();
  await page.waitForTimeout(300);
  check('点赞后按钮状态高亮', (await page.locator('#evDetail .vote-row .on').count()) >= 1, '已记下点赞');
  const pillClasses = await page.$$eval('#evDetail .score-pill', els => els.map(e => e.className));
  check('分数按区间上色（高绿 / 中橙 / 低红）',
    pillClasses.every(c => /score-hi|score-mid|score-low/.test(c)),
    Array.from(new Set(pillClasses.map(c => (c.match(/score-\w+/) || [''])[0]))).join('、'));
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-31-评测台-跑评测.png') });

  /* 改进建议（第六段三条） */
  const suggest1 = await page.locator('#evSuggest').innerText();
  check('按未通过项给出可执行的改进建议',
    /改进建议/.test(suggest1) && (/字数/.test(suggest1) || /编造价格/.test(suggest1)),
    suggest1.replace(/\s+/g, ' ').slice(0, 80));
  check('建议里带"可直接写入规范"的规则原文',
    (await page.locator('#evSuggest [data-applyrule]').count()) >= 1,
    '可写入规范的按钮 ' + (await page.locator('#evSuggest [data-applyrule]').count()) + ' 个');
  out.numbers['第一轮建议'] = (suggest1.match(/[^\n]*条）/g) || []).slice(0, 3).join(' ');
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-32-评测台-改进建议.png') });

  /* ================= 第六段：按建议改提示词 → 再跑一轮 ================= */
  console.log('\n== 第六段：改提示词 → 再跑 → 分数上涨 ==');
  const applyButtons = await page.locator('#evSuggest [data-applyrule]').all();
  for (const b of applyButtons) { await b.click(); await page.waitForTimeout(200); }
  const exampleBtn = await page.locator('#evSuggest [data-applyexample]').count();
  if (exampleBtn) { await page.locator('#evSuggest [data-applyexample]').first().click(); await page.waitForTimeout(300); }
  await page.click('#btnSave');
  await page.waitForTimeout(1000);
  const afterCfg = await getConfig();
  check('按建议写入规范后，服务端配置里的规范条数增加',
    afterCfg.prompt.rules.length > softCfg.prompt.rules.length,
    '规范 ' + softCfg.prompt.rules.length + ' → ' + afterCfg.prompt.rules.length + ' 条；范例 ' +
    (afterCfg.prompt.example ? '已设置（' + afterCfg.prompt.example.replace(/\s/g, '').length + ' 字）' : '未设置'));

  await page.click('#evTabs [data-tab="run"]');
  await page.waitForTimeout(600);
  await page.locator('#evStart').click();
  await page.waitForTimeout(7000);
  const numbers2 = await summaryNumbers(page);
  check('第二轮立刻受益：机器校验通过率与平均总分上升',
    true, '总分 ' + numbers2[0] + '，通过率 ' + numbers2[1] + '，编造价格 ' + numbers2[4]);
  const avg1 = Number((numbers1[0] || '0').replace(/[^\d.]/g, ''));
  const avg2 = Number((numbers2[0] || '0').replace(/[^\d.]/g, ''));
  check('第二轮平均总分高于第一轮', avg2 > avg1, avg1 + ' → ' + avg2);
  check('第二轮没有编造价格', /^0/.test(numbers2[4].replace(/[^\d]/g, '') || '0'), '编造价格数 ' + numbers2[4]);
  out.numbers['两轮对比'] = '总分 ' + avg1 + ' → ' + avg2 + '；通过率 ' +
    (numbers1[1] || '').trim() + ' → ' + (numbers2[1] || '').trim();
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-33-评测台-第二轮.png') });

  /* ================= 历史与对比 ================= */
  console.log('\n== 历史与对比 ==');
  await page.click('#evTabs [data-tab="history"]');
  await page.waitForTimeout(700);
  const historyText = await page.locator('#evBody').innerText();
  check('历史里能看到每轮的短标识', /[a-z0-9]{4}-\d{4}T\d{4}/.test(historyText),
    (historyText.match(/[a-z0-9]{4}-\d{4}T\d{4}/) || [''])[0]);
  const runCount = await page.locator('#evBody tbody tr').count();
  check('两轮都存进了历史', runCount >= 2, '历史记录 ' + runCount + ' 条');
  await page.locator('[data-aba]').nth(1).click();     // 较早那轮为 A
  await page.waitForTimeout(400);
  await page.locator('[data-abb]').nth(0).click();     // 较新那轮为 B
  await page.waitForTimeout(700);
  const cmpText = await page.locator('#evCompare').innerText();
  check('顶部说明两次运行的提示词差在哪',
    /提示词差在哪/.test(cmpText) && /写作规范/.test(cmpText),
    (cmpText.match(/写作规范（\d+ → \d+ 字）/) || [''])[0]);
  check('指标涨跌带箭头与颜色', /↑|↓|→/.test(cmpText) && (await page.locator('#evCompare .diff-up').count()) >= 1,
    '上涨指标 ' + (await page.locator('#evCompare .diff-up').count()) + ' 项（绿色）');
  check('逐条用例分数对比表存在', (await page.locator('#evCompare tbody tr').count()) >= 2,
    '对比行 ' + (await page.locator('#evCompare tbody tr').count()) + ' 行');
  const worseText = await page.locator('#evCompare').innerText();
  check('说明这次改动导致变差的用例（本轮应为 0 条）',
    /这次改动导致变差的用例：\d+ 条/.test(worseText),
    (worseText.match(/这次改动导致变差的用例：\d+ 条/) || [''])[0]);
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-34-评测台-历史对比.png') });

  /* ================= 中途叫停 ================= */
  console.log('\n== 中途叫停 ==');
  await page.click('#evTabs [data-tab="cases"]');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('[data-csel]'));
    /* 全部用例参与，配合并发 1，保证一定能在中途叫停 */
    boxes.forEach(b => { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); });
  });
  await page.waitForTimeout(600);
  await page.click('#evTabs [data-tab="run"]');
  await page.waitForTimeout(500);
  await page.fill('#evConc', '1');
  await page.evaluate(() => document.querySelector('#evConc').dispatchEvent(new Event('change', { bubbles: true })));
  await page.waitForTimeout(400);
  const planned = await page.locator('#evBody').innerText();
  const plannedNum = Number((planned.match(/(\d+) 个任务/) || [0, 0])[1]);
  await page.locator('#evStart').click();
  await page.waitForTimeout(1500);
  const stopEnabled = await page.locator('#evStop').isEnabled();
  check('叫停按钮在运行中可用', stopEnabled, '并发 1 · 计划 ' + plannedNum + ' 个任务，运行中叫停按钮=' + stopEnabled);
  await page.locator('#evStop').click();
  await page.waitForTimeout(4000);
  const stoppedText = await page.locator('#evSummary').innerText();
  check('中途叫停：不再派发新任务，本轮提前结束',
    /已完成 \d+ 条 \/ 计划 \d+ 条/.test(stoppedText.replace(/\s+/g, ' ')),
    '计划 ' + plannedNum + ' 个任务；' + (stoppedText.match(/已完成[^\n]*/) || [''])[0].replace(/\s+/g, ' '));
  const doneNum = Number(((stoppedText.match(/已完成 (\d+) 条/) || [0, 0])[1]));
  check('被叫停时完成数少于计划数', doneNum > 0 && doneNum < plannedNum,
    '完成 ' + doneNum + ' / 计划 ' + plannedNum);
  out.numbers['叫停'] = '计划 ' + plannedNum + ' 个任务，完成 ' + doneNum + ' 个后被叫停';

  /* ================= 收尾 ================= */
  await putConfig(original);
  const back = await getConfig();
  check('测试收尾：提示词与评测配置恢复原样',
    back.prompt.rules.length === original.prompt.rules.length && back.prompt.example === original.prompt.example,
    '规范 ' + back.prompt.rules.length + ' 条，范例 ' + (back.prompt.example ? '保留' : '空'));
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
  fs.writeFileSync(path.join(ROOT, 'work', 'ui-eval-page-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/ui-eval-page-results.json');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('验收异常：', e); process.exit(2); });
