/* =========================================================
   最终验收脚本（逐条对应交付要求，全部输出实测数字）
   验收 1：完整跑一轮评测 → 汇总数字与明细对得上、叫停真能停
           · 默认用本机 OpenAI 兼容服务端（真实 HTTP、真实状态码）跑通链路
           · 若环境里配了密钥（HOTPULSE_API_KEY / DEEPSEEK_API_KEY / DASHSCOPE_API_KEY…），
             自动改用真实服务商并把 model 名打印出来
   验收 2：构造违规文案（超字数 + 违禁词 + 编造价格）→ 机器校验全部揪出
   验收 3：对这条走「一键修正」→ 一轮内修好并说清修了什么；改差了自动保留上一版
   验收 4：同一批违规输出，返工关闭 vs 开启的通过率对比（原本全转人工 → 大部分自动过）
   验收 5：改一次提示词跑两轮 → 对比视图看出差异，并指出哪些用例变差了
   运行：node tests/acceptance-tests.js
   ========================================================= */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STUB_PORT = 8830;
const results = { startedAt: new Date().toISOString(), checks: [], numbers: {} };
let pass = 0, fail = 0;
function check(name, cond, detail) {
  results.checks.push({ name, ok: !!cond, detail: detail === undefined ? '' : detail });
  if (cond) { pass++; console.log('  ✓ ' + name + '  → ' + detail); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + detail); }
}
function num(n) { return typeof n === 'number' ? Math.round(n * 100) / 100 : n; }

/* ---------- 载入前端内核（与浏览器里跑的是同一份代码） ---------- */
const store = {};
global.window = global;
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
global.location = { protocol: 'file:' };
const nativeFetch = global.fetch;                             /* 保留原生 fetch：后面要真发 HTTP */
global.fetch = () => Promise.reject(new Error('offline'));     /* 仅在加载内核时屏蔽配置探测 */
['assets/js/data.js', 'assets/js/core/config.js', 'assets/js/core/products.js', 'assets/js/core/prompt.js',
  'assets/js/core/llm.js', 'assets/js/core/eval.js']
  .forEach(function (rel) { vm.runInThisContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel }); });
global.fetch = nativeFetch;                                   /* 恢复真实网络能力 */

const HP = global.HP;
const E = HP.Eval;
const cfg = HP.Config.get();
const NEWS = global.MOCK.NEWS;
const products = cfg.products.slice(0, 3);
const material = E.materialFrom(NEWS[0], products, {
  style: cfg.styles[0], tone: cfg.tones[0].name, tags: NEWS[0].topics.slice(0, 2)
});

/* ---------- 真实模型检测 ---------- */
function detectRealModel() {
  const env = process.env;
  if (env.HOTPULSE_API_KEY) return { provider: '自定义（环境变量 HOTPULSE_API_KEY）', baseUrl: env.HOTPULSE_BASE_URL || 'https://api.deepseek.com/v1', model: env.HOTPULSE_MODEL || 'deepseek-chat', key: env.HOTPULSE_API_KEY };
  if (env.DEEPSEEK_API_KEY) return { provider: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', key: env.DEEPSEEK_API_KEY };
  if (env.DASHSCOPE_API_KEY) return { provider: '阿里通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', key: env.DASHSCOPE_API_KEY };
  if (env.MOONSHOT_API_KEY) return { provider: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', key: env.MOONSHOT_API_KEY };
  if (env.ZHIPU_API_KEY) return { provider: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', key: env.ZHIPU_API_KEY };
  return null;
}

(async function run() {
  const real = detectRealModel();
  const stub = spawn('node', [path.join(__dirname, 'stub-provider.js'), String(STUB_PORT)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900));

  /* ================= 验收 1 ================= */
  console.log('\n================ 验收 1：完整跑一轮评测（汇总 / 明细 / 叫停） ================');
  const cases = NEWS.slice(0, 3).map(function (n, i) {
    var prods = ((global.MOCK.MATCH_MAP[n.id] || []).slice(0, 2).map(function (m) {
      return cfg.products.filter(function (p) { return p.id === m.pid; })[0];
    })).filter(Boolean);
    return {
      id: 'a1_' + n.id, name: n.title.slice(0, 14),
      news: n, products: prods.length ? prods : cfg.products.slice(0, 2),
      tags: (n.topics || []).slice(0, 2), tone: cfg.tones[i % cfg.tones.length].name, emojiLevel: 1
    };
  });
  const styles = cfg.styles.slice(0, 2);

  if (real) {
    console.log('· 检测到真实模型密钥：' + real.provider + ' / ' + real.model + '（走真实 API）');
    Object.assign(HP.Config.get().model, {
      mode: 'direct', baseUrl: real.baseUrl, model: real.model, apiKey: real.key, temperature: 0.85, priceIn: 0.001, priceOut: 0.002
    });
    results.numbers['模型'] = real.provider + ' / ' + real.model + '（真实 API）';
  } else {
    console.log('· 本机没有配置任何模型密钥 → 用本机 OpenAI 兼容服务端跑真实 HTTP 链路（模型名 stub-model）');
    Object.assign(HP.Config.get().model, {
      mode: 'direct', baseUrl: 'http://127.0.0.1:' + STUB_PORT + '/v1', model: 'stub-model',
      apiKey: 'sk-good-acceptance', temperature: 0.85, priceIn: 0.15, priceOut: 0.6
    });
    results.numbers['模型'] = '本地 OpenAI 兼容服务端 stub-model（真实 HTTP 链路；本机无密钥）';
  }

  const t0 = Date.now();
  const one = await E.runEval({
    cases: cases, styles: styles, repeats: 1, concurrency: 2,
    enableReview: true, weights: { machine: 0.5, review: 0.5 },
    autoRework: true, maxReworkRounds: 2, fastMock: true
  });
  const wallMs = Date.now() - t0;
  const done = one.results.filter(function (r) { return r.status === 'done'; });
  const recomputedAvg = num(done.reduce(function (s, r) { return s + r.totalScore; }, 0) / done.length);
  const recomputedForbidden = done.reduce(function (s, r) { return s + r.machine.counts.forbidden; }, 0);
  const recomputedFake = done.reduce(function (s, r) { return s + r.machine.counts.fakePrice; }, 0);
  const recomputedTokens = done.reduce(function (s, r) { return s + (r.tokens.input + r.tokens.output); }, 0);
  check('任务数 = 用例 × 风格 × 重复', one.results.length === 6, cases.length + ' 用例 × ' + styles.length + ' 风格 = ' + one.results.length + ' 条');
  check('汇总的平均总分与明细逐条重算一致',
    done.length > 0 && Math.abs(recomputedAvg - one.summary.avgScore) < 0.11,
    '明细重算 ' + recomputedAvg + ' = 汇总 ' + one.summary.avgScore + '（成功 ' + done.length + ' 条）');
  check('汇总的违禁词 / 编造价格命中数与明细一致',
    recomputedForbidden === one.summary.forbiddenHits && recomputedFake === one.summary.fakePriceCount,
    '违禁词 ' + one.summary.forbiddenHits + ' 个、编造价格 ' + one.summary.fakePriceCount + ' 个');
  check('汇总的 tokens 与明细一致',
    recomputedTokens === one.summary.tokens,
    '明细 ' + recomputedTokens + ' = 汇总 ' + one.summary.tokens + ' tokens');
  check('每条明细都带文案 + 8 项校验 + 评审四维',
    done.every(function (r) { return r.copy && r.machine.items.length === 8 && (!r.review || r.review.ok || r.review.reason); }),
    done.length ? ('示例：' + done[0].caseName + '｜机器 ' + done[0].machine.score + '｜评审 ' +
      (done[0].review && done[0].review.ok ? done[0].review.avg + '/5' : '未完成')) : '没有成功记录');
  check('真实调用产生了耗时与消耗数据', done.every(function (r) { return r.latencyMs > 0 && (r.tokens.input + r.tokens.output) > 0; }),
    '单条耗时 ' + done.map(function (r) { return r.latencyMs; }).join('/') + ' ms；合计 ' + one.summary.tokens + ' tokens，' +
    '花费 ¥' + one.summary.cost + '；本轮墙钟 ' + wallMs + ' ms');
  console.log('  · 本轮实测：平均总分 ' + one.summary.avgScore + '，通过率 ' + one.summary.machinePassRate +
    '%，评审均分 ' + one.summary.reviewAvg + '，违禁词 ' + one.summary.forbiddenHits +
    '，编造价格 ' + one.summary.fakePriceCount + '，' + one.summary.tokens + ' tokens，' + one.summary.elapsedMs + ' ms');
  results.numbers['验收1-本轮汇总'] = one.summary;

  /* 叫停：并发 1，计划 6 条，跑到第 3 条时叫停 */
  let seen = 0;
  const stopped = await E.runEval({
    cases: cases, styles: styles, repeats: 2, concurrency: 1, enableReview: false,
    weights: { machine: 0.5, review: 0.5 }, autoRework: false, fastMock: true,
    onProgress: function () { seen++; },
    isStopped: function () { return seen >= 3; }
  });
  check('叫停按钮真能停：不再派发新任务',
    stopped.stopped === true && stopped.summary.completed < 12,
    '计划 12 条，叫停时完成 ' + stopped.summary.completed + ' 条（stopped=' + stopped.stopped + '）');
  results.numbers['验收1-叫停'] = '计划 12 条 → 完成 ' + stopped.summary.completed + ' 条后停止';

  /* ================= 验收 2 ================= */
  console.log('\n================ 验收 2：构造违规文案 → 机器校验全部揪出 ================');
  const LONG = '这段话是为了把字数撑到超过上限而写的，'.repeat(20);
  const violation = '这款冲锋衣是全网最低价，绝对值得买！原价 699 现在只要 ¥66，' + LONG + '\n**限时抢购** 买了不后悔。';
  const mc = E.machineCheck(violation, material);
  const byCode = {};
  mc.items.forEach(function (i) { byCode[i.code] = i; });
  console.log('  · 构造文案：' + violation.replace(/\s+/g, ' ').slice(0, 46) + '…（共 ' + E.charCount(violation) + ' 字）');
  console.log('  · 逐项结果：');
  mc.items.forEach(function (i) {
    console.log('      ' + (i.pass ? '✓' : '✗') + ' ' + i.label + '（' + i.level + '，权重 ' + i.weight + '）：' + i.reason);
  });
  check('字数超标被查出', byCode.words.pass === false,
    byCode.words.reason);
  check('违禁词被查出并列出命中词（硬伤、权重最高）',
    byCode.forbidden.pass === false && byCode.forbidden.hits.length >= 3 && byCode.forbidden.weight === 5,
    '命中：' + byCode.forbidden.hits.join('、') + '（' + byCode.forbidden.level + '，权重 ' + byCode.forbidden.weight + '）');
  check('编造价格被查出并同时列出台账',
    byCode.fakePrice.pass === false && byCode.fakePrice.hits.length >= 2,
    byCode.fakePrice.reason);
  check('另外 5 项（话题 / 表情 / 互动 / 排版 / 商品）也逐条给出结论',
    ['tags', 'emoji', 'cta', 'format', 'product'].every(function (c) { return !!byCode[c]; }),
    ['tags', 'emoji', 'cta', 'format', 'product'].map(function (c) { return byCode[c].label + (byCode[c].pass ? '✓' : '✗'); }).join('、'));
  check('命中硬伤 → hardFail，且给出加权总分', mc.hardFail === true,
    '加权总分 ' + mc.score + ' / 100，未通过 ' + mc.failed.length + ' 项');
  results.numbers['验收2-违规文案'] = {
    字数: byCode.words.value, 违禁词: byCode.forbidden.hits, 编造价格: byCode.fakePrice.hits, 机器分: mc.score
  };

  /* ================= 验收 3 ================= */
  console.log('\n================ 验收 3：一键修正（一轮修好 / 改差了保留上一版） ================');
  const fix = await E.autoRework({
    copy: violation, material: material, maxRounds: 2,
    meta: { products: products, materialText: material.text }
  });
  console.log('  · 返工轨迹：');
  fix.rounds.forEach(function (r) {
    console.log('      第 ' + r.round + ' 轮' + (r.accepted ? '【采纳】' : '【驳回】') +
      ' 修好：' + (r.fixed.join('、') || '无') + '；剩余：' + (r.remaining.join('、') || '无') + '　' + r.note);
  });
  check('一键修正：一轮之内分数明显提升',
    fix.improved === true && fix.rounds[0].accepted === true,
    '机器分 ' + fix.before + ' → ' + fix.after + '（第 1 轮即采纳）');
  check('说清了修好了哪些问题',
    fix.rounds[0].fixed.length >= 3,
    '第 1 轮修好：' + fix.rounds[0].fixed.join('、') + '；仍未解决：' + (fix.rounds[fix.rounds.length - 1].remaining.join('、') || '无'));
  check('硬伤（违禁词 / 编造价格）在两轮内清零',
    fix.check.items.filter(function (i) { return i.code === 'forbidden' || i.code === 'fakePrice'; })
      .every(function (i) { return i.pass; }),
    '违禁词 ' + fix.check.counts.forbidden + ' 个、编造价格 ' + fix.check.counts.fakePrice + ' 个（修正后）');
  const worse = await E.autoRework({
    copy: violation, material: material, maxRounds: 1,
    meta: { products: products, materialText: material.text },
    llm: function () {
      return Promise.resolve({ ok: true, mode: 'mock', model: 'fake-worse', text: '**绝对全网最低** ¥99999\n' + violation, usage: { inputTokens: 1, outputTokens: 1 } });
    }
  });
  check('改差了自动保留上一版（不采纳更差的）',
    worse.text === violation && worse.rounds[0].accepted === false,
    worse.rounds[0].note);
  results.numbers['验收3-一键修正'] = fix.before + ' → ' + fix.after + '；第 1 轮修好 ' + fix.rounds[0].fixed.join('、');
  results.numbers['验收3-改差保护'] = worse.rounds[0].note;

  /* ================= 验收 4 ================= */
  console.log('\n================ 验收 4：返工关闭 vs 开启的通过率对比 ================');
  /* 用"软规范 + 没有价格死约束"让模型每一条都产出违规文案（原本必须转人工） */
  const softCfg = JSON.parse(JSON.stringify(cfg));
  softCfg.prompt.rules = ['写成微博风格，篇幅控制在 60–320 字之间。', '包含话题标签。'];
  softCfg.prompt.example = '';
  softCfg.evalConfig = Object.assign({}, softCfg.evalConfig, { enableReview: false, weights: { machine: 1, review: 0 } });

  const reworkCases = NEWS.slice(0, 4).map(function (n, i) {
    var prods = ((global.MOCK.MATCH_MAP[n.id] || []).slice(0, 2).map(function (m) {
      return cfg.products.filter(function (p) { return p.id === m.pid; })[0];
    })).filter(Boolean);
    return {
      id: 'a4_' + n.id, name: n.title.slice(0, 12),
      news: n, products: prods.length ? prods : cfg.products.slice(0, 2),
      tags: (n.topics || []).slice(0, 2), tone: cfg.tones[i % cfg.tones.length].name, emojiLevel: 1
    };
  });

  HP.Config.get().model.mode = 'mock';
  const baseline = await E.runEval({
    cases: reworkCases, styles: cfg.styles.slice(0, 2), repeats: 1, concurrency: 3,
    enableReview: false, weights: { machine: 1, review: 0 },
    autoRework: false, fastMock: true, config: softCfg
  });
  const reworked = await E.runEval({
    cases: reworkCases, styles: cfg.styles.slice(0, 2), repeats: 1, concurrency: 3,
    enableReview: false, weights: { machine: 1, review: 0 },
    autoRework: true, maxReworkRounds: 3, fastMock: true, config: softCfg
  });
  const basePass = baseline.results.filter(function (r) { return r.machine.pass; }).length;
  const reworkPass = reworked.results.filter(function (r) { return r.machine.pass; }).length;
  const improved = reworked.results.filter(function (r) { return r.rework && r.rework.improved; }).length;
  check('基线（不返工）：违规输出基本都要转人工',
    basePass <= baseline.results.length * 0.2,
    '通过 ' + basePass + ' / ' + baseline.results.length + ' 条（通过率 ' + baseline.summary.machinePassRate + '%）');
  check('开启返工后：大部分自动通过',
    reworkPass >= Math.ceil(reworked.results.length * 0.6),
    '通过 ' + reworkPass + ' / ' + reworked.results.length + ' 条（通过率 ' + reworked.summary.machinePassRate + '%）');
  check('返工确实提升了每条的机器分',
    reworked.summary.avgScore > baseline.summary.avgScore,
    '平均总分 ' + baseline.summary.avgScore + ' → ' + reworked.summary.avgScore +
    '（其中 ' + improved + ' 条因返工提分）');
  console.log('  · 逐条对比（机器分 / 是否通过 / 返工轮次）：');
  baseline.results.forEach(function (b, i) {
    var r = reworked.results.filter(function (x) { return x.key === b.key; })[0] || {};
    console.log('      ' + b.caseName + ' · ' + b.style + '：' + b.machine.score +
      (b.machine.pass ? '（过）' : '（不过）') + ' → ' + (r.machine ? r.machine.score : '?') +
      (r.machine && r.machine.pass ? '（过）' : '（不过）') +
      '，返工 ' + (r.rework ? r.rework.acceptedRounds : 0) + ' 轮');
  });
  results.numbers['验收4-返工对比'] = {
    基线通过: basePass + '/' + baseline.results.length,
    返工后通过: reworkPass + '/' + reworked.results.length,
    平均分: baseline.summary.avgScore + ' → ' + reworked.summary.avgScore
  };

  /* ================= 验收 5 ================= */
  console.log('\n================ 验收 5：改一次提示词跑两轮 → 对比视图指出差异与变差用例 ================');
  const goodCfg = JSON.parse(JSON.stringify(cfg));
  goodCfg.prompt.rules = [
    '写完自己数一遍，超出 {{字数上限}} 字就删，宁可少写一个卖点也不能超；也不要少于 {{字数下限}} 字。',
    '金额只能原样使用素材里给出的数字；素材没给的价格、折扣、销量、库存一律不许出现。',
    '必须包含素材给出的话题标签，且全文话题总数不超过 {{话题标签上限}} 个。',
    '结尾必须有一句互动引导（引导读者评论、留言或私信）。'
  ];
  const runOne = await E.runEval({
    cases: reworkCases, styles: cfg.styles.slice(0, 2), repeats: 1, concurrency: 3,
    enableReview: false, weights: { machine: 1, review: 0 }, autoRework: false, fastMock: true, config: softCfg
  });
  /* 第二轮：把软规范改成硬要求（预期整体变好） */
  const runTwo = await E.runEval({
    cases: reworkCases, styles: cfg.styles.slice(0, 2), repeats: 1, concurrency: 3,
    enableReview: false, weights: { machine: 1, review: 0 }, autoRework: false, fastMock: true, config: goodCfg
  });
  const cmpUp = E.compareRuns(
    { summary: runOne.summary, results: runOne.results, promptSnapshot: softCfg.prompt },
    { summary: runTwo.summary, results: runTwo.results, promptSnapshot: goodCfg.prompt }
  );
  const upRow = cmpUp.metrics.filter(function (m) { return m.label === '总分'; })[0];
  const upFake = cmpUp.metrics.filter(function (m) { return m.label === '编造价格数'; })[0];
  check('改好提示词后：总分上涨、编造价格归零（绿色 ↑）',
    upRow.delta > 0 && upRow.better === true && upFake.delta < 0,
    '总分 ' + upRow.a + ' → ' + upRow.b + '（↑' + upRow.delta + '）；编造价格 ' + upFake.a + ' → ' + upFake.b);
  check('说明了两次运行的提示词差在哪',
    cmpUp.promptDiff.length >= 1 && cmpUp.promptDiff[0].label === '写作规范',
    cmpUp.promptDiff[0].label + '：' + cmpUp.promptDiff[0].aLen + ' 字 → ' + cmpUp.promptDiff[0].bLen + ' 字');
  check('改好的这一轮：没有用例变差', cmpUp.worse.length === 0, '变差 ' + cmpUp.worse.length + ' 条');

  /* 第三轮：在好规范上再改一次，并构造"第 2 条用例反而变差"的回归 */
  const regressCfg = JSON.parse(JSON.stringify(goodCfg));
  regressCfg.prompt.rules = goodCfg.prompt.rules.concat(['结尾再加一句互动引导，语气自然一些。']);
  const originalCall = HP.LLM.call;
  HP.LLM.call = function (o) {
    var isSecondCase = o.meta && o.meta.news && o.meta.news.id === reworkCases[1].news.id;
    if (isSecondCase) {
      return originalCall(o).then(function (r) {
        if (!r.ok) return r;
        /* 让这条用例真的变差：塞一个素材里没有的金额 → 编造价格（硬伤） */
        return Object.assign({}, r, { text: r.text + '\n\n（本次改动后这条用例把价格写成了 ¥999，素材里并没有这个金额。）' });
      });
    }
    return originalCall(o);
  };
  const runThree = await E.runEval({
    cases: reworkCases, styles: cfg.styles.slice(0, 2), repeats: 1, concurrency: 3,
    enableReview: false, weights: { machine: 1, review: 0 }, autoRework: false, fastMock: true, config: regressCfg
  });
  HP.LLM.call = originalCall;
  const cmp = E.compareRuns(
    { summary: runTwo.summary, results: runTwo.results, promptSnapshot: goodCfg.prompt },
    { summary: runThree.summary, results: runThree.results, promptSnapshot: regressCfg.prompt }
  );
  const scoreRow = cmp.metrics.filter(function (m) { return m.label === '总分'; })[0];
  const fakeRow = cmp.metrics.filter(function (m) { return m.label === '编造价格数'; })[0];
  check('这次改动让整体变差：总分下降（红色 ↓）、编造价格上升',
    scoreRow.delta < 0 && scoreRow.better === false && fakeRow.delta > 0,
    '总分 ' + scoreRow.a + ' → ' + scoreRow.b + '（↓' + Math.abs(scoreRow.delta) + '）；编造价格 ' + fakeRow.a + ' → ' + fakeRow.b);
  check('能指出哪些用例变差了（构造了第 2 条用例变差）',
    cmp.worse.length >= 1,
    '变差 ' + cmp.worse.length + ' 条：' + cmp.worse.map(function (w) {
      return w.caseName + '·' + w.style + '（' + w.a + ' → ' + w.b + '）';
    }).join('；'));
  console.log('  · 逐条用例分数对比：');
  cmp.perCase.forEach(function (p) {
    console.log('      ' + (p.worse ? '【变差】' : '      ') + p.caseName + ' · ' + p.style + '：' + p.a + ' → ' + p.b +
      '（' + (p.delta > 0 ? '+' : '') + p.delta + '）');
  });
  results.numbers['验收5-改善对比'] = '总分 ' + upRow.a + ' → ' + upRow.b + '（↑' + upRow.delta + '），变差 0 条';
  results.numbers['验收5-变差对比'] = '总分 ' + scoreRow.a + ' → ' + scoreRow.b + '（↓' + Math.abs(scoreRow.delta) + '），变差 ' + cmp.worse.length + ' 条';

  stub.kill();
  await new Promise(r => setTimeout(r, 200));
  results.finishedAt = new Date().toISOString();
  results.pass = pass;
  results.fail = fail;
  fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'work', 'acceptance-results.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log('\n================ 验收汇总 ================');
  console.log('通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/acceptance-results.json');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('验收脚本异常：', e); process.exit(2); });
