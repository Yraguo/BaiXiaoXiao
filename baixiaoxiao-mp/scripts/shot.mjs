/**
 * 用 H5 构建产物给小程序页面拍图（仅用于预览/自检，不参与小程序包）
 * 用法：node scripts/shot.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = join(process.cwd(), 'dist', 'build', 'h5');
const OUT = join(process.cwd(), '..', 'docs', 'shots');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2'
};

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const buf = await readFile(file);
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(buf);
});

const PAGES = [
  ['timetable', 'pages/timetable/index', '课表'],
  ['second-class', 'pages/second-class/index', '第二课堂'],
  ['uni', 'pages/uni/index', '小鸮'],
  ['online', 'pages/online/index', '校园通'],
  ['me', 'pages/me/index', '我的']
];

const port = 4399;
await new Promise((r) => server.listen(port, '127.0.0.1', r));
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2
});

for (const [name, path] of PAGES) {
  await page.goto(`http://127.0.0.1:${port}/#/${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  // 课表页首启是引导态，先点「示例课表」再拍，否则拍不到网格
  if (name === 'timetable' && (await page.locator('.ob-link').count())) {
    await page.locator('.ob-link').click();
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: join(OUT, name + '.png') });
  console.log('shot ->', name);
}

await browser.close();
server.close();
console.log('done', OUT);
