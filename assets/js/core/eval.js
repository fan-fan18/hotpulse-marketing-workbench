/* =========================================================
   HP.Eval —— 文案评测与自动返工（核心逻辑，与界面无关）
   工作台与后台评测台都直接调用这一份：
     · machineCheck   机器校验（8 项，违禁词与编造价格是硬伤）
     · buildReviewPrompt / parseReview   模型评审（提示词可配置、解析容错）
     · totalScore     机器分与评审分加权
     · autoRework     自动返工（只修该修的，只接受改好的）
   ========================================================= */
window.HP = window.HP || {};

(function () {
  'use strict';

  /* ---------------- 违禁词（广告法高风险表述） ---------------- */
  var FORBIDDEN = ['最佳', '最好', '最低', '第一', '国家级', '顶级', '绝对', '永久', '百分百',
    '全网最低', '全网最', '唯一', '首选', '冠军', '领导品牌', '完美', '万能', '100%',
    '史上最', '包治', '根治'];

  /* 每项的元信息：level（hard 硬伤 / soft 瑕疵）、权重、是否能通过返工修复 */
  var ITEMS = {
    words: { label: '字数区间', level: 'soft', weight: 2, rework: true },
    tags: { label: '话题标签', level: 'soft', weight: 1.5, rework: true },
    emoji: { label: '表情符号数量', level: 'soft', weight: 1, rework: true },
    cta: { label: '互动引导', level: 'soft', weight: 1, rework: true },
    format: { label: '排版残留', level: 'soft', weight: 1, rework: true },
    forbidden: { label: '广告法违禁词', level: 'hard', weight: 5, rework: true },
    fakePrice: { label: '编造价格', level: 'hard', weight: 4, rework: true },
    product: { label: '是否提到商品', level: 'soft', weight: 1, rework: false }
  };

  var EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;
  var TAG_RE = /#([^#\s]{1,24})#/g;
  var CTA_RE = /评论区|评论里|扣个|扣「?1」?|扣 1|留言|私信|点赞|收藏|转发|说说|投一票|聊聊|告诉我|回复/;
  var FORMAT_RE = /\{\{|\}\}|```|\*\*|^#{1,6}\s|^[-*+]\s|\[[^\]]*\]\([^)]*\)|\n{3,}/m;

  function charCount(t) { return String(t || '').replace(/\s/g, '').length; }

  /* ---------------- 金额抽取 ---------------- */
  function extractAmounts(text) {
    var t = String(text || '');
    var out = [], seen = {};
    function push(n) {
      n = Number(n);
      if (isNaN(n) || n <= 0 || seen[n]) return;
      seen[n] = true; out.push(n);
    }
    var m;
    var re1 = /(?:¥|￥|\$)\s*(\d+(?:\.\d+)?)/g;
    while ((m = re1.exec(t))) push(m[1]);
    var re2 = /(\d+(?:\.\d+)?)\s*(?:元|块钱|块|rmb)/gi;
    while ((m = re2.exec(t))) push(m[1]);
    var re3 = /(?:省|立减|减|优惠|到手价|券后)\s*(?:¥|￥)?\s*(\d+(?:\.\d+)?)/g;
    while ((m = re3.exec(t))) push(m[1]);
    /* 价格引导词后的裸数字（如「原价 699」），要求 ≥10 或带单位，避免把「只要 3 步」当金额 */
    var re4 = /(?:原价|售价|现价|标价|到手价|券后|仅需|只要|立减|立省)\s*(?:为|是)?\s*(?:¥|￥)?\s*(\d+(?:\.\d+)?)\s*(?:元|块钱|块)?/g;
    while ((m = re4.exec(t))) {
      var n = Number(m[1]);
      if (n >= 10 || /元|块/.test(m[0]) || /[¥￥]/.test(m[0])) push(n);
    }
    return out;
  }

  /* ---------------- 从业务数据构造评测用的素材描述 ---------------- */
  function materialFrom(news, products, opt, cfgOverride) {
    opt = opt || {};
    var cfg = cfgOverride || HP.Config.get();
    var list = products || [];
    var compiled = HP.Prompt.compile(news, list, opt, cfg);
    /* 允许出现的金额分两类：素材直接给出的（售价/原价），以及由「原价 − 售价」能推出来的省额 */
    var direct = [], derived = [], seen = {};
    list.forEach(function (p) {
      [p.price, p.marketPrice].forEach(function (n) {
        n = Number(n);
        if (n > 0 && !seen[n]) { seen[n] = true; direct.push(n); }
      });
      var save = Number(p.marketPrice) - Number(p.price);
      if (save > 0 && !seen[save]) { seen[save] = true; derived.push(save); }
    });
    direct.sort(function (a, b) { return a - b; });
    derived.sort(function (a, b) { return a - b; });
    return {
      tags: (opt.tags && opt.tags.length ? opt.tags : (news && news.topics) || []).slice(0, 10),
      amounts: HP.Prompt.amountsOf(list),
      directAmounts: direct,
      derivedAmounts: derived,
      productNames: list.map(function (p) { return p.name; }),
      limits: cfg.limits,
      text: compiled.material,
      compiled: compiled
    };
  }

  /* ---------------- 机器校验 ---------------- */
  function machineCheck(copy, material, limitOverride) {
    var cfg = HP.Config.get();
    var limits = Object.assign({}, cfg.limits, (material && material.limits) || {}, limitOverride || {});
    var text = String(copy || '');
    var items = [];
    var count = charCount(text);

    function add(code, pass, reason, extra) {
      var meta = ITEMS[code];
      items.push(Object.assign({
        code: code, label: meta.label, level: meta.level, weight: meta.weight,
        rework: meta.rework, pass: !!pass, reason: reason
      }, extra || {}));
    }

    /* 1. 字数 */
    var min = Number(limits.minWords || 0), max = Number(limits.maxWords || 0);
    add('words', count >= min && count <= max,
      count < min ? '字数 ' + count + ' 字，少于下限 ' + min + ' 字'
        : count > max ? '字数 ' + count + ' 字，超出上限 ' + max + ' 字'
          : '字数 ' + count + ' 字，在 ' + min + '–' + max + ' 字区间内',
      { value: count });

    /* 2. 话题标签 */
    var tags = text.match(TAG_RE) || [];
    var required = (material && material.tags) || [];
    var missing = required.filter(function (t) { return tags.indexOf(t) < 0; });
    var maxTags = Number(limits.maxTags || 3);
    add('tags', !missing.length && tags.length <= maxTags,
      missing.length ? '缺少素材指定的话题：' + missing.join('、')
        : tags.length > maxTags ? '话题标签共 ' + tags.length + ' 个，超过上限 ' + maxTags + ' 个'
          : '话题标签 ' + tags.length + ' 个，符合要求',
      { value: tags, missing: missing });

    /* 3. 表情符号数量 */
    var emojiCount = (text.match(EMOJI_RE) || []).length;
    var emin = Number(limits.minEmoji == null ? 0 : limits.minEmoji);
    var emax = Number(limits.maxEmoji || 8);
    add('emoji', emojiCount >= emin && emojiCount <= emax,
      emojiCount < emin ? '表情符号 ' + emojiCount + ' 个，少于建议值 ' + emin + ' 个'
        : emojiCount > emax ? '表情符号 ' + emojiCount + ' 个，超过上限 ' + emax + ' 个'
          : '表情符号 ' + emojiCount + ' 个，密度合适',
      { value: emojiCount });

    /* 4. 违禁词（硬伤，权重最高） */
    var hits = FORBIDDEN.filter(function (w) { return text.indexOf(w) > -1; });
    add('forbidden', hits.length === 0,
      hits.length ? '命中违禁词：' + hits.join('、') + '（硬伤）' : '未命中广告法违禁词',
      { hits: hits });

    /* 5. 编造价格（硬伤） */
    var allowed = (material && material.amounts) || [];
    var amounts = extractAmounts(text);
    var fake = amounts.filter(function (n) { return allowed.indexOf(n) < 0; });
    var direct = (material && material.directAmounts) || [];
    var derived = (material && material.derivedAmounts) || [];
    var allowedText = allowed.length
      ? (direct.length ? direct.map(function (n) { return '¥' + n; }).join('、') : allowed.map(function (n) { return '¥' + n; }).join('、')) +
        (derived.length ? '（另有可由「原价 − 售价」推出的：' + derived.map(function (n) { return '¥' + n; }).join('、') + '）' : '')
      : '（无）';
    add('fakePrice', fake.length === 0,
      fake.length
        ? '文案出现素材里没有的金额：' + fake.map(function (n) { return '¥' + n; }).join('、') +
          '；素材里真实可用的金额：' + allowedText
        : (amounts.length ? '出现的 ' + amounts.length + ' 个金额都能在素材里找到' : '未出现任何金额'),
      { hits: fake, allowed: allowed, directAmounts: direct, derivedAmounts: derived });

    /* 6. 互动引导 */
    var hasCta = CTA_RE.test(text);
    add('cta', hasCta, hasCta ? '结尾有互动引导' : '缺少互动引导（如"评论区报个数"）');

    /* 7. 排版残留 */
    var fmt = text.match(FORMAT_RE);
    add('format', !fmt, fmt ? '出现排版残留：' + JSON.stringify(fmt[0]).slice(0, 24) : '没有 Markdown / 占位符残留');

    /* 8. 是否提到商品（改了也白改，不进返工循环） */
    var names = (material && material.productNames) || [];
    var mentioned = !names.length || names.some(function (n) {
      var key = String(n).slice(0, Math.min(6, String(n).length));
      return key && text.indexOf(key) > -1;
    });
    add('product', mentioned, mentioned ? '文案里提到了商品' : '文案里没有出现任何商品名称');

    var totalW = items.reduce(function (s, i) { return s + i.weight; }, 0);
    var gotW = items.reduce(function (s, i) { return s + (i.pass ? i.weight : 0); }, 0);
    var score = Math.round(gotW / totalW * 1000) / 10;
    var hardFail = items.some(function (i) { return i.level === 'hard' && !i.pass; });
    return {
      items: items,
      score: score,
      hardFail: hardFail,
      pass: !hardFail && score >= 90,
      failed: items.filter(function (i) { return !i.pass; }),
      counts: {
        forbidden: hits.length,
        fakePrice: fake.length,
        failedItems: items.filter(function (i) { return !i.pass; }).length
      }
    };
  }

  /* ---------------- 模型评审 ---------------- */
  function buildReviewPrompt(copy, materialText, cfgOverride) {
    var cfg = cfgOverride || HP.Config.get();
    var tpl = (cfg.prompt || {}).reviewPrompt || '';
    return String(tpl).split('{{素材}}').join(materialText || '（无素材）').split('{{文案}}').join(copy || '');
  }

  /* 解析容错：代码块包裹、前后废话、中文键名、散乱数字都能捞回来 */
  function parseReview(raw) {
    var text = String(raw || '').trim();
    if (!text) return { ok: false, reason: '模型返回为空' };
    var cleaned = text.replace(/```[a-zA-Z]*/g, '').replace(/```/g, '').trim();
    var start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
    var obj = null;
    if (start > -1 && end > start) {
      var slice = cleaned.slice(start, end + 1);
      try { obj = JSON.parse(slice); }
      catch (e) {
        try { obj = JSON.parse(slice.replace(/,\s*}/g, '}').replace(/'/g, '"')); } catch (e2) { obj = null; }
      }
    }
    function num(o, keys) {
      for (var i = 0; i < keys.length; i++) {
        var v = o && o[keys[i]];
        if (typeof v === 'number') return v;
        if (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v)) return Number(v);
      }
      return null;
    }
    var dims = null;
    if (obj) {
      dims = {
        hot: num(obj, ['hot', '热点关联度', 'relevance']),
        material: num(obj, ['material', '素材还原度', 'fidelity']),
        appeal: num(obj, ['appeal', '传播吸引力', 'attraction']),
        natural: num(obj, ['natural', '语气自然度', 'naturalness']),
        comment: obj.comment || obj.点评 || obj.评语 || ''
      };
    }
    if (!dims || dims.hot == null || dims.material == null || dims.appeal == null || dims.natural == null) {
      function grab(keys) {
        for (var i = 0; i < keys.length; i++) {
          var m = cleaned.match(new RegExp(keys[i] + '["\\s:：]*([1-5])', 'i'));
          if (m) return Number(m[1]);
        }
        return null;
      }
      dims = {
        hot: grab(['hot', '热点关联度']),
        material: grab(['material', '素材还原度']),
        appeal: grab(['appeal', '传播吸引力']),
        natural: grab(['natural', '语气自然度']),
        comment: (cleaned.match(/comment["\s:：]*(.+)/i) || [])[1] || ''
      };
    }
    if (dims.hot == null || dims.material == null || dims.appeal == null || dims.natural == null) {
      return { ok: false, reason: '模型返回的内容无法解析成评分结构（已跳过这条评审，未中断整轮）', raw: text.slice(0, 200) };
    }
    var clamp = function (n) { return Math.max(1, Math.min(5, Number(n))); };
    dims.hot = clamp(dims.hot); dims.material = clamp(dims.material);
    dims.appeal = clamp(dims.appeal); dims.natural = clamp(dims.natural);
    var avg = (dims.hot + dims.material + dims.appeal + dims.natural) / 4;
    return { ok: true, dims: dims, avg: Math.round(avg * 100) / 100, score: Math.round(avg / 5 * 1000) / 10 };
  }

  function totalScore(machineScore, reviewResult, weights) {
    var w = weights || (HP.Config.get().evalConfig && HP.Config.get().evalConfig.weights) || { machine: 0.5, review: 0.5 };
    if (!reviewResult || !reviewResult.ok) {
      return { score: Math.round(machineScore * 10) / 10, usedReview: false, weights: { machine: 1, review: 0 } };
    }
    var wm = Number(w.machine), wr = Number(w.review);
    var sum = wm + wr || 1;
    var score = (machineScore * wm + reviewResult.score * wr) / sum;
    return { score: Math.round(score * 10) / 10, usedReview: true, weights: { machine: Math.round(wm / sum * 100) / 100, review: Math.round(wr / sum * 100) / 100 } };
  }

  /**
   * 真调一次模型评审：用配置里的评审提示词与低温度，解析容错。
   * 解析不了不会抛错，而是返回 { ok:false, reason }，由调用方决定怎么展示。
   */
  function runReview(params) {
    params = params || {};
    var cfg = params.config || HP.Config.get();
    var llm = params.llm || HP.LLM.call;
    var prompt = buildReviewPrompt(params.copy, params.materialText, cfg);
    var sys = '你是严格的文案评审，只输出结构化评分。';
    var started = Date.now();
    return llm({
      mode: (cfg.model || {}).mode, kind: 'review',
      temperature: Number((cfg.prompt || {}).reviewTemperature == null ? 0.2 : cfg.prompt.reviewTemperature),
      system: sys, user: prompt,
      meta: {
        kind: 'review', copy: params.copy, materialText: params.materialText,
        products: params.products || [], limits: cfg.limits,
        system: sys, user: prompt
      }
    }).then(function (res) {
      if (!res || !res.ok) {
        return { ok: false, reason: (res && res.message) || '评审调用失败', raw: '', latencyMs: Date.now() - started };
      }
      var parsed = parseReview(res.text);
      parsed.raw = String(res.text).slice(0, 400);
      parsed.latencyMs = Date.now() - started;
      parsed.model = res.model;
      parsed.mode = res.modeLabel;
      return parsed;
    }).catch(function (e) {
      return { ok: false, reason: '评审调用异常：' + (e && e.message ? e.message : '未知原因'), raw: '', latencyMs: Date.now() - started };
    });
  }

  /* ---------------- 自动返工 ---------------- */
  function fixableIssues(check) {
    return check.items.filter(function (i) { return !i.pass && i.rework; });
  }

  /**
   * autoRework({ copy, material, maxRounds, llm, meta })
   * 只把"改了有用"的问题送去返工；温度用配置里的低温度；
   * 改完重新校验，分数没涨就保留上一版；全过程记录在 rounds 里。
   */
  function autoRework(params) {
    var cfg = HP.Config.get();
    var maxRounds = params.maxRounds == null ? 2 : Number(params.maxRounds);
    var copy = String(params.copy || '');
    var material = params.material || {};
    var meta = params.meta || {};
    var llm = params.llm || HP.LLM.call;
    var check = machineCheck(copy, material);
    var before = check.score;
    var trace = [];
    var accepted = 0;

    function round(no) {
      if (no > maxRounds) return Promise.resolve();
      var issues = fixableIssues(check);
      if (!issues.length) return Promise.resolve();

      var user = [
        (cfg.prompt || {}).reworkInstruction || '',
        '',
        '【未通过清单】',
        issues.map(function (i) { return '· [' + i.label + '] ' + i.reason; }).join('\n'),
        '',
        '【素材（商品、价格、话题只能来自这里）】',
        meta.materialText || material.text || '',
        '',
        '【待修改文案】',
        copy
      ].join('\n');

      return llm({
        mode: (cfg.model || {}).mode, kind: 'rework',
        temperature: Number((cfg.prompt || {}).reworkTemperature == null ? 0.2 : cfg.prompt.reworkTemperature),
        /* 返工时把完整规范一并带上，返工出来的文案也要守同一套规则 */
        system: (meta && meta.system) || (cfg.prompt || {}).role,
        user: user,
        meta: {
          kind: 'rework', copy: copy, issues: issues,
          limits: Object.assign({}, cfg.limits, material.limits || {}),
          products: meta.products || [], tags: material.tags || [],
          materialText: meta.materialText || material.text || '',
          system: (meta && meta.system) || (cfg.prompt || {}).role, user: user
        }
      }).then(function (res) {
        if (!res || !res.ok) {
          trace.push({ round: no, accepted: false, note: '返工调用失败：' + ((res && res.message) || '未知原因') });
          return;
        }
        var nextText = String(res.text || '').trim();
        var nextCheck = machineCheck(nextText, material);
        var fixed = issues.filter(function (i) {
          return nextCheck.items.some(function (x) { return x.code === i.code && x.pass; });
        }).map(function (i) { return i.label; });
        var remaining = fixableIssues(nextCheck).map(function (i) { return i.label; });

        if (nextCheck.score > check.score) {
          accepted++;
          trace.push({
            round: no, accepted: true,
            scoreBefore: check.score, scoreAfter: nextCheck.score,
            fixed: fixed, remaining: remaining,
            note: '分数提升 ' + (Math.round((nextCheck.score - check.score) * 10) / 10) + ' 分，采纳该版本'
          });
          copy = nextText; check = nextCheck;
          return round(no + 1);
        }
        trace.push({
          round: no, accepted: false,
          scoreBefore: check.score, scoreAfter: nextCheck.score,
          fixed: fixed, remaining: remaining,
          note: '改后分数没有提升（' + nextCheck.score + ' ≤ ' + check.score + '），保留上一版'
        });
      });
    }

    return round(1).then(function () {
      return {
        text: copy,
        check: check,
        rounds: trace,
        acceptedRounds: accepted,
        before: before,
        after: check.score,
        improved: check.score > before
      };
    });
  }

  /* =========================================================
     批量评测：任务编排 / 并发控制 / 中途叫停 / 汇总 / A-B 对比
     ========================================================= */
  function buildTaskList(params) {
    var tasks = [];
    var repeats = Math.max(1, Number(params.repeats || 1));
    (params.cases || []).forEach(function (c) {
      (params.styles || []).forEach(function (s) {
        for (var r = 1; r <= repeats; r++) {
          tasks.push({ caseId: c.id, caseName: c.name, style: s, repeat: r, key: c.id + '|' + s.id + '|' + r });
        }
      });
    });
    return tasks;
  }

  /* 跑一条任务：编译提示词 → 生成 → 机器校验 →（可选）自动返工 →（可选）模型评审 → 综合分 */
  function runTask(task, ctx) {
    var c = ctx.caseMap[task.caseId];
    var conf = ctx.config;
    var material = materialFrom(c.news, c.products, {
      style: task.style, tone: c.tone, tags: c.tags, emojiLevel: c.emojiLevel, extra: c.extra
    }, conf);
    var compiled = HP.Prompt.compile(c.news, c.products, {
      style: task.style, tone: c.tone, tags: c.tags, emojiLevel: c.emojiLevel, extra: c.extra
    }, conf);
    var t0 = Date.now();
    var tokens = { input: 0, output: 0 };
    var record = {
      key: task.key, caseId: task.caseId, caseName: task.caseName, style: task.style.name,
      repeat: task.repeat, status: 'running', startedAt: new Date().toISOString()
    };
    var llm = function (o) {
      return HP.LLM.call(o).then(function (r) {
        if (r && r.ok && r.usage) {
          tokens.input += r.usage.inputTokens || 0;
          tokens.output += r.usage.outputTokens || 0;
        }
        return r;
      });
    };

    return llm({
      system: compiled.system, user: compiled.material, kind: 'compose', temperature: conf.model.temperature,
      meta: {
        kind: 'compose', news: c.news, products: c.products, limits: conf.limits,
        style: task.style, tone: c.tone, tags: c.tags, emojiLevel: c.emojiLevel, extra: c.extra,
        system: compiled.system, user: compiled.material, delay: ctx.fastMock ? 12 : 220
      }
    }).then(function (res) {
      if (!res || !res.ok) {
        record.status = 'failed';
        record.error = (res && res.message) || '生成失败';
        record.latencyMs = Date.now() - t0;
        return record;
      }
      record.copy = res.text;
      record.model = res.model;
      record.mode = res.modeLabel;
      record.machine = machineCheck(res.text, material);
      record.promptSnapshot = null;

      var needRework = ctx.autoRework && fixableIssues(record.machine).length > 0;
      var chain = needRework
        ? autoRework({
          copy: res.text, material: material, maxRounds: ctx.maxReworkRounds, llm: llm,
          meta: { products: c.products, materialText: material.text, system: compiled.system }
        })
        : Promise.resolve(null);

      return chain.then(function (rw) {
        if (rw) {
          record.rework = {
            rounds: rw.rounds, acceptedRounds: rw.acceptedRounds,
            before: rw.before, after: rw.after, improved: rw.improved
          };
          if (rw.improved) { record.copy = rw.text; record.machine = rw.check; }
        }
        if (!ctx.enableReview) return record;
        return runReview({
          copy: record.copy, materialText: material.text, products: c.products, config: conf, llm: llm
        }).then(function (rv) {
          record.review = rv;
          return record;
        });
      });
    }).then(function (rec) {
      rec.latencyMs = Date.now() - t0;
      rec.tokens = tokens;
      rec.cost = HP.LLM.priceOf(tokens.input, tokens.output, conf.model);
      var total = totalScore(rec.machine ? rec.machine.score : 0, rec.review, ctx.weights);
      rec.totalScore = total.score;
      rec.usedReview = total.usedReview;
      if (rec.status !== 'failed') rec.status = 'done';
      return rec;
    });
  }

  function runEval(params) {
    params = params || {};
    var started = Date.now();
    var cases = params.cases || [];
    var caseMap = {};
    cases.forEach(function (c) { caseMap[c.id] = c; });
    var tasks = buildTaskList({ cases: cases, styles: params.styles, repeats: params.repeats });
    var concurrency = Math.max(1, Number(params.concurrency || 3));
    var results = [];
    var cursor = 0;
    var stopped = false;
    var ctx = {
      caseMap: caseMap,
      config: params.config || HP.Config.get(),
      autoRework: !!params.autoRework,
      maxReworkRounds: params.maxReworkRounds,
      enableReview: !!params.enableReview,
      weights: params.weights,
      fastMock: !!params.fastMock
    };
    function isStopped() { return stopped || (params.isStopped && params.isStopped()); }
    function worker() {
      if (isStopped()) return Promise.resolve();
      var i = cursor++;
      if (i >= tasks.length) return Promise.resolve();
      return runTask(tasks[i], ctx).then(function (rec) {
        results.push(rec);
        if (params.onProgress) params.onProgress({ done: results.length, total: tasks.length, record: rec });
        return worker();
      });
    }
    var workers = [];
    for (var w = 0; w < concurrency; w++) workers.push(worker());
    return Promise.all(workers).then(function () {
      return {
        summary: summarize(results, tasks.length, Date.now() - started),
        results: results,
        stopped: isStopped()
      };
    });
  }

  function summarize(results, total, elapsedMs) {
    results = results || [];
    var done = results.filter(function (r) { return r.status === 'done'; });
    var failed = results.filter(function (r) { return r.status === 'failed'; });
    var scored = done.filter(function (r) { return typeof r.totalScore === 'number'; });
    var reviewed = done.filter(function (r) { return r.review && r.review.ok; });
    var avg = function (arr) { return arr.length ? Math.round(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length * 10) / 10 : 0; };
    var tokens = results.reduce(function (s, r) { return s + ((r.tokens && (r.tokens.input + r.tokens.output)) || 0); }, 0);
    var cost = results.reduce(function (s, r) { return s + (r.cost || 0); }, 0);
    return {
      total: total, completed: results.length, done: done.length, failed: failed.length,
      avgScore: avg(scored.map(function (r) { return r.totalScore; })),
      machinePassRate: done.length ? Math.round(done.filter(function (r) { return r.machine.pass; }).length / done.length * 1000) / 10 : 0,
      reviewAvg: reviewed.length ? Math.round(reviewed.reduce(function (s, r) { return s + r.review.avg; }, 0) / reviewed.length * 100) / 100 : null,
      reviewFailed: done.filter(function (r) { return r.review && !r.review.ok; }).length,
      forbiddenHits: done.reduce(function (s, r) { return s + (r.machine.counts.forbidden || 0); }, 0),
      fakePriceCount: done.reduce(function (s, r) { return s + (r.machine.counts.fakePrice || 0); }, 0),
      reworkAccepted: done.filter(function (r) { return r.rework && r.rework.acceptedRounds > 0; }).length,
      reworkImproved: done.filter(function (r) { return r.rework && r.rework.improved; }).length,
      tokens: tokens,
      cost: Math.round(cost * 10000) / 10000,
      elapsedMs: elapsedMs
    };
  }

  /* 把一次运行里的失败项按类型汇总，给出可执行的提示词改进建议（第六段） */
  function suggestFixes(results) {
    var counter = {};
    (results || []).forEach(function (r) {
      if (!r.machine) return;
      r.machine.items.forEach(function (i) {
        if (i.pass) return;
        counter[i.code] = (counter[i.code] || 0) + 1;
      });
    });
    var RULES = {
      words: {
        title: '字数严重超标/不足',
        reason: '软性描述（如"篇幅控制在多少字"）模型基本不听，要写成硬要求。',
        rule: '篇幅必须控制在 {{字数下限}}–{{字数上限}} 字之间：写完自己数一遍，超了就删，宁可少写一个卖点也不能超。'
      },
      fakePrice: {
        title: '出现编造价格',
        reason: '价格类信息最容易瞎编，要加死约束。',
        rule: '金额只能原样使用素材里给出的数字：素材没给的价格、折扣、销量、库存一律不许出现，也不许自行换算或推算。'
      },
      format: {
        title: '格式不稳定（排版残留）',
        reason: '要加一个范例；范例本身必须满足所有约束（例如它自己就得在字数区间内），否则范例会反过来把模型教坏。',
        rule: null
      },
      forbidden: {
        title: '命中广告法违禁词',
        reason: '违禁词是硬伤，必须在规范里点名禁止。',
        rule: '严禁使用这些词：最佳、最好、最低、第一、国家级、顶级、绝对、永久、百分百、全网最低、唯一、首选、冠军、领导品牌、完美、万能。'
      },
      tags: { title: '话题标签不合规', reason: '要明确"必须包含素材给出的话题，且总数不超过上限"。', rule: '必须包含素材给出的话题标签，且全文话题总数不超过 {{话题标签上限}} 个。' },
      cta: { title: '缺少互动引导', reason: '结尾必须有互动引导，否则影响传播。', rule: '结尾必须有一句互动引导（引导读者评论、留言或私信）。' },
      emoji: { title: '表情符号数量不合适', reason: '表情数量要落在建议区间内。', rule: '全文表情符号控制在 1–8 个之间。' },
      product: { title: '没有提到商品', reason: '文案必须落到具体商品上（这条改了也白改，建议检查素材或风格要求）。', rule: null }
    };
    return Object.keys(counter).sort(function (a, b) { return counter[b] - counter[a]; }).map(function (code) {
      var meta = RULES[code] || { title: code, reason: '', rule: null };
      return { code: code, count: counter[code], title: meta.title, reason: meta.reason, rule: meta.rule };
    });
  }

  /* A/B 对比：指标涨跌 + 逐条用例对比 + 提示词差异 */
  /* 给每次运行一个可辨认的短标识：提示词快照哈希 + 日期时间 */
  function shortId(promptSnapshot) {
    var s = JSON.stringify(promptSnapshot || {});
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1679616;
    var tag = h.toString(36);
    while (tag.length < 4) tag = '0' + tag;
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return tag + '-' + p(d.getMonth() + 1) + p(d.getDate()) + 'T' + p(d.getHours()) + p(d.getMinutes());
  }

  function compareRuns(a, b) {
    var metrics = [
      { key: 'avgScore', label: '总分', higherBetter: true },
      { key: 'machinePassRate', label: '机器校验通过率', higherBetter: true, unit: '%' },
      { key: 'reviewAvg', label: '评审均分', higherBetter: true },
      { key: 'forbiddenHits', label: '违禁词命中数', higherBetter: false },
      { key: 'fakePriceCount', label: '编造价格数', higherBetter: false },
      { key: 'cost', label: '总花费', higherBetter: false, unit: '元' },
      { key: 'elapsedMs', label: '总耗时', higherBetter: false, unit: 'ms' }
    ];
    var rows = metrics.map(function (m) {
      var av = a.summary[m.key] == null ? 0 : a.summary[m.key];
      var bv = b.summary[m.key] == null ? 0 : b.summary[m.key];
      var delta = Math.round((bv - av) * 100) / 100;
      return {
        label: m.label, a: av, b: bv, delta: delta, unit: m.unit || '',
        better: delta === 0 ? null : (m.higherBetter ? delta > 0 : delta < 0)
      };
    });
    var aMap = {}, bMap = {};
    (a.results || []).forEach(function (r) { aMap[r.key] = r; });
    (b.results || []).forEach(function (r) { bMap[r.key] = r; });
    var perCase = Object.keys(bMap).map(function (k) {
      var ra = aMap[k], rb = bMap[k];
      var sa = ra && typeof ra.totalScore === 'number' ? ra.totalScore : null;
      var sb = rb && typeof rb.totalScore === 'number' ? rb.totalScore : null;
      return {
        key: k, caseName: rb.caseName, style: rb.style, a: sa, b: sb,
        delta: (sa == null || sb == null) ? null : Math.round((sb - sa) * 10) / 10,
        worse: sa != null && sb != null && sb < sa
      };
    });
    return {
      metrics: rows, perCase: perCase,
      worse: perCase.filter(function (x) { return x.worse; }).sort(function (x, y) { return x.delta - y.delta; }),
      promptDiff: promptDiff(a.promptSnapshot, b.promptSnapshot),
      suggest: suggestFixes(b.results)
    };
  }

  function promptDiff(pa, pb) {
    pa = pa || {}; pb = pb || {};
    var fields = [
      { key: 'role', label: '角色设定' },
      { key: 'rules', label: '写作规范' },
      { key: 'materialTemplate', label: '素材模板' },
      { key: 'productTemplate', label: '单件商品呈现格式' },
      { key: 'example', label: '范例' },
      { key: 'reworkInstruction', label: '返工说明' },
      { key: 'reviewPrompt', label: '评审提示词' }
    ];
    function norm(v) { return Array.isArray(v) ? v.join('\n') : String(v == null ? '' : v); }
    var out = [];
    fields.forEach(function (f) {
      var a = norm(pa[f.key]), b = norm(pb[f.key]);
      if (a !== b) out.push({ label: f.label, a: a.slice(0, 200), b: b.slice(0, 200), aLen: a.length, bLen: b.length });
    });
    return out;
  }

  /* 从真实业务数据一键生成种子用例：热点 + 该热点的推荐商品 + 语调 */
  function seedCases() {
    var conf = HP.Config.get();
    var news = (window.MOCK && window.MOCK.NEWS) || [];
    var out = [];
    news.slice(0, 6).forEach(function (n, i) {
      var mapped = (window.MOCK.MATCH_MAP && window.MOCK.MATCH_MAP[n.id]) || [];
      var ids = mapped.slice(0, 2).map(function (m) { return m.pid; })
        .filter(function (id) { return conf.products.some(function (p) { return p.id === id; }); });
      if (!ids.length) ids = conf.products.slice(0, 2).map(function (p) { return p.id; });
      var tone = (conf.tones[i % Math.max(1, conf.tones.length)] || { name: '热点借势' }).name;
      out.push({
        id: 'case_' + n.id,
        name: n.title.slice(0, 16),
        newsId: n.id,
        productIds: ids,
        tags: (n.topics || []).slice(0, 2),
        tone: tone,
        emojiLevel: 1,
        selected: true
      });
    });
    return out;
  }

  window.HP.Eval = {
    FORBIDDEN: FORBIDDEN,
    ITEMS: ITEMS,
    charCount: charCount,
    extractAmounts: extractAmounts,
    materialFrom: materialFrom,
    machineCheck: machineCheck,
    buildReviewPrompt: buildReviewPrompt,
    parseReview: parseReview,
    runReview: runReview,
    totalScore: totalScore,
    fixableIssues: fixableIssues,
    autoRework: autoRework,
    buildTaskList: buildTaskList,
    runTask: runTask,
    runEval: runEval,
    summarize: summarize,
    shortId: shortId,
    compareRuns: compareRuns,
    promptDiff: promptDiff,
    suggestFixes: suggestFixes,
    seedCases: seedCases
  };
})();
