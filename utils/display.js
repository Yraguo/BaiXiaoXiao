/**
 * 显示偏好：字号 + 深色模式。
 *
 * 两个偏好都落在同一个 key 里，因为它们都是「把 CSS 变量写到页面根节点」：
 *
 * - 字号：--fs。全站的 font-size 都写成 calc(Nrpx * var(--fs, 1))，
 *   默认 1 时与改动前完全一致。
 * - 深色：一整套 --surface-* / --ink-* 换值。浅色值写在 app.wxss 的
 *   page 选择器里（就是改版前的原始硬编码颜色），深色值只在这里出现，
 *   由 styleOf() 拼成内联样式挂到根节点，优先级高于 wxss，一处生效。
 *
 * 【为什么不用 @media (prefers-color-scheme)】
 * 那个跟系统走，用户在 App 里拨不动。这里改成显式开关：手动选的值
 * 一定要赢过系统设置，所以深色不能写在媒体查询里。
 *
 * 【为什么要 applyNative】页面根节点的 CSS 变量管不到导航栏和下拉背景，
 * 那两个是原生绘制的，只能调 wx.setNavigationBarColor / setBackgroundColor。
 * 两个主题各设一次，切回来时才能恢复（否则深色切浅色导航栏仍是黑的）。
 */

const KEY = 'baixiaoxiao.display.v1';

const LEVELS = [
  { key: 'normal', name: '标准', desc: '默认大小', scale: 1 },
  { key: 'large', name: '大', desc: '整体放大一档', scale: 1.08 },
  { key: 'xlarge', name: '特大', desc: '看得更清楚', scale: 1.16 }
];

const THEMES = [
  { key: 'auto', name: '跟随手机', desc: '手机开深色，小程序也跟着深' },
  { key: 'light', name: '浅色', desc: '一直用白底，不管系统怎么设' },
  { key: 'dark', name: '深色', desc: '一直用深底，夜里看着不刺眼' }
];

/**
 * 深色变量表。
 * surface 的映射方向是「原来越白 → 暗色里越亮」：卡片（#fff）落到
 * #26262b，页底（#f2f2f7）落到 #1a1a1d，最深的灰阶落到 #0d0d0f，
 * 这样暗色下的层次和浅色一一对应，不会出现「页底比卡片还亮」。
 * ink 则反过来：原来越深（正文 #354052）→ 暗色里越白（#f2f2f7）。
 */
const DARK = {
  '--brand': '#4b9dff',
  '--brand-light': 'rgba(0, 122, 255, .16)',
  '--background': '#0d0d0f',
  '--card': '#1d1d21',
  '--text': '#f2f2f7',
  '--muted': '#9a9aa0',
  '--line': 'rgba(255, 255, 255, .12)',
  '--danger': '#ff6b60',
  '--surface-1': '#26262b',
  '--surface-2': '#212125',
  '--surface-3': '#212126',
  '--surface-4': '#202024',
  '--surface-5': '#202024',
  '--surface-6': '#202024',
  '--surface-7': '#1f1f23',
  '--surface-8': '#1d1d21',
  '--surface-9': '#1d1d21',
  '--surface-10': '#1e1e22',
  '--surface-11': '#1e1e22',
  '--surface-12': '#1e1e22',
  '--surface-13': '#1a1a1e',
  '--surface-14': '#1d1d21',
  '--surface-15': '#1b1b1e',
  '--surface-16': '#1b1b1f',
  '--surface-17': '#1a1a1d',
  '--surface-18': '#19191c',
  '--surface-19': '#1a1a1e',
  '--surface-20': '#1f1f24',
  '--surface-21': '#19191c',
  '--surface-22': '#19191c',
  '--surface-23': '#18181b',
  '--surface-24': '#18181b',
  '--surface-25': '#161619',
  '--surface-26': '#121215',
  '--surface-27': '#131315',
  '--surface-28': '#131315',
  '--surface-29': '#0d0d0f',
  '--surface-30': '#0d0d0f',
  '--ink-1': '#8a8a90',
  '--ink-2': '#939399',
  '--ink-3': '#99999e',
  '--ink-4': '#9b9ba1',
  '--ink-5': '#aaaaaf',
  '--ink-6': '#b5b5ba',
  '--ink-7': '#c3c3c8',
  '--ink-8': '#c6c6cb',
  '--ink-9': '#d8d8dd',
  '--ink-10': '#d9d9de',
  '--ink-11': '#e1e1e6',
  '--ink-12': '#dfdfe5',
  '--ink-13': '#e8e8ed',
  '--ink-14': '#edeef2',
  '--ink-15': '#eff0f4',
  '--ink-16': '#f1f1f6',
  '--ink-17': '#f2f2f7',
  '--tone-info': '#a2b7d7',
  '--tone-danger': '#e59289',
  '--tone-danger-soft': '#d2a7a1',
  '--tone-danger-faint': '#cca39e',
  '--tone-danger-deep': '#da9b95',
  '--tone-warn': '#e3cb95',
  '--tone-warn-soft': '#ddc59a',
  '--tone-amber': '#ebc489',
  '--tone-amber-deep': '#ecc48b',
  '--tone-amber-soft': '#edcd92',
  '--tone-success': '#a5d7c0',
  '--tone-green': '#8ee9bf',
  '--tone-blue': '#8fafe3',
  '--tone-blue-bright': '#82b1eb'
};

/** 原生部分（导航栏、下拉背景）的两套配色 */
const NATIVE = {
  light: { nav: '#f2f2f7', navText: 'black', background: '#f2f2f7' },
  dark: { nav: '#0d0d0f', navText: 'white', background: '#0d0d0f' }
};

const DARK_STYLE = Object.keys(DARK).map((key) => `${key}: ${DARK[key]}`).join(';');

function load() {
  const fallback = { font: 'normal', theme: 'auto' };
  try {
    const saved = wx.getStorageSync(KEY);
    if (saved && typeof saved === 'object') {
      const level = LEVELS.find((item) => item.key === saved.font);
      const theme = THEMES.find((item) => item.key === saved.theme);
      return {
        font: level ? level.key : fallback.font,
        theme: theme ? theme.key : fallback.theme
      };
    }
  } catch (error) {
    // 读不到就用默认
  }
  return fallback;
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

function themeOf(key) {
  return THEMES.find((item) => item.key === key) || THEMES[0];
}

/** 手机当前是不是深色。基础库 2.20+ 用 getAppBaseInfo，老的退回 getSystemInfoSync */
function systemTheme() {
  try {
    const info = wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync();
    return info && info.theme === 'dark' ? 'dark' : 'light';
  } catch (error) {
    return 'light';
  }
}

/**
 * 偏好转成实际生效的 light / dark。
 * 「跟随手机」在这里读系统，其余两档直接就是答案。
 */
function resolveTheme(pref) {
  const key = themeOf((pref || load()).theme).key;
  return key === 'auto' ? systemTheme() : key;
}

function normalize(pref) {
  const source = pref || load();
  return {
    font: levelOf(source.font).key,
    theme: themeOf(source.theme).key
  };
}

/**
 * 给根节点 style 用的字符串：字号 +（深色时的）全套变量。
 * 两个偏好都改的时候只需要调一次，避免 setData 两次。
 */
function styleOf(pref) {
  const source = pref || load();
  const effective = resolveTheme(source);
  const native = NATIVE[effective];
  // background 一起写：page-meta 的 page-style 只能碰到 page 元素本身，
  // 光给变量不动背景，滚动到边界时露出的还是浅色。
  const fs = `--fs: ${levelOf(source.font).scale};background: ${native.background}`;
  return effective === 'dark' ? `${fs};${DARK_STYLE}` : fs;
}

/** 兼容旧调用：只传字号 key 也认 */
function pageStyle(pref) {
  if (typeof pref === 'string') return styleOf({ font: pref, theme: load().theme });
  return styleOf(pref);
}

/**
 * 把主题同步到原生绘制的部分（导航栏、窗口背景），返回该用的 style。
 * 每个页面的 onLoad / onShow 都该调一次：从「我的」改完主题返回别的页面，
 * 那些页面的导航栏也得跟着变。
 */
function applyTheme(pref) {
  const source = pref || load();
  const effective = resolveTheme(source);
  const native = NATIVE[effective];
  try {
    if (wx.setNavigationBarColor) {
      wx.setNavigationBarColor({
        frontColor: native.navText === 'white' ? '#ffffff' : '#000000',
        backgroundColor: native.nav,
        fail: () => {}
      });
    }
    if (wx.setBackgroundColor) {
      wx.setBackgroundColor({
        backgroundColor: native.background,
        backgroundColorTop: native.background,
        backgroundColorBottom: native.background,
        fail: () => {}
      });
    }
  } catch (error) {
    // 某些基础库没有这两个 API，忽略
  }
  return styleOf(source);
}

module.exports = {
  DARK,
  KEY,
  LEVELS,
  NATIVE,
  THEMES,
  applyTheme,
  levelOf,
  load,
  normalize,
  pageStyle,
  resolveTheme,
  systemTheme,
  save,
  styleOf,
  themeOf
};
