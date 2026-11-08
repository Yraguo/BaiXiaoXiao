const TABS = [
  { text: '课表', icon: '/assets/tabbar/timetable.png', active: '/assets/tabbar/timetable-active.png' },
  { text: '第二课堂', icon: '/assets/tabbar/secondclass.png', active: '/assets/tabbar/secondclass-active.png' },
  { text: '小鸮', icon: '/assets/tabbar/uni.png', active: '/assets/tabbar/uni-active.png' },
  { text: '校园', icon: '/assets/tabbar/campus.png', active: '/assets/tabbar/campus-active.png' },
  { text: '我的', icon: '/assets/tabbar/me.png', active: '/assets/tabbar/me-active.png' }
];

Component({
  properties: {
    // 由容器页驱动：swiper 滑到哪一项，这里的高亮块就平移到哪一项
    current: { type: Number, value: 0 }
  },

  data: { tabs: TABS },

  methods: {
    onTap(event) {
      const index = Number(event.currentTarget.dataset.index);
      if (!Number.isInteger(index) || index === this.data.current) return;
      this.triggerEvent('switch', { index });
    }
  }
});
