<script setup lang="ts">
/**
 * 主界面（照搬 百小鸮 的单页 + 自绘 tabBar）
 *
 * 为什么不用原生 tabBar：
 *   ① 原生 tabBar 的颜色只能靠 pages.json / theme.json 配，深色切换要多写一份配置还容易漏；
 *   ② 原工程本来就是单页 + `db.activeTab` 切视图，照搬最省事；
 *   ③ 自绘才能做出截图里那种细分割线 + 毛玻璃质感的底栏。
 */
import { computed, onMounted } from 'vue';
import { db, activeTimetable } from '../../stores/app';
import { themeClass, initTheme } from '../../services/theme';
import { statusBarHeight, toast } from '../../adapters/platform';
import TimetableView from '../../views/TimetableView.vue';
import NotesView from '../../views/NotesView.vue';
import SecondClassView from '../../views/SecondClassView.vue';
import XiaoView from '../../views/XiaoView.vue';
import OnlineView from '../../views/OnlineView.vue';
import MeView from '../../views/MeView.vue';

const statusBar = statusBarHeight();
const TABS = [
  { label: '课表', icon: 'calendar' },
  { label: '第二课堂', icon: 'award' },
  { label: '小鸮', icon: 'star' },
  { label: '校园通', icon: 'book' },
  { label: '我的', icon: 'user' }
];

const sheet = computed({
  get: () => db.activeSheet,
  set: (v: 'grid' | 'list') => {
    db.activeSheet = v;
  }
});

const TITLES = ['课程表', '第二课堂', '小鸮', '校园通', '我的'];
const tabTitle = computed(() => TITLES[db.activeTab] || '百小鸮');
const isDemo = computed(() => db.session?.isDemo ?? true);

const subline = computed(() => {
  const d = new Date();
  const w = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  const name = db.session?.displayName || '智小汇';
  const week = activeTimetable.value ? `第 ${db.currentWeek} 周 · ` : '';
  return `${d.getMonth() + 1}月${d.getDate()}日 ${w} · ${week}${name}`;
});

function switchTab(i: number): void {
  db.activeTab = i;
}

onMounted(() => {
  initTheme();
});
</script>

<template>
  <view class="screen" :class="themeClass">
    <!-- 页头 -->
    <view class="head" :style="{ paddingTop: statusBar + 8 + 'px' }">
      <view class="bar">
        <view class="grow">
          <view class="h-title">{{ tabTitle }}</view>
          <view class="h-sub">{{ subline }}</view>
        </view>
        <text v-if="isDemo" class="pill demo">演示模式</text>
      </view>

      <!-- 课表页的分段控件（课表 / 记事本） -->
      <view v-if="db.activeTab === 0" class="seg">
        <view class="seg-item" :class="{ on: sheet === 'grid' }" @click="sheet = 'grid'">课表</view>
        <view class="seg-item" :class="{ on: sheet === 'list' }" @click="sheet = 'list'">记事本</view>
      </view>
    </view>

    <!-- 视图 -->
    <TimetableView v-if="db.activeTab === 0 && sheet === 'grid'" />
    <NotesView v-else-if="db.activeTab === 0" />
    <SecondClassView v-else-if="db.activeTab === 1" />
    <XiaoView v-else-if="db.activeTab === 2" />
    <OnlineView v-else-if="db.activeTab === 3" />
    <MeView v-else />

    <!-- 自绘 tabBar -->
    <view class="tabbar">
      <view
        v-for="(t, i) in TABS"
        :key="t.label"
        class="tab"
        :class="{ on: db.activeTab === i }"
        @click="switchTab(i)"
      >
        <image
          class="tab-ic"
          :src="`/static/tabbar/${t.icon}${db.activeTab === i ? '-on' : ''}.png`"
          mode="aspectFit"
        />
        <text class="tab-lb">{{ t.label }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.h-title {
  font-size: 52rpx;
  line-height: 64rpx;
  font-weight: 700;
  letter-spacing: -0.8rpx;
  color: var(--text);
}
.h-sub {
  font-size: 26rpx;
  line-height: 36rpx;
  color: var(--text-2);
  margin-top: 2rpx;
}
.pill.demo {
  background: rgba(255, 149, 0, 0.14);
  color: #b26b00;
  font-size: 24rpx;
  padding: 6rpx 18rpx;
  flex-shrink: 0;
}

.seg {
  display: flex;
  gap: 4rpx;
  margin-top: 20rpx;
  padding: 5rpx;
  border-radius: 20rpx;
  background: rgba(120, 120, 128, 0.14);
}
.seg-item {
  flex: 1;
  text-align: center;
  padding: 12rpx 0;
  border-radius: 16rpx;
  font-size: 30rpx;
  color: var(--text-2);
}
.seg-item.on {
  background: var(--card);
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.08);
}

/* ---------- tabBar ---------- */
.tabbar {
  display: flex;
  align-items: stretch;
  padding: 8rpx 8rpx calc(8rpx + env(safe-area-inset-bottom));
  background: var(--card);
  border-top: 1px solid var(--line);
  flex-shrink: 0;
}
.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
  min-height: 92rpx;
  padding: 8rpx 2rpx 6rpx;
}
.tab-ic {
  width: 46rpx;
  height: 46rpx;
}
.tab-lb {
  font-size: 20rpx;
  line-height: 26rpx;
  color: var(--text-2);
}
.tab.on .tab-lb {
  color: var(--brand);
  font-weight: 600;
}
</style>
