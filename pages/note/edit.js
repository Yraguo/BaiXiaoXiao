const { loadNotes, saveNotes } = require('../../utils/appStore');
const { dateStamp } = require('../../utils/date');
const display = require('../../utils/display');

Page({
  data: {
    pageStyle: '', draft: { title: '', content: '', date: '', remindAt: '', done: false } },
  onLoad(options) {
    this.setData({ pageStyle: display.applyTheme() });
    this.id = options.id || '';
    const existing = loadNotes().find((item) => item.id === this.id);
    if (existing) {
      this.setData({ draft: existing });
    } else {
      // 从日历某一天点进来时，日期默认就用那一天
      this.setData({
        draft: {
          title: '',
          content: '',
          date: options.date || dateStamp(new Date()),
          remindAt: '',
          done: false
        }
      });
    }
    wx.setNavigationBarTitle({ title: existing ? '编辑记事' : '新建记事' });
  },
  update(event) { this.setData({ [`draft.${event.currentTarget.dataset.field}`]: event.detail.value }); },
  changeDate(event) { this.setData({ 'draft.date': event.detail.value }); },
  save() {
    const title = String(this.data.draft.title || '').trim();
    if (!title) return wx.showToast({ title: '请填写标题', icon: 'none' });
    const now = new Date().toISOString();
    const item = {
      ...this.data.draft,
      id: this.id || `note-${Date.now()}`,
      title,
      date: this.data.draft.date || dateStamp(new Date()),
      createdAt: this.data.draft.createdAt || now,
      updatedAt: now,
      deletedAt: null
    };
    const notes = loadNotes();
    const index = notes.findIndex((note) => note.id === item.id);
    if (index >= 0) notes.splice(index, 1, item); else notes.unshift(item);
    saveNotes(notes);
    wx.navigateBack();
  }
});
