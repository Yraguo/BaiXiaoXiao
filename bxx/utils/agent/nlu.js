/**
 * 轻量 NLU：归一化、槽位抽取、模糊匹配。
 *
 * 思路来自 GitHub 上几个校园问答机器人（意图分类 + 实体抽取 + 拼写纠错），
 * 但把神经网络换成了可解释、零依赖的规则与编辑距离 —— 小程序里跑得动，
 * 出错时也能一眼看出是哪条规则没命中。
 */

const { currentWeek, dateForDay } = require('../date');

const WEEKDAY_DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

function normalize(text) {
  return String(text || '')
    .replace(/[\s，。！？、,.!?~～：:；;""''（）()【】\[\]《》]/g, '')
    .toLowerCase();
}

function weekdayOf(date) {
  return (date.getDay() + 6) % 7 + 1;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * 日期槽位。
 * 「周五」这类说法默认取**最近的一次**：今天周六问周五，答案应该是下周五而不是昨天。
 * 显式说了"本周/这周"才落到本周。
 */
function extractDate(input, ctx) {
  const now = ctx.now;

  const offset = /大后天/.test(input) ? 3
    : /后天/.test(input) ? 2
      : /(明天|明日)/.test(input) ? 1
        : /(今天|今日)/.test(input) ? 0
          : null;
  if (offset !== null) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    return {
      date,
      day: weekdayOf(date),
      week: ctx.startMonday ? currentWeek(ctx.startMonday, ctx.totalWeeks, date) : ctx.week,
      offset
    };
  }

  const match = /(?:周|星期|礼拜)([一二三四五六日天1-7])/.exec(input);
  if (!match) return null;
  const day = WEEKDAY_DIGITS[match[1]] || Number(match[1]);
  if (!day) return null;

  const today = weekdayOf(now);
  let week = ctx.week;
  if (/下周/.test(input)) week += 1;
  else if (/上周/.test(input)) week -= 1;
  else if (!/(这周|本周|这个星期|这星期)/.test(input) && day < today) week += 1;
  week = clamp(week, 1, ctx.totalWeeks);

  if (ctx.startMonday) {
    return { date: dateForDay(ctx.startMonday, week, day - 1), day, week };
  }
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (day - today));
  return { date, day, week };
}

function extractWeek(input, ctx) {
  const numbered = /第\s*(\d+)\s*周/.exec(input);
  if (numbered) {
    const value = Number(numbered[1]);
    return value >= 1 && value <= ctx.totalWeeks ? value : null;
  }
  if (/下周/.test(input)) return clamp(ctx.week + 1, 1, ctx.totalWeeks);
  if (/上周/.test(input)) return clamp(ctx.week - 1, 1, ctx.totalWeeks);
  if (/(这周|本周|这个星期|这星期)/.test(input)) return ctx.week;
  return null;
}

/** "记一下 周五交实验报告" → { title: '周五交实验报告', date: ... } */
function extractNote(input, ctx) {
  const prefix = /^(帮我|给我|请|麻烦)?(记一下|记下|记录一下|记一笔|添加记事|新建记事|加个记事|提醒我)/;
  if (!prefix.test(input)) return null;
  const body = input.replace(prefix, '');
  if (!body) return { title: '', date: extractDate(input, ctx) };

  const date = extractDate(body, ctx);
  let title = body;
  if (date) {
    title = body
      .replace(/(大后天|后天|明天|明日|今天|今日)/g, '')
      .replace(/(下周|上周|这周|本周)?(?:周|星期|礼拜)[一二三四五六日天1-7]/g, '')
      .replace(/第\s*\d+\s*周/g, '')
      .replace(/^[的在于]+/, '');
  }
  return { title: title.trim(), date };
}

/* ============================ 模糊匹配 ============================ */

function isSubsequence(short, long) {
  let index = 0;
  for (let cursor = 0; cursor < long.length && index < short.length; cursor += 1) {
    if (long[cursor] === short[index]) index += 1;
  }
  return index === short.length;
}

/** 编辑距离，超过 max 就提前返回，避免长文本白算 */
function editDistance(left, right, max) {
  const a = String(left);
  const b = String(right);
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (current[j] < best) best = current[j];
    }
    if (best > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

/**
 * 课程名模糊匹配，覆盖三种真实说法：
 *   完整名字    高等数学
 *   简称/跳字   高数、线代、大物   → 子序列匹配
 *   打错一个字  高待数学             → 编辑距离
 *
 * 两个字的简称（"高数""数据"）很容易误伤：问"数据还在吗"会把《数据结构》勾出来。
 * 所以额外返回 strict 标记 —— 只有全名、三字以上、或纠错命中的才算强匹配，
 * 弱匹配必须配合"在哪上/老师/几周"这类课程意图词才当真。
 */
function matchCourses(input, courses) {
  const names = Array.from(new Set((courses || []).map((course) => String(course.name || '')).filter(Boolean)));
  const scored = [];

  names.forEach((name) => {
    const target = normalize(name);
    let score = 0;
    let strict = false;

    if (input.indexOf(target) >= 0) {
      score = 1;
      strict = true;
    } else if (target.length >= 2) {
      const maxSize = Math.min(input.length, target.length);
      for (let size = maxSize; size >= 2; size -= 1) {
        for (let start = 0; start + size <= input.length; start += 1) {
          const piece = input.slice(start, start + size);
          // 跳字简称：至少覆盖原名三分之一，"高数""大物"都能命中
          if (size >= Math.ceil(target.length * 0.34) && isSubsequence(piece, target)) {
            const value = 0.6 + (size / target.length) * 0.3;
            if (value > score) {
              score = value;
              strict = size >= 3;
            }
          }
          // 手误：长度接近且只差一个字
          if (size >= 3 && Math.abs(piece.length - target.length) <= 1 && editDistance(piece, target, 1) <= 1 && score < 0.9) {
            score = 0.9;
            strict = true;
          }
        }
      }
    }

    if (score > 0) scored.push({ name, score, strict });
  });

  if (!scored.length) return { name: '', others: [], strict: false };
  scored.sort((left, right) => right.score - left.score || right.name.length - left.name.length);
  const top = scored[0];
  const others = scored
    .filter((item) => item.name !== top.name && item.score >= top.score - 0.08)
    .slice(0, 2)
    .map((item) => item.name);
  return { name: top.name, others, strict: top.strict };
}

module.exports = {
  editDistance,
  extractDate,
  extractNote,
  extractWeek,
  isSubsequence,
  matchCourses,
  normalize,
  weekdayOf
};
