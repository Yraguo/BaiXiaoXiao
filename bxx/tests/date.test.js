const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calendarDayDiff,
  currentWeek,
  dateForDay,
  dateStamp,
  monthCells,
  weekRange
} = require('../utils/date');

test('按第一周周一计算当前周', () => {
  assert.equal(currentWeek('2026-08-31', 18, new Date(2026, 8, 21)), 4);
  assert.equal(currentWeek('2026-08-31', 18, new Date(2026, 7, 1)), 1);
  assert.equal(currentWeek('2026-08-31', 18, new Date(2027, 5, 1)), 18);
});

test('按周次和星期计算日期', () => {
  assert.equal(dateStamp(dateForDay('2026-08-31', 4, 0)), '2026-09-21');
  assert.equal(dateStamp(dateForDay('2026-08-31', 4, 6)), '2026-09-27');
  assert.equal(weekRange('2026-08-31', 4), '9月21日–9月27日');
});

test('倒计时的天数按自然日算，不按小时整除', () => {
  // 周六 20:16 → 周一 08:00 只差 36 小时，除以 24 取整会得到 1，是错的
  const saturday = new Date(2026, 10, 7, 20, 16);
  assert.equal(calendarDayDiff(saturday, new Date(2026, 10, 9, 8, 0)), 2);
  assert.equal(calendarDayDiff(saturday, new Date(2026, 10, 8, 8, 0)), 1);
  assert.equal(calendarDayDiff(saturday, new Date(2026, 10, 7, 23, 0)), 0);
  // 跨月、跨年同样成立
  assert.equal(calendarDayDiff(new Date(2026, 11, 31, 22, 0), new Date(2027, 0, 1, 8, 0)), 1);
});

test('月历网格固定 42 格，周日在第一列', () => {
  // 2026-11-01 是周日，正好顶格
  const november = monthCells(2026, 10);
  assert.equal(november.length, 42);
  assert.equal(november[0].date, '2026-11-01');
  assert.equal(november[0].inMonth, true);
  assert.equal(november[29].date, '2026-11-30');
  assert.equal(november[30].date, '2026-12-01');
  assert.equal(november[30].inMonth, false);

  // 2026-08-01 是周六，前面要补 6 天七月
  const august = monthCells(2026, 7);
  assert.equal(august[0].date, '2026-07-26');
  assert.equal(august[6].date, '2026-08-01');
  assert.equal(august[6].inMonth, true);
});

