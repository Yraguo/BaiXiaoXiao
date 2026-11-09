const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('分享云函数：三个动作齐全，并声明了小程序码权限', () => {
  const code = read('cloudfunctions/share/index.js');
  assert.match(code, /action === 'save'/, '要有 save');
  assert.match(code, /action === 'get'/, '要有 get');
  assert.match(code, /action === 'qrcode'/, '要有 qrcode');
  assert.match(code, /wxacode\.getUnlimited/, '用 wxacode.getUnlimited 出码');
  assert.match(code, /scene: id/, 'scene 传分享码');

  const config = JSON.parse(read('cloudfunctions/share/config.json'));
  assert.ok(config.permissions.openapi.includes('wxacode.getUnlimited'), 'config.json 要开权限');
});

test('分享只带课表字段，不泄漏账号信息', () => {
  const code = read('cloudfunctions/share/index.js');
  // cleanCourse 只挑这几个字段，password/username 之类的即便传进来也会被丢掉
  ['name', 'day', 'startPeriod', 'endPeriod', 'weeks', 'room', 'teacher', 'campus']
    .forEach((field) => assert.match(code, new RegExp(`\\b${field}\\b`), `要保留 ${field}`));
  assert.doesNotMatch(code, /password/i, '云函数不该出现密码字段');
});

test('课表页能从 scene / share 参数打开分享，并且是只读的', () => {
  const js = read('pages/timetable/index.js');
  const wxml = read('pages/timetable/index.wxml');
  assert.match(js, /pickShareId\(options\)/, '要解析入口参数');
  assert.match(js, /options\.scene/, '小程序码走 scene');
  assert.match(js, /options\.share/, '普通转发走 share');
  assert.match(js, /async loadShared/, '要能拉取分享');
  assert.match(js, /saveShared\(\)/, '要能把分享的课表存下来');
  assert.match(wxml, /这是分享的课表/, '要有只读提示条');
  assert.match(wxml, /ballReady && !shared/, '分享模式下不显示百宝箱浮球');
});

test('分享图是节次 × 星期的网格，带二维码时更高', () => {
  const { layoutWeek, drawWeek } = require('../utils/shareCard');
  const days = [{ label: '周一', date: '11/9', blocks: [{ name: 'A', startPeriod: 1, endPeriod: 2, color: '#1f6fd0' }] }];
  const periods = [{ period: 1, start: '08:00', end: '08:45' }, { period: 2, start: '08:55', end: '09:40' }];

  const plain = layoutWeek(days, periods, { week: 1, range: '', term: '' });
  const withQr = layoutWeek(days, periods, { week: 1, range: '', term: '' }, { withQr: true });

  assert.equal(plain.rowCount, 2, '两节作息就该两行');
  assert.ok(plain.cellW > 0, '列宽要算出来');
  assert.ok(plain.gridBottom > plain.tableY, '网格要有高度');
  assert.ok(withQr.height > plain.height, '带码要给二维码留位置');
  assert.ok(withQr.qr && withQr.qr.size > 0, '要有 qr 盒子');
  assert.equal(plain.qr, null);

  // 用一个最小的假 ctx，确认走到二维码分支不会崩
  const calls = [];
  const ctx = {
    fillStyle: '', strokeStyle: '', font: '', textAlign: '', lineWidth: 1,
    fillRect() {}, createLinearGradient: () => ({ addColorStop() {} }),
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {},
    fill() {}, stroke() {}, save() {}, restore() {}, clip() {},
    measureText: (t) => ({ width: String(t).length * 10 }),
    fillText: (t) => calls.push(t), drawImage() { calls.push('qr'); }
  };
  withQr.qr.image = { width: 200, height: 200 };
  drawWeek(ctx, withQr);
  assert.ok(calls.includes('qr'), '传了二维码图片就要画出来');
  assert.ok(calls.some((text) => String(text).indexOf('扫码') >= 0), '要有扫码提示');
  assert.ok(calls.some((text) => String(text).indexOf('周一') >= 0), '表头要有星期');
});


test('转发小程序卡片也带分享码，打开的就是我的课表', () => {
  const js = read('pages/timetable/index.js');
  assert.match(js, /prepareShareId\(\)/, '打开百宝箱时预先生成分享码');
  assert.match(js, /\?share=\$\{id\}/, 'onShareAppMessage 的 path 带 share 参数');
  assert.match(js, /baixiaoxiao\.share\.cache\.v1/, '分享码要有缓存，别每次开面板都写云端');
});
