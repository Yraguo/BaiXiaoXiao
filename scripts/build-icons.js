/**
 * 图标生成器：把下面的线性图标（24×24 viewBox）渲染成小程序能直接用的 PNG。
 *
 * 用法：node scripts/build-icons.js
 * 产物：assets/icons/*.png（校园服务，192px）、assets/tabbar/*.png（81px，常态灰/选中蓝）
 *
 * 【为什么不用 SVG 文件】iOS 与部分安卓机型对 <image> 加载 svg 的表现不一致，
 * 用系统自带 sips 预渲染成 PNG 最稳，也免了运行时开销。
 * sips 只在 macOS 上可用；换机器时用 rsvg-convert 或 ImageMagick 替代即可。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BRAND = '#007AFF';
const MUTED = '#8E8E93';

/** 校园服务图标，key 与 data/defaults 里的服务 key 对应 */
const SERVICE_ICONS = {
  // 北化在线：摊开的书
  online: '<path d="M12 7.2C10.3 5.8 8.3 5.1 5.5 5v12.6c2.8.1 4.8.8 6.5 2.2 1.7-1.4 3.7-2.1 6.5-2.2V5c-2.8.1-4.8.8-6.5 2.2Z"/><path d="M12 7.2v12.6"/>',
  // 教务系统：学士帽
  jw: '<path d="M2.8 9.4 12 5l9.2 4.4L12 13.8 2.8 9.4Z"/><path d="M6.6 11.4v3.4c0 1.4 2.4 2.6 5.4 2.6s5.4-1.2 5.4-2.6v-3.4"/><path d="M21.2 9.4v4.2"/>',
  // 考试查询：带勾的答题板
  exam: '<path d="M9 4.4h6v2.6H9z"/><path d="M9 5.7H7.2A1.4 1.4 0 0 0 5.8 7.1v11.5a1.4 1.4 0 0 0 1.4 1.4h9.6a1.4 1.4 0 0 0 1.4-1.4V7.1a1.4 1.4 0 0 0-1.4-1.4H15"/><path d="m8.8 12.6 2.2 2.2 4.4-4.4"/>',
  // 健康云：心形
  health: '<path d="M12 19.6c-1.6-1.3-6.6-5-6.6-8.9A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 6.6 2.7c0 3.9-5 7.6-6.6 8.9Z"/>',
  // 图书馆：两本立着的书 + 一本斜放的书
  library: '<rect x="4.2" y="5" width="3.6" height="14" rx="0.9"/><rect x="9" y="5" width="3.6" height="14" rx="0.9"/><path d="m14.4 6 3.8.9-3 12.6-3.8-.9z"/>',
  // 电子资源：钥匙
  resource: '<circle cx="12" cy="7.6" r="3.2"/><path d="M12 10.8v9.4"/><path d="M12 14.6h3M12 17.4h2.4"/>',
  // 信息门户：四宫格
  portal: '<rect x="4.4" y="4.4" width="6.2" height="6.2" rx="1.6"/><rect x="13.4" y="4.4" width="6.2" height="6.2" rx="1.6"/><rect x="4.4" y="13.4" width="6.2" height="6.2" rx="1.6"/><rect x="13.4" y="13.4" width="6.2" height="6.2" rx="1.6"/>',
  // 学校主页：带柱廊的教学楼
  school: '<path d="M3.6 20.2h16.8"/><path d="M5.6 20.2V10.4M9.4 20.2V10.4M14.6 20.2V10.4M18.4 20.2V10.4"/><path d="M2.8 10.2 12 4.6l9.2 5.6z"/>',
  // 校园网平台：Wi-Fi
  network: '<path d="M3.4 9.2a12.4 12.4 0 0 1 17.2 0"/><path d="M6.6 12.6a8 8 0 0 1 10.8 0"/><path d="M9.6 15.9a4 4 0 0 1 4.8 0"/><circle cx="12" cy="19" r="1.1" fill="currentColor" stroke="none"/>'
};

/** tabBar 图标，每个出灰/蓝两套 */
const TAB_ICONS = {
  // 课表：日历
  timetable: '<rect x="3.6" y="5.4" width="16.8" height="15" rx="2.6"/><path d="M8 3.2v4.4M16 3.2v4.4M3.6 10.2h16.8"/><path d="M7.6 14.4h2.2M13.6 14.4h2.8"/>',
  // 记事：清单
  notes: '<path d="m4.8 7.2 2.2 2.2 3.6-3.6"/><path d="M13.8 7.6h5.4"/><path d="m4.8 14.6 2.2 2.2 3.6-3.6"/><path d="M13.8 15h5.4"/><path d="M4.8 20.4h14.4"/>',
  // 小鸮：对话气泡
  uni: '<path d="M4.2 8.4A3.4 3.4 0 0 1 7.6 5h8.8a3.4 3.4 0 0 1 3.4 3.4v5.2a3.4 3.4 0 0 1-3.4 3.4h-5.2L6.6 20.6v-3.6H7.6a3.4 3.4 0 0 1-3.4-3.4z"/><circle cx="9.4" cy="10.8" r="1"/><circle cx="14.6" cy="10.8" r="1"/>',
  // 校园：教学楼
  campus: '<path d="M3.6 20.4h16.8"/><path d="M5.8 20.4v-8.6M9.6 20.4v-8.6M14.4 20.4v-8.6M18.2 20.4v-8.6"/><path d="M2.8 11.2 12 5.6l9.2 5.6z"/>',
  // 我的：人像
  me: '<circle cx="12" cy="8.6" r="3.6"/><path d="M4.8 20.2c.5-3.7 3.5-5.8 7.2-5.8s6.7 2.1 7.2 5.8"/>',
  // 第二课堂：奖章 + 绶带
  secondclass: '<circle cx="12" cy="9.2" r="5"/><path d="M8.8 13.2 7.2 20.8l4.8-2.5 4.8 2.5-1.6-7.6"/>'
};

/** 界面内使用的单色图标：白描边，直接放在彩色底上 */
const UI_ICONS = {
  // 百宝箱：带提手的工具箱
  toolbox: '<rect x="3.2" y="8.4" width="17.6" height="11.4" rx="2.4"/><path d="M8.6 8.4V6.6A1.8 1.8 0 0 1 10.4 4.8h3.2a1.8 1.8 0 0 1 1.8 1.8v1.8"/><path d="M3.2 13.6h17.6"/><path d="M10.4 13.6v2h3.2v-2"/>'
};

function svgDocument(body, color, size, stroke) {
  const safe = body.replace(/currentColor/g, color);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"`
    + ` fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">`
    + `${safe}</svg>`;
}

function render(body, color, size, stroke, outputDir, fileName) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bxx-icon-'));
  const svgPath = path.join(tempDir, 'icon.svg');
  fs.writeFileSync(svgPath, svgDocument(body, color, size, stroke));
  fs.mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, fileName);
  execFileSync('sips', ['-s', 'format', 'png', svgPath, '--out', output], { stdio: 'ignore' });
  fs.rmSync(tempDir, { recursive: true, force: true });
  return output;
}

function main() {
  const iconDir = path.join(ROOT, 'assets', 'icons');
  const tabDir = path.join(ROOT, 'assets', 'tabbar');
  const made = [];

  Object.keys(SERVICE_ICONS).forEach((key) => {
    made.push(render(SERVICE_ICONS[key], BRAND, 192, 1.8, iconDir, `${key}.png`));
  });

  const uiDir = path.join(ROOT, 'assets', 'icons');
  Object.keys(UI_ICONS).forEach((key) => {
    made.push(render(UI_ICONS[key], '#FFFFFF', 144, 1.7, uiDir, `${key}.png`));
  });

  Object.keys(TAB_ICONS).forEach((key) => {
    made.push(render(TAB_ICONS[key], MUTED, 81, 1.1, tabDir, `${key}.png`));
    made.push(render(TAB_ICONS[key], BRAND, 81, 1.1, tabDir, `${key}-active.png`));
  });

  made.forEach((file) => {
    const size = fs.statSync(file).size;
    if (size < 300) throw new Error(`${file} 生成失败（${size} 字节）`);
    console.log(`${path.relative(ROOT, file)}  ${(size / 1024).toFixed(1)} KB`);
  });
}

main();
