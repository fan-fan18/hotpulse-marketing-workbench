/* =========================================================
   HP.Config —— 后台统一配置层（三级读取）
   读取顺序：服务端 → 本机浏览器(localStorage) → 内置默认值
   拿得到哪级用哪级，并在顶栏徽章里显示当前级别
   ========================================================= */
window.HP = window.HP || {};

(function () {
  'use strict';

  var LS_KEY = 'hotpulse.config.v1';
  var TIMEOUT = 1500;

  /* 商品卡背景渐变预设（工作台与后台共用） */
  var GRADIENTS = {
    indigo: 'linear-gradient(135deg,#e8f3ec,#f5faf6)',
    mint: 'linear-gradient(135deg,#e6f8f2,#f2fbf7)',
    peach: 'linear-gradient(135deg,#ffeee6,#fff5ef)',
    sky: 'linear-gradient(135deg,#e6f2ff,#f2f8ff)',
    lilac: 'linear-gradient(135deg,#f2e9ff,#faf5ff)',
    lemon: 'linear-gradient(135deg,#fdf6dd,#fffdf3)',
    rose: 'linear-gradient(135deg,#ffe9f0,#fff5f8)',
    slate: 'linear-gradient(135deg,#eef1f6,#f8fafc)',
    ocean: 'linear-gradient(135deg,#e3f4ff,#eefaff)',
    sand: 'linear-gradient(135deg,#f7f0e4,#fdf9f2)',
    forest: 'linear-gradient(135deg,#e7f3e8,#f4faf4)',
    cocoa: 'linear-gradient(135deg,#f3e9e4,#faf5f2)'
  };

  /* ---------------- 内置默认值（骨架，后续页面往里填） ---------------- */
  var DEFAULTS = {
    version: 1,
    updatedAt: null,

    /* 提示词（后续「提示词与模板」页维护） */
    prompt: {
      role: '你是电商媒体的资深微博内容运营，负责把热点新闻转化成可以直接发布的微博营销文案。',
      rules: [
        '金额只能原样使用素材里给出的数字；素材没给的价格、折扣、销量、库存一律不许出现。',
        '严禁使用广告法违禁词（最佳、第一、最低、绝对、永久、百分百等）。',
        '写完自己数一遍，超出 {{字数上限}} 字就删，宁可少写一个卖点也不能超；也不要少于 {{字数下限}} 字。'
      ],
      materialTemplate: [
        '【热点素材】',
        '标题：{{热点标题}}',
        '摘要：{{热点摘要}}',
        '来源：{{来源}}｜热度值：{{热度值}}',
        '可用话题：{{话题标签}}',
        '',
        '【商品素材】',
        '{{商品清单}}',
        '',
        '【本次要求】',
        '主打语调：{{语调}}',
        '创作风格：{{创作风格}}',
        '风格要求：{{风格要求}}',
        '字数要求：{{字数下限}}–{{字数上限}} 字',
        '表情强度：{{表情强度}}',
        '可用金额（只能原样使用，不得新增）：{{可用金额}}',
        '{{附加要求}}'
      ].join('\n'),
      productTemplate: '{{序号}}. {{商品名称}}｜售价 {{售价}}｜原价 {{原价}}｜卖点：{{卖点列表}}',

      /* 自动返工用的说明（"未通过清单"会拼在它后面） */
      reworkInstruction: '下面是一版未通过的微博文案。\n请只针对【未通过清单】里的问题修改：不要改动商品、价格和话题，不要新增素材之外的任何信息，不要解释，也不要输出多个版本。\n字数、违禁词、编造价格、话题标签、互动引导这几类问题必须改掉。\n修改后只输出新的微博正文。',

      /* 模型评审提示词：用 {{素材}} 与 {{文案}} 两个占位符 */
      reviewPrompt: [
        '你是微博营销文案评审。请对下面这条文案打分，四个维度各 1–5 分（1 最差，5 最好）：',
        '- hot：热点关联度（是真借上了这个热点，还是生硬拼接）',
        '- material：素材还原度（卖点和价格用得准不准，有没有瞎编）',
        '- appeal：传播吸引力（有没有钩子、有没有网感，让人愿意点开）',
        '- natural：语气自然度（像真人在发微博，还是一股机器味）',
        '',
        '只输出一个 JSON 对象，不要任何解释文字：',
        '{"hot":4,"material":5,"appeal":3,"natural":4,"comment":"一句话点评"}',
        '',
        '【素材】',
        '{{素材}}',
        '',
        '【待评审文案】',
        '{{文案}}'
      ].join('\n'),

      /* 返工与评审都用低温度：照着清单改错 / 稳定打分，不需要发挥 */
      reworkTemperature: 0.2,
      reviewTemperature: 0.2,

      /* 范例本身必须满足全部约束（含字数区间），否则会把模型教坏 */
      example: '【冷空气来袭】🥶 一夜降了 10 度，出门那下真的清醒。\n\n' +
        '三合一防风冲锋衣 加绒可拆内胆，加绒内胆可拆、防风防泼水面料，通勤和周末都能穿。' +
        '现在 ¥299（原价 ¥599）。\n\n' +
        '你那边降了几度？评论区报个数 👇\n' +
        '#冷空气来了# #一夜入秋#'
    },

    /* 创作风格 / 语调（后续「创作风格与语调」页维护） */
    styles: [
      { id: 'st_hot', name: '热点借势', requirement: '先接住热点情绪，再自然过渡到商品，重体验感。' },
      { id: 'st_promo', name: '促销导向', requirement: '突出价格钩子与紧迫感，重转化，价格必须来自素材。' },
      { id: 'st_talk', name: '互动话题', requirement: '用提问和共鸣把读者拉进评论区，互动引导要具体。' },
      { id: 'st_deep', name: '深度种草', requirement: '讲清使用场景和细节体验，卖点落到具体感受上。' }
    ],
    tones: [
      { id: 'tn_hot', name: '热点借势' },
      { id: 'tn_promo', name: '促销导向' },
      { id: 'tn_talk', name: '互动话题' },
      { id: 'tn_daily', name: '日常分享' }
    ],

    /* 模型与接入（后续「模型与接入」页维护） */
    model: {
      mode: 'mock',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: '',
      temperature: 0.85,
      /* 单价（元 / 千 tokens）：参考价，以服务商官网为准，可自行修改 */
      priceIn: 0.15,
      priceOut: 0.6
    },

    limits: { minWords: 60, maxWords: 320, maxTags: 3 },

    /* 商品库：默认取工作台内置商品，后续由「商品库」页维护 */
    products: (window.MOCK && window.MOCK.PRODUCTS ? window.MOCK.PRODUCTS : []).map(function (p) {
      return {
        id: p.id, name: p.name, brand: p.brand, cat: p.cat,
        price: p.price, marketPrice: p.marketPrice, stock: p.stock,
        rating: p.rating, sales30d: p.sales30d, conversion: p.conversion,
        emoji: p.emoji, sku: p.sku, gradient: 'indigo', points: p.points.slice()
      };
    }),

    /* 抓取来源（后续「抓取来源」页维护） */
    sources: [
      { id: 'src_weather', name: '中国天气网', type: 'builtin', url: 'http://www.weather.com.cn/', enabled: true, note: '民生 / 天气类新闻源' },
      { id: 'src_weibo', name: '微博热搜榜', type: 'builtin', url: 'https://s.weibo.com/top/summary', enabled: true, note: '公开热榜（原型演示用）' },
      { id: 'src_sina', name: '新浪科技', type: 'builtin', url: 'https://tech.sina.com.cn/', enabled: true, note: '科技数码类新闻源' },
      { id: 'src_ctrip', name: '携程研究院', type: 'builtin', url: 'https://research.ctrip.com/', enabled: true, note: '出行旅游类数据源' },
      { id: 'src_xhs', name: '小红书趋势', type: 'builtin', url: 'https://www.xiaohongshu.com/explore', enabled: true, note: '社区趋势（原型演示用）' },
      { id: 'src_qbit', name: '量子位', type: 'builtin', url: 'https://www.qbitai.com/', enabled: true, note: 'AI / 科技媒体' },
      { id: 'src_health', name: '人民日报健康', type: 'builtin', url: 'https://www.people.com.cn/', enabled: true, note: '健康养生类新闻源' },
      { id: 'src_eo', name: '经济观察报', type: 'builtin', url: 'http://www.eeo.com.cn/', enabled: true, note: '商业消费类媒体' },
      { id: 'src_custom_demo', name: '行业媒体订阅（示例）', type: 'custom', url: 'https://example.com/rss/ecommerce', enabled: false, note: '运营自定义订阅源示例' }
    ],

    /* 风险识别规则：哪些热点禁止借势、哪些需要人工判断 */
    riskRules: {
      forbidden: [
        '灾难事故（伤亡、失联、事故原因未明）',
        '公共安全事件（案件侦办中、官方通报前）',
        '医疗与药品功效宣称',
        '涉政、涉宗教、涉民族敏感话题',
        '负面舆论与维权争议'
      ],
      manual: [
        '重大体育赛事结果（胜负情绪易引发对立）',
        '娱乐明星争议（存在反转风险）',
        '节庆与纪念日（需注意口径）',
        '价格与促销政策（以官方活动页为准）'
      ]
    },

    /* 评测设置（后续「评测台」页维护） */
    evalConfig: {
      weights: { machine: 0.5, review: 0.5 },
      concurrency: 3,
      repeats: 1,
      enableReview: false,       // 生成时是否同时跑模型评审（默认关闭：省调用成本，需要时再开）
      autoRework: true,          // 生成文案时是否自动返工
      maxReworkRounds: 2,        // 最多返工几轮
      cases: []
    },

    ui: { adminPage: 'overview', view: 'table' }
  };

  /* ---------------- 工具 ---------------- */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  function deepMerge(base, override) {
    var out = clone(base);
    if (!isPlainObject(override)) return out;
    Object.keys(override).forEach(function (k) {
      var v = override[k];
      if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k], v);
      else if (v !== undefined && v !== null) out[k] = clone(v);
      else if (Array.isArray(v)) out[k] = clone(v);
    });
    return out;
  }

  /* 本次读取时"自动补回"了哪些内置来源（读取后由界面提示给用户） */
  var autoFilledSources = [];

  /* 读取时自动补齐缺失内容：误删一段也不会让页面崩掉 */
  function withDefaults(cfg) {
    autoFilledSources.length = 0;
    var merged = deepMerge(DEFAULTS, isPlainObject(cfg) ? cfg : {});
    if (!Array.isArray(merged.styles) || !merged.styles.length) merged.styles = clone(DEFAULTS.styles);
    if (!Array.isArray(merged.tones) || !merged.tones.length) merged.tones = clone(DEFAULTS.tones);
    if (!Array.isArray(merged.products)) merged.products = clone(DEFAULTS.products);
    if (!Array.isArray(merged.sources)) merged.sources = clone(DEFAULTS.sources);
    /* 内置来源在界面上是"只能停用、不能删除"的。如果配置里整条不见了（旧配置、导入丢字段、
       被别的工具改坏），按 id 补回来并启用——否则挂在它上面的内置新闻会被全部过滤掉，
       工作台看起来就像"抓不到任何热点"。注意：来源还在、只是 enabled=false 的，尊重这个停用设置。 */
    if (Array.isArray(merged.sources)) {
      var haveIds = {};
      merged.sources.forEach(function (s) { if (s && s.id) haveIds[s.id] = true; });
      (DEFAULTS.sources || []).forEach(function (d) {
        if (!d || d.type !== 'builtin' || haveIds[d.id]) return;
        merged.sources.push(clone(d));
        autoFilledSources.push(d.name);
      });
    }
    if (!Array.isArray(merged.prompt.rules)) merged.prompt.rules = clone(DEFAULTS.prompt.rules);
    return merged;
  }

  /* 写入前的防线（完整规则后续段落再补充） */
  function validate(cfg) {
    var errors = [];
    if (!isPlainObject(cfg)) return { ok: false, errors: ['配置内容不是有效的对象'] };
    if (Object.keys(cfg).length === 0) errors.push('配置内容为空，拒绝写入');
    if (Array.isArray(cfg.products) && cfg.products.length === 0) errors.push('商品列表不能为空（拒绝写入）');
    if (!cfg.prompt || !String(cfg.prompt.role || '').trim()) errors.push('「角色设定」不能为空');
    return { ok: errors.length === 0, errors: errors };
  }

  /* ---------------- 三级读取 ---------------- */
  var state = {
    config: withDefaults(DEFAULTS),
    source: 'defaults',        // server | local | defaults
    serverAvailable: false,
    serverSavedAt: null,
    serverFilled: [],
    listeners: []
  };

  function emit() { state.listeners.forEach(function (fn) { try { fn(snapshot()); } catch (e) {} }); }
  function sourceLabel() { return { server: '服务端', local: '本机浏览器', defaults: '内置默认值' }[state.source]; }
  function sourceLevel() { return { server: 3, local: 2, defaults: 1 }[state.source]; }

  function fetchTimeout(url, opts, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var o = Object.assign({}, opts || {});
    if (ctrl) o.signal = ctrl.signal;
    var p = fetch(url, o);
    if (!ctrl) return p;
    var timer;
    return Promise.race([
      p, new Promise(function (_, rej) { timer = setTimeout(function () { ctrl.abort(); rej(new Error('timeout')); }, ms); })
    ]).then(function (r) { clearTimeout(timer); return r; }, function (e) { clearTimeout(timer); throw e; });
  }

  function storage() {
    try {
      var ls = window.localStorage;
      ls.setItem('__hp_probe__', '1');
      ls.removeItem('__hp_probe__');
      return ls;
    } catch (e) { return null; }
  }

  function load() {
    /* 只有通过 http(s) 打开时才去探测服务端；file:// 下不存在服务端这一级，
       直接走本机浏览器，避免浏览器控制台出现无意义的跨域报错 */
    var probe = (function () {
      var p = (window.location && window.location.protocol) || '';
      return p === 'http:' || p === 'https:';
    })();
    var head = probe
      ? fetchTimeout('api/config', { headers: { Accept: 'application/json' } }, TIMEOUT)
      : Promise.reject(new Error('no-server-context'));
    return head
      .then(function (res) {
        if (!res.ok) throw new Error('server ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.ok || !data.config) throw new Error('payload');
        state.config = withDefaults(data.config);
        state.source = 'server';
        state.serverAvailable = true;
        state.serverSavedAt = data.savedAt || null;
        state.serverFilled = data.filled || [];
        emit();
        return snapshot();
      })
      .catch(function () {
        state.serverAvailable = false;
        state.serverSavedAt = null;
        var ls = storage();
        var local = null;
        if (ls) {
          try { local = JSON.parse(ls.getItem(LS_KEY) || 'null'); } catch (e) { local = null; }
        }
        if (ls && !local) {
          /* 没有服务端时，本机浏览器就是当前配置层：把默认值落一份到本地，后续修改都存在本地 */
          state.config = withDefaults(DEFAULTS);
          state.source = 'local';
          try { ls.setItem(LS_KEY, JSON.stringify(state.config)); } catch (e) {}
        } else if (ls && local) {
          state.config = withDefaults(local);
          state.source = 'local';
        } else {
          state.config = withDefaults(DEFAULTS);
          state.source = 'defaults';
        }
        emit();
        return snapshot();
      });
  }

  function snapshot() {
    return {
      config: clone(state.config),
      source: state.source,
      sourceLabel: sourceLabel(),
      sourceLevel: sourceLevel(),
      serverAvailable: state.serverAvailable,
      serverSavedAt: state.serverSavedAt,
      serverFilled: state.serverFilled.slice(),
      storageKey: LS_KEY
    };
  }

  /* ---------------- 保存：写回当前生效的那一级 ---------------- */
  function save(cfg) {
    var payload = clone(cfg || state.config);
    var check = validate(payload);
    if (!check.ok) return Promise.resolve({ ok: false, targetLabel: sourceLabel(), errors: check.errors });
    payload.updatedAt = new Date().toISOString();

    if (state.serverAvailable) {
      return fetchTimeout('api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: payload })
      }, 6000)
        .then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); })
        .then(function (r) {
          if (r.status === 200 && r.d && r.d.ok) {
            state.config = withDefaults(payload);
            state.serverSavedAt = r.d.savedAt || payload.updatedAt;
            emit();
            return { ok: true, target: 'server', targetLabel: '服务端', backup: r.d.backup || null, savedAt: state.serverSavedAt };
          }
          return { ok: false, target: 'server', targetLabel: '服务端', errors: (r.d && r.d.errors) || ['服务端拒绝了这次写入'] };
        })
        .catch(function (e) {
          return { ok: false, target: 'server', targetLabel: '服务端', errors: ['无法连接服务端：' + e.message] };
        });
    }

    var ls = storage();
    if (!ls) return { ok: false, target: 'defaults', targetLabel: '内置默认值', errors: ['浏览器本地存储不可用，且没有服务端，当前配置无法持久保存'] };
    try {
      ls.setItem(LS_KEY, JSON.stringify(payload));
      state.config = withDefaults(payload);
      state.source = 'local';
      emit();
      return Promise.resolve({ ok: true, target: 'local', targetLabel: '本机浏览器', savedAt: payload.updatedAt });
    } catch (e) {
      return Promise.resolve({ ok: false, target: 'local', targetLabel: '本机浏览器', errors: ['本机浏览器写入失败：' + e.message] });
    }
  }

  /* ---------------- 导出 / 导入 ---------------- */
  function exportJSON(cfg) { return JSON.stringify(cfg || state.config, null, 2); }

  function importJSON(text) {
    var parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { return { ok: false, error: '不是合法的 JSON 文件：' + e.message }; }
    if (!isPlainObject(parsed)) return { ok: false, error: '文件内容不是配置对象（顶层应该是 { } 结构）' };
    var known = Object.keys(DEFAULTS);
    if (!Object.keys(parsed).some(function (k) { return known.indexOf(k) > -1; })) {
      return { ok: false, error: '文件里没有可识别的配置项（应该是从本后台导出的配置文件）' };
    }
    var merged = withDefaults(parsed);
    var check = validate(merged);
    if (!check.ok) return { ok: false, error: '文件内容没有通过校验：\n· ' + check.errors.join('\n· ') };
    return { ok: true, config: merged };
  }

  window.HP.Config = {
    DEFAULTS: DEFAULTS,
    GRADIENTS: GRADIENTS,
    GRADIENT_KEYS: Object.keys(GRADIENTS),
    STORAGE_KEY: LS_KEY,
    load: load,
    get: function () { return state.config; },
    snapshot: snapshot,
    save: save,
    validate: validate,
    withDefaults: withDefaults,
    exportJSON: exportJSON,
    importJSON: importJSON,
    sourceLabel: sourceLabel,
    sourceLevel: sourceLevel,
    sourcesAutoFilled: function () { return autoFilledSources.slice(); },
    isServer: function () { return state.serverAvailable; },
    clearFilled: function () { state.serverFilled = []; },
    onChange: function (fn) { state.listeners.push(fn); },
    clone: clone
  };
})();
