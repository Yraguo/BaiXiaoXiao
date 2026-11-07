const test = require('node:test');
const assert = require('node:assert/strict');

const { defaultCourses, defaultSettings } = require('../data/defaults');
const { answer } = require('../utils/uni');

// 2026-11-07 是第 10 周的周六，用它当固定"现在"，答案才可复现
const SATURDAY = new Date(2026, 10, 7, 20, 16);

function context(extra) {
  return Object.assign({
    now: SATURDAY,
    settings: defaultSettings(),
    courses: defaultCourses(),
    notes: []
  }, extra);
}

test('「我这周几节课」能算出真实数据，不再兜底', () => {
  const text = answer('我这周几节课', context());
  assert.match(text, /第 10 周/);
  assert.match(text, /9 个时间段/);
  assert.match(text, /高等数学/);
  assert.match(text, /周三/);
  assert.doesNotMatch(text, /答不上来|本机规则/, '这是回归点：这句话原来直接掉进兜底话术');
});

test('能按星期列出当天的课', () => {
  const text = answer('周一有什么课', context());
  assert.match(text, /高等数学/);
  assert.match(text, /大学英语/);
  assert.match(text, /程序设计基础/);
});

test('能算下一节课、教室和倒计时', () => {
  const text = answer('下节课是什么', context());
  assert.match(text, /高等数学/);
  assert.match(text, /教A-203/);
  assert.match(text, /2 天后/);
});

test('能查某门课在哪上、第几周', () => {
  const text = answer('高等数学在哪上', context());
  assert.match(text, /教A-203/);
  assert.match(text, /周一/);
  assert.match(text, /周次：/);
});

test('「下周三」要落到下一周，不能答成已经过去的周三', () => {
  const text = answer('下周三有什么课', context());
  assert.match(text, /11月11日/, '第 10 周周六问下周三，应该是 11 月 11 日');
});

test('能统计当天待办', () => {
  const notes = [
    { id: 'n1', title: '交高数作业', date: '2026-11-07', done: false },
    { id: 'n2', title: '复习线代', date: '2026-11-07', done: true }
  ];
  const text = answer('今天有什么待办', context({ notes }));
  assert.match(text, /交高数作业/);
  assert.match(text, /1 条待办/);
});

test('答不上来时如实说明并给出可问的例子', () => {
  const text = answer('帮我订一张回家的火车票', context());
  assert.match(text, /答不上来/);
  assert.match(text, /今天有什么课/);
});
