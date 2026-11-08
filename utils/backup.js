/**
 * 备份包：把课表 + 二课（+ 照片）打成一棵目录，交给 zip.js 打成 zip。
 *
 * 目录结构（root 是当天的文件夹名）：
 *   课表.csv / 课表.json
 *   二课记录.csv / 二课记录.json
 *   照片/序号-活动名.jpg
 *   说明.txt
 *
 * CSV 给人看（Excel 直接开），JSON 给机器读（「从备份恢复」只认它）。
 */

const { buildCsv, buildJson, buildReadme, extFromPath, extFromType, photoNameFor } = require('./materials');
const { formatWeeks } = require('./weeks');

const DAY_LABELS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function pad(value) {
  return String(value).padStart(2, '0');
}

function stamp(when) {
  const date = when || new Date();
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function stampMinute(when) {
  const date = when || new Date();
  return `${stamp(date)}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function csvCell(value) {
  const text = String(value == null ? '' : value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 课程表 CSV：一行一门课，周次用「1-9周,11-15周」这种写法 */
function buildCourseCsv(courses) {
  const header = ['课程名称', '星期', '开始节次', '结束节次', '周次', '校区', '地点', '教师', '备注'];
  const rows = (courses || []).map((course) => [
    course.name || '',
    DAY_LABELS[Number(course.day)] || '',
    course.startPeriod || '',
    course.endPeriod || '',
    formatWeeks(course.weeks || []),
    course.campus || '',
    course.room || '',
    course.teacher || '',
    course.note || ''
  ].map(csvCell).join(','));
  return `\ufeff${header.join(',')}\n${rows.join('\n')}\n`;
}

/** 课表 JSON：课程 + 学期设置，恢复时靠它还原 */
function buildCourseJson(courses, settings, when) {
  return JSON.stringify({
    app: '百小鸮',
    schema: 'timetable/v1',
    exportedAt: stampMinute(when),
    settings: {
      timetableName: (settings && settings.timetableName) || '',
      semesterStartMonday: (settings && settings.semesterStartMonday) || '',
      totalWeeks: (settings && settings.totalWeeks) || 18
    },
    courses: (courses || []).map((course) => ({
      name: course.name || '',
      day: Number(course.day) || 1,
      startPeriod: Number(course.startPeriod) || 1,
      endPeriod: Number(course.endPeriod) || 1,
      weeks: Array.isArray(course.weeks) ? course.weeks.slice() : [],
      campus: course.campus || '',
      room: course.room || '',
      teacher: course.teacher || '',
      colorIndex: Number.isInteger(course.colorIndex) ? course.colorIndex : undefined,
      note: course.note || ''
    }))
  });
}

/** 志愿 / 劳育时长单独一份 JSON，免得和二课自评混在一起 */
function buildHoursJson(hours, when) {
  return JSON.stringify({
    app: '百小鸮',
    schema: 'second-class-hours/v1',
    exportedAt: stampMinute(when),
    records: (hours || []).map((record) => ({
      kind: record.kind === 'labor' ? 'labor' : 'volunteer',
      term: record.term || '',
      title: record.title || '',
      hours: Number(record.hours) || 0,
      date: record.date || '',
      note: record.note || ''
    }))
  }, null, 2);
}

function buildBackupReadme({ courses, summary, photos, when }) {
  const at = when || new Date();
  return [
    '百小鸮 · 本机数据备份',
    `导出时间：${stampMinute(at)}`,
    `课程：${(courses || []).length} 门`,
    `二课记录：${summary.count} 条，合计 ${summary.totalText} / ${summary.full}`,
    `照片：${photos} 张`,
    '',
    '目录说明：',
    '  课表.csv / 课表.json      课程与学期设置；恢复用的是 json',
    '  二课记录.csv / .json      一行一条，最后一列是照片文件名',
    '  二课时长.json             志愿 / 劳育时长（独立口径）',
    '  照片/                     文件名前缀是记录序号，和 CSV 的「序号」对应',
    '',
    '恢复方式：小程序「我的 → 从备份恢复」，选这个 zip 即可。',
    '分数为自行填报与自评，最终认定以学校审核为准。'
  ].join('\n');
}

/**
 * 课表 + 二课 的完整备份
 * @param {object} payload
 * @param {Array} payload.courses
 * @param {object} payload.settings
 * @param {object} payload.summary summarize() 的返回值
 * @param {Array<{name:string,data:Uint8Array}>} payload.photoEntries 已按 photoNameFor 命名的照片
 * @param {Array<Array<string>>} payload.photoNamesByIndex
 */
function buildFullBackup(payload) {
  const when = payload.when || new Date();
  const root = `百小鸮备份-${stamp(when)}`;
  const summary = payload.summary;
  const photoNamesByIndex = payload.photoNamesByIndex || [];
  return [
    { name: `${root}/课表.csv`, data: buildCourseCsv(payload.courses) },
    { name: `${root}/课表.json`, data: buildCourseJson(payload.courses, payload.settings, when) },
    { name: `${root}/二课记录.csv`, data: buildCsv(summary, photoNamesByIndex) },
    { name: `${root}/二课记录.json`, data: buildJson(summary, photoNamesByIndex, when) },
    { name: `${root}/二课时长.json`, data: buildHoursJson(payload.hours, when) },
    ...(payload.photoEntries || []).map((entry) => ({ name: `${root}/${entry.name}`, data: entry.data })),
    {
      name: `${root}/说明.txt`,
      data: buildBackupReadme({
        courses: payload.courses,
        summary,
        photos: (payload.photoEntries || []).length,
        when
      })
    }
  ];
}

/** 只有二课的材料包（发给老师用，不含课表） */
function buildSecondClassPackage(payload) {
  const when = payload.when || new Date();
  const root = `二课材料-${stampMinute(when)}`;
  const summary = payload.summary;
  const photoNamesByIndex = payload.photoNamesByIndex || [];
  return [
    { name: `${root}/二课记录.csv`, data: buildCsv(summary, photoNamesByIndex) },
    { name: `${root}/二课记录.json`, data: buildJson(summary, photoNamesByIndex, when) },
    { name: `${root}/二课时长.json`, data: buildHoursJson(payload.hours, when) },
    ...(payload.photoEntries || []).map((entry) => ({ name: `${root}/${entry.name}`, data: entry.data })),
    { name: `${root}/说明.txt`, data: buildReadme(summary, when) }
  ];
}

module.exports = {
  DAY_LABELS,
  buildCourseCsv,
  buildCourseJson,
  buildFullBackup,
  buildHoursJson,
  buildSecondClassPackage,
  csvCell,
  extFromPath,
  extFromType,
  photoNameFor,
  stamp,
  stampMinute
};
