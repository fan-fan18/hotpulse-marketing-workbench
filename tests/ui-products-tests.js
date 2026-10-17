/* 商品库（只读）验收（真实浏览器）
   验收 1：表格 / 卡片视图切换正常，卡片视图与工作台商品卡视觉一致（同一段渲染代码）
   验收 2：搜索卖点里的词能搜到；按品类筛选、按价格或品类排序都生效
   验收 3：统计数字与列表实际内容对得上（含筛选后）
   另测：商品数据按三级来源读取，顶栏徽章显示当前级别
   运行：node tests/ui-products-tests.js */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const APP_PORT = 8810;
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
const FILE_ADMIN = 'file:///' + ROOT.replace(/\\/g, '/') + '/admin.html#/products';

const out = { startedAt: new Date().toISOString(), checks: [], numbers: {} };
let pass = 0, fail = 0;
function check(name, cond, detail) {
  out.checks.push({ name, ok: !!cond, detail: detail === undefined ? '' : detail });
  if (cond) { pass++; console.log('  ✓ ' + name + '  → ' + detail); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + detail); }
}
async function getConfig() { return (await (await fetch(APP + '/api/config')).json()).config; }

/* 从页面表格里反算统计，用于和展示的统计数字比对 */
async function readTableStats(page) {
  return page.$$eval('#prList tbody tr', rows => {
    const prices = [], offs = [], cats = new Set();
    rows.forEach(tr => {
      /* 用语义类名取单元格，避免以后加列导致取错 */
      cats.add(tr.querySelector('.td-cat').textContent.trim());
      prices.push(Number(tr.querySelector('.td-price').textContent.replace(/[^\d.]/g, '')));
      offs.push(Number(tr.querySelector('.td-off').textContent.replace(/[^\d.]/g, '')));
    });
    return {
      total: rows.length,
      cats: cats.size,
      minPrice: prices.length ? Math.min(...prices) : 0,
      maxPrice: prices.length ? Math.max(...prices) : 0,
      avgDiscount: offs.length ? Math.round(offs.reduce((a, b) => a + b, 0) / offs.length * 10) / 10 : 0
    };
  });
}
async function readStatCards(page) {
  return page.$$eval('#prStats .card-mini', cards => cards.map(c => ({
    k: c.querySelector('.k').textContent.trim(),
    v: c.querySelector('.v').textContent.trim()
  })));
}

(async function run() {
  const { chromium } = loadPlaywright();
  const app = spawn('node', [path.join(ROOT, 'server', 'server.js'), String(APP_PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 } });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) jsErrors.push(m.text());
  });

  const cfg = await getConfig();
  const products = cfg.products;

  /* ================= 验收 3：统计与列表对得上 ================= */
  console.log('== 验收 3：统计数字与列表实际内容对得上 ==');
  await page.goto(APP + '/admin.html#/products');
  await page.waitForTimeout(1100);
  check('顶栏徽章显示数据来源为「服务端」',
    (await page.locator('#srcName').innerText()).trim() === '服务端',
    '徽章：' + (await page.locator('#srcName').innerText()).trim());

  const statsCards = await readStatCards(page);
  const domStats = await readTableStats(page);
  const totalText = statsCards[0].v;
  const catsText = statsCards[1].v;
  const rangeText = statsCards[2].v;
  const discText = statsCards[3].v;
  check('4 个统计指标齐全', statsCards.length === 4,
    statsCards.map(c => c.k + '=' + c.v).join(' ｜ '));
  check('商品总数与列表行数一致',
    Number(totalText.replace(/\D/g, '')) === domStats.total && domStats.total === products.length,
    '统计「' + totalText + '」= 表格行数 ' + domStats.total + ' = 商品库 ' + products.length + ' 件');
  check('品类数与列表实际品类数一致',
    Number(catsText.replace(/\D/g, '')) === domStats.cats,
    '统计「' + catsText + '」= 表格里出现的品类数 ' + domStats.cats);
  check('价格区间与列表实际价格一致',
    rangeText.indexOf('¥' + domStats.minPrice) > -1 && rangeText.indexOf(String(domStats.maxPrice)) > -1,
    '统计「' + rangeText + '」= 实际 ¥' + domStats.minPrice + '–' + domStats.maxPrice);
  check('平均折扣率与列表实际折扣一致',
    Math.abs(Number(discText.replace(/[^\d.]/g, '')) - domStats.avgDiscount) < 0.11,
    '统计「' + discText + '」= 明细重算 ' + domStats.avgDiscount + '%');
  out.numbers['全库统计'] = statsCards.map(c => c.k + ' ' + c.v).join(' / ');
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-19-商品库表格视图.png') });

  /* ================= 验收 2：搜索 / 筛选 / 排序 ================= */
  console.log('\n== 验收 2：搜索、筛选与排序 ==');
  const POINT_WORD = '烧水保温';   // 只出现在某件商品的「卖点」里，不在名称里
  const nameHasWord = products.filter(p => p.name.indexOf(POINT_WORD) > -1).length;
  const pointHasWord = products.filter(p => (p.points || []).join(' ').indexOf(POINT_WORD) > -1).length;
  check('准备条件：该词只出现在卖点里（不在任何商品名里）', nameHasWord === 0 && pointHasWord >= 1,
    '名称命中 ' + nameHasWord + ' 件，卖点命中 ' + pointHasWord + ' 件');

  await page.fill('#prKeyword', POINT_WORD);
  await page.waitForTimeout(400);
  const hitRows = await page.$$eval('#prList tbody tr', rows => rows.map(tr => ({
    name: tr.querySelector('td b').textContent.trim(),
    points: tr.querySelector('.td-points').textContent.trim()
  })));
  check('搜索卖点里的词能搜到对应商品',
    hitRows.length === pointHasWord && hitRows.every(r => r.points.indexOf(POINT_WORD) > -1),
    '搜「' + POINT_WORD + '」命中 ' + hitRows.length + ' 件：' + hitRows.map(r => r.name).join('、'));
  out.numbers['卖点搜索'] = '「' + POINT_WORD + '」→ ' + hitRows.map(r => r.name).join('、');

  await page.fill('#prKeyword', '');
  await page.waitForTimeout(300);
  const CAT = '数码配件';
  await page.selectOption('#prCat', CAT);
  await page.waitForTimeout(400);
  const catRows = await page.$$eval('#prList tbody tr', rows => rows.map(tr => tr.querySelector('.td-cat').textContent.trim()));
  const catExpect = products.filter(p => p.cat === CAT).length;
  check('按品类筛选生效',
    catRows.length === catExpect && catRows.every(c => c === CAT),
    '筛选「' + CAT + '」→ ' + catRows.length + ' 件（商品库里共 ' + catExpect + ' 件），全部命中该品类');
  out.numbers['品类筛选'] = CAT + ' → ' + catRows.length + ' 件';

  await page.selectOption('#prCat', '全部');
  await page.waitForTimeout(300);
  await page.selectOption('#prSort', 'priceAsc');
  await page.waitForTimeout(400);
  const asc = await page.$$eval('#prList tbody tr', rows =>
    rows.map(tr => Number(tr.querySelectorAll('td')[2].textContent.replace(/[^\d.]/g, ''))));
  const ascOk = asc.every((v, i) => i === 0 || asc[i - 1] <= v);
  check('按价格从低到高排序生效', ascOk,
    '前 5 个价格：' + asc.slice(0, 5).join(' → ') + '（共 ' + asc.length + ' 行）');

  await page.selectOption('#prSort', 'priceDesc');
  await page.waitForTimeout(400);
  const desc = await page.$$eval('#prList tbody tr', rows =>
    rows.map(tr => Number(tr.querySelectorAll('td')[2].textContent.replace(/[^\d.]/g, ''))));
  check('按价格从高到低排序生效', desc.every((v, i) => i === 0 || desc[i - 1] >= v),
    '前 5 个价格：' + desc.slice(0, 5).join(' → '));

  await page.selectOption('#prSort', 'cat');
  await page.waitForTimeout(400);
  const catOrder = await page.$$eval('#prList tbody tr', rows =>
    rows.map(tr => tr.querySelector('.td-cat').textContent.trim()));
  const groups = [];
  catOrder.forEach(c => { if (groups[groups.length - 1] !== c) groups.push(c); });
  check('按品类排序生效（同品类聚在一起）',
    new Set(groups).size === groups.length,
    '品类顺序：' + groups.join(' → '));

  /* 筛选后统计跟着变 */
  await page.selectOption('#prSort', 'default');
  await page.selectOption('#prCat', CAT);
  await page.waitForTimeout(500);
  const filteredStats = await readStatCards(page);
  const filteredDom = await readTableStats(page);
  check('筛选后统计随当前列表变化且仍然对得上',
    Number(filteredStats[0].v.replace(/\D/g, '')) === filteredDom.total &&
    Number(filteredStats[1].v.replace(/\D/g, '')) === filteredDom.cats &&
    filteredStats[2].v.indexOf('¥' + filteredDom.minPrice) > -1,
    '筛选后：' + filteredStats.map(c => c.k + '=' + c.v).join(' ｜ '));
  await page.selectOption('#prCat', '全部');
  await page.waitForTimeout(400);

  /* ================= 验收 1：视图切换 + 与工作台一致 ================= */
  console.log('\n== 验收 1：表格 / 卡片视图切换，卡片与工作台一致 ==');
  await page.click('#prViewSeg button[data-view="card"]');
  await page.waitForTimeout(500);
  const cardCount = await page.locator('#prList .product-card').count();
  const tableGone = (await page.locator('#prList table').count()) === 0;
  check('切换到卡片视图：卡片数量与列表一致、表格已隐藏',
    cardCount === products.length && tableGone,
    '卡片 ' + cardCount + ' 张（商品 ' + products.length + ' 件），表格元素 ' + (tableGone ? '已隐藏' : '仍存在'));
  await page.click('#prViewSeg button[data-view="table"]');
  await page.waitForTimeout(400);
  check('可以切回表格视图', (await page.locator('#prList table').count()) === 1,
    '表格重新出现');
  await page.click('#prViewSeg button[data-view="card"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'admin-20-商品库卡片视图.png') });

  const adminCardInfo = await page.evaluate(() => {
    const el = document.querySelector('#prList .product-card');
    const pid = el.dataset.pid;
    const p = window.HP.Config.get().products.filter(x => x.id === pid)[0];
    const thumb = el.querySelector('.thumb');
    return {
      pid: pid,
      outer: el.outerHTML,
      fromSharedRenderer: el.outerHTML === window.HP.Products.cardHtml(p, {}),
      emoji: thumb.querySelector('span').textContent,
      gradient: thumb.style.background,
      catBadge: thumb.querySelector('.cat-tag').textContent,
      price: el.querySelector('.price').textContent,
      priceOld: el.querySelector('.price-old').textContent,
      off: el.querySelector('.tag.ok').textContent,
      points: Array.from(el.querySelectorAll('.selling span')).map(x => x.textContent)
    };
  });
  check('后台卡片就是共享渲染器的输出（同源）', adminCardInfo.fromSharedRenderer,
    'cardHtml 输出与 DOM 完全一致，商品 ' + adminCardInfo.pid);

  /* 工作台的同一件商品：比对图标 / 渐变 / 品类徽章 / 价格与划线价 / 卖点标签 */
  await page.goto(APP + '/index.html');
  await page.waitForTimeout(700);
  await page.locator('.news-item').first().click();
  await page.waitForTimeout(800);
  const wbCard = await page.evaluate((pid) => {
    const els = Array.from(document.querySelectorAll('#matchGrid .product-card'));
    const el = els.filter(x => x.dataset.pid === pid)[0];
    if (!el) return null;
    const thumb = el.querySelector('.thumb');
    return {
      emoji: thumb.querySelector('span').textContent,
      gradient: thumb.style.background,
      catBadge: thumb.querySelector('.cat-tag').textContent,
      price: el.querySelector('.price').textContent,
      priceOld: el.querySelector('.price-old').textContent,
      off: el.querySelector('.tag.ok').textContent,
      points: Array.from(el.querySelectorAll('.selling span')).map(x => x.textContent),
      hasScore: !!thumb.querySelector('.score'),
      hasReason: !!el.querySelector('.reason'),
      hasActions: !!el.querySelector('.product-actions')
    };
  }, adminCardInfo.pid);
  check('工作台里能找到同一件商品的卡片', !!wbCard, '商品 ' + adminCardInfo.pid + ' 出现在 Step 2 推荐里');
  check('图标一致', wbCard && wbCard.emoji === adminCardInfo.emoji,
    '两边都是 ' + adminCardInfo.emoji);
  check('渐变底色一致', wbCard && wbCard.gradient === adminCardInfo.gradient,
    '两边 thumb 背景：' + adminCardInfo.gradient.slice(0, 40));
  check('品类徽章一致', wbCard && wbCard.catBadge === adminCardInfo.catBadge,
    '两边都是「' + adminCardInfo.catBadge + '」');
  check('价格与划线价一致',
    wbCard && wbCard.price === adminCardInfo.price && wbCard.priceOld === adminCardInfo.priceOld,
    '两边都是 ' + adminCardInfo.price + ' / ' + adminCardInfo.priceOld + '（' + adminCardInfo.off + '）');
  check('卖点标签一致',
    wbCard && JSON.stringify(wbCard.points) === JSON.stringify(adminCardInfo.points),
    '两边共 ' + adminCardInfo.points.length + ' 个卖点：' + adminCardInfo.points.join('、'));
  check('工作台卡片在此之上多了匹配度 / 推荐理由 / 操作按钮（商品库只读卡片没有）',
    wbCard && wbCard.hasScore && wbCard.hasReason && wbCard.hasActions,
    '匹配度、推荐理由、采纳按钮都在');
  out.numbers['卡片一致性'] = '图标 / 渐变 / 品类徽章 / 价格 / 划线价 / 卖点 全部一致';
  await page.screenshot({ path: path.join(ROOT, 'work', 'shots', 'workbench-商品卡.png') });

  /* ================= 三级来源：换成本机浏览器打开 ================= */
  console.log('\n== 商品数据同样按三级来源读取 ==');
  await page.goto(FILE_ADMIN);
  await page.waitForTimeout(1000);
  const badgeFile = (await page.locator('#srcName').innerText()).trim();
  check('不启动服务时徽章显示「本机浏览器」，商品库仍能正常渲染',
    badgeFile === '本机浏览器' && (await page.locator('#prList tbody tr').count()) === products.length,
    '徽章：' + badgeFile + '，商品 ' + (await page.locator('#prList tbody tr').count()) + ' 件');
  out.numbers['来源徽章'] = '服务端 / 本机浏览器 均验证';

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
  fs.writeFileSync(path.join(ROOT, 'work', 'ui-products-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/ui-products-results.json');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('验收异常：', e); process.exit(2); });
