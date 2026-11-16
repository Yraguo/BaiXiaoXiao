const pageAdapter = require('../../utils/pageAdapter');
const { SERVICES } = require('../../data/services');

const pageLogic = {
  data: { services: SERVICES },

  open(event) {
    const item = SERVICES.find((service) => service.key === event.currentTarget.dataset.key);
    if (!item) return;
    // 小程序内已经做好的功能直接跳页面，其余仍是复制网址到浏览器打开
    if (item.path) return wx.navigateTo({ url: item.path });
    if (!item.url) return wx.showToast({ title: '该入口正在适配小程序版', icon: 'none' });
    wx.setClipboardData({ data: item.url, success: () => wx.showToast({ title: '网址已复制', icon: 'success' }) });
  }
};

Component(pageAdapter.adapt(pageLogic));
