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

Page({
  data: {
    courseCount: 0,
    noteCount: 0,
    historyCount: 0,
    profile: { avatarUrl: DEFAULT_AVATAR, nickName: '同学' },
    editing: false,
    draft: { avatarUrl: DEFAULT_AVATAR, nickName: '' }
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    this.setData({
      courseCount: loadCourses().length,
      noteCount: loadNotes().filter((item) => !item.deletedAt).length,
      historyCount: loadHistory().length,
      profile: loadProfile()
    });
  },

  openSettings() { wx.navigateTo({ url: '/pages/settings/index' }); },

  openSecondClass() { wx.navigateTo({ url: '/pages/secondclass/index' }); },

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
