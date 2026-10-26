<script setup lang="ts">
import { onLaunch, onShow } from '@dcloudio/uni-app';
import { bootTrace } from './adapters/platform';

onLaunch(() => {
  bootTrace('launch');
});
onShow(() => {
  bootTrace('show');
});
</script>

<style>
/* ===================================================================
 * 百小鸮 · 全局样式（Apple HIG 版）
 *
 * 设计令牌直接对着 iOS 系统语义取值，不再自己拍：
 *   字号：Large Title 34pt / Headline 17pt / Body 17pt / Subhead 15pt / Footnote 13pt / Caption 12pt
 *   间距：页边距 20pt，列表行高 44pt，圆角 10pt（分组列表）/ 12pt（按钮）
 *   颜色：systemGroupedBackground、label/secondaryLabel/tertiaryLabel、separator
 * 单位用 rpx（750rpx = 屏宽 ≈ 375pt），所以 1pt ≈ 2rpx。
 *
 * 三处**必须**和原工程不同的地方（小程序不支持）：
 *   1) :root        → page（小程序没有 <html>）
 *   2) color-mix()  → 预先算好的 rgba
 *   3) backdrop-filter → 半透明 + 实色兜底（安卓上时灵时不灵，不做依赖）
 * =================================================================== */

page {
  /* ---------- 品牌（取自 logo） ---------- */
  /* 品牌蓝沿用 百小鸮 的 --brand，保证和原版一致 */
  --brand: #2c6fe0;
  --brand-deep: #245fc4;
  --brand-2: #5856d6;
  --brand-tint: rgba(44, 111, 224, 0.12);

  /* ---------- 系统语义色（iOS 浅色） ---------- */
  --bg: #f2f2f7; /* systemGroupedBackground */
  --card: #ffffff; /* secondarySystemGroupedBackground */
  --text: #000000; /* label */
  --text-2: rgba(60, 60, 67, 0.6); /* secondaryLabel */
  --text-3: rgba(60, 60, 67, 0.3); /* tertiaryLabel */
  --ink: #16233a;
  --muted: #8e8e93; /* systemGray */
  --line: rgba(60, 60, 67, 0.16);
  --hairline: rgba(60, 60, 67, 0.29);
  --grid: rgba(60, 60, 67, 0.12);
  --soft: #f2f2f7;
  --soft-2: #e5e5ea;
  --field: #f2f2f7;
  --tint: rgba(44, 111, 224, 0.1);
  --pressed: rgba(60, 60, 67, 0.08);

  --danger: #ff3b30;
  --ok: #34c759;
  --warn: #ff9500;

  /* ---------- 几何 ---------- */
  --r: 20rpx; /* 10pt 分组列表圆角 */
  --r-btn: 24rpx; /* 12pt 按钮圆角 */
  --pad: 40rpx; /* 20pt 页边距 */
  --row: 88rpx; /* 44pt 最小点击区 */
  --shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.04);

  background: var(--bg);
  color: var(--text);
  font-size: 34rpx; /* Body 17pt */
  line-height: 44rpx;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif;
  -webkit-font-smoothing: antialiased;
}

view,
text,
button,
input,
textarea,
scroll-view,
picker {
  box-sizing: border-box;
}

/* ---------- 排版骨架（类名与原工程一致，搬组件时不用改 class） ---------- */
.screen {
  height: calc(100vh - var(--window-bottom, 0px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}
.pad {
  padding: var(--pad);
}
.grow {
  flex: 1;
  min-width: 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 20rpx;
}
.col {
  display: flex;
  flex-direction: column;
}
.muted {
  color: var(--text-2);
}
.small {
  font-size: 26rpx; /* Footnote 13pt */
  line-height: 36rpx;
}
.caption {
  font-size: 24rpx; /* Caption 12pt */
  line-height: 32rpx;
  color: var(--text-2);
}
.bold {
  font-weight: 600;
}
.center {
  text-align: center;
}

/* iOS 大标题：34pt，字距略收 */
.title {
  font-size: 68rpx; /* Large Title 34pt */
  line-height: 82rpx;
  font-weight: 700;
  letter-spacing: -1rpx;
  color: var(--text);
}
/* 分节标题：13pt 灰字，和 iOS 分组列表一致 */
.section-title {
  font-size: 26rpx;
  line-height: 36rpx;
  color: var(--text-2);
  padding: 0 8rpx 12rpx;
  letter-spacing: 0.5rpx;
}

/* ---------- 卡片 / 分组列表 ---------- */
.card {
  background: var(--card);
  border-radius: var(--r);
  padding: 32rpx;
}
.card + .card {
  margin-top: 36rpx;
}
.list {
  background: var(--card);
  border-radius: var(--r);
  overflow: hidden;
}
.li {
  width: 100%;
  min-height: var(--row);
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 16rpx 32rpx;
  position: relative;
  text-align: left;
  background: transparent;
  font-size: 34rpx;
}
/* 分隔线从文字起点开始（iOS inset separator） */
.li::after {
  content: '';
  position: absolute;
  left: 32rpx;
  right: 0;
  bottom: 0;
  height: 1px;
  background: var(--line);
  transform: scaleY(0.5);
  transform-origin: bottom;
}
.li:last-child::after {
  display: none;
}
.li:active {
  background: var(--pressed);
}

/* ---------- 按钮 ---------- */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  min-height: 88rpx; /* 44pt */
  padding: 0 32rpx;
  border-radius: var(--r-btn);
  background: var(--brand);
  color: #fff;
  font-weight: 600;
  font-size: 34rpx;
  line-height: 1;
  border: 0;
}
.btn::after {
  border: 0;
}
.btn:active {
  opacity: 0.8;
  transform: scale(0.97);
}
.btn.block {
  width: 100%;
}
.btn.ghost {
  background: var(--card);
  color: var(--brand);
  border: 1rpx solid var(--line);
}
.btn.grey {
  background: var(--soft-2);
  color: var(--text);
}
.btn.danger {
  background: rgba(255, 59, 48, 0.1);
  color: var(--danger);
}
.btn.warn {
  background: rgba(255, 149, 0, 0.12);
  color: var(--warn);
}
.btn.sm {
  min-height: 68rpx;
  padding: 0 24rpx;
  border-radius: 18rpx;
  font-size: 28rpx;
}
.btn[disabled],
.btn:disabled {
  opacity: 0.45;
}

/* ---------- 胶囊 / 标签 ---------- */
.pill {
  display: inline-block;
  padding: 2rpx 16rpx;
  border-radius: 999rpx;
  font-size: 24rpx;
  line-height: 34rpx;
  background: var(--soft-2);
  color: var(--text-2);
  font-weight: 500;
}
.pill.brand {
  background: var(--tint);
  color: var(--brand);
}
.pill.warn {
  background: rgba(255, 149, 0, 0.12);
  color: #b26b00;
}
.pill.ok {
  background: rgba(52, 199, 89, 0.14);
  color: #1f7a4d;
}
.pill.danger {
  background: rgba(255, 59, 48, 0.1);
  color: var(--danger);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}
.chip {
  min-height: 72rpx;
  padding: 14rpx 24rpx;
  border-radius: 20rpx;
  border: 1rpx solid var(--line);
  background: var(--card);
  font-size: 28rpx;
  color: var(--text);
}
.chip.on {
  background: var(--brand);
  color: #fff;
  border-color: var(--brand);
}

/* ---------- 表单 ---------- */
.field {
  margin-bottom: 28rpx;
}
.lab {
  display: block;
  font-size: 26rpx;
  line-height: 36rpx;
  color: var(--text-2);
  padding: 0 8rpx 10rpx;
  letter-spacing: 0.3rpx;
}
.ipt,
.pick {
  width: 100%;
  min-height: 88rpx;
  padding: 0 28rpx;
  border-radius: 20rpx;
  background: var(--card);
  border: 1rpx solid transparent;
  font-size: 34rpx;
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ph {
  color: var(--text-3);
}

/* ---------- 页头（自定义导航，pages.json 里 navigationStyle=custom） ---------- */
/* 状态栏高度小程序拿不到 CSS 变量，只能运行时读 statusBarHeight，由页面 :style 补 paddingTop。 */
.head {
  padding: 16rpx var(--pad) 20rpx;
  background: var(--bg);
  flex-shrink: 0;
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}
/* 头部只放一个圆形按钮（iOS toolbar button 形态） */
.icon-btn {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: rgba(120, 120, 128, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.icon-btn:active {
  background: rgba(120, 120, 128, 0.2);
}

/* ---------- 滚动容器 ---------- */
.scroll {
  flex: 1;
  height: 0;
  padding: 0 var(--pad) calc(40rpx + env(safe-area-inset-bottom));
}

.empty {
  text-align: center;
  padding: 88rpx 44rpx;
  color: var(--text-2);
}
.empty .big {
  font-size: 68rpx;
  margin-bottom: 16rpx;
  display: block;
}
.hairline {
  height: 1px;
  background: var(--line);
  transform: scaleY(0.5);
  margin: 24rpx 0;
}
.toast {
  position: fixed;
  left: 50%;
  top: 120rpx;
  transform: translateX(-50%);
  z-index: 215;
  background: rgba(22, 35, 58, 0.9);
  color: #fff;
  padding: 20rpx 32rpx;
  border-radius: 44rpx;
  font-size: 28rpx;
  max-width: 86vw;
}

/* ---------- 底部弹层（iOS sheet：顶部有个 grabber） ---------- */
.mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: var(--window-bottom, 0px);
  background: rgba(0, 0, 0, 0.4);
  z-index: 80;
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  background: var(--bg);
  border-radius: 28rpx 28rpx 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.grabber {
  width: 72rpx;
  height: 10rpx;
  border-radius: 5rpx;
  background: rgba(60, 60, 67, 0.3);
  margin: 16rpx auto 0;
  flex-shrink: 0;
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 32rpx 16rpx;
  flex-shrink: 0;
}
.sh-title {
  font-size: 40rpx; /* Title3 20pt */
  line-height: 50rpx;
  font-weight: 600;
  letter-spacing: -0.4rpx;
}
.sheet-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 8rpx 32rpx 0;
}
.sheet-foot {
  display: flex;
  gap: 20rpx;
  padding: 20rpx 32rpx calc(20rpx + env(safe-area-inset-bottom));
  flex-shrink: 0;
}
/* ===================== 深色模式 =====================
 * 挂在页面根节点（.screen）上，变量在这里整体换一套。
 * 颜色对着 iOS 深色语义取：systemBackground #000、secondarySystemGrouped #1C1C1E、
 * label #FFF、secondaryLabel 60% 白、separator #545458。
 * 品牌蓝在深色下要提亮一档（#4C8DF6），否则压在黑底上发闷。
 */
.theme-dark {
  --brand: #4c8df6;
  --brand-deep: #6ba1ff;
  --brand-2: #7d7bff;
  --brand-tint: rgba(76, 141, 246, 0.16);

  --bg: #000000;
  --card: #1c1c1e;
  --text: #ffffff;
  --text-2: rgba(235, 235, 245, 0.6);
  --text-3: rgba(235, 235, 245, 0.32);
  --ink: #ffffff;
  --muted: rgba(235, 235, 245, 0.6);
  --line: rgba(84, 84, 88, 0.55);
  --hairline: rgba(84, 84, 88, 0.55);
  --grid: rgba(84, 84, 88, 0.4);
  --soft: #2c2c2e;
  --soft-2: #3a3a3c;
  --field: #2c2c2e;
  --tint: rgba(76, 141, 246, 0.16);
  --pressed: rgba(255, 255, 255, 0.08);
  --shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.35);
}
/* 深色下白色系控件要压暗（这是组件里唯一允许写死颜色的地方，其余都走变量） */
.theme-dark .btn.ghost {
  background: var(--soft);
  color: var(--brand);
  border-color: var(--line);
}
.theme-dark .seg {
  background: rgba(120, 120, 128, 0.24) !important;
}
.theme-dark .seg-item.on {
  background: #48484a !important;
  color: #fff !important;
  box-shadow: none !important;
}
.theme-dark .wk {
  background: rgba(120, 120, 128, 0.24) !important;
  color: var(--text-2) !important;
}
.theme-dark .wk.on {
  background: var(--brand) !important;
  color: #fff !important;
}
.theme-dark .icon-btn {
  background: rgba(120, 120, 128, 0.28);
}
</style>
