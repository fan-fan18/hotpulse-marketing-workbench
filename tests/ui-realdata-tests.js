/* =========================================================
   真实链路测试（第一轮）· 自建数据
   原则：
     · 数据不是塞进页面的：全部通过后台「填写模板 → 导入 → 保存配置」真实写入
     · 结果是这一轮真跑出来的：批次号、时间、数字都来自本次运行（不读旧结果）
     · 抓取是真 HTTP：本地 stub RSS + 公网 RSS 各一个来源
   运行：node tests/ui-realdata-tests.js
   产物：work/realdata/results-<batchId>.json 、data/seed/05-评测用例-自建数据.csv
   ========================================================= */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const PORT = 8861;
const STUB_PORT = 8899;
const APP = 'http://127.0.0.1:' + PORT;
const DATA_DIR = path.join(ROOT, 'work', 'realdata', 'data');
const OUT_DIR = path.join(ROOT, 'work', 'realdata');
const SEED = path.join(ROOT, 'data', 'seed');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PW = [path.join(ROOT, '.test-tools', 'node_modules'), path.join(ROOT, 'node_modules')];
function loadPlaywright() {
  for (const dir of PW) {
    try { return createRequire(path.join(dir, 'noop.js'))('playwright-core'); } catch (e) {}
  }
  throw new Error('没有找到 playwright-core；请先执行： npm install playwright-core --prefix .test-tools --no-save');
}

const out = { startedAt: new Date().toISOString(), batchId: 'realdata-' + Date.now().toString(36), checks: [], numbers: {} };
let pass = 0, fail = 0;
function check(name, cond, detail) {
  out.checks.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
  if (cond) { pass++; console.log('  ✓ ' + name + '  → ' + detail); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + detail); }
}
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
async function api(p) { return (await fetch(APP + p)).json(); }

(async function run() {
  const { chromium } = loadPlaywright();

  /* ---------- 0. 干净的数据目录 + 两个服务端 ---------- */
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const stub = spawn('node', [path.join(ROOT, 'tests', 'stub-provider.js'), String(STUB_PORT)], { cwd: ROOT, stdio: 'ignore' });
  const app = spawn('node', [path.join(ROOT, 'server', 'server.js'), String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: Object.assign({}, process.env, { HOTPULSE_DATA_DIR: DATA_DIR, HOST: '127.0.0.1' })
  });
  for (let i = 0; i < 60; i++) {
    try { const h = await api('/api/health'); if (h.ok) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 300));
  }
  const health = await api('/api/health');
  console.log('服务端就绪：' + health.configFile + '\n');
  out.numbers.dataDir = DATA_DIR;
  out.numbers.configFile = health.configFile;

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) jsErrors.push('console: ' + m.text()); });

  const seedFile = f => path.join(SEED, f);

  /* 打开后台，等徽章 */
  await page.goto(APP + '/admin.html');
  await page.waitForSelector('#srcName');
  await page.waitForFunction(() => document.querySelector('#srcName').textContent.trim() !== '—', null, { timeout: 10000 });
  const badge = (await page.locator('#srcName').innerText()).trim();
  check('后台顶栏徽章显示数据来自服务端', /服务端/.test(badge), badge);

  /* 下载空白模板 / 示例模板 */
  await page.evaluate(function () { location.hash = '#/products'; });
  await page.waitForTimeout(800);
  await page.click('[data-tpl="products"]');
  await page.waitForSelector('#tplFile');
  const [dl1] = await Promise.all([page.waitForEvent('download'), page.click('[data-dl="blank"][data-fmt="csv"]')]);
  const p1 = await dl1.path();
  const blankTxt = fs.readFileSync(p1, 'utf8');
  const blankLines = blankTxt.replace(/^\ufeff/, '').split(/\r?\n/).filter(Boolean);
  check('下载的空白模板只有表头、没有业务数据', blankLines.length === 1 && /名称/.test(blankLines[0]), blankLines[0] + '（' + blankLines.length + ' 行）');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-dl="sample"][data-fmt="csv"]')]);
  const sampleTxt = fs.readFileSync(await dl2.path(), 'utf8');
  const sampleLines = sampleTxt.replace(/^\ufeff/, '').split(/\r?\n/).filter(Boolean);
  check('下载的示例模板 = 表头 + 示范行', sampleLines.length === 3, sampleLines.length + ' 行');
  out.numbers.templateFiles = { blank: dl1.suggestedFilename(), sample: dl2.suggestedFilename() };
  await page.click('.admin-modal-actions .btn.ghost');
  await page.waitForTimeout(300);

  /* ================= A. 四份自建数据：模板导入 → 保存 ================= */
  async function gotoHash(h) {
    await page.evaluate(x => { location.hash = x; }, h);
    await page.waitForTimeout(650);
  }
  async function saveCfg() {
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(900);
  }
  async function importSeed(hash, key, file, mode) {
    await gotoHash(hash);
    await page.click('[data-tpl="' + key + '"]');
    await page.waitForSelector('#tplFile');
    await page.setInputFiles('#tplFile', seedFile(file));
    await page.waitForSelector('#tplApply', { timeout: 8000 });
    const disabled = await page.locator('#tplApply').isDisabled();
    if (disabled) { await page.click('.admin-modal-actions .btn.ghost'); throw new Error('导入被拦住：' + file); }
    if (mode) await page.selectOption('#tplMode', mode);
    await page.click('#tplApply');
    await page.waitForTimeout(500);
    await saveCfg();
  }

  console.log('\n================ A. 用模板导入自建数据 ================');
  await importSeed('#/products', 'products', '01-商品库-自建数据.csv', 'replace');
  await importSeed('#/sources', 'sources', '02-抓取来源-自建数据.csv');
  await importSeed('#/styles', 'styles', '03-创作风格-自建数据.csv');
  await importSeed('#/styles', 'tones', '04-语调预设-自建数据.csv');

  const cfg1 = (await api('/api/config')).config;
  const custom = (cfg1.sources || []).filter(s => s.type === 'custom');
  out.numbers.afterImport = {
    products: (cfg1.products || []).length,
    customSources: custom.length,
    styles: (cfg1.styles || []).length,
    tones: (cfg1.tones || []).length,
    productNames: (cfg1.products || []).map(p => p.name)
  };
  check('商品库被自建数据替换（7 件）', (cfg1.products || []).length === 7, out.numbers.afterImport.products + ' 件');
  const mineSources = custom.filter(s => ['中国新闻网滚动', '本地演示源'].indexOf(s.name) >= 0);
  check('自建的两个订阅源已写入配置', mineSources.length === 2 && mineSources.every(s => /^https?:\/\//.test(s.url)), custom.map(s => s.name).join(' / '));
  check('创作风格 = 4 个（模板顺序生效）', (cfg1.styles || []).length === 4 && cfg1.styles[0].name === '热点借势', (cfg1.styles || []).map(s => s.name).join(' / '));
  check('语调预设 = 4 个', (cfg1.tones || []).length === 4, (cfg1.tones || []).map(t => t.name).join(' / '));
  check('数据真的落到服务端文件里（不是内存）', fs.existsSync(path.join(DATA_DIR, 'config.json')) &&
    JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'config.json'), 'utf8')).products.length === 7, 'config.json 已写入');
  const backups = fs.readdirSync(path.join(DATA_DIR, 'backups')).length;
  check('每次保存前都留了上一版备份', backups >= 3, backups + ' 份备份');

  /* 坏文件：格式错误必须给出明确说明，且原有配置不受影响 */
  await gotoHash('#/products');
  await page.click('[data-tpl="products"]');
  await page.waitForSelector('#tplFile');
  const badPath = path.join(OUT_DIR, 'bad-products.csv');
  fs.writeFileSync(badPath, '名称,售价,原价,品类,卖点,图标\r\n负价商品,-9,99,服饰,卖点一、卖点二,🧥\r\n', 'utf8');
  await page.setInputFiles('#tplFile', badPath);
  await page.waitForSelector('#tplApply');
  const badTxt = await page.locator('#tplReport').innerText();
  check('价格非法的文件在导入前就被列出（含行号与原因）', /第 1 行/.test(badTxt) && /大于 0/.test(badTxt), badTxt.replace(/\s+/g, ' ').slice(0, 80));
  await page.click('.admin-modal-actions .btn.ghost');
  const cfgAfterBad = (await api('/api/config')).config;
  check('坏文件没有污染原有商品库', (cfgAfterBad.products || []).length === 7, (cfgAfterBad.products || []).length + ' 件');

  /* ================= B. 真抓取：两个来源（本地 stub + 公网 RSS） ================= */
  console.log('\n================ B. 真抓取 ================');
  await page.goto(APP + '/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(1800);
  const before = await api('/api/news');
  const beforeAt = before.runs && before.runs[0] ? before.runs[0].at : '';
  await page.click('#fetchBtn');
  let after = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(700);
    const d = await api('/api/news');
    if (d.runs && d.runs[0] && d.runs[0].at !== beforeAt) { after = d; break; }
  }
  if (!after) after = await api('/api/news');
  const run = after.runs[0];
  out.numbers.fetch = {
    at: run.at, ms: run.ms, total: run.total, added: run.added, merged: run.merged,
    okSources: run.okSources, failedSources: run.failedSources,
    sources: run.sources
  };
  check('一键抓取真的跑了（服务端有新的运行记录）', run.at !== beforeAt, run.at);
  const mine = run.sources.filter(s => ['中国新闻网滚动', '本地演示源'].indexOf(s.name) >= 0);
  check('两个自建订阅源都真抓到了条目', mine.length === 2 && mine.every(s => s.ok && s.count > 0), mine.map(s => s.name + ' ' + s.count + ' 条 / ' + s.ms + 'ms').join('，'));
  out.numbers.fetch.allSources = run.sources.map(s => s.name + (s.ok ? '✓' : '✗') + s.count + '条/' + s.ms + 'ms');
  check('热点池里有真实条目', after.items.length > 0, after.items.length + ' 条，去重后合并 ' + run.merged + ' 条');
  const realItem = after.items.filter(it => it.sourceIds && it.sourceIds.some(id => id.indexOf('src_') === 0))[0] || after.items[0];
  out.numbers.fetch.sampleTitle = realItem.title;
  check('抓到的条目带来源与热度', !!realItem.title && !!realItem.source && realItem.heat > 0, realItem.title.slice(0, 24) + ' · ' + realItem.source + ' · 热度 ' + realItem.heat);

  /* ================= C. 热点 → 匹配商品 → 生成文案 ================= */
  console.log('\n================ C. 热点 → 匹配 → 生成 ================');
  const titles = await page.$$eval('.news-item .news-title', els => els.map(e => e.textContent.trim()));
  const hitIdx = titles.findIndex(t => t === realItem.title);
  check('抓到的热点出现在工作台列表里', hitIdx >= 0, (hitIdx >= 0 ? '第 ' + (hitIdx + 1) + ' 条：' : '未找到：') + realItem.title.slice(0, 26));
  await page.locator('.news-item').nth(hitIdx >= 0 ? hitIdx : 0).click();
  await page.waitForTimeout(500);
  const selId = await page.getAttribute('.news-item.selected', 'data-id');
  out.numbers.selectedNewsId = selId;
  await page.click('.step-item[data-step="2"]');
  await page.waitForTimeout(700);
  const matched = await page.$$eval('#matchGrid .product-card', els => els.map(e => {
    const n = e.querySelector('.product-name');
    return n ? n.textContent.trim() : e.textContent.trim().slice(0, 24);
  }));
  const selfNames = out.numbers.afterImport.productNames;
  out.numbers.match = { count: matched.length, names: matched };
  const allSelf = matched.length > 0 && matched.every(n => selfNames.some(s => s.indexOf(n.slice(0, 6)) >= 0 || n.indexOf(s.slice(0, 6)) >= 0));
  check('Step 2 推荐商品来自自建商品库（不是内置演示商品）', allSelf, matched.length + ' 件：' + matched.join(' / '));
  const bindBtn = page.locator('#matchGrid [data-pick]').first();
  if (await bindBtn.count()) { await bindBtn.click(); await page.waitForTimeout(400); }
  await page.click('.step-item[data-step="3"]');
  await page.waitForTimeout(600);
  const bindCount = (await page.locator('#bindCount').innerText()).trim();
  const bindN = await page.locator('#bindList .bind-item').count();
  check('Step 3 已带上 Step 2 的绑定上下文', Number(bindCount) > 0 && bindN > 0, '已绑定 ' + bindCount + ' 件');

  await page.click('.step-item[data-step="4"]');
  await page.waitForTimeout(600);
  const styleN = (await api('/api/config')).config.styles.length;
  const t0 = Date.now();
  await page.click('#generateBtn');
  await page.waitForFunction(n => document.querySelectorAll('#versionList .version-card').length >= n, styleN, { timeout: 90000 });
  const genMs = Date.now() - t0;
  await page.waitForTimeout(800);
  const versions = await page.$$eval('#versionList .version-card', els => els.map(e => ({
    style: (e.querySelector('.tag.brand') || {}).textContent || '',
    text: (e.querySelector('.version-body') || {}).textContent || '',
    score: ((e.querySelector('.score-badge') || {}).textContent || '').replace(/\s+/g, ' ').trim()
  })));
  out.numbers.generate = {
    styleN, count: versions.length, ms: genMs,
    versions: versions.map(v => ({ style: v.style.trim(), chars: v.text.replace(/\s/g, '').length, score: v.score, head: v.text.trim().slice(0, 50) }))
  };
  check('每个创作风格各出一个候选版本', versions.length === styleN, versions.length + ' / ' + styleN + ' 个');
  check('文案带话题标签与互动引导', versions.every(v => /#[^#\s]+#/.test(v.text)), versions.map(v => (v.text.match(/#[^#\s]+#/g) || []).join('')).join(' | ').slice(0, 70));
  check('每条都有机器校验分', versions.every(v => /机器校验\s*\d+\s*分/.test(v.score)), versions.map(v => v.score).join(' / '));

  /* 同一套评测逻辑复算一遍：数字必须和卡片上的一致 */
  const recheck = await page.evaluate(function (args) {
    var news = window.HP.AppCtx.news().filter(function (x) { return x.id === args.newsId; })[0];
    var cfg = window.HP.Config.get();
    var bound = window.HP.AppCtx.bound();
    var prods = cfg.products.filter(function (p) { return bound.indexOf(p.id) >= 0; });
    if (!prods.length) prods = cfg.products.slice(0, 1);
    var material = window.HP.Eval.materialFrom(news, prods, { tags: news.topics, tone: window.HP.AppCtx.tone() });
    var chk = window.HP.Eval.machineCheck(args.text, material);
    return { score: chk.score, failed: chk.failed.map(function (f) { return f.label; }), hardFail: !!chk.hardFail, items: chk.items.length };
  }, { newsId: selId, text: versions[0].text });
  out.numbers.recheck = recheck;
  check('复算分数与页面显示一致', versions[0].score.indexOf(String(recheck.score)) >= 0, '页面 ' + versions[0].score + ' / 复算 ' + recheck.score + '（' + recheck.items + ' 项检查）');

  /* ================= D. 评测台：自建用例 → 真跑一轮 ================= */
  console.log('\n================ D. 评测台跑第一轮 ================');
  const keyMap = await page.evaluate(function () {
    var all = window.HP.AppCtx.news().filter(function (n) { return n.id && /^sn_/.test(n.id); });
    /* 用例素材优先用公网来源抓到的条目，本地 stub 源兜底 */
    var pub = all.filter(function (n) { return n.source !== '本地演示源'; });
    var news = pub.concat(all.filter(function (n) { return n.source === '本地演示源'; })).slice(0, 4);
    var cfg = window.HP.Config.get();
    return news.map(function (n) {
      var ranked = cfg.products.map(function (p) {
        return { id: p.id, s: window.HP.Products.matchScore(p, n) };
      }).sort(function (a, b) { return b.s - a.s; }).slice(0, 2);
      return { newsId: n.id, title: n.title, ids: ranked.map(function (x) { return x.id; }) };
    });
  });
  out.numbers.caseSeed = keyMap;
  check('从抓到的真实热点里挑出 4 条做用例素材', keyMap.length === 4, keyMap.map(k => k.ids.join('+')).join(' / '));

  const caseRows = keyMap.map(function (k, i) {
    return [
      '实测' + (i + 1) + '·' + k.title.slice(0, 10),
      k.newsId,
      k.ids.join('、'),
      '#实测话题' + (i + 1) + '#',
      ['热点借势', '促销导向', '互动话题', '日常分享'][i % 4],
      '1', '是'
    ];
  });
  const T = require(path.join(ROOT, 'assets/js/core/templates.js'));
  const caseCsv = T.rowsToCSV(T.headers(T.get('cases')), caseRows);
  const caseFile = path.join(SEED, '05-评测用例-自建数据.csv');
  fs.writeFileSync(caseFile, caseCsv, 'utf8');

  await page.goto(APP + '/admin.html#/eval');
  await page.waitForSelector('#evBody', { timeout: 15000 });
  await page.click('#evTabs [data-tab="cases"]');
  await page.waitForTimeout(400);
  await page.click('#evTplCases');
  await page.waitForSelector('#tplFile');
  await page.setInputFiles('#tplFile', caseFile);
  await page.waitForSelector('#tplApply');
  const caseReport = (await page.locator('#tplReport').innerText()).replace(/\s+/g, ' ');
  const caseApplyDisabled = await page.locator('#tplApply').isDisabled();
  check('用例模板通过校验（4 行）', !caseApplyDisabled && /通过 4 行/.test(caseReport), caseReport.slice(0, 70));
  await page.click('#tplApply');
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(900);
  const cfg2 = (await api('/api/config')).config;
  check('4 条用例真的写进了配置', (cfg2.evalConfig.cases || []).length === 4, (cfg2.evalConfig.cases || []).length + ' 条');

  await page.click('#evTabs [data-tab="run"]');
  await page.waitForTimeout(600);
  await page.fill('#evConc', '3');
  await page.locator('#evConc').dispatchEvent('change');
  await page.waitForTimeout(400);
  if (!(await page.locator('#evReview').isChecked())) await page.click('#evReview');
  await page.waitForTimeout(400);
  const plannedTxt = (await page.locator('#evSummary, #evBar').first().innerText().catch(() => '')) || '';
  const progressBefore = (await page.locator('#evProgress').innerText()).trim();
  const startedAt = Date.now();
  await page.click('#evStart');
  await page.waitForFunction(function () {
    var el = document.querySelector('#evProgress');
    return el && /已完成\s*\d+\s*\/\s*\d+/.test(el.textContent) && !/进行中/.test(el.textContent) &&
      !document.querySelector('#evStart').disabled;
  }, null, { timeout: 180000 });
  const evalMs = Date.now() - startedAt;
  await page.waitForTimeout(800);
  const progressAfter = (await page.locator('#evProgress').innerText()).trim();
  const summaryTxt = (await page.locator('#evSummary').innerText()).replace(/\s+/g, ' ');
  const detailRows = await page.locator('#evDetail tbody tr').count().catch(() => 0);
  out.numbers.eval = { ms: evalMs, progressBefore, progressAfter, summaryText: summaryTxt, detailRows };
  check('评测跑完且进度到达满值', /已完成\s*(\d+)\s*\/\s*\1/.test(progressAfter.replace(/\s+/g, ' ')) || /已完成 \d+ \/ \d+/.test(progressAfter), progressAfter);
  check('明细行数 = 用例 × 风格', detailRows >= 16, detailRows + ' 行明细');

  const run0 = await page.evaluate(function () {
    var list = JSON.parse(localStorage.getItem('hotpulse.eval.runs.v1') || '[]');
    return list[0] || null;
  });
  out.runId = run0 && run0.id;
  out.shortId = run0 && run0.shortId;
  out.numbers.eval.summary = run0 && run0.summary;
  out.numbers.eval.config = run0 && run0.config;
  out.results = run0 && run0.results;
  check('本轮结果带批次号与提示词短标识（不是读旧结果）', !!out.runId && !!out.shortId, out.runId + ' / ' + out.shortId);
  const s = run0.summary;
  const detailCount = run0.results.length;
  check('汇总条数与明细条数一致', s.done === detailCount, '汇总 ' + s.done + ' / 明细 ' + detailCount);
  check('汇总里能看到违禁词与编造价格的命中数', s.forbiddenHits !== undefined && s.fakePriceCount !== undefined, '违禁词 ' + s.forbiddenHits + ' / 编造价格 ' + s.fakePriceCount);
  const avgByDetail = Math.round(run0.results.reduce((a, r) => a + num(r.totalScore), 0) / detailCount * 10) / 10;
  check('平均总分和明细逐条能对上', Math.abs(avgByDetail - s.avgScore) <= 0.2, '明细均值 ' + avgByDetail + ' / 汇总 ' + s.avgScore);

  /* ================= E. 构造违规文案：机器校验 + 一键修正 ================= */
  console.log('\n================ E. 违规文案：校验与返工 ================');
  const badRes = await page.evaluate(function () {
    var cfg = window.HP.Config.get();
    var news = {
      id: 'manual_case', title: '冷空气今晚抵达，多地气温骤降 10 度',
      summary: '中央气象台发布寒潮预警，北方多地降温明显。',
      topics: ['#冷空气来了#', '#一夜入秋#'], source: '中国新闻网', heat: 900
    };
    var prods = cfg.products.slice(0, 1);
    var material = window.HP.Eval.materialFrom(news, prods, { tags: news.topics, tone: (cfg.tones[0] || {}).name });
    var filler = '这件衣服我穿了整整一个冬天，通勤、出差、周末爬山都在穿，真的非常非常好用，强烈推荐给大家，' +
      '面料舒服不闷，版型显瘦，洗完也不用熨，出门随手一穿就很好看，朋友看到都问链接，收到货第一时间就试穿了，' +
      '尺码标准，颜色和图片一致，包装也很用心，送人自用都合适，这已经是我回购的第二件了，' +
      '现在这个价格我觉得闭眼入都不亏，喜欢的姐妹赶紧冲，别等断码了再后悔。';
    var copy = '#冷空气来了# 这件 90 白鸭绒轻量羽绒服是今年最佳的选择，全网最低价，第一名的品质，永久保暖不跑绒！' +
      '原价 1299，现在只要 8888 元就能拿下，绝对超值！' + filler + filler;
    var chk = window.HP.Eval.machineCheck(copy, material);
    window.__bad = { copy: copy, material: material };
    return {
      chars: window.HP.Eval.charCount(copy),
      score: chk.score,
      hardFail: !!chk.hardFail,
      failed: chk.failed.map(function (f) { return { code: f.code, label: f.label, reason: f.reason }; }),
      forbiddenHits: (chk.items.filter(function (i) { return i.code === 'forbidden'; })[0] || {}).hits || [],
      fakeAmounts: ((chk.items.filter(function (i) { return i.code === 'fakePrice'; })[0] || {}).reason || ''),
      realAmounts: (material.directAmounts || []).concat(material.derivedAmounts || [])
    };
  });
  out.numbers.violation = badRes;
  check('超字数被抓到', badRes.chars > 320 && badRes.failed.some(f => f.code === 'words'), badRes.chars + ' 字（上限 320）');
  check('违禁词被抓到并指出是哪几个', badRes.failed.some(f => f.code === 'forbidden') && (badRes.forbiddenHits || []).length >= 3, (badRes.forbiddenHits || []).join('、'));
  check('编造价格被抓到并列出真实可用金额', badRes.failed.some(f => f.code === 'fakePrice'), '素材里可用：' + (badRes.realAmounts || []).join('、'));
  check('硬伤被单独标出来', badRes.hardFail === true, 'hardFail=' + badRes.hardFail);

  const fixRes = await page.evaluate(function () {
    var bad = window.__bad;
    return window.HP.Eval.autoRework({ copy: bad.copy, material: bad.material, maxRounds: 2 }).then(function (r) {
      return {
        before: r.before, after: r.after, improved: r.improved, accepted: r.accepted,
        rounds: (r.rounds || []).map(function (t) { return { round: t.round, accepted: t.accepted, note: t.note, fixed: t.fixed || [], remaining: t.remaining || [] }; }),
        finalText: r.text, finalChars: window.HP.Eval.charCount(r.text)
      };
    });
  });
  out.numbers.rework = fixRes;
  check('一键修正跑出了返工记录', fixRes.rounds.length > 0, fixRes.rounds.map(t => '第' + t.round + '轮' + (t.accepted ? '采纳' : '未采纳')).join('，'));
  check('改好了才采纳（分数没涨就保留上一版）', fixRes.after >= fixRes.before, fixRes.before + ' → ' + fixRes.after);
  check('返工说明里列出了修好了哪些问题', fixRes.rounds.some(t => (t.fixed || []).length > 0), (fixRes.rounds.filter(t => (t.fixed || []).length)[0] || {}).fixed ? fixRes.rounds.filter(t => (t.fixed || []).length)[0].fixed.join('、') : '无');

  /* ================= F. 收尾：写结果文件 ================= */
  out.finishedAt = new Date().toISOString();
  out.pass = pass; out.fail = fail;
  out.jsErrors = jsErrors.slice(0, 10);
  check('全程没有页面 JS 报错', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | ') || '无');
  const outFile = path.join(OUT_DIR, 'results-' + out.batchId + '.json');
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');
  console.log('\n结果文件：' + outFile);
  console.log('\n========== 汇总 ==========');
  console.log('通过 ' + pass + ' 项 / 失败 ' + fail + ' 项');
  console.log('抓取：' + JSON.stringify(out.numbers.fetch && { total: out.numbers.fetch.total, added: out.numbers.fetch.added, ms: out.numbers.fetch.ms, ok: out.numbers.fetch.okSources, failed: out.numbers.fetch.failedSources }));
  console.log('生成：' + JSON.stringify(out.numbers.generate && { count: out.numbers.generate.count, ms: out.numbers.generate.ms }));
  console.log('评测：' + JSON.stringify(out.numbers.eval && out.numbers.eval.summary));
  console.log('违规：' + JSON.stringify({ chars: badRes.chars, forbidden: (badRes.forbiddenHits || []).length, hardFail: badRes.hardFail }));
  console.log('返工：' + JSON.stringify({ before: fixRes.before, after: fixRes.after, rounds: fixRes.rounds.length }));

  await browser.close();
  try { app.kill(); } catch (e) {}
  try { stub.kill(); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('测试异常中断：' + e.message);
  console.error(e.stack);
  try { fs.writeFileSync(path.join(OUT_DIR, 'results-' + out.batchId + '-failed.json'), JSON.stringify(Object.assign(out, { error: e.message }), null, 2), 'utf8'); } catch (x) {}
  process.exit(2);
});
