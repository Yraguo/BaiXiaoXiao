const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ART_TABLE,
  CONTEST_TABLE,
  PLATE_CAPS,
  PLATES,
  SPORT_TABLE,
  TERMS,
  TOTAL_FULL,
  normalizeHour,
  normalizeRecord,
  plateTotals,
  summarize,
  summarizeHours,
  usageOf
} = require('../utils/secondclass');

const { layout: layoutSheet, fitText } = require('../utils/materials');

const SAMPLE = [
  { id: '1', plate: 'lao', title: '社区志愿服务', date: '2026-10-15', score: 20 },
  { id: '2', plate: 'mei', title: '美育讲座', date: '2026-10-13', score: 10 },
  { id: '3', plate: 'ti', title: '奔跑在北化打卡', date: '2026-10-11', score: 30 },
  { id: '4', plate: 'zhi', title: '学科竞赛校内选拔', date: '2026-10-07', score: 25 },
  { id: '5', plate: 'de', title: '学院主题团日', date: '2026-10-04', score: 10 }
];

test('五板块满分与上限与手册一致，合计 600', () => {
  const caps = Object.fromEntries(PLATES.map((plate) => [plate.short, [plate.full, plate.base, plate.extra]]));
  assert.deepEqual(caps, {
    德: [180, 144, 36],
    智: [120, 96, 24],
    体: [100, 80, 20],
    美: [100, 80, 20],
    劳: [100, 80, 20]
  });
  assert.equal(TOTAL_FULL, 600);
  assert.deepEqual(PLATE_CAPS.map((item) => item.full), [180, 120, 100, 100, 100]);
});

test('合计自评按板块分别累计', () => {
  const { total, totalText, count, plates } = summarize(SAMPLE);
  assert.equal(count, 5);
  assert.equal(total, 95);
  assert.equal(totalText, '95');
  assert.equal(plates.find((plate) => plate.key === 'ti').score, 30);
  assert.equal(plates.find((plate) => plate.key === 'de').score, 10);
});

test('单个板块超过满分时按满分计', () => {
  const { total, plates } = summarize([
    { plate: 'ti', title: 'A', score: 80 },
    { plate: 'ti', title: 'B', score: 40 }
  ]);
  const ti = plates.find((plate) => plate.key === 'ti');
  assert.equal(ti.raw, 120, '原始累计照实记');
  assert.equal(ti.score, 100, '计入合计时封顶 100');
  assert.equal(total, 100);
});

test('记录按日期倒序，没有名称的不计入', () => {
  const { list, count } = summarize(SAMPLE.concat([{ plate: 'de', title: '   ', score: 30 }]));
  assert.equal(count, 5);
  assert.deepEqual(list.map((item) => item.id), ['1', '2', '3', '4', '5']);
});

test('脏数据收敛：未知板块归德、负分归零、非法日期清空、照片最多 9 张', () => {
  const record = normalizeRecord({
    plate: 'unknown',
    title: '  活动  ',
    date: '昨天',
    score: -5,
    photos: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
  });
  assert.equal(record.plate, 'de');
  assert.equal(record.title, '活动');
  assert.equal(record.score, 0);
  assert.equal(record.date, '');
  assert.equal(record.photos.length, 9, '照片上限对齐安卓版的 9 张');
  assert.equal(record.level, 'base', '没写评定类型时归入基础');
  assert.equal(record.hours, 0);
  assert.equal(record.address, '');
});

test('时长按学期分组，并单独统计今年', () => {
  const records = [
    { kind: 'volunteer', term: '大一上', title: '图书馆志愿', hours: 4, date: '2026-10-01' },
    { kind: 'volunteer', term: '大一上', title: '社区服务', hours: 2.5, date: '2026-10-02' },
    { kind: 'volunteer', term: '大一下', title: '迎新志愿', hours: 6, date: '2025-09-01' },
    { kind: 'labor', term: '大一上', title: '包干劳动', hours: 8, date: '2026-09-20' }
  ];
  const volunteer = summarizeHours(records, 'volunteer', 2026);
  assert.equal(volunteer.total, 12.5);
  assert.equal(volunteer.yearTotal, 6.5, '只算 2026 年的');
  assert.equal(volunteer.yearCount, 2);
  assert.deepEqual(volunteer.groups.map((group) => [group.term, group.hours]),
    [['大一上', 6.5], ['大一下', 6], ['大二上', 0], ['大二下', 0], ['大三上', 0], ['大三下', 0], ['大四上', 0], ['大四下', 0]]);

  const labor = summarizeHours(records, 'labor', 2026);
  assert.equal(labor.total, 8, '劳育与志愿是两套口径，互不串');
});

test('时长脏数据：负时长与空名称不入账，学期非法回落到大一上', () => {
  const record = normalizeHour({ term: '研一', title: 'x', hours: -3, date: '' }, 'labor');
  assert.equal(record.kind, 'labor');
  assert.equal(record.term, TERMS[0]);
  assert.equal(record.hours, 0);
  const result = summarizeHours([{ term: '大一上', title: 'x', hours: 0 }], 'volunteer', 2026);
  assert.equal(result.count, 0);
  assert.equal(result.totalText, '0');
});

test('三张竞赛分值表的列数与每行分数个数一致', () => {
  [CONTEST_TABLE, SPORT_TABLE, ART_TABLE].forEach((table) => {
    assert.ok(table.columns.length >= 4, `${table.title} 列数异常`);
    table.rows.forEach((row) => {
      assert.equal(row.scores.length, table.columns.length, `${table.title} 的「${row.label}」分数个数与列数不符`);
    });
  });
});


test('材料清单图：高度随记录数增长，副标题带基础/拓展与时长', () => {
  const summary = summarize([
    { plate: 'de', title: '主题团日', date: '2026-10-04', score: 10 },
    { plate: 'de', title: '志愿宣讲', date: '2026-10-06', score: 5, level: 'extra', hours: 4 }
  ]);
  const model = layoutSheet(summary, new Date(2026, 10, 8, 16, 20));
  assert.equal(model.width, 750);
  assert.equal(model.items.length, 2);
  assert.ok(model.height > 600, '有记录时要撑开高度');
  assert.equal(model.plates.length, 5, '五板块都要有');
  // 记录按日期倒序，10-06 那条（拓展 + 4 小时）排在前面
  assert.match(model.items[0].meta, /拓展/);
  assert.match(model.items[0].meta, /4 小时/);
  assert.match(model.items[1].meta, /基础/);

  const empty = layoutSheet(summarize([]), new Date(2026, 10, 8));
  assert.ok(model.height > empty.height, '记录越多图越高');
  assert.equal(empty.items.length, 0);
});

test('清单图文字超宽时截断加省略号', () => {
  const ctx = { measureText: (text) => ({ width: String(text).length * 20 }) };
  assert.equal(fitText(ctx, '短标题', 400), '短标题');
  const cut = fitText(ctx, '化工过程安全与具身智能前沿研讨', 200);
  assert.ok(cut.endsWith('…'), '超宽要加省略号');
  assert.ok(ctx.measureText(cut).width <= 200 + 20, '截断后不能还超宽');
});

test('板块条上的「已得/满分」：按板块汇总、按满分封顶、编辑时排除自己', () => {
  const totals = plateTotals(SAMPLE);
  assert.deepEqual(Object.keys(totals), ['de', 'zhi', 'ti', 'mei', 'lao'], '五板块顺序要与 PLATES 一致');
  // SAMPLE 里德 10、智 25、体 30、美 10、劳 20，都远没到满分
  assert.equal(totals.de, '10/180');
  assert.equal(totals.zhi, '25/120');
  assert.equal(totals.ti, '30/100');
  assert.equal(totals.lao, '20/100');

  // 编辑某条记录时，它自己不该算进「已得」
  const editing = plateTotals(SAMPLE, '3');
  assert.equal(editing.ti, '0/100');

  // 单条先按档位上限收（基础 144 / 拓展 36），合计再按满分封顶，不出现 200/180 这种
  const overflow = plateTotals([
    { plate: 'de', title: '基础堆满', date: '2026-10-01', score: 200, level: 'base' },
    { plate: 'de', title: '拓展堆满', date: '2026-10-02', score: 60, level: 'extra' }
  ]);
  assert.equal(overflow.de, '180/180');

  // 空数据也要给出可读的 0/N，而不是 undefined
  const empty = plateTotals([]);
  PLATES.forEach((plate) => {
    assert.equal(empty[plate.key], `0/${plate.full}`, `${plate.short} 空数据回显不对`);
  });
});

test('填报表单上方的「本档已用」含自己：列表里 10 分，进来就不能显示 0', () => {
  // 这条记录已经在列表里了（用户点「编辑」进来）
  const records = [
    { id: 'sc-1', plate: 'de', title: '吃屎', date: '2026-11-08', score: 10, level: 'base' }
  ];

  // 之前 refreshUsage 把 draft.id 当 excludeId 传进去，于是上方永远是 0 ——
  // 明明下面板块条写着「德 10/180」，上面却是「本档已用 0 / 144」。
  const withoutSelf = usageOf(records, 'de', 'base', 'sc-1');
  assert.equal(withoutSelf.used, 0, '排除自己确实是 0，这正是那个 bug 的来源');

  const withSelf = usageOf(records, 'de', 'base');
  assert.equal(withSelf.used, 10, '不排除自己才是用户看到的真实值');
  assert.equal(withSelf.remain, 134, '「还能加」也要按含自己的口径算');
});
