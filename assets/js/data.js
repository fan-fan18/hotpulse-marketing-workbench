/* =========================================================
   Mock 数据层
   —— 后续接入真实接口时，只需把 window.MOCK 换成 fetch/Coze 返回，
      数据结构保持不变即可（详见 工程文档/接口预留说明.md）
   ========================================================= */
window.MOCK = (function () {

  /* ---------------- Step 1：实时热点新闻 ---------------- */
  const NEWS = [
    {
      id: 'n1', sourceId: 'src_weather', cat: '民生天气', source: '中国天气网', time: '14:32', minutesAgo: 18,
      title: '冷空气来袭！北方多地气温骤降 10℃，一夜入秋',
      summary: '中央气象台发布降温预警，华北、东北多地最高气温跌至 15℃ 以下，全国「秋装」相关搜索量单日暴涨 312%，羽绒服、加绒外套、取暖小家电进入爆发期。',
      heat: 986, growth: 42, keywords: ['冷空气', '一夜入秋', '断崖式降温', '保暖'],
      tags: ['热搜第 3', '搜索暴涨', '强购买意图'],
      topics: ['#冷空气来了#', '#一夜入秋#', '#秋冬保暖好物#'],
      spark: [22, 30, 38, 41, 58, 79, 96]
    },
    {
      id: 'n2', sourceId: 'src_sina', cat: '科技数码', source: '新浪科技', time: '13:05', minutesAgo: 62,
      title: 'iPhone 17 首销火爆：线下门店排队超预期，部分配色已断货',
      summary: '首发日全国多地门店排起长队，第三方平台预约量同比增长 60%，「新机配件」「磁吸充电」等相关词同步上行，配件类目转化周期明显短于整机。',
      heat: 942, growth: 35, keywords: ['iPhone 17', '首销', '断货', '手机配件'],
      tags: ['热搜第 1', '高客单', '配件连带'],
      topics: ['#iPhone17首销#', '#新机开箱#', '#手机配件推荐#'],
      spark: [35, 44, 52, 61, 70, 84, 92]
    },
    {
      id: 'n3', sourceId: 'src_ctrip', cat: '出行旅游', source: '携程研究院', time: '11:48', minutesAgo: 128,
      title: '国庆出游预订量同比大涨 68%：小众目的地成最大黑马',
      summary: '假期前 7 天，全国机票、酒店预订量同比上涨 68%，「2 小时高铁圈」「小众县城」搜索翻倍，出行前装备与便携收纳类目同步走高。',
      heat: 913, growth: 28, keywords: ['国庆出行', '小众目的地', '轻装', '收纳'],
      tags: ['假期前瞻', '提前购', '装备需求'],
      topics: ['#国庆去哪儿玩#', '#旅行好物清单#', '#轻装上阵#'],
      spark: [40, 47, 51, 62, 69, 74, 88]
    },
    {
      id: 'n4', sourceId: 'src_weibo', cat: '生活方式', source: '微博热搜', time: '09:20', minutesAgo: 236,
      title: '打工人熬夜看球上热搜：熬夜后如何快速「回血」引发热议',
      summary: '赛事节点叠加工作日，,#熬夜回血# 话题阅读量突破 4.2 亿，眼霜、褪黑素、速食早餐、按摩仪等「补救型消费」显著增长。',
      heat: 878, growth: 19, keywords: ['熬夜', '回血', '补救', '实测'],
      tags: ['话题破亿', '情绪共鸣', '高互动'],
      topics: ['#熬夜回血指南#', '#打工人的自救#', '#深夜实录#'],
      spark: [28, 33, 36, 48, 55, 63, 71]
    },
    {
      id: 'n5', sourceId: 'src_xhs', cat: '户外露营', source: '小红书趋势', time: '昨日 21:10', minutesAgo: 420,
      title: '露营热度回潮：城市周边「2 小时车程」成为最受欢迎半径',
      summary: '秋季露营笔记量环比增长 74%，「轻量化」「一键展开」「后备箱收纳」成为高频关键词，初级露营装备客单价集中在 100–500 元区间。',
      heat: 845, growth: 12, keywords: ['露营', '轻量化', '周末', '装备'],
      tags: ['笔记增长', '周末场景', '入门装备'],
      topics: ['#秋日露营#', '#周末去哪儿#', '#露营装备清单#'],
      spark: [30, 34, 39, 44, 52, 60, 66]
    },
    {
      id: 'n6', sourceId: 'src_qbit', cat: '科技数码', source: '量子位', time: '10:15', minutesAgo: 205,
      title: '国产大模型开源新版本登顶榜单，开发者集体「沸腾」',
      summary: '新版本在多项权威评测中超越同规模模型，「本地部署」「消费级显卡跑得动」成为开发者讨论焦点，硬件与生产力工具类目搜索同步上扬。',
      heat: 812, growth: 66, keywords: ['大模型', '开源', '本地部署', '生产力'],
      tags: ['增速最快', '开发者人群', '高客单'],
      topics: ['#国产大模型#', '#开发者日常#', '#效率工具#'],
      spark: [18, 26, 31, 46, 62, 78, 90]
    },
    {
      id: 'n7', sourceId: 'src_health', cat: '健康养生', source: '人民日报健康', time: '08:40', minutesAgo: 322,
      title: '秋燥让人嗓子不舒服，「润喉养肺」搜索量一周上涨 190%',
      summary: '换季阶段咽喉不适人群增多，秋梨膏、罗汉果茶、加湿器等「润燥」商品搜索量一周上涨 190%，35 岁以上女性人群购买占比最高。',
      heat: 776, growth: 9, keywords: ['秋燥', '润喉', '养肺', '送长辈'],
      tags: ['刚需复购', '女性人群', '送礼场景'],
      topics: ['#秋季养生#', '#秋燥润喉#', '#送长辈的礼物#'],
      spark: [26, 30, 33, 37, 42, 47, 51]
    },
    {
      id: 'n8', sourceId: 'src_eo', cat: '生活方式', source: '经济观察报', time: '昨日 18:30', minutesAgo: 520,
      title: '「早八养生」在年轻人中流行：保温杯里泡枸杞升级成「新中式」',
      summary: '办公室养生话题持续升温，「办公室小家电」「每日坚果」「热饮」销量走高，20–30 岁人群成为养生消费新增量。',
      heat: 742, growth: 15, keywords: ['养生', '办公室', '新中式', '保温杯'],
      tags: ['年轻人群', '日常复购', '内容易扩散'],
      topics: ['#早八养生#', '#办公室摸鱼养生#', '#新中式生活#'],
      spark: [24, 27, 31, 36, 40, 46, 52]
    }
  ];

  /* ---------------- 商品库 ---------------- */
  const PRODUCTS = [
    {
      id: 'p1', name: '三合一防风冲锋衣 加绒可拆内胆', brand: '拓行 TROXON', cat: '服饰鞋包',
      price: 299, marketPrice: 599, stock: 1280, rating: 4.9, sales30d: 12480, conversion: 6.4, gmv30d: 373.2,
      emoji: '🧥', sku: 'TX-A219', points: ['加绒内胆可拆', '防风防泼水面料', '显瘦直筒版型']
    },
    {
      id: 'p2', name: '德绒半高领打底衫 恒温亲肤', brand: '暖叙 Nuanxu', cat: '服饰鞋包',
      price: 89, marketPrice: 199, stock: 3260, rating: 4.8, sales30d: 28600, conversion: 8.1, gmv30d: 254.6,
      emoji: '👕', sku: 'NX-DR08', points: ['德绒自发热', '半高领护脖子', '洗 30 次不变形']
    },
    {
      id: 'p3', name: '石墨烯蓄热冬被 双人加厚款', brand: '眠也 Sleepy', cat: '家居家纺',
      price: 369, marketPrice: 799, stock: 860, rating: 4.9, sales30d: 6420, conversion: 4.8, gmv30d: 236.9,
      emoji: '🛏️', sku: 'MY-GR12', points: ['石墨烯升温快 1.8 倍', 'A 类母婴级面料', '整被可机洗不跑绒']
    },
    {
      id: 'p4', name: '迷你桌面暖风机 静音速热', brand: '小暖星球', cat: '家用电器',
      price: 129, marketPrice: 249, stock: 2140, rating: 4.7, sales30d: 15800, conversion: 5.6, gmv30d: 203.8,
      emoji: '🔥', sku: 'XN-HF03', points: ['3 秒速热', '运行仅 38dB', '倾倒自动断电']
    },
    {
      id: 'p5', name: '恒温电热水杯 316 不锈钢 500ml', brand: '汤叙', cat: '家用电器',
      price: 159, marketPrice: 299, stock: 1560, rating: 4.8, sales30d: 9340, conversion: 5.1, gmv30d: 148.5,
      emoji: '🥤', sku: 'TX-HC50', points: ['55℃ 恒温一整天', '316 不锈钢内胆', '烧水保温一杯搞定']
    },
    {
      id: 'p6', name: '磁吸无线充电宝 10000mAh 超薄款', brand: '极充 POWGO', cat: '数码配件',
      price: 199, marketPrice: 329, stock: 1980, rating: 4.8, sales30d: 21600, conversion: 7.2, gmv30d: 429.8,
      emoji: '🔋', sku: 'PG-MG10', points: ['磁吸即充不用线', '8mm 超薄可上飞机', '20W 快充不发烫']
    },
    {
      id: 'p7', name: '液态硅胶防摔手机壳 亲肤手感', brand: '壳语', cat: '数码配件',
      price: 39, marketPrice: 99, stock: 6420, rating: 4.7, sales30d: 46800, conversion: 9.6, gmv30d: 182.5,
      emoji: '📱', sku: 'KY-LS01', points: ['镜头全包防摔', '亲肤不沾指纹', '9 色可选']
    },
    {
      id: 'p8', name: '氮化镓充电器 65W 双口快充', brand: '极充 POWGO', cat: '数码配件',
      price: 89, marketPrice: 159, stock: 2480, rating: 4.9, sales30d: 18200, conversion: 6.8, gmv30d: 161.9,
      emoji: '🔌', sku: 'PG-GaN65', points: ['一个头搞定两台设备', '比原装小 42%', '智能分配功率']
    },
    {
      id: 'p9', name: '便携折叠露营椅 承重 150kg', brand: '野行 WILDGO', cat: '户外运动',
      price: 129, marketPrice: 249, stock: 1120, rating: 4.8, sales30d: 8760, conversion: 5.4, gmv30d: 113.0,
      emoji: '🪑', sku: 'WG-C12', points: ['3 秒展开', '承重 150kg 不晃', '收纳仅水瓶大小']
    },
    {
      id: 'p10', name: '轻量黑胶天幕帐篷 防晒防雨', brand: '野行 WILDGO', cat: '户外运动',
      price: 469, marketPrice: 899, stock: 520, rating: 4.8, sales30d: 3120, conversion: 3.9, gmv30d: 146.3,
      emoji: '⛺', sku: 'WG-TT21', points: ['UPF50+ 黑胶防晒', '单人 10 分钟搭好', '地钉风绳全配齐']
    },
    {
      id: 'p11', name: '316 焖烧保温杯 12 小时控温', brand: '汤叙', cat: '家居家纺',
      price: 119, marketPrice: 239, stock: 1720, rating: 4.9, sales30d: 11200, conversion: 6.1, gmv30d: 133.3,
      emoji: '🍵', sku: 'TX-MB12', points: ['12 小时保温', '焖粥泡茶两用', '茶漏可拆洗']
    },
    {
      id: 'p12', name: '老字号纯梨熬制秋梨膏 300g', brand: '润和堂', cat: '食品生鲜',
      price: 79, marketPrice: 129, stock: 2860, rating: 4.9, sales30d: 16400, conversion: 7.4, gmv30d: 129.6,
      emoji: '🍐', sku: 'RHT-QG30', points: ['配料只有梨和冰糖', '温水一冲即饮', '独立小包便携']
    },
    {
      id: 'p13', name: '罗汉果金银花润喉茶 独立装 30 袋', brand: '润和堂', cat: '食品生鲜',
      price: 59, marketPrice: 118, stock: 3420, rating: 4.8, sales30d: 21800, conversion: 8.3, gmv30d: 128.6,
      emoji: '🫖', sku: 'RHT-CH13', points: ['0 蔗糖不齁甜', '独立三角包', '一泡即出味']
    },
    {
      id: 'p14', name: '玻尿酸密集补水面膜 20 片装', brand: '素研 SUYAN', cat: '美妆个护',
      price: 99, marketPrice: 199, stock: 4260, rating: 4.8, sales30d: 24300, conversion: 7.9, gmv30d: 240.6,
      emoji: '🧖', sku: 'SY-FM20', points: ['5 重玻尿酸', '膜布贴脸不滑落', '冷藏后急救提亮']
    },
    {
      id: 'p15', name: '熬夜急救紧致眼霜 15ml', brand: '素研 SUYAN', cat: '美妆个护',
      price: 189, marketPrice: 359, stock: 940, rating: 4.7, sales30d: 7600, conversion: 4.6, gmv30d: 143.6,
      emoji: '👁️', sku: 'SY-YE15', points: ['咖啡因快速消肿', '自带冰感按摩头', '早晚可用不搓泥']
    },
    {
      id: 'p16', name: '客制化机械键盘 87 键 三模', brand: '键语 KEYSELF', cat: '数码配件',
      price: 359, marketPrice: 599, stock: 680, rating: 4.8, sales30d: 5240, conversion: 4.2, gmv30d: 188.1,
      emoji: '⌨️', sku: 'KS-87T', points: ['三模一键切换', 'Gasket 软弹手感', '热插拔可换轴']
    },
    {
      id: 'p17', name: 'PCIe4.0 固态硬盘 1TB 读速 7000MB/s', brand: '极充 POWGO', cat: '数码配件',
      price: 429, marketPrice: 699, stock: 430, rating: 4.9, sales30d: 3860, conversion: 3.6, gmv30d: 165.6,
      emoji: '💽', sku: 'PG-SSD1T', points: ['读速 7000MB/s', '5 年质保 600TBW', '附散热马甲']
    },
    {
      id: 'p18', name: '静音主动降噪耳机 45 小时续航', brand: '声屿 SOUNDISLE', cat: '数码配件',
      price: 269, marketPrice: 499, stock: 1340, rating: 4.7, sales30d: 9800, conversion: 5.2, gmv30d: 263.6,
      emoji: '🎧', sku: 'SD-ANC45', points: ['-42dB 主动降噪', '45 小时长续航', '双设备同时连接']
    },
    {
      id: 'p19', name: '加厚珊瑚绒居家睡衣套装', brand: '暖叙 Nuanxu', cat: '服饰鞋包',
      price: 149, marketPrice: 299, stock: 2240, rating: 4.8, sales30d: 13600, conversion: 6.6, gmv30d: 202.6,
      emoji: '🧸', sku: 'NX-SP24', points: ['加厚珊瑚绒', '袖口裤脚收口', '男女同款可外穿']
    },
    {
      id: 'p20', name: '便携折叠收纳箱 55L 车载款', brand: '野行 WILDGO', cat: '户外运动',
      price: 69, marketPrice: 139, stock: 3180, rating: 4.7, sales30d: 19400, conversion: 7.8, gmv30d: 133.9,
      emoji: '🧳', sku: 'WG-BX55', points: ['折叠后仅 5cm 厚', '承重 80kg 可坐', '防水内衬易擦']
    }
  ];

  /* ---------------- 热点 → 商品 匹配关系（模拟算法输出） ---------------- */
  const MATCH_MAP = {
    n1: [
      { pid: 'p1', score: 96, reason: '「断崖式降温」下加绒外套搜索量 +312%，<b>客单价 299 元决策周期最短</b>，属于降温话题的第一顺位商品。' },
      { pid: 'p2', score: 92, reason: '低单价高复购，适合做「凑单 + 多件囤」钩子，<b>近 30 天转化率 8.1%</b> 为服饰类目最高。' },
      { pid: 'p4', score: 88, reason: '北方集中供暖前是桌面取暖设备爆发窗口，<b>与降温话题情绪高度一致</b>，适合做短视频挂车。' },
      { pid: 'p19', score: 85, reason: '「一夜入秋」带动居家保暖需求，情侣款具备<b>晒单与话题二次传播</b>属性。' },
      { pid: 'p3', score: 81, reason: '换季换被是家庭决策场景，客单价高，适合搭配「满减 + 免息」提高客单。' }
    ],
    n2: [
      { pid: 'p6', score: 95, reason: '新机首销期配件需求集中释放，磁吸充电宝<b>与原机使用场景强绑定</b>，决策链路短。' },
      { pid: 'p7', score: 91, reason: '9.9 元级尝鲜价 + 首销断货情绪，<b>转化率 9.6%</b>，是拉动店铺关注的最佳引流品。' },
      { pid: 'p8', score: 87, reason: '「新机不带充电头」是长期讨论点，65W 氮化镓可同时覆盖手机与笔电，<b>复购与连带能力强</b>。' },
      { pid: 'p18', score: 76, reason: '首销等待期用户停留时长高，耳机属于高客单利润款，可用于提升整体客单价。' },
      { pid: 'p17', score: 71, reason: '购机人群换机时同步升级存储，<b>适合做「以旧换新 + 扩容」组合</b>。' }
    ],
    n3: [
      { pid: 'p20', score: 93, reason: '「轻装上阵」出行场景刚需，55L 车载收纳箱<b>客单价低、加购率高</b>，适合做凑单。' },
      { pid: 'p9', score: 89, reason: '小众目的地多为户外与民宿场景，折叠椅<b>拍照出片率高</b>，利于社交传播。' },
      { pid: 'p13', score: 84, reason: '长途出行与异地气候不适应，润喉茶便携装适合做<b>旅行随身刚需</b>。' },
      { pid: 'p10', score: 80, reason: '国庆露营订单占比提升，天幕属于高客单装备，可配合「假期租赁转购买」话术。' },
      { pid: 'p5', score: 74, reason: '高铁与自驾途中热饮需求上升，恒温杯兼具<b>出行与办公双场景</b>。' }
    ],
    n4: [
      { pid: 'p15', score: 94, reason: '「熬夜回血」话题核心诉求是快速补救，眼霜<b>直接对应黑眼圈与浮肿</b>痛点，转化意愿强。' },
      { pid: 'p14', score: 89, reason: '熬夜后皮肤暗沉泛红，面膜是<b>低决策成本的即时补救方案</b>，适合做直播秒杀。' },
      { pid: 'p18', score: 83, reason: '深夜看赛事需要降噪与沉浸体验，<b>赛事时间与使用场景高度重合</b>。' },
      { pid: 'p13', score: 78, reason: '熬夜人群嗓子干痒，便携润喉茶是<b>办公室与家中双场景刚需</b>。' },
      { pid: 'p12', score: 72, reason: '熬夜后咳嗽人群增加，秋梨膏适合做「家庭常备」组合装。' }
    ],
    n5: [
      { pid: 'p9', score: 95, reason: '「轻量化 + 一键展开」正是折叠椅卖点，且<b>129 元处于入门装备最佳价格带</b>。' },
      { pid: 'p10', score: 88, reason: '秋季露营防晒仍是首要诉求，黑胶天幕<b>实测降温数据可直接做内容素材</b>。' },
      { pid: 'p20', score: 86, reason: '后备箱收纳是露营复购高频品，<b>69 元极易加购</b>，适合做满减凑单。' },
      { pid: 'p11', score: 79, reason: '露营热饮场景明确，焖烧杯可完成「出发前焖好、到场即饮」。' }
    ],
    n6: [
      { pid: 'p17', score: 94, reason: '「本地部署跑得动」直接指向存储与读写速度，<b>开发者人群客单价与复购意愿均高</b>。' },
      { pid: 'p16', score: 90, reason: '开发者长时间敲代码，客制化键盘属于<b>身份认同型消费</b>，社区传播性强。' },
      { pid: 'p8', score: 82, reason: '一台设备多口快充是开发者办公室刚需，<b>89 元决策成本极低</b>。' },
      { pid: 'p18', score: 77, reason: '专注场景需求突出，降噪耳机适合做「效率工具」组合推荐。' },
      { pid: 'p5', score: 70, reason: '长时间编码需要热饮提神，恒温杯可延伸「工位改造」内容选题。' }
    ],
    n7: [
      { pid: 'p12', score: 96, reason: '秋梨膏是「秋燥」最高认知度商品，<b>搜索与购买意图直接对应</b>，适合作为主推。' },
      { pid: 'p13', score: 92, reason: '无糖配方覆盖控糖人群，<b>独立包装拓展办公室与通勤场景</b>，复购稳定。' },
      { pid: 'p5', score: 83, reason: '「多喝温水」是最普遍的养生建议，恒温杯<b>把建议变成可购买的工具</b>。' },
      { pid: 'p11', score: 80, reason: '焖烧杯可制作润燥汤饮，内容延展性强，适合做养生系列选题。' },
      { pid: 'p14', score: 68, reason: '秋燥同时影响皮肤状态，可作为搭配加购，提升客单价。' }
    ],
    n8: [
      { pid: 'p5', score: 93, reason: '「保温杯里泡枸杞」升级为恒温杯，<b>产品即话题符号</b>，内容传播成本极低。' },
      { pid: 'p13', score: 88, reason: '办公室养生核心是「随手一杯」，三角包形态<b>完美匹配工位场景</b>。' },
      { pid: 'p11', score: 85, reason: '焖烧杯可焖粥焖银耳，新中式早餐内容天然适合小红书与微博双平台。' },
      { pid: 'p12', score: 79, reason: '送礼属性强，适合在节日节点做「送爸妈」组合推荐。' },
      { pid: 'p16', score: 66, reason: '年轻办公人群对桌面设备有审美诉求，可作为内容中的场景道具出现。' }
    ]
  };

  /* ---------------- Step 4：微博文案模板 ---------------- */
  const EMOJI_LIB = {
    0: ['', '', ''],
    1: ['🥶', '✨', '🔥'],
    2: ['🥶🥶', '✨👀✨', '🔥🔥🔥']
  };

  const CTAS = [
    '你们那边降了几度？评论区报个数 👇',
    '想要链接的姐妹扣个「1」，我挨个发～',
    '先囤还是再等等？评论区投一票 🙋',
    '同款姐妹评论区集合，我看看有多少人 🥰',
    '你打算买给自己还是送人？说说看 👇'
  ];

  const COPY_TEMPLATES = {
    种草安利: [
      '{hot}{e0} 说真的，这波我提前囤了。\n\n{product}，{p1}，{p2}。我自己最直观的感受是：{p3}，属于买回来当天就得用上的那种。\n\n现在 {price}，比平时 {anchor} 划算不少。{cta}\n{tags}',
      '{hot}{e1}\n\n刷到热搜第一反应就是：这种天气必须提前备好。\n\n{product} 我用了两周，{p1}；{p2}。\n重点是 {p3} —— 这一步真的把体验拉开了。\n\n{price} 入手，闭眼不亏。{cta}\n{tags}',
      '{hot}{e0}\n\n给大家交个底：{product} 我是冲着「{p2}」买的，结果被「{p3}」圈粉了。\n\n{p1}，日常、通勤、出差都能用，属于那种「用一次就回不去」的东西。\n\n{cta}\n{tags}'
    ],
    促销带货: [
      '{hot}{e2} 手慢就真的没了。\n\n{product} 今天 {price}（日常 {anchor}），{p1}，{p2}。\n\n{p3}，售完不补货。{cta}\n{tags}',
      '{hot}{e1}\n\n只在今天：{product} {price} 到手，直降不玩虚的。\n\n{p1}｜{p2}｜{p3}\n\n库存已经见底，需要的抓紧。{cta}\n{tags}',
      '{hot}{e0}\n\n这波特价我自己都下了两单：{product}。\n\n{p1}，{p2}，{p3}。\n{price}（原价 {anchor}），少喝两杯奶茶就有了。{cta}\n{tags}'
    ],
    悬念互动: [
      '{hot}{e1} 你猜我为什么把购物车清空了一半？\n\n因为这一件就够了：{product}。{p1}，{p2}，{p3}。\n\n{price} 到手，剩下的钱留着下周。{cta}\n{tags}',
      '{hot}{e0}\n\n有个问题想听听大家的：{hot}来了，你会先囤哪一件？\n\n我选的是 {product}——{p1}，{p2}。{p3}。\n\n{cta}\n{tags}',
      '{hot}{e2}\n\n先说结论：{product} 是我今年最不后悔的一单。\n\n{p1}，{p2}，{p3}。价格 {price}，比想象中友好。\n\n{cta}\n{tags}'
    ],
    情绪共鸣: [
      '{hot}{e0} 朋友圈已经被这件事刷屏了。\n\n说点实在的：{product}，{p1}，{p2}。{p3}。\n\n天冷的时候能让自己舒服一点，这件事本身就很值。{cta}\n{tags}',
      '{hot}{e1}\n\n每年这个时候都在提醒我：该对自己好一点了。\n\n{product} 我是回购的——{p1}，{p2}。{p3}，{price} 就能拿下。\n\n{cta}\n{tags}',
      '{hot}{e0}\n\n热点刷了一天，情绪也跟着起伏。给自己找了件小事做：把生活调成更省心的模式。\n\n{product}，{p1}；{p2}；{p3}。{price} 换一整个季节的踏实。{cta}\n{tags}'
    ]
  };

  return { NEWS, PRODUCTS, MATCH_MAP, COPY_TEMPLATES, EMOJI_LIB, CTAS };
})();
