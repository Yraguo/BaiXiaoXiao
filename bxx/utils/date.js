const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(value) {
  const parts = String(value || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return new Date();
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function startOfDay(value) {
  const date = value instanceof Date ? new Date(value) : parseDate(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value, count) {
  const date = startOfDay(value);
  date.setDate(date.getDate() + count);
  return date;
}

function mondayIndex(date) {
  return (date.getDay() + 6) % 7;
}

function currentWeek(startMonday, totalWeeks, now = new Date()) {
  const start = startOfDay(startMonday);
  const today = startOfDay(now);
  const raw = Math.floor((today.getTime() - start.getTime()) / (7 * DAY_MS)) + 1;
  return Math.min(Math.max(raw, 1), Number(totalWeeks) || 1);
}

function dateForDay(startMonday, week, dayIndex) {
  return addDays(startMonday, (Number(week) - 1) * 7 + Number(dayIndex));
}

function monthDay(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function dateStamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekRange(startMonday, week) {
  const first = dateForDay(startMonday, week, 0);
  const last = dateForDay(startMonday, week, 6);
  return `${first.getMonth() + 1}月${first.getDate()}日–${last.getMonth() + 1}月${last.getDate()}日`;
}

function todayDayIndex(now = new Date()) {
  return mondayIndex(now);
}

/**
 * 相差几个「自然日」（忽略时分秒）。
 * 用来写"明天 / 2 天后"这类文案：按毫秒数取整会把 36 小时算成 1 天，
 * 于是"周六晚上看周一早八"会被写成"1 天后"，和"周一"自相矛盾。
 */
function calendarDayDiff(from, to) {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

/**
 * 月历网格：固定 42 格（6 行 × 7 列），周日在第一列。
 * 前后补上相邻月份的日期，避免每月行数跳动导致页面高度抖。
 */
function monthCells(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const offset = first.getDay();
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(year, monthIndex, 1 - offset + index);
    cells.push({
      date: dateStamp(date),
      day: date.getDate(),
      inMonth: date.getMonth() === first.getMonth()
    });
  }
  return cells;
}

module.exports = {
  addDays,
  calendarDayDiff,
  currentWeek,
  dateForDay,
  dateStamp,
  monthCells,
  monthDay,
  parseDate,
  todayDayIndex,
  weekRange
};

