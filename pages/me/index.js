const pageAdapter = require('../../utils/pageAdapter');
const {
  loadClasses,
  loadHistory,
  loadHours,
  loadNotes,
  removeAllUserData,
  saveClasses,
  saveHours
} = require('../../utils/appStore');
const { loadCourses, loadSettings, saveCourses, saveSettings } = require('../../utils/storage');
const {
  DEFAULT_AVATAR,
  loadProfile,
  persistAvatar,
  removeAvatar,
  saveProfile
} = require('../../utils/profile');
const { confirmDelete } = require('../../utils/confirm');
const {
  TOTAL_FULL,
  normalizeHour,
  normalizeRecord,
  summarize
} = require('../../utils/secondclass');
const { buildFullBackup, photoNameFor } = require('../../utils/backup');
const { buildZip, readText, readZip } = require('../../utils/zip');
const display = require('../../utils/display');

const pageLogic = {
  data: {
    courseCount: 0,
    noteCount: 0,
    historyCount: 0,
    secondTotal: '0',
    secondFull: TOTAL_FULL,
    secondLine: '德 0 · 智 0 · 体 0 · 美 0 · 劳 0',
    profile: { avatarUrl: DEFAULT_AVATAR, nickName: '同学' },
    editing: false,
    draft: { avatarUrl: DEFAULT_AVATAR, nickName: '' },
    // 外观：字号三档 + 独立的深色开关（不吃系统设置）
    fontLevels: display.LEVELS,
    fontLevel: 'normal',
    fontName: '标准',
    fontOpen: false,
    theme: 'light',
    themeDark: false
  },

  onShow() {
    this.refresh();
    this.refreshFont();
  },

  refresh() {
    const summary = summarize(loadClasses());
    this.setData({
      courseCount: loadCourses().length,
      noteCount: loadNotes().filter((item) => !item.deletedAt).length,
      historyCount: loadHistory().length,
      secondTotal: summary.totalText,
      secondPercent: Math.min(100, Math.round(summary.total / TOTAL_FULL * 100)),
      secondLine: summary.plates.map((plate) => `${plate.short} ${plate.score}`).join(' · '),
      profile: loadProfile()
    });
  },

  openSettings() { wx.navigateTo({ url: '/pages/settings/index' }); },

  /* ---------------- 字号 ---------------- */

  refreshFont() {
    const pref = display.load();
    this.setData({
      fontLevel: pref.font,
      fontName: display.levelOf(pref.font).name,
      theme: pref.theme,
      themeDark: pref.theme === 'dark'
    });
  },

  openFont() { this.setData({ fontOpen: true }); },
  closeFont() { this.setData({ fontOpen: false }); },

  /**
   * 深色开关。
   *
   * 这是唯一一处改主题的地方，改完通知容器页重算根节点的变量表——
   * 颜色变量挂在 pages/main 的根节点上，组件自己 setData 改不到那里。
   */
  toggleTheme(event) {
    const dark = Boolean(event.detail && event.detail.value);
    const pref = display.save({ theme: dark ? 'dark' : 'light' });
    this.setData({ theme: pref.theme, themeDark: dark });
    // 开发者工具里切换时能立刻看到导航栏也变了
    display.applyTheme(pref);
    this.triggerEvent('themechange', { theme: pref.theme });
  },

  chooseFont(event) {
    const key = event.currentTarget.dataset.key;
    display.save({ font: key });
    this.setData({ fontLevel: key, fontName: display.levelOf(key).name, fontOpen: false });
    // 真正改 --fs 的是容器页（页面根节点在它手上）
    this.triggerEvent('fontchange', { font: key });
  },

  // 五个 tab 同一个页面，跳转改成请容器页切 swiper
  openSecondClass() { this.triggerEvent('tabrequest', { index: 1 }); },

  /* ---------------- 备份 / 恢复 ---------------- */

  imageType(path) {
    return new Promise((resolve) => {
      wx.getImageInfo({
        src: path,
        success: (info) => resolve(info.type || ''),
        fail: () => resolve('')
      });
    });
  },

  /** 课表 + 二课 + 照片打成一个 zip，发到微信里长期留存 */
  async exportBackup() {
    if (this.exporting) return;
    const courses = loadCourses();
    const settings = loadSettings();
    const classes = loadClasses();
    const hours = loadHours();
    const summary = summarize(classes);

    this.exporting = true;
    wx.showLoading({ title: '正在打包', mask: true });
    try {
      const manager = wx.getFileSystemManager();
      const photoEntries = [];
      const photoNamesByIndex = [];
      let missing = 0;

      for (let index = 0; index < summary.list.length; index += 1) {
        const record = summary.list[index];
        const names = [];
        for (let photoIndex = 0; photoIndex < (record.photos || []).length; photoIndex += 1) {
          const path = record.photos[photoIndex];
          const type = await this.imageType(path);
          const name = photoNameFor(record, index, photoIndex, record.photos.length, type);
          try {
            photoEntries.push({ name, data: manager.readFileSync(path) });
            names.push(name);
          } catch (error) {
            missing += 1;
          }
        }
        photoNamesByIndex[index] = names;
      }

      const entries = buildFullBackup({
        courses,
        settings,
        summary,
        hours,
        photoEntries,
        photoNamesByIndex
      });
      const zip = buildZip(entries);
      const now = new Date();
      const pad = (value) => String(value).padStart(2, '0');
      const fileName = `百小鸮备份-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.zip`;
      const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
      manager.writeFileSync(filePath, zip.buffer);

      wx.hideLoading();
      this.exporting = false;
      const size = zip.length > 1024 * 1024
        ? `${(zip.length / 1024 / 1024).toFixed(1)} MB`
        : `${Math.max(1, Math.round(zip.length / 1024))} KB`;
      if (missing) wx.showToast({ title: `${missing} 张照片丢失，其余已打包`, icon: 'none' });
      this.shareFile(filePath, fileName, size);
    } catch (error) {
      wx.hideLoading();
      this.exporting = false;
      wx.showToast({ title: '打包失败，重试一次', icon: 'none' });
    }
  },

  shareFile(filePath, fileName, sizeText) {
    if (!wx.shareFileMessage) {
      wx.showModal({
        title: '已打包',
        content: `${fileName}（${sizeText}）已存到小程序目录。当前微信版本不支持转发文件，升级后再试。`,
        showCancel: false
      });
      return;
    }
    wx.shareFileMessage({
      filePath,
      fileName,
      success: () => wx.showToast({ title: '已发送', icon: 'success' }),
      fail: (error) => {
        const message = String((error && error.errMsg) || '');
        if (message.indexOf('cancel') >= 0) return;
        wx.showModal({
          title: '没发出去',
          content: `文件已存在小程序目录（${sizeText}），可以重试一次。`,
          showCancel: false
        });
      }
    });
  },

  /** 从聊天记录里挑备份 zip，解析后写回本机 */
  restoreBackup() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['zip'],
      success: (res) => {
        const file = (res.tempFiles || [])[0];
        if (!file) return;
        let parsed = null;
        try {
          parsed = this.parseBackup(file.path);
        } catch (error) {
          wx.showModal({ title: '读不出来', content: '这不是百小鸮的备份包，或者文件不完整。', showCancel: false });
          return;
        }
        if (!parsed) {
          wx.showModal({ title: '读不出来', content: '备份包里没有找到课表或二课数据。', showCancel: false });
          return;
        }
        const { courses, records, hours, settings } = parsed;
        wx.showModal({
          title: '确认恢复',
          content: `将写入课表 ${courses.length} 门、二课 ${records.length} 条、时长 ${hours.length} 条，会覆盖当前数据。`,
          confirmText: '恢复',
          success: (result) => {
            if (!result.confirm) return;
            this.applyBackup({ courses, records, hours, settings });
          }
        });
      },
      fail: (error) => {
        const message = String((error && error.errMsg) || '');
        if (message.indexOf('cancel') >= 0) return;
        wx.showToast({ title: '没有选到文件', icon: 'none' });
      }
    });
  },

  parseBackup(filePath) {
    const manager = wx.getFileSystemManager();
    const files = readZip(manager.readFileSync(filePath));
    const courseText = readText(files, '课表.json');
    const classText = readText(files, '二课记录.json');
    const hoursText = readText(files, '二课时长.json');
    if (!courseText && !classText) return null;

    const courseData = courseText ? JSON.parse(courseText) : { courses: [], settings: {} };
    const classData = classText ? JSON.parse(classText) : { records: [] };
    const hoursData = hoursText ? JSON.parse(hoursText) : { records: [] };

    // 照片：把 zip 里的照片写回小程序目录，路径按原文件名对上
    const photoMap = {};
    const targetDir = `${wx.env.USER_DATA_PATH}/restore`;
    try {
      manager.mkdirSync(targetDir, true);
    } catch (error) {
      // 目录已存在
    }
    files.forEach((entry) => {
      if (!entry.data) return;
      if (entry.name.indexOf('/照片/') < 0) return;
      const base = entry.name.split('/').pop();
      const target = `${targetDir}/${base}`;
      try {
        // entry.data 是整包 buffer 的切片，必须复制一份再写，
        // 否则会把整个 zip 当成这张照片写进去
        const copy = new Uint8Array(entry.data);
        manager.writeFileSync(target, copy.buffer);
        photoMap[entry.name] = target;
      } catch (error) {
        // 单张写失败就先跳过，记录里会少这张
      }
    });

    const records = (classData.records || []).map((record) => normalizeRecord(Object.assign({}, record, {
      photos: (record.photos || []).map((name) => photoMap[name] || '').filter(Boolean)
    })));

    return {
      courses: (courseData.courses || []).filter((course) => course && course.name),
      settings: courseData.settings || {},
      records,
      hours: (hoursData.records || []).map((record) => normalizeHour(record, record.kind))
    };
  },

  applyBackup({ courses, records, hours, settings }) {
    if (courses.length) saveCourses(courses);
    if (Object.keys(settings || {}).length) saveSettings(Object.assign({}, loadSettings(), settings));
    saveClasses(records);
    saveHours(hours);
    this.refresh();
    wx.showToast({ title: '已恢复', icon: 'success' });
  },

  showAbout() {
    wx.showModal({
      title: '关于百小鸮',
      content: '高校校园学习生活助手 · 微信小程序独立版\n\n课表、记事和个人资料都保存在本机，不上传服务器。',
      showCancel: false
    });
  },

  openEditor() {
    this.setData({ editing: true, draft: Object.assign({}, loadProfile()) });
  },

  closeEditor() {
    this.setData({ editing: false });
  },

  noop() {},

  async onChooseAvatar(event) {
    const tempFilePath = event.detail && event.detail.avatarUrl;
    if (!tempFilePath) return;
    const previous = this.data.draft.avatarUrl;
    // 临时路径重启后失效，先转存到用户目录再展示
    const savedFilePath = await persistAvatar(tempFilePath);
    this.setData({ 'draft.avatarUrl': savedFilePath });
    if (previous && previous !== savedFilePath) removeAvatar(previous);
  },

  onNicknameInput(event) {
    this.setData({ 'draft.nickName': event.detail.value });
  },

  onAvatarError() {
    this.setData({ 'profile.avatarUrl': DEFAULT_AVATAR });
  },

  saveProfileEdits() {
    const nickName = String(this.data.draft.nickName || '').trim() || '同学';
    const profile = saveProfile({
      avatarUrl: this.data.draft.avatarUrl || DEFAULT_AVATAR,
      nickName
    });
    this.setData({ profile, editing: false });
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  async clearMiniData() {
    const count = this.data.noteCount + this.data.historyCount;
    const confirmed = await confirmDelete({ title: '删除小程序数据？', name: '全部记事和小鸮历史', count, recoverable: false });
    if (!confirmed) return;
    removeAllUserData();
    this.refresh();
    wx.showToast({ title: '已删除', icon: 'success' });
  }
};

Component(pageAdapter.adapt(pageLogic));
