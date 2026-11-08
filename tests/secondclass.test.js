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
  summarize,
  summarizeHours
} = require('../utils/secondclass');

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

test('脏数据收敛：未知板块归德、负分归零、非法日期清空、照片最多 6 张', () => {
  const record = normalizeRecord({
    plate: 'unknown',
    title: '  活动  ',
    date: '昨天',
    score: -5,
    photos: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  });
  assert.equal(record.plate, 'de');
  assert.equal(record.title, '活动');
  assert.equal(record.score, 0);
  assert.equal(record.date, '');
  assert.equal(record.photos.length, 6);
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
