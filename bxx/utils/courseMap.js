/**
 * 导入结果 → 课表课程对象 的唯一映射实现。
 *
 * 教务直连（utils/jw）与 PDF 解析（utils/pdf）只是数据来源不同，落库结构必须
 * 完全一致，否则"少一个字段导致详情页空白"这类问题会在其中一条链路上悄悄复发。
 * 所以真实逻辑只留这一份，两个入口各自只钉死自己的 id 前缀。
 */

const { courseColorIndex } = require('./colors');

/** 应用侧课程对象的完整字段，改结构时同步这里和测试 */
const COURSE_FIELDS = [
  'id', 'name', 'teacher', 'room', 'day',
  'startPeriod', 'endPeriod', 'weeks', 'colorIndex', 'note'
];

/** 导入数据里的最大周次，用来决定总周数下限，避免第 19 周以后的课被裁掉 */
function maxWeekOf(rows) {
  return (rows || []).reduce((max, row) => {
    const local = Math.max.apply(null, (row.weeks || []).concat([0]));
    return Math.max(max, local);
  }, 0);
}

/**
 * @param {Array} rows 导入解析结果
 * @param {number} totalWeeks 课表总周数
 * @param {string} idPrefix 来源前缀，用于区分数据来路（course-jw / course-pdf）
 * @returns {Array} 应用可用的课程数组
 */
function toCourses(rows, totalWeeks, idPrefix) {
  const limit = Math.max(1, Number(totalWeeks) || 18);
  const prefix = idPrefix || 'course';
  const stamp = Date.now();
  return (rows || []).map((row, index) => ({
    id: prefix + '-' + stamp + '-' + index,
    name: row.name,
    teacher: row.teacher || '',
    room: row.room || '',
    day: row.day,
    startPeriod: row.startPeriod,
    endPeriod: row.endPeriod,
    weeks: (row.weeks || []).filter((week) => week >= 1 && week <= limit),
    colorIndex: courseColorIndex(row.name),
    note: ''
  })).filter((course) => course.weeks.length > 0);
}

module.exports = { COURSE_FIELDS, maxWeekOf, toCourses };
