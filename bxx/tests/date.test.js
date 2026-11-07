const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calendarDayDiff,
  currentWeek,
  dateForDay,
  dateStamp,
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

