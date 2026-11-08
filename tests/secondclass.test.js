const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CATEGORIES,
  formatCredits,
  normalizeRecord,
  roundCredits,
  summarize
} = require('../utils/secondclass');

const SAMPLE = [
  { id: '1', title: '社区志愿服务', category: 'volunteer', date: '2026-11-05', credits: 2 },
  { id: '2', title: '校园清扫', category: 'labor', date: '2026-10-20', credits: 0.5 },
  { id: '3', title: '前沿讲座', category: 'lecture', date: '2026-11-01', credits: 1 },
  { id: '4', title: '支教', category: 'volunteer', date: '2026-09-01', credits: 1.5 }
];

test('二课记录按类别汇总学分与条数', () => {
  const { total, totalText, count, byCategory } = summarize(SAMPLE);
  assert.equal(count, 4);
  assert.equal(total, 5);
  assert.equal(totalText, '5');

  const volunteer = byCategory.find((item) => item.key === 'volunteer');
  assert.equal(volunteer.credits, 3.5);
  assert.equal(volunteer.count, 2);

  // 没有记录的类别不出现在汇总里，免得界面上全是 0
  assert.equal(byCategory.some((item) => item.key === 'innovation'), false);
});

test('记录按日期倒序，最新的在最上面', () => {
  const { list } = summarize(SAMPLE);
  assert.deepEqual(list.map((item) => item.id), ['1', '3', '2', '4']);
});

test('脏数据收敛：未知类别归到「其他」、负学分归零、非法日期清空', () => {
  const record = normalizeRecord({ title: '  志愿活动  ', category: '不存在', credits: -3, date: '昨天' });
  assert.equal(record.title, '志愿活动');
  assert.equal(record.category, 'other');
  assert.equal(record.credits, 0);
  assert.equal(record.date, '');
  assert.equal(CATEGORIES.some((item) => item.key === record.category), true);
});

test('没有名称的记录不计入学分', () => {
  const { count, total } = summarize([{ title: '   ', credits: 3 }, { title: '正常', credits: 1 }]);
  assert.equal(count, 1);
  assert.equal(total, 1);
});

test('学分不留浮点尾巴', () => {
  assert.equal(roundCredits(0.1 + 0.2), 0.3);
  assert.equal(formatCredits(0.30000000000000004), '0.3');
  const { totalText } = summarize([
    { title: 'A', credits: 0.1 },
    { title: 'B', credits: 0.2 }
  ]);
  assert.equal(totalText, '0.3');
});

test('空列表不会炸', () => {
  const empty = summarize([]);
  assert.equal(empty.count, 0);
  assert.equal(empty.totalText, '0');
  assert.deepEqual(empty.byCategory, []);
  assert.deepEqual(summarize(undefined).list, []);
});
