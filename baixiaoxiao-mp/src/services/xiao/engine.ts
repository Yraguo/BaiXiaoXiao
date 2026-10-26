/**
 * 小鸮的本地对话引擎（完全离线）
 *
 * 【为什么不接大模型】用户环境不能联网，小程序又不允许在前端塞 API Key。
 * 所以这里是一个**规则 + 本机数据**的问答引擎：所有答案都从 store 里算出来，
 * 不编造事实。命中不了就如实说「没学会」，并给出可问的方向。
 *
 * 设计要点：
 *   1. RULES 按顺序匹配，先具体的后宽泛的（「第3节几点」必须在「第3周」之前）。
 *   2. run() 返回 null 表示「这条规则认了但这句不该它答」，继续往下走，
 *      这样同一条正则可以覆盖多种问法而不互相挡住。
 *   3. 兜底前再试一次**课程名模糊匹配** —— 用户最常问的就是「高数在哪上」，
 *      这种简称没法靠正则枚举，用字集覆盖率算。
 */
import {
  SC_BLOCKS,
  SC_TOTAL,
  activeCourses,
  activeTimetable,
  blockScore,
  db,
  hourTotal,
  todayIndex,
  totalScore,
  type Course
} from '../../stores/app';
import { DEFAULT_PERIOD_TIMES } from '../../shared/periods';

export interface Reply {
  text: string;
  /** 命中的意图，测试与排查用 */
  intent: string;
}

/* ============================ 基础工具 ============================ */

const WD = ['一', '二', '三', '四', '五', '六', '日'];
const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function nowMin(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function startOf(p: number): string {
  return DEFAULT_PERIOD_TIMES[p - 1]?.start || '';
}
function endOf(p: number): string {
  return DEFAULT_PERIOD_TIMES[p - 1]?.end || '';
}

/** 某节 → '08:00-09:35' */
function spanOf(a: number, b: number): string {
  const s = startOf(a);
  const e = endOf(b);
  return s && e ? `${s}-${e}` : '';
}

function dayName(day: number): string {
  return `周${WD[day - 1] || '?'}`;
}

/** 今天往后推的第 day 天（day: 1..7）对应的日期 */
function dateOfDay(day: number, plusWeeks = 0): Date {
  const t = todayIndex.value;
  const base = new Date();
  const diff = day - t + plusWeeks * 7;
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + diff);
}

function mdOf(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function addDays(s: string, n: number): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, (d || 1) + n);
}

/** 今天零点，用来判断某个星期几是不是已经过去了 */
function today0(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 上午 / 下午 / 晚上 → 节次区间 */
function halfFilter(q: string): [number, number] | null {
  if (/上午|早上|早晨/.test(q)) return [1, 5];
  if (/中午/.test(q)) return [4, 6];
  if (/下午/.test(q)) return [6, 9];
  if (/晚上|傍晚/.test(q)) return [10, 12];
  return null;
}

/** 'YYYY-MM-DD' 格式 */
function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function hasTimetable(): boolean {
  return activeCourses.value.length > 0;
}

const NO_TIMETABLE =
  '你还没有课表。\n去「课程表」页点右上角的按钮，用教务系统账号一键导入（北化已内置地址），也可以手动添加。';

/** 某天某周的课，按节次排好 */
function coursesOnDay(day: number, week: number): Course[] {
  return activeCourses.value
    .filter((c) => c.day === day && c.weeks.includes(week))
    .sort((a, b) => a.startPeriod - b.startPeriod);
}

/** 从问句里抽星期几；没有则 null */
function dayFromText(q: string): number | null {
  const m = q.match(/(?:周|星期|礼拜)([一二三四五六日天1-7])/);
  if (!m) return null;
  const c = m[1];
  if (/[1-7]/.test(c)) return Number(c);
  if (c === '日' || c === '天') return 7;
  return WD.indexOf(c) + 1;
}

/** 从问句里抽「第 N 周」；没有则 null */
function weekFromText(q: string): number | null {
  const m = q.match(/第\s*(\d{1,2})\s*周/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 60 ? n : null;
}

/** 一批课程占的**节次数**（1-2 节算 2 节；说「几节课」时中文指的就是这个） */
function totalPeriods(list: Course[]): number {
  return list.reduce((a, c) => a + Math.max(1, c.endPeriod - c.startPeriod + 1), 0);
}

/** 一节课列表 → '《高数》第1-2节 08:00-09:35 · 主教301' */
function lineOf(c: Course): string {
  const parts = [`《${c.name}》第 ${c.startPeriod}-${c.endPeriod} 节`];
  const sp = spanOf(c.startPeriod, c.endPeriod);
  if (sp) parts.push(sp);
  if (c.room) parts.push(c.room);
  return parts.join(' · ');
}

/* ============================ 课程名模糊匹配 ============================ */

/**
 * 问句里不参与匹配的字（提问用字，不是课名的一部分）
 *
 * 注意别把「大」放进来 —— 「大学物理」的「大」一去掉，
 * 「大物谁教」就只剩一个「物」，两字门槛过不去，简称匹配直接失效。
 */
const STOP_CHARS = new Set(
  '我你他她它的了吗呢吧啊呀么什哪在上下有没是和与或几点周星期礼拜课老师教教室地点时候多少帮我查一下看说想问能可会要请给对这门那节次前后今明后天现在还有几个谁'.split('')
);

function charSet(s: string): Set<string> {
  const out = new Set<string>();
  for (const ch of s) {
    if (/[\u4e00-\u9fa5]/.test(ch) && !STOP_CHARS.has(ch)) out.add(ch);
  }
  return out;
}

/** 两字集合的交集大小 */
function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  a.forEach((ch) => {
    if (b.has(ch)) n++;
  });
  return n;
}

/**
 * 按名称找课。
 * 先试「问句里含完整课名」，再试字集覆盖率（应付「高数」「大物」这类简称）。
 */
function findCourses(q: string): Course[] {
  const all = activeCourses.value;
  if (!all.length) return [];

  // 1) 完整课名出现在问句里。名字常带后缀（「高等数学 B(Ⅰ)」「体育（篮球）」），
  //    去掉括号与尾部字母后通常就是学生嘴里的叫法，一并试。
  const exact = all.filter((c) => {
    if (q.includes(c.name)) return true;
    const core = c.name.replace(/[（(][^)）]*[)）]/g, '').replace(/[^\u4e00-\u9fa5]+$/, '');
    return core.length >= 2 && q.includes(core);
  });
  if (exact.length) {
    const names = new Set(exact.map((c) => c.name));
    return all.filter((c) => names.has(c.name));
  }

  // 2) 字集覆盖率
  const qs = charSet(q);
  if (qs.size < 2) return [];
  let best = 0;
  let hits: Course[] = [];
  for (const c of all) {
    const cs = charSet(c.name);
    if (!cs.size) continue;
    const inter = overlap(qs, cs);
    if (inter < 2) continue;
    const cover = inter / qs.size;
    if (cover > best) {
      best = cover;
      hits = [c];
    }
  }
  if (best < 0.6) return [];
  const names = new Set(hits.map((c) => c.name));
  return all.filter((c) => names.has(c.name));
}

/** 一门课的全部时段 → 一段完整介绍 */
function courseInfo(courses: Course[], q: string): string {
  const c0 = courses[0];
  const slots = courses
    .slice()
    .sort((a, b) => a.day - b.day || a.startPeriod - b.startPeriod)
    .map((c) => {
      const sp = spanOf(c.startPeriod, c.endPeriod);
      return `${dayName(c.day)} 第 ${c.startPeriod}-${c.endPeriod} 节${sp ? ' ' + sp : ''}${c.room ? ' · ' + c.room : ''}`;
    });

  const askWhere = /在哪|哪里上|教室|地点|哪个楼/.test(q);
  const askTeacher = /谁教|老师|教师|任教/.test(q);
  const askTime = /什么时候|几点|哪天|哪节|时间/.test(q);

  if (askWhere && !askTeacher) {
    if (slots.length === 1) return `《${c0.name}》在 ${c0.room || '（没填教室）'}。`;
    return `《${c0.name}》的教室：\n${slots.join('\n')}`;
  }
  if (askTeacher && !askWhere) {
    if (!c0.teacher) return `《${c0.name}》的教师没填。想补的话可以在课程详情里编辑。`;
    const suffix = /老师|教授|讲师|助教/.test(c0.teacher) ? '' : ' 老师';
    return `《${c0.name}》是 ${c0.teacher}${suffix}。`;
  }
  if (askTime && slots.length) {
    return `《${c0.name}》上课时间：\n${slots.join('\n')}`;
  }

  const extra: string[] = [];
  if (c0.teacher) extra.push(`教师 ${c0.teacher}`);
  if (c0.credit !== null && c0.credit !== undefined) extra.push(`${c0.credit} 学分`);
  if (c0.examMode) extra.push(c0.examMode);
  if (c0.campus) extra.push(c0.campus);

  return (
    `《${c0.name}》\n` +
    slots.join('\n') +
    (extra.length ? '\n' + extra.join(' · ') : '') +
    (c0.weeksRaw ? `\n周次：${c0.weeksRaw}` : '')
  );
}

/* ============================ 各意图的回答 ============================ */

function nextClassText(): string {
  const t = todayIndex.value;
  const week = db.currentWeek;
  const now = nowMin();
  const today = coursesOnDay(t, week);

  // 正在上课
  const ongoing = today.find(
    (c) => toMin(startOf(c.startPeriod)) <= now && now <= toMin(endOf(c.endPeriod))
  );
  if (ongoing) {
    const left = toMin(endOf(ongoing.endPeriod)) - now;
    return (
      `你正在上《${ongoing.name}》。\n` +
      `第 ${ongoing.startPeriod}-${ongoing.endPeriod} 节${ongoing.room ? ' · ' + ongoing.room : ''}\n` +
      `${endOf(ongoing.endPeriod)} 下课，还有 ${left} 分钟。`
    );
  }

  // 今天还没上的
  const next = today.find((c) => toMin(startOf(c.startPeriod)) > now);
  if (next) {
    const wait = toMin(startOf(next.startPeriod)) - now;
    const h = Math.floor(wait / 60);
    const m = wait % 60;
    const gap = h ? `${h} 小时${m ? ' ' + m + ' 分钟' : ''}` : `${m} 分钟`;
    return (
      `下一节是《${next.name}》。\n` +
      `第 ${next.startPeriod}-${next.endPeriod} 节 · ${spanOf(next.startPeriod, next.endPeriod)} 开始\n` +
      `${next.room ? '地点：' + next.room + '\n' : ''}` +
      `${gap}后上课。`
    );
  }

  // 今天没了 → 往后找最近的一节
  for (let i = 1; i <= 7; i++) {
    const day = ((t - 1 + i) % 7) + 1;
    const extraWeek = Math.floor((t - 1 + i) / 7);
    const w = week + extraWeek;
    if (w > (activeTimetable.value?.totalWeeks || 18)) break;
    const list = coursesOnDay(day, w);
    if (list.length) {
      const c = list[0];
      return (
        `今天（${WEEKDAY_CN[new Date().getDay()]}）的课上完了。\n` +
        `最近一节是 ${dayName(day)}（${mdOf(dateOfDay(day, extraWeek))}）的《${c.name}》，` +
        `第 ${c.startPeriod}-${c.endPeriod} 节${c.room ? ' · ' + c.room : ''}。`
      );
    }
  }
  return '今天没课，接下来一周也没有课。';
}

function dayCoursesText(
  day: number,
  plusWeeks = 0,
  label?: string,
  half: [number, number] | null = null
): string {
  // 今天周日问「周四」，字面上是本周已经过完的周四；按下一个周四算才不会给出过去的日期
  if (plusWeeks === 0 && dateOfDay(day, 0) < today0()) plusWeeks = 1;
  const week = db.currentWeek + plusWeeks;
  const total = activeTimetable.value?.totalWeeks || 18;
  const halfName = half ? ({ '1,5': '上午', '4,6': '中午', '6,9': '下午', '10,12': '晚上' } as Record<string, string>)[`${half[0]},${half[1]}`] || '' : '';
  if (week > total) return `${label || dayName(day)}已经是假期了（本学期共 ${total} 周）。`;
  const all = coursesOnDay(day, week);
  const list = half ? all.filter((c) => c.startPeriod <= half[1] && c.endPeriod >= half[0]) : all;
  const name = label || dayName(day);
  const suffix = halfName ? halfName : '';
  if (!list.length) return `${name}（${mdOf(dateOfDay(day, plusWeeks))}）${suffix}没有课。`;
  const names = [...new Set(list.map((c) => c.name))];
  return (
    `${name}（${mdOf(dateOfDay(day, plusWeeks))}）${suffix}有 ${totalPeriods(list)} 节课，${names.length} 门：\n` +
    list.map((c) => '· ' + lineOf(c)).join('\n')
  );
}

function weekOverview(offset = 0): string {
  const week = Math.max(1, db.currentWeek + offset);
  const days = [1, 2, 3, 4, 5, 6, 7];
  const rows: string[] = [];
  let count = 0;
  for (const d of days) {
    const list = coursesOnDay(d, week);
    count += totalPeriods(list);
    rows.push(`${dayName(d)}  ${list.length ? list.map((c) => c.name).join('、') : '—'}`);
  }
  const names = new Set(activeCourses.value.filter((c) => c.weeks.includes(week)).map((c) => c.name));
  const tag = offset > 0 ? '下周' : offset < 0 ? '上周' : '本周';
  return `${tag}（第 ${week} 周）共 ${count} 节课、${names.size} 门：\n${rows.join('\n')}`;
}

function weekNumText(): string {
  const total = activeTimetable.value?.totalWeeks || 18;
  const now = db.currentWeek;
  const left = Math.max(0, total - now);
  return `现在是第 ${now} 周（本学期共 ${total} 周），还剩 ${left} 周。`;
}

function weekLeftText(): string {
  const tt = activeTimetable.value;
  if (!tt) return NO_TIMETABLE;
  const total = tt.totalWeeks || 18;
  const left = Math.max(0, total - db.currentWeek);
  const end = addDays(tt.semesterStartMonday, total * 7 - 1);
  if (!left) return `第 ${total} 周已经是最后一周了，${mdOf(end)} 学期结束。`;
  return `还剩 ${left} 周。\n按课表推算，学期最后一天是 ${stamp(end)}。`;
}

function freeDayText(): string {
  const week = db.currentWeek;
  const empty: string[] = [];
  const busy: Array<{ d: number; n: number }> = [];
  for (let d = 1; d <= 7; d++) {
    const n = totalPeriods(coursesOnDay(d, week));
    if (!n) empty.push(dayName(d));
    else busy.push({ d, n });
  }
  if (empty.length === 7) return '这一周都没课。';
  const lines: string[] = [];
  if (empty.length) lines.push(`这周没课的日子：${empty.join('、')}`);
  else lines.push('这周每天都排了课。');
  busy.sort((a, b) => a.n - b.n);
  if (busy.length) {
    const lightest = busy[0];
    const heaviest = busy[busy.length - 1];
    lines.push(`最轻松的是${dayName(lightest.d)}（${lightest.n} 节），最忙的是${dayName(heaviest.d)}（${heaviest.n} 节）。`);
  }
  const today = totalPeriods(coursesOnDay(todayIndex.value, week));
  lines.push(`今天 ${today} 节课。`);
  return lines.join('\n');
}

function restOfTodayText(): string {
  const week = db.currentWeek;
  const now = nowMin();
  const list = coursesOnDay(todayIndex.value, week).filter(
    (c) => toMin(endOf(c.endPeriod)) > now
  );
  if (!list.length) return '今天的课都上完了，剩下的时间是你的。';
  return `今天还剩 ${totalPeriods(list)} 节课：\n` + list.map((c) => '· ' + lineOf(c)).join('\n');
}

function courseListText(): string {
  const names = [...new Set(activeCourses.value.map((c) => c.name))];
  if (!names.length) return NO_TIMETABLE;
  const credits = activeCourses.value.reduce((a, c) => a + (c.credit || 0), 0);
  return (
    `这学期 ${names.length} 门课：\n` +
    names.map((n, i) => `${i + 1}. ${n}`).join('\n') +
    (credits ? `\n合计 ${credits} 学分。` : '')
  );
}

function creditText(): string {
  const withCredit = activeCourses.value.filter((c) => c.credit !== null && c.credit !== undefined);
  if (!withCredit.length) {
    return '课表里的课程都还没填学分。留空的课（多半是导入的）可以在课程详情里补上，补完我就能统计。';
  }
  const total = withCredit.reduce((a, c) => a + (c.credit || 0), 0);
  const byName = new Map<string, number>();
  for (const c of withCredit) byName.set(c.name, c.credit || 0);
  const rows = [...byName.entries()].map(([n, v]) => `· ${n} ${v}`);
  return `已填学分的课共 ${total} 学分：\n${rows.join('\n')}`;
}

/** 「第 3 节几点」→ 那一节的起止 */
function periodTimeText(q: string): string | null {
  const m = q.match(/第\s*(\d{1,2})\s*节/);
  if (m) {
    const p = Number(m[1]);
    const s = startOf(p);
    const e = endOf(p);
    if (!s) return `一天最多 12 节，没有第 ${p} 节。`;
    return `第 ${p} 节是 ${s}-${e}。`;
  }
  if (/作息|时间表|上课时间|几点上课|几点下课|一节课.*(久|长)/.test(q)) {
    const rows = DEFAULT_PERIOD_TIMES.map((t) => `${t.period}  ${t.start}-${t.end}`);
    const midday = DEFAULT_PERIOD_TIMES.filter((t) => t.period <= 5).pop();
    const pm = DEFAULT_PERIOD_TIMES.find((t) => t.period === 6);
    return (
      '作息表：\n' +
      rows.join('\n') +
      (midday && pm ? `\n\n午休 ${midday.end}-${pm.start}。` : '')
    );
  }
  return null;
}

function notesOpenText(limit = 8): string {
  const open = db.notes.filter((n) => !n.done);
  if (!open.length) return '没有未完成的记事，挺干净的。';
  const sorted = open.slice().sort((a, b) => a.date.localeCompare(b.date));
  return (
    `有 ${open.length} 条没做完：\n` +
    sorted.slice(0, limit).map((n) => `· ${n.date}  ${n.title || '(无标题)'}`).join('\n') +
    (open.length > limit ? `\n…还有 ${open.length - limit} 条，去记事本看全部。` : '')
  );
}

function notesOnDateText(date: string, label: string): string {
  const list = db.notes.filter((n) => n.date === date);
  if (!list.length) return `${label}（${date}）没有记事。`;
  return (
    `${label}（${date}）有 ${list.length} 条：\n` +
    list.map((n) => `· ${n.done ? '✓ ' : ''}${n.title || '(无标题)'}`).join('\n')
  );
}

function scBlockText(q: string): string | null {
  const map: Array<{ k: 'de' | 'zhi' | 'ti' | 'mei' | 'lao'; re: RegExp }> = [
    { k: 'de', re: /德育?|思想/ },
    { k: 'zhi', re: /智育?|学术|科技/ },
    { k: 'ti', re: /体育?|身心/ },
    { k: 'mei', re: /美育?|人文/ },
    { k: 'lao', re: /劳育?|劳动|实践/ }
  ];
  for (const { k, re } of map) {
    if (!re.test(q)) continue;
    // 只有问句确实在问分数/进度时才答，避免「体育课在哪上」被截胡
    if (!/分|多少|进度|满|差|够|已|拿/.test(q)) continue;
    const b = SC_BLOCKS.find((x) => x.key === k);
    if (!b) continue;
    const got = blockScore(k);
    return `${b.name}（${b.full}）：已得 ${got}/${b.fullScore}，还差 ${Math.max(0, b.fullScore - got)} 分。`;
  }
  return null;
}

function scWeakText(): string {
  const sorted = SC_BLOCKS.map((b) => ({
    ...b,
    got: blockScore(b.key),
    gap: b.fullScore - blockScore(b.key)
  })).sort((a, b) => b.gap - a.gap);
  const top = sorted[0];
  return (
    `总自评 ${totalScore()}/${SC_TOTAL}，还差 ${SC_TOTAL - totalScore()} 分。\n` +
    `缺口最大的是「${top.name}·${top.full}」，差 ${top.gap} 分（已得 ${top.got}/${top.fullScore}）。\n` +
    sorted.map((b) => `· ${b.name} ${b.got}/${b.fullScore}`).join('\n')
  );
}

function scImproveText(): string {
  const tips: Record<string, string> = {
    de: '德育：主题教育、党团活动、志愿服务都算，讲座类记得留签到截图。',
    zhi: '智育：学科竞赛、大创、论文专利、学术讲座，竞赛获奖给分最集中。',
    ti: '体育：校运会、早操打卡、体测达标、体育类社团活动。',
    mei: '美育：文艺演出、书画摄影比赛、人文讲座、社团汇演。',
    lao: '劳育：寝室卫生评比、校园劳动岗、社会实践、支教。'
  };
  const sorted = SC_BLOCKS.map((b) => ({ b, gap: b.fullScore - blockScore(b.key) })).sort(
    (x, y) => y.gap - x.gap
  );
  return (
    `还差 ${SC_TOTAL - totalScore()} 分。按缺口排，优先补这些：\n` +
    sorted
      .slice(0, 3)
      .map(({ b, gap }) => `${b.name}（差 ${gap}）— ${tips[b.key]}`)
      .join('\n')
  );
}

const CAMPUS: Array<{ name: string; desc: string; kw: RegExp }> = [
  { name: '教务系统', desc: '课表 · 成绩 · 选课', kw: /教务|选课|成绩|考试安排/ },
  { name: '北化在线', desc: '在线课程与作业', kw: /在线|网课|作业平台|课程平台/ },
  { name: '图书馆', desc: '馆藏检索 · 数据库', kw: /图书馆|借书|馆藏|文献/ },
  { name: '电子资源', desc: '统一身份认证 · 校外访问', kw: /知网|文献|数据库|电子资源|校外访问/ },
  { name: '健康云', desc: '体质测试与健康数据', kw: /体测|健康|体检|体育测试/ },
  { name: '信息门户', desc: '统一身份认证主入口', kw: /门户|统一身份|一卡通|缴费/ },
  { name: '校园网平台', desc: '网络认证 · 校园网', kw: /校园网|上网|网络|wifi|WiFi/ },
  { name: '学校主页', desc: '通知公告 · 数字校园', kw: /主页|官网|通知|公告/ }
];

/* ============================ 规则表 ============================ */

interface Rule {
  key: string;
  test: (q: string) => boolean;
  run: (q: string) => string | null;
}

const RULES: Rule[] = [
  {
    key: 'greeting',
    test: (q) => /^(你好|您好|hi|hello|哈喽|嗨|在吗|小鸮)/i.test(q) && q.length <= 12,
    run: () => '在。想问课表、记事，还是二课分？直接说就行。'
  },
  {
    key: 'thanks',
    test: (q) => /^(谢谢|多谢|感谢|thx|thanks)/i.test(q),
    run: () => '不客气。还有别的要查吗？'
  },
  {
    key: 'bye',
    test: (q) => /^(再见|拜拜|晚安|bye)/i.test(q),
    run: () => '晚安。有事随时叫我。'
  },
  {
    key: 'whoami',
    test: (q) => /你是谁|你叫什么|你是啥|你是什么|你是小鸮|小鸮是谁|你是不是/.test(q),
    run: () => '我是小鸮，百小鸮里的助手。\n全部在本机算，不联网，也不会上传你的课表和记事。'
  },
  {
    key: 'help',
    test: (q) => /能做什么|会什么|帮助|怎么用|有什么功能|可以问|会干什么|会啥|能干啥/.test(q),
    run: () =>
      '我能答这些（都不用联网）：\n' +
      '· 课表：下一节、今天/明天/周三的课、这周几节、第几周、还有几周放假\n' +
      '· 课程：某门课在哪上、谁教、什么时候上、多少学分\n' +
      '· 空档：哪几天没课、今天还剩几节\n' +
      '· 记事：还有哪些没做、今天/某天有什么\n' +
      '· 二课：总分、某板块差多少、缺口最大的是哪块\n' +
      '· 时长：志愿/劳育累计\n' +
      '· 校园通：教务、图书馆、校园网这些入口在哪\n' +
      '也可以直接打课名，比如「高数在哪上」。'
  },
  {
    key: 'now-time',
    test: (q) =>
      /几点了|现在几点|现在时间|现在.*(日期|几号)|今天.*(几号|星期几|礼拜几|周几)/.test(q),
    run: () => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      return `现在是 ${d.getHours()}:${p(d.getMinutes())}，${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY_CN[d.getDay()]}，第 ${db.currentWeek} 周。`;
    }
  },
  {
    key: 'period-time',
    test: (q) => /作息|时间表|上课时间|几点上课|几点下课|一节课.*(久|长)|第\s*\d{1,2}\s*节/.test(q),
    run: (q) => {
      // 只有"第X节"而没问时间时，交给课程表相关意图
      if (!/几点|作息|时间表|多久|多长/.test(q) && /有|上|什么/.test(q)) return null;
      return periodTimeText(q);
    }
  },
  {
    key: 'mood',
    test: (q) => /好累|累死|困死|好困|烦死|压力(好)?大|焦虑|难受|不想上|摆烂|emo|撑不住/i.test(q),
    run: () => {
      if (!hasTimetable()) return '先歇会儿。课表还没导，导完我能帮你把安排理清楚，看着就不那么乱了。';
      const now = nowMin();
      const left = coursesOnDay(todayIndex.value, db.currentWeek).filter(
        (c) => toMin(endOf(c.endPeriod)) > now
      ).length;
      const open = db.notes.filter((n) => !n.done).length;
      return (
        `${left ? `今天还剩 ${left} 节课` : '今天没课了'}，记事还有 ${open} 条。\n` +
        '别一次想全部，先把最近的一件做完，剩下的再说。'
      );
    }
  },
  {
    key: 'week-num',
    test: (q) => /第几周|现在.*第.*周|这周是第|本周是第/.test(q),
    run: () => (hasTimetable() || activeTimetable.value ? weekNumText() : NO_TIMETABLE)
  },
  {
    key: 'week-left',
    test: (q) => /还有.*周|几周.*(放假|结束|完)|什么时候.*(放假|结束)|放假|假期|学期.*(结束|完)/.test(q),
    run: () => weekLeftText()
  },
  {
    key: 'week-overview',
    test: (q) => /这周|本周|整周|一周.*(几节|多少)|全周|下周|上周/.test(q),
    run: (q) => {
      if (!hasTimetable()) return NO_TIMETABLE;
      return weekOverview(/下周/.test(q) ? 1 : /上周/.test(q) ? -1 : 0);
    }
  },
  {
    key: 'now-class',
    test: (q) => /下课|正在上|现在.*上什么|在上什么|现在有课/.test(q),
    run: () => {
      if (!hasTimetable()) return NO_TIMETABLE;
      const now = nowMin();
      const list = coursesOnDay(todayIndex.value, db.currentWeek);
      const cur = list.find(
        (c) => toMin(startOf(c.startPeriod)) <= now && now <= toMin(endOf(c.endPeriod))
      );
      if (!cur) {
        const nxt = list.find((c) => toMin(startOf(c.startPeriod)) > now);
        if (!nxt) return '现在没课，今天也上完了。';
        const wait = toMin(startOf(nxt.startPeriod)) - now;
        return `现在没课。下一节《${nxt.name}》${startOf(nxt.startPeriod)} 开始，还有 ${wait} 分钟。`;
      }
      const left = toMin(endOf(cur.endPeriod)) - now;
      return (
        `《${cur.name}》正在上（第 ${cur.startPeriod}-${cur.endPeriod} 节${cur.room ? ' · ' + cur.room : ''}）。\n` +
        `${endOf(cur.endPeriod)} 下课，还有 ${left} 分钟。`
      );
    }
  },
  {
    key: 'next-class',
    test: (q) => /下一节|下节|接下来|还有课吗|还有几节|剩.*几节/.test(q),
    run: () => (hasTimetable() ? nextClassText() : NO_TIMETABLE)
  },
  {
    key: 'today-class',
    test: (q) => /今天/.test(q) && /课|上什么|安排|几节|有空|没空/.test(q),
    run: (q) => (hasTimetable() ? dayCoursesText(todayIndex.value, 0, '今天', halfFilter(q)) : NO_TIMETABLE)
  },
  {
    key: 'tomorrow-class',
    test: (q) => /明天|明日/.test(q),
    run: (q) => {
      if (!hasTimetable()) return NO_TIMETABLE;
      const d = new Date();
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      const day = next.getDay() === 0 ? 7 : next.getDay();
      const crossWeek = next.getDay() === 1 ? 1 : 0; // 明天是周一 → 下一周
      return dayCoursesText(day, crossWeek, '明天', halfFilter(q));
    }
  },
  {
    key: 'dayafter-class',
    test: (q) => /后天/.test(q),
    run: (q) => {
      if (!hasTimetable()) return NO_TIMETABLE;
      const d = new Date();
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 2);
      const day = t.getDay() === 0 ? 7 : t.getDay();
      const crossWeek = t.getDay() <= 2 ? 1 : 0;
      return dayCoursesText(day, crossWeek, '后天', halfFilter(q));
    }
  },
  {
    key: 'weekday-class',
    test: (q) => dayFromText(q) !== null,
    run: (q) => {
      if (!hasTimetable()) return NO_TIMETABLE;
      const day = dayFromText(q);
      if (!day) return null;
      const wk = weekFromText(q);
      // 「下周」「上周」也算跨周
      let plus = 0;
      if (wk) plus = wk - db.currentWeek;
      else if (/下周/.test(q)) plus = 1;
      else if (/上周/.test(q)) plus = -1;
      const label = wk ? `第 ${wk} 周${dayName(day)}` : plus > 0 ? `下周${dayName(day)}` : dayName(day);
      return dayCoursesText(day, plus, label, halfFilter(q));
    }
  },
  {
    key: 'course-info',
    test: (q) => /在哪|哪里上|教室|地点|谁教|谁上|谁的课|哪个老师|老师|教师|什么时候|哪节|考试.*(形式|方式)|几周|多少周/.test(q),
    run: (q) => {
      if (!hasTimetable()) return NO_TIMETABLE;
      // 「周三什么时候有课」这类是在问排课，不是在问某门课的详情，交给前面的课表规则
      if (/有课|没课|上课吗|几节|几门/.test(q) && !/这门|那门/.test(q)) return null;
      const cs = findCourses(q);
      if (cs.length) return courseInfo(cs, q);
      // 没认出课名：若是问"在哪"，退回下一节；否则明确追问，别丢给兜底
      if (/在哪|哪个教室|地点/.test(q)) {
        const n = nextClassText();
        return '没认出是哪门课。' + (n.includes('下一节') ? '不过' + n : n);
      }
      const names = [...new Set(activeCourses.value.map((c) => c.name))].slice(0, 6);
      return `你想问哪门课？我课表里有：\n${names.map((n) => '· ' + n).join('\n')}\n直接打课名的一部分就行，比如「高数在哪上」。`;
    }
  },
  {
    key: 'course-list',
    test: (q) => /有哪些课|什么课|几门课|课程列表|都上什么|课表里/.test(q),
    run: () => courseListText()
  },
  {
    key: 'credit',
    test: (q) => /学分/.test(q),
    run: (q) => {
      // 「高数多少学分」问的是单门课，先认课名
      const cs = findCourses(q);
      if (cs.length) {
        if (cs[0].credit !== null && cs[0].credit !== undefined) return courseInfo(cs, q);
        return `《${cs[0].name}》的学分还没填。在课程详情里编辑就能补上。`;
      }
      return creditText();
    }
  },
  {
    key: 'free-day',
    test: (q) => /没课|空课|空闲|哪天.*空|最轻松|最闲|最忙|最多.*节/.test(q),
    run: () => (hasTimetable() ? freeDayText() : NO_TIMETABLE)
  },
  {
    key: 'rest-today',
    test: (q) => /还剩|剩下|后面还有/.test(q) && /课/.test(q),
    run: () => (hasTimetable() ? restOfTodayText() : NO_TIMETABLE)
  },
  {
    key: 'notes-today',
    test: (q) => /记事|待办|任务|作业/.test(q) && /今天|今日/.test(q),
    run: () => {
      const p = (n: number) => String(n).padStart(2, '0');
      const d = new Date();
      return notesOnDateText(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, '今天');
    }
  },
  {
    key: 'notes-tomorrow',
    test: (q) => /记事|待办|任务|作业/.test(q) && /明天/.test(q),
    run: () => {
      const d = new Date();
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      const p = (n: number) => String(n).padStart(2, '0');
      return notesOnDateText(`${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`, '明天');
    }
  },
  {
    key: 'notes-count',
    test: (q) => /记事|待办|任务/.test(q) && /几条|多少条|一共|数量/.test(q),
    run: () => {
      const all = db.notes.length;
      const done = db.notes.filter((n) => n.done).length;
      return `记事本共 ${all} 条，已完成 ${done} 条，未完成 ${all - done} 条。`;
    }
  },
  {
    key: 'notes-open',
    test: (q) => /记事|待办|作业|任务|要做|没做|没完成/.test(q),
    run: () => notesOpenText()
  },
  {
    key: 'hours',
    test: (q) => /志愿.*(时长|小时)|劳育.*(时长|小时)|时长.*多少|累计.*小时/.test(q),
    run: () =>
      `志愿时长 ${hourTotal('volunteer')} 小时，劳育时长 ${hourTotal('labor')} 小时。\n` +
      `共 ${db.hours.length} 条记录，可以在「第二课堂」里补记。`
  },
  {
    key: 'sc-block',
    test: (q) => /德|智|体|美|劳/.test(q) && /分|进度|多少|满|差|够/.test(q),
    run: (q) => scBlockText(q)
  },
  {
    key: 'sc-weak',
    test: (q) => /最缺|短板|哪.*差|缺口|不够|往哪补/.test(q),
    run: () => scWeakText()
  },
  {
    key: 'sc-improve',
    test: (q) => /怎么.*(加|提|拿|挣).*分|如何.*(加|提|拿|挣).*分|提升.*分|加分/.test(q),
    run: () => scImproveText()
  },
  {
    key: 'sc-total',
    test: (q) => /二课|第二课堂|自评|总分|还差多少/.test(q),
    run: () =>
      `第二课堂自评 ${totalScore()}/${SC_TOTAL}，还差 ${SC_TOTAL - totalScore()} 分。\n` +
      SC_BLOCKS.map((b) => `· ${b.name} ${blockScore(b.key)}/${b.fullScore}`).join('\n')
  },
  {
    key: 'campus',
    test: (q) =>
      /教务|成绩|选课|图书馆|校园网|门户|一卡通|体测|健康|在线课程|知网|官网|入口|校园通/.test(q),
    run: (q) => {
      const hit = CAMPUS.filter((c) => c.kw.test(q));
      if (hit.length === 1) {
        const c = hit[0];
        return `「${c.name}」在「校园通」里，点卡片会把链接复制到剪贴板，再用浏览器打开。\n${c.desc}`;
      }
      return (
        '「校园通」里有这些入口（点一下复制链接）：\n' +
        CAMPUS.map((c) => `· ${c.name} — ${c.desc}`).join('\n')
      );
    }
  },
  {
    key: 'weather',
    test: (q) => /天气|气温|下雨|下雪|几度/.test(q),
    run: () =>
      '天气要联网才能拿，我现在是全离线的，答不了。\n课表、记事、二课分这些都在本机，随时能问。'
  },
  {
    key: 'reminder',
    test: (q) => /提醒|闹钟|叫我|通知我|定时/.test(q),
    run: () =>
      '小程序没有本地闹钟能力，只能靠微信订阅消息，而且一次授权只能发一条。\n' +
      '建议：把要提醒的事写进「记事本」，日期到了会在列表里看到。'
  },
  {
    key: 'study-plan',
    test: (q) => /规划|复习|怎么学|学习计划|安排.*学习|备考/.test(q),
    run: () => {
      if (!hasTimetable()) return NO_TIMETABLE;
      const counts = new Map<string, number>();
      for (const c of activeCourses.value) {
        if (!c.weeks.includes(db.currentWeek)) continue;
        counts.set(c.name, (counts.get(c.name) || 0) + (c.endPeriod - c.startPeriod + 1));
      }
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      if (!ranked.length) return '这周没课，可以趁空档把之前的笔记补一补。';
      const heavy = ranked.slice(0, 3).map(([n, v]) => `· ${n}（本周 ${v} 节）`);
      return (
        `按本周课表给你排一下：\n` +
        `课时最多的三门：\n${heavy.join('\n')}\n\n` +
        `建议：\n` +
        `1. 先把课时最多的那门当天的内容当天过一遍，别堆到周末\n` +
        `2. 实验课提前一天看讲义，课上能少一半时间\n` +
        `3. 每晚留 30-40 分钟给英语/背记类\n` +
        `4. 周末拿一整块时间做套题，别切碎`
      );
    }
  },
  {
    key: 'today-brief',
    test: (q) => /今天.*(怎么样|如何|安排|概览)|今天.*(忙|多)|给我.*(总结|汇总)/.test(q),
    run: () => {
      if (!hasTimetable()) return NO_TIMETABLE;
      const week = db.currentWeek;
      const list = coursesOnDay(todayIndex.value, week);
      const open = db.notes.filter((n) => !n.done).length;
      const left = SC_TOTAL - totalScore();
      const parts = [
        `今天 ${WEEKDAY_CN[new Date().getDay()]}，第 ${week} 周。`,
        list.length
          ? `有 ${totalPeriods(list)} 节课：${[...new Set(list.map((c) => c.name))].join('、')}`
          : '今天没课。',
        `记事还有 ${open} 条没做。`,
        `二课自评还差 ${left} 分。`
      ];
      return parts.join('\n');
    }
  }
];

/* ============================ 兜底 ============================ */

/**
 * 规则顺序就是优先级。但有些规则天生要抢在同类前面，
 * 比如「这周哪天没课」必须早于「这周有几节」——靠数组顺序维护太脆，
 * 这里显式提权，后面加规则不用再小心翼翼地找插入位置。
 */
const PRIORITY = ['today-brief', 'rest-today', 'free-day', 'campus', 'reminder', 'weather'];

const ORDERED_RULES: Rule[] = [
  ...PRIORITY.map((k) => RULES.find((r) => r.key === k)).filter((r): r is Rule => !!r),
  ...RULES.filter((r) => !PRIORITY.includes(r.key))
];


const FALLBACK =
  '这句我还没学会（我是离线的，不会瞎编）。\n' +
  '试试这些：\n' +
  '· 下一节什么课 / 明天有几节课 / 周三有课吗\n' +
  '· 高数在哪上 / 谁教大学物理\n' +
  '· 还差多少二课分 / 志愿时长多少\n' +
  '· 今天有什么安排';

/* ============================ 对外入口 ============================ */

export function ask(raw: string): Reply {
  const q = (raw || '').trim();
  if (!q) return { text: '你还没输入内容。', intent: 'empty' };

  for (const r of ORDERED_RULES) {
    let hit = false;
    try {
      hit = r.test(q);
    } catch {
      hit = false;
    }
    if (!hit) continue;
    const out = r.run(q);
    if (out === null) continue;
    return { text: out, intent: r.key };
  }

  // 规则都没中 → 再试一次课程名（用户常常只打两个字）
  if (hasTimetable()) {
    const cs = findCourses(q);
    if (cs.length) return { text: courseInfo(cs, q), intent: 'course-name' };
  }

  return { text: FALLBACK, intent: 'fallback' };
}

/**
 * 落地页的快捷问法。
 * 只放 5 条 —— 竖列 7 条会把下面的「也能这样问」提示挤出屏幕，
 * 反而让人以为只能问这几个。多出来的能力用提示行带出来。
 */
export const QUICK_ASKS: Array<{ icon: string; text: string }> = [
  { icon: 'calendar', text: '下一节什么课' },
  { icon: 'calendar', text: '明天有几节课' },
  { icon: 'bookmark', text: '今天有什么安排' },
  { icon: 'award', text: '还差多少二课分' },
  { icon: 'sparkles', text: '你能做什么' }
];
