const { loadClasses, saveClasses } = require('../../utils/appStore');
const { PLATES, normalizeRecord } = require('../../utils/secondclass');
const { confirmDelete } = require('../../utils/confirm');

// 一张就够用：主要是证明参加过，多了反而占空间（旧记录里的多张照片不会删）
const MAX_PHOTOS = 1;
const HOUR_CHIPS = [1, 2, 4, 6, 8, 10, 12, 20];
const SCORE_CHIPS = ['2', '4', '5', '8', '10', '15', '20', '25', '30'];

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function stampNow() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** 基础 / 拓展两档，上限随板块走（德 144/36、智 96/24…） */
function levelsOf(plate) {
  return [
    { key: 'base', name: '基础评定', cap: plate.base },
    { key: 'extra', name: '拓展评定', cap: plate.extra }
  ];
}

function blankDraft(plateKey) {
  const plate = PLATES.find((item) => item.key === plateKey) || PLATES[0];
  return {
    id: `sc-${Date.now()}`,
    plate: plate.key,
    title: '',
    date: today(),
    level: 'base',
    hours: 0,
    score: 0,
    photos: [],
    note: '',
    address: '',
    latitude: '',
    longitude: '',
    pinAt: '',
    watermark: false,
    // 水印里要不要带地点，用开关单独控制
    useLocation: true
  };
}

Page({
  data: {
    isEditing: false,
    plates: PLATES,
    plateIndex: 0,
    plate: PLATES[0],
    levels: levelsOf(PLATES[0]),
    levelIndex: 0,
    scoreChips: SCORE_CHIPS,
    hourChips: HOUR_CHIPS,
    maxPhotos: MAX_PHOTOS,
    draft: blankDraft('de')
  },

  onLoad(options) {
    const list = loadClasses().map(normalizeRecord);
    const existing = options && options.id ? list.find((record) => record.id === options.id) : null;
    const draft = existing || blankDraft(options && options.plate);
    const plateIndex = Math.max(0, PLATES.findIndex((plate) => plate.key === draft.plate));
    const plate = PLATES[plateIndex];
    const levels = levelsOf(plate);
    const levelIndex = Math.max(0, levels.findIndex((level) => level.key === draft.level));
    this.setData({
      isEditing: Boolean(existing),
      draft: Object.assign({}, draft, { level: levels[levelIndex].key }),
      plateIndex,
      plate,
      levels,
      levelIndex
    });
    wx.setNavigationBarTitle({ title: existing ? '编辑填报' : '第二课堂填报' });
  },

  changePlate(event) {
    const index = Number(event.currentTarget.dataset.index);
    const plate = PLATES[index];
    const levels = levelsOf(plate);
    const levelIndex = Math.max(0, levels.findIndex((level) => level.key === this.data.draft.level));
    this.setData({
      plateIndex: index,
      plate,
      levels,
      levelIndex,
      'draft.plate': plate.key
    });
  },

  changeLevel(event) {
    const levelIndex = Number(event.detail.value);
    this.setData({ levelIndex, 'draft.level': this.data.levels[levelIndex].key });
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

  setHours(event) {
    this.setData({ 'draft.hours': Number(event.currentTarget.dataset.hour) });
  },

  toggleWatermark(event) {
    this.setData({ 'draft.watermark': Boolean(event.detail.value) });
  },

  toggleUseLocation(event) {
    this.setData({ 'draft.useLocation': Boolean(event.detail.value) });
  },

  /**
   * 用微信地图选点，直接拿到地点名和地址（比自己取经纬度再逆地理编码省事，
   * 也不需要地图 Key）。选完顺手把水印开关打开——用户选位置就是为了打水印。
   */
  choosePlace() {
    wx.chooseLocation({
      success: (res) => {
        const name = String(res.name || '').trim();
        const address = String(res.address || '').trim();
        const display = name && address && address !== name
          ? `${name} · ${address}`
          : (name || address || '已选择位置');
        this.setData({
          'draft.address': display,
          'draft.latitude': Number(res.latitude).toFixed(5),
          'draft.longitude': Number(res.longitude).toFixed(5),
          'draft.pinAt': stampNow(),
          'draft.watermark': true
        });
      },
      fail: (error) => {
        const message = String((error && error.errMsg) || '');
        if (message.indexOf('cancel') >= 0) return;
        wx.showToast({ title: '需要位置权限才能选点', icon: 'none' });
      }
    });
  },

  clearPlace() {
    this.setData({
      'draft.address': '',
      'draft.latitude': '',
      'draft.longitude': '',
      'draft.pinAt': ''
    });
  },

  /** 把文字水印画到照片底部，返回新图片路径 */
  stamp(photos, text) {
    if (!photos.length || !text) return Promise.resolve(photos);
    return new Promise((resolve) => {
      wx.createSelectorQuery().select('#wm').fields({ node: true }).exec((res) => {
        const canvas = res && res[0] && res[0].node;
        if (!canvas) { resolve(photos); return; }
        const ctx = canvas.getContext('2d');
        const out = [];
        const step = (index) => {
          if (index >= photos.length) { resolve(out); return; }
          wx.getImageInfo({
            src: photos[index],
            success: (info) => {
              canvas.width = info.width;
              canvas.height = info.height;
              const img = canvas.createImage();
              img.onload = () => {
                ctx.drawImage(img, 0, 0, info.width, info.height);
                const size = Math.max(16, Math.round(info.width / 30));
                const bar = Math.round(size * 2.2);
                ctx.fillStyle = 'rgba(0,0,0,.5)';
                ctx.fillRect(0, info.height - bar, info.width, bar);
                ctx.fillStyle = '#fff';
                ctx.font = `${size}px sans-serif`;
                ctx.fillText(text, size, info.height - size * 0.8);
                wx.canvasToTempFilePath({
                  canvas,
                  success: (r) => { out.push(r.tempFilePath); step(index + 1); },
                  fail: () => { out.push(photos[index]); step(index + 1); }
                });
              };
              img.onerror = () => { out.push(photos[index]); step(index + 1); };
              img.src = info.path;
            },
            fail: () => { out.push(photos[index]); step(index + 1); }
          });
        };
        step(0);
      });
    });
  },

  pickPhotos(source) {
    const left = MAX_PHOTOS - this.data.draft.photos.length;
    if (left <= 0) {
      wx.showToast({ title: `最多 ${MAX_PHOTOS} 张`, icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: left,
      mediaType: ['image'],
      sourceType: [source],
      sizeType: ['compressed'],
      success: (res) => {
        const manager = wx.getFileSystemManager();
        const saved = (res.tempFiles || []).map((file) => {
          // temp 路径会过期，存到小程序用户目录里才留得住
          try {
            return manager.saveFileSync(file.tempFilePath);
          } catch (error) {
            return file.tempFilePath;
          }
        });
        this.setData({
          'draft.photos': this.data.draft.photos.concat(saved).slice(0, MAX_PHOTOS)
        });
      }
    });
  },

  choosePhotos() {
    this.pickPhotos('album');
  },

  takePhoto() {
    this.pickPhotos('camera');
  },

  previewPhoto(event) {
    const index = Number(event.currentTarget.dataset.index);
    wx.previewImage({ current: this.data.draft.photos[index], urls: this.data.draft.photos });
  },

  removePhoto(event) {
    const index = Number(event.currentTarget.dataset.index);
    const photos = this.data.draft.photos.slice();
    photos.splice(index, 1);
    this.setData({ 'draft.photos': photos });
  },

  async save() {
    const draft = this.data.draft;
    const title = String(draft.title || '').trim();
    if (!title) {
      wx.showToast({ title: '先写活动名称', icon: 'none' });
      return;
    }

    let photos = draft.photos;
    // 定位开关关掉时，照片上只写时间，不写地点
    const place = draft.useLocation
      ? (draft.address || (draft.latitude && draft.longitude ? `${draft.latitude}, ${draft.longitude}` : ''))
      : '';
    const watermarkText = [draft.pinAt || stampNow(), place].filter(Boolean).join('  ');
    if (draft.watermark && photos.length) {
      wx.showLoading({ title: '正在加水印', mask: true });
      photos = await this.stamp(photos, watermarkText);
      wx.hideLoading();
    }

    const record = normalizeRecord(Object.assign({}, draft, {
      title,
      photos,
      score: Number(draft.score) || 0,
      hours: Number(draft.hours) || 0
    }));

    const list = loadClasses().map(normalizeRecord);
    const index = list.findIndex((item) => item.id === record.id);
    if (index >= 0) list[index] = record;
    else list.unshift(record);
    saveClasses(list);

    const plate = PLATES.find((item) => item.key === record.plate) || PLATES[0];
    wx.showToast({
      title: `已保存：${plate.short} +${record.score} 分`,
      icon: 'none'
    });
    setTimeout(() => wx.navigateBack(), 340);
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
