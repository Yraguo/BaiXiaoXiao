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

test('时段筛选：周三下午只给下午的课', () => {
  const text = answer('周三下午有什么课', context());
  assert.match(text, /大学物理/);
  assert.doesNotMatch(text, /中国近现代史纲要/, '上午的课不该出现在下午的回答里');
});

test('时段没有课时，说明其他时段还有几节', () => {
  const text = answer('周三晚上有课吗', context());
  assert.match(text, /晚上没有课/);
  assert.match(text, /还有 2 节/);
});

test('精确到节次：周三第 6 节有课吗', () => {
  const text = answer('周三第6节有课吗', context());
  assert.match(text, /大学物理/);
  assert.match(text, /第 6 节/);
});

test('中文数字的周次也能解析', () => {
  const text = answer('第十周几节课', context());
  assert.match(text, /第 10 周/);
  assert.match(text, /9 个时间段/);
});

test('「下下周」按两周后算', () => {
  const text = answer('下下周三有什么课', context());
  assert.match(text, /11月18日/);
});

test('指代「它呢」沿用上一轮问过的课程', () => {
  const first = ask('高数在哪上', context());
  const second = ask('它呢', context(), first.memory);
  assert.match(second.text, /《高等数学》/);
  assert.match(second.text, /教A-203/);
});

test('周维度也能按时段统计', () => {
  const text = answer('这周下午有几节课', context());
  assert.match(text, /下午共 3 个时间段/);
  assert.match(text, /大学物理/);
  assert.doesNotMatch(text, /中国近现代史纲要/, '上午的课不该算进下午');
});

test('这周哪天没课', () => {
  const text = answer('这周哪天没课', context());
  assert.match(text, /周六、周日/);
});

test('今天还剩几节课按当前时间算', () => {
  assert.match(answer('今天还剩几节课', context()), /今天（周六）没有课/);

  const wednesdayMorning = new Date(2026, 10, 11, 8, 30);
  const text = answer('今天还剩几节课', context({ now: wednesdayMorning }));
  assert.match(text, /还有 2 节课/);
  assert.match(text, /中国近现代史纲要/);

  const wednesdayEvening = new Date(2026, 10, 11, 20, 0);
  assert.match(answer('今天还剩几节课', context({ now: wednesdayEvening })), /上完了/);
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

test('意图打分可解释：能看出为什么选了这个工具', () => {
  const { explain } = require('../utils/agent/index.js');
  const ranked = explain('周三下午有什么课', context());
  assert.equal(ranked[0].name, 'day_schedule');
  assert.ok(ranked[0].score >= 2);
  assert.ok(ranked.every((item) => item.score > 0));
});

test('真答不上来时如实说明并给出可问的例子', () => {
  const text = answer('帮我订一张回家的火车票', context());
  assert.match(text, /答不上来/);
  assert.match(text, /今天有什么课/);
});
