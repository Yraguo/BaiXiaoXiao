/**
 * 第二课堂：五板块（德智体美劳）自评 + 志愿/劳育时长两条独立口径。
 *
 * 板块满分与上限取自《北京化工大学本科生学生手册·学生事务管理制度》
 * 第二至六章：德 180、智 120、体 100、美 100、劳 100，合计 600。
 * 每个板块分「基础上限」与「拓展上限」，超出满分按满分计。
 *
 * 这里只做学生自己的账本，最终认定以学校审核为准。
 */

/**
 * 板块配色。
 *
 * 之前列表页在页面里按下标去课表色板取色、表单页完全不用色，
 * 结果「德」在两页里长得不一样 —— 颜色属于板块本身，不是页面的装饰，
 * 所以这里收进数据层，两页共用同一份。
 *
 * 色值与课表色板同色系，但每个墨色都校过三重 WCAG AA 对比度：
 *   墨色压浅底 ≥ 4.5:1 · 白字压墨色 ≥ 4.5:1 · 墨色压白底 ≥ 4.5:1
 * （课表色板里的 #2F8F63 / #A9701C 直接拿来用只有 3.5~4.2:1，不达标）
 */
const PLATE_PALETTE = {
  de: { ink: '#2E5AAC', bg: '#E9EEFB' },
  zhi: { ink: '#B8462D', bg: '#FDE8E4' },
  ti: { ink: '#297C56', bg: '#E3F5EC' },
  mei: { ink: '#6E4BB0', bg: '#EFE8FA' },
  lao: { ink: '#966419', bg: '#FCF1DC' }
};

const PLATES = [
  { key: 'de', short: '德', name: '道德与思想素质', full: 180, base: 144, extra: 36 },
  { key: 'zhi', short: '智', name: '学术与科技创新', full: 120, base: 96, extra: 24 },
  { key: 'ti', short: '体', name: '体育与身心健康', full: 100, base: 80, extra: 20 },
  { key: 'mei', short: '美', name: '美学与人文素养', full: 100, base: 80, extra: 20 },
  { key: 'lao', short: '劳', name: '劳动与社会实践', full: 100, base: 80, extra: 20 }
].map((plate) => Object.assign({}, plate, PLATE_PALETTE[plate.key]));

const TOTAL_FULL = PLATES.reduce((sum, plate) => sum + plate.full, 0);

const TERMS = ['大一上', '大一下', '大二上', '大二下', '大三上', '大三下', '大四上', '大四下'];

/** 手册分值表 · 板块上限 */
const PLATE_CAPS = PLATES.map((plate) => ({
  key: plate.key,
  short: plate.short,
  name: `${plate.name}评定`,
  full: plate.full,
  base: plate.base,
  extra: plate.extra
}));

/** 手册分值表 · 学科竞赛 */
const CONTEST_TABLE = {
  title: '本科生各类学科竞赛分值表',
  columns: ['国家级', '省级', '市级', '校级'],
  rows: [
    { label: '一等奖（1~3名）', scores: [15, 12, 9, 7] },
    { label: '二等奖（4~6名）', scores: [12, 9, 7, 5] },
    { label: '三等奖（7~9名）', scores: [9, 7, 5, 3] },
    { label: '优秀奖', scores: [7, 5, 3, 2] }
  ],
  note: '设特等奖的赛事参照各级别一等奖计分；集体获奖按半数计分；同一作品按最高获奖分值计算。'
};

/** 手册分值表 · 体育竞赛 */
const SPORT_TABLE = {
  title: '本科生体育类竞赛分值表',
  columns: ['国际级', '国家级', '省级', '市级', '校级', '院级'],
  rows: [
    { label: '一等奖', scores: [20, 16, 12, 10, 8, 6] },
    { label: '二等奖', scores: [18, 14, 10, 8, 6, 4] },
    { label: '三等奖', scores: [16, 12, 8, 6, 4, 2] },
    { label: '优秀奖', scores: [14, 10, 6, 4, 2, 1] }
  ],
  note: '集体获奖按半数计分，上限 20 分。'
};

/** 手册分值表 · 美育比赛 */
const ART_TABLE = {
  title: '本科生美育类比赛分值表',
  columns: ['国际/国家级', '省部级', '市级', '校级', '院级'],
  rows: [
    { label: '一等奖（1~3名）', scores: [20, 18, 16, 13, 10] },
    { label: '二等奖（4~6名）', scores: [18, 16, 13, 10, 8] },
    { label: '三等奖（7~10名）', scores: [16, 13, 10, 8, 5] },
    { label: '优秀奖', scores: [13, 10, 8, 5, 3] }
  ],
  note: '集体获奖按半数计分，上限 20 分；设特等奖的参照各级别一等奖计分。'
};

/** 手册分值表 · 计分条款（可搜索） */
const CLAUSES = [
  { plate: 'de', score: 10, tiered: false, text: '参加校/院/班级德育类活动，一次 10 分，上限 50 分' },
  { plate: 'de', score: 35, tiered: false, text: '青年大学习当期全部完成计 35 分，缺一次扣 3 分' },
  { plate: 'de', score: 40, tiered: true, text: '践行学生行为准则满分 40 分，夜不归宿、违禁电器、实验违规等每次扣 20 分' },
  { plate: 'de', score: 30, tiered: true, text: '德育类荣誉或先进典型：国家级 30、市级 24、校级 16、院级 10，上限 30 分' },
  { plate: 'de', score: 20, tiered: true, text: '学生组织、社团、班级服务：优秀 20 分、称职 10 分，上限 20 分' },
  { plate: 'de', score: 20, tiered: false, text: '见义勇为、好人好事或在重大突发事件中表现突出，计 20 分' },
  { plate: 'zhi', score: 10, tiered: false, text: '在公开刊物或校级以上媒体发表德育类文章/作品，计 10 分' },
  { plate: 'zhi', score: 25, tiered: false, text: '参与校内外科技创新、创业竞赛并提交作品，或大创项目完成结题，计 25 分' },
  { plate: 'zhi', score: 15, tiered: false, text: '参加学科科技、创新创业竞赛，一次 15 分，上限 30 分' },
  { plate: 'zhi', score: 6, tiered: false, text: '参加学科科技、创新创业专题讲座或报告，一次 6 分，上限 30 分' },
  { plate: 'zhi', score: 30, tiered: true, text: '学习态度满分 30 分，无故不参加教育教学活动每满 1 学时扣 5 分' },
  { plate: 'zhi', score: 20, tiered: false, text: '取得教务处认定的学术论文、专利等成果，计 20 分' },
  { plate: 'ti', score: 10, tiered: true, text: '作为校队或普通生参加校级/院级体育竞赛，一次 10 分；观众一次 2 分，上限 20 分' },
  { plate: 'ti', score: 10, tiered: false, text: '参加体育、心理健康类活动，一次 10 分，上限 20 分' },
  { plate: 'ti', score: 30, tiered: false, text: '“奔跑在北化”打卡完成学期计划，计 30 分' },
  { plate: 'ti', score: 20, tiered: false, text: '国家大学生体质测试合格及免测计 20 分，不合格计 0 分' },
  { plate: 'ti', score: 15, tiered: true, text: '全民健身运动等级自主认定，分两档计 15 分、10 分' },
  { plate: 'mei', score: 10, tiered: true, text: '美育活动：演员、展览作者、参赛者一次 10 分，观众一次 5 分，上限 30 分' },
  { plate: 'mei', score: 10, tiered: false, text: '美育类专题讲座或报告，一次 10 分，上限 30 分' },
  { plate: 'mei', score: 5, tiered: false, text: '在慕课等平台学习音乐、美术、书法、舞蹈、戏剧等，每学时 5 分，上限 30 分' },
  { plate: 'mei', score: 20, tiered: false, text: '举办面向校内外个人艺术作品展览或公演，经认定计 20 分' },
  { plate: 'mei', score: 4, tiered: false, text: '参观美育类展馆、基地或参加实践活动，一次 4 分，上限 20 分' },
  { plate: 'lao', score: 20, tiered: false, text: '参加劳动实践活动（含劳动类课程实践环节），每学期满 10 学时计 20 分，不足不计' },
  { plate: 'lao', score: 20, tiered: false, text: '参加志愿服务，每学期满 10 小时计 20 分，不足不计' },
  { plate: 'lao', score: 15, tiered: false, text: '利用寒暑假在校外开展社会实践并完成当期任务，计 15 分' },
  { plate: 'lao', score: 20, tiered: true, text: '宿舍卫生：优 20、良 16、中 12、合格 10、不合格 0 分（每人计）' },
  { plate: 'lao', score: 10, tiered: true, text: '志愿服务、劳动实践获国家/省/市/校/院荣誉：10/8/6/4/2 分，只取最高项，上限 10 分' },
  { plate: 'lao', score: 5, tiered: false, text: '超出 10 小时部分，每服务或劳动 1 小时计 0.5 分，上限 5 分' },
  { plate: 'lao', score: 5, tiered: true, text: '获“十佳宿舍”“温馨之家”等称号，每人 5/3/2 分，上限 5 分' }
];

function plateOf(key) {
  return PLATES.find((plate) => plate.key === key) || PLATES[0];
}

/**
 * 基础 / 拓展两档，各有独立上限（德 144/36、智 96/24…）。
 * 上限是手册口径，放在数据层，页面不再自己算。
 */
function levelsOf(plate) {
  const target = plate && plate.key ? plate : plateOf(plate && plate.key);
  return [
    { key: 'base', name: '基础评定', cap: target.base, hint: '常规活动计入，上限 ' + target.base + ' 分' },
    { key: 'extra', name: '拓展评定', cap: target.extra, hint: '额外加分项，上限 ' + target.extra + ' 分' }
  ];
}

/** 某一档的上限：level 取 'base' / 'extra' */
function capOf(plateKey, level) {
  const plate = plateOf(plateKey);
  return level === 'extra' ? plate.extra : plate.base;
}

/**
 * 某一板块某一档已经用掉多少、还剩多少。
 * excludeId 用于编辑已有记录时把自己排除，否则会把自己算进「已用」。
 */
function usageOf(records, plateKey, level, excludeId) {
  const cap = capOf(plateKey, level);
  const list = (Array.isArray(records) ? records : [])
    .map(normalizeRecord)
    .filter((record) => record.plate === plateKey
      && (record.level === 'extra') === (level === 'extra')
      && record.id !== excludeId);
  const raw = roundScore(list.reduce((sum, record) => sum + record.score, 0));
  const used = Math.min(raw, cap);
  return {
    cap,
    used,
    raw,
    remain: Math.max(0, roundScore(cap - used)),
    count: list.length
  };
}

/**
 * 每个板块目前累计多少分（按板块满分封顶），返回 { 板块key: '已得/满分' }。
 * 板块选择条上要能一眼看出「德 144/180」这种，不进去翻列表。
 */
function plateTotals(records, excludeId) {
  const list = (Array.isArray(records) ? records : []).map(normalizeRecord);
  const out = {};
  PLATES.forEach((plate) => {
    const raw = roundScore(
      list.filter((record) => record.plate === plate.key && record.id !== excludeId)
        .reduce((sum, record) => sum + record.score, 0)
    );
    out[plate.key] = `${Math.min(raw, plate.full)}/${plate.full}`;
  });
  return out;
}

function roundScore(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function formatScore(value) {
  const number = Math.max(0, roundScore(value));
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

/** 二课记录：板块 + 事迹 + 日期 + 自评分 + 照片 */
function normalizeRecord(raw) {
  const source = raw || {};
  const date = String(source.date || '');
  const photos = Array.isArray(source.photos) ? source.photos.filter(Boolean).slice(0, 9) : [];
  return {
    id: String(source.id || ''),
    plate: PLATES.some((plate) => plate.key === source.plate) ? source.plate : 'de',
    title: String(source.title || '').trim(),
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    // 基础 / 拓展两档，上限不同（德 144/36、智 96/24…）
    level: source.level === 'extra' ? 'extra' : 'base',
    hours: Math.max(0, roundScore(source.hours)),
    // 按手册口径封顶：超出该档上限按满分计。
    // 以前不封顶，用户填 999 会原样存下并在列表里显示成 +999，
    // 直到汇总时才被静默截断，看着像 App 算错了。
    score: Math.min(
      capOf(PLATES.some((plate) => plate.key === source.plate) ? source.plate : 'de',
        source.level === 'extra' ? 'extra' : 'base'),
      Math.max(0, roundScore(source.score))
    ),
    photos,
    // 用了哪条手册条款（存条款原文，方便回看依据）
    clause: String(source.clause || '').trim(),
    note: String(source.note || '').trim(),
    address: String(source.address || '').trim(),
    latitude: String(source.latitude || '').trim(),
    longitude: String(source.longitude || '').trim(),
    watermark: Boolean(source.watermark),
    // 旧记录没有这个字段，默认当作「带地点」
    useLocation: source.useLocation !== false
  };
}

/** 每板块按满分截断：手册口径是「高于满分按满分计算」 */
function summarize(records) {
  const list = (Array.isArray(records) ? records : [])
    .map(normalizeRecord)
    .filter((record) => record.title)
    .sort((left, right) => String(right.date).localeCompare(String(left.date))
      || left.title.localeCompare(right.title, 'zh'));

  const plates = PLATES.map((plate) => {
    const items = list.filter((record) => record.plate === plate.key);
    const raw = roundScore(items.reduce((sum, record) => sum + record.score, 0));
    const capped = Math.min(raw, plate.full);
    // 基础 / 拓展分开统计：手册里这两档各有上限，合计不能超过板块满分
    const baseRaw = roundScore(items.filter((item) => item.level !== 'extra')
      .reduce((sum, record) => sum + record.score, 0));
    const extraRaw = roundScore(raw - baseRaw);
    return {
      key: plate.key,
      short: plate.short,
      name: plate.name,
      full: plate.full,
      base: Math.min(baseRaw, plate.base),
      extra: Math.min(extraRaw, plate.extra),
      baseRaw,
      extraRaw,
      fullBase: plate.base,
      fullExtra: plate.extra,
      score: capped,
      raw,
      count: items.length,
      percent: Math.round(capped / plate.full * 100)
    };
  });

  const total = roundScore(plates.reduce((sum, plate) => sum + plate.score, 0));
  return { list, plates, total, totalText: formatScore(total), full: TOTAL_FULL, count: list.length };
}

/** 时长记录：志愿 / 劳育，按学期分组 */
function normalizeHour(raw, kind) {
  const source = raw || {};
  const date = String(source.date || '');
  const hours = Math.max(0, Number(source.hours) || 0);
  return {
    id: String(source.id || ''),
    kind: kind === 'labor' ? 'labor' : 'volunteer',
    term: TERMS.indexOf(source.term) >= 0 ? source.term : TERMS[0],
    title: String(source.title || '').trim(),
    hours: roundScore(hours),
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    note: String(source.note || '').trim()
  };
}

function summarizeHours(records, kind, currentYear) {
  // 志愿与劳育是同一条存储里的两类记录，先按 kind 分开再统计，
  // 否则劳育时长会被算进志愿里
  const list = (Array.isArray(records) ? records : [])
    .filter((record) => (record && record.kind ? record.kind : kind) === kind)
    .map((record) => normalizeHour(record, kind))
    .filter((record) => record.title && record.hours > 0);

  const total = roundScore(list.reduce((sum, record) => sum + record.hours, 0));
  const year = Number(currentYear) || new Date().getFullYear();
  const yearList = list.filter((record) => record.date.indexOf(String(year)) === 0);
  const yearTotal = roundScore(yearList.reduce((sum, record) => sum + record.hours, 0));

  const groups = TERMS.map((term) => {
    const items = list.filter((record) => record.term === term)
      .sort((left, right) => String(right.date).localeCompare(String(left.date)));
    return {
      term,
      hours: roundScore(items.reduce((sum, record) => sum + record.hours, 0)),
      count: items.length,
      records: items
    };
  });

  return {
    list,
    groups,
    total,
    totalText: formatScore(total),
    yearTotal,
    yearText: formatScore(yearTotal),
    yearCount: yearList.length,
    count: list.length
  };
}

module.exports = {
  ART_TABLE,
  CLAUSES,
  CONTEST_TABLE,
  PLATE_CAPS,
  PLATES,
  SPORT_TABLE,
  TERMS,
  TOTAL_FULL,
  capOf,
  formatScore,
  levelsOf,
  normalizeHour,
  normalizeRecord,
  plateOf,
  plateTotals,
  roundScore,
  summarize,
  summarizeHours,
  usageOf
};
