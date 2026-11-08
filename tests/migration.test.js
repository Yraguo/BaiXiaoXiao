const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('五个主页面合并进一个横向轨道容器', () => {
  const app = JSON.parse(read('app.json'));
  const main = read('pages/main/index.wxml');
  const wxss = read('pages/main/index.wxss');
  const tabbar = read('components/tabbar/index.js');

  // 合并成单页之后，app.json 的 tabBar 没法再配——它的 pagePath 必须是真实页面
  assert.equal(app.tabBar, undefined, '合并成一个页面后不应再有 app.json tabBar');

  ['pages/timetable/index', 'pages/secondclass/index', 'pages/uni/index', 'pages/campus/index', 'pages/me/index']
    .forEach((route) => {
      assert.equal(app.pages.includes(route), false, `${route} 不该再注册为页面`);
    });

  assert.equal(app.pages[0], 'pages/main/index', '容器页要排在第一位');

  // 用纯 transform 轨道而不是 swiper：swiper 的 disable-touch 在手势竞争下拦不住原生滑动
  assert.equal((main.match(/class="tab-pane"/g) || []).length, 5, '五屏都要常驻在轨道上');
  assert.match(main, /class="tab-track"[^>]*translateX/, '位移由 current 驱动');
  assert.doesNotMatch(main, /<swiper[\s>]/, '不要再退回 swiper');
  assert.match(wxss, /\.tab-pane[\s\S]{0,200}transform: translateZ\(0\)/, '每屏要自成包含块，否则 fixed 元素会跑到第一屏');

  ['课表', '第二课堂', '小鸮', '校园', '我的'].forEach((text) => {
    assert.match(tabbar, new RegExp(text), `底部导航缺少 ${text}`);
  });
});

test('课表页同时承载课表与记事本两个视图', () => {
  const wxml = read('pages/timetable/index.wxml');
  const js = read('pages/timetable/index.js');
  assert.match(wxml, /data-view="notes"/, '要有记事本视图入口');
  assert.match(js, /renderNotes\(\)/, '日历渲染要搬进课表页');
  assert.match(js, /loadNotes\(\)/, '要读记事数据');
  assert.equal(fs.existsSync(path.join(root, 'pages/notes/index.js')), false, '旧记事页应已删除');
});

test('所有删除路径都包含影响条数和不可恢复说明', () => {
  const confirm = read('utils/confirm.js');
  assert.match(confirm, /影响.*条数据/);
  assert.match(confirm, /删除后无法恢复/);
  // 记事已并入课表页（底部 tab 让给第二课堂），删除入口跟着搬过去
  assert.match(read('pages/timetable/index.js'), /confirmDelete/);
  assert.match(read('pages/uni/index.js'), /confirmDelete/);
  assert.match(read('pages/me/index.js'), /confirmDelete/);
  assert.match(read('pages/secondclass/edit.js'), /confirmDelete/);
});

test('小鸮提供历史记录与系统键盘语音提示', () => {
  const page = read('pages/uni/index.js');
  assert.match(page, /loadHistory/);
  assert.match(page, /系统键盘/);
  assert.match(page, /键盘上的麦克风/);
});

test('小鸮的周次取自课表设置，不再是写死的数字', () => {
  const page = read('pages/uni/index.js');
  const brain = read('utils/agent/index.js') + read('utils/agent/nlu.js');
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
