/* =========================================================
   HP.Prompt —— 占位符渲染 / 素材拼装 / 提示词编译
   规则：
   · 未知占位符原样保留（不替换成空白），运营写错时一眼能看出来
   · 支持嵌套：{{商品清单}} 内部的每一件，按「单件商品呈现格式」渲染后再拼起来
   ========================================================= */
window.HP = window.HP || {};

(function () {
  'use strict';

  /* ---------------- 占位符清单 ---------------- */
  var PLACEHOLDERS = [
    { key: '热点标题', desc: '当前选中热点的新闻标题', group: '热点素材' },
    { key: '热点摘要', desc: '热点的摘要正文', group: '热点素材' },
    { key: '来源', desc: '热点来源媒体 / 平台名称', group: '热点素材' },
    { key: '热度值', desc: '热点热度分（0–1000）', group: '热点素材' },
    { key: '热点关键词', desc: '中文顿号分隔的关键词，如「冷空气、一夜入秋」', group: '热点素材' },
    { key: '热度趋势', desc: '近 7 个采样点的热度走势，如 22→30→…→96', group: '热点素材' },
    { key: '话题标签', desc: '本次可用话题标签，如「#冷空气来了# #一夜入秋#」', group: '热点素材' },
    { key: '当前日期', desc: '生成时的日期，如 2026-09-20', group: '热点素材' },

    { key: '商品清单', desc: '嵌套占位符：每件商品按「单件商品呈现格式」渲染后逐行拼接', group: '商品素材' },
    { key: '商品数量', desc: '本次绑定的商品件数', group: '商品素材' },
    { key: '主推商品', desc: '主推商品名称（绑定列表里的第一件）', group: '商品素材' },
    { key: '主推价格', desc: '主推商品售价，如 ¥299', group: '商品素材' },
    { key: '主推原价', desc: '主推商品划线价，如 ¥599', group: '商品素材' },
    { key: '折扣率', desc: '主推商品折扣，如 5.0 折', group: '商品素材' },
    { key: '卖点列表', desc: '主推商品卖点，顿号分隔', group: '商品素材' },
    { key: '可用金额', desc: '素材里允许出现的全部金额（防止模型编造价格）', group: '商品素材' },

    { key: '语调', desc: '本次主打语调（来自后台的语调预设）', group: '本次要求' },
    { key: '创作风格', desc: '当前这次生成使用的创作风格名称', group: '本次要求' },
    { key: '风格要求', desc: '该创作风格对应的创作要求原文', group: '本次要求' },
    { key: '字数下限', desc: '允许的最小字数（来自后台阈值配置）', group: '本次要求' },
    { key: '字数上限', desc: '允许的最大字数（来自后台阈值配置）', group: '本次要求' },
    { key: '话题标签上限', desc: '全文允许出现的话题标签数量上限', group: '本次要求' },
    { key: '表情强度', desc: '表情符号使用强度（不使用 / 适中 / 丰富）', group: '本次要求' },
    { key: '附加要求', desc: '运营在工作台临时填写的附加要求，没有则为空', group: '本次要求' },

    { key: '序号', desc: '商品在清单中的序号，从 1 开始（仅单件格式可用）', group: '单件商品格式' },
    { key: '商品名称', desc: '商品名称（仅单件格式可用）', group: '单件商品格式' },
    { key: '品牌', desc: '商品品牌（仅单件格式可用）', group: '单件商品格式' },
    { key: '编号', desc: '商品 SKU 编号（仅单件格式可用）', group: '单件商品格式' },
    { key: '图标', desc: '商品图标 Emoji（仅单件格式可用）', group: '单件商品格式' },
    { key: '品类', desc: '商品品类（仅单件格式可用）', group: '单件商品格式' },
    { key: '售价', desc: '商品售价，如 ¥299（仅单件格式可用）', group: '单件商品格式' },
    { key: '原价', desc: '商品划线价，如 ¥599（仅单件格式可用）', group: '单件商品格式' },
    { key: '节省金额', desc: '原价减售价，如 ¥300（仅单件格式可用）', group: '单件商品格式' },
    { key: '商品折扣率', desc: '单品折扣，如 5.0 折（仅单件格式可用）', group: '单件商品格式' },
    { key: '主推标记', desc: '主推商品显示「（主推）」，其余为空（仅单件格式可用）', group: '单件商品格式' },
    { key: '商品说明', desc: '该商品的一句话说明，如「近 30 天卖出 1.2 万 件」', group: '单件商品格式' }
  ];

  var KNOWN = {};
  PLACEHOLDERS.forEach(function (p) { KNOWN[p.key] = true; });

  /* ---------------- 数值格式化 ---------------- */
  function yuan(n) { return '¥' + Number(n); }
  function discount(price, market) {
    var d = Number(price) / Number(market) * 10;
    return (Math.round(d * 10) / 10).toFixed(1) + ' 折';
  }
  function fmtNum(n) {
    n = Number(n);
    return n >= 10000 ? (n / 10000).toFixed(1) + ' 万' : String(n);
  }

  function productCtx(p, index, total, mainId) {
    var isMain = (mainId == null) ? index === 0 : p.id === mainId;
    return {
      '序号': String(index + 1),
      '商品名称': p.name,
      '品牌': p.brand || '',
      '编号': p.sku || p.id,
      '图标': p.emoji || '',
      '品类': p.cat || '',
      '售价': yuan(p.price),
      '原价': yuan(p.marketPrice),
      '节省金额': yuan(Number(p.marketPrice) - Number(p.price)),
      '商品折扣率': discount(p.price, p.marketPrice),
      '折扣率': discount(p.price, p.marketPrice),
      '主推标记': isMain ? '（主推）' : '',
      '卖点列表': (p.points || []).join('、'),
      '商品说明': '近 30 天卖出 ' + fmtNum(p.sales30d || 0) + ' 件、转化率 ' + (p.conversion || 0) + '%',
      '商品数量': String(total)
    };
  }

  /* ---------------- 渲染 ---------------- */
  var TOKEN = /\{\{\s*([^{}]{1,24}?)\s*\}\}/g;

  function render(template, ctx, opts) {
    opts = opts || {};
    var depth = opts.depth || 0;
    var unknown = opts.unknown || [];
    var text = String(template == null ? '' : template);

    var out = text.replace(TOKEN, function (match, rawKey) {
      var key = rawKey.trim();
      var v = ctx ? ctx[key] : undefined;

      if (typeof v === 'function') {
        if (depth > 3) { unknown.push(key); return match; }   // 嵌套过深：原样保留，避免死循环
        return v(depth + 1);
      }
      if (v === undefined || v === null) {
        if (!KNOWN[key]) unknown.push(key);
        return match;                                          // 未知占位符原样保留
      }
      return String(v);
    });

    return { text: out, unknown: unknown };
  }

  /* ---------------- 运行时上下文 ---------------- */
  function contextFrom(news, products, opt, cfgOverride) {
    opt = opt || {};
    var cfg = cfgOverride || HP.Config.get();
    var lim = cfg.limits || {};
    var list = products || [];
    var main = list[0] || null;
    var productTpl = (cfg.prompt && cfg.prompt.productTemplate) || '{{商品名称}}';

    var ctx = {
      '热点标题': news ? news.title : '',
      '热点摘要': news ? news.summary : '',
      '来源': news ? news.source : '',
      '热度值': news ? String(news.heat == null ? '' : news.heat) : '',
      '热点关键词': news ? (news.keywords || []).join('、') : '',
      '热度趋势': news ? (news.spark || []).join('→') : '',
      '话题标签': (opt.tags || (news ? news.topics : []) || []).join(' '),
      '当前日期': new Date().toISOString().slice(0, 10),

      '商品数量': String(list.length),
      '主推商品': main ? main.name : '',
      '主推价格': main ? yuan(main.price) : '',
      '主推原价': main ? yuan(main.marketPrice) : '',
      '折扣率': main ? discount(main.price, main.marketPrice) : '',
      '卖点列表': main ? (main.points || []).join('、') : '',
      '可用金额': amountsOf(list).map(function (n) { return '¥' + n; }).join('、'),
      '商品清单': function (depth) {
        if (!list.length) return '（暂无商品）';
        return list.map(function (p, i) {
          var merged = Object.assign({}, ctx, productCtx(p, i, list.length, main ? main.id : null));
          return render(productTpl, merged, { depth: depth, unknown: [] }).text;
        }).join('\n');
      },

      '语调': opt.tone || '',
      '创作风格': opt.style ? opt.style.name : '',
      '风格要求': opt.style ? opt.style.requirement : '',
      '字数下限': String(lim.minWords == null ? '' : lim.minWords),
      '字数上限': String(lim.maxWords == null ? '' : lim.maxWords),
      '话题标签上限': String(lim.maxTags == null ? '' : lim.maxTags),
      '表情强度': ['不使用', '适中', '丰富'][opt.emojiLevel == null ? 1 : Number(opt.emojiLevel)] || '适中',
      '附加要求': opt.extra ? String(opt.extra) : ''
    };

    /* 单件格式里的占位符，在主模板里也能直接用（作用于主推商品） */
    if (main) Object.assign(ctx, productCtx(main, 0, list.length, main.id));
    return ctx;
  }

  function amountsOf(products) {
    var set = {};
    (products || []).forEach(function (p) {
      [p.price, p.marketPrice, Number(p.marketPrice) - Number(p.price)].forEach(function (n) {
        n = Number(n);
        if (!isNaN(n) && n > 0) set[n] = true;
      });
    });
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }

  /* ---------------- 编译：真正发给模型的两块内容 ---------------- */
  function compile(news, products, opt, cfgOverride) {
    opt = opt || {};
    var cfg = cfgOverride || HP.Config.get();
    var ctx = contextFrom(news, products, opt, cfg);
    var unknown = [];
    var promptCfg = cfg.prompt || {};

    var rulesText = (promptCfg.rules || []).map(function (r, i) {
      return (i + 1) + '. ' + render(r, ctx, { unknown: unknown }).text;
    }).join('\n');

    var example = render(promptCfg.example || '', ctx, { unknown: unknown }).text;
    var system = [
      render(promptCfg.role || '', ctx, { unknown: unknown }).text,
      '',
      '【写作规范】',
      rulesText,
      example ? '\n【范例（必须满足上面全部约束，字数也要在区间内）】\n' + example : ''
    ].join('\n').replace(/\n{3,}/g, '\n\n').trim();

    var material = render(promptCfg.materialTemplate || '', ctx, { unknown: unknown }).text;

    return {
      system: system,
      material: material,
      user: material,
      context: ctx,
      unknown: Array.from(new Set(unknown)),
      stats: { systemChars: charCount(system), materialChars: charCount(material) }
    };
  }

  function charCount(text) { return String(text || '').replace(/\s/g, '').length; }

  /* ---------------- 预览 / 测试用示例素材 ---------------- */
  function sampleList() {
    var news = (window.MOCK && window.MOCK.NEWS) || [];
    var cfg = HP.Config.get();
    var out = [];
    [news[0], news[1], news[3]].filter(Boolean).forEach(function (n) {
      var mapped = (window.MOCK.MATCH_MAP && window.MOCK.MATCH_MAP[n.id]) || [];
      var prods = mapped.slice(0, 3).map(function (m) {
        return (cfg.products || []).filter(function (p) { return p.id === m.pid; })[0];
      }).filter(Boolean);
      if (!prods.length) prods = (cfg.products || []).slice(0, 2);
      out.push({ id: 'sample_' + n.id, label: n.title.slice(0, 18), news: n, products: prods });
    });
    if (!out.length) {
      out.push({
        id: 'sample_empty', label: '示例素材（无热点数据）',
        news: { title: '示例热点：冷空气来袭，多地一夜入秋', summary: '示例摘要', source: '示例来源', heat: 900, keywords: ['降温', '保暖'], topics: ['#冷空气来了#'], spark: [40, 55, 70, 88] },
        products: (cfg.products || []).slice(0, 2)
      });
    }
    return out;
  }

  window.HP.Prompt = {
    PLACEHOLDERS: PLACEHOLDERS,
    KNOWN: KNOWN,
    GROUPS: ['热点素材', '商品素材', '本次要求', '单件商品格式'],
    render: render,
    compile: compile,
    contextFrom: contextFrom,
    productCtx: productCtx,
    amountsOf: amountsOf,
    sampleList: sampleList,
    charCount: charCount,
    yuan: yuan,
    discount: discount
  };
})();
