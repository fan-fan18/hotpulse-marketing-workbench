/* 后台外壳实测脚本（Node，零依赖）
   验证两条验收：
     1) 三级配置读取：没有服务端 → 本机浏览器；有服务端 → 服务端
     2) 服务端读写、自动补齐、写入前备份、空值防线
   运行：node tests/shell-tests.js
   说明：会自己拉起一个临时服务端（端口 8791）来验证"服务端可用"的情况，结束后自动关闭。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 8791;
const BASE = 'http://127.0.0.1:' + PORT;
const out = { startedAt: new Date().toISOString(), checks: [], numbers: {} };
let pass = 0, fail = 0;

function check(name, cond, detail) {
  out.checks.push({ name, ok: !!cond, detail: detail === undefined ? '' : detail });
  if (cond) { pass++; console.log('  ✓ ' + name + '  → ' + detail); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + detail); }
}

/* ---------- 浏览器环境垫片：每个场景一套干净的 localStorage ---------- */
function makeEnv(opts) {
  const store = Object.assign({}, (opts && opts.store) || {});
  const env = {
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
      _store: store
    },
    fetch: (opts && opts.fetch) || (() => Promise.reject(new Error('ECONNREFUSED'))),
    AbortController: global.AbortController,
    location: { protocol: (opts && opts.protocol) || 'file:' }
  };
  return env;
}

function loadConfigModule(env) {
  const sandbox = {
    window: null, localStorage: env.localStorage, fetch: env.fetch,
    AbortController: env.AbortController, location: env.location,
    console, setTimeout, clearTimeout,
    Promise, JSON, Object, Array, String, Number, Date, Math, Error, RegExp, Boolean, parseInt, parseFloat, isNaN
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/data.js'), 'utf8'), ctx, { filename: 'data.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/core/config.js'), 'utf8'), ctx, { filename: 'config.js' });
  return sandbox.HP;
}

/* ---------- 用真实 HTTP 做 fetch 垫片 ---------- */
function realFetch(url, opts) {
  const full = String(url).startsWith('http') ? url : BASE + '/' + String(url).replace(/^\/+/, '');
  return fetch(full, opts);
}

(async function run() {
  console.log('== 后台外壳：三级配置读取实测 ==\n');

  /* ---------- 场景 A：不启动服务端 → 应为「本机浏览器」 ---------- */
  console.log('场景 A：不启动服务端（fetch 直接失败）');
  const envA = makeEnv({});
  const HPA = loadConfigModule(envA);
  const snapA = await HPA.Config.load();
  check('数据来源徽章显示「本机浏览器」', snapA.source === 'local' && snapA.sourceLabel === '本机浏览器',
    'source=' + snapA.source + '，label=' + snapA.sourceLabel + '，级别=' + snapA.sourceLevel + '/3');
  check('本机浏览器配置会自动落一份到 localStorage', !!envA.localStorage._store['hotpulse.config.v1'],
    '存储键 hotpulse.config.v1，长度 ' + String(envA.localStorage._store['hotpulse.config.v1'] || '').length + ' 字节');
  const saveA = await HPA.Config.save(HPA.Config.get());
  check('保存落到「本机浏览器」', saveA.ok && saveA.target === 'local', 'target=' + saveA.targetLabel);
  out.numbers['无服务端来源'] = snapA.sourceLabel;

  /* ---------- 场景 B：浏览器存储不可用 → 应为「内置默认值」 ---------- */
  console.log('\n场景 B：服务端不可用 + 浏览器存储被禁用');
  const HPCB = loadConfigModule({
    localStorage: { getItem() { throw new Error('disabled'); }, setItem() { throw new Error('disabled'); }, removeItem() { throw new Error('disabled'); } },
    fetch: () => Promise.reject(new Error('ECONNREFUSED'))
  });
  const snapB = await HPCB.Config.load();
  check('退回「内置默认值」', snapB.source === 'defaults' && snapB.sourceLabel === '内置默认值',
    'source=' + snapB.source + '，label=' + snapB.sourceLabel);

  /* ---------- 拉起真实服务端 ---------- */
  if (!fs.existsSync(path.join(ROOT, 'server', 'defaults.json'))) {
    require('child_process').execSync('node scripts/gen-defaults.js', { cwd: ROOT });
  }
  console.log('\n启动本地服务端（端口 ' + PORT + '）…');
  const srv = spawn('node', [path.join(ROOT, 'server', 'server.js'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900));

  let health;
  try { health = await (await fetch(BASE + '/api/health')).json(); } catch (e) { health = null; }
  check('服务端健康检查通过', !!(health && health.ok), 'configFile=' + (health && health.configFile));

  /* ---------- 场景 C：服务端可用 → 应为「服务端」 ---------- */
  console.log('\n场景 C：服务端已启动');
  const envC = makeEnv({ fetch: realFetch, protocol: 'http:' });
  const HPC = loadConfigModule(envC);
  const snapC = await HPC.Config.load();
  check('数据来源徽章显示「服务端」', snapC.source === 'server' && snapC.sourceLabel === '服务端',
    'source=' + snapC.source + '，label=' + snapC.sourceLabel + '，级别=' + snapC.sourceLevel + '/3');
  check('服务端返回了自动补齐信息', Array.isArray(snapC.serverFilled), '补齐区块：' + JSON.stringify(snapC.serverFilled));
  out.numbers['有服务端来源'] = snapC.sourceLabel;
  out.numbers['首次读取补齐区块'] = snapC.serverFilled;

  /* ---------- 场景 D：服务端优先于本机浏览器 ---------- */
  const localStore = {};
  localStore['hotpulse.config.v1'] = JSON.stringify({ version: 999, ui: { adminPage: 'local-only' } });
  const envD = makeEnv({ fetch: realFetch, store: localStore, protocol: 'http:' });
  const HPD = loadConfigModule(envD);
  const snapD = await HPD.Config.load();
  check('服务端优先于本机浏览器（服务端在就不用本地那份）', snapD.source === 'server' && snapD.config.version !== 999,
    '本地存的是 version=999，实际读到 version=' + snapD.config.version);

  /* ---------- 保存：写回服务端 + 备份 ---------- */
  console.log('\n保存与备份');
  const draft = JSON.parse(JSON.stringify(HPC.Config.get()));
  draft.ui.adminPage = 'prompts';
  const save1 = await HPC.Config.save(draft);
  check('保存写回服务端', save1.ok && save1.target === 'server', 'target=' + save1.targetLabel + '，savedAt=' + save1.savedAt);

  const draft2 = JSON.parse(JSON.stringify(HPC.Config.get()));
  draft2.ui.adminPage = 'products';
  const save2 = await HPC.Config.save(draft2);
  check('第二次保存写入了上一版的备份', !!(save2.ok && save2.backup), '备份文件：' + save2.backup);

  const backups = await (await fetch(BASE + '/api/config/backups')).json();
  check('备份目录可列出备份', backups.ok && backups.count >= 1, '备份数量 ' + backups.count);
  out.numbers['备份文件数'] = backups.count;

  const reread = await (await fetch(BASE + '/api/config')).json();
  check('重新读取拿到刚保存的值', reread.ok && reread.config.ui.adminPage === 'products',
    'ui.adminPage=' + reread.config.ui.adminPage);

  /* ---------- 空值防线 ---------- */
  console.log('\n写入防线');
  const bad = JSON.parse(JSON.stringify(HPC.Config.get()));
  bad.products = [];
  const putBad = await fetch(BASE + '/api/config', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: bad })
  });
  const badJson = await putBad.json();
  check('商品列表为空时拒绝写入', putBad.status === 400 && badJson.errors.join('').indexOf('商品列表不能为空') > -1,
    'HTTP ' + putBad.status + '：' + badJson.errors.join('；'));
  const afterBad = await (await fetch(BASE + '/api/config')).json();
  check('被拒绝后原配置未受影响', afterBad.config.products.length > 0, '商品仍有 ' + afterBad.config.products.length + ' 件');

  /* ---------- 服务端配置被删掉一段，读取时自动补齐 ---------- */
  const cfgFile = path.join(ROOT, 'data', 'config.json');
  const broken = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  delete broken.tones;
  delete broken.model;
  fs.writeFileSync(cfgFile, JSON.stringify(broken, null, 2), 'utf8');
  const healed = await (await fetch(BASE + '/api/config')).json();
  check('删掉一段后读取时自动补齐',
    healed.ok && Array.isArray(healed.config.tones) && healed.config.tones.length > 0 && !!healed.config.model,
    '补齐的区块：' + JSON.stringify(healed.filled));
  out.numbers['自动补齐区块'] = healed.filled;

  /* ---------- 静态资源可访问（后台页面本体） ---------- */
  const adminRes = await fetch(BASE + '/admin.html');
  const adminHtml = await adminRes.text();
  check('后台页面可被服务端托管', adminRes.status === 200 && adminHtml.indexOf('admin-top') > -1 &&
    adminHtml.indexOf('配置后台') > -1 && adminHtml.indexOf('srcBadge') > -1,
    'HTTP ' + adminRes.status + '，长度 ' + adminHtml.length + ' 字节');
  const cssRes = await fetch(BASE + '/assets/css/admin.css');
  check('后台样式可被服务端托管', cssRes.status === 200, 'HTTP ' + cssRes.status);

  /* 关掉临时服务端，并等它真正退出，避免 Node 在 Windows 上退出时报子进程句柄断言 */
  await new Promise(function (resolve) {
    var done = false;
    srv.once('exit', function () { done = true; resolve(); });
    srv.kill();
    setTimeout(function () { if (!done) resolve(); }, 1500);
  });
  await new Promise(r => setTimeout(r, 200));

  out.finishedAt = new Date().toISOString();
  out.pass = pass;
  out.fail = fail;
  fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'work', 'shell-test-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n================ 汇总 ================');
  console.log('通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/shell-test-results.json');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试脚本异常：', e); process.exit(2); });
