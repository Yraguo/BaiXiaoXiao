/**
 * 教务导入的课程映射：真实逻辑在 utils/courseMap.js，这里只钉死 id 前缀。
 * 两个导入入口共用同一份实现，避免字段结构在两条链路上各走各的。
 */

const { COURSE_FIELDS, maxWeekOf, toCourses: mapCourses } = require('../courseMap');

function toCourses(rows, totalWeeks) {
  return mapCourses(rows, totalWeeks, 'course-jw');
}

module.exports = { COURSE_FIELDS, maxWeekOf, toCourses };
