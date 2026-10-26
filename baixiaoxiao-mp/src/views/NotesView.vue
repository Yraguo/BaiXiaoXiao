<script setup lang="ts">
/**
 * 记事本（月历 + 当天记事），对齐 百小鸮 截图
 *
 * 日历是自己算的：以周日为一周起点，42 格（6 行）覆盖整月，
 * 上下月补灰。有记事的日期下面点一个小圆点。
 */
import { computed, ref } from 'vue';
import { addNote, dateStamp, db, removeNote, toggleNote, type NoteItem } from '../stores/app';
import { confirm, toast } from '../adapters/platform';

const view = ref<'calendar' | 'all'>('calendar');

const today = new Date();
const ty = today.getFullYear();
const tm = today.getMonth();
const todayStr = dateStamp(today);

const cursor = ref({ y: ty, m: tm });
const selected = ref(todayStr);

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const WEEK_FULL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const pad2 = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`;

/** 某天的记事 */
function notesOf(date: string): NoteItem[] {
  return db.notes.filter((n) => n.date === date);
}

const cursorLabel = computed(() => `${cursor.value.y}年${cursor.value.m + 1}月`);

const monthNoteCount = computed(() => {
  const prefix = `${cursor.value.y}-${pad2(cursor.value.m + 1)}`;
  return db.notes.filter((n) => n.date.startsWith(prefix)).length;
});

const isCurrentMonth = computed(() => cursor.value.y === ty && cursor.value.m === tm);

/** 42 个格子 */
const cells = computed(() => {
  const first = new Date(cursor.value.y, cursor.value.m, 1);
  const startWeekday = first.getDay();
  const start = new Date(cursor.value.y, cursor.value.m, 1 - startWeekday);
  const out: Array<{ key: string; day: number; inMonth: boolean; isToday: boolean; dots: number }> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = keyOf(d.getFullYear(), d.getMonth(), d.getDate());
    out.push({
      key,
      day: d.getDate(),
      inMonth: d.getMonth() === cursor.value.m,
      isToday: key === todayStr,
      dots: Math.min(notesOf(key).length, 1)
    });
  }
  return out;
});

const dayLabel = computed(() => {
  const d = new Date(selected.value.replace(/-/g, '/'));
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_FULL[d.getDay()]}`;
});

const dayNotes = computed(() => notesOf(selected.value));

const allNotes = computed(() =>
  [...db.notes].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
);

function shiftMonth(delta: number): void {
  const d = new Date(cursor.value.y, cursor.value.m + delta, 1);
  cursor.value = { y: d.getFullYear(), m: d.getMonth() };
}

function goToday(): void {
  cursor.value = { y: ty, m: tm };
  selected.value = todayStr;
}

function pick(key: string): void {
  selected.value = key;
  const d = new Date(key.replace(/-/g, '/'));
  if (d.getMonth() !== cursor.value.m) cursor.value = { y: d.getFullYear(), m: d.getMonth() };
}

/* ---------- 增删 ---------- */
async function newNote(date?: string): Promise<void> {
  const d = date || selected.value;
  const r = await new Promise<string>((resolve) => {
    uni.showModal({
      title: '新建记事',
      editable: true,
      placeholderText: '要记的事，例如：交物理实验报告',
      confirmText: '保存',
      confirmColor: '#2C6FE0',
      success: (res: any) => resolve(res.confirm ? String(res.content || '').trim() : ''),
      fail: () => resolve('')
    });
  });
  if (!r) return;
  addNote({ title: r, date: d });
  if (date) selected.value = date;
  toast('已记下');
}

async function del(n: NoteItem): Promise<void> {
  const ok = await confirm('删除这条记事？', n.title, '删除');
  if (!ok) return;
  removeNote(n.id);
  toast('已删除');
}
</script>

<template>
  <view class="wrap">
    <!-- 日历 / 全部 -->
    <view class="switcher">
      <view class="sw" :class="{ on: view === 'calendar' }" @click="view = 'calendar'">日历</view>
      <view class="sw" :class="{ on: view === 'all' }" @click="view = 'all'">全部（{{ db.notes.length }}）</view>
    </view>

    <scroll-view class="scroll" scroll-y>
      <template v-if="view === 'calendar'">
        <!-- 月份头 -->
        <view class="m-head">
          <view class="m-nav" @click="shiftMonth(-1)">‹</view>
          <view class="m-mid">
            <text class="m-title">{{ cursorLabel }}</text>
            <text class="m-sub">{{ isCurrentMonth ? '本月' : '' }} {{ monthNoteCount }} 条记事</text>
          </view>
          <view class="m-nav" @click="shiftMonth(1)">›</view>
          <view class="m-today" @click="goToday">今天</view>
        </view>

        <!-- 星期 -->
        <view class="cal">
          <view class="cal-week">
            <text v-for="w in WEEK" :key="w" class="cw">{{ w }}</text>
          </view>
          <view class="cal-grid">
            <view
              v-for="c in cells"
              :key="c.key"
              class="cell"
              :class="{ out: !c.inMonth }"
              @click="pick(c.key)"
            >
              <view class="cnum" :class="{ today: c.isToday, sel: c.key === selected && !c.isToday }">{{ c.day }}</view>
              <view v-if="c.dots" class="cdots">
                <view class="cdot"></view>
              </view>
            </view>
          </view>
        </view>

        <!-- 当天 -->
        <view class="day-head">
          <text class="d-title">{{ dayLabel }}</text>
          <view class="d-add" @click="newNote()">在这一天记一条</view>
        </view>

        <view v-if="!dayNotes.length" class="empty">
          <text>这一天还没有记事</text>
        </view>
        <view v-else class="list">
          <view v-for="n in dayNotes" :key="n.id" class="li" @click="toggleNote(n.id)">
            <view class="check" :class="{ on: n.done }"><text v-if="n.done" class="tick">✓</text></view>
            <view class="grow">
              <view class="n-title" :class="{ done: n.done }">{{ n.title }}</view>
              <view v-if="n.content" class="n-sub">{{ n.content }}</view>
            </view>
            <view class="n-del" @click.stop="del(n)">删</view>
          </view>
        </view>
      </template>

      <!-- 全部 -->
      <template v-else>
        <view v-if="!allNotes.length" class="empty"><text>还没有记事</text></view>
        <view v-else class="list">
          <view v-for="n in allNotes" :key="n.id" class="li" @click="toggleNote(n.id)">
            <view class="check" :class="{ on: n.done }"><text v-if="n.done" class="tick">✓</text></view>
            <view class="grow">
              <view class="n-title" :class="{ done: n.done }">{{ n.title }}</view>
              <view class="n-sub">{{ n.date }}<text v-if="n.content"> · {{ n.content }}</text></view>
            </view>
            <view class="n-del" @click.stop="del(n)">删</view>
          </view>
        </view>
      </template>

      <view style="height: 180rpx"></view>
    </scroll-view>

    <view class="fab-note" @click="newNote(view === 'calendar' ? selected : undefined)">新建记事</view>
  </view>
</template>

<style scoped>
.wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.switcher {
  display: flex;
  gap: 16rpx;
  padding: 4rpx var(--pad) 16rpx;
  flex-shrink: 0;
}
.sw {
  flex: 1;
  height: 76rpx;
  border-radius: 18rpx;
  background: var(--card);
  color: var(--text-2);
  font-size: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sw.on {
  background: var(--brand);
  color: #fff;
  font-weight: 600;
}

.scroll {
  flex: 1;
  height: 0;
  padding: 0 var(--pad);
}

/* 月份头 */
.m-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 8rpx 0 20rpx;
}
.m-nav {
  width: 64rpx;
  height: 64rpx;
  border-radius: 18rpx;
  background: var(--card);
  color: var(--brand);
  font-size: 36rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.m-mid {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.m-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--text);
}
.m-sub {
  font-size: 22rpx;
  color: var(--text-2);
  margin-top: 2rpx;
}
.m-today {
  height: 64rpx;
  padding: 0 22rpx;
  border-radius: 18rpx;
  background: var(--brand-tint);
  color: var(--brand);
  font-size: 26rpx;
  display: flex;
  align-items: center;
}

/* 日历 */
.cal {
  background: var(--card);
  border-radius: var(--r);
  padding: 12rpx 12rpx 20rpx;
}
.cal-week {
  display: flex;
  padding: 8rpx 0;
}
.cw {
  flex: 1;
  text-align: center;
  font-size: 22rpx;
  color: var(--text-2);
}
.cal-grid {
  display: flex;
  flex-wrap: wrap;
}
.cell {
  width: 14.2857%;
  height: 92rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
}
.cnum {
  width: 64rpx;
  height: 64rpx;
  line-height: 64rpx;
  text-align: center;
  border-radius: 50%;
  font-size: 30rpx;
  color: var(--text);
}
.cell.out .cnum {
  color: var(--text-3);
}
.cnum.today {
  background: var(--brand);
  color: #fff;
  font-weight: 600;
}
.cnum.sel {
  background: var(--brand-tint);
  color: var(--brand);
  font-weight: 600;
}
.cdots {
  position: absolute;
  bottom: 6rpx;
  display: flex;
  gap: 4rpx;
}
.cdot {
  width: 8rpx;
  height: 8rpx;
  border-radius: 50%;
  background: var(--brand);
}

/* 当天 */
.day-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 4rpx 16rpx;
}
.d-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--text);
}
.d-add {
  height: 62rpx;
  padding: 0 22rpx;
  border-radius: 16rpx;
  background: var(--card);
  border: 1rpx solid var(--line);
  color: var(--brand);
  font-size: 26rpx;
  display: flex;
  align-items: center;
}
.empty {
  text-align: center;
  color: var(--text-3);
  font-size: 28rpx;
  padding: 60rpx 0;
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
  gap: 20rpx;
  padding: 22rpx 26rpx;
  position: relative;
}
.li + .li::before {
  content: '';
  position: absolute;
  left: 26rpx;
  right: 0;
  top: 0;
  height: 1px;
  background: var(--line);
  transform: scaleY(0.5);
}
.check {
  width: 42rpx;
  height: 42rpx;
  border-radius: 50%;
  border: 2rpx solid var(--line);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.check.on {
  background: var(--brand);
  border-color: var(--brand);
}
.tick {
  color: #fff;
  font-size: 24rpx;
  line-height: 1;
}
.n-title {
  font-size: 30rpx;
  color: var(--text);
}
.n-title.done {
  text-decoration: line-through;
  color: var(--text-2);
}
.n-sub {
  font-size: 22rpx;
  color: var(--text-2);
  margin-top: 2rpx;
}
.n-del {
  font-size: 24rpx;
  color: var(--danger);
  padding: 8rpx 14rpx;
  flex-shrink: 0;
}

.fab-note {
  position: fixed;
  right: var(--pad);
  bottom: calc(28rpx + 100rpx + env(safe-area-inset-bottom));
  height: 88rpx;
  padding: 0 32rpx;
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
