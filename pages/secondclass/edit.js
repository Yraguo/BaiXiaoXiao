const { loadClasses, saveClasses } = require('../../utils/appStore');
const { PLATES, normalizeRecord } = require('../../utils/secondclass');
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
    plates: PLATES,
    plateIndex: 0,
    scoreChips: ['2', '4', '5', '8', '10', '15', '20', '25', '30'],
    draft: {
      id: '',
      plate: 'de',
      title: '',
      date: '',
      score: 0,
      photos: [],
      note: '',
      watermark: false
    }
  },

  onLoad(options) {
    const list = loadClasses().map(normalizeRecord);
    const existing = options && options.id ? list.find((record) => record.id === options.id) : null;
    const fallbackPlate = options && options.plate ? options.plate : 'de';
    const draft = existing || {
      id: `sc-${Date.now()}`,
      plate: PLATES.some((plate) => plate.key === fallbackPlate) ? fallbackPlate : 'de',
      title: '',
      date: today(),
      score: 0,
      photos: [],
      note: '',
      watermark: false
    };
    this.setData({
      isEditing: Boolean(existing),
      draft: Object.assign({}, draft),
      plateIndex: Math.max(0, PLATES.findIndex((plate) => plate.key === draft.plate))
    });
    wx.setNavigationBarTitle({ title: existing ? '编辑填报' : '填报活动' });
  },

  changePlate(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ plateIndex: index, 'draft.plate': PLATES[index].key });
  },

  updateField(event) {
    this.setData({ [`draft.${event.currentTarget.dataset.field}`]: event.detail.value });
  },

  changeDate(event) {
    this.setData({ 'draft.date': event.detail.value });
  },

  setScore(event) {
    this.setData({ 'draft.score': Number(event.currentTarget.dataset.score) });
  },

  toggleWatermark(event) {
    this.setData({ 'draft.watermark': Boolean(event.detail.value) });
  },

  choosePhotos() {
    const left = 6 - this.data.draft.photos.length;
    if (left <= 0) {
      wx.showToast({ title: '最多 6 张', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: left,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const manager = wx.getFileSystemManager();
        const saved = (res.tempFiles || []).map((file) => {
          // temp 路径会过期，存到小程序用户目录里才留得住
          try {
            return manager.saveFileSync(file.tempFilePath);
          } catch (_) {
            return file.tempFilePath;
          }
        });
        this.setData({
          'draft.photos': this.data.draft.photos.concat(saved).slice(0, 6)
        });
      }
    });
  },

  removePhoto(event) {
    const index = Number(event.currentTarget.dataset.index);
    const photos = this.data.draft.photos.slice();
    photos.splice(index, 1);
    this.setData({ 'draft.photos': photos });
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
      score: Number(draft.score) || 0
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
      title: '删除这条填报？',
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
