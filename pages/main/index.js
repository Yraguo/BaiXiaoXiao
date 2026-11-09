const TITLES = ['我的课表', '第二课堂', '小鸮', '校园服务', '我的'];

const display = require('../../utils/display');

/**
 * 五个 tab 现在住在同一个页面的 swiper 里。
 *
 * 用 swiper 是为了让换页有真正的连续转场——旧页滑出、新页滑入能接上，
 * 而 wx.switchTab 只能瞬间替换页面，做不出这种效果。
 *
 * 但 swiper 必须 disable-touch：按需求只允许点击底部导航切换，不允许手势滑动。
 * 于是 current 只由两处驱动：底部导航点击、以及 swiper 自身的 change（兜底）。
 */
Page({
  data: {
    current: 0,
    // 页面参数原样传给课表组件，分享链接里的 share 参数要靠它
    pageQuery: {},
    // 字号：写成 page-style 挂到页面根节点，五个 tab 一起缩放
    pageStyle: ''
  },

  onLoad(options) {
    const query = options || {};
    this.setData({ pageQuery: query });

    // 字号 + 深色：一次算好挂到页面根节点，顺带把导航栏也刷成同一套
    this.setData({ pageStyle: display.applyTheme() });

    // 从分享卡片进来时直接落在课表，用户扫一眼就能看到内容
    if (query.share || query.shareId) {
      this.applyTab(0);
    }

    // 「跟随手机」档要靠系统主题变化事件：手机切深色时小程序也得跟着换
    if (wx.onThemeChange) {
      this.themeListener = () => {
        if (display.load().theme !== 'auto') return;
        this.setData({ pageStyle: display.applyTheme() });
        this.refreshTabs();
      };
      wx.onThemeChange(this.themeListener);
    }
  },

  onUnload() {
    if (this.themeListener && wx.offThemeChange) wx.offThemeChange(this.themeListener);
  },

  /** 让五个 tab 重算内联颜色（课表格子、二课板块色都是算进 data 的） */
  refreshTabs() {
    ['timetable', 'secondclass', 'uni', 'campus', 'me'].forEach((key) => {
      const comp = this.selectComponent(`#tab-${key}`);
      if (comp && typeof comp.notifyShow === 'function') comp.notifyShow();
    });
  },

  onShow() {
    // 从别的页面返回时不会切 tab，得主动让当前那一页刷新一次
    this.notifyCurrent();
    // 子页面里可能改过主题（虽然目前只有「我的」能改），回来对齐一次
    this.setData({ pageStyle: display.applyTheme() });
  },

  notifyCurrent() {
    const keys = ['timetable', 'secondclass', 'uni', 'campus', 'me'];
    const key = keys[this.data.current];
    if (!key) return;
    const comp = this.selectComponent(`#tab-${key}`);
    if (comp && typeof comp.notifyShow === 'function') comp.notifyShow();
  },

  /**
   * 方框外左右滑动切主界面。
   *
   * 课表方框内的手势被组件用 catch 拦下了，容器页收不到 touchstart，
   * 这里的 this.touchStart 因此为 null，直接忽略——两套手势天然分流，
   * 不需要额外判断手指落在了哪个元素上。
   */
  onTouchStart(event) {
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    this.touchStart = { x: touch.clientX, y: touch.clientY, at: Date.now() };
  },

  onTouchEnd(event) {
    const start = this.touchStart;
    this.touchStart = null;
    if (!start) return;

    const touch = event.changedTouches && event.changedTouches[0];
    if (!touch) return;

    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const elapsed = Date.now() - start.at;

    // 竖着滚列表、慢慢拖、距离不够，都不算切页
    if (Math.abs(dx) < 70) return;
    if (Math.abs(dx) <= Math.abs(dy) * 1.5) return;
    if (elapsed > 600) return;

    this.applyTab(dx < 0 ? this.data.current + 1 : this.data.current - 1);
  },

  onTabSwitch(event) {
    this.applyTab(event.detail.index);
  },

  onTabRequest(event) {
    // 页面之间的互跳（比如「我的」里点第二课堂）
    this.applyTab(event.detail.index);
  },

  // 「我的」里改了字号：组件自己存好，这里只负责把页面根的 --fs 换掉
  onFontChange(event) {
    this.setData({ pageStyle: display.pageStyle({ font: event.detail.font, theme: display.load().theme }) });
  },

  // 「我的」里换了外观：整页的变量和导航栏一起换
  onThemeChange(event) {
    this.setData({ pageStyle: display.applyTheme({ font: display.load().font, theme: event.detail.theme }) });
    this.refreshTabs();
  },

  applyTab(index) {
    if (!Number.isInteger(index) || index < 0 || index >= TITLES.length) return;
    if (index === this.data.current) return;
    this.setData({ current: index });
    wx.setNavigationBarTitle({ title: TITLES[index] });
  },

  onShareAppMessage(options) {
    const timetable = this.selectComponent('#tab-timetable');
    if (timetable && typeof timetable.buildShareMessage === 'function') {
      return timetable.buildShareMessage(options);
    }
    return { title: '百小鸮 · 校园助手', path: '/pages/main/index' };
  }
});
