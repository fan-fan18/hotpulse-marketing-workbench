/* 评测与返工内核实测（Node，零依赖）
   覆盖：机器校验 8 项（含违禁词/编造价格两个硬伤）、金额抽取、评审解析容错、总分权重、
        自动返工（只修该修的 / 只接受改好的 / 全程可追溯）、素材构造
   运行：node tests/eval-core-tests.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const out = { startedAt: new Date().toISOString(), checks: [], numbers: {} };
let pass = 0, fail = 0;
function check(name, cond, detail) {
  out.checks.push({ name, ok: !!cond, detail: detail === undefined ? '' : detail });
  if (cond) { pass++; console.log('  ✓ ' + name + '  → ' + detail); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + detail); }
}

const store = {};
global.window = global;
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
global.location = { protocol: 'file:' };
global.fetch = () => Promise.reject(new Error('offline'));

['assets/js/data.js', 'assets/js/core/config.js', 'assets/js/core/products.js', 'assets/js/core/prompt.js', 'assets/js/core/llm.js', 'assets/js/core/eval.js']
  .forEach(function (rel) { vm.runInThisContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel }); });

const E = global.HP.Eval;
const cfg = global.HP.Config.get();
const news = global.MOCK.NEWS[0];
const products = cfg.products.slice(0, 3);
const material = E.materialFrom(news, products, { style: cfg.styles[0], tone: cfg.tones[0].name, tags: news.topics.slice(0, 2) });

const LONG_TAIL = '这段话是为了把字数撑到超过上限而写的，'.repeat(20);
const BAD = '这款冲锋衣是全网最低价，绝对值得买！原价 699 现在只要 ¥66，' + LONG_TAIL + '\n**限时抢购** 买了不后悔。';
const GOOD = '【冷空气来袭】🥶 一夜降了 10 度，出门那下真的清醒。\n\n' +
  '三合一防风冲锋衣 加绒可拆内胆，加绒内胆可拆，防风防泼水面料，通勤周末都能穿。' +
  '现在 ¥299（原价 ¥599），比平时省了不少。\n\n你那边降了几度？评论区报个数 👇\n#冷空气来了# #一夜未秋#';

(async function run() {
  console.log('== 1. 素材构造 ==');
  check('素材里带上了必填话题、可用金额与商品名',
    material.tags.length >= 1 && material.amounts.length >= 3 && material.productNames.length === 3,
    '话题 ' + material.tags.join('') + '；可用金额 ' + material.amounts.map(n => '¥' + n).join('、') +
    '；商品 ' + material.productNames.length + ' 件');
  out.numbers['素材'] = '可用金额 ' + material.amounts.join('、');

  console.log('\n== 2. 机器校验：8 项都能查 ==');
  const bad = E.machineCheck(BAD, material);
  const byCode = {};
  bad.items.forEach(i => { byCode[i.code] = i; });
  check('检查项数量为 8 项', bad.items.length === 8, bad.items.map(i => i.label).join('、'));
  check('字数超标被查出', byCode.words.pass === false, byCode.words.reason);
  check('违禁词被查出并列出命中词（硬伤）',
    byCode.forbidden.pass === false && byCode.forbidden.level === 'hard' && byCode.forbidden.hits.length >= 3,
    '命中：' + byCode.forbidden.hits.join('、') + '（' + byCode.forbidden.level + '，权重 ' + byCode.forbidden.weight + '）');
  check('编造价格被查出（硬伤）并同时列出台账',
    byCode.fakePrice.pass === false && byCode.fakePrice.level === 'hard' &&
    byCode.fakePrice.hits.indexOf(66) > -1 && byCode.fakePrice.hits.indexOf(699) > -1,
    '编造：' + byCode.fakePrice.hits.map(n => '¥' + n).join('、') +
    '；素材可用：' + byCode.fakePrice.allowed.map(n => '¥' + n).join('、'));
  check('缺少话题标签 / 互动引导 / 排版残留都被查出',
    byCode.tags.pass === false && byCode.cta.pass === false && byCode.format.pass === false,
    [byCode.tags.reason, byCode.cta.reason, byCode.format.reason].join('；'));
  check('命中硬伤时标记 hardFail', bad.hardFail === true, '机器分 ' + bad.score);
  check('硬伤权重最高（违禁词 5 > 字数 2）',
    byCode.forbidden.weight > byCode.words.weight && byCode.fakePrice.weight > byCode.words.weight,
    '权重：违禁词 ' + byCode.forbidden.weight + '、编造价格 ' + byCode.fakePrice.weight + '、字数 ' + byCode.words.weight);
  out.numbers['违规文案机器分'] = bad.score;

  const good = E.machineCheck(GOOD, material);
  check('修正后的合规文案能拿到高分（仅字数或话题可能微调）',
    good.score >= 80 && !good.hardFail,
    '机器分 ' + good.score + '；未通过项：' + (good.failed.map(i => i.label).join('、') || '无'));

  console.log('\n== 3. 金额抽取 ==');
  const amounts = E.extractAmounts('原价 699，现在只要 ¥66，省 633 元，另外「只要 3 步就能用」');
  check('能抽出 ¥ 前缀、元后缀、省/减类金额',
    amounts.indexOf(66) > -1 && amounts.indexOf(699) > -1 && amounts.indexOf(633) > -1,
    '抽出：' + amounts.map(n => '¥' + n).join('、'));
  check('不会把「只要 3 步」当成金额', amounts.indexOf(3) < 0, '未包含 3');

  console.log('\n== 4. 评审解析容错 ==');
  const p1 = E.parseReview('```json\n{"hot":4,"material":5,"appeal":3,"natural":4,"comment":"衔接自然"}\n```');
  check('代码块包裹能解析', p1.ok && p1.avg === 4 && p1.score === 80, '均分 ' + p1.avg + '，折合 ' + p1.score + ' 分');
  const p2 = E.parseReview('好的，评分如下：\n{"热点关联度": 5, "素材还原度": 4, "传播吸引力": 5, "语气自然度": 4, "点评": "有钩子"}');
  check('中文键名 + 前后废话也能解析', p2.ok && p2.score === 90 && /有钩子/.test(p2.dims.comment), '得分 ' + p2.score);
  const p3 = E.parseReview('热点关联度：4分 素材还原度：3分 传播吸引力：5分 语气自然度：4分');
  check('散乱文本能兜底捞出数字', p3.ok && p3.dims.appeal === 5, JSON.stringify(p3.dims));
  const p4 = E.parseReview('这段文案我觉得还行，但说不出分数。');
  check('实在解析不了时标记评审失败而不中断', p4.ok === false && !!p4.reason, p4.reason);
  out.numbers['评审解析'] = [p1.score, p2.score, p3.score, '第4条标记失败'].join(' / ');

  console.log('\n== 5. 总分权重 ==');
  const t1 = E.totalScore(80, p1, { machine: 0.5, review: 0.5 });
  check('默认各占一半', Math.abs(t1.score - 80) < 0.01, '机器 80 + 评审 80 → ' + t1.score);
  const t2 = E.totalScore(60, p2, { machine: 0.8, review: 0.2 });
  check('权重可调（8:2）', Math.abs(t2.score - 66) < 0.11, '机器 60（0.8）+ 评审 90（0.2）→ ' + t2.score);
  const t3 = E.totalScore(72, { ok: false }, { machine: 0.5, review: 0.5 });
  check('不启用评审时以机器分为准', t3.score === 72 && t3.usedReview === false, '总分 ' + t3.score);

  console.log('\n== 6. 自动返工 ==');
  cfg.model.mode = 'mock';
  const rw = await E.autoRework({ copy: BAD, material, maxRounds: 3, meta: { products, materialText: material.text } });
  check('违规文案经返工后分数明显提升', rw.improved === true, '返工前 ' + rw.before + ' → 返工后 ' + rw.after);
  check('返工轨迹记录了每轮修好什么、还剩什么',
    rw.rounds.length >= 1 && rw.rounds[0].fixed.length >= 1,
    rw.rounds.map(r => '第' + r.round + '轮' + (r.accepted ? '（采纳）' : '（驳回）') +
      ' 修好：' + (r.fixed.join('、') || '无') + '；剩余：' + (r.remaining.join('、') || '无')).join(' ｜ '));
  check('返工后违禁词与编造价格都被清除',
    rw.check.items.filter(i => i.code === 'forbidden')[0].pass === true &&
    rw.check.items.filter(i => i.code === 'fakePrice')[0].pass === true,
    '硬伤项全部通过，最终机器分 ' + rw.after);
  check('"没提到商品"这类改了也白改的问题不进返工循环',
    E.fixableIssues({ items: rw.check.items }).every(i => i.code !== 'product'),
    'product 项 rework=false，不在可返工清单里');
  out.numbers['返工'] = rw.before + ' → ' + rw.after + '（' + rw.rounds.length + ' 轮）';
  out.numbers['返工轨迹'] = rw.rounds.map(r => '第' + r.round + '轮 ' + (r.accepted ? '采纳' : '驳回') + '：' + (r.fixed.join('、') || '无修复'));

  /* 温度：返工应该用低温度 */
  let usedTemp = null;
  await E.autoRework({
    copy: BAD, material, maxRounds: 1, meta: { products, materialText: material.text },
    llm: function (o) { usedTemp = o.temperature; return global.HP.LLM.call(o); }
  });
  check('返工用低温度（配置里的返工温度）', usedTemp != null && usedTemp <= 0.3,
    '返工温度 ' + usedTemp + '（创作温度是 ' + cfg.model.temperature + '）');

  /* 改差了要保留上一版 */
  const worse = await E.autoRework({
    copy: BAD, material, maxRounds: 1, meta: { products, materialText: material.text },
    llm: function () { return Promise.resolve({ ok: true, text: '**绝对全网最低** ¥99999\n' + BAD, model: 'fake', mode: 'mock' }); }
  });
  check('改完分数没涨 → 保留上一版', worse.text === BAD && worse.rounds[0].accepted === false,
    worse.rounds[0].note);

  /* 最多轮数限制 */
  const limited = await E.autoRework({ copy: BAD, material, maxRounds: 1, meta: { products, materialText: material.text } });
  check('尊重最多返工轮数', limited.rounds.length <= 1, 'maxRounds=1 → 实际 ' + limited.rounds.length + ' 轮');

  console.log('\n== 7. 硬伤优先 ==');
  const both = E.machineCheck('绝对第一名 ¥12345', material);
  check('同时命中两个硬伤时都能查到',
    both.counts.forbidden >= 1 && both.counts.fakePrice >= 1,
    '违禁词 ' + both.counts.forbidden + ' 个、编造价格 ' + both.counts.fakePrice + ' 个');

  console.log('\n== 8. 需求点名的 15 个违禁词全覆盖 ==');
  const MUST = ['最佳', '最好', '最低', '第一', '国家级', '顶级', '绝对', '永久', '百分百',
    '全网最低', '唯一', '首选', '冠军', '领导品牌', '完美', '万能'];
  const missing = MUST.filter(w => E.FORBIDDEN.indexOf(w) < 0);
  check('需求里点名的违禁词全部在词库里', missing.length === 0,
    missing.length ? '缺少：' + missing.join('、') : MUST.length + ' 个词全部覆盖（词库共 ' + E.FORBIDDEN.length + ' 个）');
  const eachHit = MUST.filter(w => {
    const r = E.machineCheck('这条文案用了' + w + '的说法。', material);
    return r.items.filter(i => i.code === 'forbidden')[0].hits.indexOf(w) > -1;
  });
  check('逐词验证：每一个词都能被单独命中', eachHit.length === MUST.length,
    '逐个测 ' + MUST.length + ' 个词，命中 ' + eachHit.length + ' 个');

  console.log('\n== 9. 编造价格的台账口径 ==');
  const fakeCheck = E.machineCheck('现在只要 ¥88，原价 ¥999。', material).items.filter(i => i.code === 'fakePrice')[0];
  check('失败原因里同时给出"编造的金额"和"素材真实可用的金额"',
    /文案出现素材里没有的金额：¥88、¥999/.test(fakeCheck.reason) &&
    /素材里真实可用的金额/.test(fakeCheck.reason),
    fakeCheck.reason);
  check('可用金额区分"素材直接给出"与"可由原价−售价推出"',
    fakeCheck.directAmounts.length >= 3 && fakeCheck.derivedAmounts.length >= 3 &&
    fakeCheck.allowed.length === fakeCheck.directAmounts.length + fakeCheck.derivedAmounts.length,
    '直接给出 ' + fakeCheck.directAmounts.map(n => '¥' + n).join('、') +
    '；可推出 ' + fakeCheck.derivedAmounts.map(n => '¥' + n).join('、'));
  out.numbers['价格台账'] = fakeCheck.reason.slice(0, 60);

  console.log('\n== 10. 模型评审：真调一次 + 低温度 + 容错 ==');
  const GOOD2 = '【冷空气来袭】🥶 三合一防风冲锋衣，加绒内胆可拆，防风防泼水面料。现在 ¥299（原价 ¥599）。你们那边几度？评论区报个数 👇\n#冷空气来了# #一夜入秋#';
  let reviewTemp = null, reviewUser = '';
  const rv = await E.runReview({
    copy: GOOD2, materialText: material.text, products: products,
    llm: function (o) { reviewTemp = o.temperature; reviewUser = o.user; return global.HP.LLM.call(o); }
  });
  check('真调一次评审并拿到四维分与点评',
    rv.ok && rv.dims.hot >= 1 && rv.dims.hot <= 5 && rv.dims.material >= 1 && rv.dims.material <= 5 &&
    rv.dims.appeal >= 1 && rv.dims.natural >= 1 && !!rv.dims.comment,
    '热点 ' + rv.dims.hot + '｜素材 ' + rv.dims.material + '｜传播 ' + rv.dims.appeal + '｜语气 ' + rv.dims.natural +
    '｜均分 ' + rv.avg + '；点评：' + rv.dims.comment.slice(0, 24));
  check('评审用低温度（配置里的评审温度）',
    reviewTemp != null && reviewTemp <= 0.3 && reviewTemp === cfg.prompt.reviewTemperature,
    '评审温度 ' + reviewTemp + '（创作温度 ' + cfg.model.temperature + '）');
  check('评审提示词由配置拼装，{{素材}} 与 {{文案}} 都被替换',
    reviewUser.indexOf('{{素材}}') < 0 && reviewUser.indexOf('{{文案}}') < 0 &&
    reviewUser.indexOf('三合一防风冲锋衣') > -1 && reviewUser.indexOf('四个维度') > -1,
    '发给评审模型的内容 ' + reviewUser.replace(/\s/g, '').length + ' 字，含素材与文案');
  check('四维分都在 1–5 之间', [rv.dims.hot, rv.dims.material, rv.dims.appeal, rv.dims.natural]
    .every(n => n >= 1 && n <= 5), JSON.stringify(rv.dims));
  const rvTotal = E.totalScore(E.machineCheck(GOOD2, material).score, rv, { machine: 0.5, review: 0.5 });
  check('综合分 = 机器分与评审分按权重合成',
    Math.abs(rvTotal.score - (E.machineCheck(GOOD2, material).score + rv.score) / 2) < 0.11,
    '机器 ' + E.machineCheck(GOOD2, material).score + ' + 评审 ' + rv.score + ' → 综合 ' + rvTotal.score);
  out.numbers['评审'] = '均分 ' + rv.avg + '，折合 ' + rv.score + ' 分；综合 ' + rvTotal.score;

  console.log('\n== 11. 批量评测：编排 / 并发 / 叫停 / 汇总 ==');
  const seeds = E.seedCases();
  check('可从真实业务数据一键生成种子用例', seeds.length >= 6 &&
    seeds.every(c => c.newsId && c.productIds.length && c.tone && c.selected === true),
    seeds.length + ' 条，示例：' + seeds[0].name + '（' + seeds[0].productIds.join('、') + '｜' + seeds[0].tone + '）');
  const runCases = seeds.slice(0, 2).map(function (c) {
    return {
      id: c.id, name: c.name,
      news: global.MOCK.NEWS.filter(n => n.id === c.newsId)[0],
      products: c.productIds.map(id => cfg.products.filter(p => p.id === id)[0]),
      tags: c.tags, tone: c.tone, emojiLevel: c.emojiLevel
    };
  });
  const styles2 = cfg.styles.slice(0, 2);
  check('任务数 = 用例 × 风格 × 重复次数',
    E.buildTaskList({ cases: runCases, styles: styles2, repeats: 2 }).length === 8,
    '2 用例 × 2 风格 × 2 次 = 8');

  let inFlight = 0, peak = 0;
  const originalCall = global.HP.LLM.call;
  global.HP.LLM.call = function (o) {
    inFlight++; peak = Math.max(peak, inFlight);
    return originalCall(o).then(r => { inFlight--; return r; }, e => { inFlight--; throw e; });
  };
  const runA = await E.runEval({
    cases: runCases, styles: styles2, repeats: 1, concurrency: 2,
    enableReview: true, weights: { machine: 0.5, review: 0.5 },
    autoRework: true, maxReworkRounds: 1, fastMock: true
  });
  check('并发不超过设定值（默认 3，这里设 2）', peak <= 2, '实测峰值并发 ' + peak);
  check('任务全部完成并边跑边回调', runA.summary.done === 4 && runA.results.length === 4,
    '完成 ' + runA.summary.done + ' / ' + runA.summary.total);
  const reAvg = Math.round(runA.results.reduce((s, r) => s + r.totalScore, 0) / runA.results.length * 10) / 10;
  check('汇总总分与明细一致', Math.abs(reAvg - runA.summary.avgScore) < 0.11,
    '明细重算 ' + reAvg + ' = 汇总 ' + runA.summary.avgScore);
  const reForbidden = runA.results.reduce((s, r) => s + r.machine.counts.forbidden, 0);
  const reFake = runA.results.reduce((s, r) => s + r.machine.counts.fakePrice, 0);
  check('违禁词命中数 / 编造价格数与明细一致',
    reForbidden === runA.summary.forbiddenHits && reFake === runA.summary.fakePriceCount,
    '违禁词 ' + runA.summary.forbiddenHits + '、编造价格 ' + runA.summary.fakePriceCount);
  check('汇总含消耗、耗时与预估花费', runA.summary.tokens > 0 && runA.summary.elapsedMs > 0 && runA.summary.cost > 0,
    'tokens ' + runA.summary.tokens + '，耗时 ' + runA.summary.elapsedMs + 'ms，花费 ¥' + runA.summary.cost);
  check('明细里带逐条校验与评审四维', runA.results.every(r => r.machine.items.length === 8 && (!r.review || r.review.ok !== false)),
    '每条都有 8 项校验结果' + (runA.summary.reviewAvg ? '，评审均分 ' + runA.summary.reviewAvg : ''));
  out.numbers['批量评测'] = '4 条任务，峰值并发 ' + peak + '，汇总总分 ' + runA.summary.avgScore;

  let seen = 0;
  const runStop = await E.runEval({
    cases: runCases, styles: styles2, repeats: 3, concurrency: 2, enableReview: false,
    autoRework: false, fastMock: true,
    onProgress: function () { seen++; },
    isStopped: function () { return seen >= 4; }
  });
  check('中途叫停后不再派发新任务', runStop.summary.completed < 12 && runStop.stopped === true,
    '总任务 12，叫停时完成 ' + runStop.summary.completed + ' 条');

  console.log('\n== 12. 用评测结果反推提示词改进（第六段） ==');
  const weakCfg = JSON.parse(JSON.stringify(cfg));
  /* 软性字数要求：写"越丰富越好"式的下限，模型就会写超 */
  weakCfg.prompt.rules = ['篇幅不少于 600 字，内容写得越丰富越好。', cfg.prompt.rules[1]];
  const weakRun = await E.runEval({
    cases: runCases, styles: styles2.slice(0, 1), repeats: 1, concurrency: 2,
    enableReview: false, autoRework: false, fastMock: true, config: weakCfg
  });
  const wordFails = weakRun.results.filter(r => r.machine.items.some(i => i.code === 'words' && !i.pass)).length;
  check('软性字数要求下确实会超标', wordFails >= 1,
    '字数未通过的条数 ' + wordFails + ' / ' + weakRun.summary.done + '，平均分 ' + weakRun.summary.avgScore +
    '（实测字数 ' + weakRun.results[0].machine.items.filter(i => i.code === 'words')[0].value + '）');
  const fixes = E.suggestFixes(weakRun.results);
  const wordFix = fixes.filter(f => f.code === 'words')[0];
  check('能从结果里给出可执行的改进建议', !!wordFix && /数一遍|删/.test(String((wordFix || {}).rule) + String((wordFix || {}).reason)),
    wordFix ? (wordFix.title + ' → ' + wordFix.rule) : '没有字数建议');

  const betterCfg = JSON.parse(JSON.stringify(cfg));
  betterCfg.prompt.rules = [wordFix ? wordFix.rule : cfg.prompt.rules[0], cfg.prompt.rules[1]];
  const betterRun = await E.runEval({
    cases: runCases, styles: styles2.slice(0, 1), repeats: 1, concurrency: 2,
    enableReview: false, autoRework: false, fastMock: true, config: betterCfg
  });
  check('按建议改成硬要求后，重跑同一批用例分数确实涨了',
    betterRun.summary.avgScore > weakRun.summary.avgScore,
    '总分 ' + weakRun.summary.avgScore + ' → ' + betterRun.summary.avgScore);
  out.numbers['提示词改进'] = weakRun.summary.avgScore + ' → ' + betterRun.summary.avgScore;

  console.log('\n== 13. 历史对比（A/B） ==');
  const histA = { summary: weakRun.summary, results: weakRun.results, promptSnapshot: weakCfg.prompt };
  const histB = { summary: betterRun.summary, results: betterRun.results, promptSnapshot: betterCfg.prompt };
  const cmp = E.compareRuns(histA, histB);
  const scoreRow = cmp.metrics.filter(m => m.label === '总分')[0];
  check('指标涨跌带方向与颜色标记', scoreRow.delta > 0 && scoreRow.better === true,
    '总分 ' + scoreRow.a + ' → ' + scoreRow.b + '（+' + scoreRow.delta + '）');
  check('逐条用例分数对比 + 变差用例可高亮',
    cmp.perCase.length === betterRun.results.length && cmp.perCase.every(p => 'worse' in p),
    '逐条对比 ' + cmp.perCase.length + ' 条，变差 ' + cmp.worse.length + ' 条');
  check('顶部能说明两次运行的提示词差在哪',
    cmp.promptDiff.length >= 1 && cmp.promptDiff[0].label === '写作规范',
    cmp.promptDiff[0].label + '：' + cmp.promptDiff[0].a.slice(0, 20) + ' → ' + cmp.promptDiff[0].b.slice(0, 20));
  check('对比结果里带上"接下来该改什么"的建议', cmp.suggest.length >= 0, '建议 ' + cmp.suggest.length + ' 条');

  global.HP.LLM.call = originalCall;

  /* 三种常见输出形态都能捞出来（mock 会随机用其中一种） */
  const forms = [];
  for (let i = 0; i < 6; i++) {
    const r = await E.runReview({ copy: GOOD2 + '样本' + i, materialText: material.text, products: products });
    forms.push(r.ok ? (/(^```|^好的)/.test(r.raw.trim()) ? '带包装' : '纯 JSON') : '解析失败');
  }
  check('多种输出形态（纯 JSON / 代码块 / 带废话）都能解析',
    forms.every(f => f !== '解析失败'),
    '6 次评审的形态：' + Array.from(new Set(forms)).join('、'));

  const badReview = await E.runReview({
    copy: GOOD2, materialText: material.text, products: products,
    llm: function () { return Promise.resolve({ ok: true, text: '这段文案我觉得还行，但我说不出分数。', model: 'fake', mode: 'mock' }); }
  });
  check('解析不了时标记这条评审失败且不抛错',
    badReview.ok === false && /无法解析/.test(badReview.reason), badReview.reason);
  const errReview = await E.runReview({
    copy: GOOD2, materialText: material.text, products: products,
    llm: function () { return Promise.resolve({ ok: false, message: '模型名不存在，请核对模型名称' }); }
  });
  check('评审调用失败时把可读原因带出来',
    errReview.ok === false && errReview.reason === '模型名不存在，请核对模型名称', errReview.reason);

  /* 提示词可编辑：改了配置里的评审提示词，拼出来的内容跟着变 */
  const editedCfg = JSON.parse(JSON.stringify(cfg));
  editedCfg.prompt.reviewPrompt = '【自定义评审口径】请严格打分。\n素材：{{素材}}\n文案：{{文案}}';
  let editedUser = '';
  await E.runReview({
    copy: GOOD2, materialText: material.text, products: products, config: editedCfg,
    llm: function (o) { editedUser = o.user; return global.HP.LLM.call(o); }
  });
  check('评审提示词改了以后，发给模型的内容立即跟着变',
    editedUser.indexOf('【自定义评审口径】') === 0 && editedUser.indexOf('{{') < 0,
    editedUser.split('\n')[0]);

  console.log('\n== 14. 短标识与另外三类改进建议 ==');
  const snapA = { rules: ['软性描述：篇幅控制在 320 字以内'] };
  const snapB = { rules: ['写完自己数一遍，超了就删'] };
  const idA = E.shortId(snapA), idB = E.shortId(snapB);
  check('短标识可辨认、且随提示词变化', /^[a-z0-9]{4}-\d{4}T\d{4}$/.test(idA) && idA !== idB, idA + ' → ' + idB);

  const hardFixes = E.suggestFixes([{ machine: E.machineCheck('绝对第一，现在只要 ¥88。', material) }]);
  const codes = hardFixes.map(function (f) { return f.code; });
  check('违禁词与编造价格也能给出对应建议',
    codes.indexOf('forbidden') > -1 && codes.indexOf('fakePrice') > -1,
    hardFixes.map(function (f) { return f.title; }).join('；'));
  const priceFix = hardFixes.filter(function (f) { return f.code === 'fakePrice'; })[0];
  check('价格类建议带可直接粘贴的硬约束文案',
    /金额只能原样使用素材里给出的数字/.test(priceFix.rule), priceFix.rule.slice(0, 32) + '…');
  const formatFix = E.suggestFixes([{ machine: E.machineCheck('**粗体**', material) }])
    .filter(function (f) { return f.code === 'format'; })[0];
  check('格式类建议指向"加范例"，且说明范例必须自己合规',
    formatFix && /范例/.test(formatFix.reason) && formatFix.rule === null,
    formatFix ? formatFix.reason.slice(0, 32) : '未给出');
  out.finishedAt = new Date().toISOString();
  out.pass = pass; out.fail = fail;
  fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'work', 'eval-core-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/eval-core-results.json');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常：', e); process.exit(2); });
