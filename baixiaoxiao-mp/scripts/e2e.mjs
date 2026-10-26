/**
 * 交互冒烟 + 截图（H5 产物，不进小程序包）
 *
 * 覆盖：首启无课表 → 添加课表（自动在上）→ 选校 → 登录页 → 示例课表
 *       → 记事本 / 第二课堂 / Uni / 校园通 / 我的 → 深色模式
 *
 * 用法（cwd = baixiaoxiao-mp）：node scripts/e2e.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = join(process.cwd(), 'dist', 'build', 'h5');
const OUT = join(process.cwd(), '..', 'docs', 'shots');
const LOG = [];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.json': 'application/json'
};

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = normalize(join(ROOT, p));
  if (!f.startsWith(ROOT) || !existsSync(f)) {
    res.writeHead(404);
    res.end('nf');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(await readFile(f));
});

const port = 4417;
await new Promise((r) => server.listen(port, '127.0.0.1', r));
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push('console: ' + m.text());
});

const log = (n, ok, extra = '') => {
  LOG.push({ n, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  — ' + extra : ''}`);
};
const shot = async (n) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, n + '.png') });
};

await page.goto(`http://127.0.0.1:${port}/#/pages/main/index`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1300);

/* 0. 存储键（深色切换要用） */
const keys = await page.evaluate(() => Object.keys(localStorage));
log('本机存储可用', keys.length > 0, keys.slice(0, 2).join(' | '));

/* 1. 首启引导 */
log('首启显示「还没有课表」', /还没有课表/.test((await page.locator('.ob-title').textContent()) || ''));
await shot('onboard');

/* 2. 添加课表：自动在上 */
await page.locator('.onboard .btn').click();
await page.waitForTimeout(600);
const opts = await page.locator('.opt').allTextContents();
log('自动导入排在手动之前', /从教务系统导入/.test(opts[0] || '') && /手动创建/.test(opts[1] || ''));
await shot('add-timetable');

/* 3. 选校 → 登录 → 返回 */
await page.locator('.opt.primary').click();
await page.waitForTimeout(900);
log('进入选校页', /选择学校/.test((await page.locator('.nav-title').textContent()) || ''));
await shot('import-schools');
await page.locator('.li', { hasText: '北京化工大学' }).first().click();
await page.waitForTimeout(800);
log(
  '教务地址已预填',
  (await page.locator('.g-ipt input').first().inputValue()) === 'https://jwglxt.buct.edu.cn'
);
await shot('import-login');
await page.locator('.nav-back').click();
await page.waitForTimeout(500);
await page.locator('.nav-back').click();
await page.waitForTimeout(900);

/* 4. 示例课表 */
await page.locator('.ob-link').click();
await page.waitForTimeout(1100);
const blocks = await page.locator('.cblock').count();
log('课表渲染课程块', blocks > 0, blocks + ' 块');
log('表头有 7 个日期', (await page.locator('.th-day').count()) === 7);
await shot('timetable');

/* 4.5 周次：按钮翻页 + 回本周 */
const w0 = ((await page.locator('.wbold').textContent()) || '').trim();
await page.locator('.wnav').last().click();
await page.waitForTimeout(500);
const w1 = ((await page.locator('.wbold').textContent()) || '').trim();
log('点 › 切到下一周', w0 !== w1, w0 + ' → ' + w1);
log('出现「回本周」', (await page.locator('.wtoday').count()) === 1);
log('周次栏显示日期区间', /月.*日.*–.*月.*日/.test((await page.locator('.wrange').textContent()) || ''), await page.locator('.wrange').textContent());
log('有滑动切换提示', /左右滑动/.test((await page.locator('.swipe-hint').textContent()) || ''));
await shot('week-switch');
await page.locator('.wtoday').click();
await page.waitForTimeout(400);
log('点「回本周」回到本周', ((await page.locator('.wbold').textContent()) || '').includes(('第 ' + (w0.match(/\d+/) || ['0'])[0] + ' 周')), w0);

/* 4.6 真手势：在表格上左右滑 → 切周 */
const weekText = async () => ((await page.locator('.wbold').textContent()) || '').trim();
const swipeTo = (fromX, toX) =>
  page.evaluate(
    ([a, b]) => {
      const el = document.querySelector('.tt-scroll');
      const mk = (type, x) => {
        const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: 420 });
        el.dispatchEvent(
          new TouchEvent(type, {
            touches: type === 'touchend' ? [] : [t],
            changedTouches: [t],
            bubbles: true,
            cancelable: true
          })
        );
      };
      mk('touchstart', a);
      setTimeout(() => mk('touchend', b), 30);
    },
    [fromX, toX]
  );

const beforeSwipe = await weekText();
await swipeTo(330, 110);
await page.waitForTimeout(700);
const afterLeft = await weekText();
log('向左滑动切到下一周', afterLeft !== beforeSwipe, beforeSwipe + ' → ' + afterLeft);

await swipeTo(110, 340);
await page.waitForTimeout(700);
const afterRight = await weekText();
log('向右滑动切回上一周', afterRight === beforeSwipe, afterLeft + ' → ' + afterRight);

/* 5. 记事本 */
await page.locator('.seg-item', { hasText: '记事本' }).click();
await page.waitForTimeout(900);
log('月历渲染 42 格', (await page.locator('.cell').count()) === 42);
log('今天被高亮', (await page.locator('.cnum.today').count()) === 1);
const dots = await page.locator('.cdot').count();
log('有记事的日期有圆点', dots > 0, dots + ' 个');
await shot('notes');

/* 6. 第二课堂 */
await page.locator('.tab', { hasText: '第二课堂' }).click();
await page.waitForTimeout(800);
const sNum = ((await page.locator('.s-num').textContent()) || '').trim();
log('二课自评总分 95', sNum === '95', sNum);
log('五板块进度条', (await page.locator('.brow').count()) === 5);
await shot('second-class');

/* 7. Uni */
await page.locator('.tab', { hasText: '小鸮' }).click();
await page.waitForTimeout(700);
const quickCount = await page.locator('.qrow').count();
log('小鸮落地页快捷问法 5 条', quickCount === 5, quickCount + ' 条');
log('落地页有「换个说法」提示', (await page.locator('.tips').count()) === 1);
await shot('xiao');

// 点快捷问法
await page.locator('.qrow', { hasText: '下一节什么课' }).click();
await page.waitForTimeout(900);
const bot1 = ((await page.locator('.bubble.bot').first().textContent()) || '').trim();
log('小鸮能按课表回答', bot1.length > 8, bot1.slice(0, 30).replace(/\n/g, ' '));

// 手打一个问题：课程地点
async function askText(q) {
  await page.locator('.composer input').fill(q);
  await page.locator('.send').click();
  await page.waitForTimeout(800);
  return ((await page.locator('.bubble.bot').last().textContent()) || '').trim();
}

const bot2 = await askText('高数在哪上');
log('小鸮能答某门课在哪上', /主教 301/.test(bot2), bot2.slice(0, 40).replace(/\n/g, ' '));

const bot3 = await askText('还差多少二课分');
log('小鸮能答二课分', /600|还差/.test(bot3), bot3.slice(0, 40).replace(/\n/g, ' '));

const bot4 = await askText('哪个板块最缺');
log('小鸮能答二课短板', /缺口|差/.test(bot4), bot4.slice(0, 40).replace(/\n/g, ' '));

const bot5 = await askText('web3 是什么');
log('不会的问题如实说没学会', /还没学会/.test(bot5), bot5.slice(0, 24).replace(/\n/g, ' '));

await shot('xiao-chat');

/* 8. 校园通 */
await page.locator('.tab', { hasText: '校园通' }).click();
await page.waitForTimeout(700);
log('校园通 10 个服务入口（号角已去掉）', (await page.locator('.tile').count()) === 10, (await page.locator('.tile').count()) + ' 个');
log('教务系统入口在列', (await page.locator('.tile', { hasText: '教务系统' }).count()) === 1);
await shot('online');

/* 9. 我的 */
await page.locator('.tab', { hasText: '我的' }).click();
await page.waitForTimeout(700);
log('我的页有外观与主题', (await page.locator('.li', { hasText: '外观与主题' }).count()) === 1);
log('自评摘要 95 / 600', /95 \/ 600/.test((await page.locator('.sum-v').textContent()) || ''));
await shot('me');

/* 10. 深色模式：写存储键（等价于在「外观与主题」里选深色）再刷新 */
const modeKey = keys.find((k) => k.includes('themeMode')) || 'unimate:settings/themeMode';
await page.evaluate((k) => localStorage.setItem(k, 'dark'), modeKey);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
const darkOn = await page.evaluate(() => !!document.querySelector('.screen.theme-dark'));
log('深色模式生效', darkOn, modeKey);
await shot('dark-timetable');

await page.locator('.tab', { hasText: '第二课堂' }).click();
await page.waitForTimeout(700);
await shot('dark-second-class');
await page.locator('.tab', { hasText: '我的' }).click();
await page.waitForTimeout(700);
await shot('dark-me');
await page.locator('.tab', { hasText: '课表' }).click();
await page.waitForTimeout(500);
await page.locator('.seg-item', { hasText: '记事本' }).click();
await page.waitForTimeout(800);
await shot('dark-notes');

await writeFile(join(OUT, 'e2e-report.json'), JSON.stringify({ log: LOG, errors }, null, 2), 'utf8');
console.log('\n--- 运行时错误 ---');
console.log(errors.length ? errors.slice(0, 6).join('\n') : '（无）');
const failed = LOG.filter((x) => !x.ok).length;
console.log(`\n合计 ${LOG.length} 项，失败 ${failed} 项`);

await browser.close();
server.close();
process.exit(failed ? 1 : 0);
