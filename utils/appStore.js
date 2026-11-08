const { dateStamp } = require('./date');

const NOTES_KEY = 'baixiaoxiao.notes.v1';
const HISTORY_KEY = 'baixiaoxiao.xiao.history.v1';
const CLASS_KEY = 'baixiaoxiao.secondclass.v1';

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function read(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    return value === '' || value === undefined || value === null ? clone(fallback) : value;
  } catch (_) {
    return clone(fallback);
  }
}

function write(key, value) {
  wx.setStorageSync(key, clone(value));
  return value;
}

/**
 * 老数据没有 date 字段（日历上线前只记了 createdAt），这里补齐。
 * 不回填的话，日历上所有历史记事都会消失，用户会以为数据丢了。
 */
function normalizeNote(note) {
  const copy = Object.assign({}, note);
  if (!copy.date) {
    const created = String(copy.createdAt || '');
    copy.date = /^\d{4}-\d{2}-\d{2}/.test(created) ? created.slice(0, 10) : dateStamp(new Date());
  }
  return copy;
}

function loadNotes() {
  const value = read(NOTES_KEY, []);
  return Array.isArray(value) ? value.map(normalizeNote) : [];
}

function saveNotes(notes) { return write(NOTES_KEY, notes); }

function loadHistory() {
  const value = read(HISTORY_KEY, []);
  return Array.isArray(value) ? value : [];
}

function saveHistory(messages) { return write(HISTORY_KEY, messages.slice(-100)); }

/* ---------- 第二课堂记录 ---------- */

function loadClasses() {
  const value = read(CLASS_KEY, []);
  return Array.isArray(value) ? value : [];
}

function saveClasses(records) {
  const list = (Array.isArray(records) ? records : []).filter((record) => record && record.title);
  return write(CLASS_KEY, list);
}

function removeAllUserData() {
  wx.removeStorageSync(NOTES_KEY);
  wx.removeStorageSync(HISTORY_KEY);
}

module.exports = {
  CLASS_KEY,
  HISTORY_KEY,
  NOTES_KEY,
  loadClasses,
  loadHistory,
  loadNotes,
  removeAllUserData,
  saveClasses,
  saveHistory,
  saveNotes
};
