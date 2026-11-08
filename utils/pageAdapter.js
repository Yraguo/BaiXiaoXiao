/**
 * 把原来的 Page 对象适配成自定义组件。
 *
 * 为什么需要它：swiper 方案要求五个 tab 页都变成组件，但页面逻辑里大量使用
 * this.setData / this.data / 各种方法，逐个改写成 Component 的 methods 结构
 * 既啰嗦又容易漏。这里让原对象原样保留为 `pageLogic`，只在外面套一层壳，
 * 把生命周期重新接到组件的生命周期上——业务代码一行不用动。
 *
 * 生命周期映射：
 *   Page.onLoad(options)  → lifetimes.attached（options 由容器的 pageQuery 属性传入）
 *   Page.onReady()        → lifetimes.ready
 *   Page.onShow()         → active 属性 observer（false → true 时触发）
 *   Page.onHide()         → active 属性 observer（true → false 时触发）
 *   Page.onUnload()       → lifetimes.detached
 *   Page.onShareAppMessage→ methods.buildShareMessage（容器页转发时调用）
 *   Page.onPullDownRefresh→ methods.pullDownRefresh（scroll-view 的下拉刷新调用）
 *
 * 样式必须放行：所有页面都依赖 app.wxss 里的 .primary-button / .page-shell
 * 这些公共类，而组件默认样式隔离，不加 apply-shared 会整页丢样式。
 */

const PAGE_ONLY = [
  'onLoad', 'onShow', 'onHide', 'onUnload', 'onReady',
  'onPullDownRefresh', 'onReachBottom', 'onShareAppMessage',
  'onShareTimeline', 'onPageScroll', 'onResize'
];

function collectMethods(logic) {
  const methods = {};

  Object.keys(logic).forEach((key) => {
    if (key === 'data') return;
    if (PAGE_ONLY.indexOf(key) >= 0) return;
    if (typeof logic[key] === 'function') methods[key] = logic[key];
  });

  // 页面级回调在组件里没有对应项，改个名字交给容器页调用
  if (typeof logic.onShareAppMessage === 'function') {
    methods.buildShareMessage = logic.onShareAppMessage;
  }
  if (typeof logic.onPullDownRefresh === 'function') {
    methods.pullDownRefresh = logic.onPullDownRefresh;
  }

  return methods;
}

function adapt(logic) {
  return {
    options: {
      styleIsolation: 'apply-shared',
      // 不生成组件宿主节点：swiper-item 里塞一层不认识高度的宿主，
      // 内部 scroll-view 的 100% 就落空了。virtualHost 让根节点直接顶上。
      virtualHost: true
    },

    properties: {
      // 当前是不是被选中的那一个：容器页切 swiper 时传入，用来补 onShow / onHide
      active: {
        type: Boolean,
        value: false,
        observer(active) {
          if (!this.__pageReady) return;
          if (active && typeof logic.onShow === 'function') logic.onShow.call(this);
          if (!active && typeof logic.onHide === 'function') logic.onHide.call(this);
        }
      },
      // 页面参数：容器页把 onLoad 收到的 query 传进来，替代 Page 的 options
      pageQuery: {
        type: Object,
        value: {}
      }
    },

    data: logic.data || {},

    lifetimes: {
      attached() {
        if (typeof logic.onLoad === 'function') {
          logic.onLoad.call(this, this.data.pageQuery || {});
        }
        this.__pageReady = true;
        // 首个 tab 进来时 active 已经是 true，observer 早于 attached 触发过，这里补一次
        if (this.data.active && typeof logic.onShow === 'function') logic.onShow.call(this);
      },
      ready() {
        if (typeof logic.onReady === 'function') logic.onReady.call(this);
      },
      detached() {
        this.__pageReady = false;
        if (typeof logic.onUnload === 'function') logic.onUnload.call(this);
      }
    },

    methods: Object.assign({
      // 容器页 onShow 时调用：从设置页、导入页返回时不换 tab，靠这个补一次刷新
      notifyShow() {
        if (typeof logic.onShow === 'function') logic.onShow.call(this);
      }
    }, collectMethods(logic))
  };
}

module.exports = { adapt };
