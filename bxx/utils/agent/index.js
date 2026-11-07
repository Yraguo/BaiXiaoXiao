/**
 * 小鸮 Agent 运行时。
 *
 * 结构参考了 GitHub 上的 miniAi（工具注册表 + 记忆）与 smart-school
 * （意图识别 → 简单问题走 workflow、复杂问题才上 agent）：
 *
 *   NLU 抽槽 → 意图打分 → 选工具 → 缺槽反问 → 执行 → 记忆
 *
 * 全部本地跑：不联网、不调模型。能用确定性代码算出来的，绝不编。
 */

const { SERVICES } = require('../../data/services');
const { DAY_NAMES } = require('../constants');
const { calendarDayDiff, currentWeek, dateStamp, weekRange } = require('../date');
const { formatWeeks } = require('../weeks');
const nlu = require('./nlu');
const faq = require('./faq');

/* ============================ 上下文 ============================ */

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

/* ============================ 文本片段 ============================ */

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

function dayLabel(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日 ${DAY_NAMES[nlu.weekdayOf(date) - 1]}`;
}

function coursesOn(courses, week, day) {
  return courses
    .filter((course) => Number(course.day) === Number(day)
      && Array.isArray(course.weeks)
      && course.weeks.indexOf(week) >= 0)
    .sort((left, right) => Number(left.startPeriod) - Number(right.startPeriod));
}

/** 时段过滤：粗粒度按开始时间落在哪个区间，精确模式按节次区间求交 */
function withinPeriod(course, period, periodTimes) {
  if (!period) return true;
  if (period.kind === 'periods') {
    return Number(course.startPeriod) <= period.to && Number(course.endPeriod) >= period.from;
  }
  const first = (periodTimes || []).find((entry) => Number(entry.period) === Number(course.startPeriod));
  if (!first) return true;
  const parts = String(first.start).split(':').map(Number);
  const minutes = parts[0] * 60 + (parts[1] || 0);
  return minutes >= period.from && minutes < period.to;
}

/* ============================ 各工具的产出 ============================ */

function greetingText(ctx) {
  const day = nlu.weekdayOf(ctx.now);
  const list = coursesOn(ctx.courses, ctx.week, day);
  const head = `你好，我是小鸮。现在是第 ${ctx.week} 周，今天${DAY_NAMES[day - 1]}。`;
  if (!ctx.courses.length) return `${head}\n还没有课表，去「课表」页导入 PDF 就能开始问课程安排了。`;
  return `${head}今天${list.length ? `有 ${list.length} 节课` : '没有课'}。可以问我「今天有什么课」，或者直接说「记一下 周五交实验报告」。`;
}

function helpText() {
  return [
    '我直接读你导入的课表来回答，不联网也不编造。可以这样问：',
    '· 我这周几节课',
    '· 今天 / 明天 / 周三下午有什么课',
    '· 这周下午有几节课',
    '· 这周哪天没课',
    '· 今天还剩几节课',
    '· 下节课在哪上',
    '· 高数在哪上（简称、错别字也能认）',
    '· 记一下 周五交实验报告',
    '· 今天有什么待办'
  ].join('\n');
}

function importText() {
  return '课表页 →「导入课表」→ 默认就是 PDF 导入 →「选择 PDF 并导入」。\n导出的办法：电脑浏览器进教务「信息查询 → 学生课表查询」，选好学年学期点「输出 PDF」，把文件发给「文件传输助手」，再回小程序选它。全程本机解析，不联网。';
}

function privacyText() {
  return '课表、记事、头像昵称都只存在微信本地缓存；PDF 只在本机内存里解析；小鸮也只是读本地数据算答案。整个小程序没有后端请求，也不会把学号密码或课表发给任何第三方。';
}

function weekText(week, ctx, period) {
  const all = ctx.courses.filter((course) => Array.isArray(course.weeks) && course.weeks.indexOf(week) >= 0);
  const blocks = period ? all.filter((course) => withinPeriod(course, period, ctx.periodTimes)) : all;
  const range = ctx.startMonday ? `（${weekRange(ctx.startMonday, week)}）` : '';
  const scope = period ? period.label : '';
  if (!blocks.length) return `第 ${week} 周${range}${scope}没有课。`;
  const names = Array.from(new Set(blocks.map((course) => course.name)));
  const lines = [`第 ${week} 周${range}${scope}共 ${blocks.length} 个时间段、${names.length} 门课：`];
  for (let day = 1; day <= 7; day += 1) {
    const list = coursesOn(ctx.courses, week, day)
      .filter((course) => withinPeriod(course, period, ctx.periodTimes));
    if (!list.length) continue;
    lines.push(`${DAY_NAMES[day - 1]}　${list.map((course) => `${course.name}（第${course.startPeriod}-${course.endPeriod}节）`).join('、')}`);
  }
  return lines.join('\n');
}

/** 这周哪几天没课 —— 找空档是最常见的真实需求 */
function freeDaysText(ctx) {
  if (!ctx.courses.length) return '还没有课表，导入之后我才能算哪天没课。';
  const free = [];
  for (let day = 1; day <= 7; day += 1) {
    if (!coursesOn(ctx.courses, ctx.week, day).length) free.push(DAY_NAMES[day - 1]);
  }
  if (!free.length) return `第 ${ctx.week} 周每天都有课，没有空档。`;
  if (free.length === 7) return `第 ${ctx.week} 周整周都没课。`;
  return `第 ${ctx.week} 周没课的日子：${free.join('、')}。其余 ${7 - free.length} 天有课。`;
}

/** 今天还剩几节 —— 按当前时间过滤已经开始的课 */
function remainingText(ctx) {
  const day = nlu.weekdayOf(ctx.now);
  const list = coursesOn(ctx.courses, ctx.week, day);
  if (!list.length) return `今天（${DAY_NAMES[day - 1]}）没有课。`;

  const minutes = ctx.now.getHours() * 60 + ctx.now.getMinutes();
  const left = list.filter((course) => {
    const period = (ctx.periodTimes || []).find((entry) => Number(entry.period) === Number(course.startPeriod));
    if (!period) return false;
    const parts = String(period.start).split(':').map(Number);
    return parts[0] * 60 + (parts[1] || 0) > minutes;
  });

  if (!left.length) return `今天的课上完了，一共 ${list.length} 节。`;
  return `今天还有 ${left.length} 节课：${left.map((course) => `${course.name}（${blockText(course, ctx.periodTimes)}）`).join('、')}。`;
}

function dayText(slot, ctx, period) {
  const label = dayLabel(slot.date);
  const all = coursesOn(ctx.courses, slot.week, slot.day);
  const list = period ? all.filter((course) => withinPeriod(course, period, ctx.periodTimes)) : all;
  const scope = period ? ` ${period.label}` : '';

  if (!list.length) {
    if (all.length && period) return `${label}${scope}没有课，其他时段还有 ${all.length} 节。`;
    // 问今天/明天却空着时，顺手把下一节课递上去，别让人再追问一次
    const diff = calendarDayDiff(ctx.now, slot.date);
    return diff >= 0 && diff <= 1 ? `${label} 没有课。${nextText(ctx)}` : `${label} 没有课。`;
  }
  return `${label}${scope}有 ${list.length} 节课：\n${list.map((course) => `${course.name}（${blockText(course, ctx.periodTimes)}）`).join('\n')}`;
}

function findNextCourse(ctx) {
  if (!ctx.startMonday) return null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate() + offset);
    const week = currentWeek(ctx.startMonday, ctx.totalWeeks, date);
    const day = nlu.weekdayOf(date);
    const list = coursesOn(ctx.courses, week, day);
    for (let index = 0; index < list.length; index += 1) {
      const period = (ctx.periodTimes || []).find((entry) => Number(entry.period) === Number(list[index].startPeriod));
      if (!period) continue;
      const begin = new Date(date);
      const parts = String(period.start).split(':').map(Number);
      begin.setHours(parts[0], parts[1], 0, 0);
      if (begin.getTime() > ctx.now.getTime()) return { course: list[index], date, begin };
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

function courseText(name, ctx) {
  const blocks = ctx.courses.filter((course) => course.name === name);
  const lines = [`《${name}》`];
  blocks.slice(0, 4).forEach((course) => {
    const teacher = course.teacher ? ` · ${course.teacher}` : '';
    lines.push(`${DAY_NAMES[course.day - 1]} ${blockText(course, ctx.periodTimes)}${teacher}`);
  });
  const weeks = Array.from(new Set(blocks.reduce((all, course) => all.concat(course.weeks || []), [])))
    .sort((left, right) => left - right);
  if (weeks.length) lines.push(`周次：${formatWeeks(weeks)}`);
  return lines.join('\n');
}

function notesText(ctx) {
  const active = ctx.notes.filter((note) => !note.deletedAt);
  if (!active.length) return '还没有记事。在「记事」页选个日期就能加一条，也可以直接跟我说「记一下 周五交高数作业」。';
  const today = dateStamp(ctx.now);
  const todayOpen = active.filter((note) => !note.done && note.date === today);
  const pending = active.filter((note) => !note.done);
  const parts = [
    todayOpen.length
      ? `今天有 ${todayOpen.length} 条待办：${todayOpen.map((note) => note.title).join('、')}。`
      : '今天没有待办。'
  ];
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
  return '在「记事」页点某一天，再点下面的「＋ 在 X月X日 添加记事」，填标题和日期即可。也可以直接跟我说「记一下 周五交实验报告」，我会替你落到那一天。';
}

function termText(ctx) {
  const range = ctx.startMonday ? `（${weekRange(ctx.startMonday, ctx.week)}）` : '';
  const left = ctx.totalWeeks - ctx.week;
  return `现在是第 ${ctx.week} 周${range}，本学期共 ${ctx.totalWeeks} 周${left > 0 ? `，还剩 ${left} 周` : '，已经到学期末了'}。`;
}

function campusText() {
  return `校园服务里有：${SERVICES.map((service) => service.name).join('、')}。在「校园」页点开入口，已经配好网址的会复制链接。`;
}

/* ============================ 工具表 ============================ */

/**
 * 每个工具：cues（触发词 + 权重）、guard（前置条件）、run。
 * 选工具不再靠"谁先写在前面"，而是累加命中权重取最高 —— 顺序无关，
 * 权重可以按误判调，比一堆 if 好维护。
 * priority 只用于同分时让更具体的工具胜出（记事 > 课表）。
 */
const TOOLS = [
  {
    name: 'greeting',
    priority: 120,
    cues: [[/^(你好|您好|hi|hello|在吗|嗨)/, 5]],
    run: (slots, ctx) => greetingText(ctx)
  },
  {
    name: 'help',
    priority: 110,
    cues: [[/(能做什么|会做什么|有什么功能|你是谁|帮助|使用说明|怎么用你)/, 4]],
    run: () => helpText()
  },
  {
    name: 'privacy',
    priority: 105,
    cues: [[/(隐私|上传|泄露|联网)/, 4], [/数据.{0,6}(安全|哪|服务器)/, 3]],
    run: () => privacyText()
  },
  {
    name: 'import_guide',
    priority: 100,
    cues: [[/(导入|导出|pdf|导不进)/i, 4], [/(怎么加课表|课表来源)/, 3]],
    run: () => importText()
  },
  {
    name: 'create_note',
    priority: 95,
    guard: (input, ctx, slots) => Boolean(slots.note),
    cues: [[/./, 6]],
    run: (slots, ctx) => createNote(slots.note, ctx)
  },
  {
    name: 'notes_query',
    priority: 90,
    cues: [[/(记事|待办|任务|作业)/, 5]],
    run: (slots, ctx, input) => (/(怎么|如何|在哪|哪里)/.test(input) ? notesHelpText() : notesText(ctx))
  },
  {
    name: 'next_class',
    priority: 85,
    cues: [[/(下一?节|下节)/, 5], [/(接下来|还有多久|快上课)/, 3]],
    run: (slots, ctx) => nextText(ctx)
  },
  {
    name: 'course_info',
    priority: 80,
    // 弱匹配（两个字简称）必须带"在哪上/老师/几周"这类意图词，否则"数据还在吗"会被当成《数据结构》
    guard: (input, ctx, slots) => Boolean(slots.course.name)
      && (slots.course.strict || /(在哪|哪里|教室|老师|谁教|几周|上到|哪天|什么时候|什么课|有课)/.test(input)),
    cues: [[/./, 3], [/(在哪|哪里|教室|老师|谁教|几周|上到|哪天|什么时候)/, 2]],
    run: (slots, ctx) => courseText(slots.course.name, ctx)
  },
  {
    name: 'day_schedule',
    priority: 75,
    guard: (input, ctx, slots) => Boolean(slots.date) && /(课|安排|上什么)/.test(input),
    cues: [[/./, 3], [/(今天|明天|后天|大后天|周|星期|礼拜)/, 2], [/(课|安排|上什么)/, 2]],
    run: (slots, ctx) => dayText(slots.date, ctx, slots.period)
  },
  {
    name: 'week_schedule',
    priority: 70,
    guard: (input, ctx, slots) => slots.week !== null && /(课|安排|上什么)/.test(input),
    cues: [[/./, 3], [/(第.{1,3}周|这周|本周|下周|上周)/, 2], [/(课|安排|上什么)/, 2]],
    run: (slots, ctx) => weekText(slots.week, ctx, slots.period)
  },
  {
    name: 'remaining_today',
    priority: 88,
    guard: (input, ctx, slots) => !slots.week && /(今天|现在|待会|一会)/.test(input),
    cues: [[/(还有|还剩|剩下)/, 4], [/(几节|多少节课|几节课)/, 3]],
    run: (slots, ctx) => remainingText(ctx)
  },
  {
    name: 'free_days',
    priority: 78,
    cues: [[/(哪天|哪几天|哪些天)/, 3], [/(没课|空档|休息)/, 4]],
    run: (slots, ctx) => freeDaysText(ctx)
  },
  {
    name: 'term_info',
    priority: 65,
    cues: [[/(第几周|几周了|开学|学期|放假)/, 4], [/还剩.{0,3}周/, 3]],
    run: (slots, ctx) => termText(ctx)
  },
  {
    name: 'campus',
    priority: 60,
    cues: [[/(校园服务|有哪些服务|服务入口|图书馆|信息门户|北化在线|健康云|校园网)/, 4]],
    run: () => campusText()
  }
];

function toolByName(name) {
  return TOOLS.find((tool) => tool.name === name) || null;
}

function scoreTool(tool, input, ctx, slots) {
  if (tool.guard && !tool.guard(input, ctx, slots)) return 0;
  return tool.cues.reduce((sum, cue) => sum + (cue[0].test(input) ? cue[1] : 0), 0);
}

function pickTool(input, ctx, slots) {
  let best = null;
  TOOLS.forEach((tool) => {
    const score = scoreTool(tool, input, ctx, slots);
    if (score <= 0) return;
    if (!best || score > best.score || (score === best.score && tool.priority > best.tool.priority)) {
      best = { tool, score };
    }
  });
  return best && best.score >= 2 ? best.tool : null;
}

/* ============================ 动作（写数据由页面执行） ============================ */

function createNote(slot, ctx) {
  const title = String((slot && slot.title) || '').trim();
  const date = (slot && slot.date && slot.date.date) || ctx.now;
  const note = {
    id: `note-${ctx.now.getTime()}`,
    title,
    content: '',
    date: dateStamp(date),
    remindAt: '',
    done: false,
    createdAt: new Date(ctx.now.getTime()).toISOString(),
    updatedAt: new Date(ctx.now.getTime()).toISOString(),
    deletedAt: null
  };
  return {
    text: `记好了：${title}（${dayLabel(date)}）。`,
    action: { type: 'createNote', note }
  };
}

/* ============================ 运行时 ============================ */

function normalizeMemory(memory) {
  const state = memory || {};
  return {
    lastTool: state.lastTool || '',
    lastSlots: state.lastSlots || null,
    pending: state.pending || null
  };
}

function clarify(question, pending, state) {
  return {
    text: question,
    memory: { lastTool: '', lastSlots: state.lastSlots || null, pending },
    suggestions: pending && pending.options ? pending.options : []
  };
}

/** 上一轮在等槽位（"哪门课？"/"要记什么？"），这一轮把答案接上 */
function resume(pending, input, ctx, state, slots) {
  const tool = toolByName(pending.tool);
  if (!tool) return null;

  if (pending.tool === 'course_info') {
    const found = nlu.matchCourses(input, ctx.courses);
    if (!found.name) return clarify('你问的是哪门课？说个课程名就行，比如「高等数学」。', pending, state);
    if (found.others.length) {
      return clarify(
        `我这儿有两门像的：${[found.name].concat(found.others).map((name) => `《${name}》`).join(' 和 ')}，你说的是哪一门？`,
        { tool: 'course_info' },
        state
      );
    }
    return run(tool, Object.assign({}, slots, { course: found }), ctx, state);
  }

  if (pending.tool === 'create_note') {
    const title = String(input).trim();
    if (!title) return clarify('要记什么？直接说内容就行，比如「周五交实验报告」。', pending, state);
    return run(tool, Object.assign({}, slots, { note: { title, date: nlu.extractDate(input, ctx) } }), ctx, state);
  }

  return null;
}

function run(tool, slots, ctx, state) {
  const output = tool.run(slots, ctx, state.input || '');
  const payload = typeof output === 'string' ? { text: output } : output;

  const memory = {
    lastTool: tool.name,
    lastSlots: {
      date: slots.date ? dateStamp(slots.date.date) : '',
      week: slots.week,
      course: slots.course && slots.course.name ? slots.course.name : '',
      period: slots.period ? slots.period.label : ''
    },
    pending: null
  };

  const result = { text: payload.text, memory };
  if (payload.action) result.action = payload.action;
  return result;
}

/**
 * @param {string} text 用户这一句话
 * @param {object} context { now, settings, courses, notes }
 * @param {object} memory 上一轮返回的 memory，用于追问、指代和多轮澄清
 * @returns {{text:string, memory:object, action?:object, suggestions?:Array<string>}}
 */
function ask(text, context, memory) {
  const ctx = buildContext(context);
  const state = normalizeMemory(memory);
  const input = nlu.normalize(text);
  state.input = input;
  if (!input) return { text: '想问我什么？比如「今天有什么课」「下节课几点」。', memory: state };

  const slots = {
    date: nlu.extractDate(input, ctx),
    week: nlu.extractWeek(input, ctx),
    course: nlu.matchCourses(input, ctx.courses),
    note: nlu.extractNote(input, ctx),
    period: nlu.extractPeriod(input)
  };

  // 1. 先把上一轮的澄清接上
  if (state.pending) {
    const handled = resume(state.pending, input, ctx, state, slots);
    if (handled) return handled;
  }

  // 2. 追问：整句只剩一个时间（"那周三呢""明天呢"）→ 按"查那天的课"接上
  const bare = input.replace(/(那|呢|啊|吧|的话)/g, '');
  if (slots.date && state.lastTool !== 'create_note' && bare.length <= 6 && !/(课|老师|教室|几周|上到|记|哪门)/.test(bare)) {
    return run(toolByName('day_schedule'), slots, ctx, Object.assign({}, state, { input }));
  }

  // 3. 指代："它/这门课/那门课"沿用上一轮问过的课程
  if (/^(它|这门课|那门课|这个课|该课)/.test(input) && state.lastSlots && state.lastSlots.course) {
    return run(
      toolByName('course_info'),
      Object.assign({}, slots, { course: { name: state.lastSlots.course, others: [], strict: true } }),
      ctx,
      state
    );
  }

  // 4. 打分选工具
  const tool = pickTool(input, ctx, slots);
  if (tool) {
    if (tool.name === 'create_note' && !String(slots.note.title || '').trim()) {
      return clarify('要记什么？直接说内容就行，比如「周五交实验报告」。', { tool: 'create_note' }, state);
    }
    return run(tool, slots, ctx, state);
  }

  // 5. 问"在哪上/谁教"但没带课名 → 反问
  if (/(在哪|哪里上|教室|老师|谁教|几周|上到)/.test(input)) {
    return clarify('你问的是哪门课？说个课程名就行，比如「高数在哪上」。', { tool: 'course_info' }, state);
  }

  // 6. "为什么课表是空的"这种疑问句先让 FAQ 试一次，命中就答，不命中再给本周课表
  if (/(为什么|怎么回事|不对|失败|空了|少课|查不到|没有课)/.test(input)) {
    const doubt = faq.lookup(input);
    if (doubt.answer) return { text: doubt.answer, memory: { lastTool: '', lastSlots: null, pending: null } };
  }

  // 7. 只说了"课表"没带时间 → 默认给本周
  if (/课/.test(input)) {
    return run(toolByName('week_schedule'), Object.assign({}, slots, { week: ctx.week }), ctx, state);
  }

  // 8. FAQ 向量检索兜底
  const hit = faq.lookup(input);
  if (hit.answer) return { text: hit.answer, memory: { lastTool: '', lastSlots: null, pending: null } };

  return {
    text: '这个问题我还答不上来。我只读本机的课表和记事，可以问我：本周几节课、今天有什么课、周三下午有课吗、下一节课、某门课在哪上、记一下作业、今天有什么待办。',
    // 页面据此换成"疑惑"的吉祥物头像，比统一的默认脸更贴合语境
    tone: 'confused',
    memory: { lastTool: '', lastSlots: null, pending: null }
  };
}

/**
 * 调试用：把这句话在各个工具上的得分打出来，方便调权重。
 * 用法：node -e "console.log(require('./utils/agent/index.js').explain('周三下午有课吗', {...}))"
 */
function explain(text, context) {
  const ctx = buildContext(context);
  const input = nlu.normalize(text);
  const slots = {
    date: nlu.extractDate(input, ctx),
    week: nlu.extractWeek(input, ctx),
    course: nlu.matchCourses(input, ctx.courses),
    note: nlu.extractNote(input, ctx),
    period: nlu.extractPeriod(input)
  };
  return TOOLS
    .map((tool) => ({ name: tool.name, score: scoreTool(tool, input, ctx, slots) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
}

module.exports = { ask, buildContext, explain, helpText, TOOLS };
