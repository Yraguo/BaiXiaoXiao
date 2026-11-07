/**
 * PDF 导入的课程映射：真实逻辑在 utils/courseMap.js，这里只钉死 id 前缀。
 * 与教务导入共用同一份实现，导入结果才完全兼容（两种方式可互相替换/追加）。
 */

const { COURSE_FIELDS, maxWeekOf, toCourses: mapCourses } = require('../courseMap');

function toCourses(rows, totalWeeks) {
  return mapCourses(rows, totalWeeks, 'course-pdf');
}

module.exports = { COURSE_FIELDS, maxWeekOf, toCourses };
