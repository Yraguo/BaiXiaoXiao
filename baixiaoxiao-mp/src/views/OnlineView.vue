<script setup lang="ts">
/**
 * 校园通（照搬 百小鸮 截图）
 * 顶部说明条 → 校园工具 → 校园服务九宫格。
 * 小程序打不开学校站点（web-view 只认已登记的业务域名），所以点卡片是「复制链接」。
 */
import { toast } from '../adapters/platform';
import AppIcon from '../components/AppIcon.vue';

interface Tile {
  key: string;
  name: string;
  desc: string;
  icon: string;
  url: string;
}

const tiles: Tile[] = [
  { key: 'course', name: '北化在线', desc: '在线课程与作业', icon: 'book', url: 'https://course.buct.edu.cn/' },
  { key: 'jwglxt', name: '教务系统', desc: '课表 · 成绩 · 选课', icon: 'school', url: 'https://jwglxt.buct.edu.cn/' },
  { key: 'grade', name: '成绩查询', desc: '识别成绩 · 本机保存', icon: 'chart', url: 'https://jwglxt.buct.edu.cn/jwglxt/cjcx/cxXscjIndex.html?gnmkdm=N305005&layout=default' },
  { key: 'exam', name: '考试查询', desc: '识别考试 · 写进记事本提醒', icon: 'document', url: 'https://jwglxt.buct.edu.cn/jwglxt/kwgl/kscx_cxXsksxxIndex.html?gnmkdm=N358105&layout=default' },
  { key: 'health', name: '健康云', desc: '体质测试与健康数据', icon: 'heartPulse', url: 'https://tygl.buct.edu.cn/' },
  { key: 'library', name: '图书馆', desc: '馆藏检索 · 数据库导航', icon: 'bookmark', url: 'https://library.buct.edu.cn/' },
  { key: 'zy', name: '电子资源', desc: '统一身份认证 · 校外访问', icon: 'key', url: 'https://zy.buct.edu.cn/' },
  { key: 'portal', name: '信息门户', desc: '统一身份认证主入口', icon: 'compass', url: 'https://portal.buct.edu.cn/' },
  { key: 'tree', name: '校园网平台', desc: '网络认证 · 校园网服务', icon: 'link', url: 'https://tree.buct.edu.cn/' },
  { key: 'home', name: '学校主页', desc: '通知公告 · 数字校园', icon: 'home', url: 'https://www.buct.edu.cn/' }
];

function open(t: Tile): void {
  if (!t.url) return;
  uni.setClipboardData({
    data: t.url,
    success: () => toast('链接已复制，去浏览器打开'),
    fail: () => toast('复制失败')
  });
}

function addTile(): void {
  toast('添加自定义入口还没做');
}
function checkLogin(): void {
  toast('教务登录态在「导入课表」里维护');
}
function tools(): void {
  toast('校园工具（地图/场馆/体测/空教室）待接');
}
</script>

<template>
  <scroll-view class="scroll" scroll-y>
    <!-- 说明条 -->
    <view class="banner">
      <text class="b-title">校园通</text>
      <text class="b-sub">学校常用的入口都收在这一页。点卡片会把链接复制到剪贴板，再去浏览器打开。</text>
    </view>

    <!-- 校园工具 -->
    <view class="toolcard" @click="tools">
      <view class="tc-ico"><AppIcon name="compass" :size="22" tone="white" /></view>
      <view class="grow">
        <text class="tc-t">校园工具</text>
        <text class="tc-d">地图 · 场馆状态 · 体测评分 · 空闲教室 · 选课工具</text>
      </view>
      <AppIcon name="chevronRight" :size="15" tone="gray" />
    </view>

    <!-- 服务 -->
    <view class="sec-head">
      <text class="sec-t">校园服务（{{ tiles.length }}）</text>
      <view class="sec-acts">
        <view class="sbtn" @click="addTile">+ 添加</view>
        <view class="sbtn" @click="checkLogin">查登录态</view>
      </view>
    </view>

    <view class="grid">
      <view v-for="t in tiles" :key="t.key" class="tile" @click="open(t)">
        <AppIcon :name="t.icon" :size="22" class="t-ico" />
        <text class="t-name">{{ t.name }}</text>
        <text class="t-desc">{{ t.desc }}</text>
      </view>
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

.banner {
  background: var(--brand);
  border-radius: var(--r);
  padding: 30rpx 28rpx;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}
.b-title {
  font-size: 36rpx;
  line-height: 46rpx;
  font-weight: 700;
  color: #fff;
}
.b-sub {
  font-size: 24rpx;
  line-height: 36rpx;
  color: rgba(255, 255, 255, 0.9);
}

.toolcard {
  display: flex;
  align-items: center;
  gap: 18rpx;
  margin-top: 20rpx;
  padding: 24rpx 24rpx;
  border-radius: var(--r);
  background: var(--card);
}
.tc-ico {
  width: 72rpx;
  height: 72rpx;
  border-radius: 18rpx;
  background: var(--brand-2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.tc-t {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--text);
}
.tc-d {
  display: block;
  font-size: 22rpx;
  color: var(--text-2);
  margin-top: 2rpx;
}

.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 30rpx 4rpx 16rpx;
}
.sec-t {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--text);
}
.sec-acts {
  display: flex;
  gap: 12rpx;
}
.sbtn {
  padding: 8rpx 20rpx;
  border-radius: 14rpx;
  background: var(--brand-tint);
  color: var(--brand);
  font-size: 22rpx;
}

.grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}
.tile {
  width: calc(33.333% - 11rpx);
  background: var(--card);
  border-radius: var(--r);
  padding: 26rpx 14rpx 22rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
}
.tile:active {
  background: var(--soft);
}
.t-ico {
  margin-bottom: 4rpx;
}
.t-name {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--text);
  text-align: center;
}
.t-desc {
  font-size: 20rpx;
  line-height: 28rpx;
  color: var(--text-2);
  text-align: center;
}
</style>
