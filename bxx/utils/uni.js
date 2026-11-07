/**
 * 小鸮的「大脑」：本机规则引擎，不联网、不调用模型。
 *
 * 【为什么不是关键词模板】早期版本只判断"句子里有没有『课表』"，
 * 于是「我这周几节课」这种最自然的问法直接被兜底话术挡回去了。
 * 现在的做法是：先识别意图（查某天 / 查某周 / 查某门课 / 下一节 / 记事 / 学期），
 * 再拿真实的课表和记事去算，回答里带具体课程名、节次、教室和倒计时。
 *
 * 纯函数：时间、课表、设置、记事全部由调用方传入，便于单测和复现。
 */

const { SERVICES } = require('../data/services');
const { DAY_NAMES } = require('./constants');
const { calendarDayDiff, currentWeek, dateForDay, dateStamp, weekRange } = require('./date');
const { formatWeeks } = require('./weeks');

const WEEKDAY_DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const MAX_DAYS_AHEAD = 7;

function normalize(text) {
  return String(text || '').replace(/[\s，。！？、,.!?~～：:；;]/g, '');
}

function buildContext(raw) {
  const context = raw || {};
  const settings = context.settings || {};
  const now = context.now instanceof Date ? context.now : (context.now ? new Date(context.now) : new Date());
  const startMonday = settings.semesterStartMonday || '';
  const totalWeeks = Number(settings.totalWeeks) || 18;
  const week = startMonday
    ? currentWeek(startMonday, totalWeeks, now)
    : Math.min(Math.max(Number(context.week) || 1, 1), totalWeeks);
  return {
    now,
    settings,
    startMonday,
    totalWeeks,
    week,
    periodTimes: settings.periodTimes || [],
    courses: Array.isArray(context.courses) ? context.courses : [],
    notes: Array.isArray(context.notes) ? context.notes : []
  };
}

function startOf(periodTimes, period, date) {
  const item = (periodTimes || []).find((entry) => Number(entry.period) === Number(period));
  if (!item || !/^\d{1,2}:\d{2}$/.test(String(item.start))) return null;
  const parts = String(item.start).split(':').map(Number);
  const value = new Date(date);
  value.setHours(parts[0], parts[1], 0, 0);
  return value;
}

function timeRange(course, periodTimes) {
  const first = (periodTimes || []).find((entry) => Number(entry.period) === Number(course.startPeriod));
  const last = (periodTimes || []).find((entry) => Number(entry.period) === Number(course.endPeriod));
  return first && last ? `${first.start}–${last.end}` : '';
}

function blockText(course, periodTimes) {
  const parts = [`第 ${course.startPeriod}–${course.endPeriod} 节`];
  const range = timeRange(course, periodTimes);
  if (range) parts.push(range);
  if (course.room) parts.push(course.room);
  return parts.join(' · ');
}

function coursesOn(courses, week, day) {
  return courses
    .filter((course) => Number(course.day) === Number(day)
      && Array.isArray(course.weeks)
      && course.weeks.indexOf(week) >= 0)
    .sort((left, right) => Number(left.startPeriod) - Number(right.startPeriod));
}

function weekBlocks(ctx, week) {
  return ctx.courses.filter((course) => Array.isArray(course.weeks) && course.weeks.indexOf(week) >= 0);
}

/* ============================ 各类回答 ============================ */

function helpText() {
  return [
    '我直接读你导入的课表来回答，不联网也不编造。可以这样问：',
    '· 我这周几节课',
    '· 今天 / 明天 / 周三有什么课',
    '· 下节课在哪上',
    '· 高等数学在哪上',
    '· 今天有什么待办'
  ].join('\n');
}

function greetingText(ctx) {
  const day = (ctx.now.getDay() + 6) % 7 + 1;
  const list = coursesOn(ctx.courses, ctx.week, day);
  const head = `你好，我是小鸮。现在是第 ${ctx.week} 周，今天${DAY_NAMES[day - 1]}。`;
  if (!ctx.courses.length) return `${head}\n还没有课表，去「课表」页导入 PDF 就能开始问课程安排了。`;
  return `${head}今天${list.length ? `有 ${list.length} 节课` : '没有课'}。可以问我「今天有什么课」「下节课在哪上」。`;
}

function weekText(week, ctx) {
  const blocks = weekBlocks(ctx, week);
  const range = ctx.startMonday ? `（${weekRange(ctx.startMonday, week)}）` : '';
  if (!blocks.length) return `第 ${week} 周${range}没有课。`;
  const names = Array.from(new Set(blocks.map((course) => course.name)));
  const lines = [`第 ${week} 周${range}共 ${blocks.length} 个时间段、${names.length} 门课：`];
  for (let day = 1; day <= 7; day += 1) {
    const list = coursesOn(ctx.courses, week, day);
    if (!list.length) continue;
    lines.push(`${DAY_NAMES[day - 1]}　${list.map((course) => `${course.name}（第${course.startPeriod}-${course.endPeriod}节）`).join('、')}`);
  }
  return lines.join('\n');
}

function dayText(target, ctx) {
  const label = `${target.date.getMonth() + 1}月${target.date.getDate()}日 ${DAY_NAMES[target.day - 1]}`;
  const list = coursesOn(ctx.courses, target.week, target.day);
  if (!list.length) {
    // 问今天/明天却空着时，顺手把下一节课递上去，别让人再追问一次
    const days = calendarDayDiff(ctx.now, target.date);
    return days >= 0 && days <= 1 ? `${label} 没有课。${nextText(ctx)}` : `${label} 没有课。`;
  }
  return `${label} 有 ${list.length} 节课：\n${list.map((course) => `${course.name}（${blockText(course, ctx.periodTimes)}）`).join('\n')}`;
}

function findNextCourse(ctx) {
  if (!ctx.startMonday) return null;
  for (let offset = 0; offset <= MAX_DAYS_AHEAD; offset += 1) {
    const date = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate() + offset);
    const week = currentWeek(ctx.startMonday, ctx.totalWeeks, date);
    const day = (date.getDay() + 6) % 7 + 1;
    const list = coursesOn(ctx.courses, week, day);
    for (let index = 0; index < list.length; index += 1) {
      const begin = startOf(ctx.periodTimes, list[index].startPeriod, date);
      if (begin && begin.getTime() > ctx.now.getTime()) return { course: list[index], date, begin };
    }
  }
  return null;
}

function nextText(ctx) {
  const found = findNextCourse(ctx);
  if (!found) return '接下来一周都没有课，先歇会儿。';
  const days = calendarDayDiff(ctx.now, found.begin);
  const countdown = days <= 0 ? '就在今天' : days === 1 ? '明天' : `${days} 天后`;
  return `下一节是《${found.course.name}》，${DAY_NAMES[found.course.day - 1]} ${blockText(found.course, ctx.periodTimes)}，${countdown}。`;
}

function courseText(group, ctx) {
  const lines = [`《${group.name}》`];
  group.blocks.slice(0, 4).forEach((course) => {
    const teacher = course.teacher ? ` · ${course.teacher}` : '';
    lines.push(`${DAY_NAMES[course.day - 1]} ${blockText(course, ctx.periodTimes)}${teacher}`);
  });
  const weeks = Array.from(new Set(group.blocks.reduce((all, course) => all.concat(course.weeks || []), [])))
    .sort((left, right) => left - right);
  if (weeks.length) lines.push(`周次：${formatWeeks(weeks)}`);
  return lines.join('\n');
}

function notesText(ctx) {
  const active = ctx.notes.filter((note) => !note.deletedAt);
  if (!active.length) return '还没有记事。在「记事」页选个日期就能加一条，比如「周五交高数作业」。';
  const today = dateStamp(ctx.now);
  const todayOpen = active.filter((note) => !note.done && note.date === today);
  const pending = active.filter((note) => !note.done);
  const parts = [
    todayOpen.length
      ? `今天有 ${todayOpen.length} 条待办：${todayOpen.map((note) => note.title).join('、')}。`
      : '今天没有待办。'
  ];
  // 只有存在"今天以外"的未完成时才补总量，否则会重复报同一个数字
  if (!pending.length) parts.push('所有记事都完成了。');
  else if (pending.length > todayOpen.length) parts.push(`全部未完成 ${pending.length} 条。`);
  if (pending.length > todayOpen.length) {
    const recent = pending.filter((note) => note.date !== today).slice(0, 3)
      .map((note) => `${note.date ? `${Number(note.date.slice(5, 7))}月${Number(note.date.slice(8, 10))}日` : '未定日期'} ${note.title}`);
    if (recent.length) parts.push(`另外还有：${recent.join('；')}。`);
  }
  return parts.join('');
}

function notesHelpText() {
  return '在「记事」页点某一天，再点下面的「＋ 在 X月X日 添加记事」，填标题和日期即可。记事按日期挂到日历上，有事的日期下面会出现蓝点。';
}

function campusText() {
  return `校园服务里有：${SERVICES.map((service) => service.name).join('、')}。在「校园」页点开入口，已经配好网址的会复制链接。`;
}

function termText(ctx) {
  const range = ctx.startMonday ? `（${weekRange(ctx.startMonday, ctx.week)}）` : '';
  const left = ctx.totalWeeks - ctx.week;
  return `现在是第 ${ctx.week} 周${range}，本学期共 ${ctx.totalWeeks} 周${left > 0 ? `，还剩 ${left} 周` : '，已经到学期末了'}。`;
}

function fallbackText() {
  return '这个问题我还答不上来。我只读本机的课表和记事，可以问我：本周几节课、今天有什么课、下一节课、某门课在哪上、今天有什么待办。换个说法试试？';
}

/* ============================ 意图识别 ============================ */

function matchCourse(input, courses) {
  const names = Array.from(new Set(courses.map((course) => String(course.name || '')))).filter(Boolean);
  names.sort((left, right) => right.length - left.length);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    if (input.indexOf(normalize(name)) >= 0) {
      return { name, blocks: courses.filter((course) => course.name === name) };
    }
  }
  return null;
}

function resolveDay(input, ctx) {
  const offsetMatch = /(今天|今日|明天|明日|后天)/.exec(input);
  if (offsetMatch) {
    const word = offsetMatch[1];
    const offset = word.indexOf('后') >= 0 ? 2 : word.indexOf('明') >= 0 ? 1 : 0;
    const date = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate() + offset);
    const week = ctx.startMonday ? currentWeek(ctx.startMonday, ctx.totalWeeks, date) : ctx.week;
    return { date, week, day: (date.getDay() + 6) % 7 + 1 };
  }

  const match = /(?:周|星期|礼拜)([一二三四五六日天1-7])/.exec(input);
  if (!match) return null;
  const day = WEEKDAY_DIGITS[match[1]] || Number(match[1]);
  if (!day) return null;

  // 「下周三」要落到下一周，否则会答成已经过去的那个周三
  let week = ctx.week;
  if (/下周/.test(input)) week = Math.min(ctx.week + 1, ctx.totalWeeks);
  else if (/上周/.test(input)) week = Math.max(ctx.week - 1, 1);

  const date = ctx.startMonday
    ? dateForDay(ctx.startMonday, week, day - 1)
    : new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate() + (day - ((ctx.now.getDay() + 6) % 7 + 1)));
  return { date, week, day };
}

function resolveWeek(input, ctx) {
  const numbered = /第\s*(\d+)\s*周/.exec(input);
  if (numbered) {
    const value = Number(numbered[1]);
    return value >= 1 && value <= ctx.totalWeeks ? value : null;
  }
  if (/下周/.test(input)) return Math.min(ctx.week + 1, ctx.totalWeeks);
  if (/上周/.test(input)) return Math.max(ctx.week - 1, 1);
  if (/(这周|本周|这个星期|这星期)/.test(input)) return ctx.week;
  return null;
}

/**
 * @param {string} text 用户输入
 * @param {{now?:Date, settings?:object, courses?:Array, notes?:Array, week?:number}} context
 * @returns {string} 回答文本
 */
function answer(text, context) {
  const input = normalize(text);
  const ctx = buildContext(context);
  if (!input) return '想问我什么？比如「今天有什么课」「下节课几点」。';

  if (/^(你好|您好|hi|hello|在吗|嗨)/i.test(input)) return greetingText(ctx);

  // 记事要先判：「记事怎么用」不该被当成使用帮助
  if (/(记事|待办|任务|作业)/.test(input)) {
    if (/(怎么|如何|在哪|哪里)/.test(input)) return notesHelpText();
    return notesText(ctx);
  }

  if (/(下一?节|下节|接下来.{0,4}课|还有多久.{0,4}课|快上课)/.test(input)) return nextText(ctx);

  if (/(能做什么|会做什么|有什么功能|怎么用你|你是谁|帮助|使用说明)/.test(input)) return helpText();

  if (/(校园服务|有哪些服务|服务入口|图书馆|信息门户|北化在线|健康云|校园网)/.test(input)) return campusText();

  if (/(第几周|几周了|开学|学期|放假|还剩.{0,3}周)/.test(input)) return termText(ctx);

  const group = matchCourse(input, ctx.courses);
  if (group) return courseText(group, ctx);

  const target = resolveDay(input, ctx);
  if (target && /课/.test(input)) return dayText(target, ctx);

  const week = resolveWeek(input, ctx);
  if (week && /(课|上什么|安排)/.test(input)) return weekText(week, ctx);

  if (/课/.test(input)) return weekText(ctx.week, ctx);

  return fallbackText();
}

module.exports = { answer, campusText, helpText, notesText, weekText };
