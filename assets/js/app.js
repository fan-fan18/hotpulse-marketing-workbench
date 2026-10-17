/* =========================================================
   HotPulse 工作台主逻辑（纯前端 Demo）
   5 步流程：新闻抓取 → 建议匹配 → 深度匹配 → 创作文案 → 审核发送
   ========================================================= */
(function () {
  'use strict';

  const { NEWS, MATCH_MAP, CTAS } = window.MOCK;

  /* 商品库与提示词都来自后台配置（后台改完保存，这里下一次生成立即生效） */
  const cfg = () => window.HP.Config.get();
  const allProducts = () => cfg().products || [];

  /* ---------------- 状态 ---------------- */
  const STEPS = [
    { n: 1, title: '新闻抓取', desc: '热点新闻列表与抓取控制' },
    { n: 2, title: '建议匹配商品', desc: '系统自动推荐热点-商品关联' },
    { n: 3, title: '匹配商品', desc: '手动筛选并绑定商品库' },
    { n: 4, title: '创作文案', desc: 'LLM 生成与多版本微调' },
    { n: 5, title: '审核并发送', desc: '合规审核与模拟发布' }
  ];

  const state = {
    step: 1,
    news: [],
    newsFilter: { cat: '全部', keyword: '', source: 'all', time: 'all', sort: 'heat' },
    selectedNewsId: null,
    candidates: [],          // Step2 采纳的商品
    bound: [],               // Step3 绑定商品库（第一位为主推）
    matchSort: 'score',
    libFilter: { cat: '全部', keyword: '', min: null, max: null, rating: 0, onlyStock: false, sort: 'match' },
    copy: {
      styles: [],            // 选中的创作风格 id（空 = 全部启用）
      tone: '',
      emoji: 1, tags: [], points: [], extra: '',
      generating: false, versions: [], selectedId: null, seed: 0
    },
    review: { status: 'wait', published: false, checks: [], blocked: false },
    /* 统计一律来自真实数据：不再有写死的"累计抓取量" */
    stats: { lastFetch: null, lastFetchNote: '' },
    logs: []
  };

  /* ---------------- 工具 ---------------- */
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.prototype.slice.call(document.querySelectorAll(sel));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '¥' + (Math.round(n * 100) / 100).toLocaleString('zh-CN');
  const clock = d => new Date(d).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const fmtNum = n => n >= 10000 ? (n / 10000).toFixed(1) + ' 万' : n.toLocaleString('zh-CN');
  const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997; return h; };

  /* ---------------- 新闻来源：由后台配置的"启用来源"决定 ---------------- */
  function enabledSources() {
    return (cfg().sources || []).filter(s => s.enabled);
  }

  function keywordsFrom(title) {
    const parts = String(title || '').split(/[，,。！!？?：:；;、\s丨|]+/).filter(t => t.length >= 2);
    const out = [];
    parts.forEach(t => {
      const k = t.slice(0, 6);
      if (out.indexOf(k) < 0 && out.length < 3) out.push(k);
    });
    return out.length ? out : [String(title || '').slice(0, 6)];
  }

  function customNews(source, item, i) {
    const h = hash(item.title + source.id);
    return {
      id: 'cs_' + source.id + '_' + i,
      sourceId: source.id,
      cat: '自定义订阅',
      source: source.name,
      time: '刚刚抓取',
      minutesAgo: 5 + i,
      title: item.title,
      summary: item.summary || ('来自订阅源「' + source.name + '」的条目，点击可查看原文链接。'),
      heat: 700 + (h % 120),
      growth: 8 + (h % 20),
      keywords: keywordsFrom(item.title),
      tags: ['自定义订阅'],
      topics: [],
      spark: [30, 36, 43, 50, 58, 66, 74],
      link: item.link || ''
    };
  }

  /* 已启用来源的内置新闻 + 自定义订阅源抓到的条目 */
  function buildNews() {
    const on = {};
    enabledSources().forEach(s => { on[s.id] = s; });
    const builtin = (window.MOCK.NEWS || [])
      .filter(n => !n.sourceId || on[n.sourceId])
      .map(n => Object.assign({}, n));
    const custom = [];
    enabledSources().forEach(s => {
      (s.items || []).slice(0, 10).forEach((it, i) => custom.push(customNews(s, it, i)));
    });
    return builtin.concat(custom);
  }

  function refreshNews() {
    const prev = {};
    state.news.forEach(n => { prev[n.id] = n; });
    state.news = buildNews().map(n => {
      const old = prev[n.id];
      return old ? Object.assign({}, n, { heat: old.heat, growth: old.growth }) : n;
    });
  }
  const getNews = id => state.news.find(n => n.id === id) || null;
  const getProduct = id => allProducts().find(p => p.id === id) || null;
  const activeProduct = () => getProduct(state.bound[0]) || null;

  function toast(msg, type) {
    const wrap = $('#toastWrap');
    const t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.innerHTML = '<span class="ti">' + (type === 'warn' ? '!' : type === 'ok' ? '✓' : 'i') + '</span><span>' + esc(msg) + '</span>';
    wrap.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, 2400);
  }

  function logEvent(title, text) {
    state.logs.unshift({ title, text, time: clock(new Date()) });
    renderTimeline();
  }

  function copyText(text, label) {
    const done = () => toast((label || '文案') + '已复制到剪贴板', 'ok');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallback());
    } else fallback();
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请手动选择文本', 'warn'); }
      ta.remove();
    }
  }

  function confirmModal(title, text, okText, onOk) {
    $('#modalTitle').textContent = title;
    $('#modalText').innerHTML = text;
    $('#modalOk').textContent = okText || '确认';
    $('#modalMask').hidden = false;
    const close = () => { $('#modalMask').hidden = true; $('#modalOk').onclick = null; $('#modalCancel').onclick = null; };
    $('#modalCancel').onclick = close;
    $('#modalOk').onclick = () => { close(); onOk && onOk(); };
  }

  /* ---------------- 匹配算法（模拟） ---------------- */
  function matchesFor(news) {
    if (!news) return [];
    /* 预设的热点-商品关系（运营在商品库里新增的商品也要有机会被推荐，
       所以下面是"预设 + 语义兜底"合并，而不是命中预设就不再兜底） */
    const preset = (MATCH_MAP[news.id] || [])
      .map(m => ({ product: getProduct(m.pid), score: m.score, reason: m.reason }))
      .filter(m => m.product);
    const seen = new Set(preset.map(m => m.product.id));

    const kw = (news.keywords || []).concat([news.cat]);
    const extra = allProducts().filter(p => !seen.has(p.id)).map(p => {
      const text = (p.name + p.brand + p.cat + (p.points || []).join('') + p.emoji).toLowerCase();
      let overlap = 0;
      kw.forEach(k => { if (k && text.indexOf(String(k).slice(0, 2).toLowerCase()) > -1) overlap++; });
      const score = Math.min(94, 58 + overlap * 11 + Math.round(((p.rating || 4.8) - 4.5) * 12) + (hash(p.id + news.id) % 7));
      return {
        product: p, score,
        reason: '系统按「' + esc(news.keywords[0] || news.cat) + '」等关键词与品类语义匹配到的' + esc(p.cat || '商品') +
          '，近 30 天转化率 ' + (p.conversion || 0) + '%，可作为热点延展的备选。'
      };
    }).filter(m => m.score >= 62).sort((a, b) => b.score - a.score).slice(0, 4);

    return preset.concat(extra).sort((a, b) => b.score - a.score);
  }

  function scoreOf(productId) {
    const news = getNews(state.selectedNewsId);
    const list = matchesFor(news);
    const hit = list.find(m => m.product.id === productId);
    if (hit) return hit.score;
    return 52 + (hash(productId) % 30);
  }

  /* ---------------- 左侧流程导航 & 顶部上下文 ---------------- */
  function stepState(n) {
    const hasNews = !!state.selectedNewsId;
    const hasBound = state.bound.length > 0;
    const hasCopy = state.copy.versions.length > 0;
    const hasReview = state.review.status === 'pass' || state.review.published;
    const done = { 1: hasNews, 2: hasBound, 3: hasBound, 4: hasCopy, 5: hasReview };
    if (done[n]) return 'done';
    if (state.step === n) return 'cur';
    return 'idle';
  }

  function renderStepNav() {
    const nav = $('#stepNav');
    nav.innerHTML = STEPS.map(s => {
      const st = stepState(s.n);
      const badge = st === 'done' ? '<span class="step-state done">已完成</span>'
        : st === 'cur' ? '<span class="step-state cur">进行中</span>' : '';
      return '<li class="step-item ' + (st === 'done' ? 'done ' : '') + (state.step === s.n ? 'active' : '') + '" data-step="' + s.n + '">' +
        '<span class="step-index">' + (st === 'done' ? '✓' : 'S' + s.n) + '</span>' +
        '<div class="step-body"><div class="step-title">Step ' + s.n + ' · ' + s.title + '</div>' +
        '<div class="step-desc">' + s.desc + '</div></div>' + badge + '</li>';
    }).join('');

    nav.querySelectorAll('.step-item').forEach(li => {
      li.addEventListener('click', () => goStep(Number(li.dataset.step)));
    });
  }

  function renderContextBar() {
    const news = getNews(state.selectedNewsId);
    const v = state.copy.versions.find(x => x.id === state.copy.selectedId);
    const statusMap = state.review.published ? ['已发布', 'published'] : state.review.status === 'pass' ? ['已通过审核', 'pass'] : ['未审核', 'wait'];
    const parts = [];
    parts.push('<span class="ctx-label">当前热点</span>');
    parts.push(news
      ? '<span class="ctx-title">' + esc(news.title) + '</span>'
      : '<span class="ctx-title ctx-empty">尚未选择热点，请先在 Step 1 挑选一条新闻</span>');
    parts.push('<span class="ctx-sep"></span>');
    parts.push('<span class="ctx-item">已绑定商品 <b>' + state.bound.length + '</b></span>');
    parts.push('<span class="ctx-item">文案版本 <b>' + state.copy.versions.length + '</b>' + (v ? '（已选 ' + v.label + '）' : '') + '</span>');
    parts.push('<span class="ctx-item">发布状态 </span><span class="state-pill ' + statusMap[1] + '">' + statusMap[0] + '</span>');
    $('#contextBar').innerHTML = parts.join('');
  }

  function renderFlow() {
    const hasNews = !!state.selectedNewsId, hasBound = state.bound.length > 0;
    const hasCopy = state.copy.versions.length > 0, hasReview = state.review.status === 'pass' || state.review.published;
    const pct = (hasNews ? 25 : 0) + (hasBound ? 25 : 0) + (hasCopy ? 25 : 0) + (hasReview ? 25 : 0);
    $('#flowPercent').textContent = pct + '%';
    $('#flowBar').style.width = pct + '%';
    let tip = '请先在 Step 1 选择一个爆款热点。';
    if (hasNews && !hasBound) tip = '热点已锁定，进入 Step 2 查看系统推荐商品。';
    else if (hasBound && !hasCopy) tip = '商品已绑定 ' + state.bound.length + ' 件，可开始生成微博文案。';
    else if (hasCopy && !hasReview) tip = '文案已生成，前往 Step 5 完成合规审核与发布。';
    else if (hasReview && !state.review.published) tip = '审核已通过，可以一键发送了。';
    else if (state.review.published) tip = '本次热点营销链路已闭环完成 🎉';
    $('#flowTip').textContent = tip;
    renderStepNav();
  }

  function goStep(n) {
    state.step = n;
    STEPS.forEach(s => { $('#view-' + s.n).hidden = s.n !== n; });
    if (n === 2) renderStep2();
    if (n === 3) renderStep3();
    if (n === 4) renderStep4();
    if (n === 5) renderStep5();
    renderFlow(); renderContextBar();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    /* 切到依赖商品库的步骤时顺手同步一次配置：
       后台刚删掉/改过的商品，这里不用刷新页面就能反映过来 */
    if ((n === 2 || n === 3 || n === 4) && window.HP && HP.Config) {
      HP.Config.load().catch(() => null).then(() => {
        if (state.step !== n) return;      // 用户已经切到别的步骤了
        if (n === 2) renderStep2();
        if (n === 3) renderStep3();
        if (n === 4) { renderStep4(); renderQuickModel(); }
        renderFlow(); renderContextBar();
      });
    }
  }

  /* ---------------- Step 1 新闻抓取 ---------------- */
  /* 一个来源"底下一共有几条"：自定义订阅源看抓到的条目，
     内置来源看挂在这个来源上的内置演示新闻（它们不在 items 里，不能算成 0） */
  function sourceItemCount(s) {
    if ((s.items || []).length) return s.items.length;
    return (window.MOCK.NEWS || []).filter(n => n.sourceId === s.id).length;
  }
  function enabledWithItems() { return enabledSources().filter(s => sourceItemCount(s) > 0); }

  /* 顶部状态灯：反映真实情况，不再永远显示"在线" */
  function updateEnvPill() {
    const pill = $('#envPill');
    if (!pill) return;
    const server = HP.Config.isServer();
    const on = enabledSources(), withItems = enabledWithItems();
    pill.classList.toggle('warn', !server);
    pill.innerHTML = '<span class="pulse-dot"></span>' + (server ? '抓取服务在线' : '演示模式 · 未连接服务端');
    pill.title = server
      ? '已连接本地服务端：配置存在服务端，「一键抓取」会真的去访问来源'
      : '演示模式：页面是直接双击文件打开的，没有本地服务端。此时不会真的抓取外部站点，列表只显示"启用中的来源"里已经有的条目。要真抓取，请在项目目录执行 node server/server.js 后，用 http://localhost:8787/index.html 打开。' +
        '（当前启用来源 ' + on.length + ' 个，其中有条目 ' + withItems.length + ' 个）';
  }

  function rerenderStep1() {
    renderNewsCats(); renderNewsStats(); renderNewsList(); updateEnvPill();
  }

  function renderNewsStats() {
    const list = state.news;
    const high = list.filter(n => n.heat > 850).length;
    const picked = state.selectedNewsId ? 1 : 0;
    const srcOn = enabledSources().length;
    const withItems = enabledWithItems().length;
    const server = HP.Config.isServer();
    $('#newsStats').innerHTML = [
      statCard('当前热点列表', list.length, '条',
        '启用来源 ' + srcOn + ' 个 · 其中有条目 ' + withItems + ' 个', list.length ? '' : 'trend-flat'),
      statCard('高潜热点', high, '条', '热度 > 850 且仍在上升', 'trend-up'),
      statCard('已选热点', picked, '条', '作为本次营销主线', ''),
      statCard('最近抓取', state.stats.lastFetch ? clock(state.stats.lastFetch) : '—', '',
        state.stats.lastFetchNote || (server ? '还没抓取过 · 服务端已连接' : '还没抓取过 · 演示模式不会真抓'), 'trend-flat')
    ].join('');
  }
  function statCard(k, v, unit, d, cls) {
    return '<div class="stat-card"><div class="k">' + esc(k) + '</div>' +
      '<div class="v">' + esc(v) + (unit ? '<small>' + esc(unit) + '</small>' : '') + '</div>' +
      '<div class="d ' + (cls || '') + '">' + esc(d) + '</div></div>';
  }

  function renderNewsCats() {
    const cats = ['全部'].concat(Array.from(new Set(NEWS.map(n => n.cat))));
    $('#newsCats').innerHTML = cats.map(c =>
      '<button class="chip ' + (state.newsFilter.cat === c ? 'active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>').join('');
    $('#newsCats').querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
      state.newsFilter.cat = b.dataset.cat; renderNewsCats(); renderNewsList();
    }));

    const sel = $('#newsSource');
    if (sel.options.length <= 1) {
      Array.from(new Set(NEWS.map(n => n.source))).forEach(s => {
        const o = document.createElement('option'); o.value = s; o.textContent = s; sel.appendChild(o);
      });
    }
  }

  function filteredNews() {
    const f = state.newsFilter;
    let list = state.news.slice();
    if (f.cat !== '全部') list = list.filter(n => n.cat === f.cat);
    if (f.source !== 'all') list = list.filter(n => n.source === f.source);
    if (f.time !== 'all') list = list.filter(n => n.minutesAgo <= Number(f.time) * 60);
    if (f.keyword.trim()) {
      const k = f.keyword.trim().toLowerCase();
      list = list.filter(n => (n.title + n.summary + n.keywords.join('') + n.source).toLowerCase().indexOf(k) > -1);
    }
    if (f.sort === 'heat') list.sort((a, b) => b.heat - a.heat);
    if (f.sort === 'growth') list.sort((a, b) => b.growth - a.growth);
    if (f.sort === 'time') list.sort((a, b) => a.minutesAgo - b.minutesAgo);
    return list;
  }

  function sparkHtml(arr) {
    return '<div class="spark">' + arr.map((v, i) =>
      '<i class="' + (i >= arr.length - 4 ? 'on' : '') + '" style="height:' + Math.max(4, Math.round(v / 100 * 22)) + 'px"></i>').join('') + '</div>';
  }

  function markKeyword(text) {
    const kw = state.newsFilter.keyword.trim();
    if (!kw) return esc(text);
    const safe = esc(text);
    const re = new RegExp('(' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return safe.replace(re, '<mark>$1</mark>');
  }

  function renderNewsList() {
    const list = filteredNews();
    $('#newsCount').textContent = '共 ' + list.length + ' 条';
    if (!list.length) {
      const on = enabledSources();
      const withItems = enabledWithItems();
      if (!on.length) {
        $('#newsList').innerHTML = '<div class="empty-state"><b>当前没有启用中的抓取来源</b>' +
          '所有来源都被停用了，所以一条新闻也没有。点下面的按钮可以把内置来源补回来并启用。' +
          '<div class="empty-actions"><button class="btn primary" id="fixSourcesBtn">恢复并启用内置来源</button>' +
          '<button class="btn ghost" id="gotoSourcesBtn">去后台配置来源</button></div></div>';
      } else if (!withItems.length) {
        /* 来源启用了但底下一无所有 —— 这跟"筛选条件"没关系，必须说清楚 */
        $('#newsList').innerHTML = '<div class="empty-state"><b>你启用的 ' + on.length + ' 个来源，底下一共 0 条条目</b>' +
          '所以列表是空的，不是搜索或筛选的问题。启用中的来源：' +
          on.map(s => esc(s.name) + '（' + sourceItemCount(s) + ' 条）').join('、') + '。' +
          '<div class="help" style="margin-top:8px">' +
          (HP.Config.isServer()
            ? '点右上角「一键抓取」让服务端真的去访问这些来源；公开热榜多为前端渲染，抓不到标题时建议改用 RSS / JSON 订阅源。'
            : '当前是演示模式（直接打开文件、没有本地服务端），浏览器跨域会拦掉外部站点，所以自定义订阅源抓不到东西。' +
              '想立刻看到热点，可以先恢复内置来源；想抓真实订阅源，请启动 node server/server.js 后用 http://localhost:8787 打开。') +
          '</div>' +
          '<div class="empty-actions"><button class="btn primary" id="fixSourcesBtn">恢复并启用内置来源</button>' +
          '<button class="btn ghost" id="gotoSourcesBtn">去后台配置来源</button></div></div>';
      } else {
        $('#newsList').innerHTML = '<div class="empty-state"><b>没有匹配的热点</b>试着调整关键词或切换类目。</div>';
      }
      wireNewsEmptyActions();
      return;
    }
    $('#newsList').innerHTML = list.map((n, i) => {
      const selected = state.selectedNewsId === n.id;
      const rankCls = i === 0 ? 'top' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
      return '<article class="news-item ' + (selected ? 'selected' : '') + '" data-id="' + n.id + '">' +
        '<span class="rank ' + rankCls + '">' + (i + 1) + '</span>' +
        '<div class="news-main">' +
          '<h3 class="news-title">' + markKeyword(n.title) + '</h3>' +
          '<div class="news-meta"><span class="src">' + esc(n.source) + '</span><span>' + esc(n.cat) + '</span><span>' + esc(n.time) + '</span>' +
            '<span class="trend-up">↑ ' + n.growth + '% 增速</span></div>' +
          '<p class="news-summary">' + esc(n.summary) + '</p>' +
          '<div class="tagline">' + n.tags.map((t, ti) => '<span class="tag ' + (ti === 0 ? 'hot' : ti === 1 ? 'brand' : '') + '">' + esc(t) + '</span>').join('') +
            n.topics.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' +
        '</div>' +
        '<div class="news-right">' +
          '<div class="heat">' + n.heat + '<small>热度值</small></div>' + sparkHtml(n.spark) +
          '<span class="pick-badge">' + (selected ? '✓ 已选为本次热点' : '选为爆款热点') + '</span>' +
        '</div></article>';
    }).join('');

    $('#newsList').querySelectorAll('.news-item').forEach(item => {
      item.addEventListener('click', () => selectNews(item.dataset.id));
    });
  }

  function selectNews(id) {
    if (state.selectedNewsId === id) { goStep(2); return; }
    state.selectedNewsId = id;
    state.candidates = []; state.bound = [];
    state.copy.versions = []; state.copy.selectedId = null; state.copy.tags = []; state.copy.points = [];
    state.review = { status: 'wait', published: false, checks: [], blocked: false };
    const news = getNews(id);
    state.copy.tags = (news.topics || []).slice(0, 2);
    logEvent('已锁定热点', '「' + news.title + '」已作为本次营销主线，热度值 ' + news.heat);
    toast('已选择热点：' + news.title.slice(0, 16) + '…', 'ok');
    renderNewsList(); renderNewsStats(); renderFlow(); renderContextBar();
    setTimeout(() => goStep(2), 260);
  }

  /* 空列表上的两个按钮：一键把内置来源补回来 / 去后台 */
  function wireNewsEmptyActions() {
    const fix = $('#fixSourcesBtn');
    if (fix) fix.addEventListener('click', repairSources);
    const go = $('#gotoSourcesBtn');
    if (go) go.addEventListener('click', () => { window.location.href = 'admin.html#/sources'; });
  }

  /* 把内置来源补回配置并启用（保留运营自己加的自定义订阅源） */
  function repairSources() {
    const next = JSON.parse(JSON.stringify(HP.Config.get()));
    if (!Array.isArray(next.sources)) next.sources = [];
    let added = 0, on = 0;
    (HP.Config.DEFAULTS.sources || []).forEach(function (d) {
      if (d.type !== 'builtin') return;
      /* 只按 id 认：新闻是靠 sourceId 关联到来源的，同名但不是同一个 id 的来源是运营自己的，不能顶替 */
      const hit = next.sources.filter(s => s.id === d.id)[0];
      if (hit) { if (!hit.enabled) { hit.enabled = true; on++; } }
      else { next.sources.push(JSON.parse(JSON.stringify(d))); added++; }
    });
    return HP.Config.save(next).then(function (r) {
      if (!r.ok) { toast('恢复失败：' + ((r.errors || []).join('；') || '未知原因'), 'warn'); return; }
      return HP.Config.load().catch(() => null).then(function () {
        refreshNews(); rerenderStep1();
        toast('已恢复内置来源（补回 ' + added + ' 个、启用 ' + on + ' 个），现在有 ' + state.news.length + ' 条热点', 'ok');
      });
    });
  }

  /* 一键抓取：
       · 服务端模式 → 真发一次抓取（api/sources/test），把解析到的条目写回配置
       · 演示模式   → 明确告诉用户没有真抓，不再伪造"抓到了多少条" */
  function simulateFetch(silent) {
    const btn = $('#fetchBtn');
    const old = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>抓取中…'; }
    document.body.dataset.fetching = '1';
    const done = () => {
      document.body.dataset.fetching = '0';
      if (btn) { btn.disabled = false; btn.innerHTML = old; }
    };

    /* 抓取前先同步一次配置：后台刚启停的来源会立刻生效 */
    return HP.Config.load().catch(() => null).then(function () {
      const on = enabledSources();
      if (!on.length) {
        done();
        toast('当前没有启用中的抓取来源，请到后台「抓取来源」里开启', 'warn');
        return;
      }
      if (!HP.Config.isServer()) {
        /* 演示模式：不假装抓取，把话说清楚 */
        return new Promise(resolve => setTimeout(resolve, 500)).then(function () {
          refreshNews();
          state.stats.lastFetch = new Date();
          state.stats.lastFetchNote = '演示模式：没有真的访问外部站点';
          rerenderStep1();
          if (!silent) {
            toast('演示模式：没有真的抓取。' + on.length + ' 个启用来源里只有已有条目会显示；' +
              '要真抓取请启动 node server/server.js，用 http://localhost:8787 打开', 'warn');
          }
          done();
        });
      }

      /* 服务端模式：真抓 */
      return fetch('api/sources/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: on })
      })
        .then(r => r.json())
        .then(function (data) {
          const results = (data && data.results) || [];
          const okN = results.filter(r => r.ok).length;
          const got = results.filter(r => (r.items || []).length);
          const next = JSON.parse(JSON.stringify(HP.Config.get()));
          let total = 0;
          got.forEach(function (r) {
            const s = (next.sources || []).filter(x => x.id === r.id)[0];
            if (!s) return;
            s.items = r.items.slice(0, 10).map(function (it) {
              return { title: it.title, summary: it.summary || '', link: it.link || '', fetchedAt: new Date().toISOString() };
            });
            total += s.items.length;
          });
          const write = got.length ? HP.Config.save(next).catch(() => null) : Promise.resolve(null);
          return write
            .then(() => HP.Config.load().catch(() => null))
            .then(function () {
              refreshNews();
              state.stats.lastFetch = new Date();
              state.stats.lastFetchNote = '服务端真抓取：成功 ' + okN + '/' + on.length + ' 个来源';
              rerenderStep1();
              if (got.length) {
                logEvent('抓取完成', '真抓取 ' + on.length + ' 个来源，' + got.length + ' 个来源解析出 ' + total + ' 条条目');
                toast('真抓取完成：' + okN + '/' + on.length + ' 个来源可访问，写入 ' + total + ' 条条目（来自 ' + got.length + ' 个订阅源）', 'ok');
              } else {
                toast('抓取完成：' + okN + '/' + on.length + ' 个来源可访问，但一条条目也没解析出来（公开热榜多为前端渲染，建议改用 RSS / JSON 订阅源）', 'warn');
              }
            });
        })
        .catch(function (e) {
          toast('抓取失败：' + ((e && e.message) || '未知原因'), 'warn');
        })
        .then(done);
    });
  }

  /* ---------------- Step 2 建议匹配商品 ---------------- */
  function renderStep2() {
    const news = getNews(state.selectedNewsId);
    if (!news) {
      $('#hotBrief').innerHTML = '<div><h3>尚未选择热点</h3><p class="hint">请先回到 Step 1 选择一条热点新闻，系统才能进行商品匹配。</p></div>' +
        '<div class="brief-side"><button class="btn primary" data-goto="1">去选择热点</button></div>';
      $('#matchGrid').innerHTML = ''; $('#matchSummary').textContent = '';
      bindGoto($('#hotBrief'));
      return;
    }
    $('#hotBrief').innerHTML =
      '<div><span class="ctx-label">热点简报</span><h3 style="margin-top:8px">' + esc(news.title) + '</h3>' +
        '<p class="hint">' + esc(news.summary) + '</p>' +
        '<div class="brief-tags">' + news.keywords.map(k => '<span class="tag brand">' + esc(k) + '</span>').join('') +
        news.topics.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div></div>' +
      '<div class="brief-side">' +
        '<div class="brief-metric"><span>热度值</span><b style="color:var(--hot)">' + news.heat + '</b></div>' +
        '<div class="brief-metric"><span>增速</span><b class="trend-up">↑ ' + news.growth + '%</b></div>' +
        '<div class="brief-metric"><span>来源</span><b>' + esc(news.source) + '</b></div>' +
        '<div class="brief-metric"><span>推荐商品</span><b>' + matchesFor(news).length + ' 件</b></div>' +
      '</div>';

    const list = matchesFor(news).slice().sort((a, b) => {
      if (state.matchSort === 'score') return b.score - a.score;
      if (state.matchSort === 'gmv') return b.product.gmv30d - a.product.gmv30d;
      return a.product.price - b.product.price;
    });
    $('#matchSummary').innerHTML = '系统基于热点语义与近 30 天转化数据，为你推荐 <b>' + list.length + '</b> 件高关联商品；采纳后会自动进入 Step 3 的商品库。';
    $('#matchGrid').innerHTML = list.map(m => productCard(m)).join('');
    $('#pickedHint2').textContent = '已选 ' + state.bound.length + ' 件商品';

    $('#matchGrid').querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); toggleBind(b.dataset.pick, true);
    }));
    $('#matchGrid').querySelectorAll('[data-detail]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const p = getProduct(b.dataset.detail);
      toast('商品详情（Demo）：' + p.name + ' · 近 30 天销量 ' + fmtNum(p.sales30d) + ' 件', '');
    }));
  }

  function productCard(m) {
    const p = m.product, picked = state.bound.indexOf(p.id) > -1;
    /* 商品卡统一由 HP.Products.cardHtml 渲染：后台商品库的卡片视图用的是同一段代码 */
    return HP.Products.cardHtml(p, {
      picked: picked,
      score: m.score,
      reason: m.reason,
      actions:
          '<button class="btn ghost tiny" data-detail="' + p.id + '">详情</button>' +
          '<button class="btn ' + (picked ? 'soft' : 'primary') + ' tiny" data-pick="' + p.id + '">' +
            (picked ? '✓ 已采纳（点击取消）' : '采纳并绑定') + '</button>'
    });
  }

  function toggleBind(pid, fromStep2) {
    const i = state.bound.indexOf(pid);
    if (i > -1) {
      state.bound.splice(i, 1);
      state.candidates = state.candidates.filter(x => x !== pid);
      toast('已取消绑定：' + getProduct(pid).name, '');
    } else {
      if (state.bound.length >= 3 && fromStep2) { toast('最多绑定 3 件商品，请先解绑再添加', 'warn'); return; }
      state.bound.push(pid);
      if (fromStep2 && state.candidates.indexOf(pid) < 0) state.candidates.push(pid);
      toast('已绑定商品：' + getProduct(pid).name, 'ok');
    }
    if (state.copy.versions.length) { state.copy.versions = []; state.copy.selectedId = null; }
    state.review = { status: 'wait', published: false, checks: [], blocked: false };
    renderStep2(); renderFlow(); renderContextBar();
    if (state.step === 3) renderStep3();
    if (state.step === 5) renderStep5();
  }

  /* ---------------- Step 3 深度匹配 ---------------- */
  function renderLibCats() {
    const cats = ['全部'].concat(Array.from(new Set(allProducts().map(p => p.cat))));
    $('#libCats').innerHTML = cats.map(c =>
      '<button class="chip ' + (state.libFilter.cat === c ? 'active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>').join('');
    $('#libCats').querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
      state.libFilter.cat = b.dataset.cat; renderLibCats(); renderLibTable();
    }));
  }

  function filteredProducts() {
    const f = state.libFilter;
    let list = allProducts().slice();
    if (f.cat !== '全部') list = list.filter(p => p.cat === f.cat);
    if (f.keyword.trim()) {
      const k = f.keyword.trim().toLowerCase();
      list = list.filter(p => (p.name + p.brand + p.sku + p.cat + (p.points || []).join(' ')).toLowerCase().indexOf(k) > -1);
    }
    if (f.min != null) list = list.filter(p => p.price >= f.min);
    if (f.max != null) list = list.filter(p => p.price <= f.max);
    if (f.rating) list = list.filter(p => p.rating >= f.rating);
    if (f.onlyStock) list = list.filter(p => p.stock > 500 && p.sales30d > 0);
    const sorter = {
      match: (a, b) => scoreOf(b.id) - scoreOf(a.id),
      sales: (a, b) => b.sales30d - a.sales30d,
      conversion: (a, b) => b.conversion - a.conversion,
      stock: (a, b) => b.stock - a.stock
    };
    return list.sort(sorter[f.sort] || sorter.match);
  }

  function renderStep3() {
    renderLibCats();
    renderLibTable();
    renderBindList();
  }

  function renderLibTable() {
    const list = filteredProducts();
    const body = $('#libBody');
    $('#libEmpty').hidden = list.length > 0;
    body.innerHTML = list.map(p => {
      const bound = state.bound.indexOf(p.id) > -1;
      const sc = scoreOf(p.id);
      const stockCls = p.stock < 500 ? 'stock-low' : '';
      return '<tr class="' + (bound ? 'bound' : '') + '" data-id="' + p.id + '">' +
        '<td class="col-check"><input type="checkbox" data-check="' + p.id + '" ' + (bound ? 'checked' : '') + ' /></td>' +
        '<td><div class="cell-product"><span class="mini-thumb">' + p.emoji + '</span>' +
          '<div><b>' + esc(p.name) + '</b><i>' + esc(p.brand) + ' · ' + esc(p.sku) + (bound && state.bound[0] === p.id ? ' · <span style="color:var(--brand-ink);font-weight:600">主推</span>' : '') + '</i></div></div></td>' +
        '<td>' + esc(p.cat) + '</td>' +
        '<td class="num">' + money(p.price) + '</td>' +
        '<td class="num"><div class="score-bar"><span class="bar"><span style="width:' + sc + '%"></span></span><b>' + sc + '</b></div></td>' +
        '<td class="num">' + fmtNum(p.sales30d) + '</td>' +
        '<td class="num ' + stockCls + '">' + p.stock + '</td>' +
        '<td class="num">' + p.rating.toFixed(1) + '</td>' +
        '<td class="col-act">' +
          (bound
            ? (state.bound[0] === p.id ? '<button class="btn soft tiny" data-main="' + p.id + '" disabled>已是主推</button>'
              : '<button class="btn ghost tiny" data-main="' + p.id + '">设为主推</button>')
            : '<button class="btn ghost tiny" data-bind="' + p.id + '">绑定</button>') +
        '</td></tr>';
    }).join('');

    body.querySelectorAll('[data-check]').forEach(cb => cb.addEventListener('click', e => {
      e.stopPropagation(); toggleBind(cb.dataset.check, false);
    }));
    body.querySelectorAll('[data-bind]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); toggleBind(b.dataset.bind, false);
    }));
    body.querySelectorAll('[data-main]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); promote(b.dataset.main);
    }));
    body.querySelectorAll('tr').forEach(tr => tr.addEventListener('click', e => {
      if (e.target.closest('button') || e.target.tagName === 'INPUT') return;
      toggleBind(tr.dataset.id, false);
    }));
  }

  function promote(pid) {
    const i = state.bound.indexOf(pid);
    if (i < 0) return;
    state.bound.splice(i, 1); state.bound.unshift(pid);
    if (state.copy.versions.length) { state.copy.versions = []; state.copy.selectedId = null; }
    renderLibTable(); renderBindList(); renderFlow(); renderContextBar();
    toast(getProduct(pid).name + ' 已设为主推商品', 'ok');
  }

  function renderBindList() {
    /* 商品库里的商品可能已被删除（例如运营在后台删掉后保存）：
       这里自动清理失效的绑定，避免页面报错 */
    const alive = state.bound.filter(id => getProduct(id));
    const dropped = state.bound.length - alive.length;
    state.bound = alive;
    $('#bindCount').textContent = state.bound.length;
    const box = $('#bindList');
    if (!state.bound.length) {
      box.innerHTML = '<div class="empty-mini">' +
        (dropped ? '有 ' + dropped + ' 件已绑定的商品已从商品库删除，已自动移除<br />' : '') +
        '还没有绑定商品<br />从左侧列表勾选，或回到 Step 2 采纳推荐</div>';
      return;
    }
    box.innerHTML = (dropped ? '<div class="empty-mini" style="margin-bottom:8px">有 ' + dropped + ' 件已绑定的商品已从商品库删除，已自动移除</div>' : '') +
      state.bound.map((id, i) => {
      const p = getProduct(id);
      return '<div class="bind-item ' + (i === 0 ? 'main' : '') + '">' +
        '<span class="mini-thumb">' + p.emoji + '</span>' +
        '<div class="bind-body"><b>' + esc(p.name) + '</b>' +
          '<i>' + money(p.price) + ' · 匹配度 ' + scoreOf(p.id) + (i === 0 ? ' · 主推' : '') + '</i></div>' +
        '<div class="bind-tools">' +
          (i === 0 ? '' : '<button data-main="' + p.id + '">设为主推</button>') +
          '<button data-unbind="' + p.id + '">解绑</button>' +
        '</div></div>';
    }).join('');
    box.querySelectorAll('[data-unbind]').forEach(b => b.addEventListener('click', () => toggleBind(b.dataset.unbind, false)));
    box.querySelectorAll('[data-main]').forEach(b => b.addEventListener('click', () => promote(b.dataset.main)));
  }

  /* ---------------- Step 4 创作文案 ---------------- */
  function renderStep4() {
    const news = getNews(state.selectedNewsId);
    const prod = activeProduct();
    if (!news || !prod) {
      $('#versionList').innerHTML = '<div class="empty-state"><b>还缺一点上下文</b>' +
        (!news ? '请先在 Step 1 选择热点新闻。' : '请先在 Step 2 / Step 3 绑定至少 1 件商品。') + '</div>';
      $('#genState').innerHTML = '';
      return;
    }
    renderStyleGrid();
    renderTonePick();
    renderQuickModel();
    renderEvalSettings();
    renderTagPicks();
    renderPointPicks();
    if (!state.copy.versions.length) {
      const n = selectedStyles().length || cfg().styles.length;
      $('#versionList').innerHTML = '<div class="empty-state"><b>尚未生成文案</b>设置左侧参数后点击「生成文案」，约 1.5 秒后每个创作风格各返回 1 个微博版本（当前 ' + n + ' 个）。</div>';
    } else {
      renderVersions();
    }
    $('#generateBtn').disabled = state.copy.generating;
  }

  function renderStyleGrid() {
    const styles = cfg().styles || [];
    if (!state.copy.styles.length) state.copy.styles = styles.map(s => s.id);
    $('#styleGrid').innerHTML = styles.map(s => {
      const on = state.copy.styles.indexOf(s.id) > -1;
      return '<button class="style-card ' + (on ? 'active' : '') + '" data-style-id="' + esc(s.id) + '" title="' +
        esc(s.requirement || '') + '"><b>' + esc(s.name) + '</b><i>' + esc((s.requirement || '').slice(0, 16)) + '</i></button>';
    }).join('') || '<div class="empty-mini" style="grid-column:1/-1">后台还没有配置创作风格</div>';
    $$('#styleGrid [data-style-id]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.styleId, i = state.copy.styles.indexOf(id);
      if (i > -1) { if (state.copy.styles.length <= 1) { toast('至少保留一个创作风格', 'warn'); return; } state.copy.styles.splice(i, 1); }
      else state.copy.styles.push(id);
      renderStyleGrid();
    }));
    const hint = $('#styleHint');
    if (hint) hint.textContent = '已选 ' + state.copy.styles.length + ' 个风格，将产出 ' + state.copy.styles.length + ' 个候选版本';
  }

  function renderTonePick() {
    const tones = cfg().tones || [];
    if (!state.copy.tone && tones.length) state.copy.tone = tones[0].name;
    const sel = $('#tonePick');
    if (!sel) return;
    sel.innerHTML = tones.map(t => '<option' + (t.name === state.copy.tone ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('');
  }

  /* 工作台里的模型快捷设置：与后台「模型与接入」共用 config.model，改哪边都生效 */
  function renderQuickModel() {
    const sel = $('#quickMode');
    if (!sel) return;
    const m = cfg().model || {};
    sel.innerHTML = ['mock', 'proxy', 'direct'].map(k =>
      '<option value="' + k + '"' + (m.mode === k ? ' selected' : '') + '>' + HP.LLM.MODE_LABEL[k] + '</option>').join('');
    $('#quickModel').value = m.model || '';
    $('#quickTemp').value = m.temperature;
    $('#quickModelHint').textContent = '与后台「模型与接入」共用同一份配置';
  }

  function persistModel(patch, label) {
    const conf = HP.Config.get();
    Object.assign(conf.model, patch);
    return HP.Config.save(conf).then(r => {
      if (r.ok) toast(label + '已同步到「' + r.targetLabel + '」，后台看到的是同一个值', 'ok');
      else toast('同步失败：' + (r.errors || []).join('；'), 'warn');
    });
  }

  /* 评测设置（自动返工开关 / 轮数）同样与后台共用同一份配置 */
  function renderEvalSettings() {
    const e = cfg().evalConfig || {};
    if ($('#autoRework')) $('#autoRework').checked = e.autoRework !== false;
    if ($('#reworkRounds')) $('#reworkRounds').value = e.maxReworkRounds == null ? 2 : e.maxReworkRounds;
    if ($('#autoReview')) $('#autoReview').checked = e.enableReview === true;
    const w = e.weights || { machine: 0.5, review: 0.5 };
    if ($('#wMachine')) $('#wMachine').value = w.machine;
    if ($('#wReview')) $('#wReview').value = w.review;
  }

  function persistEval(patch, label) {
    const conf = HP.Config.get();
    conf.evalConfig = Object.assign({}, conf.evalConfig, patch);
    return HP.Config.save(conf).then(r => {
      if (r.ok) toast(label + '已同步到「' + r.targetLabel + '」', 'ok');
      else toast('同步失败：' + (r.errors || []).join('；'), 'warn');
    });
  }

  function selectedStyles() {
    const styles = cfg().styles || [];
    const picked = styles.filter(s => state.copy.styles.indexOf(s.id) > -1);
    return picked.length ? picked : styles.slice(0, 1);
  }

  function boundProducts() {
    return state.bound.map(getProduct).filter(Boolean);
  }

  function renderTagPicks() {
    const news = getNews(state.selectedNewsId);
    const opts = (news ? news.topics : []).concat(['#好物推荐#', '#今日好价#', '#秋冬必备#']);
    $('#tagPicks').innerHTML = opts.map(t =>
      '<button class="tag-pick ' + (state.copy.tags.indexOf(t) > -1 ? 'on' : '') + '" data-tag="' + esc(t) + '">' + esc(t) + '</button>').join('');
    $('#tagPicks').querySelectorAll('.tag-pick').forEach(b => b.addEventListener('click', () => {
      const t = b.dataset.tag, i = state.copy.tags.indexOf(t);
      if (i > -1) state.copy.tags.splice(i, 1);
      else { if (state.copy.tags.length >= 3) { toast('微博话题建议不超过 3 个', 'warn'); return; } state.copy.tags.push(t); }
      renderTagPicks();
    }));
  }

  function renderPointPicks() {
    const p = activeProduct();
    if (!p) { $('#pointPicks').innerHTML = ''; return; }
    if (!state.copy.points.length) state.copy.points = p.points.slice(0, 3);
    $('#pointPicks').innerHTML = p.points.map((t, i) =>
      '<label class="point-pick"><input type="checkbox" data-point="' + i + '" ' + (state.copy.points.indexOf(t) > -1 ? 'checked' : '') + ' /><span>' + esc(t) + '</span></label>').join('');
    $('#pointPicks').querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => {
      const t = p.points[Number(cb.dataset.point)];
      const i = state.copy.points.indexOf(t);
      if (cb.checked && i < 0) state.copy.points.push(t);
      if (!cb.checked && i > -1) state.copy.points.splice(i, 1);
    }));
  }

  function shortHot(news) {
    if (!news) return '热点';
    return news.title.split(/[：:！!，,；;]/)[0].slice(0, 18);
  }

  function applyTune(text, tune, news, prod, tags, cta) {
    if (!tune) return text;
    if (tune === '活泼') return text.replace(/\n\n/g, '\n\n') + '\n\n真的别犹豫了！早买早享受 🎉' ;
    if (tune === '专业') return text.replace(/[🥶✨🔥🎉👀🙋🥰👇]/g, '').replace(/！/g, '。');
    if (tune === '精简') {
      const lines = text.split('\n\n').filter(Boolean);
      return [lines[0], lines[1] || '', tags].filter(Boolean).join('\n');
    }
    if (tune === '加长') {
      return text + '\n\n补充一句：' + prod.points[1] + '，日常用下来最打动我的就是这个细节。' + '\n' + cta;
    }
    if (tune === '换开头') {
      const alt = ['先别急着划走，这条可能帮你省下一笔。', '热搜挂了一天，我把购物车也清了一遍。', '说件小事：天一变，我第一件事是打开购物车。'];
      const head = alt[(hash(text) % alt.length)];
      return '【' + shortHot(news) + '】' + head + '\n\n' + text.split('\n\n').slice(1).join('\n\n');
    }
    return text;
  }

  function generateAll(after) {
    const news = getNews(state.selectedNewsId), prod = activeProduct();
    if (!news) { toast('请先在 Step 1 选择热点', 'warn'); return; }
    if (!prod) { toast('请先绑定至少 1 件商品', 'warn'); return; }
    if (state.copy.generating) return;

    state.copy.generating = true;
    $('#generateBtn').disabled = true;
    state.copy.selectedId = null;
    state.copy.seed = Math.floor(Math.random() * 6);

    const t0 = Date.now();

    const stages = ['解析热点语境与情绪倾向…', '匹配商品卖点与价格锚点…', '生成微博文案并做合规预检…'];
    $('#genState').innerHTML = '<div class="skeleton-wrap"><div class="progress-line"><span class="spinner"></span><span id="genStage">' +
      stages[0] + '</span></div>' +
      Array.from({ length: 4 }).map(() => '<div class="skeleton"></div>').join('') +
      '<div class="skeleton" style="width:60%"></div>' +
      '<div class="gen-progress"><span id="genBar"></span></div></div>';
    $('#versionList').innerHTML = '';

    let pct = 0, stageIdx = 0;
    const timer = setInterval(() => {
      pct = Math.min(96, pct + 8);
      const bar = $('#genBar'); if (bar) bar.style.width = pct + '%';
      const next = Math.floor(pct / 34);
      if (next !== stageIdx && next < stages.length) {
        stageIdx = next;
        const s = $('#genStage'); if (s) s.textContent = stages[stageIdx];
      }
    }, 120);

    const minWait = new Promise(resolve => setTimeout(resolve, 1500));

    /* 生成前重新读一次配置：后台刚改的模型 / 模板，下一次生成就用上 */
    HP.Config.load().catch(() => HP.Config.snapshot()).then(function () {
      const conf = cfg();
      const styles = selectedStyles();
      const products = boundProducts();

      /* 每个创作风格独立跑一次：编译提示词（读后台配置）→ 调用模型 */
      const jobs = styles.map(style => {
        const opt = {
          style: style,
          tone: state.copy.tone || (conf.tones[0] || {}).name || '',
          tags: state.copy.tags,
          emojiLevel: state.copy.emoji,
          extra: state.copy.extra
        };
        const compiled = HP.Prompt.compile(news, products, opt);
        const material = HP.Eval.materialFrom(news, products, opt);
        return HP.LLM.call({
          system: compiled.system, user: compiled.material, mode: conf.model.mode,
          temperature: conf.model.temperature,
          meta: Object.assign({
            kind: 'compose', news: news, products: products, limits: conf.limits,
            style: style, tone: opt.tone, tags: state.copy.tags, emojiLevel: state.copy.emoji,
            extra: state.copy.extra, system: compiled.system, user: compiled.material
          })
        }).then(res => {
          if (!res || !res.ok) return { style: style, compiled: compiled, res: res, material: material };
          /* 生成后立刻用共用的评测内核跑一遍机器校验 */
          const first = HP.Eval.machineCheck(res.text, material);
          const autoOn = !(conf.evalConfig && conf.evalConfig.autoRework === false);
          if (!autoOn || !HP.Eval.fixableIssues(first).length) {
            return withReview({ style: style, compiled: compiled, res: res, text: res.text, check: first, material: material, rework: null }, conf);
          }
          /* 自动返工：只把"改了有用"的问题送回去，只接受改好的版本 */
          return HP.Eval.autoRework({
            copy: res.text, material: material,
            maxRounds: Number((conf.evalConfig && conf.evalConfig.maxReworkRounds) == null ? 2 : conf.evalConfig.maxReworkRounds),
            meta: { products: products, materialText: material.text, system: compiled.system }
          }).then(function (rw) {
            return withReview({
              style: style, compiled: compiled, res: res, text: rw.text, check: rw.check, material: material,
              rework: { rounds: rw.rounds, acceptedRounds: rw.acceptedRounds, before: rw.before, after: rw.after, improved: rw.improved }
            }, conf);
          });
        });
      });

      /* 需要模型评审时，再调一次模型给这版打分（四维 + 点评，低温度） */
      function withReview(job, conf) {
        if (!(conf.evalConfig && conf.evalConfig.enableReview)) return Promise.resolve(job);
        return HP.Eval.runReview({
          copy: job.text, materialText: job.material.text, products: products, config: conf
        }).then(function (rv) {
          job.review = rv;
          return job;
        });
      }

      return Promise.all([Promise.all(jobs), minWait]).then(function (all) {
      const results = all[0];
      clearInterval(timer);
      const okOnes = results.filter(r => r.res && r.res.ok);
      const failed = results.filter(r => !r.res || !r.res.ok);

      state.copy.versions = okOnes.map((r, i) => ({
        id: 'v' + i,
        label: r.style.name + ' · 候选 ' + (i + 1),
        style: r.style.name,
        text: r.text || r.res.text,
        tune: null,
        model: r.res.model,
        promptUnknown: (r.compiled.unknown || []),
        system: (r.compiled.system || ''),
        machine: r.check || null,
        material: r.material || null,
        rework: r.rework || null,
        review: r.review || null
      }));
      state.copy.selectedId = state.copy.versions.length ? state.copy.versions[0].id : null;
      state.copy.generating = false;
      $('#generateBtn').disabled = false;

      if (!state.copy.versions.length) {
        $('#genState').innerHTML = '<div class="err-note" style="position:static"><span>!</span><div><b>生成失败：</b>' +
          esc((failed[0] && failed[0].res && failed[0].res.message) || '模型没有返回内容') + '</div></div>';
        renderFlow(); renderContextBar();
        if (after) after();
        return;
      }

      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      const modeLabel = HP.LLM.MODE_LABEL[conf.model.mode] || conf.model.mode;
      const unknownTip = state.copy.versions.some(v => v.promptUnknown.length)
        ? '（注意：模板里有 ' + state.copy.versions[0].promptUnknown.length + ' 个不认识的占位符被原样保留）' : '';
      $('#genState').innerHTML = '<div class="toast ok" style="position:static;min-width:auto;box-shadow:none;animation:none;background:#e7f7f1;color:#0b7a56;font-weight:600;">' +
        '<span class="ti" style="background:#0ea472;color:#fff">✓</span><span>已生成 ' + state.copy.versions.length + ' 个版本，耗时 ' + secs +
        's · 模型 ' + esc(HP.LLM.MODE_LABEL[conf.model.mode] === '本地模拟' ? state.copy.versions[0].model + '（本地模拟）' : state.copy.versions[0].model) +
        ' · ' + esc(modeLabel) + ' ' + unknownTip + '</span></div>';
      renderVersions(); renderFlow(); renderContextBar();
      renderQuickModel();
      logEvent('已生成微博文案', '基于「' + news.keywords[0] + '」+「' + prod.name + '」，按 ' + styles.length + ' 个创作风格生成 ' + state.copy.versions.length + ' 个版本');
      if (after) after();
      });
    });
  }

  function fmtCopy(text) {
    return esc(text).replace(/(#[^#\s]{1,24}#)/g, '<span class="hash">$1</span>');
  }

  function renderVersions() {
    const news = getNews(state.selectedNewsId), prod = activeProduct();
    $('#versionList').innerHTML = state.copy.versions.map((v, i) => {
      const active = state.copy.selectedId === v.id;
      const len = v.text.replace(/\s/g, '').length;
      const check = v.machine;
      const expandable = !!check;
      const open = !!(state.copy.expanded && state.copy.expanded[v.id]);
      const scoreCls = !check ? 'mid' : check.score >= 90 ? 'hi' : check.score >= 70 ? 'mid' : 'low';
      const fixable = check ? HP.Eval.fixableIssues(check) : [];
      const evalRow = check
        ? '<div class="eval-row">' +
            '<span class="score-badge ' + scoreCls + '">机器校验 ' + check.score + ' 分</span>' +
            (check.hardFail ? '<span class="mini-tag hard">存在硬伤</span>' : '') +
            (check.failed.length ? '<span class="mini-tag">' + check.failed.length + ' 项待改进</span>' : '<span class="mini-tag ok">全部通过</span>') +
            (v.rework
              ? '<span class="mini-tag ' + (v.rework.improved ? 'ok' : '') + '">自动返工 ' + v.rework.before + ' → ' + v.rework.after +
                '（' + v.rework.acceptedRounds + ' 轮，共 ' + v.rework.rounds.length + ' 次尝试）</span>'
              : '') +
            '<button class="btn ghost tiny" data-checks="' + v.id + '" style="margin-left:auto">' +
              (open ? '收起明细' : '校验明细') + '</button>' +
            (fixable.length ? '<button class="btn soft tiny" data-fix="' + v.id + '">一键修正（' + fixable.length + ' 项）</button>' : '') +
          '</div>' +
          (open ? evalDetailHtml(check, v.rework) : '')
        : '';
      const reviewRow = (v.review || v.machine)
        ? reviewRowHtml(v)
        : '';
      return '<article class="version-card ' + (active ? 'active' : '') + '" data-vid="' + v.id + '">' +
        '<div class="version-head"><div class="vt"><strong>' + esc(v.label) + '</strong>' +
          '<span class="tag brand">' + esc(v.style) + '</span>' + (v.tune ? '<span class="tag">微调：' + esc(v.tune) + '</span>' : '') +
          (active ? '<span class="tag ok">✓ 已选用</span>' : '') + '</div>' +
          '<span class="hint">' + len + ' 字 · 话题 ' + (state.copy.tags.length || 1) + ' 个</span></div>' +
        '<div class="version-body">' + fmtCopy(v.text) + '</div>' +
        '<div class="tune-row">' +
          ['换开头', '活泼', '专业', '精简', '加长'].map(t =>
            '<button data-tune="' + t + '" data-vid="' + v.id + '">' + t + '</button>').join('') +
        '</div>' +
        evalRow +
        reviewRow +
        '<div class="version-foot">' +
          '<span class="meta">商品：' + esc(prod ? prod.name.slice(0, 16) : '—') + ' · 热点：' + esc(news ? shortHot(news) : '—') + '</span>' +
          '<button class="btn ghost tiny" data-copy="' + v.id + '">复制文案</button>' +
          '<button class="btn ' + (active ? 'soft' : 'ghost') + ' tiny" data-use="' + v.id + '">' + (active ? '已选用' : '选用此版本') + '</button>' +
          '<button class="btn primary tiny" data-audit="' + v.id + '">送审</button>' +
        '</div></article>';
    }).join('');

    $('#versionList').querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
      const v = state.copy.versions.find(x => x.id === b.dataset.copy);
      copyText(v.text, v.label);
    }));
    $('#versionList').querySelectorAll('[data-use]').forEach(b => b.addEventListener('click', () => {
      state.copy.selectedId = b.dataset.use;
      state.review.status = 'wait'; state.review.published = false;
      renderVersions(); renderContextBar(); renderFlow();
      toast('已选用 ' + state.copy.versions.find(x => x.id === b.dataset.use).label, 'ok');
    }));
    $('#versionList').querySelectorAll('[data-tune]').forEach(b => b.addEventListener('click', () => {
      const v = state.copy.versions.find(x => x.id === b.dataset.vid);
      const news2 = getNews(state.selectedNewsId), prod2 = activeProduct();
      const tags = state.copy.tags.join(' ') || (news2.topics[0] || '');
      v.text = applyTune(v.text, b.dataset.tune, news2, prod2, tags, CTAS[0]);
      v.tune = b.dataset.tune;
      state.review.status = 'wait'; state.review.published = false;
      renderVersions(); renderContextBar();
      toast('已按「' + b.dataset.tune + '」微调该版本', 'ok');
    }));
    $('#versionList').querySelectorAll('[data-audit]').forEach(b => b.addEventListener('click', () => {
      state.copy.selectedId = b.dataset.audit;
      state.review.status = 'wait'; state.review.published = false;
      renderContextBar(); goStep(5);
      toast('文案已送入审核台', 'ok');
    }));
    /* 校验明细：展开/收起（用 data-checks 以免与商品卡的「详情」按钮撞名） */
    $('#versionList').querySelectorAll('[data-checks]').forEach(b => b.addEventListener('click', () => {
      state.copy.expanded = state.copy.expanded || {};
      state.copy.expanded[b.dataset.checks] = !state.copy.expanded[b.dataset.checks];
      renderVersions();
    }));
    /* 一键修正：用共用的返工内核修这一条 */
    $('#versionList').querySelectorAll('[data-fix]').forEach(b => b.addEventListener('click', () => {
      oneClickFix(b.dataset.fix, b);
    }));
    /* 模型评审：调一次评审模型拿四维分与点评 */
    $('#versionList').querySelectorAll('[data-review]').forEach(b => b.addEventListener('click', () => {
      oneClickReview(b.dataset.review, b);
    }));
  }

  /* 校验明细：逐项列出通过 / 未通过，并显示返工轨迹 */
  function evalDetailHtml(check, rework) {
    const items = check.items.map(i => {
      const cls = i.pass ? 'pass' : (i.level === 'hard' ? 'fail' : 'warn');
      return '<li class="check-item ' + cls + '"><span class="ci-icon">' + (i.pass ? '✓' : '!') + '</span>' +
        '<div class="ci-body"><b>' + esc(i.label) + (i.level === 'hard' ? '（硬伤）' : '') +
        '　<em style="font-style:normal;color:var(--ink-3)">权重 ' + i.weight + (i.rework ? ' · 可返工' : ' · 不返工') + '</em></b>' +
        '<i>' + esc(i.reason) + '</i></div></li>';
    }).join('');
    const trace = rework && rework.rounds.length
      ? '<div class="help" style="margin-top:8px">返工轨迹：' + rework.rounds.map(r =>
        '第 ' + r.round + ' 轮' + (r.accepted ? '（采纳，' + r.scoreBefore + '→' + r.scoreAfter + '）' : '（驳回：' + esc(r.note) + '）') +
        ' 修好：' + (r.fixed.join('、') || '无') + '；剩余：' + (r.remaining.join('、') || '无')).join('；') + '</div>'
      : '';
    return '<div class="eval-detail"><ul class="check-list" style="margin:0">' + items + '</ul>' + trace + '</div>';
  }

  /* 模型评审行：四维分 + 均分 + 综合得分（机器分与评审分按权重合成） */
  function reviewRowHtml(v) {
    const rv = v.review;
    const weights = (cfg().evalConfig || {}).weights || { machine: 0.5, review: 0.5 };
    if (!rv) {
      return '<div class="eval-row"><span class="mini-tag">尚未做模型评审</span>' +
        '<button class="btn ghost tiny" data-review="' + v.id + '" style="margin-left:auto">模型评审</button></div>';
    }
    if (!rv.ok) {
      return '<div class="eval-row"><span class="mini-tag hard">评审失败</span>' +
        '<span class="help" style="margin:0">' + esc(rv.reason || '解析不了模型返回的内容') + '</span>' +
        '<button class="btn ghost tiny" data-review="' + v.id + '" style="margin-left:auto">重试评审</button></div>';
    }
    const total = HP.Eval.totalScore(v.machine ? v.machine.score : 0, rv, weights);
    const totalCls = total.score >= 90 ? 'hi' : total.score >= 75 ? 'mid' : 'low';
    return '<div class="eval-row">' +
        '<span class="score-badge ' + totalCls + '">综合 ' + total.score + ' 分</span>' +
        '<span class="mini-tag">评审均分 ' + rv.avg + ' / 5</span>' +
        '<span class="mini-tag">热点 ' + rv.dims.hot + '｜素材 ' + rv.dims.material + '｜传播 ' + rv.dims.appeal + '｜语气 ' + rv.dims.natural + '</span>' +
        '<span class="help" style="margin:0">机器 ' + (v.machine ? v.machine.score : '—') + ' × ' + total.weights.machine +
          ' ＋ 评审 ' + rv.score + ' × ' + total.weights.review + '</span>' +
        '<button class="btn ghost tiny" data-review="' + v.id + '" style="margin-left:auto">重新评审</button>' +
      '</div>' +
      '<div class="eval-detail" style="margin-top:8px"><b style="font-size:12.5px">评审点评</b>' +
        '<div class="help" style="margin-top:4px">' + esc(rv.dims.comment || '（无点评）') + '</div></div>';
  }

  /* 单独对某个版本跑一次模型评审 */
  function oneClickReview(vid, btn) {
    const v = state.copy.versions.find(x => x.id === vid);
    if (!v) return;
    const material = v.material || currentMaterial();
    if (btn) { btn.disabled = true; btn.textContent = '评审中…'; }
    return HP.Eval.runReview({
      copy: v.text, materialText: material.text, products: boundProducts()
    }).then(function (rv) {
      v.review = rv;
      renderVersions();
      if (rv.ok) {
        toast('模型评审完成：均分 ' + rv.avg + ' / 5' + (rv.model ? '（' + rv.model + '）' : ''), 'ok');
      } else {
        toast('评审没能解析出结果：' + rv.reason, 'warn');
      }
    });
  }

  /* 一键修正：只针对未通过项返工，改不好就保留上一版 */
  function oneClickFix(vid, btn) {
    const v = state.copy.versions.find(x => x.id === vid);
    if (!v) return;
    const material = v.material || currentMaterial();
    if (btn) { btn.disabled = true; btn.textContent = '修正中…'; }
    return HP.Eval.autoRework({
      copy: v.text, material: material,
      maxRounds: Number((cfg().evalConfig || {}).maxReworkRounds == null ? 2 : cfg().evalConfig.maxReworkRounds),
      meta: { products: boundProducts(), materialText: material.text, system: v.system || '' }
    }).then(function (rw) {
      v.text = rw.text;
      v.machine = rw.check;
      v.rework = {
        rounds: rw.rounds, acceptedRounds: rw.acceptedRounds,
        before: rw.before, after: rw.after, improved: rw.improved
      };
      state.copy.expanded = state.copy.expanded || {};
      state.copy.expanded[vid] = true;
      state.review.status = 'wait'; state.review.published = false;
      renderVersions(); renderContextBar(); renderFlow();
      if (rw.improved) {
        const fixed = rw.rounds.filter(r => r.accepted).reduce((acc, r) => acc.concat(r.fixed), []);
        const remaining = rw.rounds.length ? rw.rounds[rw.rounds.length - 1].remaining : [];
        toast('已修正：' + rw.before + ' → ' + rw.after + ' 分；修好 ' + (Array.from(new Set(fixed)).join('、') || '无') +
          (remaining.length ? '；仍未解决 ' + remaining.join('、') : ''), 'ok');
      } else {
        toast('这次修正没有让分数变好（' + rw.after + ' ≤ ' + rw.before + '），已按规则保留上一版', 'warn');
      }
    });
  }

  /* ---------------- Step 5 审核并发送 ---------------- */
  /* 评测用的素材描述（话题 / 可用金额 / 商品名 / 阈值） */
  function currentMaterial() {
    return HP.Eval.materialFrom(getNews(state.selectedNewsId), boundProducts(), {
      style: selectedStyles()[0], tone: state.copy.tone, tags: state.copy.tags,
      emojiLevel: state.copy.emoji, extra: state.copy.extra
    });
  }

  /* 合规审核：直接用共用的评测内核（与后台评测台、Step 4 是同一份逻辑） */
  function runChecks() {
    const v = state.copy.versions.find(x => x.id === state.copy.selectedId);
    const material = (v && v.material) || currentMaterial();
    const check = HP.Eval.machineCheck(v ? v.text : '', material);
    if (v) { v.machine = check; v.material = material; }
    return {
      check: check,
      items: check.items.map(i => ({
        name: i.label + (i.level === 'hard' ? '（硬伤）' : ''),
        level: i.pass ? 'pass' : (i.level === 'hard' ? 'fail' : 'warn'),
        desc: i.reason
      }))
    };
  }

  function renderStep5() {
    const v = state.copy.versions.find(x => x.id === state.copy.selectedId);
    const news = getNews(state.selectedNewsId), prod = activeProduct();

    // 微博卡片预览
    if (!v || !news || !prod) {
      $('#weiboCard').innerHTML = '<div class="empty-state"><b>暂无待审核文案</b>请先在 Step 4 生成并选用一个文案版本。</div>';
      $('#checkList').innerHTML = '<li class="empty-mini">等待文案</li>';
      $('#reviewState').innerHTML = '<span class="state-pill wait">未审核</span>';
      $('#riskBadge').textContent = '—';
      $('#approveBtn').disabled = true; $('#publishBtn').disabled = true;
      renderTimeline();
      return;
    }

    const media = state.bound.slice(0, 3).map(id => '<div>' + getProduct(id).emoji + '</div>').join('');
    $('#weiboCard').innerHTML =
      '<div class="wb-head"><span class="avatar">潮</span>' +
        '<div><div class="wb-name">潮流好物研究所 <span class="wb-verify">✓</span></div>' +
        '<div class="wb-sub">' + clock(new Date()) + ' 来自 iPhone 客户端 · 已开启商品橱窗</div></div></div>' +
      '<div class="wb-body">' + fmtCopy(v.text) + '</div>' +
      (media ? '<div class="wb-media">' + media + '</div>' : '') +
      '<div class="wb-product"><span class="mini-thumb">' + prod.emoji + '</span>' +
        '<div class="pbody"><b>' + esc(prod.name) + '</b><i>' + money(prod.price) + ' <s style="color:var(--ink-3);font-weight:400">' + money(prod.marketPrice) + '</s></i></div>' +
        '<span class="pbtn">查看详情</span></div>' +
      '<div class="wb-foot">' +
        '<span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h8l-2.5-2.5L14 3l5 5-5 5-1.5-1.5L15 9H7Zm10 10H9l2.5 2.5L10 21l-5-5 5-5 1.5 1.5L9 15h8Z"/></svg>转发 1,286</span>' +
        '<span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4V5Z"/></svg>评论 342</span>' +
        '<span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2.5A4 4 0 0 1 19 11c0 4.6-7 9-7 9Z"/></svg>点赞 8,924</span>' +
      '</div>';

    // 合规审核
    const evaluated = runChecks();
    state.review.checks = evaluated.items;
    state.review.score = evaluated.check.score;
    state.review.blocked = state.review.checks.some(c => c.level === 'fail');
    $('#checkList').innerHTML = state.review.checks.map(c => {
      const icon = c.level === 'pass' ? '✓' : c.level === 'warn' ? '!' : '×';
      const cls = c.level === 'fail' ? 'fail' : c.level === 'warn' ? 'warn' : 'pass';
      return '<li class="check-item ' + cls + '"><span class="ci-icon">' + icon + '</span>' +
        '<div class="ci-body"><b>' + esc(c.name) + '</b><i>' + esc(c.desc) + '</i></div></li>';
    }).join('');
    const warns = state.review.checks.filter(c => c.level === 'warn').length;
    const fails = state.review.checks.filter(c => c.level === 'fail').length;
    $('#riskBadge').textContent = (fails ? fails + ' 项风险' : warns ? warns + ' 项建议' : '全部通过') +
      '　机器校验 ' + evaluated.check.score + ' 分';
    $('#riskBadge').style.background = fails ? 'var(--danger-soft)' : warns ? 'var(--warn-soft)' : 'var(--ok-soft)';
    $('#riskBadge').style.color = fails ? 'var(--danger)' : warns ? 'var(--warn)' : 'var(--ok)';
    $('#autoFixBtn').hidden = !fails;

    // 状态标记
    const st = state.review.published ? '<span class="state-pill published">● 已发布</span>'
      : state.review.status === 'pass' ? '<span class="state-pill pass">● 已通过</span>'
        : '<span class="state-pill wait">● 未审核</span>';
    $('#reviewState').innerHTML = st + (fails ? '<span class="hint">存在高风险项，需优化后才能通过</span>' : '');
    $('#approveBtn').disabled = state.review.status === 'pass' || state.review.published;
    $('#approveBtn').textContent = state.review.published ? '已发布' : state.review.status === 'pass' ? '已通过审核' : '通过审核';
    $('#publishBtn').disabled = state.review.published;
    $('#publishBtn').textContent = state.review.published ? '已发送' : '一键发送';

    renderTimeline();
  }

  function renderTimeline() {
    const box = $('#timeline');
    if (!box) return;
    if (!state.logs.length) {
      box.innerHTML = '<li><b>暂无记录</b>完成 Step 1–4 的操作后，这里会生成流程日志。</li>';
      return;
    }
    box.innerHTML = state.logs.map((l, i) =>
      '<li class="' + (i === 0 ? 'on' : '') + '"><time>' + esc(l.time) + '</time><b>' + esc(l.title) + '</b>' + esc(l.text) + '</li>').join('');
  }

  function autoFix() {
    const v = state.copy.versions.find(x => x.id === state.copy.selectedId);
    if (!v) return;
    /* 与 Step 4 的「一键修正」用同一套返工逻辑 */
    const btn = $('#autoFixBtn');
    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '修正中…';
    oneClickFix(v.id, null).then(() => {
      btn.disabled = false;
      btn.textContent = oldText;
      renderStep5();
    });
  }

  function approve() {
    if (state.review.blocked) { toast('存在高风险项，请先点击「一键优化风险表述」', 'warn'); return; }
    state.review.status = 'pass';
    const v = state.copy.versions.find(x => x.id === state.copy.selectedId);
    logEvent('合规审核通过', '审核人：林晓棠 · ' + v.label + ' 通过全部合规检查');
    renderStep5(); renderFlow(); renderContextBar();
    toast('审核通过，可以发布啦', 'ok');
  }

  function publish() {
    const v = state.copy.versions.find(x => x.id === state.copy.selectedId);
    const prod = activeProduct();
    if (!v || !prod) return;
    if (state.review.status !== 'pass') { toast('请先通过合规审核再发送', 'warn'); return; }
    const account = $('#publishAccount').value, time = $('#publishTime').value;
    confirmModal('确认发送到微博？',
      '账号：<b>' + esc(account) + '</b><br />时间：' + esc(time) + '<br />商品：' + esc(prod.name) +
      '<br /><br />这是演示环境，仅模拟发布流程，不会真实发布内容。',
      '确认发送', () => {
        $('#publishBtn').disabled = true; $('#publishBtn').textContent = '发送中…';
        setTimeout(() => {
          state.review.published = true;
          logEvent('已发送到微博', account + ' · ' + time + ' · ' + v.label);
          renderStep5(); renderFlow(); renderContextBar();
          toast('发布成功（模拟）：' + account, 'ok');
        }, 1200);
      });
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindGoto(scope) {
    (scope || document).querySelectorAll('[data-goto]').forEach(b => {
      if (b.dataset.bound) return;
      b.dataset.bound = '1';
      b.addEventListener('click', () => goStep(Number(b.dataset.goto)));
    });
  }

  /* 先按三级顺序读配置（服务端 → 本机浏览器 → 内置默认值），再初始化界面：
     这样后台改完提示词/模板保存后，工作台下一次生成就会用新配置 */
  function init() {
    const boot = window.HP && HP.Config
      ? HP.Config.load().catch(() => HP.Config.snapshot())
      : Promise.resolve(null);
    boot.then(initUI);
  }

  function initUI() {
    bindGoto(document);
    refreshNews();                       // 按后台启用中的来源构建热点列表
    rerenderStep1();
    renderFlow(); renderContextBar();
    goStep(1);

    /* 配置里缺了内置来源时（旧配置 / 导入丢字段），这里会提示已经自动补回来 */
    const autoFilled = (HP.Config.sourcesAutoFilled && HP.Config.sourcesAutoFilled()) || [];
    if (autoFilled.length) {
      toast('检测到配置里缺少 ' + autoFilled.length + ' 个内置来源（' +
        autoFilled.slice(0, 3).join('、') + (autoFilled.length > 3 ? ' 等' : '') + '），已自动补回并启用', 'ok');
    }

    $('#fetchBtn').addEventListener('click', () => simulateFetch());
    $('#newsKeyword').addEventListener('input', e => { state.newsFilter.keyword = e.target.value; renderNewsList(); });
    $('#newsSource').addEventListener('change', e => { state.newsFilter.source = e.target.value; renderNewsList(); });
    $('#newsTime').addEventListener('change', e => { state.newsFilter.time = e.target.value; renderNewsList(); });
    $('#newsSort').addEventListener('change', e => { state.newsFilter.sort = e.target.value; renderNewsList(); });
    $('#autoRefresh').addEventListener('change', e => toast(e.target.checked
      ? (HP.Config.isServer() ? '已开启自动刷新（每 5 分钟抓一次，仅服务端模式有效）' : '已开启自动刷新（演示模式：实际不会抓取，只是状态展示）')
      : '已关闭自动刷新', e.target.checked && !HP.Config.isServer() ? 'warn' : ''));

    $('#rematchBtn').addEventListener('click', () => {
      if (!state.selectedNewsId) { toast('请先选择热点', 'warn'); return; }
      renderStep2(); toast('已重新计算热点-商品关联度', 'ok');
    });
    $$('#matchSortSeg button').forEach(b => b.addEventListener('click', () => {
      state.matchSort = b.dataset.sort;
      $$('#matchSortSeg button').forEach(x => x.classList.toggle('active', x === b));
      renderStep2();
    }));

    $('#libKeyword').addEventListener('input', e => { state.libFilter.keyword = e.target.value; renderLibTable(); });
    $('#priceMin').addEventListener('input', e => { state.libFilter.min = e.target.value === '' ? null : Number(e.target.value); renderLibTable(); });
    $('#priceMax').addEventListener('input', e => { state.libFilter.max = e.target.value === '' ? null : Number(e.target.value); renderLibTable(); });
    $('#libRating').addEventListener('change', e => { state.libFilter.rating = Number(e.target.value); renderLibTable(); });
    $('#libSort').addEventListener('change', e => { state.libFilter.sort = e.target.value; renderLibTable(); });
    $('#onlyStock').addEventListener('change', e => { state.libFilter.onlyStock = e.target.checked; renderLibTable(); });
    $('#checkAll').addEventListener('change', e => {
      const rows = filteredProducts();
      if (e.target.checked) {
        const add = rows.slice(0, 3).map(p => p.id).filter(id => state.bound.indexOf(id) < 0);
        state.bound = state.bound.concat(add).slice(0, 5);
        toast(add.length ? '已批量绑定 ' + add.length + ' 件商品（主推为 ' + getProduct(state.bound[0]).name.slice(0, 12) + '…）' : '这些商品已在绑定列表中', 'ok');
      } else {
        state.bound = [];
        toast('已清空绑定商品', '');
      }
      if (state.copy.versions.length) { state.copy.versions = []; state.copy.selectedId = null; }
      state.review = { status: 'wait', published: false, checks: [], blocked: false };
      renderLibTable(); renderBindList(); renderFlow(); renderContextBar();
    });
    $('#resetFilter').addEventListener('click', () => {
      state.libFilter = { cat: '全部', keyword: '', min: null, max: null, rating: 0, onlyStock: false, sort: 'match' };
      $('#libKeyword').value = ''; $('#priceMin').value = ''; $('#priceMax').value = ''; $('#libRating').value = '0'; $('#libSort').value = 'match'; $('#onlyStock').checked = false;
      renderStep3(); toast('筛选条件已重置', '');
    });

    $('#tonePick').addEventListener('change', e => { state.copy.tone = e.target.value; });
    $('#autoRework').addEventListener('change', e => { persistEval({ autoRework: e.target.checked }, '自动返工开关'); });
    $('#reworkRounds').addEventListener('change', e => {
      const v = Math.max(0, Math.min(4, Number(e.target.value) || 0));
      e.target.value = v;
      persistEval({ maxReworkRounds: v }, '返工轮数');
    });
    $('#autoReview').addEventListener('change', e => { persistEval({ enableReview: e.target.checked }, '模型评审开关'); });
    /* 权重可调：改一边，另一边自动补齐到 1，改完立即重算卡片上的综合分 */
    function setWeights(machine, review) {
      const round2 = n => Math.round(n * 100) / 100;
      persistEval({ weights: { machine: round2(machine), review: round2(review) } }, '权重');
      renderEvalSettings();
      renderVersions();
    }
    $('#wMachine').addEventListener('change', e => {
      const v = Math.max(0, Math.min(1, Number(e.target.value) || 0));
      setWeights(v, 1 - v);
    });
    $('#wReview').addEventListener('change', e => {
      const v = Math.max(0, Math.min(1, Number(e.target.value) || 0));
      setWeights(1 - v, v);
    });
    $('#quickMode').addEventListener('change', e => { persistModel({ mode: e.target.value }, '接入方式'); renderQuickModel(); });
    $('#quickModel').addEventListener('change', e => { persistModel({ model: e.target.value.trim() }, '模型名'); });
    $('#quickTemp').addEventListener('change', e => {
      const v = Math.max(0, Math.min(2, Number(e.target.value) || 0));
      persistModel({ temperature: v }, '温度');
      renderQuickModel();
    });
    $('#emojiRange').addEventListener('input', e => {
      state.copy.emoji = Number(e.target.value);
      $('#emojiVal').textContent = ['不使用', '适中', '丰富'][state.copy.emoji];
    });
    $('#customTag').addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      let t = e.target.value.trim();
      if (!t) return;
      if (t[0] !== '#') t = '#' + t;
      if (t[t.length - 1] !== '#') t = t + '#';
      if (state.copy.tags.indexOf(t) < 0) state.copy.tags.push(t);
      e.target.value = ''; renderTagPicks(); toast('已添加话题 ' + t, 'ok');
    });
    $('#extraPrompt').addEventListener('input', e => { state.copy.extra = e.target.value; });
    $('#extraPrompt').addEventListener('blur', () => {
      if (state.copy.extra.trim()) toast('附加要求已记录，下次生成时生效', '');
    });
    $('#generateBtn').addEventListener('click', () => generateAll());
    $('#regenerateAll').addEventListener('click', () => { if (state.copy.versions.length) generateAll(); else toast('先生成一次文案吧', 'warn'); });

    $('#approveBtn').addEventListener('click', approve);
    $('#autoFixBtn').addEventListener('click', autoFix);
    $('#publishBtn').addEventListener('click', publish);

    $('#bellBtn').addEventListener('click', () => toast('你有 3 条新提醒：2 条热点预警 + 1 条审核通知', ''));
    $('#userBtn').addEventListener('click', e => {
      e.stopPropagation();
      const m = $('#userMenu');
      m.hidden = !m.hidden;
      $('#userBtn').setAttribute('aria-expanded', String(!m.hidden));
    });
    document.addEventListener('click', () => { $('#userMenu').hidden = true; });
    $$('#userMenu button').forEach(b => b.addEventListener('click', () => toast('「' + b.textContent + '」为演示入口', '')));
    $('#modalCancel').addEventListener('click', () => { $('#modalMask').hidden = true; });

    // 键盘快捷切换步骤（演示用）
    document.addEventListener('keydown', e => {
      if (e.altKey && e.key >= '1' && e.key <= '5') goStep(Number(e.key));
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
