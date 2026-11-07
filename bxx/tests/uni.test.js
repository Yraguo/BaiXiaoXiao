const test = require('node:test');
const assert = require('node:assert/strict');

const { defaultCourses, defaultSettings } = require('../data/defaults');
const { answer, ask } = require('../utils/uni');

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
  assert.doesNotMatch(text, /答不上来/, '这是回归点：这句话原来直接掉进兜底话术');
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

test('简称也能认：「高数在哪上」', () => {
  const text = answer('高数在哪上', context());
  assert.match(text, /《高等数学》/);
  assert.match(text, /教A-203/);
});

test('打错一个字也能认：「高待数学在哪上」', () => {
  const text = answer('高待数学在哪上', context());
  assert.match(text, /《高等数学》/);
});

test('没带课名时先反问，报了名字就接上', () => {
  const first = ask('在哪上', context());
  assert.match(first.text, /哪门课/);
  assert.equal(first.memory.pending.tool, 'course_info');

  const second = ask('高等数学', context(), first.memory);
  assert.match(second.text, /《高等数学》/);
  assert.match(second.text, /教A-203/);
});

test('追问「那周三呢」沿用上一个问题', () => {
  const first = ask('今天有什么课', context());
  assert.equal(first.memory.lastTool, 'day_schedule');

  const second = ask('那周三呢', context(), first.memory);
  assert.match(second.text, /周三/);
  assert.match(second.text, /中国近现代史纲要/);
});

test('问完某门课再问「那周三呢」，也能换成当天课表', () => {
  const first = ask('高数在哪上', context());
  assert.equal(first.memory.lastTool, 'course_info');

  const second = ask('那周三呢', context(), first.memory);
  assert.match(second.text, /周三/);
  assert.match(second.text, /节课/);
});

test('「明天呢」这种只剩时间的追问也能接住', () => {
  const first = ask('今天有什么课', context());
  const second = ask('明天呢', context(), first.memory);
  assert.match(second.text, /11月8日/);
});

test('「哪天上实验」能认出是问《物理实验》', () => {
  const text = answer('哪天上实验', context());
  assert.match(text, /《物理实验》/);
  assert.match(text, /周四/);
});

test('「记一下」生成记事动作，日期落到那一天', () => {
  const result = ask('记一下 周五交实验报告', context());
  assert.match(result.text, /记好了/);
  assert.equal(result.action.type, 'createNote');
  assert.equal(result.action.note.title, '交实验报告');
  assert.equal(result.action.note.date, '2026-11-13', '周六说的周五，应是下周五');
});

test('「记一下」没说内容时先问一句', () => {
  const first = ask('记一下', context());
  assert.match(first.text, /要记什么/);
  assert.equal(first.memory.pending.tool, 'create_note');

  const second = ask('交报告', context(), first.memory);
  assert.equal(second.action.note.title, '交报告');
});

test('开放问题走 FAQ 检索，不是一句"答不上来"', () => {
  const text = answer('换手机数据还在吗', context());
  assert.match(text, /云同步|重新导入/);
});

test('真答不上来时如实说明并给出可问的例子', () => {
  const text = answer('帮我订一张回家的火车票', context());
  assert.match(text, /答不上来/);
  assert.match(text, /今天有什么课/);
});
