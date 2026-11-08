const { loadClasses, saveClasses } = require('../../utils/appStore');
const { CATEGORIES, normalizeRecord } = require('../../utils/secondclass');
const { confirmDelete } = require('../../utils/confirm');

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

Page({
  data: {
    isEditing: false,
    categoryNames: CATEGORIES.map((category) => category.name),
    categoryIndex: 0,
    draft: {
      id: '',
      title: '',
      category: 'volunteer',
      date: '',
      credits: 1,
      organizer: '',
      note: ''
    }
  },

  onLoad(options) {
    const list = loadClasses().map(normalizeRecord);
    const existing = options && options.id ? list.find((record) => record.id === options.id) : null;
    const draft = existing || {
      id: `sc-${Date.now()}`,
      title: '',
      category: 'volunteer',
      date: today(),
      credits: 1,
      organizer: '',
      note: ''
    };
    const categoryIndex = Math.max(0, CATEGORIES.findIndex((category) => category.key === draft.category));
    this.setData({
      isEditing: Boolean(existing),
      draft: Object.assign({}, draft),
      categoryIndex
    });
    wx.setNavigationBarTitle({ title: existing ? '编辑二课记录' : '记一条二课' });
  },

  updateField(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`draft.${field}`]: event.detail.value });
  },

  changeCategory(event) {
    const index = Number(event.detail.value);
    this.setData({ categoryIndex: index, 'draft.category': CATEGORIES[index].key });
  },

  changeDate(event) {
    this.setData({ 'draft.date': event.detail.value });
  },

  save() {
    const draft = this.data.draft;
    const title = String(draft.title || '').trim();
    if (!title) {
      wx.showToast({ title: '先写活动名称', icon: 'none' });
      return;
    }
    const record = normalizeRecord(Object.assign({}, draft, {
      title,
      credits: Number(draft.credits) || 0
    }));

    const list = loadClasses().map(normalizeRecord);
    const index = list.findIndex((item) => item.id === record.id);
    if (index >= 0) list[index] = record;
    else list.unshift(record);
    saveClasses(list);

    wx.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 320);
  },

  async remove() {
    const ok = await confirmDelete({
      title: '删除这条二课记录？',
      name: this.data.draft.title || '未命名活动',
      count: 1
    });
    if (!ok) return;
    const list = loadClasses().map(normalizeRecord)
      .filter((record) => record.id !== this.data.draft.id);
    saveClasses(list);
    wx.navigateBack();
  }
});
