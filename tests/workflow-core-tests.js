/* =========================================================
   运营效率内核（HP.Workflow）单元测试 · 纯 Node，无需浏览器
   覆盖：去重指纹 / 热度趋势 / 月历 / 撞车检查 / 待审队列 / 批量计划
   运行：node tests/workflow-core-tests.js
   ========================================================= */
const path = require('path');
const W = require(path.join(__dirname, '..', 'assets', 'js', 'core', 'workflow.js'));

const out = { startedAt: new Date().toISOString(), checks: [], numbers: {} };
let pass = 0, fail = 0;
function check(name, cond, detail) {
  out.checks.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
  if (cond) { pass++; console.log('  ✓ ' + name + '  → ' + detail); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + detail); }
}

console.log('\n================ A. 标题归一与去重 ================');
check('标点/括号/空白不影响指纹',
  W.fingerprint('【冷空气来袭】北方多地气温骤降 10℃') === W.fingerprint('冷空气来袭 北方多地气温骤降10℃'),
  W.fingerprint('【冷空气来袭】北方多地气温骤降 10℃'));
check('指纹最多取 60 字',
  W.fingerprint('热'.repeat(200)).length === 60, W.fingerprint('热'.repeat(200)).length + ' 字');
check('空标题指纹为空串', W.fingerprint('   ') === '', JSON.stringify(W.fingerprint('   ')));

const raw = [
  { title: '【冷空气来袭】北方多地气温骤降 10℃', source: '微博热搜榜', heat: 900, seenCount: 1, history: [{ t: 't1', heat: 900 }] },
  { title: '冷空气来袭 北方多地气温骤降10℃', source: '百度热搜榜', heat: 930, seenCount: 1, history: [{ t: 't2', heat: 930 }] },
  { title: 'iPhone 17 首销火爆：线下门店排队超预期', source: '微博热搜榜', heat: 880 }
];
const d = W.dedupe(raw);
check('同一新闻被两个来源抓到只留 1 条', d.items.length === 2, '输入 ' + d.input + ' 条 → 去重后 ' + d.unique + ' 条，合并 ' + d.duplicates + ' 条');
check('duplicates 计数正确', d.duplicates === 1, 'duplicates=' + d.duplicates);
const cold = d.items[0];
check('seenCount 累加', cold.seenCount === 2, 'seenCount=' + cold.seenCount);
check('sources 合并两个来源', (cold.sources || []).join('/') === '微博热搜榜/百度热搜榜', (cold.sources || []).join('/'));
check('热度取更高的一条', cold.heat === 930, 'heat=' + cold.heat);
check('history 合并成 2 个采样点', (cold.history || []).length === 2, (cold.history || []).length + ' 点');

console.log('\n================ B. 热度趋势 ================');
const up = W.trendOf([{ heat: 700 }, { heat: 760 }, { heat: 820 }]);
const down = W.trendOf([{ heat: 800 }, { heat: 700 }]);
const flat = W.trendOf([{ heat: 800 }, { heat: 810 }]);
const fresh = W.trendOf([{ heat: 800 }]);
check('[700,760,820] 判为上升', up.label === 'up' && up.pct === 17.1, 'label=' + up.label + ' pct=' + up.pct);
check('[800,700] 判为下降', down.label === 'down', 'label=' + down.label + ' pct=' + down.pct);
check('[800,810] 判为持平', flat.label === 'flat', 'label=' + flat.label + ' pct=' + flat.pct);
check('只有一个采样点 → 新上榜', fresh.label === 'new', 'label=' + fresh.label);
check('趋势文案带箭头', W.trendText(up) === '↑ 17.1%' && W.trendText(down) === '↓ 12.5%' && W.trendText(fresh) === '新上榜',
  W.trendText(up) + ' / ' + W.trendText(down) + ' / ' + W.trendText(fresh));
check('迷你柱状图返回 0-100 的相对高度',
  W.sparkBars([500, 750, 1000]).every(v => v >= 6 && v <= 100) && W.sparkBars([500, 750, 1000])[2] === 100,
  JSON.stringify(W.sparkBars([500, 750, 1000])));

console.log('\n================ C. 月历（2026 年 10 月） ================');
const pool = [
  W.newPoolItem({ id: 'n1', title: '冷空气来袭', cat: '民生天气', source: '微博热搜榜', heat: 900 }, { planDate: '2026-10-23' }),
  W.newPoolItem({ id: 'n2', title: 'iPhone 17 首销', cat: '科技数码', source: '新浪科技', heat: 940 }, { planDate: '2026-10-05' })
];
const cal = W.calendar(pool, 2026, 10);
const cells = [].concat.apply([], cal.weeks);
check('6 行 × 7 列 = 42 格', cal.weeks.length === 6 && cells.length === 42, cal.weeks.length + ' 行 / ' + cells.length + ' 格');
check('2026-10-01 是周四 → 首行前 3 格是上月', cells[0].date === '2026-09-28' && cells[3].date === '2026-10-01',
  '首格 ' + cells[0].date + '，第 4 格 ' + cells[3].date);
check('inMonth 标记正确', cells[0].inMonth === false && cells[3].inMonth === true, '9-28 inMonth=' + cells[0].inMonth);
check('排期落在对应日期上', cells.filter(c => c.date === '2026-10-23')[0].items.length === 1, '10-23 有 1 条');
check('标题按月显示', cal.label === '2026 年 10 月', cal.label);

console.log('\n================ D. 撞车检查 ================');
const now = new Date('2026-10-23T10:00:00');
const recent = W.newPoolItem({ id: 'n1', title: '冷空气来袭' }, { planDate: '2026-10-20' });
const old = W.newPoolItem({ id: 'n1', title: '冷空气来袭' }, { planDate: '2026-10-10' });
const shelved = W.newPoolItem({ id: 'n1', title: '冷空气来袭' }, { planDate: '2026-10-21', status: '搁置' });
check('3 天前排过同一热点 → 命中', W.conflicts([recent], { newsId: 'n1', now: now, withinDays: 7 }).length === 1, '命中 1 条');
check('10 天前排过 → 不命中（超出 7 天窗口）', W.conflicts([old], { newsId: 'n1', now: now, withinDays: 7 }).length === 0, '命中 0 条');
check('搁置状态不算撞车', W.conflicts([shelved], { newsId: 'n1', now: now, withinDays: 7 }).length === 0, '命中 0 条');
check('同一件商品也算撞车', W.conflicts([W.newPoolItem({ id: 'n9', title: '别的事' }, { planDate: '2026-10-22', productId: 'p1' })],
  { productId: 'p1', now: now }).length === 1, '命中 1 条');

console.log('\n================ E. 待审队列 ================');
let queue = [];
queue = W.enqueue(queue, [{ id: 'q1', title: 'A' }, { id: 'q2', title: 'B' }, { id: 'q3', title: 'C' }]);
check('入队 3 条，默认状态待审', queue.length === 3 && queue.every(x => x.status === '待审'), queue.length + ' 条');
const again = W.enqueue(queue, [{ id: 'q2', title: 'B' }]);
check('重复 id 不重复入队', again.length === 3, again.length + ' 条');
check('queueStats 统计正确',
  JSON.stringify(W.queueStats(queue)) === JSON.stringify({ total: 3, wait: 3, pass: 0, published: 0, rejected: 0 }),
  JSON.stringify(W.queueStats(queue)));
check('next 往后翻到 q2', W.next(queue, 'q1', 1).id === 'q2', W.next(queue, 'q1', 1).id);
check('next 在末尾回到第一条', W.next(queue, 'q3', 1).id === 'q1', W.next(queue, 'q3', 1).id);
check('next 往前翻到上一条', W.next(queue, 'q1', -1).id === 'q3', W.next(queue, 'q1', -1).id);
const afterPass = W.setQueueStatus(queue, 'q2', '已通过');
check('通过后状态与时间戳都写入',
  afterPass.filter(x => x.id === 'q2')[0].status === '已通过' && !!afterPass.filter(x => x.id === 'q2')[0].reviewedAt,
  JSON.stringify(W.queueStats(afterPass)));
check('通过的不再出现在待审翻页里', W.next(afterPass, 'q1', 1).id === 'q3', W.next(afterPass, 'q1', 1).id);

console.log('\n================ F. 批量计划 ================');
const tasks = W.planBatch({ newsIds: ['n1', 'n2'], styleIds: ['s1', 's2', 's3'], productIds: ['p1', 'p2'] });
check('2 热点 × 3 风格 = 6 个任务', tasks.length === 6, tasks.length + ' 个任务');
check('商品在任务间轮转', tasks[0].productId === 'p1' && tasks[1].productId === 'p2' && tasks[2].productId === 'p1',
  tasks.slice(0, 3).map(t => t.productId).join(','));
check('预估耗时 = ceil(任务数/并发) × 单条耗时',
  W.estimateMs(6, 3, 2000) === 4000 && W.estimateMs(7, 3, 2000) === 6000,
  W.estimateMs(6, 3, 2000) + ' ms / ' + W.estimateMs(7, 3, 2000) + ' ms');

out.numbers = {
  '去重': '3 条输入（2 条同新闻）→ 2 条，seenCount=2，sources 合并 2 个',
  '趋势': 'up 17.1% / down 12.5% / flat / new 四种判定全部正确',
  '月历': '42 格，2026-10-01 落在第 4 格（周四），排期命中 1 条',
  '撞车': '3 天命中、10 天不命中、搁置不算',
  '队列': '入队 3 → 通过 1 → 待审 2，翻页循环正确',
  '批量': '2×3=6 任务，并发 3 预估 4 秒'
};
out.finishedAt = new Date().toISOString();
out.pass = pass; out.fail = fail;
require('fs').writeFileSync(path.join(__dirname, '..', 'work', 'workflow-core-results.json'), JSON.stringify(out, null, 2), 'utf8');
console.log('\n================ 汇总 ================');
console.log('通过 ' + pass + ' 项 / 失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
