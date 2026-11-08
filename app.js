// 云开发环境 ID：换成你自己的（云开发控制台 → 设置 → 环境设置，形如 xxx-1a2b3c4d5e6f）。
// 公开仓库里不要提交真实环境 ID；留空时会自动使用该 AppID 下的默认云环境。
// ↓ 本地测试用，提交前请改回空字符串
const CLOUD_ENV = '';

App({
  onLaunch() {
    if (!wx.cloud) {
      // 基础库低于 2.2.3 时没有云能力，导入页会自动退回 PDF 方式
      console.error('[cloud] 当前基础库不支持云开发，请升级微信后重试');
      return;
    }
    // 填了环境 ID 就锁定该环境；没填则用账号下的默认环境，避免仓库里出现真实 ID
    if (CLOUD_ENV) {
      wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
    } else {
      wx.cloud.init({ traceUser: true });
    }
  },

  globalData: {
    appName: '百小鸮',
    schoolName: '北京化工大学',
    cloudEnv: CLOUD_ENV
  }
});
