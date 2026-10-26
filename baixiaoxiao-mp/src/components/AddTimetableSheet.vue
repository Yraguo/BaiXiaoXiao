<script setup lang="ts">
/**
 * 「添加课表」选择器
 *
 * 产品要求的顺序：**自动在上、手动在下**。
 * 对应 iOS 的 action sheet 形态：两行大号可选行 + 底部一句说明。
 * 自动那行带「推荐」标签和蓝色图标 —— 默认路径一眼可见（HIG：渐进式披露）。
 */
const emit = defineEmits<{
  (e: 'auto'): void;
  (e: 'manual'): void;
  (e: 'demo'): void;
  (e: 'close'): void;
}>();
</script>

<template>
  <view class="mask" @click="emit('close')">
    <view class="sheet" @click.stop>
      <view class="grabber"></view>
      <view class="sheet-head">
        <text class="sh-title">添加课表</text>
        <text class="cancel" @click="emit('close')">取消</text>
      </view>

      <view class="body">
        <!-- ① 自动：放在最上面，权重最高 -->
        <view class="opt primary" @click="emit('auto')">
          <view class="glyph brand">
            <text class="glyph-t">↓</text>
          </view>
          <view class="grow">
            <view class="opt-top">
              <text class="opt-t">从教务系统导入</text>
              <text class="pill brand">推荐</text>
            </view>
            <text class="opt-d">登录一次，课表自动填好</text>
          </view>
          <text class="chev">›</text>
        </view>

        <!-- ② 手动：次要路径 -->
        <view class="opt" @click="emit('manual')">
          <view class="glyph">
            <text class="glyph-t">＋</text>
          </view>
          <view class="grow">
            <text class="opt-t">手动创建课表</text>
            <text class="opt-d">自己一节一节加，或先建一张空表</text>
          </view>
          <text class="chev">›</text>
        </view>

        <view class="note">
          导入只读取课表数据，不保存你的账号密码。教务系统地址不对外提供，仅用于本校学生自助导入。
        </view>

        <view class="demo" @click="emit('demo')">还没有账号？先用示例课表看看 →</view>
      </view>

      <view class="foot-pad"></view>
    </view>
  </view>
</template>

<style scoped>
.sheet {
  background: var(--bg);
}
.cancel {
  font-size: 32rpx;
  color: var(--brand);
  padding: 8rpx 0 8rpx 16rpx;
}
.body {
  padding: 8rpx 32rpx 0;
}
.opt {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 28rpx 24rpx;
  border-radius: var(--r);
  background: var(--card);
  margin-bottom: 20rpx;
}
.opt:active {
  background: var(--pressed);
}
/* 主路径给一层极淡的品牌底 + 细边框，把"推荐"这件事说清楚又不吵 */
.opt.primary {
  background: var(--card);
  border: 1rpx solid rgba(85, 135, 236, 0.28);
}
.glyph {
  width: 88rpx;
  height: 88rpx;
  border-radius: 22rpx;
  background: rgba(120, 120, 128, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.glyph.brand {
  background: var(--brand);
}
.glyph-t {
  font-size: 40rpx;
  line-height: 1;
  color: var(--text-2);
  font-weight: 600;
}
.glyph.brand .glyph-t {
  color: #fff;
}
.opt-top {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.opt-t {
  display: block;
  font-size: 34rpx;
  line-height: 44rpx;
  font-weight: 600;
  color: var(--text);
}
.opt-d {
  display: block;
  font-size: 26rpx;
  line-height: 36rpx;
  color: var(--text-2);
  margin-top: 2rpx;
}
.chev {
  color: var(--text-3);
  font-size: 40rpx;
  line-height: 1;
}
.note {
  font-size: 24rpx;
  line-height: 34rpx;
  color: var(--text-2);
  padding: 12rpx 8rpx 0;
}
.demo {
  font-size: 26rpx;
  color: var(--brand);
  text-align: center;
  padding: 32rpx 0 8rpx;
}
.foot-pad {
  height: calc(24rpx + env(safe-area-inset-bottom));
}
</style>
