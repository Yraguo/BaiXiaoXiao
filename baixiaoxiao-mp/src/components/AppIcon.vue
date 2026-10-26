<script setup lang="ts">
/**
 * 图标组件 —— 直接用 百小鸮 的 AppleIcon 路径光栅化出来的 PNG
 *
 * scripts/make-icons.mjs 从原工程 AppleIcon.vue 里读路径生成，
 * 所以形状和原版逐像素一致，不是我自己画的。
 * 色调：blue（浅色主题）/ blueDark（深色主题）/ gray / white / red。
 */
import { computed } from 'vue';
import { isDark } from '../services/theme';

const props = withDefaults(
  defineProps<{
    name: string;
    /** 逻辑尺寸，按 24 为基准；组件内部 ×2 转 rpx */
    size?: number;
    tone?: 'auto' | 'blue' | 'gray' | 'white' | 'red';
  }>(),
  { size: 24, tone: 'auto' }
);

const resolved = computed(() => {
  if (props.tone === 'gray') return 'gray';
  if (props.tone === 'white') return 'white';
  if (props.tone === 'red') return 'red';
  // auto / blue：深色主题用亮一档的蓝
  return isDark.value ? 'blueDark' : 'blue';
});

const src = computed(() => `/static/icons/${props.name}-${resolved.value}.png`);
const px = computed(() => props.size * 2);
</script>

<template>
  <image class="app-icon" :src="src" :style="{ width: px + 'rpx', height: px + 'rpx' }" mode="aspectFit" />
</template>

<style scoped>
.app-icon {
  display: block;
  flex: none;
}
</style>
