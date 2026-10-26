<script setup lang="ts">
/**
 * 课程表（结构、周次栏、滑动切周都照搬 百小鸮）
 *
 * 周次：`week` 是"正在看的周"，`db.currentWeek` 是"本周"。
 *   两者分开是原工程的做法 —— 翻到第 3 周看完再回来，不应该把"本周"改掉。
 *   左右滑动表格可切周（阈值 44px，且横向位移要明显大于纵向，避免和上下滚动打架）。
 */
import { computed, ref } from 'vue';
import {
  activeCourses,
  activeTimetable,
  blankCourse,
  colorOf,
  coursesOn,
  createTimetable,
  db,
  removeCourseGroup,
  seedDemoTimetable,
  todayIndex,
  type Course
} from '../stores/app';
import { DEFAULT_PERIOD_TIMES } from '../shared/periods';
import { confirm, toast } from '../adapters/platform';
import CourseEditor from '../components/CourseEditor.vue';
import TimetableSheet from '../components/TimetableSheet.vue';
import AddTimetableSheet from '../components/AddTimetableSheet.vue';

const DAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];
const PERIODS = DEFAULT_PERIOD_TIMES;
const ROW = 96;

const picked = ref<Course | null>(null);
const editor = ref<{ course: Course; isNew: boolean } | null>(null);
const showToolbox = ref(false);
const showAdd = ref(false);

/** 正在看的周次（默认本周） */
const week = ref(db.currentWeek);

const today = computed(() => todayIndex.value);
const hasTimetable = computed(() => !!activeTimetable.value);
const isEmpty = computed(() => activeCourses.value.length === 0);
const totalWk = computed(() => activeTimetable.value?.totalWeeks || 18);
const isThisWeek = computed(() => week.value === db.currentWeek);

function dateForDay(dayOffset: number): Date {
  const t = activeTimetable.value;
  const start = t ? new Date(t.semesterStartMonday.replace(/-/g, '/')) : new Date();
  if (Number.isNaN(start.getTime())) return new Date();
  return new Date(start.getTime() + ((week.value - 1) * 7 + dayOffset) * 86400000);
}

const weekRange = computed(() => {
  const f = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${f(dateForDay(0))}–${f(dateForDay(6))}`;
});

function dateOf(day: number): string {
  const d = dateForDay(day - 1);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function shift(d: number): void {
  const next = Math.min(Math.max(week.value + d, 1), totalWk.value);
  if (next === week.value) return;
  week.value = next;
}

function goToday(): void {
  week.value = db.currentWeek;
}

/* 滑动手势（阈值与判定照抄原工程：44px 且横 > 纵*1.4） */
let sx = 0;
let sy = 0;
function onTouchStart(e: any): void {
  const t = e.touches?.[0] || e.changedTouches?.[0];
  if (!t) return;
  sx = t.clientX;
  sy = t.clientY;
}
function onTouchEnd(e: any): void {
  const t = e.changedTouches?.[0];
  if (!t) return;
  const dx = t.clientX - sx;
  const dy = t.clientY - sy;
  if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.4) shift(dx < 0 ? 1 : -1);
}

function blocksOf(day: number) {
  return coursesOn(day, week.value).map((c) => {
    const len = Math.max(1, c.endPeriod - c.startPeriod + 1);
    const st = PERIODS[c.startPeriod - 1];
    const ed = PERIODS[c.endPeriod - 1];
    // 原版就是 08:0-09:35 这个长度（起点只留到十分位）—— 7 列时列宽只有 48px，
    // 完整写 08:00-09:35 会被折成两行。这是对齐真机的取舍，不是打错。
    const meta = st && ed ? `${st.start.slice(0, 4)}-${ed.end}` : '';
    return {
      course: c,
      meta,
      style: `top:${(c.startPeriod - 1) * ROW + 3}rpx;height:${len * ROW - 6}rpx;background:${colorOf(c)};`
    };
  });
}

/* ---------- 添加课表 ---------- */
function goImport(): void {
  showAdd.value = false;
  showToolbox.value = false;
  uni.navigateTo({ url: '/pages/import/index' });
}
function goManual(): void {
  showAdd.value = false;
  if (!hasTimetable.value) {
    createTimetable('我的课表');
    setTimeout(() => openNew(), 100);
    return;
  }
  openNew();
}
function demo(): void {
  showAdd.value = false;
  seedDemoTimetable();
  week.value = db.currentWeek;
  toast('已生成示例课表');
}

function openNew(): void {
  const all: number[] = [];
  for (let w = 1; w <= totalWk.value; w++) all.push(w);
  editor.value = { course: blankCourse({ day: today.value, weeks: all }), isNew: true };
  showToolbox.value = false;
  picked.value = null;
}
function openEdit(c: Course): void {
  editor.value = { course: c, isNew: false };
  picked.value = null;
}

async function delCourse(c: Course): Promise<void> {
  const ok = await confirm('确认删除这门课？', `${c.name}｜周${DAY_NAMES[c.day - 1]} 第 ${c.startPeriod}-${c.endPeriod} 节`, '删除');
  if (!ok) return;
  const n = removeCourseGroup(c);
  picked.value = null;
  toast(n > 1 ? `已删除 ${n} 条` : '已删除');
}
</script>

<template>
  <!-- 没有课表：引导 -->
  <view v-if="!hasTimetable" class="onboard">
    <image class="ob-logo" src="/static/logo-round.png" mode="aspectFill" />
    <text class="ob-title">还没有课表</text>
    <text class="ob-sub">从教务系统导入最快，登一次就全好了</text>
    <button class="btn block" @click="showAdd = true">添加课表</button>
    <text class="ob-link" @click="demo">先用示例课表看看</text>
  </view>

  <block v-else>
    <!-- 周次栏：‹ 第 N 周 10月19日–10月25日 / 课表名 · 共 18 周 › 回本周 -->
    <view class="weeknav">
      <view class="wnav" :class="{ off: week <= 1 }" @click="shift(-1)">‹</view>
      <view class="wcur">
        <view class="wline">
          <text class="wbold">第 {{ week }} 周</text>
          <text class="wrange">{{ weekRange }}</text>
        </view>
        <text class="wsub">{{ activeTimetable?.name || '还没有课表' }} · 共 {{ totalWk }} 周</text>
      </view>
      <view class="wnav" :class="{ off: week >= totalWk }" @click="shift(1)">›</view>
      <view v-if="!isThisWeek" class="wtoday" @click="goToday">回本周</view>
    </view>
    <view class="swipe-hint">左右滑动可切换周次</view>

    <scroll-view class="tt-scroll" scroll-y @touchstart="onTouchStart" @touchend="onTouchEnd">
      <view class="tt">
        <!-- 表头 -->
        <view class="tt-row tt-head">
          <view class="th-corner">节次</view>
          <view v-for="d in 7" :key="'h' + d" class="th-day" :class="{ today: d === today && isThisWeek }">
            <text class="th-w">周{{ DAY_NAMES[d - 1] }}</text>
            <text class="th-d">{{ dateOf(d) }}</text>
          </view>
        </view>

        <!-- 表体 -->
        <view class="tt-body">
          <view class="gutter">
            <view v-for="p in PERIODS" :key="p.period" class="pcell">
              <text class="pnum">{{ p.period }}</text>
              <text class="ptime">{{ p.start }}</text>
              <text class="ptime">{{ p.end }}</text>
            </view>
          </view>
          <view v-for="d in 7" :key="'c' + d" class="daycol" :class="{ today: d === today && isThisWeek }">
            <view v-for="p in PERIODS" :key="p.period" class="pcell-line"></view>
            <view v-for="b in blocksOf(d)" :key="b.course.id" class="cblock" :style="b.style" @click="picked = b.course">
              <text class="bname">{{ b.course.name }}</text>
              <text class="bmeta">{{ b.meta }}</text>
              <text v-if="b.course.room" class="bmeta">{{ b.course.room }}</text>
            </view>
          </view>
        </view>
      </view>

      <view v-if="isEmpty" class="empty-hint">
        <text>这张课表还是空的</text>
        <text class="eh-sub">点右下角按钮导入或添加课程</text>
        <button class="btn sm" style="margin-top: 20rpx" @click="goImport">从教务系统导入</button>
      </view>
      <view style="height: 160rpx"></view>
    </scroll-view>

    <view class="fab" @click="showToolbox = true">
      <view class="dice">
        <view class="dot"></view><view class="dot"></view>
        <view class="dot"></view><view class="dot"></view>
      </view>
    </view>
  </block>

  <!-- 课程详情 -->
  <view v-if="picked" class="mask" @click="picked = null">
    <view class="sheet" @click.stop>
      <view class="grabber"></view>
      <view class="sheet-head">
        <view class="row grow">
          <view class="dt-dot" :style="{ background: colorOf(picked) }"></view>
          <text class="sh-title">{{ picked.name }}</text>
        </view>
      </view>
      <view class="dt-body">
        <view class="kv"><text class="k">时间</text><text class="v">周{{ DAY_NAMES[picked.day - 1] }} 第 {{ picked.startPeriod }}-{{ picked.endPeriod }} 节</text></view>
        <view v-if="picked.room" class="kv"><text class="k">地点</text><text class="v">{{ picked.room }}</text></view>
        <view v-if="picked.teacher" class="kv"><text class="k">教师</text><text class="v">{{ picked.teacher }}</text></view>
        <view class="kv"><text class="k">周次</text><text class="v">{{ picked.weeksRaw || picked.weeks.join(',') }}</text></view>
      </view>
      <view class="sheet-foot">
        <button class="btn grow" @click="openEdit(picked)">编辑</button>
        <button class="btn danger grow" @click="delCourse(picked)">删除</button>
      </view>
    </view>
  </view>

  <TimetableSheet v-if="showToolbox" @close="showToolbox = false" @add-course="openNew" @import="goImport" />
  <AddTimetableSheet v-if="showAdd" @close="showAdd = false" @auto="goImport" @manual="goManual" @demo="demo" />
  <CourseEditor v-if="editor" :course="editor.course" :is-new="editor.isNew" @close="editor = null" @saved="editor = null" />
</template>

<style scoped>
/* ---------- 引导 ---------- */
.onboard {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80rpx var(--pad) 100rpx;
}
.ob-logo {
  width: 152rpx;
  height: 152rpx;
  border-radius: 50%;
  background: #fff;
  margin-bottom: 36rpx;
}
.ob-title {
  font-size: 52rpx;
  line-height: 64rpx;
  font-weight: 700;
  letter-spacing: -0.6rpx;
  color: var(--text);
}
.ob-sub {
  font-size: 28rpx;
  line-height: 40rpx;
  color: var(--text-2);
  text-align: center;
  margin: 12rpx 0 52rpx;
}
.ob-link {
  font-size: 28rpx;
  color: var(--brand);
  padding: 34rpx 0 0;
}

/* ---------- 周次栏 ---------- */
.weeknav {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin: 0 var(--pad);
  padding: 16rpx 20rpx;
  border-radius: var(--r);
  background: var(--card);
  flex-shrink: 0;
}
.wnav {
  width: 68rpx;
  height: 68rpx;
  border-radius: 20rpx;
  background: var(--soft-2);
  color: var(--brand);
  font-size: 40rpx;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.wnav.off {
  opacity: 0.35;
}
.wcur {
  flex: 1;
  text-align: center;
  min-width: 0;
}
.wline {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 10rpx;
}
.wbold {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--text);
}
.wrange {
  font-size: 22rpx;
  font-weight: 500;
  color: var(--text-2);
}
.wsub {
  display: block;
  font-size: 22rpx;
  color: var(--text-2);
  margin-top: 2rpx;
}
.wtoday {
  flex: none;
  padding: 10rpx 18rpx;
  border-radius: 16rpx;
  background: var(--brand-tint);
  color: var(--brand);
  font-size: 24rpx;
}
.swipe-hint {
  font-size: 20rpx;
  color: var(--text-3);
  padding: 10rpx var(--pad) 8rpx;
  flex-shrink: 0;
}

/* ---------- 课表 ---------- */
.tt-scroll {
  flex: 1;
  height: 0;
  padding: 0 var(--pad);
}
.tt {
  background: var(--card);
  border-radius: 16rpx;
  overflow: hidden;
}
.tt-row {
  display: flex;
}
.tt-head {
  background: var(--card);
  border-bottom: 1px solid var(--line);
}
.th-corner {
  width: 72rpx;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22rpx;
  color: var(--text-2);
  padding: 12rpx 0;
}
.th-day {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 12rpx 0;
  gap: 2rpx;
}
.th-w,
.th-d {
  font-size: 22rpx;
  line-height: 30rpx;
  color: var(--text-2);
}
.th-day.today .th-w,
.th-day.today .th-d {
  color: var(--brand);
  font-weight: 600;
}

.tt-body {
  display: flex;
  position: relative;
}
.gutter {
  width: 72rpx;
  flex-shrink: 0;
  border-right: 1px solid var(--grid);
}
.daycol {
  flex: 1;
  position: relative;
  border-right: 1px solid var(--grid);
}
.daycol:last-child {
  border-right: 0;
}
.daycol.today {
  background: rgba(44, 111, 224, 0.05);
}
.pcell {
  height: 96rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rpx;
  border-bottom: 1px solid var(--grid);
}
.pnum {
  font-size: 26rpx;
  line-height: 30rpx;
  font-weight: 600;
  color: var(--text);
}
.ptime {
  font-size: 17rpx;
  line-height: 22rpx;
  color: var(--text-2);
  transform: scale(0.92);
}
.pcell-line {
  height: 96rpx;
  border-bottom: 1px solid var(--grid);
}

.cblock {
  position: absolute;
  /* 原版课程块几乎贴满整列（padding 3px 4px），列宽只有 48px，左右留白多一点都不够写时间 */
  left: 1rpx;
  right: 1rpx;
  border-radius: 8rpx;
  padding: 6rpx 4rpx;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 1rpx;
}
.cblock:active {
  opacity: 0.82;
}
.bname {
  font-size: 21rpx;
  line-height: 27rpx;
  font-weight: 700;
  color: #fff;
  word-break: break-all;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 6;
  overflow: hidden;
}
.bmeta {
  font-size: 14rpx;
  line-height: 19rpx;
  color: rgba(255, 255, 255, 0.92);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 56rpx 0;
  color: var(--text-2);
  font-size: 28rpx;
}
.eh-sub {
  font-size: 24rpx;
  color: var(--text-3);
  margin-top: 6rpx;
}

/* ---------- 右下角按钮 ---------- */
.fab {
  position: fixed;
  right: var(--pad);
  bottom: calc(28rpx + 100rpx + env(safe-area-inset-bottom));
  width: 88rpx;
  height: 88rpx;
  border-radius: 22rpx;
  background: var(--brand);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8rpx 20rpx rgba(44, 111, 224, 0.36);
  z-index: 40;
}
.fab:active {
  transform: scale(0.94);
}
.dice {
  width: 40rpx;
  height: 40rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
}
.dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 4rpx;
  background: #fff;
}

/* ---------- 详情 ---------- */
.dt-dot {
  width: 18rpx;
  height: 18rpx;
  border-radius: 5rpx;
  flex-shrink: 0;
}
.dt-body {
  padding: 8rpx 32rpx 0;
}
.kv {
  display: flex;
  gap: 24rpx;
  padding: 18rpx 0;
  border-bottom: 1px solid var(--line);
}
.kv:last-child {
  border-bottom: 0;
}
.k {
  width: 84rpx;
  color: var(--text-2);
  font-size: 28rpx;
  flex-shrink: 0;
}
.v {
  font-size: 28rpx;
  line-height: 40rpx;
  flex: 1;
  color: var(--text);
}
</style>
