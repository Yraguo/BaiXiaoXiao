const { defaultSettings } = require('../data/defaults');

const SETTINGS_KEY = 'timetable.settings.v1';
const COURSES_KEY = 'timetable.courses.v1';
// 考试安排跟着课表一起同步：登录一次拿两份数据，避开"短时间内二次登录拿不到会话"的坑
const EXAMS_KEY = 'timetable.exams.v1';
// 旧版本首次启动会把一份示例课表写进缓存，id 都是 demo- 开头。
// 用户第一次打开看到别人的课，会以为"导入没生效"，所以要能识别出来清掉。
const DEMO_ID_PREFIX = 'demo-';

function isSampleCourse(course) {
  return !!course && String(course.id || '').indexOf(DEMO_ID_PREFIX) === 0;
}

function getStorage(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    return value && typeof value === 'object' ? value : fallback;
  } catch (error) {
    return fallback;
  }
}

function loadSettings() {
  return { ...defaultSettings(), ...getStorage(SETTINGS_KEY, {}) };
}

function loadCourses() {
  const stored = getStorage(COURSES_KEY, null);
  // 没有任何记录（首次启动、清过缓存）就是空课表，不再灌示例数据
  if (!Array.isArray(stored)) return [];
  const kept = stored.filter((course) => !isSampleCourse(course));
  if (kept.length !== stored.length) saveCourses(kept);
  return kept;
}

function saveSettings(settings) {
  wx.setStorageSync(SETTINGS_KEY, settings);
}

function saveCourses(courses) {
  wx.setStorageSync(COURSES_KEY, courses);
}

/** 存考试安排，带上同步时间，页面要显示"什么时候取的" */
function saveExams(exams) {
  const payload = { at: Date.now(), exams: Array.isArray(exams) ? exams : [] };
  try {
    wx.setStorageSync(EXAMS_KEY, payload);
  } catch (error) {
    // 存不进去也不该影响导入，考试页会退化成空列表
  }
  return payload;
}

function loadExams() {
  const stored = getStorage(EXAMS_KEY, null);
  if (!stored || !Array.isArray(stored.exams)) return { at: 0, exams: [] };
  return { at: Number(stored.at) || 0, exams: stored.exams };
}

function clearExams() {
  try {
    wx.removeStorageSync(EXAMS_KEY);
  } catch (error) {
    // 忽略
  }
}

function resetAll() {
  // 只恢复设置，课程一律清空：这里不再提供"恢复示例课表"
  const settings = defaultSettings();
  saveSettings(settings);
  saveCourses([]);
  return { settings, courses: [] };
}

module.exports = {
  loadCourses,
  loadSettings,
  resetAll,
  saveCourses,
  saveSettings,
  saveExams,
  loadExams,
  clearExams
};
