<script setup lang="ts">
/**
 * 我的（照搬 百小鸮 截图）
 * 包含「外观与主题」——深色模式就是从这里切的（默认跟随系统）。
 */
import { computed } from 'vue';
import {
  SC_BLOCKS,
  SC_TOTAL,
  blockScore,
  db,
  totalScore,
  activeTimetable,
  activeCourses
} from '../stores/app';
import { readText } from '../adapters/storage';
import { toast } from '../adapters/platform';
import { setThemeMode, themeMode } from '../services/theme';
import AppIcon from '../components/AppIcon.vue';

const score = computed(() => totalScore());
const detail = computed(() => SC_BLOCKS.map((b) => `${b.name} ${blockScore(b.key)}`).join(' · '));

const themeLabel = computed(
  () => ({ system: '跟随系统', light: '浅色', dark: '深色' } as const)[themeMode.value]
);

const name = computed(() => db.session?.displayName || '智小汇');
const account = computed(() => (db.session ? 'admin · 北京化工大学' : 'admin · 北京化工大学'));

function pickTheme(): void {
  uni.showActionSheet({
    itemList: ['跟随系统', '浅色', '深色'],
    success: (res) => {
      const v = (['system', 'light', 'dark'] as const)[res.tapIndex];
      setThemeMode(v);
      toast('已切换：' + (v === 'system' ? '跟随系统' : v === 'light' ? '浅色' : '深色'));
    }
  });
}

function go(key: string): void {
  if (key === 'theme') {
    pickTheme();
    return;
  }
  if (key === 'backup') {
    const raw = readText('state/v2');
    if (!raw) {
      toast('本机还没有数据');
      return;
    }
    uni.setClipboardData({
      data: raw,
      success: () => toast('已复制本机数据到剪贴板'),
      fail: () => toast('复制失败')
    });
    return;
  }
  toast('这一项还没接');
}

function changeAvatar(): void {
  toast('头像暂用姓名首字');
}

const pref = [
  { key: 'notify', icon: 'bell', t: '通知设置', d: '上课提醒、待办提醒与权限' },
  { key: 'theme', icon: 'moon', t: '外观与主题', d: () => `深浅模式与字号 · 当前${themeLabel.value}` },
  { key: 'watermark', icon: 'droplet', t: '拍照水印', d: '内容、透明度与默认状态' },
  { key: 'weather', icon: 'cloudSun', t: '天气', d: '未开启' }
];
</script>

<template>
  <scroll-view class="scroll" scroll-y>
    <!-- 资料卡 -->
    <view class="card profile">
      <view class="avatar">{{ name.slice(0, 1) }}</view>
      <view class="grow">
        <view class="p-row">
          <text class="p-name">{{ name }}</text>
          <text class="pill demo">演示模式</text>
        </view>
        <text class="p-sub">{{ account }}</text>
        <text class="p-link" @click="changeAvatar">设置头像</text>
      </view>
    </view>

    <!-- 二课自评 -->
    <view class="card sum">
      <view class="sum-row">
        <text class="sum-t">第二课堂累计自评</text>
        <text class="sum-v">{{ score }} / {{ SC_TOTAL }}</text>
      </view>
      <text class="sum-d">{{ detail }}</text>
    </view>

    <!-- 偏好设置 -->
    <view class="section-title">偏好设置</view>
    <view class="list">
      <view v-for="p in pref" :key="p.key" class="li" @click="go(p.key)">
        <AppIcon :name="p.icon" :size="20" class="li-ico" />
        <view class="grow">
          <text class="li-t">{{ p.t }}</text>
          <text class="li-d">{{ typeof p.d === 'function' ? p.d() : p.d }}</text>
        </view>
        <AppIcon name="chevronRight" :size="16" tone="gray" class="chev" />
      </view>
    </view>

    <!-- 数据与支持 -->
    <view class="section-title">数据与支持</view>
    <view class="list">
      <view class="li" @click="go('backup')">
        <AppIcon name="archive" :size="20" class="li-ico" />
        <view class="grow">
          <text class="li-t">备份与恢复</text>
          <text class="li-d">导出或导入备份</text>
        </view>
        <text class="chev">›</text>
      </view>
    </view>

    <view class="foot">
      <view>{{ activeTimetable?.name || '还没有课表' }} · {{ activeCourses.length }} 门课</view>
      <view style="margin-top: 6rpx">百小鸮 · 北化校园学习生活助手</view>
      <view style="margin-top: 6rpx; opacity: 0.75">果崇舜 · 刘佳乐 · 赵梓缘</view>
    </view>
    <view style="height: 160rpx"></view>
  </scroll-view>
</template>

<style scoped>
.scroll {
  flex: 1;
  height: 0;
  padding: 4rpx var(--pad) 0;
}
.card {
  background: var(--card);
  border-radius: var(--r);
}

/* 资料卡 */
.profile {
  display: flex;
  align-items: center;
  gap: 22rpx;
  padding: 28rpx 26rpx;
}
.avatar {
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
  background: var(--brand);
  color: #fff;
  font-size: 44rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.p-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.p-name {
  font-size: 40rpx;
  line-height: 50rpx;
  font-weight: 700;
  color: var(--text);
}
.pill.demo {
  background: rgba(255, 149, 0, 0.14);
  color: #b26b00;
  font-size: 22rpx;
}
.p-sub {
  display: block;
  font-size: 24rpx;
  color: var(--text-2);
  margin-top: 2rpx;
}
.p-link {
  display: block;
  font-size: 24rpx;
  color: var(--brand);
  margin-top: 10rpx;
}

/* 自评摘要 */
.sum {
  margin-top: 20rpx;
  padding: 26rpx;
}
.sum-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.sum-t {
  font-size: 26rpx;
  color: var(--text-2);
}
.sum-v {
  font-size: 34rpx;
  font-weight: 700;
  color: var(--text);
}
.sum-d {
  display: block;
  font-size: 24rpx;
  color: var(--text-2);
  margin-top: 10rpx;
}

/* 设置分组 */
.section-title {
  padding: 34rpx 8rpx 12rpx;
}
.list {
  background: var(--card);
  border-radius: var(--r);
  overflow: hidden;
}
.li {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 22rpx 24rpx;
  position: relative;
}
.li + .li::before {
  content: '';
  position: absolute;
  left: 88rpx;
  right: 0;
  top: 0;
  height: 1px;
  background: var(--line);
  transform: scaleY(0.5);
}
.li:active {
  background: var(--soft);
}
.li-ico {
  width: 44rpx;
  flex-shrink: 0;
}
.li-t {
  display: block;
  font-size: 30rpx;
  color: var(--text);
}
.li-d {
  display: block;
  font-size: 22rpx;
  color: var(--text-2);
  margin-top: 2rpx;
}
.chev {
  flex-shrink: 0;
}

.foot {
  text-align: center;
  font-size: 22rpx;
  line-height: 34rpx;
  color: var(--text-3);
  padding: 48rpx 0 0;
}
</style>
