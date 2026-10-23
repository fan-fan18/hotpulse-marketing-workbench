/* =========================================================
   热点池 / 定时抓取内核（server/news.js）单元测试
   覆盖：真抓取 → 去重合并 → 热度采样 → 趋势 → 落盘 → 保留天数清理
   运行：node tests/news-core-tests.js（会自己拉起一个本地 stub RSS）
   ========================================================= */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createNewsStore } = require(path.join(__dirname, '..', 'server', 'news.js'));

const ROOT = path.join(__dirname, '..');
const STUB_PORT = 8849;
const RSS = 'http://127.0.0.1:' + STUB_PORT + '/rss';
const TMP = path.join(ROOT, 'work', 'tmp-news-' + process.pid);

const out = { startedAt: new Date().toISOString(), checks: [], numbers: {} };
let pass = 0, fail = 0;
function check(name, cond, detail) {
  out.checks.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
  if (cond) { pass++; console.log('  ✓ ' + name + '  → ' + detail); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + detail); }
}

let stub = null;
(async function run() {
  fs.mkdirSync(TMP, { recursive: true });
  stub = spawn('node', [path.join(__dirname, 'stub-provider.js'), String(STUB_PORT)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900));

  const cfg = {
    fetch: { enabled: true, intervalMin: 10, keepDays: 7 },
    sources: [
      { id: 'src_a', name: '验收订阅源', type: 'custom', url: RSS, enabled: true },
      { id: 'src_bad', name: '坏地址来源', type: 'custom', url: 'http://127.0.0.1:1/nope', enabled: true },
      { id: 'src_off', name: '停用来源', type: 'custom', url: RSS, enabled: false }
    ]
  };
  const store = createNewsStore({ dataDir: TMP, getConfig: () => cfg, log: () => {} });
  store.load();

  console.log('\n================ A. 第一轮真抓取 ================');
  const r1 = await store.refresh();
  check('抓取返回成功', r1.ok === true, 'ok=' + r1.ok);
  check('只抓启用中的来源（停用的不算）', r1.run.sources.length === 2, '本轮测试 ' + r1.run.sources.length + ' 个来源（含 1 个坏地址）');
  check('RSS 解析出 3 条', r1.run.added === 3, '新增 ' + r1.run.added + ' 条');
  check('坏地址来源失败但不影响其它来源',
    r1.run.failedSources === 1 && r1.run.okSources === 1,
    '成功 ' + r1.run.okSources + ' / 失败 ' + r1.run.failedSources);
  const badRes = r1.run.sources.filter(s => s.id === 'src_bad')[0];
  check('失败原因是人话（不是原始堆栈）',
    !!badRes && !badRes.ok && /失败|超时|拒绝|地址|无法|连接/.test(badRes.reason || ''),
    (badRes && badRes.reason || '').slice(0, 40));
  check('池内共 3 条', r1.run.total === 3, 'total=' + r1.run.total);
  check('落盘到 data/news.json（原子写）', fs.existsSync(path.join(TMP, 'news.json')), path.join(TMP, 'news.json'));
  check('没有留下 .tmp 残留文件', !fs.existsSync(path.join(TMP, 'news.json.tmp')), '无 .tmp');

  const items1 = store.list();
  check('条目带来源名与热度', items1[0].source === '验收订阅源' && items1[0].heat >= 600 && items1[0].heat <= 990,
    'source=' + items1[0].source + ' heat=' + items1[0].heat);
  check('首次抓取只有 1 个采样点', items1[0].history.length === 1, items1[0].history.length + ' 点');
  check('趋势判为新上榜', require(path.join(ROOT, 'assets', 'js', 'core', 'workflow.js')).trendOf(items1[0].history).label === 'new', 'new');

  console.log('\n================ B. 第二轮：同一批新闻不重复入池 ================');
  await new Promise(r => setTimeout(r, 60));
  const r2 = await store.refresh();
  check('第二轮新增 0 条', r2.run.added === 0, 'added=' + r2.run.added);
  check('第二轮合并 3 条重复', r2.run.merged === 3, 'merged=' + r2.run.merged);
  check('池内仍然是 3 条（没有越抓越多）', r2.run.total === 3, 'total=' + r2.run.total);
  const items2 = store.list();
  check('seenCount 累加到 2', items2[0].seenCount === 2, 'seenCount=' + items2[0].seenCount);
  check('采样点累加到 2 个', items2[0].history.length === 2, items2[0].history.length + ' 点');
  check('两次抓取都记进 runs', store.runs().length === 2, store.runs().length + ' 次记录');

  console.log('\n================ C. 多来源抓同一条 → 合并来源名 ================');
  cfg.sources.push({ id: 'src_a2', name: '第二个订阅源', type: 'custom', url: RSS, enabled: true });
  const r3 = await store.refresh();
  check('第二个来源抓到同一批标题 → 全部合并（2 个来源 × 3 条 = 6 次命中）', r3.run.added === 0 && r3.run.merged === 6,
    'added=' + r3.run.added + ' merged=' + r3.run.merged);
  const merged = store.list()[0];
  check('来源名合并成 2 个', (merged.sources || []).length === 2, (merged.sources || []).join('、'));

  console.log('\n================ D. 统计口径 ================');
  const st = store.stats();
  check('total 与列表长度一致', st.total === store.list().length, 'total=' + st.total);
  check('today 等于今天首次抓到的条数', st.today === 3, 'today=' + st.today);
  check('sources 是去重后的来源数', st.sources === 2, 'sources=' + st.sources);
  check('lastRun 带耗时与来源明细', !!st.lastRun && st.lastRun.ms >= 0 && Array.isArray(st.lastRun.sources),
    'lastRun.ms=' + (st.lastRun && st.lastRun.ms) + ' ms');

  console.log('\n================ E. 保留天数清理 ================');
  const raw = JSON.parse(fs.readFileSync(path.join(TMP, 'news.json'), 'utf8'));
  raw.items.push({
    id: 'sn_old', fp: '很久以前的新闻', title: '很久以前的新闻', source: '验收订阅源', sourceId: 'src_a',
    firstSeen: new Date(Date.now() - 40 * 86400000).toISOString(),
    lastSeen: new Date(Date.now() - 40 * 86400000).toISOString(),
    seenCount: 1, heat: 700, history: []
  });
  fs.writeFileSync(path.join(TMP, 'news.json'), JSON.stringify(raw, null, 2), 'utf8');
  store.load();
  check('重新载入后能读到 4 条', store.list().length === 4, store.list().length + ' 条');
  await store.refresh();
  check('超过保留天数（7 天）的条目被清掉', store.list().length === 3, '清理后 ' + store.list().length + ' 条');
  check('池子里找不到那条老新闻', !store.list().some(x => x.id === 'sn_old'), '已清除');

  console.log('\n================ F. 定时器开关 ================');
  const started = store.start();
  check('开启时 start() 成功并给出首次运行时间', started.ok === true && started.firstRunInMs === 3000,
    '首次 ' + started.firstRunInMs + ' ms 后');
  store.stop();
  cfg.fetch.enabled = false;
  const stopped = store.start();
  check('fetch.enabled=false 时 start() 不再排期', stopped.ok === false, stopped.reason);
  check('关闭后 enabled() 返回 false', store.enabled() === false, 'enabled=false');
  check('间隔非法时回落到默认 10 分钟', (cfg.fetch.intervalMin = 0, store.intervalMin()) === 10, 'intervalMin=' + store.intervalMin());
  cfg.fetch.intervalMin = 30;
  check('间隔可配置（30 分钟）', store.intervalMin() === 30, 'intervalMin=' + store.intervalMin());
  cfg.fetch.intervalMin = 999;
  check('间隔上限 240 分钟', store.intervalMin() === 240, 'intervalMin=' + store.intervalMin());

  out.numbers = {
    '第一轮': '2 个启用来源（1 好 1 坏）→ 新增 3 条、失败 1 个、池内 3 条',
    '第二轮': '新增 0 / 合并 3，seenCount=2，history 2 点，池内仍 3 条',
    '多来源': '2 个来源抓同一批标题 → sources 合并为 2 个',
    '清理': '注入 40 天前的条目 → 下一轮被清掉，剩 3 条',
    '定时': 'start 首次 3 秒、间隔可配 10/30/240 分钟，关闭后不排期'
  };
  out.finishedAt = new Date().toISOString();
  out.pass = pass; out.fail = fail;
  fs.writeFileSync(path.join(ROOT, 'work', 'news-core-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n================ 汇总 ================');
  console.log('通过 ' + pass + ' 项 / 失败 ' + fail + ' 项');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  if (stub) stub.kill();
  setTimeout(function () { process.exit(fail ? 1 : 0); }, 250);
})().catch(e => { console.error('异常：', e); stub && stub.kill(); process.exit(2); });
