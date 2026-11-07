const test = require('node:test');
const assert = require('node:assert/strict');

const { chineseToNumber, editDistance, extractPeriod, isSubsequence, matchCourses } = require('../utils/agent/nlu');
const { lookup } = require('../utils/agent/faq');

const COURSES = [
  { name: '高等数学' },
  { name: '大学英语' },
  { name: '大学物理' },
  { name: '线性代数' },
  { name: '数据结构' }
];

test('跳字简称按子序列判定', () => {
  assert.equal(isSubsequence('高数', '高等数学'), true);
  assert.equal(isSubsequence('大物', '大学物理'), true);
  assert.equal(isSubsequence('线代', '线性代数'), true);
  assert.equal(isSubsequence('高代', '高等数学'), false);
});

test('编辑距离用于纠正手误', () => {
  assert.equal(editDistance('高待数学', '高等数学', 1), 1);
  assert.ok(editDistance('高等数学', '大学物理', 1) > 1);
});

test('课程名支持全称、简称与错别字', () => {
  assert.equal(matchCourses('高等数学在哪上', COURSES).name, '高等数学');
  assert.equal(matchCourses('高数在哪上', COURSES).name, '高等数学');
  assert.equal(matchCourses('线代作业是什么', COURSES).name, '线性代数');
  assert.equal(matchCourses('高待数学在哪上', COURSES).name, '高等数学');
});

test('像的课程会一起返回，交给上层反问', () => {
  const found = matchCourses('大学在哪上', COURSES);
  assert.ok(found.name === '大学英语' || found.name === '大学物理');
  assert.equal(found.others.length, 1, '另一门应该作为候选项返回');
});

test('没提课程名时不硬凑', () => {
  assert.equal(matchCourses('今天有什么课', COURSES).name, '');
});

test('FAQ 用 BM25 检索', () => {
  assert.match(lookup('怎么把课表导进去').answer, /PDF|导入/);
  assert.match(lookup('数据和隐私安全吗').answer, /本地|上传|不会/);
  assert.equal(lookup('帮我订一张火车票').answer, '', '无关问题不该硬套 FAQ');
});

test('中文数字能转成阿拉伯数字', () => {
  assert.equal(chineseToNumber('十'), 10);
  assert.equal(chineseToNumber('十二'), 12);
  assert.equal(chineseToNumber('二十'), 20);
  assert.equal(chineseToNumber('二十三'), 23);
  assert.equal(chineseToNumber('3'), 3);
  assert.ok(Number.isNaN(chineseToNumber('几')));
});

test('时段槽位区分粗粒度与精确节次', () => {
  assert.equal(extractPeriod('周三下午有课吗').label, '下午');
  assert.equal(extractPeriod('第3-4节呢').kind, 'periods');
  assert.equal(extractPeriod('第6节').from, 6);
  assert.equal(extractPeriod('今天有什么课'), null);
});

test('同义词归一后，换个说法也能检索到', () => {
  assert.match(lookup('课程表怎么导进去').answer, /PDF|导入/);
  assert.match(lookup('待办会提醒吗').answer, /通知|提醒/);
});
