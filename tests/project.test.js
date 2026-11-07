const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('项目配置中的页面文件完整', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  app.pages.forEach((page) => {
    ['js', 'json', 'wxml', 'wxss'].forEach((extension) => {
      assert.equal(fs.existsSync(path.join(root, `${page}.${extension}`)), true, `${page}.${extension}`);
    });
  });
});

test('所有 JSON 文件都能解析', () => {
  const queue = [root];
  while (queue.length) {
    const directory = queue.pop();
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      // debug/ 是本地探测抓下来的原始响应，格式不可控，不参与解析校验
      if (entry.name === '.git' || entry.name === 'debug' || entry.name === 'node_modules') return;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) queue.push(file);
      else if (entry.name.endsWith('.json')) assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, 'utf8')), file);
    });
  }
});

test('周次箭头不用 button，尺寸被锁定（回归：曾把周次挤成竖排单字）', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/timetable/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(root, 'pages/timetable/index.wxss'), 'utf8');
  assert.doesNotMatch(wxml, /<button[^>]*class="week-arrow"/, 'button 在 flex 里宽度会失效');
  assert.match(wxml, /<view[^>]*class="week-arrow/, '应改用 view 并显式锁宽');
  assert.match(wxss, /\.week-arrow\s*\{[^}]*flex:\s*0 0 68rpx/, '必须用 flex-basis 锁死宽度');
  assert.match(wxss, /\.week-heading\s*\{[^}]*white-space:\s*nowrap/, '标题不允许竖排折行');
});

test('所有页面的 bind 事件都能在对应 js 里找到方法', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  app.pages.forEach((page) => {
    const wxml = fs.readFileSync(path.join(root, `${page}.wxml`), 'utf8');
    const js = fs.readFileSync(path.join(root, `${page}.js`), 'utf8');
    const pattern = /\b(?:bind|catch)(?:tap|change|input|blur|focus|confirm|chooseavatar|error|submit|longpress|touchstart|touchend)="([A-Za-z_$][\w$]*)"/g;
    const names = new Set(Array.from(wxml.matchAll(pattern), (match) => match[1]));
    names.forEach((name) => {
      assert.match(js, new RegExp(`\\b${name}\\s*\\(`), `${page} 的 ${name} 没有对应方法`);
    });
  });
});

test('课表格子只放课名和教室（回归：教室被拆成「一教B-21」+「0」）', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/timetable/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(root, 'pages/timetable/index.wxss'), 'utf8');
  assert.doesNotMatch(wxml, /course-time/, '格子只有一列宽，上课时间不该再塞进来（节次列已标时间）');
  assert.match(wxss, /\.course-name\s*\{[^}]*-webkit-line-clamp:\s*2/, '课名最多两行');
  assert.match(wxss, /\.course-room\s*\{[^}]*text-overflow:\s*ellipsis/, '教室必须单行省略，不能按字折断');
  assert.doesNotMatch(wxss, /\.course-room\s*\{[^}]*word-break:\s*break-all/, '教室不允许逐字折行');
  assert.match(wxss, /\.course-block\.is-short\s+\.course-name\s*\{[^}]*-webkit-line-clamp:\s*1/, '单节格子只放一行课名');
});

test('导入确认是「替换 / 追加 / 取消」三个按钮', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/pdfimport/index.wxml'), 'utf8');
  assert.match(wxml, /class="primary-button"[^>]*bindtap="replaceAll"/);
  assert.match(wxml, /class="secondary-button"[^>]*bindtap="appendToExisting"/);
  assert.match(wxml, /class="ghost-button"[^>]*bindtap="cancelPreview"/);
});
test('课表行数按课程的结束节次撑开（回归：第 13 节的课块画到网格外被切掉）', () => {
  const js = fs.readFileSync(path.join(root, 'pages/timetable/index.js'), 'utf8');
  assert.match(js, /usedPeriods/, '要统计本周课程用到的最大节次');
  assert.match(js, /Math\.max\(periods\.length, usedPeriods/, '行数取作息节数与实际用到的较大者');
  assert.match(js, /Array\.from\(\{ length: rowCount \}/, '按撑开后的行数渲染');
});

test('切换周次有横向滑入动画', () => {
  const js = fs.readFileSync(path.join(root, 'pages/timetable/index.js'), 'utf8');
  const wxss = fs.readFileSync(path.join(root, 'pages/timetable/index.wxss'), 'utf8');
  const wxml = fs.readFileSync(path.join(root, 'pages/timetable/index.wxml'), 'utf8');
  assert.match(js, /weekAnim/, '切换时要设置动画类');
  assert.match(wxml, /week-card \{\{weekAnim\}\}/, '周次卡片要挂上动画类');
  assert.match(wxml, /timetable-card \{\{weekAnim\}\}/, '课表卡片要挂上动画类');
  assert.match(wxss, /@keyframes week-in-right/, '往后翻从右侧滑入');
  assert.match(wxss, /@keyframes week-in-left/, '往前翻从左侧滑入');
});
