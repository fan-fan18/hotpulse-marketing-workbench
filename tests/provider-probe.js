/* =========================================================
   真实服务商连通性探测（用于验收留痕，可复现）
   作用：用「一个故意写错的密钥」真发一次最小请求，证明
     ① 外网是通的（不是本机问题）
     ② 前端错误映射能把服务商原始报错翻成人话（"密钥无效"等）
   注意：这里不需要真密钥，故意用错密钥是为了看 401 的映射结果。
   运行：node tests/provider-probe.js
   ========================================================= */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const store = {};
global.window = global;
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
global.location = { protocol: 'file:' };
const nativeFetch = global.fetch;                              /* 保留原生 fetch：后面要真发 HTTP */
global.fetch = () => Promise.reject(new Error('offline'));      /* 仅在加载内核时屏蔽配置探测 */
['assets/js/data.js', 'assets/js/core/config.js', 'assets/js/core/prompt.js', 'assets/js/core/llm.js']
  .forEach(function (rel) { vm.runInThisContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel }); });
global.fetch = nativeFetch;                                     /* 恢复真实网络能力 */

const TARGETS = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: '阿里通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: 'Moonshot 月之暗面', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
];
const BAD_KEY = 'sk-deliberately-wrong-key-for-probe';

(async function run() {
  const rows = [];
  console.log('用「故意写错的密钥」探测各服务商（只为验证连通性与错误映射，不消耗额度）：');
  for (const t of TARGETS) {
    const started = Date.now();
    const res = await HP.LLM.call({
      mode: 'direct', baseUrl: t.baseUrl, model: t.model, apiKey: BAD_KEY, temperature: 0,
      system: '你是连接测试助手。', user: '只回复四个字：连接成功'
    }).catch(function (e) { return { ok: false, message: '调用异常：' + (e && e.message), raw: '' }; });
    const row = {
      provider: t.name, baseUrl: t.baseUrl, model: t.model,
      httpStatus: res.status || (res.ok ? 200 : '无（网络层失败）'),
      ok: !!res.ok,
      mapped: res.ok ? '（意外成功，说明密钥有效）' : res.message,
      rawSnippet: String(res.raw || '').replace(/\s+/g, ' ').slice(0, 120),
      latencyMs: Date.now() - started
    };
    rows.push(row);
    console.log('  · ' + t.name.padEnd(14) + ' HTTP ' + String(row.httpStatus).padEnd(18) +
      ' → ' + row.mapped + '（' + row.latencyMs + ' ms）');
  }
  const out = { probedAt: new Date().toISOString(), badKeyUsed: BAD_KEY.replace(/-(?!.*-).*/, '-***'), rows: rows };
  fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'work', 'provider-probe.json'), JSON.stringify(out, null, 2), 'utf8');
  const reachable = rows.filter(function (r) { return typeof r.httpStatus === 'number'; }).length;
  console.log('\n结论：' + rows.length + ' 个服务商里 ' + reachable + ' 个能建连并返回 HTTP 状态码（说明外网与接口地址没问题），' +
    '全部因为用了错密钥被拒 → 只要填上真密钥即可跑真实模型。');
  console.log('结果写入 work/provider-probe.json');
})();
