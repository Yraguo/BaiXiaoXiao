const { loadClasses, saveClasses } = require('../../utils/appStore');
const {
  CLAUSES,
  PLATES,
  levelsOf,
  normalizeRecord,
  plateTotals,
  usageOf
} = require('../../utils/secondclass');
const { confirmDelete } = require('../../utils/confirm');

// 一张就够用：主要是证明参加过，多了反而占空间（旧记录里的多张照片不会删）
const MAX_PHOTOS = 1;
// 时长只留 4 个高频值，剩下的走自定义——超过 4 个选项就超出工作记忆容量了
const HOUR_CHIPS = [2, 4, 6, 8];
// 自由填报的常用分值，取手册里出现最多的几档
const FREE_CHIPS = [5, 10, 20, 35];
// 未保存的草稿存在本机，中途被电话打断也不会白填
const DRAFT_KEY = 'baixiaoxiao.secondclass.draft.v1';

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
    // 依据的手册条款原文
    clause: '',
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
    // 当前板块的手册条款（已按关键词过滤）
    clauses: [],
    clauseQuery: '',
    clauseTotal: 0,
    // 搜到的、属于别的板块的条款数
    clauseOther: 0,
    // 当前板块当前档的额度
    usage: { cap: 144, used: 0, remain: 144, percent: 0 },
    // 自由填报区默认收起：有条款时不该让人先看见一堆假选项
    showFree: false,
    // 从草稿恢复出来的提示
    restored: false,
    hourChips: HOUR_CHIPS,
    freeChips: FREE_CHIPS,
    maxPhotos: MAX_PHOTOS,
    draft: blankDraft('de')
  },

  onLoad(options) {
    const list = loadClasses().map(normalizeRecord);
    const existing = options && options.id ? list.find((record) => record.id === options.id) : null;

    let draft = existing || blankDraft(options && options.plate);
    let restored = false;

    // 编辑已有记录时不读草稿；新建时才尝试恢复上次没保存的内容
    if (!existing) {
      const saved = this.readDraft();
      if (saved && saved.title && saved.id) {
        draft = Object.assign({}, draft, saved);
        restored = true;
      }
    }

    this.records = list;
    this.applyPlate(draft.plate, draft.level);
    this.setData({ isEditing: Boolean(existing), draft, restored });
    wx.setNavigationBarTitle({ title: existing ? '编辑填报' : '第二课堂填报' });
    this.refreshClauses();
    this.refreshUsage();
  },

  onUnload() {
    // 离开时把草稿落盘，下次进来能接着填
    if (!this.data.isEditing) this.writeDraft();
  },

  /* ---------------- 草稿 ---------------- */

  readDraft() {
    try {
      const saved = wx.getStorageSync(DRAFT_KEY);
      return saved && typeof saved === 'object' ? saved : null;
    } catch (error) {
      return null;
    }
  },

  writeDraft() {
    try {
      const draft = this.data.draft;
      if (!draft.title && !draft.photos.length) {
        wx.removeStorageSync(DRAFT_KEY);
        return;
      }
      wx.setStorageSync(DRAFT_KEY, draft);
    } catch (error) {
      // 存不下也不影响使用
    }
  },

  discardRestored() {
    try {
      wx.removeStorageSync(DRAFT_KEY);
    } catch (error) {
      // 忽略
    }
    const draft = blankDraft(this.data.draft.plate);
    this.setData({ draft, restored: false, showFree: false });
    this.applyPlate(draft.plate, draft.level);
    this.refreshClauses();
    this.refreshUsage();
  },

  /* ---------------- 板块 / 档位 ---------------- */

  /** 切换板块或档位：只改选择，分数与条款由用户自己决定要不要重置 */
  applyPlate(plateKey, levelKey) {
    const plateIndex = Math.max(0, PLATES.findIndex((plate) => plate.key === plateKey));
    const plate = PLATES[plateIndex];
    const levels = levelsOf(plate);
    const levelIndex = Math.max(0, levels.findIndex((level) => level.key === levelKey));
    this.setData({
      plateIndex,
      plate,
      levels,
      levelIndex,
      'draft.plate': plate.key,
      'draft.level': levels[levelIndex].key
    });
  },

  changePlate(event) {
    const index = Number(event.currentTarget.dataset.index);
    const plate = PLATES[index];
    if (!plate) return;
    const levels = levelsOf(plate);
    const levelIndex = Math.max(0, levels.findIndex((level) => level.key === this.data.draft.level));

    // 换板块后原来的分值多半超出新板块的上限，先收进上限再让用户看到
    const cap = levels[levelIndex].cap;
    const score = Math.min(Number(this.data.draft.score) || 0, cap);
    const overCap = (Number(this.data.draft.score) || 0) > cap;

    this.setData({
      plateIndex: index,
      plate,
      levels,
      levelIndex,
      'draft.plate': plate.key,
      'draft.level': levels[levelIndex].key,
      'draft.score': score,
      // 条款跟着板块走，换板块后旧条款不再适用
      'draft.clause': '',
      showFree: false
    });
    this.refreshClauses();
    this.refreshUsage();
    if (overCap) {
      wx.showToast({ title: `新板块上限 ${cap} 分，已调整`, icon: 'none' });
    }
  },

  changeLevel(event) {
    const levelIndex = Number(event.detail.value);
    const level = this.data.levels[levelIndex];
    if (!level) return;
    const score = Math.min(Number(this.data.draft.score) || 0, level.cap);
    const overCap = (Number(this.data.draft.score) || 0) > level.cap;
    this.setData({ levelIndex, 'draft.level': level.key, 'draft.score': score });
    this.refreshUsage();
    if (overCap) {
      wx.showToast({ title: `${level.name}上限 ${level.cap} 分，已调整`, icon: 'none' });
    }
  },

  /* ---------------- 手册条款 ---------------- */

  /**
   * 条款列表。
   * 不搜的时候只列当前板块的（5~7 条，一屏看完）；
   * 一搜就搜全部板块 —— 「志愿服务」在劳育板块，用户在德板块搜也应该搜得到，
   * 命中别的板块时把板块标出来，点一下就切过去。
   */
  refreshClauses() {
    const query = String(this.data.clauseQuery || '').trim();
    const current = this.data.plate.key;
    const list = query
      ? CLAUSES.filter((clause) => clause.text.indexOf(query) >= 0)
      : CLAUSES.filter((clause) => clause.plate === current);

    this.setData({
      clauses: list.map((clause) => {
        const plate = PLATES.find((item) => item.key === clause.plate) || PLATES[0];
        return {
          text: clause.text,
          score: clause.score,
          scoreText: `${clause.score} 分`,
          tiered: clause.tiered,
          tieredText: clause.tiered ? '按级别不同' : '',
          plateKey: clause.plate,
          plateShort: plate.short,
          plateName: plate.name,
          plateInk: plate.ink,
          // 搜出来但属于别的板块的，要标出来并允许一键切过去
          other: clause.plate !== current,
          picked: clause.plate === current && this.data.draft.clause === clause.text
        };
      }),
      clauseTotal: list.length,
      clauseOther: query ? list.filter((clause) => clause.plate !== current).length : 0
    });
  },

  onClauseQuery(event) {
    this.setData({ clauseQuery: event.detail.value });
    this.refreshClauses();
  },

  clearClauseQuery() {
    this.setData({ clauseQuery: '' });
    this.refreshClauses();
  },

  /** 选中条款 → 自动填分，并把条款原文存进记录 */
  pickClause(event) {
    const text = event.currentTarget.dataset.text;
    const score = Number(event.currentTarget.dataset.score);
    const plateKey = event.currentTarget.dataset.plate;
    const clause = CLAUSES.find((item) => item.text === text);
    if (!clause) return;

    // 点到别的板块的条款，先把板块切过去 —— 条款本身就决定了它属于哪一栏
    if (plateKey && plateKey !== this.data.plate.key) {
      const index = PLATES.findIndex((item) => item.key === plateKey);
      const plate = PLATES[index];
      const levels = levelsOf(plate);
      const levelIndex = Math.max(0, levels.findIndex((level) => level.key === this.data.draft.level));
      this.setData({
        plateIndex: index,
        plate,
        levels,
        levelIndex,
        'draft.plate': plate.key,
        'draft.level': levels[levelIndex].key
      });
      this.refreshUsage();
      wx.showToast({ title: `已切到 ${plate.name}`, icon: 'none' });
    }

    const cap = this.data.levels[this.data.levelIndex].cap;
    const finalScore = Math.min(clause.score, cap);
    this.setData({
      'draft.score': finalScore,
      'draft.clause': clause.text,
      showFree: false
    });
    this.refreshClauses();
    this.refreshUsage();
    if (clause.score > cap) {
      wx.showToast({ title: `该条款 ${clause.score} 分，超出上限按 ${cap} 分计`, icon: 'none' });
    }
  },

  clearClause() {
    this.setData({ 'draft.clause': '' });
    this.refreshClauses();
  },

  /* ---------------- 自由填报 ---------------- */

  toggleFree() {
    this.setData({ showFree: !this.data.showFree });
  },

  setScore(event) {
    // 手动改分就不再挂着条款依据，免得记录看着像按条款算的
    this.setData({ 'draft.score': Number(event.currentTarget.dataset.score) || 0, 'draft.clause': '' });
    this.refreshUsage();
  },

  setHours(event) {
    this.setData({ 'draft.hours': Number(event.currentTarget.dataset.hour) || 0 });
  },

  /* ---------------- 额度 ---------------- */

  refreshUsage() {
    const level = this.data.levels[this.data.levelIndex];
    const usage = usageOf(
      this.records || loadClasses(),
      this.data.plate.key,
      level.key,
      this.data.draft.id
    );
    this.setData({
      usage: Object.assign({}, usage, {
        percent: usage.cap ? Math.min(100, Math.round(usage.used / usage.cap * 100)) : 0
      }),
      // 板块条上回显「已得/满分」，改分、换板块都跟着动
      plates: this.platesWithTotals()
    });
  },

  /** 五个板块各自的累计分，挂到 plate 上给 WXML 直接用 */
  platesWithTotals() {
    const totals = plateTotals(this.records || loadClasses(), this.data.draft.id);
    return PLATES.map((plate) => Object.assign({}, plate, { usageText: totals[plate.key] }));
  },

  /* ---------------- 字段 ---------------- */

  updateField(event) {
    const field = event.currentTarget.dataset.field;
    let value = event.detail.value;
    // 分数输入实时收进上限，别让用户填到 999 才被拦
    if (field === 'score') {
      const cap = this.data.levels[this.data.levelIndex].cap;
      const number = Number(value) || 0;
      if (number > cap) value = String(cap);
    }
    this.setData({ [`draft.${field}`]: value });
    if (field === 'score') this.refreshUsage();
    this.writeDraft();
  },

  changeDate(event) {
    this.setData({ 'draft.date': event.detail.value });
    this.writeDraft();
  },

  toggleWatermark(event) {
    this.setData({ 'draft.watermark': Boolean(event.detail.value) });
    this.writeDraft();
  },

  toggleUseLocation(event) {
    const on = Boolean(event.detail.value);
    // 关掉定位就把已存的地点一起清掉，
    // 否则记录里还留着坐标，等于「我说不带了但其实带了」
    const patch = { 'draft.useLocation': on };
    if (!on) {
      patch['draft.address'] = '';
      patch['draft.latitude'] = '';
      patch['draft.longitude'] = '';
    }
    this.setData(patch);
    this.writeDraft();
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
        this.writeDraft();
      },
      fail: (error) => {
        const message = String((error && error.errMsg) || '');
        if (message.indexOf('cancel') >= 0) return;
        // 权限被拒时给一条出路，不然这一项就永久卡死了
        wx.showModal({
          title: '需要位置权限',
          content: '位置只用于照片水印，不上传。开启后就能在地图上选一个地点。',
          confirmText: '去设置',
          success: (res) => { if (res.confirm) wx.openSetting(); }
        });
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
    this.writeDraft();
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
        this.writeDraft();
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
    this.writeDraft();
  },

  async save() {
    const draft = this.data.draft;
    const title = String(draft.title || '').trim();
    if (!title) {
      wx.showToast({ title: '先写活动名称', icon: 'none' });
      return;
    }

    const level = this.data.levels[this.data.levelIndex];
    const cap = level.cap;
    const rawScore = Number(draft.score) || 0;
    const score = Math.min(rawScore, cap);

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
      score,
      hours: Number(draft.hours) || 0
    }));

    const list = loadClasses().map(normalizeRecord);
    const index = list.findIndex((item) => item.id === record.id);
    if (index >= 0) list[index] = record;
    else list.unshift(record);
    saveClasses(list);

    try {
      wx.removeStorageSync(DRAFT_KEY);
    } catch (error) {
      // 忽略
    }

    const plate = PLATES.find((item) => item.key === record.plate) || PLATES[0];
    if (rawScore > cap) {
      wx.showModal({
        title: '已按上限计入',
        content: `${plate.name} · ${level.name}上限 ${cap} 分，这条按 ${cap} 分记。`,
        showCancel: false
      });
    } else {
      wx.showToast({ title: `已保存：${plate.short} +${record.score} 分`, icon: 'none' });
    }
    setTimeout(() => wx.navigateBack(), rawScore > cap ? 900 : 340);
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
