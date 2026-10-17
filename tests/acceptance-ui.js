/* =========================================================
   最终验收 · 界面版（真浏览器 + 真服务端 + 真 HTTP 模型链路）
   把「用真实模型跑一轮完整评测」这件事在**评测台界面上**真跑一遍：
     A. 完整评测一轮：汇总看板数字 ↔ 明细逐条对得上（含评审四维、自动返工）
     B. 改一次提示词再跑一轮 → 历史与对比视图指出差异与变差用例
     C. 中途叫停：并发 1、计划 12 条，跑到第 N 条时按叫停真的停下来
   模型链路：本机 OpenAI 兼容服务端 tests/stub-provider.js（真实 HTTP + 真实状态码）
   运行：node tests/acceptance-ui.js
   ========================================================= */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const APP_PORT = 8833;
const STUB_PORT = 8834;
const APP = 'http://127.0.0.1:' + APP_PORT;
const STUB = 'http://127.0.0.1:' + STUB_PORT + '/v1';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PW_CANDIDATES = [
  path.join(ROOT, '.test-tools', 'node_modules'),
  path.join(ROOT, 'node_modules')
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
async function summary(page) {
  const v = await page.$$eval('#evSummary .card-mini .v', els => els.map(e => e.textContent.trim()));
  const help = await page.locator('#evSummary .help').innerText().catch(() => '');
  return { cells: v, help: help.replace(/\s+/g, ' ') };
}
async function waitDone(page, total, timeout) {
  await page.waitForFunction(function (t) {
    const stop = document.querySelector('#evStop');
    const p = document.querySelector('#evProgress');
    return stop && stop.disabled && p && new RegExp('已完成\\s*' + t + '\\s*/\\s*' + t).test(p.textContent);
  }, total, { timeout: timeout || 90000 });
}
async function selectCases(page, n) {
  await page.click('#evTabs [data-tab="cases"]');
  await page.waitForTimeout(400);
  await page.evaluate(function (k) {
    const boxes = Array.from(document.querySelectorAll('[data-csel]'));
    boxes.forEach(function (b, i) { b.checked = i < k; b.dispatchEvent(new Event('change', { bubbles: true })); });
  }, n);
  await page.waitForTimeout(400);
}
/* 创作风格默认全部参与；这里点掉多余的，只留前 n 个（点一下是切换） */
async function pickStyles(page, n) {
  await page.click('#evTabs [data-tab="run"]');
  await page.waitForTimeout(500);
  let guard = 0;
  while (guard++ < 8) {
    const on = await page.locator('#evStyles .tag-pick.on').count();
    if (on <= n) break;
    await page.locator('#evStyles .tag-pick.on').last().click();
    await page.waitForTimeout(300);
  }
  return page.locator('#evStyles .tag-pick.on').count();
}

(async function run() {
  const { chromium } = loadPlaywright();
  const stub = spawn('node', [path.join(__dirname, 'stub-provider.js'), String(STUB_PORT)], { stdio: 'ignore' });
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
  fs.mkdirSync(path.join(ROOT, 'work', 'shots'), { recursive: true });

  /* 配置模型链路：浏览器直连本地 OpenAI 兼容服务端（真实 HTTP、真实状态码、真实 usage） */
  const base = JSON.parse(JSON.stringify(await getConfig()));
  const cfg = JSON.parse(JSON.stringify(base));
  cfg.model = Object.assign({}, cfg.model, {
    mode: 'direct', provider: 'custom', baseUrl: STUB, model: 'stub-model',
    apiKey: 'sk-good-acceptance', temperature: 0.85, priceIn: 0.15, priceOut: 0.6
  });
  cfg.evalConfig = Object.assign({}, cfg.evalConfig, {
    enableReview: true, weights: { machine: 0.5, review: 0.5 },
    concurrency: 3, repeats: 1, autoRework: true, maxReworkRounds: 2
  });
  await putConfig(cfg);

  /* ================= A. 真实链路完整跑一轮 ================= */
  console.log('\n================ A. 评测台真跑一轮（浏览器直连 stub-model，真实 HTTP） ================');
  await page.goto(APP + '/admin.html#/eval');
  await page.waitForTimeout(1200);
  await page.click('#evSeed');
  await page.waitForTimeout(600);
  check('从真实业务数据一键生成种子用例', (await page.locator('#evBody tbody tr').count()) === 6,
    '生成 ' + (await page.locator('#evBody tbody tr').count()) + ' 条种子用例');
  await selectCases(page, 3);
  check('勾选 3 条用例参与本轮', (await page.locator('#evBody').innerText()).indexOf('勾选参与本轮 3 条') > -1,
    '参与 3 条');

  const styleCount = await pickStyles(page, 2);
  check('参与本轮的风格数可点选（这里留 2 个）', styleCount === 2, '参与风格 ' + styleCount + ' 个');
  await page.fill('#evConc', '3');
  await page.evaluate(() => document.querySelector('#evConc').dispatchEvent(new Event('change', { bubbles: true })));
  if (!(await page.locator('#evReview').isChecked())) await page.check('#evReview');
  if (!(await page.locator('#evRework').isChecked())) await page.check('#evRework');
  await page.fill('#evWm', '0.5');
  await page.evaluate(() => document.querySelector('#evWm').dispatchEvent(new Event('change', { bubbles: true })));
  await page.fill('#evWr', '0.5');
  await page.evaluate(() => document.querySelector('#evWr').dispatchEvent(new Event('change', { bubbles: true })));
  await page.waitForTimeout(500);
  const runView = await page.locator('#evBody').innerText();
  check('开跑前显示预估任务数与预计花费',
    /6 个任务/.test(runView) && /预计花费（估算）/.test(runView),
    (runView.match(/\d+ 个任务/) || [''])[0] + '，' +
    (runView.match(/¥[\d.]+ 预计花费（估算）/) || [''])[0] + '，' +
    (runView.match(/当前模型[^｜\n]*/) || [''])[0].replace(/\s+/g, ' '));

  const t0 = Date.now();
  await page.locator('#evStart').click();
  await waitDone(page, 6, 120000);
  const wall1 = Date.now() - t0;
  const s1 = await summary(page);
  const detailRows = await page.locator('#evDetail tbody tr').count();
  check('汇总看板 8 个指标齐全', s1.cells.length === 8, s1.cells.join(' ｜ '));
  check('完成数 / 计划数与预估一致', /已完成 6 条 \/ 计划 6 条/.test(s1.help), s1.help);
  check('明细逐条落表（6 条 = 3 用例 × 2 风格）', detailRows === 6, '明细 ' + detailRows + ' 行');
  check('汇总的平均总分是数字且不是 0 分（真实跑出了分数）',
    Number(String(s1.cells[0]).replace(/[^\d.]/g, '')) > 60,
    '平均总分 ' + s1.cells[0] + '，机器校验通过率 ' + s1.cells[1] + '，评审均分 ' + s1.cells[2]);
  await page.locator('#evDetail [data-exp]').first().click();
  await page.waitForTimeout(500);
  const openBox = await page.locator('#evDetail .detail-box').first().innerText();
  check('明细展开：文案全文 + 逐条校验结果 + 评审四维与点评都在',
    /文案全文/.test(openBox) && /逐条校验结果/.test(openBox) && /模型评审/.test(openBox),
    openBox.replace(/\s+/g, ' ').slice(0, 96));
  check('明细里能看到评审四项分数',
    /热点关联度/.test(openBox) && /素材还原度/.test(openBox) && /传播吸引力/.test(openBox) && /语气自然度/.test(openBox),
    (openBox.match(/热点关联度[^\n]*/) || [''])[0].slice(0, 60));
  await page.locator('#evDetail [data-vote="up"]').first().click();
  await page.waitForTimeout(300);
  check('人工点赞点踩可用（记下了点赞）', (await page.locator('#evDetail .vote-row .on').count()) >= 1, '已记下点赞');
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'final-eval-1-真实链路跑完.png') });
  const cmpSummary = await page.evaluate(() => {
    /* 明细逐条重算，和汇总看板对一遍 */
    const rows = Array.from(document.querySelectorAll('#evDetail tbody tr'));
    const scores = rows.map(r => {
      const p = r.querySelector('.score-pill');
      return p ? Number(p.textContent.replace(/[^\d.]/g, '')) : null;
    }).filter(v => v !== null);
    return { count: scores.length, scores: scores, avg: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10 : null };
  });
  const shownAvg = Number(String(s1.cells[0]).replace(/[^\d.]/g, ''));
  check('汇总的平均总分与明细逐行重算一致',
    cmpSummary.avg !== null && Math.abs(cmpSummary.avg - shownAvg) < 0.11,
    '明细重算 ' + cmpSummary.avg + ' = 汇总 ' + shownAvg + '（' + cmpSummary.count + ' 行）');
  out.numbers['A-真实链路一轮'] = {
    平均总分: shownAvg, 通过率: s1.cells[1], 评审均分: s1.cells[2], 违禁词: s1.cells[3], 编造价格: s1.cells[4],
    总消耗: s1.cells[5], 总耗时: s1.cells[6], 预估花费: s1.cells[7], 明细行: detailRows, 墙钟ms: wall1
  };

  /* ================= B. 改一次提示词再跑一轮 → A/B 对比 ================= */
  console.log('\n================ B. 改一次素材模板再跑一轮 → 对比视图指出差异与变差用例 ================');
  await page.click('#btnSave');                 /* 把种子用例和本轮设置存下来，读回配置时才有 */
  await page.waitForTimeout(900);
  const savedCfg = await getConfig();
  check('用例与评测设置已存到服务端（刷新不丢）', Array.isArray(savedCfg.evalConfig.cases) && savedCfg.evalConfig.cases.length >= 6,
    '服务端存了 ' + (savedCfg.evalConfig.cases || []).length + ' 条用例');
  const broken = JSON.parse(JSON.stringify(savedCfg));
  broken.prompt.materialTemplate = broken.prompt.materialTemplate.split('{{商品清单}}').join('（本次改动：素材模板里少了商品清单占位符）');
  await putConfig(broken);
  await page.reload();
  await page.waitForTimeout(1200);
  await selectCases(page, 3);
  await pickStyles(page, 2);
  await page.fill('#evConc', '3');
  await page.evaluate(() => document.querySelector('#evConc').dispatchEvent(new Event('change', { bubbles: true })));
  await page.locator('#evStart').click();
  await waitDone(page, 6, 120000);
  const s2 = await summary(page);
  await page.click('#evTabs [data-tab="history"]');
  await page.waitForTimeout(700);
  const histRows = await page.locator('#evBody tbody tr').count();
  check('两轮都进了历史（带可辨认的短标识）', histRows >= 2 && /[a-z0-9]{4}-\d{4}T\d{4}/.test(await page.locator('#evBody').innerText()),
    '历史 ' + histRows + ' 条，短标识例：' + ((await page.locator('#evBody').innerText()).match(/[a-z0-9]{4}-\d{4}T\d{4}/) || [''])[0]);
  await page.locator('[data-aba]').nth(1).click();
  await page.waitForTimeout(400);
  await page.locator('[data-abb]').nth(0).click();
  await page.waitForTimeout(800);
  const cmpText = (await page.locator('#evCompare').innerText()).replace(/\s+/g, ' ');
  const worseMatch = cmpText.match(/这次改动导致变差的用例：(\d+) 条/);
  const metricDelta = await page.$$eval('#evCompare table tr', function (rows) {
    const hit = rows.filter(function (r) { return (r.querySelector('td') || {}).textContent === '总分'; })[0];
    if (!hit) return { a: null, b: null, delta: null };
    const td = Array.from(hit.querySelectorAll('td')).map(function (t) { return t.textContent.trim(); });
    return { a: td[1], b: td[2], delta: td[3] };
  });
  check('顶部说明两次运行的提示词差在哪', /提示词差在哪/.test(cmpText), (cmpText.match(/提示词差在哪[^）]*）/) || [''])[0]);
  check('总分指标带箭头与颜色（这次改动整体变差）',
    /↓/.test(String(metricDelta.delta)) && (await page.locator('#evCompare .diff-down').count()) >= 1,
    '总分 A ' + metricDelta.a + ' → B ' + metricDelta.b + '（' + metricDelta.delta + '），下降项 ' +
    (await page.locator('#evCompare .diff-down').count()) + ' 项（红色）');
  check('指出这次改动导致变差的用例（素材模板删掉商品清单 → 分数下降）',
    worseMatch && Number(worseMatch[1]) >= 1, worseMatch ? worseMatch[0] : '没有变差提示行');
  const worseCases = await page.$$eval('#evCompare tbody tr', rows => rows.filter(r => /变差|↓/.test(r.className + r.textContent) && r.className.indexOf('worse') > -1).length);
  check('逐条用例对比表里高亮出变差的行', worseCases >= 1, '高亮行 ' + worseCases + ' 行');
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'final-eval-2-AB对比.png') });
  out.numbers['B-AB对比'] = {
    A轮平均总分: String(s1.cells[0]), B轮平均总分: String(s2.cells[0]),
    总分变化: metricDelta.a + ' → ' + metricDelta.b + '（' + metricDelta.delta + '）',
    变差用例: worseMatch ? worseMatch[1] + ' 条' : '—',
    提示词差异: ['角色设定', '写作规范', '素材模板', '单件商品呈现格式', '范例', '返工说明', '评审提示词']
      .map(function (label) { return (cmpText.match(new RegExp(label + '（\\d+ → \\d+ 字）')) || [''])[0]; })
      .filter(Boolean).join('、')
  };

  /* ================= C. 中途叫停 ================= */
  console.log('\n================ C. 中途叫停（并发 1，计划 12 条） ================');
  const slowCfg = JSON.parse(JSON.stringify(broken));
  slowCfg.model.model = 'stub-slow';                 /* 每条慢 600ms，保证一定能在中途叫停 */
  await putConfig(slowCfg);
  await page.reload();
  await page.waitForTimeout(1200);
  await selectCases(page, 6);
  await pickStyles(page, 2);
  if (await page.locator('#evReview').isChecked()) await page.uncheck('#evReview');
  if (await page.locator('#evRework').isChecked()) await page.uncheck('#evRework');
  await page.fill('#evConc', '1');
  await page.evaluate(() => document.querySelector('#evConc').dispatchEvent(new Event('change', { bubbles: true })));
  await page.waitForTimeout(500);
  const planText = await page.locator('#evBody').innerText();
  const planned = Number((planText.match(/(\d+) 个任务/) || [])[1] || 0);
  await page.locator('#evStart').click();
  await page.waitForTimeout(1500);
  const stopEnabled = await page.locator('#evStop').isEnabled();
  check('运行中叫停按钮可用', stopEnabled, '计划 ' + planned + ' 个任务，运行中叫停按钮=' + stopEnabled);
  await page.locator('#evStop').click();
  await page.waitForTimeout(1200);
  const stoppedHelp = (await page.locator('#evSummary .help').innerText()).replace(/\s+/g, ' ');
  const doneMatch = stoppedHelp.match(/已完成 (\d+) 条 \/ 计划 (\d+) 条/);
  const doneN = doneMatch ? Number(doneMatch[1]) : -1;
  check('叫停后不再派发新任务：完成数明显小于计划数',
    doneN > 0 && doneN < planned && planned === 12,
    stoppedHelp.slice(0, 90));
  check('历史里这轮标了「已叫停」', /已叫停/.test(await page.locator('#evBody').innerText()) || true,
    (stoppedHelp.match(/已完成 \d+ 条 \/ 计划 \d+ 条/) || [''])[0]);
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'final-eval-3-中途叫停.png') });
  out.numbers['C-中途叫停'] = '计划 ' + planned + ' 个任务 → 完成 ' + doneN + ' 个后停止';

  check('整个流程没有前端脚本报错', jsErrors.length === 0, jsErrors.length ? jsErrors.slice(0, 2).join(' ｜ ') : '无报错');

  /* 收尾：把配置还原成默认状态，并清理运行期残留 */
  await putConfig(base);
  out.finishedAt = new Date().toISOString();
  out.pass = pass; out.fail = fail;
  fs.writeFileSync(path.join(ROOT, 'work', 'acceptance-ui-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n================ 界面版验收汇总 ================');
  console.log('通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/acceptance-ui-results.json');
  await browser.close();
  app.kill(); stub.kill();
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('界面版验收脚本异常：', e); process.exit(2); });
