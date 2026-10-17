/* 提示词与模板内核实测（Node，零依赖）
   覆盖：占位符渲染 / 嵌套商品清单 / 未知占位符原样保留 / 编译结果 / 模拟模型是否照规范办事
   运行：node tests/prompt-tests.js */
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

/* 浏览器环境垫片 */
const store = {};
global.window = global;
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
global.window.localStorage = global.localStorage;
global.location = { protocol: 'file:' };
global.fetch = () => Promise.reject(new Error('offline'));

['assets/js/data.js', 'assets/js/core/config.js', 'assets/js/core/prompt.js', 'assets/js/core/llm.js']
  .forEach(function (rel) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel });
  });

const HP = global.HP;
const cfg = HP.Config.get();

function sample() {
  const s = HP.Prompt.sampleList()[0];
  return { news: s.news, products: s.products.slice(0, 3) };
}
function compileWith(patch) {
  const s = sample();
  const c = JSON.parse(JSON.stringify(cfg));
  if (patch) patch(c);
  return HP.Prompt.compile(s.news, s.products, {
    style: (c.styles || [{ name: '热点借势', requirement: '' }])[0],
    tone: (c.tones || [{ name: '热点借势' }])[0].name,
    tags: (s.news.topics || []).slice(0, 2), emojiLevel: 1, extra: ''
  }, c);
}

(async function run() {
  console.log('== 1. 占位符渲染 ==');
  const r1 = HP.Prompt.render('标题：{{热点标题}}；未知：{{我写错了}}', { '热点标题': '冷空气来袭' });
  check('未知占位符原样保留（不变成空白）', r1.text === '标题：冷空气来袭；未知：{{我写错了}}', r1.text);
  check('未知占位符被记录，便于提示运营', r1.unknown.indexOf('我写错了') > -1, JSON.stringify(r1.unknown));

  const r2 = HP.Prompt.render('A{{ 热点标题 }}B', { '热点标题': 'X' });
  check('占位符内部有空格也能识别', r2.text === 'AXB', r2.text);

  console.log('\n== 2. 嵌套：商品清单按单件格式逐件渲染后拼接 ==');
  const s2 = sample();
  const ctx2 = HP.Prompt.contextFrom(s2.news, s2.products, { tags: (s2.news.topics || []).slice(0, 2) });
  const productsBlock = HP.Prompt.render('{{商品清单}}', ctx2).text;
  const lines = productsBlock.split('\n').filter(l => l.trim());
  check('商品清单渲染出与商品数量一致的行数', lines.length === s2.products.length, '商品 ' + s2.products.length + ' 件 → 渲染 ' + lines.length + ' 行');
  check('每件商品都按单件格式带上了序号与价格',
    /^1\./.test(lines[0]) && lines[0].indexOf('¥' + s2.products[0].price) > -1,
    lines[0].slice(0, 70));
  check('嵌套渲染时不会把内层占位符漏在外面',
    lines.every(l => l.indexOf('{{') === -1), lines.some(l => l.indexOf('{{') > -1) ? '仍有未渲染占位符' : '无残留');

  const custom = JSON.parse(JSON.stringify(cfg));
  custom.prompt.productTemplate = '【{{序号}}】{{图标}}{{商品名称}} / {{售价}}→{{原价}} / {{卖点列表}}';
  const s3 = sample();
  const ctx3 = HP.Prompt.contextFrom(s3.news, s3.products, {}, custom);
  const block3 = HP.Prompt.render('{{商品清单}}', ctx3).text.split('\n');
  check('改成自定义单件格式后立即按新格式渲染',
    block3[0].indexOf('【1】') === 0 && block3[0].indexOf('→') > -1, block3[0].slice(0, 60));

  console.log('\n== 3. 编译给模型的两块内容 ==');
  const compiled = compileWith();
  check('规范块包含角色设定与写作规范', compiled.system.indexOf('电商媒体') > -1 && compiled.system.indexOf('【写作规范】') > -1,
    '规范块 ' + compiled.stats.systemChars + ' 字');
  check('写作规范逐条编号', /1\.\s/.test(compiled.system) && /3\.\s/.test(compiled.system), compiled.system.split('\n').slice(2, 5).join(' / ').slice(0, 80));
  check('规范里的占位符会被填上（字数区间）', compiled.system.indexOf('{{') === -1,
    compiled.unknown.length ? '未识别：' + compiled.unknown.join('、') : '无未识别占位符');
  check('素材块是拼装好的内容', compiled.material.indexOf(s2.news.title) > -1 && compiled.material.indexOf('¥') > -1,
    '素材块 ' + compiled.stats.materialChars + ' 字');
  out.numbers['规范块字数'] = compiled.stats.systemChars;
  out.numbers['素材块字数'] = compiled.stats.materialChars;

  const compiledBad = compileWith(function (c) { c.prompt.materialTemplate += '\n{{这个占位符不存在}}'; });
  check('模板写错占位符：编译结果原样保留并报告',
    compiledBad.material.indexOf('{{这个占位符不存在}}') > -1 && compiledBad.unknown.indexOf('这个占位符不存在') > -1,
    '未知占位符：' + compiledBad.unknown.join('、'));

  const compiledNewRule = compileWith(function (c) {
    c.prompt.rules = c.prompt.rules.concat(['结尾必须以提问结尾，让读者愿意在评论区回答。']);
  });
  check('改一句写作规范，编译结果的规范块立即变化',
    compiledNewRule.system !== compiled.system && compiledNewRule.system.indexOf('结尾必须以提问结尾') > -1,
    '规范块字数 ' + compiled.stats.systemChars + ' → ' + compiledNewRule.stats.systemChars);

  console.log('\n== 4. 模拟模型是否照规范办事 ==');
  const base = await HP.LLM.call({ system: compiled.system, user: compiled.material, mode: 'mock', meta: Object.assign({ system: compiled.system, user: compiled.material, limits: cfg.limits }, s2, { style: cfg.styles[0], tone: cfg.tones[0].name, emojiLevel: 1 }) });
  check('模拟模型返回文案', base.ok && base.text.length > 20, '长度 ' + HP.Prompt.charCount(base.text) + ' 字，模型 ' + base.model);
  check('输出的金额全部来自素材（没有编造价格）', (base.text.match(/(?:¥|￥)\s*\d+(?:\.\d+)?/g) || []).every(function (m) {
    return HP.Prompt.amountsOf(s2.products).indexOf(Number(String(m).replace(/[¥￥\s]/g, ''))) > -1;
  }), '素材可用金额：' + HP.Prompt.amountsOf(s2.products).join('、'));

  const askRule = compileWith(function (c) { c.prompt.rules = c.prompt.rules.concat(['结尾必须以提问结尾。']); });
  const askOut = await HP.LLM.call({
    system: askRule.system, user: askRule.material, mode: 'mock',
    meta: Object.assign({ system: askRule.system, user: askRule.material, limits: cfg.limits }, s2, { style: cfg.styles[0], tone: cfg.tones[0].name, emojiLevel: 1 })
  });
  check('新增「结尾必须以提问结尾」后，生成结果真的以问句收尾',
    /[？?]\s*$/.test(askOut.text.trim()), '结尾：…' + askOut.text.trim().slice(-18));
  out.numbers['新增规范前结尾'] = base.text.trim().slice(-14);
  out.numbers['新增规范后结尾'] = askOut.text.trim().slice(-14);

  const shortRule = compileWith(function (c) { c.prompt.rules = c.prompt.rules.concat(['篇幅不要超过 120 字。']); });
  const shortOut = await HP.LLM.call({
    system: shortRule.system, user: shortRule.material, mode: 'mock',
    meta: Object.assign({ system: shortRule.system, user: shortRule.material, limits: cfg.limits }, s2, { style: cfg.styles[0], tone: cfg.tones[0].name, emojiLevel: 1 })
  });
  const shortLen = HP.Prompt.charCount(shortOut.text);
  check('把规范改成「不超过 120 字」后，输出被压到 120 字内', shortLen <= 120,
    '实际 ' + shortLen + ' 字（原默认上限 ' + cfg.limits.maxWords + ' 字）');
  out.numbers['限字数后实际字数'] = shortLen;

  const noExRule = compileWith(function (c) { c.prompt.rules = c.prompt.rules.concat(['不要出现感叹号。']); });
  const noExOut = await HP.LLM.call({
    system: noExRule.system, user: noExRule.material, mode: 'mock',
    meta: Object.assign({ system: noExRule.system, user: noExRule.material, limits: cfg.limits }, s2, { style: cfg.styles[0], tone: cfg.tones[0].name, emojiLevel: 2 })
  });
  check('新增「不要出现感叹号」后，输出确实没有感叹号', noExOut.text.indexOf('！') === -1,
    '感叹号出现次数：' + (noExOut.text.match(/！/g) || []).length);

  const noEmojiRule = compileWith(function (c) { c.prompt.rules = c.prompt.rules.concat(['不要使用 emoji。']); });
  const noEmojiOut = await HP.LLM.call({
    system: noEmojiRule.system, user: noEmojiRule.material, mode: 'mock',
    meta: Object.assign({ system: noEmojiRule.system, user: noEmojiRule.material, limits: cfg.limits }, s2, { style: cfg.styles[0], tone: cfg.tones[0].name, emojiLevel: 2 })
  });
  check('新增「不要使用 emoji」后，输出没有表情符号',
    (noEmojiOut.text.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length === 0,
    '表情数量 ' + (noEmojiOut.text.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length);

  console.log('\n== 5. 单件格式错误占位符不影响主流程 ==');
  const badProductTpl = compileWith(function (c) { c.prompt.productTemplate = '{{商品名称}}｜{{不存在的字段}}'; });
  check('单件格式里的未知占位符原样保留在素材里',
    badProductTpl.material.indexOf('{{不存在的字段}}') > -1, badProductTpl.material.split('\n').filter(l => l.indexOf('｜') > -1)[0]);

  console.log('\n== 6. 多个创作风格产出可区分的候选版本 ==');
  const styles = cfg.styles.slice(0, 4);
  const outs = [];
  for (const st of styles) {
    const cp = compileWith(function (c) { c.styles = [st]; });
    const one = await HP.LLM.call({
      system: cp.system, user: cp.material, mode: 'mock',
      meta: Object.assign({ system: cp.system, user: cp.material, limits: cfg.limits }, s2, { style: st, tone: cfg.tones[0].name, emojiLevel: 1 })
    });
    outs.push({ style: st.name, text: one.text });
  }
  const uniq = new Set(outs.map(o => o.text.replace(/\s/g, '')));
  check('每个风格都产出了一版文案', outs.length === 4, outs.map(o => o.style).join('、'));
  check('不同风格的文案内容确实不同', uniq.size === outs.length,
    '4 个风格 → ' + uniq.size + ' 种不同文案；示例开头：' + outs.map(o => o.text.split('\n')[0].slice(0, 14)).join(' ｜ '));
  out.numbers['风格区分度'] = uniq.size + '/4 各不相同';

  out.finishedAt = new Date().toISOString();
  out.pass = pass; out.fail = fail;
  fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'work', 'prompt-test-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/prompt-test-results.json');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常：', e); process.exit(2); });
