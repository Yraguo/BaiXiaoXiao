/**
 * 本机个人资料：头像 + 昵称。
 *
 * 【为什么不用 wx.getUserProfile】该接口已回收；真正的"微信一键登录"需要服务端
 * 拿 code 换 openid（或云开发），而本项目没有后端。微信官方给个人主体留的替代
 * 方案就是「头像昵称填写能力」：<button open-type="chooseAvatar"> 选头像、
 * <input type="nickname"> 填昵称，全程不联网、不涉及账号体系。
 */

const PROFILE_KEY = 'baixiaoxiao.profile.v1';
const DEFAULT_AVATAR = '/assets/logo.png';

function defaultProfile() {
  return { avatarUrl: DEFAULT_AVATAR, nickName: '同学', custom: false };
}

function loadProfile() {
  try {
    const stored = wx.getStorageSync(PROFILE_KEY);
    if (!stored || typeof stored !== 'object') return defaultProfile();
    return Object.assign(defaultProfile(), stored);
  } catch (error) {
    return defaultProfile();
  }
}

function saveProfile(patch) {
  const next = Object.assign(loadProfile(), patch || {});
  try {
    wx.setStorageSync(PROFILE_KEY, next);
  } catch (error) {
    /* 存不进去也不能影响页面显示 */
  }
  return next;
}

/**
 * 把 chooseAvatar 给的临时文件转存到用户目录。
 * 临时路径在重启后会失效，不落盘的话下次进来头像就变成默认图了。
 */
function persistAvatar(tempFilePath) {
  return new Promise((resolve) => {
    if (!tempFilePath) {
      resolve(DEFAULT_AVATAR);
      return;
    }
    const fileSystem = wx.getFileSystemManager();
    fileSystem.saveFile({
      tempFilePath,
      success: (res) => resolve(res.savedFilePath || tempFilePath),
      fail: () => resolve(tempFilePath)
    });
  });
}

/** 换头像后清掉上一张，避免用户目录里堆一串没人引用的图片 */
function removeAvatar(filePath) {
  if (!filePath || filePath === DEFAULT_AVATAR) return;
  if (filePath.indexOf('http') === 0) return;
  try {
    wx.getFileSystemManager().unlink({ filePath, fail() {} });
  } catch (error) {
    /* 清理失败不影响主流程 */
  }
}

module.exports = { DEFAULT_AVATAR, loadProfile, persistAvatar, removeAvatar, saveProfile };
