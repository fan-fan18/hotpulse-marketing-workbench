/* 部署自检（Node，零依赖，不需要浏览器）
   覆盖：
     1) 服务端能起来：/api/health、配置 GET/PUT 打通
     2) 静态资源收口：data/ server/ tests/ scripts/ work/ outputs/ 一律 403，前端资源正常 200
     3) 写入防线：商品列表为空、角色设定为空 → 拒绝写入
     4) 写入前备份、备份保留最近 10 份
     5) 读取时缺失区块自动补齐
     6) 目录穿越（%2e%2e）被拦
     7) /api/llm 没有密钥时给人话提示
   运行：node tests/deploy-tests.js
   说明：会先备份并还原 data/config.json，不会改动现有配置 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 8795;
const DATA_DIR = path.join(ROOT, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

const out = { startedAt: new Date().toISOString(), checks: [], numbers: {} };
let pass = 0, fail = 0;
function check(name, cond, detail) {
  out.checks.push({ name, ok: !!cond, detail: detail === undefined ? '' : detail });
  if (cond) { pass++; console.log('  ✓ ' + name + '  → ' + detail); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + detail); }
}

function req(method, p, body, headers) {
  return new Promise(function (resolve) {
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: headers || {} }, function (res) {
      let raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, body: raw }); });
    });
    r.on('error', function (e) { resolve({ status: 0, headers: {}, body: '', error: e.message }); });
    if (body !== undefined && body !== null) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}
const json = r => { try { return JSON.parse(r.body); } catch (e) { return null; } };

function waitHealth(tries) {
  return req('GET', '/api/health').then(function (r) {
    if (r.status === 200) return true;
    if (tries <= 0) return false;
    return new Promise(function (res) { setTimeout(res, 200); }).then(function () { return waitHealth(tries - 1); });
  });
}

/* 测试前后保证用户现有配置不被破坏 */
let savedConfig = null, savedBackups = [];
function snapshot() {
  if (fs.existsSync(CONFIG_FILE)) savedConfig = fs.readFileSync(CONFIG_FILE, 'utf8');
  if (fs.existsSync(BACKUP_DIR)) savedBackups = fs.readdirSync(BACKUP_DIR).map(function (f) { return path.join(BACKUP_DIR, f); });
  if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
  if (fs.existsSync(BACKUP_DIR)) fs.readdirSync(BACKUP_DIR).forEach(function (f) { fs.unlinkSync(path.join(BACKUP_DIR, f)); });
}
function restore() {
  if (savedConfig !== null) fs.writeFileSync(CONFIG_FILE, savedConfig, 'utf8');
  savedBackups.forEach(function (src) {
    try { fs.copyFileSync(src, path.join(BACKUP_DIR, path.basename(src))); } catch (e) {}
  });
}

(async function run() {
  console.log('== 0. 启动服务端 ==');
  snapshot();
  const env = Object.assign({}, process.env);
  delete env.HOTPULSE_API_KEY; delete env.OPENAI_API_KEY; delete env.PORT; delete env.HOST;
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js'), String(PORT)], { cwd: ROOT, env: env });
  let log = '';
  srv.stdout.on('data', function (c) { log += c; });
  srv.stderr.on('data', function (c) { log += c; });

  function stop() { try { srv.kill(); } catch (e) {} }

  try {
    const up = await waitHealth(25);
    check('服务端能启动并响应 /api/health', up, up ? 'http://127.0.0.1:' + PORT + '/api/health 200' : '启动失败：' + log.slice(0, 120));
    if (!up) throw new Error('no server');
    check('启动日志写明监听地址与静态访问收口', /监听地址/.test(log) && /静态访问已收口/.test(log),
      log.split('\n').filter(Boolean).slice(1, 3).join(' / ').trim());

    console.log('\n== 1. 配置读写 ==');
    const h = json(await req('GET', '/api/health'));
    check('/api/health 返回服务名与配置文件路径', h && h.ok && h.name === 'hotpulse-local' && /config\.json$/.test(h.configFile || ''),
      'name=' + (h && h.name) + '，port=' + (h && h.port));

    const newsApi = json(await req('GET', '/api/news'));
    check('GET /api/news 返回热点池（items + runs + stats）',
      newsApi && newsApi.ok && Array.isArray(newsApi.items) && Array.isArray(newsApi.runs) && !!newsApi.stats,
      'items=' + (newsApi.items || []).length + ' runs=' + (newsApi.runs || []).length);

    const g1 = await req('GET', '/api/config');
    const c1 = json(g1);
    const cfg = c1 && c1.config;
    check('首次 GET /api/config 自动落一份完整配置', g1.status === 200 && !!cfg && Array.isArray(cfg.products) && !!cfg.prompt,
      '商品 ' + (cfg ? cfg.products.length : 0) + ' 件、来源 ' + (cfg && cfg.sources ? cfg.sources.length : 0) + ' 个');
    const backupBefore = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).length : 0;
    check('首次运行还没有配置文件时，不谎报"补了区块"', c1 && c1.isNew === true && (c1.filled || []).length === 0,
      'isNew=' + (c1 && c1.isNew) + ' filled=' + JSON.stringify(c1 && c1.filled));

    const edited = JSON.parse(JSON.stringify(cfg));
    edited.model.model = 'gpt-4o-mini-部署自检';
    const put = await req('PUT', '/api/config', { config: edited });
    const pj = json(put);
    check('PUT /api/config 保存成功', put.status === 200 && pj && pj.ok, 'status=' + put.status + ' backup=' + (pj && pj.backup));
    const backupAfter = fs.readdirSync(BACKUP_DIR).length;
    check('第一次写入时磁盘上还没有上一版，不产生空备份', backupAfter === backupBefore && !(pj && pj.backup),
      '备份 ' + backupBefore + ' → ' + backupAfter + ' 份（首次写入，无可备份的上一版）');
    /* 第二次写入起，每次都要把上一版留一份 */
    const edited2 = JSON.parse(JSON.stringify(edited));
    edited2.model.temperature = 0.7;
    const put2 = await req('PUT', '/api/config', { config: edited2 });
    const pj2 = json(put2);
    const backupAfter2 = fs.readdirSync(BACKUP_DIR).length;
    check('写入前把上一版备份到 data/backups', backupAfter2 === backupAfter + 1 && !!(pj2 && pj2.backup),
      '备份 ' + backupAfter + ' → ' + backupAfter2 + ' 份，文件名 ' + (pj2 && pj2.backup));
    const reread = json(await req('GET', '/api/config'));
    check('保存后再读，拿到的是新值', reread.config.model.model === 'gpt-4o-mini-部署自检' && reread.config.model.temperature === 0.7,
      'model=' + reread.config.model.model + '，temperature=' + reread.config.model.temperature);

    console.log('\n== 2. 写入防线（关键内容为空要拒绝） ==');
    const emptyProducts = JSON.parse(JSON.stringify(edited)); emptyProducts.products = [];
    const r1 = await req('PUT', '/api/config', { config: emptyProducts });
    const r1j = json(r1);
    check('商品列表为空时拒绝写入', r1.status === 400 && r1j && r1j.ok === false && /商品列表不能为空/.test((r1j.errors || []).join('')),
      'status=' + r1.status + ' 提示=' + ((r1j && r1j.errors) || []).join('；'));
    const emptyRole = JSON.parse(JSON.stringify(edited)); emptyRole.prompt.role = '   ';
    const r2 = json(await req('PUT', '/api/config', { config: emptyRole }));
    check('角色设定为空时拒绝写入', r2 && r2.ok === false && /角色设定不能为空/.test((r2.errors || []).join('')),
      '提示=' + ((r2 && r2.errors) || []).join('；'));
    const stillOk = json(await req('GET', '/api/config'));
    check('被拒绝的写入没有污染磁盘上的配置', stillOk.config.products.length > 0 && stillOk.config.model.model === 'gpt-4o-mini-部署自检',
      '商品仍是 ' + stillOk.config.products.length + ' 件');

    console.log('\n== 3. 读取时缺失区块自动补齐 ==');
    const cut = JSON.parse(JSON.stringify(edited));
    delete cut.sources; delete cut.styles; delete cut.products;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cut, null, 2), 'utf8');
    const healed = json(await req('GET', '/api/config'));
    check('配置文件里删掉整段（sources/styles/products），读取时自动补回默认值',
      !!healed.config.sources && !!healed.config.styles && Array.isArray(healed.config.products) && healed.config.products.length > 0,
      '补回后：来源 ' + healed.config.sources.length + ' 个、风格 ' + healed.config.styles.length + ' 个、商品 ' + healed.config.products.length + ' 件');
    check('补齐动作会告诉前端补了哪些区块', (healed.filled || []).indexOf('sources') >= 0 && (healed.filled || []).indexOf('products') >= 0,
      'filled=' + JSON.stringify(healed.filled));

    console.log('\n== 4. 备份保留上限 ==');
    for (let i = 0; i < 12; i++) {
      const c = JSON.parse(JSON.stringify(edited)); c.ui = { seq: i };
      await req('PUT', '/api/config', { config: c });
    }
    const backups = fs.readdirSync(BACKUP_DIR).filter(function (f) { return /^config-.*\.json$/.test(f); });
    check('连续写 12 次后备份不超过 10 份', backups.length <= 10, '当前 ' + backups.length + ' 份（上限 10）');
    out.numbers['备份保留'] = backups.length + ' 份';

    console.log('\n== 5. 静态资源收口（敏感路径不给下载） ==');
    const blocked = ['/data/config.json', '/data/backups/', '/data/news.json', '/server/server.js', '/server/defaults.json',
      '/server/news.js', '/server/sources.js',
      '/tests/deploy-tests.js', '/scripts/gen-defaults.js', '/work/', '/outputs/', '/.test-tools/node_modules/'];
    let blockOk = 0;
    for (const p of blocked) {
      const r = await req('GET', p);
      if (r.status === 403) blockOk++;
      else console.log('    ! ' + p + ' 期望 403，实际 ' + r.status);
    }
    check('data/ server/ tests/ scripts/ work/ outputs/ 全部 403（含 data/news.json、server/news.js）', blockOk === blocked.length,
      blockOk + '/' + blocked.length + ' 命中；抽查 /data/config.json → 403');
    const sample = await req('GET', '/data/config.json');
    check('被拦时返回可读说明而不是空白页', /Forbidden/.test(sample.body) && /不对静态访问开放/.test(sample.body), sample.body.slice(0, 60));

    const trav = await req('GET', '/%2e%2e/data/config.json');
    check('URL 编码的目录穿越（%2e%2e）被拦', trav.status === 403, '/%2e%2e/data/config.json → ' + trav.status);

    const allowed = [['/index.html', 'text/html'], ['/admin.html', 'text/html'], ['/assets/js/app.js', 'javascript'], ['/assets/css/styles.css', 'text/css']];
    let allowOk = 0;
    for (const [p, type] of allowed) {
      const r = await req('GET', p);
      if (r.status === 200 && String(r.headers['content-type'] || '').indexOf(type) >= 0) allowOk++;
      else console.log('    ! ' + p + ' 期望 200/' + type + '，实际 ' + r.status + ' ' + r.headers['content-type']);
    }
    check('前端资源照常可访问且 MIME 正确', allowOk === allowed.length, allowOk + '/' + allowed.length + ' 命中');
    const miss = await req('GET', '/nope.html');
    check('不存在的文件返回 404 而不是目录列表', miss.status === 404, '/nope.html → ' + miss.status);
    const fav = await req('GET', '/favicon.ico');
    check('/favicon.ico 返回 204（不污染控制台）', fav.status === 204, 'status=' + fav.status);

    console.log('\n== 6. 模型中转的失败提示 ==');
    const llm = await req('POST', '/api/llm', { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', messages: [] });
    const llmj = json(llm);
    check('服务端没有密钥时给出人话提示（不甩原始报错）', llm.status === 400 && /服务端没有可用密钥/.test((llmj && llmj.error) || ''),
      'status=' + llm.status + ' 提示=' + ((llmj && llmj.error) || '').slice(0, 40));
    const llm2 = json(await req('POST', '/api/llm', { model: 'gpt-4o-mini', messages: [] }));
    check('缺少接口地址时也给人话提示', /缺少 baseUrl/.test((llm2 && llm2.error) || ''), (llm2 && llm2.error) || '');

    out.numbers['静态收口'] = blockOk + '/' + blocked.length + ' 拦截、' + allowOk + '/' + allowed.length + ' 放行';
    out.numbers['写入防线'] = '空商品/空角色均 400，磁盘未污染';
  } catch (e) {
    check('部署自检未抛出异常', false, e.message);
  } finally {
    stop();
    await new Promise(function (res) { setTimeout(res, 300); });
    restore();
  }

  out.finishedAt = new Date().toISOString();
  out.pass = pass; out.fail = fail;
  fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'work', 'deploy-results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n通过 ' + pass + ' 项 / 失败 ' + fail + ' 项；结果写入 work/deploy-results.json');
  process.exit(fail ? 1 : 0);
})();
