const test = require('node:test');
const assert = require('node:assert/strict');

// 极简本地缓存替身，够跑 storage 这一层
const cache = {};
global.wx = {
  getStorageSync(key) {
    return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : '';
  },
  setStorageSync(key, value) {
    cache[key] = value;
  }
};

const { loadCourses, saveCourses } = require('../utils/storage');

const COURSES_KEY = 'timetable.courses.v1';

test('首次启动没有课表，也不会偷偷灌入示例数据', () => {
  delete cache[COURSES_KEY];
  assert.deepEqual(loadCourses(), []);
  assert.equal(Object.prototype.hasOwnProperty.call(cache, COURSES_KEY), false, '不应该把示例课表写进缓存');
});

test('历史版本写入的示例课表会被就地清理，真实课程保留', () => {
  cache[COURSES_KEY] = [
    { id: 'demo-1', name: '高等数学' },
    { id: 'demo-2', name: '大学英语' },
    { id: '1710000000000-1', name: '高等数学' }
  ];

  const courses = loadCourses();

  assert.equal(courses.length, 1);
  assert.equal(courses[0].name, '高等数学');
  assert.equal(cache[COURSES_KEY].length, 1, '缓存里也要清掉，下次启动不能又冒出来');
});

test('用户自己导入的课表原样返回', () => {
  const imported = [
    { id: '1710000000000-2', name: '大学物理', day: 3, startPeriod: 1, endPeriod: 2, weeks: [1, 2, 3] }
  ];
  saveCourses(imported);
  assert.deepEqual(loadCourses(), imported);
});
