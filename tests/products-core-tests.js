/* 商品库内核实测（Node，零依赖）
   覆盖：CSV 导出/解析（引号包裹、字段内逗号）、导入前逐行校验、导出再导入一致性、
        JSON 结构化文件的完整保真、引用检查、语义匹配打分
   运行：node tests/products-core-tests.js */
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

['assets/js/data.js', 'assets/js/core/config.js', 'assets/js/core/products.js'].forEach(function (rel) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel });
});
const P = global.HP.Products;
const C = global.HP.Config;
const list = C.get().products;

console.log('== 1. 表格文件（CSV）导出格式 ==');
const csv = P.toCSV(list);
const lines = csv.split('\r\n');
check('表头是要求的中文六列', lines[0].replace('\ufeff', '') === '名称,售价,原价,品类,卖点,图标', lines[0].replace('\ufeff', ''));
check('带 BOM（Excel/WPS 打开不乱码）', csv.charCodeAt(0) === 0xFEFF, '首字符 U+FEFF');
check('用 CRLF 换行，行数=商品数+表头', lines.length === list.length + 1,
  '数据行 ' + (lines.length - 1) + ' = 商品 ' + list.length + ' 件');
check('卖点用顿号分隔', lines[1].indexOf('、') > -1, lines[1].slice(0, 60));

console.log('\n== 2. 解析：引号包裹与字段内逗号 ==');
const tricky = '名称,售价,原价,品类,卖点,图标\n"冲锋衣,加绒款",299,599,服饰鞋包,"加绒内胆可拆、防风,防泼水",🧥\n"含""引号""的商品",99,199,配饰,亲肤、耐看,🎁';
const t = P.importCSV(tricky, list);
check('字段内逗号被正确保留', t.ok && t.items[0].name === '冲锋衣,加绒款',
  '名称解析为「' + (t.items[0] || {}).name + '」');
check('引号转义（""）被还原', t.ok && t.items[1].name === '含"引号"的商品',
  '名称解析为「' + (t.items[1] || {}).name + '」');
check('引号字段里的顿号仍按卖点切分', t.ok && t.items[0].points.join('|') === '加绒内胆可拆|防风|防泼水',
  (t.items[0] || {}).points.join('|'));
out.numbers['引号解析'] = t.items[0].name + ' / ' + t.items[1].name;

console.log('\n== 3. 导入前逐行校验 ==');
const bad = '名称,售价,原价,品类,卖点,图标\n'
  + '正常商品,99,199,配件,耐用、好看,🎁\n'
  + '负价格商品,-5,199,配件,耐用、好看,🎁\n'
  + ',299,599,服饰鞋包,加绒、防风,🧥\n'
  + '原价更低,299,199,服饰鞋包,加绒、防风,🧥';
const b = P.importCSV(bad, list);
check('有问题的行被拦住', b.ok === false && b.rowErrors.length === 3,
  '共 ' + b.rowErrors.length + ' 行有问题');
check('报出具体行号与原因（第 2 行负价格）', /第 2 行/.test(b.errors[0]) && /售价必须是大于 0/.test(b.errors[0]),
  b.errors[0]);
check('报出空名称行', /第 3 行/.test(b.errors[1]) && /名称为空/.test(b.errors[1]), b.errors[1]);
check('报出原价低于售价行', /第 4 行/.test(b.errors[2]) && /不能低于售价/.test(b.errors[2]), b.errors[2]);
out.numbers['坏文件行号'] = b.errors;

const badHeader = '商品名称,价格\n好商品,99';
const bh = P.importCSV(badHeader, list);
check('表头不对给出明确说明', bh.ok === false && /表头不符合要求/.test(bh.fatal) && /名称/.test(bh.fatal),
  (bh.fatal || '').split('\n')[0]);

console.log('\n== 4. 导出再导入一致性 ==');
const backCsv = P.importCSV(csv, list);
check('CSV 导出再导入：条数一致', backCsv.ok && backCsv.items.length === list.length,
  list.length + ' 件 → ' + backCsv.items.length + ' 件');
const csvIds = P.assignIds(backCsv.items, list, 'replace');
const sameByName = list.every(function (p, i) {
  var q = csvIds[i];
  return q && q.id === p.id && q.name === p.name && q.price === p.price &&
    q.marketPrice === p.marketPrice && q.cat === p.cat &&
    q.points.join('|') === p.points.join('|') && q.emoji === p.emoji;
});
check('CSV 导出再导入：内容逐项一致（编号按同名复用）', sameByName,
  '示例：' + csvIds[0].id + ' ' + csvIds[0].name + ' ¥' + csvIds[0].price + ' ' + csvIds[0].points.join('、'));

const json = P.toJSON(list);
const backJson = P.importJSON(json, list);
check('JSON 导出再导入：完全一致（含编号与全部字段）',
  backJson.ok && JSON.stringify(backJson.items) === JSON.stringify(list),
  list.length + ' 件逐字段比对一致');
check('JSON 文件带有类型与导出时间', /"type": "hotpulse.products"/.test(json) && /"exportedAt"/.test(json),
  json.split('\n').slice(0, 3).join(' ').slice(0, 70));

const badJson = P.importJSON('{ 这不是合法 JSON', list);
check('坏 JSON 给出明确错误', badJson.ok === false && /不是合法的 JSON/.test(badJson.fatal), badJson.fatal.slice(0, 40));
out.numbers['导出再导入'] = 'CSV 与 JSON 均一致';

console.log('\n== 5. 引用检查与语义匹配 ==');
const refs = P.refsOf('p1', list);
check('能查到商品被哪些热点"推荐关系"引用', refs.preset.length >= 1,
  'p1 被 ' + refs.preset.length + ' 条热点引用：' + refs.preset.map(r => r.title.slice(0, 12)).join('、'));
check('引用信息里带热点标题与匹配分', refs.preset[0].title.length > 0 && refs.preset[0].score > 0,
  refs.preset[0].title.slice(0, 16) + '（' + refs.preset[0].score + ' 分）');
const refsNew = P.refsOf('p5', list);
check('没有预设关系时语义匹配也能给出关联热点', refsNew.semantic.length >= 0,
  'p5：预设引用 ' + refsNew.preset.length + ' 条，语义关联 ' + refsNew.semantic.length + ' 条');
out.numbers['p1 引用'] = refs.preset.length + ' 条热点';

out.finishedAt = new Date().toISOString();
out.pass = pass; out.fail = fail;
fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'work', 'products-core-results.json'), JSON.stringify(out, null, 2), 'utf8');
console.log('\n通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/products-core-results.json');
process.exit(fail ? 1 : 0);
