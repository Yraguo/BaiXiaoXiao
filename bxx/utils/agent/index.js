/**
 * 小鸮 Agent 运行时。
 *
 * 结构参考了 GitHub 上的 miniAi（工具注册表 + 记忆）与 smart-school
 * （意图识别 → 简单问题走 workflow、复杂问题才上 agent）：
 *
 *   NLU 抽槽 → 选工具 → 缺槽就反问 → 执行 → 记忆
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
  const day = nlu.weekdayOf(date);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${DAY_NAMES[day - 1]}`;
}

function coursesOn(courses, week, day) {
  return courses
    .filter((course) => Number(course.day) === Number(day)
      && Array.isArray(course.weeks)
      && course.weeks.indexOf(week) >= 0)
    .sort((left, right) => Number(left.startPeriod) - Number(right.startPeriod));
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
    '· 今天 / 明天 / 周三有什么课',
    '· 下节课在哪上',
    '· 高数在哪上（简称也能认）',
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

function weekText(week, ctx) {
  const blocks = ctx.courses.filter((course) => Array.isArray(course.weeks) && course.weeks.indexOf(week) >= 0);
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

function dayText(slot, ctx) {
  const label = dayLabel(slot.date);
  const list = coursesOn(ctx.courses, slot.week, slot.day);
  if (!list.length) {
    // 问今天/明天却空着时，顺手把下一节课递上去，别让人再追问一次
    const diff = calendarDayDiff(ctx.now, slot.date);
    return diff >= 0 && diff <= 1 ? `${label} 没有课。${nextText(ctx)}` : `${label} 没有课。`;
  }
  return `${label} 有 ${list.length} 节课：\n${list.map((course) => `${course.name}（${blockText(course, ctx.periodTimes)}）`).join('\n')}`;
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

const TOOLS = [
  {
    name: 'greeting',
    test: (input) => /^(你好|您好|hi|hello|在吗|嗨)/.test(input),
    run: (slots, ctx) => greetingText(ctx)
  },
  {
    name: 'help',
    test: (input) => /(能做什么|会做什么|有什么功能|你是谁|帮助|使用说明|怎么用你)/.test(input),
    run: () => helpText()
  },
  {
    name: 'import_guide',
    test: (input) => /(导入|导出|pdf|怎么加课表|课表来源|导不进)/.test(input) && !/(记事|待办)/.test(input),
    run: () => importText()
  },
  {
    name: 'privacy',
    test: (input) => /(隐私|上传|泄露|联网|数据.*(哪|安全))/.test(input),
    run: () => privacyText()
  },
  {
    name: 'create_note',
    test: (input, ctx, slots) => Boolean(slots.note),
    run: (slots, ctx) => createNote(slots.note, ctx)
  },
  {
    name: 'notes_query',
    test: (input) => /(记事|待办|任务|作业)/.test(input),
    run: (slots, ctx, input) => (/(怎么|如何|在哪|哪里)/.test(input) ? notesHelpText() : notesText(ctx))
  },
  {
    name: 'next_class',
    test: (input) => /(下一?节|下节|接下来.{0,4}课|还有多久.{0,4}课|快上课)/.test(input),
    run: (slots, ctx) => nextText(ctx)
  },
  {
    name: 'course_info',
    // 弱匹配（两个字简称）必须带"在哪上/老师/几周"这类意图词，否则"数据还在吗"会被当成《数据结构》
    test: (input, ctx, slots) => Boolean(slots.course.name)
      && (slots.course.strict || /(在哪|哪里|教室|老师|谁教|几周|上到|哪天|什么时候|什么课|有课)/.test(input)),
    run: (slots, ctx) => courseText(slots.course.name, ctx)
  },
  {
    name: 'day_schedule',
    test: (input, ctx, slots) => Boolean(slots.date) && /(课|安排|上什么)/.test(input),
    run: (slots, ctx) => dayText(slots.date, ctx)
  },
  {
    name: 'week_schedule',
    test: (input, ctx, slots) => slots.week !== null && /(课|安排|上什么)/.test(input),
    run: (slots, ctx) => weekText(slots.week, ctx)
  },
  {
    name: 'term_info',
    test: (input) => /(第几周|几周了|开学|学期|放假|还剩.{0,3}周)/.test(input),
    run: (slots, ctx) => termText(ctx)
  },
  {
    name: 'campus',
    test: (input) => /(校园服务|有哪些服务|服务入口|图书馆|信息门户|北化在线|健康云|校园网)/.test(input),
    run: () => campusText()
  }
];

function toolByName(name) {
  return TOOLS.find((tool) => tool.name === name) || null;
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
    memory: { lastTool: '', lastSlots: null, pending },
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
  let action = null;
  if (payload.action) action = payload.action;

  const memory = {
    lastTool: tool.name,
    lastSlots: {
      date: slots.date ? dateStamp(slots.date.date) : '',
      week: slots.week,
      course: slots.course && slots.course.name ? slots.course.name : ''
    },
    pending: null
  };

  const result = { text: payload.text, memory };
  if (action) result.action = action;
  return result;
}

/**
 * @param {string} text 用户这一句话
 * @param {object} context { now, settings, courses, notes }
 * @param {object} memory 上一轮返回的 memory，用于追问和多轮澄清
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
    note: nlu.extractNote(input, ctx)
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

  // 3. 正常选工具
  for (let index = 0; index < TOOLS.length; index += 1) {
    const tool = TOOLS[index];
    if (!tool.test(input, ctx, slots)) continue;
    // 没给课程名却在问"在哪上"，先反问而不是瞎猜
    if (tool.name === 'course_info' && !slots.course.name) continue;
    if (tool.name === 'create_note' && !String(slots.note.title || '').trim()) {
      return clarify('要记什么？直接说内容就行，比如「周五交实验报告」。', { tool: 'create_note' }, state);
    }
    return run(tool, slots, ctx, Object.assign({}, state, { input }));
  }

  // 4. 问"在哪上/谁教"但没带课名 → 反问
  if (/(在哪|哪里上|教室|老师|谁教|几周|上到)/.test(input)) {
    return clarify('你问的是哪门课？说个课程名就行，比如「高数在哪上」。', { tool: 'course_info' }, state);
  }

  // 5. 只说了"课表"没带时间 → 默认给本周
  if (/课/.test(input)) {
    return run(toolByName('week_schedule'), Object.assign({}, slots, { week: ctx.week }), ctx, state);
  }

  // 6. FAQ 向量检索兜底
  const hit = faq.lookup(input);
  if (hit.answer) return { text: hit.answer, memory: { lastTool: '', lastSlots: null, pending: null } };

  return {
    text: '这个问题我还答不上来。我只读本机的课表和记事，可以问我：本周几节课、今天有什么课、下一节课、某门课在哪上、记一下作业、今天有什么待办。',
    memory: { lastTool: '', lastSlots: null, pending: null }
  };
}

module.exports = { ask, buildContext, helpText, TOOLS };
