const { COURSE_COLORS, courseTint } = require('../../utils/colors');
const { loadClasses, saveClasses } = require('../../utils/appStore');
const { CATEGORIES, formatCredits, summarize } = require('../../utils/secondclass');

function dateText(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  if (!match) return '未填日期';
  return `${Number(match[2])}月${Number(match[3])}日`;
}

Page({
  data: {
    totalText: '0',
    count: 0,
    records: [],
    breakdown: [],
    chips: [],
    filter: 'all',
    filterName: ''
  },

  onShow() {
    this.reload();
  },

  reload() {
    const summary = summarize(loadClasses());
    const filter = this.data.filter;
    const active = filter === 'all' ? null : filter;

    const breakdown = summary.byCategory.map((category) => {
      const index = CATEGORIES.findIndex((item) => item.key === category.key);
      return {
        ...category,
        creditsText: formatCredits(category.credits),
        // 用学分占比画一条横条，比列数字更容易看出重心在哪
        percent: summary.total > 0 ? Math.max(6, Math.round(category.credits / summary.total * 100)) : 0,
        color: COURSE_COLORS[index % COURSE_COLORS.length],
        tint: courseTint(index)
      };
    });

    const records = summary.list
      .filter((record) => !active || record.category === active)
      .map((record) => {
        const index = CATEGORIES.findIndex((item) => item.key === record.category);
        return {
          ...record,
          categoryName: breakdown.find((item) => item.key === record.category)
            ? breakdown.find((item) => item.key === record.category).name
            : (CATEGORIES[index] || CATEGORIES[CATEGORIES.length - 1]).name,
          creditsText: formatCredits(record.credits),
          dateText: dateText(record.date),
          color: COURSE_COLORS[index % COURSE_COLORS.length],
          tint: courseTint(index)
        };
      });

    this.setData({
      totalText: summary.totalText,
      count: summary.count,
      breakdown,
      records,
      chips: [{ key: 'all', name: '全部', active: !active }].concat(
        summary.byCategory.map((category) => ({
          key: category.key,
          name: category.name,
          active: category.key === active
        }))
      ),
      filterName: active ? CATEGORIES.find((item) => item.key === active).name : ''
    });
  },

  changeFilter(event) {
    const key = event.currentTarget.dataset.key;
    if (key === this.data.filter) return;
    this.setData({ filter: key }, () => this.reload());
  },

  openRecord(event) {
    wx.navigateTo({ url: `/pages/secondclass/edit?id=${event.currentTarget.dataset.id}` });
  },

  addRecord() {
    wx.navigateTo({ url: '/pages/secondclass/edit' });
  },

  clearAll() {
    if (!this.data.count) return;
    wx.showModal({
      title: '清空全部二课记录？',
      content: `将删除 ${this.data.count} 条记录，删除后无法恢复。`,
      confirmText: '清空',
      confirmColor: '#ff3b30',
      success: (result) => {
        if (!result.confirm) return;
        saveClasses([]);
        this.setData({ filter: 'all' }, () => this.reload());
      }
    });
  }
});
