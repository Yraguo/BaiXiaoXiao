/**
 * 显示偏好：字号。
 *
 * 实现方式是给页面根节点挂一个 CSS 变量 --fs，全站的 font-size 都写成
 * calc(Nrpx * var(--fs, 1))。默认 1 时与改动前完全一致，所以没设置过的
 * 用户看到的还是原来的样子。
 *
 * 深色模式不在这里：它跟随系统，由 app.json 的 darkmode + app.wxss 里的
 * @media (prefers-color-scheme: dark) 处理，没有「手动开关」。
 */

const KEY = 'baixiaoxiao.display.v1';

const LEVELS = [
  { key: 'normal', name: '标准', desc: '默认大小', scale: 1 },
  { key: 'large', name: '大', desc: '整体放大一档', scale: 1.08 },
  { key: 'xlarge', name: '特大', desc: '看得更清楚', scale: 1.16 }
];

function load() {
  try {
    const saved = wx.getStorageSync(KEY);
    if (saved && typeof saved === 'object' && saved.font) {
      const level = LEVELS.find((item) => item.key === saved.font);
      if (level) return { font: level.key };
    }
  } catch (error) {
    // 读不到就用默认
  }
  return { font: 'normal' };
}

function save(patch) {
  const next = Object.assign(load(), patch || {});
  try {
    wx.setStorageSync(KEY, next);
  } catch (error) {
    // 存不下也不影响当前会话
  }
  return next;
}

function levelOf(key) {
  return LEVELS.find((item) => item.key === key) || LEVELS[0];
}

/** 给 <page-meta page-style="..."> 用的字符串 */
function pageStyle(key) {
  const level = levelOf(key || load().font);
  return `--fs: ${level.scale}`;
}

module.exports = { KEY, LEVELS, levelOf, load, pageStyle, save };
