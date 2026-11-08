const { loadHistory, loadNotes, removeAllUserData } = require('../../utils/appStore');
const { loadCourses } = require('../../utils/storage');
const {
  DEFAULT_AVATAR,
  loadProfile,
  persistAvatar,
  removeAvatar,
  saveProfile
} = require('../../utils/profile');
const { confirmDelete } = require('../../utils/confirm');
const { summarize, TOTAL_FULL } = require('../../utils/secondclass');
const { loadClasses } = require('../../utils/appStore');

Page({
  data: {
    courseCount: 0,
    noteCount: 0,
    historyCount: 0,
    secondTotal: '0',
    secondFull: TOTAL_FULL,
    secondLine: '德 0 · 智 0 · 体 0 · 美 0 · 劳 0',
    profile: { avatarUrl: DEFAULT_AVATAR, nickName: '同学' },
    editing: false,
    draft: { avatarUrl: DEFAULT_AVATAR, nickName: '' }
  },

  onShow() {
    this.refresh();
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

  // 第二课堂是 tabBar 页面，只能用 switchTab
  openSecondClass() { wx.switchTab({ url: '/pages/secondclass/index' }); },

  /** 本机数据导出成 JSON 文本，方便换手机时手动搬 */
  copyMyData() {
    const snapshot = {
      exportedAt: new Date().toISOString(),
      courses: loadCourses(),
      notes: loadNotes(),
      secondClass: loadClasses(),
      profile: loadProfile()
    };
    wx.setClipboardData({
      data: JSON.stringify(snapshot),
      success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'success' })
    });
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
});
