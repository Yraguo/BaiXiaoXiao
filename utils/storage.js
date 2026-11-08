const { defaultSettings } = require('../data/defaults');

const SETTINGS_KEY = 'timetable.settings.v1';
const COURSES_KEY = 'timetable.courses.v1';
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

function resetAll() {
  // 只恢复设置，课程一律清空：这里不再提供"恢复示例课表"
  const settings = defaultSettings();
  saveSettings(settings);
  saveCourses([]);
  return { settings, courses: [] };
}

module.exports = { loadCourses, loadSettings, resetAll, saveCourses, saveSettings };
