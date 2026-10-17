/* =========================================================
   HP.LLM —— 模型调用层
   · mock   本地模拟：不发网络请求，但会读同一份提示词，按规范约束产出文案
   · proxy  本地服务中转（密钥放服务端）
   · direct 浏览器直连（密钥在本机浏览器）
   ========================================================= */
window.HP = window.HP || {};

(function () {
  'use strict';

  var MODE_LABEL = { mock: '本地模拟', proxy: '本地服务中转', direct: '浏览器直连' };

  var PROVIDERS = [
    { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'], note: '官方接口，国内访问通常需要代理' },
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'], note: '性价比高，中文写作友好' },
    { id: 'moonshot', name: 'Moonshot 月之暗面', baseUrl: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-k2-0905-preview'], note: '微博短文风格稳定' },
    { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus'], note: '国内调用稳定' },
    { id: 'dashscope', name: '阿里通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'], note: '兼容 OpenAI 协议' },
    { id: 'siliconflow', name: '硅基流动 SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', models: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3'], note: '聚合多家开源模型' },
    { id: 'ollama', name: 'Ollama（本机部署）', baseUrl: 'http://localhost:11434/v1', models: ['qwen2.5:7b', 'llama3.1:8b'], note: '本机跑模型，密钥随便填' },
    { id: 'custom', name: '自定义（OpenAI 兼容）', baseUrl: '', models: [], note: '自己填接口地址与模型名' }
  ];

  /* 温度推荐值：不同任务的建议区间 */
  var TEMP_GUIDE = [
    { task: '创作类（写文案、想标题）', range: '0.7 – 1.0', temp: 0.85 },
    { task: '改写 / 返工（照着清单改错）', range: '0.1 – 0.3', temp: 0.2 },
    { task: '抽取 / 评审 / 结构化输出', range: '0 – 0.3', temp: 0.1 }
  ];

  /* ---------------- 从提示词里读约束（模拟模型"照规范办事"） ---------------- */
  function parseRules(system, material) {
    var text = String(system || '') + '\n' + String(material || '');
    var r = { minWords: null, maxWords: null, endWithQuestion: false, noExclamation: false, noEmoji: false, mustPrice: false };
    var m;

    /* 规范是逐条写的，同一类约束可能出现在多条里：
       这里扫描全部条目，上限取最严格（最小）、下限取最严格（最大） */
    function scan(re) {
      var out = [], mm;
      re.lastIndex = 0;
      while ((mm = re.exec(text))) {
        var v = Number(mm[1] || mm[2] || mm[3] || mm[4] || mm[5] || 0);
        if (v > 0) out.push(v);
        if (mm.index === re.lastIndex) re.lastIndex++;
      }
      return out;
    }

    /* 字数区间：60–320 字 */
    if ((m = text.match(/(\d{2,4})\s*[-–~—至到]\s*(\d{2,4})\s*字/))) { r.minWords = Number(m[1]); r.maxWords = Number(m[2]); }

    var maxes = scan(/(?:不要|别|勿)?要?超过\s*(\d{2,4})\s*字/g)
      .concat(scan(/最多\s*(\d{2,4})\s*字/g))
      .concat(scan(/上限(?:为|是)?\s*(\d{2,4})\s*字/g))
      .concat(scan(/控制在\s*(\d{2,4})\s*字/g))
      .concat(scan(/(\d{2,4})\s*字以内/g));
    if (maxes.length) {
      var strictMax = Math.min.apply(null, maxes);
      r.maxWords = r.maxWords == null ? strictMax : Math.min(r.maxWords, strictMax);
    }

    var mins = scan(/至少\s*(\d{2,4})\s*字/g)
      .concat(scan(/不少于\s*(\d{2,4})\s*字/g))
      .concat(scan(/不低于\s*(\d{2,4})\s*字/g))
      .concat(scan(/下限(?:为|是)?\s*(\d{2,4})\s*字/g));
    if (mins.length) {
      var strictMin = Math.max.apply(null, mins);
      r.minWords = r.minWords == null ? strictMin : Math.max(r.minWords, strictMin);
    }
    if (r.minWords != null && r.maxWords != null && r.minWords > r.maxWords) r.minWords = r.maxWords;

    r.endWithQuestion = /(?:以|用)(?:一个)?(?:提问|问句|反问)(?:来)?(?:结尾|收尾)|结尾(?:必须|需要|要|需)?(?:是|为)?(?:一个)?(?:提问|问句|反问)|结尾.*?问/.test(text);
    r.noExclamation = /(?:不要|禁止|不得|避免)(?:出现|使用)?(?:任何)?感叹号/.test(text);
    /* 表情：允许中间有空格与「使用 / 用 / 加 / 带 / 出现」等词 */
    r.noEmoji = /(?:不要|禁止|不得|避免|别)(?:再)?\s*(?:使用|用|加|带|出现)?\s*(?:任何)?\s*(?:emoji|Emoji|EMOJI|表情符号|表情)/i.test(text);
    r.mustPrice = /必须(?:体现|包含|出现|带上|写出|给出)价格|一定要有价格|必须带价格/.test(text);
    /* 是否明确要求"结尾要有互动引导"——和"提问结尾"可以同时成立 */
    r.mustCta = /必须(?:有|包含|带|加上)?(?:一句)?互动引导|结尾必须(?:有|是)?.*(?:评论|互动|引导)|引导读者(?:评论|留言|私信)|必须有(?:一句)?(?:评论|互动)/.test(text);
    return r;
  }

  /* ---------------- 本地模拟模型 ---------------- */
  function seedOf(s) { var h = 0, t = String(s || ''); for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 100003; return h; }
  function pick(arr, seed) { return arr[Math.abs(seed) % arr.length]; }
  function countChars(t) { return String(t || '').replace(/\s/g, '').length; }

  function mockCompose(meta) {
    var d = meta || {};
    var news = d.news || { title: '示例热点', keywords: [], topics: [] };
    var products = d.products || [];
    var main = products[0] || null;
    var rules = parseRules(d.system, d.material);
    var limits = Object.assign({ minWords: 60, maxWords: 320, maxTags: 3, minEmoji: 1, maxEmoji: 8 }, d.limits || {});
    if (rules.minWords != null) limits.minWords = rules.minWords;
    if (rules.maxWords != null) limits.maxWords = rules.maxWords;
    if (rules.noEmoji) limits.maxEmoji = 0;

    var level = rules.noEmoji ? 0 : (d.emojiLevel == null ? 1 : Number(d.emojiLevel));
    var emo = [['', '', ''], ['🥶', '✨', '🔥'], ['🥶🥶', '✨👀', '🔥🔥']][level] || ['', '', ''];
    var tags = (d.tags && d.tags.length ? d.tags : (news.topics || [])).slice(0, limits.maxTags || 3);
    var style = d.style || { name: '热点借势', requirement: '' };
    var tone = d.tone || '';
    var seed = seedOf(news.title + products.map(function (p) { return p.id; }).join('') + style.name + tone + (d.extra || ''));
    var shortTitle = String(news.title || '').split(/[：:！!，,；;]/)[0].slice(0, 18);

    /* 不同创作风格用不同的措辞库，保证多个候选版本一眼能看出差别 */
    var flavor = (function (s) {
      var t = String(s.name || '') + ' ' + String(s.requirement || '');
      if (/促销|价格|转化|紧迫|钩子|限时/.test(t)) return 'promo';
      if (/互动|话题|评论|提问|共鸣/.test(t)) return 'talk';
      if (/种草|体验|细节|场景|使用/.test(t)) return 'deep';
      return 'hot';
    })(style);

    var FLAVOR = {
      hot: {
        openings: ['【' + shortTitle + '】' + emo[0] + ' 说真的，这波我提前囤好了。',
          '【' + shortTitle + '】' + emo[1] + ' 刷到热搜那下我就知道，该准备了。'],
        moods: ['热点来得快，能提前动手的人总是更从容一点。',
          '这种时候最实在的踏实感，就是把该准备的先准备好。'],
        ctas: ['同款姐妹评论区集合，我看看有多少人。', '想要链接的扣个「1」，我挨个发～']
      },
      promo: {
        openings: ['【' + shortTitle + '】' + emo[2] + ' 这波特价，手慢就真的没了。',
          '【' + shortTitle + '】' + emo[1] + ' 只在今天：先把价格记下来再往下看。'],
        moods: ['算下来比平时省了一截，属于犹豫一下就没的价。',
          '价格是这次最不用纠结的部分，直接照着买就行。'],
        ctas: ['需要的现在就下手，评论区扣「1」我发链接。', '点收藏不如直接下单，评论区问我细节～']
      },
      talk: {
        openings: ['【' + shortTitle + '】' + emo[1] + ' 先问一句：你那边也这样吗？',
          '【' + shortTitle + '】' + emo[0] + ' 有个问题想听听大家的看法。'],
        moods: ['评论区里一半人说早准备了，一半人还在观望。',
          '我特别好奇大家会怎么选，所以先把我的选择说出来。'],
        ctas: ['你会先囤哪一件？评论区告诉我。', '说说你的情况，我挨个回～']
      },
      deep: {
        openings: ['【' + shortTitle + '】' + emo[1] + ' 我用了两周，来说点真实感受。',
          '【' + shortTitle + '】' + emo[0] + ' 挑了很久，最后留下的是这一件。'],
        moods: ['真正影响体验的从来不是参数，而是每天用起来顺不顺手。',
          '细节做对的地方，用一次就能感觉到差别。'],
        ctas: ['想知道细节的可以评论区问，我一条条回。', '需要对比清单的评论区说一声～']
      }
    };
    var pack = FLAVOR[flavor];
    var openings = pack.openings, mood = pack.moods, ctas = pack.ctas;
    var questions = ['你们那边现在是什么情况？', '你更想先囤哪一件？', '看到这条热搜，你第一反应是什么？'];

    var pts = main ? (main.points || []).slice(0, 3) : [];
    var parts = {
      head: pick(openings, seed),
      mood: pick(mood, seed + 3),
      product: main ? (main.name + '，' + pts.slice(0, 2).join('，') + '。' + (pts[2] ? pts[2] + '。' : '')) : '',
      productShort: main ? (main.name + (pts[0] ? '，' + pts[0] + '。' : '')) : '',
      price: main ? ('现在 ¥' + main.price + '（原价 ¥' + main.marketPrice + '），' + (Number(main.price) / Number(main.marketPrice) * 10).toFixed(1) + ' 折入手。') : '',
      priceShort: main ? ('现在 ¥' + main.price + ' 就能拿下。') : '',
      cta: (rules.endWithQuestion ? pick(questions, seed + 5) : pick(ctas, seed + 7)),
      ctaShort: (rules.endWithQuestion ? '你怎么看？' : '需要的评论区扣 1～'),
      extra: d.extra ? String(d.extra) : '',
      tags: tags.join(' '),
      tagsFirst: !!rules.endWithQuestion,
      emojiTail: emo[2]
    };
    if (rules.endWithQuestion) {
      /* 同时要求互动引导时，问句后面补上评论引导，两条规则都满足 */
    /* "必须提问结尾"是最后一句要求：互动引导要放在问句之前，别把问句挤到中间 */
    parts.cta = rules.endWithQuestion
      ? ((rules.mustCta ? '评论区聊聊，' : '') + (parts.emojiTail ? parts.emojiTail : '') + parts.cta)
      : ((parts.emojiTail ? parts.emojiTail : '') + parts.cta + (rules.mustCta ? '评论区聊聊' : ''));
    } else {
      parts.cta = parts.cta + ' ' + parts.emojiTail;
    }

    var text = fitLength(parts, limits);

    /* 复现"软性规范模型不听"的两类典型问题（第六段要演示的场景）：
       · 规范里只有"篇幅控制在多少字"这类软描述 → 模型照样写超
       · 规范里没有"金额只能原样使用素材数字"这条死约束 → 模型顺手编一个价
       加上对应的硬要求后，这两类问题就不再出现。 */
    var sysText = String(d.system || '');
    if (sysText && !/(数一遍|超了就删|不得超过|严格控制在|删到)/.test(sysText)) {
      var extra = '\n\n再多说两句：这次换季来得比往年早一些，身边不少朋友都在提前准备，' +
        '我自己也把家里和工位上的东西都换了一遍，用下来最直观的感受就是提前准备真的省心很多。' +
        '挑东西的时候我一般先看材质和场景，再看价格是否合适，最后才决定要不要入手；' +
        '毕竟买回来是要天天用的，顺手比什么都重要。';
      var target = Number(limits.maxWords || 320) + 60;   // 软性要求下模型会明显写超
      var guard = 0;
      while (countChars(text) <= target && guard++ < 6) text = text + extra;
    }
    if (sysText && !/(金额只能原样使用|不许出现|不得新增|禁止编造|不得自行换算)/.test(sysText) && main) {
      var fake = Number(main.price) + 37;
      text = text.replace(/现在 ¥[\d.]+（原价 ¥[\d.]+）/,
        '现在 ¥' + fake + '（原价 ¥' + main.marketPrice + '）');
    }
    if (rules.noExclamation) text = text.replace(/！/g, '。');
    if (rules.noEmoji) text = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/[ \t]{2,}/g, ' ');
    return text.replace(/\n{3,}/g, '\n\n').trim();
  }

  /* 按顺序逐步"瘦身"：先删情绪句，再压缩卖点与价格，最后才动互动引导；商品与话题始终保留 */
  function assemble(p, use) {
    var blocks = [p.head];
    if (use.mood) blocks.push(p.mood);
    if (p.product) blocks.push(use.shortProduct ? p.productShort : p.product);
    if (p.price && use.price) blocks.push(use.shortPrice ? p.priceShort : p.price);
    if (use.extra && p.extra) blocks.push(p.extra);
    var tail = [];
    if (p.tags && p.tagsFirst) tail.push(p.tags);
    if (use.cta) tail.push(use.shortCta ? p.ctaShort : p.cta);
    if (p.tags && !p.tagsFirst) tail.push(p.tags);
    if (tail.length) blocks.push(tail.join('\n'));
    return blocks.filter(function (b) { return String(b).trim(); }).join('\n\n');
  }

  function fitLength(p, limits) {
    var min = Number(limits.minWords || 0), max = Number(limits.maxWords || 10000);
    var variants = [
      { mood: 1, product: 1, price: 1, cta: 1, extra: 1 },
      { mood: 0, product: 1, price: 1, cta: 1, extra: 1 },
      { mood: 0, product: 1, price: 1, cta: 1, shortProduct: 1, extra: 1 },
      { mood: 0, product: 1, price: 1, cta: 1, shortProduct: 1, extra: 0 },
      { mood: 0, product: 1, price: 1, cta: 1, shortProduct: 1, shortCta: 1, extra: 0 },
      { mood: 0, product: 1, price: 1, shortPrice: 1, cta: 1, shortProduct: 1, shortCta: 1 },
      { mood: 0, product: 1, price: 1, shortPrice: 1, cta: 0, shortProduct: 1 }
    ];
    var text = assemble(p, variants[0]);
    if (max) {
      for (var i = 0; i < variants.length; i++) {
        text = assemble(p, variants[i]);
        if (countChars(text) <= max) break;
      }
    }
    var fillers = ['提前准备这件事，说小也小，但真的很影响体验。', '反正我是宁愿早一点，也不想临时手忙脚乱。',
      '身边朋友问起的时候，我一般就直接把链接发过去。', '用下来最直观的感受是省心，不用来回折腾。'];
    var guard = 0;
    while (countChars(text) < min && guard++ < 80) {
      var lines = text.split('\n');
      var idx = p.tagsFirst ? Math.max(1, lines.length - 2) : Math.max(1, lines.length - 2);
      lines.splice(idx, 0, pick(fillers, guard));
      text = lines.join('\n');
    }
    return text;
  }

  function estimateTokens(text) {
    var t = String(text || '');
    if (!t) return 0;
    var cjk = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
    return Math.max(1, Math.round(cjk * 0.9 + (t.length - cjk) / 4));
  }

  function mockCall(meta) {
    var started = Date.now();
    var kind = (meta && meta.kind) || 'compose';
    var text = kind === 'rework' ? mockRework(meta)
      : kind === 'review' ? mockReview(meta)
        : mockCompose(meta);
    var delay = meta && meta.delay != null ? meta.delay : 260;
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          ok: true, text: text, mode: 'mock', modeLabel: MODE_LABEL.mock,
          model: 'hotpulse-mock-v1', latencyMs: Date.now() - started + delay,
          usage: {
            inputTokens: estimateTokens(((meta && meta.system) || '') + ((meta && meta.user) || '')),
            outputTokens: estimateTokens(text)
          },
          note: '本地模拟输出，不代表真实模型效果'
        });
      }, Math.min(delay, 2000));
    });
  }

  /* 模拟"评审模型"：给出四维分与点评，并且模仿真实模型常见的几种输出形态 */
  function mockReview(meta) {
    var m = meta || {};
    var copy = String(m.copy || '');
    var products = m.products || [];
    var limits = m.limits || {};
    var len = copy.replace(/\s/g, '').length;
    var seed = seedOf(copy);
    var hasPrice = products[0] && copy.indexOf(String(products[0].price)) > -1;
    var hasTag = /#[^#\s]+#/.test(copy);
    var hasCta = /评论区|扣个|聊聊|说说|告诉我/.test(copy);
    var hasHot = copy.indexOf('【') === 0;
    var clamp = function (n) { return Math.max(1, Math.min(5, Math.round(n))); };
    var dims = {
      hot: clamp(3 + (hasHot ? 1 : 0) + (seed % 2) * 0 - (len > Number(limits.maxWords || 320) ? 1 : 0)),
      material: clamp((hasPrice ? 5 : 3) - (seed % 2)),
      appeal: clamp(3 + (hasTag ? 1 : 0) + (hasCta ? 1 : 0) - (seed % 2)),
      natural: clamp(4 - (/\*\*|\{\{|^[-*]\s/m.test(copy) ? 2 : 0) - (seed % 2))
    };
    var comment = dims.material >= 4
      ? '热点与商品衔接自然，价格信息准确，结尾的互动引导可用。'
      : '热点接得上，但素材信息用得不够完整，建议补充价格或卖点。';
    var json = JSON.stringify(Object.assign({ comment: comment }, dims));
    /* 三种形态：代码块包裹 / 前后带废话 / 纯 JSON —— 用来验证解析容错 */
    var form = seed % 3;
    if (form === 0) return '```json\n' + json + '\n```';
    if (form === 1) return '好的，我的评分如下：\n' + json + '\n以上为本次评审结果，供参考。';
    return json;
  }

  /* 模拟"照着未通过清单改错"：逐项修掉能修的问题 */
  function mockRework(meta) {
    var m = meta || {};
    var copy = String(m.copy || '');
    var limits = m.limits || {};
    var products = m.products || [];
    var tags = m.tags || [];
    var issues = m.issues || [];
    var applied = [];

    (issues || []).forEach(function (it) {
      var code = it.code;
      if (code === 'forbidden') {
        (it.hits || []).forEach(function (w) { copy = copy.split(w).join('更合适'); });
        copy = copy.replace(/全网/g, '').replace(/，+，/g, '，');
        applied.push('广告法违禁词');
      } else if (code === 'fakePrice') {
        (it.hits || []).forEach(function (amt) {
          var re = new RegExp('(?:¥|￥)?\\s*' + String(amt).replace('.', '\\.') + '\\s*元?', 'g');
          copy = copy.replace(re, products[0] ? '¥' + products[0].price : '');
        });
        copy = copy.replace(/[¥￥]\s*(?=[，。、\s]|$)/g, '');
        applied.push('编造价格');
      } else if (code === 'cta') {
        /* 返工也要守同一套规则：规范要求提问结尾就别拿 emoji 收尾 */
        var rulesForCta = parseRules(m.system, m.materialText || '');
        var tail = rulesForCta.endWithQuestion
          ? ((rulesForCta.mustCta ? '评论区聊聊，' : '') + '你们那边现在是什么情况？')
          : (rulesForCta.noEmoji ? '需要的扣个 1，我挨个发。' : '需要的扣个 1，我挨个发 👇');
        copy = copy.replace(/\s*$/, '') + '\n' + tail;
        applied.push('互动引导');
      } else if (code === 'tags') {
        var have = copy.match(/#[^#\s]+#/g) || [];
        var need = tags.filter(function (t) { return have.indexOf(t) < 0; });
        var all = have.concat(need).slice(0, Number(limits.maxTags) || 3);
        copy = copy.replace(/#[^#\s]+#(\s+#[^#\s]+#)*/g, '').replace(/\s+$/, '');
        copy = copy + '\n' + all.join(' ');
        applied.push('话题标签');
      } else if (code === 'words') {
        var max = Number(limits.maxWords) || 320;
        var count = function (t) { return t.replace(/\s/g, '').length; };
        var mainName = products[0] ? String(products[0].name).slice(0, 6) : '';
        /* 分段落处理：商品行、话题行、互动引导这三类必须保住，优先删多余的抒情段 */
        var blocks = copy.split('\n').filter(function (l) { return l.trim(); });
        var keepFlags = blocks.map(function (l, i) {
          var essential = (mainName && l.indexOf(mainName) > -1) || /#/.test(l) ||
            /评论区|扣个|聊聊|说说|告诉我|留言|私信/.test(l) || i === 0;
          return essential;
        });
        /* 从后往前删非必需的行，直到落进上限 */
        for (var i = blocks.length - 1; i >= 0 && count(blocks.join('\n')) > max; i--) {
          if (keepFlags[i]) continue;
          blocks.splice(i, 1);
          keepFlags.splice(i, 1);
        }
        /* 还是超，就压缩最长的非必需行；最后才按比例裁剪最长的一行 */
        if (count(blocks.join('\n')) > max) {
          var longest = -1;
          blocks.forEach(function (l, i) { if (!keepFlags[i] && (longest < 0 || l.length > blocks[longest].length)) longest = i; });
          if (longest > -1) {
            var room = Math.max(20, max - count(blocks.filter(function (_, i) { return i !== longest; }).join('\n')) - 2);
            blocks[longest] = blocks[longest].slice(0, room) + '。';
          }
        }
        copy = blocks.join('\n');
        var min = Number(limits.minWords) || 0;
        if (copy.replace(/\s/g, '').length < min) {
          copy = copy + '\n这件事提前准备真的省心，评论区聊聊你的选择？';
        }
        applied.push('字数');
      } else if (code === 'format') {
        copy = copy.replace(/\{\{|\}\}|```|\*\*/g, '').replace(/^#{1,6}\s*/gm, '').replace(/^[-*+]\s+/gm, '');
        copy = copy.replace(/\n{3,}/g, '\n\n');
        applied.push('排版残留');
      } else if (code === 'emoji') {
        var count = (copy.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
        var maxE = Number(limits.maxEmoji) || 8;
        var minE = Number(limits.minEmoji || 0);
        if (count > maxE) copy = copy.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');
        if (count < minE) copy = copy + ' 🥶';
        applied.push('表情符号数量');
      }
    });
    m.__applied = applied;
    return copy.replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ---------------- 真实调用 ---------------- */
  function humanError(ctx) {
    var status = ctx && ctx.status;
    var body = String((ctx && ctx.body) || '') + ' ' + String((ctx && ctx.message) || '');
    var low = body.toLowerCase();
    if (/invalid_api_key|incorrect api key|unauthorized/.test(low)) return '密钥无效，请检查密钥是否正确、是否过期';
    if (/insufficient_quota|exceeded your current quota|balance/.test(low)) return '账户余额不足或额度已用完';
    if (/model_not_found|does not exist|unknown model|invalid model/.test(low)) return '模型名不存在，请核对模型名称';
    if (/rate limit|too many requests/.test(low)) return '请求被限流，请降低并发或稍后重试';
    if (/timeout|aborted/.test(low)) return '请求超时：接口地址可能不对，或网络不稳定';
    if (/failed to fetch|networkerror|econnrefused/.test(low)) return '网络不可达或接口地址不对（浏览器直连还可能被跨域限制）';
    if (status === 401 || status === 403) return '密钥无效或没有该模型的调用权限';
    if (status === 402) return '账户余额不足';
    if (status === 404) return '接口地址或模型名不存在';
    if (status === 429) return '请求被限流，请稍后重试';
    if (status >= 500) return '服务商暂时不可用（HTTP ' + status + '）';
    if (status === 400 && /[\u4e00-\u9fa5]/.test(body)) {
      /* 本地服务中转会返回中文可读原因（例如"服务端没有可用密钥"），优先展示 */
      return '请求被拒绝：' + String((ctx && ctx.message) || '').trim().slice(0, 120);
    }
    if (ctx && ctx.message) return '调用失败：' + ctx.message;
    return '调用失败，请检查接入方式、地址与密钥';
  }

  function extractText(json) {
    if (!json) return '';
    if (typeof json === 'string') return json;
    if (json.choices && json.choices[0]) {
      var c = json.choices[0];
      return (c.message && c.message.content) || c.text || '';
    }
    return '';
  }

  function call(opts) {
    var cfg = HP.Config.get();
    var o = Object.assign({}, cfg.model, opts || {});
    var mode = o.mode || 'mock';
    if (mode === 'mock') return mockCall(o.meta || {});

    var payload = {
      model: o.model, temperature: Number(o.temperature == null ? cfg.model.temperature : o.temperature),
      stream: false,
      messages: [{ role: 'system', content: o.system || '' }, { role: 'user', content: o.user || '' }]
    };
    var url, headers = { 'Content-Type': 'application/json' }, body;
    if (mode === 'proxy') {
      /* 直接双击文件打开时没有服务端，相对地址 api/llm 会被解析成不存在的文件路径，
         报错会误导成"网络不可达"。这里直接说清楚：先起服务端，再用 http:// 打开。 */
      var proto = (window.location && window.location.protocol) || '';
      if (proto !== 'http:' && proto !== 'https:') {
        return Promise.resolve({
          ok: false, mode: mode, modeLabel: MODE_LABEL[mode],
          message: '本地服务中转需要先启动服务端：双击「启动服务.bat」或执行 node server/server.js，'
            + '再用 http://localhost:8787 打开本页。当前是直接双击文件打开的，没有服务端可以中转。',
          raw: 'file:// 下不存在服务端（protocol=' + proto + '）'
        });
      }
      url = 'api/llm';
      body = JSON.stringify(Object.assign({ baseUrl: o.baseUrl, apiKey: o.apiKey }, payload));
    } else {
      url = String(o.baseUrl || '').replace(/\/+$/, '') + '/chat/completions';
      headers.Authorization = 'Bearer ' + (o.apiKey || '');
      body = JSON.stringify(payload);
    }
    var started = Date.now();
    return fetch(url, { method: 'POST', headers: headers, body: body })
      .then(function (res) {
        return res.text().then(function (t) {
          var json = null;
          try { json = JSON.parse(t); } catch (e) {}
          if (!res.ok) {
            var msg = json && json.error ? (json.error.message || json.error) : t.slice(0, 200);
            if (typeof msg !== 'string') msg = JSON.stringify(msg);
            return {
              ok: false, mode: mode, modeLabel: MODE_LABEL[mode], status: res.status,
              message: humanError({ status: res.status, body: t, message: msg }),
              raw: String(t).slice(0, 500)          // 只作为「技术细节」折叠展示，主提示走人话
            };
          }
          var text = extractText(json);
          if (!text) return { ok: false, mode: mode, modeLabel: MODE_LABEL[mode], message: '返回内容为空，可能是模型名或参数不匹配' };
          var u = (json && json.usage) || {};
          return {
            ok: true, text: text, mode: mode, modeLabel: MODE_LABEL[mode],
            model: (json && json.model) || o.model, latencyMs: Date.now() - started,
            usage: { inputTokens: u.prompt_tokens || 0, outputTokens: u.completion_tokens || 0 }
          };
        });
      })
      .catch(function (e) {
        return {
          ok: false, mode: mode, modeLabel: MODE_LABEL[mode],
          message: humanError({ message: e && e.message }),
          raw: String((e && e.message) || '')
        };
      });
  }

  function priceOf(inTok, outTok, modelCfg) {
    var m = modelCfg || HP.Config.get().model || {};
    return Math.round(((inTok / 1000) * Number(m.priceIn || 0) + (outTok / 1000) * Number(m.priceOut || 0)) * 10000) / 10000;
  }

  /* ---------------- 测试连接：真发一次最小请求 ---------------- */
  function testConnection(cfg) {
    var m = Object.assign({}, HP.Config.get().model, cfg || {});
    var mode = m.mode || 'mock';
    if (mode === 'mock') {
      return mockCall({ delay: 200, news: { title: '连接测试', topics: [] }, products: [], limits: { maxWords: 60 } })
        .then(function (r) {
          return {
            ok: true, mock: true, latencyMs: r.latencyMs, model: r.model, modeLabel: MODE_LABEL.mock,
            message: '本地模拟模式：没有真实发起网络请求（切到「本地服务中转」或「浏览器直连」并配置密钥后再测）'
          };
        });
    }
    var started = Date.now();
    return call({
      mode: mode, provider: m.provider, baseUrl: m.baseUrl, model: m.model, apiKey: m.apiKey, temperature: 0,
      system: '你是连接测试助手。', user: '只回复四个字：连接成功'
    }).then(function (r) {
      if (!r.ok) {
        return {
          ok: false, latencyMs: Date.now() - started, message: r.message,
          modeLabel: r.modeLabel, status: r.status, raw: r.raw
        };
      }
      return {
        ok: true, latencyMs: r.latencyMs, model: r.model, modeLabel: r.modeLabel,
        text: String(r.text || '').slice(0, 40),
        message: '连接成功，实际响应模型：' + r.model
      };
    });
  }

  window.HP.LLM = {
    PROVIDERS: PROVIDERS,
    TEMP_GUIDE: TEMP_GUIDE,
    MODE_LABEL: MODE_LABEL,
    call: call,
    testConnection: testConnection,
    mockCompose: mockCompose,
    parseRules: parseRules,
    humanError: humanError,
    estimateTokens: estimateTokens,
    priceOf: priceOf,
    extractText: extractText
  };
})();
