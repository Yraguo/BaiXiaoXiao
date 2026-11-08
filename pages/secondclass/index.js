const { COURSE_COLORS, courseTint } = require('../../utils/colors');
const { loadClasses, loadHours, saveHours } = require('../../utils/appStore');
const { loadSettings } = require('../../utils/storage');
const { currentWeek, dateStamp, todayDayIndex } = require('../../utils/date');
const {
  ART_TABLE,
  CLAUSES,
  CONTEST_TABLE,
  PLATE_CAPS,
  PLATES,
  SPORT_TABLE,
  TERMS,
  TOTAL_FULL,
  formatScore,
  summarize,
  summarizeHours
} = require('../../utils/secondclass');
const { draw: drawSheet, layout: layoutSheet } = require('../../utils/materials');

const DAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function headLine() {
  const now = new Date();
  let week = 0;
  try {
    week = currentWeek(loadSettings().semesterStartMonday, now);
  } catch (_) {
    week = 0;
  }
  const date = `${now.getMonth() + 1}月${now.getDate()}日 ${DAY_CN[todayDayIndex(now)]}`;
  return week > 0 ? `${date} · 第 ${week} 周` : date;
}

Page({
  data: {
    headLine: '',
    tab: 'score',

    total: 0,
    totalText: '0',
    full: TOTAL_FULL,
    plates: [],
    records: [],
    count: 0,
    filter: 'all',
    filters: [],

    volunteer: { totalText: '0', yearText: '0', yearCount: 0, count: 0, groups: [] },
    labor: { totalText: '0', yearText: '0', yearCount: 0, count: 0, groups: [] },

    manualOpen: false,
    manualTab: 'caps',
    manualTabs: [
      { key: 'caps', name: '板块上限' },
      { key: 'contest', name: '学科竞赛' },
      { key: 'sport', name: '体育竞赛' },
      { key: 'art', name: '美育比赛' },
      { key: 'clause', name: '计分条款' }
    ],
    caps: PLATE_CAPS,
    contest: CONTEST_TABLE,
    sport: SPORT_TABLE,
    art: ART_TABLE,
    clauses: CLAUSES,
    clauseKeyword: '',

    exportOpen: false,
    exporting: false,
    photoCount: 0,

    hourOpen: false,
    hourKind: 'volunteer',
    terms: TERMS,
    hourChips: ['1', '2', '3', '4', '6', '8', '10', '12', '16', '20', '24', '30', '40', '50'],
    hourDraft: { term: TERMS[0], title: '', hours: 0, date: '', note: '' }
  },

  onShow() {
    this.reload();
  },

  reload() {
    const summary = summarize(loadClasses());
    const plates = summary.plates.map((plate, index) => ({
      ...plate,
      scoreText: formatScore(plate.score),
      color: COURSE_COLORS[index % COURSE_COLORS.length],
      tint: courseTint(index)
    }));

    const filter = this.data.filter;
    const records = summary.list
      .filter((record) => filter === 'all' || record.plate === filter)
      .map((record) => {
        const index = PLATES.findIndex((item) => item.key === record.plate);
        const plate = plates[index] || plates[0];
        return {
          ...record,
          plateShort: plate.short,
          plateName: plate.name,
          scoreText: formatScore(record.score),
          // 基础 / 拓展 + 时长，对齐安卓版记录卡的副标题信息量
          levelText: record.level === 'extra' ? '拓展' : '基础',
          hoursText: record.hours ? `${record.hours} 小时` : '',
          photoText: record.photos.length ? `${record.photos.length} 张照片` : '无照片',
          dateText: record.date || '未填日期',
          color: plate.color,
          tint: plate.tint
        };
      });

    const year = new Date().getFullYear();
    this.setData({
      photoCount: summary.list.reduce((sum, record) => sum + record.photos.length, 0),
      headLine: headLine(),
      total: summary.total,
      totalText: summary.totalText,
      plates,
      count: summary.count,
      records,
      filters: [{ key: 'all', short: '全部', name: '全部', active: filter === 'all' }].concat(
        plates.map((plate) => ({
          key: plate.key,
          short: plate.short,
          name: plate.name,
          active: plate.key === filter
        }))
      ),
      volunteer: this.buildHours('volunteer', year),
      labor: this.buildHours('labor', year)
    });
  },

  buildHours(kind, year) {
    const result = summarizeHours(loadHours(), kind, year);
    return {
      totalText: result.totalText,
      yearText: result.yearText,
      yearCount: result.yearCount,
      count: result.count,
      groups: result.groups.map((group) => ({
        ...group,
        hoursText: formatScore(group.hours),
        empty: group.count === 0
      }))
    };
  },

  switchTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (tab === this.data.tab) return;
    this.setData({ tab });
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
    const plate = this.data.filter === 'all' ? 'de' : this.data.filter;
    wx.navigateTo({ url: `/pages/secondclass/edit?plate=${plate}` });
  },

  /* ---------------- 导出材料 ---------------- */

  openExport() {
    this.setData({ exportOpen: true });
  },

  closeExport() {
    this.setData({ exportOpen: false });
  },

  /** 存相册：失败时区分「用户拒绝授权」和「其它失败」 */
  saveImage(filePath) {
    return new Promise((resolve) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => resolve({ ok: true }),
        fail: (error) => {
          const message = String((error && error.errMsg) || '');
          if (message.indexOf('cancel') >= 0) { resolve({ ok: false, cancel: true }); return; }
          resolve({ ok: false, auth: message.indexOf('auth') >= 0 || message.indexOf('authorize') >= 0 });
        }
      });
    });
  },

  askAlbumPermission() {
    wx.showModal({
      title: '需要相册权限',
      content: '微信没有「保存到相册」的权限。去设置里打开后，再点一次导出。',
      confirmText: '去设置',
      success: (res) => { if (res.confirm) wx.openSetting(); }
    });
  },

  /** 生成一张清单长图，存进相册 */
  saveSheet() {
    if (this.data.exporting) return;
    const summary = summarize(loadClasses());
    if (!summary.count) {
      wx.showToast({ title: '还没有填报记录', icon: 'none' });
      return;
    }
    const model = layoutSheet(summary);
    this.setData({ exporting: true });
    wx.showLoading({ title: '正在生成清单', mask: true });

    wx.createSelectorQuery().select('#exportCanvas').fields({ node: true, size: true }).exec((res) => {
      const canvas = res && res[0] && res[0].node;
      if (!canvas) {
        wx.hideLoading();
        this.setData({ exporting: false });
        wx.showToast({ title: '画布不可用', icon: 'none' });
        return;
      }
      canvas.width = model.width;
      canvas.height = model.height;
      const ctx = canvas.getContext('2d');
      drawSheet(ctx, model);

      wx.canvasToTempFilePath({
        canvas,
        x: 0,
        y: 0,
        width: model.width,
        height: model.height,
        destWidth: model.width,
        destHeight: model.height,
        success: async (file) => {
          const result = await this.saveImage(file.tempFilePath);
          wx.hideLoading();
          this.setData({ exporting: false });
          if (result.ok) {
            this.setData({ exportOpen: false });
            wx.showToast({ title: '清单图已存进相册', icon: 'success' });
          } else if (result.auth) {
            this.askAlbumPermission();
          } else if (!result.cancel) {
            wx.showToast({ title: '生成失败，重试一次', icon: 'none' });
          }
        },
        fail: () => {
          wx.hideLoading();
          this.setData({ exporting: false });
          wx.showToast({ title: '生成失败，重试一次', icon: 'none' });
        }
      });
    });
  },

  /** 把记录里的照片逐张存进相册 */
  async savePhotos() {
    if (this.data.exporting) return;
    const summary = summarize(loadClasses());
    const photos = summary.list.reduce((all, record) => all.concat(record.photos), []);
    if (!photos.length) {
      wx.showToast({ title: '还没有照片', icon: 'none' });
      return;
    }
    this.setData({ exporting: true });
    let saved = 0;
    for (let index = 0; index < photos.length; index += 1) {
      wx.showLoading({ title: `正在保存 ${index + 1} / ${photos.length}`, mask: true });
      const result = await this.saveImage(photos[index]);
      if (result.ok) {
        saved += 1;
        continue;
      }
      wx.hideLoading();
      this.setData({ exporting: false });
      if (result.auth) this.askAlbumPermission();
      else if (!result.cancel) wx.showToast({ title: `第 ${index + 1} 张保存失败`, icon: 'none' });
      return;
    }
    wx.hideLoading();
    this.setData({ exporting: false, exportOpen: false });
    wx.showToast({ title: `已保存 ${saved} 张`, icon: 'none' });
  },

  openManual() {
    this.setData({ manualOpen: true, manualTab: 'caps', clauseKeyword: '', clauses: CLAUSES });
  },

  closeManual() {
    this.setData({ manualOpen: false });
  },

  noop() {},

  changeManualTab(event) {
    this.setData({ manualTab: event.currentTarget.dataset.key });
  },

  onClauseSearch(event) {
    const keyword = String(event.detail.value || '').trim();
    this.setData({
      clauseKeyword: keyword,
      clauses: keyword ? CLAUSES.filter((item) => item.text.indexOf(keyword) >= 0) : CLAUSES
    });
  },

  openHour(event) {
    this.setData({
      hourOpen: true,
      hourKind: event.currentTarget.dataset.kind,
      hourDraft: { term: TERMS[0], title: '', hours: 0, date: dateStamp(new Date()), note: '' }
    });
  },

  closeHour() {
    this.setData({ hourOpen: false });
  },

  setHourTerm(event) {
    this.setData({ 'hourDraft.term': event.currentTarget.dataset.term });
  },

  setHourValue(event) {
    this.setData({ 'hourDraft.hours': Number(event.currentTarget.dataset.hours) });
  },

  onHourInput(event) {
    this.setData({ [`hourDraft.${event.currentTarget.dataset.field}`]: event.detail.value });
  },

  onHourDate(event) {
    this.setData({ 'hourDraft.date': event.detail.value });
  },

  saveHour() {
    const draft = this.data.hourDraft;
    if (!String(draft.title || '').trim()) {
      wx.showToast({ title: '先写事项名称', icon: 'none' });
      return;
    }
    if (!(Number(draft.hours) > 0)) {
      wx.showToast({ title: '时长要大于 0', icon: 'none' });
      return;
    }
    const list = loadHours();
    list.unshift({
      id: `hour-${Date.now()}`,
      kind: this.data.hourKind,
      term: draft.term,
      title: String(draft.title).trim(),
      hours: Number(draft.hours),
      date: draft.date,
      note: String(draft.note || '').trim()
    });
    saveHours(list);
    this.setData({ hourOpen: false });
    this.reload();
  }
});
