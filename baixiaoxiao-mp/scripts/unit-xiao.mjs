/**
 * 小鸮本地对话引擎的单测
 *
 * 【为什么要 mock】engine → store → adapters/storage，而 storage 用的是 uni.* API，
 * Node 里没有。所以 esbuild 打包时在文件头注入一个假的 uni 对象，
 * Storage 用内存 Map 实现，这样整条链路能在 Node 里跑通。
 *
 * 断言口径：
 *   1. 「应该答得上」的问法，intent 不能是 fallback；
 *   2. 「应该答不上」的乱输入，必须是 fallback（不能瞎编）；
 *   3. 关键字面检查，防止规则串了意图（比如问图书馆却答成课表）。
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.tmp');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const MOCK = `
const __store = new Map();
globalThis.uni = {
  getStorageSync: (k) => (__store.has(k) ? __store.get(k) : ''),
  setStorageSync: (k, v) => { __store.set(k, v); },
  removeStorageSync: (k) => { __store.delete(k); },
  clearStorageSync: () => { __store.clear(); },
  getStorageInfoSync: () => ({ currentSize: 0, limitSize: 10240 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20, theme: 'light', platform: 'devtools' }),
  showToast: () => {},
  showModal: () => {},
  onThemeChange: () => {},
  setBackgroundColor: () => {}
};
`;

// ⚠️ 必须打进同一个 bundle：分成两个入口会各带一份 store 模块实例，
//    seedDemoTimetable() 写的是副本，ask() 读的是另一份空数据。
const ENTRY = join(OUT, 'entry.mjs');
const { writeFileSync } = await import('node:fs');
writeFileSync(
  join(OUT, 'entry.ts'),
  "export * from '../src/services/xiao/engine';\nexport * as store from '../src/stores/app';\n",
  'utf8'
);

await build({
  entryPoints: [join(OUT, 'entry.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: ENTRY,
  banner: { js: MOCK },
  logLevel: 'error'
});

let pass = 0;
let fail = 0;
const fails = [];

function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log('PASS', name);
  } else {
    fail++;
    fails.push(name + (detail ? ' — ' + detail : ''));
    console.log('FAIL', name, detail ? '→' + detail : '');
  }
}

const mod = await import(pathToFileURL(ENTRY).href);
const ask = mod.ask;
const store = mod.store;

/* ============ 阶段 A：还没课表 ============ */
console.log('\n--- 阶段 A：首启没有课表 ---');
const a1 = ask('下一节什么课');
ok('没课表时问下一节 → 引导去导入', a1.text.includes('还没有课表'), a1.intent);
const a2 = ask('明天有几节课');
ok('没课表时问明天 → 引导去导入', a2.text.includes('还没有课表'), a2.intent);

/* ============ 阶段 B：导入示例课表 ============ */
store.seedDemoTimetable();
console.log('\n--- 阶段 B：有课表（共 ' + store.activeCourses.value.length + ' 条课程记录） ---');

const HAS_TT = [
  ['下一节什么课', 'next-class'],
  ['今天有什么课', 'today-class'],
  ['今天几节课', 'today-class'],
  ['明天有几节课', 'tomorrow-class'],
  ['后天有课吗', 'dayafter-class'],
  ['周三有课吗', 'weekday-class'],
  ['星期三有课吗', 'weekday-class'],
  ['周五一共有几节课', 'weekday-class'],
  ['这周有几节课', 'week-overview'],
  ['现在第几周', 'week-num'],
  ['还有几周放假', 'week-left'],
  ['这周哪天没课', 'free-day'],
  ['今天还剩几节课', 'rest-today'],
  ['有哪些课', 'course-list'],
  ['学分多少', 'credit'],
  ['第3节几点上课', 'period-time'],
  ['作息时间表', 'period-time'],
  ['今天有什么安排', 'today-brief'],
  ['帮我规划复习', 'study-plan'],
  ['考试形式是什么', 'course-info']
];

for (const [q, want] of HAS_TT) {
  const r = ask(q);
  ok(`课表·${q} → ${want}`, r.intent === want, r.intent + ' | ' + r.text.slice(0, 40).replace(/\n/g, ' '));
}

/* ---- 课程名匹配 ---- */
console.log('');
const NAME_CASES = [
  ['高数在哪上', '高等数学'],
  ['高等数学在哪', '高等数学'],
  ['大物谁教', '大学物理'],
  ['大学物理的教室', '大学物理'],
  ['线性代数什么时候上', '线性代数'],
  ['体育在哪上', '体育'],
  ['工程制图是几节课', '工程制图']
];
for (const [q, name] of NAME_CASES) {
  const r = ask(q);
  ok(`课程·${q}`, r.text.includes(name), r.intent + ' | ' + r.text.slice(0, 50).replace(/\n/g, ' '));
}

const t = ask('大物谁教');
ok('问老师只答老师', /李老师/.test(t.text) && !/教室/.test(t.text), t.text);

const w = ask('高数在哪上');
ok('问教室只答教室', /主教 301/.test(w.text), w.text);

/* ---- 记事 ---- */
console.log('');
const notes = store.db.notes;
const n1 = ask('还有哪些记事没做');
ok('记事·未完成', n1.intent === 'notes-open' && n1.text.includes(String(notes.filter((n) => !n.done).length)), n1.text.slice(0, 40));
const n2 = ask('记事一共几条');
ok('记事·总数', n2.intent === 'notes-count', n2.text);
const n3 = ask('今天有什么记事');
ok('记事·今天', n3.intent === 'notes-today', n3.intent);

/* ---- 二课 ---- */
console.log('');
const s1 = ask('还差多少二课分');
ok('二课·总分', s1.intent === 'sc-total' && s1.text.includes(String(store.totalScore())), s1.text.slice(0, 40));
const s2 = ask('德育多少分');
ok('二课·单个板块', s2.intent === 'sc-block' && s2.text.includes('道德'), s2.text);
const s3 = ask('哪个板块最缺');
ok('二课·短板', s3.intent === 'sc-weak', s3.intent);
const s4 = ask('怎么加分');
ok('二课·提升建议', s4.intent === 'sc-improve', s4.intent);
const s5 = ask('志愿时长多少');
ok('二课·志愿时长', s5.intent === 'hours' && s5.text.includes(String(store.hourTotal('volunteer'))), s5.text);

/* ---- 校园通 ---- */
console.log('');
const c1 = ask('教务系统在哪');
ok('校园通·教务', c1.intent === 'campus' && c1.text.includes('教务系统'), c1.text.slice(0, 30));
const c2 = ask('图书馆');
ok('校园通·图书馆', c2.intent === 'campus' && c2.text.includes('图书馆'), c2.text.slice(0, 30));
const c3 = ask('校园网怎么连');
ok('校园通·校园网', c3.intent === 'campus' && c3.text.includes('校园网'), c3.text.slice(0, 30));
const c4 = ask('体测在哪查');
ok('校园通·体测', c4.intent === 'campus' && c4.text.includes('健康云'), c4.text.slice(0, 30));

/* ---- 通用 ---- */
console.log('');
const g = [
  ['你好', 'greeting'],
  ['谢谢', 'thanks'],
  ['你是谁', 'whoami'],
  ['你能做什么', 'help'],
  ['现在几点', 'now-time'],
  ['今天星期几', 'now-time'],
  ['天气怎么样', 'weather'],
  ['怎么设置提醒', 'reminder']
];
for (const [q, want] of g) {
  const r = ask(q);
  ok(`通用·${q} → ${want}`, r.intent === want, r.intent);
}

/* ---- 边界：这些必须答不上，不能瞎编 ---- */
console.log('');
const NO_ANSWER = ['asdfghjkl', '你觉得我今天帅吗', '帮我写一篇 3000 字论文'];
for (const q of NO_ANSWER) {
  const r = ask(q);
  ok(`兜底·「${q}」不该硬答`, r.intent === 'fallback', r.intent + ' | ' + r.text.slice(0, 40));
}

const empty = ask('   ');
ok('空输入', empty.intent === 'empty', empty.intent);

/* ============ 阶段 C：泛化问法（口语化，只要不是兜底就算过） ============ */
console.log('\n--- 阶段 C：泛化问法覆盖 ---');
const CASUAL = [
  // 课表
  '我今天有课吗',
  '今天课多吗',
  '明天早上有课吗',
  '明天下午几节课',
  '周四下午有课吗',
  '下周三有课吗',
  '周五有课没',
  '这周课多不多',
  '下周有课吗',
  '第8周有什么课',
  '今天第一节课几点',
  '我们现在第几周了',
  '离放假还有多久',
  '这学期一共几门课',
  '一周上多少节课',
  '我一天最多几节课',
  '哪天最轻松',
  '今天下午有空吗',
  '我现在有课吗',
  '还有多久下课',
  '几点下课',
  // 课程
  '高数几点上课',
  '高数教室在哪',
  '大物在哪上课',
  '线代谁教',
  '体育课在哪上',
  '无机化学实验在哪',
  '工程制图周几上',
  '思想道德与法治是谁的课',
  '大物几学分',
  // 记事
  '我还有什么事没做',
  '记事本里有什么',
  '今天有作业吗',
  '明天有什么待办',
  '有多少条记事',
  // 二课
  '二课还差多少',
  '第二课堂多少分了',
  '智育多少分',
  '体育分够了吗',
  '美育差多少',
  '劳育多少分',
  '哪个板块差最多',
  '怎么才能加分',
  '志愿时长多少小时',
  '劳育时长',
  // 校园通
  '教务系统怎么进',
  '在哪查成绩',
  '图书馆怎么去',
  '校园网连不上',
  '一卡通在哪充',
  '知网怎么进',
  // 通用
  '你好呀',
  '你是小鸮吗',
  '你会干什么',
  '现在几点了',
  '今天几号',
  '今天周几',
  '天气怎么样',
  '能设个闹钟吗',
  '帮我安排一下学习',
  '我好累啊',
  '压力好大'
];

let casualFail = 0;
for (const q of CASUAL) {
  const r = ask(q);
  if (r.intent === 'fallback') {
    casualFail++;
    console.log('  MISS', q);
  }
}
ok(
  `泛化问法 ${CASUAL.length} 条，能答 ${CASUAL.length - casualFail} 条`,
  casualFail === 0,
  casualFail + ' 条落到兜底'
);

/* ============ 阶段 D：兜底必须诚实 ============ */
console.log('\n--- 阶段 D：不该答的必须承认不会 ---');
const MUST_FAIL = ['asdfghjkl', 'web3 是什么', '帮我写一篇 3000 字论文', '今天纳斯达克涨了吗'];
for (const q of MUST_FAIL) {
  const r = ask(q);
  ok(`坦白不会·「${q}」`, r.intent === 'fallback', r.intent);
}

/* ---- 覆盖率统计 ---- */
const ALL = [
  ...HAS_TT.map((x) => x[0]),
  ...NAME_CASES.map((x) => x[0]),
  ...CASUAL,
  '还有哪些记事没做',
  '记事一共几条',
  '今天有什么记事',
  '还差多少二课分',
  '德育多少分',
  '哪个板块最缺',
  '怎么加分',
  '志愿时长多少',
  '教务系统在哪',
  '图书馆',
  '校园网怎么连',
  '体测在哪查',
  '你好',
  '谢谢',
  '你是谁',
  '你能做什么',
  '现在几点',
  '今天星期几',
  '天气怎么样',
  '怎么设置提醒'
];
const answered = ALL.filter((q) => {
  const r = ask(q);
  return r.intent !== 'fallback' && r.intent !== 'empty';
}).length;
console.log(`\n本地可答：${answered}/${ALL.length}（${Math.round((answered / ALL.length) * 100)}%）`);

console.log(`\n合计 ${pass + fail} 项，失败 ${fail} 项`);
if (fail) {
  console.log('失败项：');
  fails.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
