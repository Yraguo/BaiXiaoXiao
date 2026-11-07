const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('五个主页面都登记为 tabBar', () => {
  const app = JSON.parse(read('app.json'));
  assert.deepEqual(app.tabBar.list.map((item) => item.text), ['课表', '记事', '小鸮', '校园', '我的']);
});

test('所有删除路径都包含影响条数和不可恢复说明', () => {
  const confirm = read('utils/confirm.js');
  assert.match(confirm, /影响.*条数据/);
  assert.match(confirm, /删除后无法恢复/);
  assert.match(read('pages/notes/index.js'), /confirmDelete/);
  assert.match(read('pages/uni/index.js'), /confirmDelete/);
  assert.match(read('pages/me/index.js'), /confirmDelete/);
});

test('小鸮提供历史记录与系统键盘语音提示', () => {
  const page = read('pages/uni/index.js');
  assert.match(page, /loadHistory/);
  assert.match(page, /系统键盘/);
  assert.match(page, /键盘上的麦克风/);
});

test('小鸮的周次取自课表设置，不再是写死的数字', () => {
  const page = read('pages/uni/index.js');
  const brain = read('utils/uni.js');
  assert.match(page, /loadSettings\(/, '页面要把学期设置传给小鸮');
  assert.match(page, /loadCourses\(/, '页面要把真实课程传给小鸮');
  assert.match(brain, /currentWeek\(/, '周次要按学期开始日期算');
  assert.doesNotMatch(page + brain, /week:\s*\d+/, '不允许再把周次写死');
});

test('两种导入方式共用同一套课程映射，不会各自漂移', () => {
  const shared = require('../utils/courseMap');
  const jw = require('../utils/jw/mapper');
  const pdf = require('../utils/pdf/courses');

  assert.deepEqual(jw.COURSE_FIELDS, shared.COURSE_FIELDS);
  assert.deepEqual(pdf.COURSE_FIELDS, shared.COURSE_FIELDS);

  const rows = [{ name: '高等数学', teacher: '张三', room: '教A-203', day: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2, 22] }];
  const fromJw = jw.toCourses(rows, 22)[0];
  const fromPdf = pdf.toCourses(rows, 22)[0];
  assert.equal(fromJw.id.startsWith('course-jw-'), true);
  assert.equal(fromPdf.id.startsWith('course-pdf-'), true);
  assert.deepEqual({ ...fromJw, id: '' }, { ...fromPdf, id: '' }, '两条链路的字段与取值必须一致');
  assert.deepEqual(fromJw.weeks, [1, 2, 22], '总周数够用时不能裁掉尾部周次');
});
