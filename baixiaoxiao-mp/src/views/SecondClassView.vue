<script setup lang="ts">
/**
 * 第二课堂（照搬 百小鸮 截图）
 *   三个子页：二课填报 / 志愿时长 / 劳育时长
 *   自评 600 分制，五板块（德智体美劳）分数上限来自学生手册。
 */
import { computed, ref } from 'vue';
import {
  SC_BLOCKS,
  SC_TOTAL,
  addHour,
  addRecord,
  blockScore,
  db,
  hourTotal,
  totalScore,
  type BlockKey
} from '../stores/app';
import { toast } from '../adapters/platform';
import AppIcon from '../components/AppIcon.vue';

const tab = ref<'fill' | 'volunteer' | 'labor'>('fill');
const filter = ref<BlockKey | 'all'>('all');

const TABS = [
  { k: 'fill', label: '二课填报', icon: 'award' },
  { k: 'volunteer', label: '志愿时长', icon: 'handHeart' },
  { k: 'labor', label: '劳育时长', icon: 'broom' }
] as const;

const score = computed(() => totalScore());
const pct = computed(() => Math.round((score.value / SC_TOTAL) * 100));

function scoreOf(k: BlockKey): number {
  return blockScore(k);
}

const records = computed(() =>
  filter.value === 'all' ? db.records : db.records.filter((r) => r.block === filter.value)
);

const hours = computed(() =>
  tab.value === 'volunteer'
    ? db.hours.filter((h) => h.kind === 'volunteer')
    : db.hours.filter((h) => h.kind === 'labor')
);

const hourSum = computed(() => hourTotal(tab.value === 'volunteer' ? 'volunteer' : 'labor'));

function blockName(k: BlockKey): string {
  return SC_BLOCKS.find((b) => b.key === k)?.name || '';
}
function blockColor(k: BlockKey): string {
  return { de: '#2C6FE0', zhi: '#3FA97B', ti: '#E8A33D', mei: '#C9547E', lao: '#8E6BC9' }[k];
}

/** 填报一条（分数用快捷档，先做最小闭环） */
async function addFill(): Promise<void> {
  const r = await new Promise<string>((resolve) => {
    uni.showModal({
      title: '填报一条二课',
      editable: true,
      placeholderText: '活动名称，例如：社区志愿服务',
      confirmText: '下一步',
      confirmColor: '#2C6FE0',
      success: (res: any) => resolve(res.confirm ? String(res.content || '').trim() : ''),
      fail: () => resolve('')
    });
  });
  if (!r) return;
  addRecord({ title: r, block: filter.value === 'all' ? 'de' : filter.value, score: 10 });
  toast('已记下，10 分');
}

async function addHourEntry(): Promise<void> {
  const r = await new Promise<string>((resolve) => {
    uni.showModal({
      title: tab.value === 'volunteer' ? '记一次志愿服务' : '记一次劳动实践',
      editable: true,
      placeholderText: '名称，例如：社区志愿服务',
      confirmText: '记 2 小时',
      confirmColor: '#2C6FE0',
      success: (res: any) => resolve(res.confirm ? String(res.content || '').trim() : ''),
      fail: () => resolve('')
    });
  });
  if (!r) return;
  addHour({ title: r, kind: tab.value === 'volunteer' ? 'volunteer' : 'labor', hours: 2 });
  toast('已记 2 小时');
}

function showHandbook(): void {
  uni.showModal({
    title: '手册分值表（节选）',
    content: SC_BLOCKS.map((b) => `${b.name}·${b.full}　上限 ${b.fullScore}`).join('\n'),
    showCancel: false,
    confirmText: '知道了',
    confirmColor: '#2C6FE0'
  });
}

function exportPack(): void {
  toast('材料包导出要接文件系统，先留个入口');
}
</script>

<template>
  <view class="wrap">
    <!-- 三个子页 -->
    <view class="tabs">
      <view v-for="t in TABS" :key="t.k" class="titem" :class="{ on: tab === t.k }" @click="tab = t.k">
        <AppIcon :name="t.icon" :size="13" :tone="tab === t.k ? 'blue' : 'gray'" class="tico" />
        <text class="tlb">{{ t.label }}</text>
      </view>
    </view>

    <scroll-view class="scroll" scroll-y>
      <!-- ============ 二课填报 ============ -->
      <template v-if="tab === 'fill'">
        <view class="card score">
          <view class="s-top">
            <text class="s-num">{{ score }}</text>
            <text class="s-cap">合计自评 / {{ SC_TOTAL }}</text>
          </view>
          <view v-for="b in SC_BLOCKS" :key="b.key" class="brow">
            <text class="bname">{{ b.name }}</text>
            <view class="btrack"><view class="bfill" :style="{ width: Math.min(100, (blockScore(b.key) / b.fullScore) * 100) + '%' }"></view></view>
            <text class="bnum">{{ blockScore(b.key) }}/{{ b.fullScore }}</text>
          </view>
        </view>

        <view class="actbtn" @click="showHandbook">
          <AppIcon name="book" :size="14" class="ab-ico" />
          <text class="ab-t">手册分值表（板块上限 / 学科 / 体育 / 美育 / 计分条款）</text>
        </view>

        <view class="primary" @click="exportPack">
          <AppIcon name="archive" :size="14" tone="white" class="p-ico" />
          <text class="p-t">导出全部二课材料包（照片 + 清单，用于填报学校系统）</text>
        </view>

        <view class="chips">
          <view class="chip" :class="{ on: filter === 'all' }" @click="filter = 'all'">全部</view>
          <view
            v-for="b in SC_BLOCKS"
            :key="b.key"
            class="chip"
            :class="{ on: filter === b.key }"
            @click="filter = b.key"
          >{{ b.name }}·{{ b.full }}</view>
        </view>

        <view v-if="!records.length" class="empty"><text>还没有填报记录</text></view>
        <view v-else class="list">
          <view v-for="r in records" :key="r.id" class="li">
            <view class="badge" :style="{ background: blockColor(r.block) }">{{ blockName(r.block) }}</view>
            <view class="grow">
              <view class="r-title">{{ r.title }}</view>
              <view class="r-sub">{{ r.at }}<text v-if="r.photos"> · {{ r.photos }} 张照片</text><text v-if="r.note"> · {{ r.note }}</text></view>
            </view>
            <text class="r-score">+{{ r.score }}</text>
          </view>
        </view>
      </template>

      <!-- ============ 志愿 / 劳育 ============ -->
      <template v-else>
        <view class="card hours">
          <text class="h-num">{{ hourSum }}</text>
          <text class="h-cap">累计{{ tab === 'volunteer' ? '志愿' : '劳育' }}时长（小时）</text>
        </view>

        <view v-if="!hours.length" class="empty"><text>还没有记录</text></view>
        <view v-else class="list">
          <view v-for="h in hours" :key="h.id" class="li">
            <view class="badge" :style="{ background: tab === 'volunteer' ? '#2C6FE0' : '#8E6BC9' }">{{ tab === 'volunteer' ? '志' : '劳' }}</view>
            <view class="grow">
              <view class="r-title">{{ h.title }}</view>
              <view class="r-sub">{{ h.at }}</view>
            </view>
            <text class="r-score">{{ h.hours }}h</text>
          </view>
        </view>
      </template>

      <view style="height: 180rpx"></view>
    </scroll-view>

    <view class="fab-act" @click="tab === 'fill' ? addFill() : addHourEntry()">
      {{ tab === 'fill' ? '填报活动' : '记一条' }}
    </view>
  </view>
</template>

<style scoped>
.wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 子页 tabs */
.tabs {
  display: flex;
  gap: 4rpx;
  margin: 4rpx var(--pad) 16rpx;
  padding: 5rpx;
  border-radius: 20rpx;
  background: rgba(120, 120, 128, 0.12);
  flex-shrink: 0;
}
.titem {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  padding: 12rpx 0;
  border-radius: 16rpx;
}
.titem.on {
  background: var(--card);
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.08);
}
.tico {
  margin-right: 2rpx;
}
.tlb {
  font-size: 26rpx;
  color: var(--text-2);
}
.titem.on .tlb {
  color: var(--text);
  font-weight: 600;
}

.scroll {
  flex: 1;
  height: 0;
  padding: 0 var(--pad);
}

/* 自评卡 */
.card {
  background: var(--card);
  border-radius: var(--r);
  padding: 28rpx 26rpx;
}
.s-top {
  display: flex;
  align-items: baseline;
  gap: 14rpx;
  margin-bottom: 8rpx;
}
.s-num {
  font-size: 76rpx;
  line-height: 84rpx;
  font-weight: 700;
  color: var(--brand);
  letter-spacing: -1rpx;
}
.s-cap {
  font-size: 26rpx;
  color: var(--text-2);
}
.brow {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 10rpx 0;
}
.bname {
  width: 40rpx;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--text);
  flex-shrink: 0;
}
.btrack {
  flex: 1;
  height: 12rpx;
  border-radius: 6rpx;
  background: var(--soft-2);
  overflow: hidden;
}
.bfill {
  height: 100%;
  border-radius: 6rpx;
  background: var(--brand);
}
.bnum {
  width: 120rpx;
  text-align: right;
  font-size: 24rpx;
  color: var(--text-2);
  flex-shrink: 0;
}

/* 两个大按钮 */
.actbtn {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 24rpx;
  padding: 24rpx 26rpx;
  border-radius: var(--r);
  background: var(--card);
  border: 1rpx solid var(--line);
}
.ab-ico {
  flex: none;
}
.ab-t {
  font-size: 26rpx;
  color: var(--text);
  line-height: 36rpx;
}
.primary {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 18rpx;
  padding: 26rpx;
  border-radius: var(--r);
  background: var(--brand);
}
.p-ico {
  flex: none;
}
.p-t {
  font-size: 26rpx;
  color: #fff;
  line-height: 36rpx;
  font-weight: 500;
}

/* chips */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
  margin: 26rpx 0 18rpx;
}
.chip {
  padding: 12rpx 22rpx;
  border-radius: 16rpx;
  background: var(--card);
  border: 1rpx solid var(--line);
  font-size: 24rpx;
  color: var(--text);
}
.chip.on {
  background: var(--brand);
  color: #fff;
  border-color: var(--brand);
  font-weight: 600;
}

/* 列表 */
.list {
  background: var(--card);
  border-radius: var(--r);
  overflow: hidden;
}
.li {
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 22rpx 24rpx;
  position: relative;
}
.li + .li::before {
  content: '';
  position: absolute;
  left: 24rpx;
  right: 0;
  top: 0;
  height: 1px;
  background: var(--line);
  transform: scaleY(0.5);
}
.badge {
  width: 64rpx;
  height: 64rpx;
  border-radius: 18rpx;
  color: #fff;
  font-size: 30rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.r-title {
  font-size: 30rpx;
  color: var(--text);
}
.r-sub {
  font-size: 22rpx;
  color: var(--text-2);
  margin-top: 2rpx;
}
.r-score {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--brand);
  flex-shrink: 0;
}

.hours {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40rpx 0;
}
.h-num {
  font-size: 84rpx;
  line-height: 92rpx;
  font-weight: 700;
  color: var(--brand);
}
.h-cap {
  font-size: 26rpx;
  color: var(--text-2);
  margin-top: 6rpx;
}

.empty {
  text-align: center;
  color: var(--text-3);
  font-size: 28rpx;
  padding: 60rpx 0;
}

.fab-act {
  position: fixed;
  right: var(--pad);
  bottom: calc(28rpx + 100rpx + env(safe-area-inset-bottom));
  height: 88rpx;
  padding: 0 34rpx;
  border-radius: 44rpx;
  background: var(--brand);
  color: #fff;
  font-size: 28rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8rpx 20rpx rgba(44, 111, 224, 0.36);
  z-index: 40;
}
</style>
