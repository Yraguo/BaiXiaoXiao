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

test('课表格子把课名、教室、老师写全，不再截断', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/timetable/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(root, 'pages/timetable/index.wxss'), 'utf8');
  assert.doesNotMatch(wxss, /-webkit-line-clamp/, '课名不再按行数截断');
  assert.doesNotMatch(wxss, /\.course-meta\s*\{[^}]*text-overflow:\s*ellipsis/, '教室/老师也不省略');
  assert.match(wxml, /course\.campus \? course\.campus \+ ' ' : ''/, '校区与教室拼成一行显示');
  assert.match(wxml, /course-teacher/, '教师必须显示');
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

test('切周次走两段式过渡（对齐 UniMate：只判起止，不跟手）', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/timetable/index.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'pages/timetable/index.js'), 'utf8');
  const wxss = fs.readFileSync(path.join(root, 'pages/timetable/index.wxss'), 'utf8');
  assert.doesNotMatch(wxml, /bindtouchmove/, '不再监听 touchmove，内容不跟手');
  assert.match(wxml, /bindtouchend="finishTouch"/, '只靠起止判断方向');
  assert.match(js, /wk-leave-left/, '旧内容先滑出');
  assert.match(wxss, /@keyframes wk-enter-right/, '新内容从反方向进入');
  assert.doesNotMatch(js, /dragX/, '拖动位移已移除');
});

test('吉祥物图片是抠过图的（不是画上去的灰白格子）', () => {
  const dir = path.join(root, 'assets/owl');
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.png'));
  assert.ok(files.length >= 6, '至少要有 6 张');
  const total = files.reduce((sum, name) => sum + fs.statSync(path.join(dir, name)).size, 0);
  // 带格子背景时这批图约 580KB，抠图后 240KB 上下
  assert.ok(total < 320 * 1024, `抠图后总大小应明显下降，当前 ${(total / 1024).toFixed(0)} KB`);
  assert.equal(fs.existsSync(path.join(root, 'scripts/matte-owl.js')), true, '抠图脚本要留在仓库里');
});

test('时长页签不依赖 wx:else，表单保存按钮可点（回归：志愿/劳育无法记录）', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/secondclass/index.wxml'), 'utf8');
  // wx:else 必须紧跟上一个兄弟节点，中间隔一行注释就可能失效，
  // 表现是切到这两个页签后整块内容不渲染
  assert.match(wxml, /wx:if="\{\{tab !== 'score'\}\}"/, '时长页签要用显式 wx:if');
  // scroll-view 在 flex 列里没有显式高度会塌成 0，表单就点不到
  assert.match(wxml, /<view class="hour-body">/, '表单内容用普通 view 承载滚动');
  assert.match(wxml, /class="hour-save" bindtap="saveHour"/, '保存绑在普通 view 上，避开 button 的默认行为');
  assert.match(wxml, /class="sc-add-hour" data-kind="\{\{tab\}\}" bindtap="openHour"/, '记一条按钮也要是 view');
});
