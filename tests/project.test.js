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

test('导入确认是弹窗里的「替换 / 追加」两个按钮，另有取消', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/pdfimport/index.wxml'), 'utf8');
  // 预览必须是弹窗（遮罩 + 底部面板），放页面底部不往下滑根本看不见
  assert.match(wxml, /class="mask"/, '预览要是带遮罩的弹窗');
  assert.doesNotMatch(wxml, /class="mask"[^>]*bindtap="cancelPreview"/, '点遮罩不能关弹窗，避免误触丢掉预览');
  assert.match(wxml, /class="sheet preview-sheet"/, '弹窗用底部面板');
  assert.match(wxml, /class="primary-button"[^>]*bindtap="replaceAll"/);
  assert.match(wxml, /class="secondary-button"[^>]*bindtap="appendToExisting"/);
  assert.match(wxml, /class="sheet-cancel"[^>]*bindtap="cancelPreview"/, '取消放在弹窗标题栏');
});

test('云端导入页的预览同样是弹窗', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/import/index.wxml'), 'utf8');
  assert.match(wxml, /class="mask"/);
  assert.match(wxml, /class="sheet preview-sheet"/);
  assert.match(wxml, /bindtap="replaceAll"/);
  assert.match(wxml, /bindtap="appendToExisting"/);
  // 页面里不能再有内联的预览卡片，否则又会「看不见确认按钮」
  assert.doesNotMatch(wxml, /class="preview-card"/);
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
  assert.doesNotMatch(wxml, /week-card \{\{weekAnim\}\}/, '周次卡片不参与动画，切周时保持不动');
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

test('百宝箱浮球：只在可视区内拖动，且不会顺手把课表滑走', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/timetable/index.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'pages/timetable/index.js'), 'utf8');
  // 页面根节点绑了 touchstart/touchend 用来切周，浮球必须用 catch 阻止冒泡，
  // 否则拖一下浮球就会被识别成"左右滑换周"
  assert.match(wxml, /catchtouchstart="onBallTouchStart"/, '浮球要 catchtouchstart');
  assert.match(wxml, /catchtouchmove="onBallTouchMove"/, '浮球要 catchtouchmove');
  assert.match(wxml, /catchtouchend="onBallTouchEnd"/, '浮球要 catchtouchend');
  assert.match(js, /clampBall\(/, '拖动位置要夹到可视区内');
  assert.match(js, /windowWidth|windowHeight/, '要按窗口尺寸算边界');
  assert.match(js, /setStorageSync\(BALL_KEY/, '位置要记住，下次进来还在原处');
});

test('导入课表移进百宝箱，课表页不再有独立入口', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/timetable/index.wxml'), 'utf8');
  assert.doesNotMatch(wxml, /import-entry/, '表尾的导入卡片已移除');
  assert.doesNotMatch(wxml, /floating-actions/, '原来两个浮动按钮已移除');
  assert.match(wxml, /class="tool-fab/, '只保留百宝箱一个浮球');
  const toolbox = wxml.slice(wxml.indexOf('tool-grid'));
  assert.match(toolbox, /导入课表/, '百宝箱里要有导入课表');
  // 「导入课表」必须指向云端导入（data-key="jw"），PDF 单独一项，别再把主入口让给 PDF
  assert.match(toolbox, /data-key="jw"[\s\S]{0,200}?tool-name">导入课表/, '「导入课表」要指向云端导入');
  assert.match(toolbox, /data-key="pdf"[\s\S]{0,200}?tool-name">PDF 导入/, 'PDF 导入要单独成项');
  assert.match(toolbox, /课表设置/, '百宝箱里要有课表设置');
});

test('二课填报表单对齐安卓版：单张照片、基础/拓展、微信地图选点', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/secondclass/edit.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'pages/secondclass/edit.js'), 'utf8');
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  assert.match(js, /MAX_PHOTOS = 1/, '照片只要一张');
  assert.match(wxml, /takePhoto/, '要有拍照按钮');
  assert.match(wxml, /choosePhotos/, '要有相册按钮');
  // 基础 / 拓展两档的文案与上限都收到数据层了，页面只负责显示
  const sc = fs.readFileSync(path.join(root, 'utils/secondclass.js'), 'utf8');
  assert.match(sc, /基础评定/, '数据层要有基础档');
  assert.match(sc, /拓展评定/, '数据层要有拓展档');
  assert.match(js, /levelsOf/, '页面上限从数据层取，不自己算');
  // 位置只用微信地图选点：不再让用户手填经纬度
  assert.match(js, /wx\.chooseLocation/, '位置用 wx.chooseLocation 取地点名');
  assert.doesNotMatch(wxml, /data-field="latitude"/, '表单里不再出现纬度输入框');
  assert.ok(app.requiredPrivateInfos.includes('chooseLocation'), 'app.json 要声明 chooseLocation');
  // 离屏 canvas 必须在页面最外层，不能夹在板块 chips 中间
  assert.match(wxml.trim(), /<\/canvas>$/, 'canvas 放在页面末尾');
});


test('二课表单按手册条款打分，不再堆一排假分值', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/secondclass/edit.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'pages/secondclass/edit.js'), 'utf8');
  const sc = fs.readFileSync(path.join(root, 'utils/secondclass.js'), 'utf8');

  // 条款表要带建议分值，否则「选中即填分」无从谈起
  const clauses = sc.slice(sc.indexOf('const CLAUSES'), sc.indexOf('function plateOf'));
  const count = (clauses.match(/score: \d+/g) || []).length;
  assert.equal(count, 29, '29 条条款都要有建议分值');
  assert.match(clauses, /tiered: true/, '分档条款要标出来');

  assert.match(wxml, /clause-item/, '要渲染条款列表');
  assert.match(wxml, /pickClause/, '条款可选中');
  assert.match(js, /pickClause\(event\)/, '选中条款要自动填分');
  assert.match(js, /'draft\.clause': clause\.text/, '要把条款原文存进记录');
  assert.match(wxml, /clause-search/, '要能搜条款');

  // 原来的 9 个分值 chip 是认知噪声，换成 4 个常见值 + 自定义
  assert.doesNotMatch(js, /SCORE_CHIPS/, '不再有 9 个分值快捷值');
  assert.match(js, /FREE_CHIPS = \[5, 10, 20, 35\]/, '自由填报只留 4 个常见值');
  assert.match(wxml, /free-chip/, '自由填报区要存在');
  assert.match(wxml, /toggleFree/, '自由填报默认收起');
});

test('分数按手册上限封顶，换板块/换档位都会重新校验', () => {
  const js = fs.readFileSync(path.join(root, 'pages/secondclass/edit.js'), 'utf8');
  const sc = fs.readFileSync(path.join(root, 'utils/secondclass.js'), 'utf8');

  // 数据层封顶：德基础 144、德拓展 36、体基础 80
  assert.match(sc, /score: Math\.min\(/, 'normalizeRecord 要按上限封顶');
  assert.match(sc, /function capOf/, '要有 capOf');
  assert.match(sc, /function usageOf/, '要有额度计算');
  assert.match(js, /Math\.min\(Number\(this\.data\.draft\.score\) \|\| 0, cap\)/, '换板块要把分数收进新上限');
  assert.match(js, /Math\.min\(Number\(this\.data\.draft\.score\) \|\| 0, level\.cap\)/, '换档位也要收上限');
  assert.match(js, /usageOf\(/, '要显示已用/还剩');
});

test('板块色从数据层统一取，表单和列表是同一套色', () => {
  const sc = fs.readFileSync(path.join(root, 'utils/secondclass.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(root, 'pages/secondclass/edit.wxml'), 'utf8');
  const indexJs = fs.readFileSync(path.join(root, 'pages/secondclass/index.js'), 'utf8');
  assert.match(sc, /PLATE_PALETTE/, '板块色要定义在数据层');
  assert.match(sc, /ink: '#/, '每个板块要有墨色');
  assert.match(sc, /bg: '#/, '每个板块要有浅底');
  assert.match(wxml, /plate-seg/, '表单要用五段色带');
  assert.match(wxml, /item\.ink/, '色带颜色取自数据层的板块');
  // 列表页不能再自己按下标另算一套，否则两页又对不上了
  assert.doesNotMatch(indexJs, /COURSE_COLORS/, '列表页不再从课表色板取色');
  assert.match(indexJs, /color: plate\.ink/, '列表页直接用数据层的板块色');
});

test('板块色与正文对比度全部达到 WCAG AA', () => {
  const { PLATES } = require('../utils/secondclass');
  const hex = (color) => {
    let value = String(color).replace('#', '');
    if (value.length === 3) value = value.split('').map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(value.substr(i, 2), 16));
  };
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (fg, bg) => {
    const a = lum(hex(fg));
    const b = lum(hex(bg));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };

  PLATES.forEach((plate) => {
    // 三种用法都要达标：浅底上的墨色、墨色上的白字、白底上的墨色
    assert.ok(ratio(plate.ink, plate.bg) >= 4.5, `${plate.short} 墨色压浅底要 ≥4.5:1`);
    assert.ok(ratio('#ffffff', plate.ink) >= 4.5, `${plate.short} 白字压墨色要 ≥4.5:1`);
    assert.ok(ratio(plate.ink, '#ffffff') >= 4.5, `${plate.short} 墨色压白底要 ≥4.5:1`);
  });
});

test('草稿落盘 + 定位开关真的清地址 + 权限被拒给出去设置的出路', () => {
  const js = fs.readFileSync(path.join(root, 'pages/secondclass/edit.js'), 'utf8');
  assert.match(js, /DRAFT_KEY/, '要有草稿键');
  assert.match(js, /writeDraft\(\)/, '要写草稿');
  assert.match(js, /onUnload/, '离开时落盘');
  assert.match(js, /restored/, '要提示恢复了草稿');
  // 关掉定位必须把已存的地址一起清掉
  assert.match(js, /if \(!on\) \{[\s\S]*?'draft\.address': ''/, '关掉定位要清地址');
  // 权限被拒不能只 toast，得给「去设置」
  assert.match(js, /wx\.openSetting/, '权限被拒要给去设置的入口');
  assert.match(js, /已按上限计入/, '超上限保存要说清楚');
});

test('搜条款能搜到别的板块，点了会自动切过去', () => {
  const js = fs.readFileSync(path.join(root, 'pages/secondclass/edit.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(root, 'pages/secondclass/edit.wxml'), 'utf8');
  // 不搜只看当前板块，一搜就搜全部
  assert.match(js, /query\s*\n\s*\? CLAUSES\.filter/, '搜索要跨全部板块');
  assert.match(js, /other: clause\.plate !== current/, '要标出属于别的板块的');
  assert.match(js, /clauseOther/, '要统计别的板块命中数');
  // 点到别的板块的条款 → 自动切板块
  assert.match(js, /plateKey && plateKey !== this\.data\.plate\.key/, '要能识别跨板块点击');
  assert.match(js, /已切到/, '切换板块要给反馈');
  assert.match(wxml, /data-plate="\{\{item\.plateKey\}\}"/, '要带上板块 key');
  assert.match(wxml, /clause-other/, '别的板块要标出来');
});
