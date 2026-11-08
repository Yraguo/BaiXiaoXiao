const { PERIOD_TIMES, defaultSettings } = require('../../data/defaults');
const {
  loadSettings,
  loadCourses,
  saveCourses,
  saveSettings
} = require('../../utils/storage');
const { confirmDelete } = require('../../utils/confirm');

Page({
  data: {
    settings: {},
    totalWeekOptions: Array.from({ length: 30 }, (_, index) => index + 1),
    totalWeekIndex: 17
  },

  onLoad() {
    const settings = loadSettings();
    this.setData({
      settings,
      totalWeekIndex: Math.max(0, Number(settings.totalWeeks) - 1)
    });
  },

  updateName(event) {
    this.setData({ 'settings.timetableName': event.detail.value });
  },

  updateStartDate(event) {
    this.setData({ 'settings.semesterStartMonday': event.detail.value });
  },

  updateTotalWeeks(event) {
    const totalWeekIndex = Number(event.detail.value);
    this.setData({ totalWeekIndex, 'settings.totalWeeks': totalWeekIndex + 1 });
  },

  toggleWeekend(event) {
    this.setData({ 'settings.showWeekend': event.detail.value });
  },

  updatePeriod(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    this.setData({ [`settings.periodTimes[${index}].${field}`]: event.detail.value });
  },

  restorePeriodTimes() {
    this.setData({ 'settings.periodTimes': JSON.parse(JSON.stringify(PERIOD_TIMES)) });
    wx.showToast({ title: '已恢复默认作息', icon: 'none' });
  },

  save() {
    const settings = this.data.settings;
    if (!String(settings.timetableName || '').trim()) {
      wx.showToast({ title: '请填写课表名称', icon: 'none' });
      return;
    }
    saveSettings(settings);
    wx.showToast({ title: '设置已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 400);
  },

  resetSettings() {
    wx.showModal({
      title: '恢复默认设置？',
      content: '学期名称、开学日期、总周数和作息时间会恢复默认，课程不受影响。',
      confirmText: '恢复',
      success: (res) => {
        if (!res.confirm) return;
        const settings = defaultSettings();
        saveSettings(settings);
        this.setData({
          settings,
          totalWeekIndex: Math.max(0, Number(settings.totalWeeks) - 1)
        });
        wx.showToast({ title: '已恢复默认设置', icon: 'success' });
      }
    });
  },

  async clearCourses() {
    const courses = loadCourses();
    const confirmed = await confirmDelete({ title: '清空全部课程？', name: '全部课程', count: courses.length, recoverable: false });
    if (!confirmed) return;
    saveCourses([]);
    wx.showToast({ title: '课程已清空', icon: 'success' });
    setTimeout(() => wx.reLaunch({ url: '/pages/main/index' }), 400);
  }
});

