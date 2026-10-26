/**
 * 图标生成：把 Unimate 的 AppleIcon（24×24 描边 SVG）光栅化成小程序能用的 PNG
 *
 * 【为什么要生成】
 *   wxml 不支持 <svg>，uni-app 也没有 iconfont，最稳的是 <image src="...png">。
 *   直接读原工程的 AppleIcon.vue 取路径，保证**图标和原版一模一样**，不自己画。
 *
 * 用法（cwd = baixiaoxiao-mp）：node scripts/make-icons.mjs
 * 产物：src/static/icons/<name>-<tone>.png（72×72）
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const SRC = 'E:/Gary/北京化工大学/北化app/BaiXiaoXiao/BaiXiaoXiao/src/components/AppleIcon.vue';
const OUT = join(process.cwd(), 'src', 'static', 'icons');

/** 三种色调：品牌蓝（浅色）、亮蓝（深色）、次要灰 */
const TONES = {
  blue: '#2C6FE0',
  blueDark: '#4C8DF6',
  gray: '#8A8A8E',
  white: '#FFFFFF'
};

const SIZE = 60;

/** 只生成真正用到的图标 —— 全量 31 个 × 5 色调会把主包撑掉 600KB */
const NEEDED = [
  'calendar', 'award', 'star', 'book', 'user',
  'bell', 'moon', 'droplet', 'cloudSun', 'archive', 'chevronRight',
  'compass', 'school', 'chart', 'document', 'heartPulse', 'bookmark', 'key', 'link', 'home',
  'history', 'sparkles', 'info', 'handHeart', 'broom'
];

function loadPaths() {
  const src = readFileSync(SRC, 'utf8');
  const start = src.indexOf('const paths: Record<string, string[]> = {');
  if (start < 0) throw new Error('没找到 paths 定义，AppleIcon.vue 结构变了？');
  const bodyStart = src.indexOf('{', start);
  // 从 { 开始做括号配对，拿到完整对象字面量
  let depth = 0;
  let i = bodyStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const literal = src.slice(bodyStart, i + 1);
  // eslint-disable-next-line no-eval
  return eval('(' + literal + ')');
}

function svgOf(paths, color) {
  const d = paths.map((p) => `<path d="${p}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
}

const paths = loadPaths();
const names = NEEDED.filter((n) => paths[n]);
// 先清空，避免上一轮全量生成的文件残留
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let n = 0;
for (const name of names) {
  for (const [tone, color] of Object.entries(TONES)) {
    const png = await sharp(Buffer.from(svgOf(paths[name], color))).png({ palette: true, compressionLevel: 9 }).toBuffer();
    writeFileSync(join(OUT, `${name}-${tone}.png`), png);
    n++;
  }
}

// tabBar 用的 81×81（微信推荐尺寸），同样两套色
const TAB = { 'tab-gray': '#8A8A8E', 'tab-on': '#2C6FE0' };
for (const name of ['calendar', 'award', 'star', 'book', 'user']) {
  for (const [suffix, color] of Object.entries(TAB)) {
    const png = await sharp(Buffer.from(svgOf(paths[name], color))).resize(81, 81).png({ palette: true, compressionLevel: 9 }).toBuffer();
    const fileName = name + (suffix === 'tab-on' ? '-on' : '') + '.png';
    writeFileSync(join(process.cwd(), 'src', 'static', 'tabbar', fileName), png);
    n++;
  }
}

console.log(`生成 ${n} 个图标，来自 ${names.length} 个 AppleIcon 路径`);
console.log(names.join(', '));
