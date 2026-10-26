<script setup lang="ts">
/**
 * 课程编辑器（添加 / 编辑课程）
 *
 * 对应原工程 src/views/TimetableView.vue 里那段 `v-if="editing"` 的弹层
 * （第 935-961 行），字段、校验口径、配色规则都对齐，只把 DOM 换成小程序组件：
 *   input  → input（保留 v-model）
 *   select → picker mode="selector"（小程序没有 select）
 *   div    → view
 *
 * 交互取舍：
 *   · 原工程用 <select> 选星期/节次，小程序没有 select，改用原生 picker —— 点一下出滚轮，
 *     比 12 个 chip 占地方少，也更接近原手感。
 *   · 周次用 chip 多选（与原工程一致），另加"全选/单周/双周"三个快捷，省得点 16 下。
 */
import { computed, ref, watch } from 'vue';
import {
  activeTimetable,
  blankCourse,
  conflictsOf,
  saveCourse,
  totalWeeks,
  type Course
} from '../stores/app';
import { COURSE_COLORS, courseColorIndex } from '../shared/periods';
import { confirm, toast } from '../adapters/platform';

const props = defineProps<{
  /** 传进来的是原始课程对象；组件内部先复制一份，取消时不影响原数据 */
  course: Course;
  isNew: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved', course: Course): void;
}>();

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const PERIOD_LABELS = Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 节`);

const draft = ref<Course>(JSON.parse(JSON.stringify(props.course)));
/** 学分单独用字符串接 —— input 的 v-model 永远是 string，直接绑 number 字段会类型漂移 */
const creditText = ref(props.course.credit === null || props.course.credit === undefined ? '' : String(props.course.credit));
/** 有改动才提示"放弃编辑？" */
const dirty = ref(false);

watch(
  [draft, creditText],
  () => {
    dirty.value = true;
  },
  { deep: true }
);

const days = computed(() => totalWeeks.value);
const weekList = computed(() => Array.from({ length: days.value }, (_, i) => i + 1));

/* ---------- picker 变更 ---------- */
function onDay(e: any): void {
  draft.value.day = Number(e.detail.value) + 1;
}
function onStart(e: any): void {
  const v = Number(e.detail.value) + 1;
  draft.value.startPeriod = v;
  // 起始节次越过结束节次时自动跟进，避免用户还要再改一次
  if (v > draft.value.endPeriod) draft.value.endPeriod = v;
}
function onEnd(e: any): void {
  const v = Number(e.detail.value) + 1;
  draft.value.endPeriod = Math.max(v, draft.value.startPeriod);
}

/* ---------- 周次 ---------- */
function toggleWeek(w: number): void {
  const i = draft.value.weeks.indexOf(w);
  if (i >= 0) draft.value.weeks.splice(i, 1);
  else draft.value.weeks.push(w);
}
function selectAllWeeks(): void {
  draft.value.weeks = [...weekList.value];
}
function selectOdd(): void {
  draft.value.weeks = weekList.value.filter((w) => w % 2 === 1);
}
function selectEven(): void {
  draft.value.weeks = weekList.value.filter((w) => w % 2 === 0);
}
function clearWeeks(): void {
  draft.value.weeks = [];
}

/* ---------- 颜色 ---------- */
function pickColor(i: number): void {
  draft.value.colorIndex = i;
  draft.value.colorSet = true;
}
function autoColor(): void {
  draft.value.colorSet = false;
  draft.value.colorIndex = courseColorIndex(draft.value.name || '');
}

const accentIndex = computed(() => (draft.value.colorSet ? draft.value.colorIndex : courseColorIndex(draft.value.name || '')));

/* ---------- 保存 / 取消 ---------- */
async function onSave(): Promise<void> {
  const d = draft.value;
  if (!d.name.trim()) {
    toast('请填写课程名称');
    return;
  }
  if (!d.weeks.length) {
    toast('请至少选择一个周次');
    return;
  }
  if (d.endPeriod < d.startPeriod) {
    toast('结束节次不能早于开始节次');
    return;
  }

  // 撞课提醒：同名课程同一时段不提示（多教学班），只在真的换了一门课时问一句
  const clashes = conflictsOf(d);
  if (clashes.length) {
    const c = clashes[0];
    const more = clashes.length > 1 ? ` 等 ${clashes.length} 门课` : '';
    const ok = await confirm(
      '这个时间已经有课',
      `「${c.name}」${DAY_LABELS[c.day - 1]} 第 ${c.startPeriod}-${c.endPeriod} 节${more}与之重叠。\n仍然保存吗？`,
      '仍然保存'
    );
    if (!ok) return;
  }

  // 学分从字符串收敛回数字（留空 = null，不存 NaN）
  const n = parseFloat(creditText.value);
  d.credit = Number.isFinite(n) ? n : null;

  const r = saveCourse(d);
  if (!r.ok) {
    toast(r.error);
    return;
  }
  toast(props.isNew ? '课程已添加' : '课程已保存');
  emit('saved', draft.value);
}

async function onCancel(): Promise<void> {
  if (dirty.value) {
    const ok = await confirm('放弃编辑？', '刚才填写的内容不会保存。', '放弃');
    if (!ok) return;
  }
  emit('close');
}
</script>

<template>
  <view class="mask" @click="onCancel">
    <view class="sheet" @click.stop>
      <view class="grabber"></view>
      <!-- 头部 -->
      <view class="sheet-head">
        <text class="sh-title">{{ isNew ? '添加课程' : '编辑课程' }}</text>
        <view class="sh-close" @click="onCancel">✕</view>
      </view>

      <scroll-view class="sheet-body" scroll-y :show-scrollbar="false">
        <!-- 课程名 -->
        <view class="field">
          <text class="lab">课程名称</text>
          <input v-model="draft.name" class="ipt" placeholder="如：数字电子技术" placeholder-class="ph" maxlength="40" />
        </view>

        <!-- 星期 / 节次 -->
        <view class="grid2">
          <view class="field">
            <text class="lab">星期</text>
            <picker mode="selector" :range="DAY_LABELS" :value="draft.day - 1" @change="onDay">
              <view class="pick">
                <text>{{ DAY_LABELS[draft.day - 1] }}</text>
                <text class="caret">⌄</text>
              </view>
            </picker>
          </view>
          <view class="field">
            <text class="lab">上课地点</text>
            <input v-model="draft.room" class="ipt" placeholder="主教 301" placeholder-class="ph" maxlength="30" />
          </view>
          <view class="field">
            <text class="lab">开始节次</text>
            <picker mode="selector" :range="PERIOD_LABELS" :value="draft.startPeriod - 1" @change="onStart">
              <view class="pick">
                <text>{{ PERIOD_LABELS[draft.startPeriod - 1] }}</text>
                <text class="caret">⌄</text>
              </view>
            </picker>
          </view>
          <view class="field">
            <text class="lab">结束节次</text>
            <picker mode="selector" :range="PERIOD_LABELS" :value="draft.endPeriod - 1" @change="onEnd">
              <view class="pick">
                <text>{{ PERIOD_LABELS[draft.endPeriod - 1] }}</text>
                <text class="caret">⌄</text>
              </view>
            </picker>
          </view>
          <view class="field">
            <text class="lab">教师</text>
            <input v-model="draft.teacher" class="ipt" placeholder="选填" placeholder-class="ph" maxlength="20" />
          </view>
          <view class="field">
            <text class="lab">校区</text>
            <input v-model="draft.campus" class="ipt" placeholder="选填" placeholder-class="ph" maxlength="20" />
          </view>
          <view class="field">
            <text class="lab">学分</text>
            <input v-model="creditText" class="ipt" type="digit" placeholder="选填" placeholder-class="ph" />
          </view>
          <view class="field">
            <text class="lab">考核方式</text>
            <input v-model="draft.examMode" class="ipt" placeholder="考试 / 考查" placeholder-class="ph" maxlength="10" />
          </view>
        </view>

        <!-- 周次 -->
        <view class="field">
          <view class="lab-row">
            <text class="lab">上课周次</text>
            <text class="lab-hint">{{ draft.weeks.length }} 个</text>
          </view>
          <view class="quick">
            <view class="qbtn" @click="selectAllWeeks">全选</view>
            <view class="qbtn" @click="selectOdd">单周</view>
            <view class="qbtn" @click="selectEven">双周</view>
            <view class="qbtn" @click="clearWeeks">清空</view>
          </view>
          <view class="weekchips">
            <view
              v-for="w in weekList"
              :key="w"
              class="wchip"
              :class="{ on: draft.weeks.includes(w) }"
              @click="toggleWeek(w)"
            >{{ w }}</view>
          </view>
        </view>

        <!-- 颜色 -->
        <view class="field">
          <view class="lab-row">
            <text class="lab">颜色</text>
            <text class="lab-hint">{{ draft.colorSet ? '手动指定' : '按课程名自动' }}</text>
          </view>
          <view class="swatches">
            <view
              v-for="(c, i) in COURSE_COLORS"
              :key="i"
              class="sw"
              :class="{ on: accentIndex === i }"
              :style="{ background: c }"
              @click="pickColor(i)"
            ></view>
          </view>
          <view class="autobtn" :class="{ on: !draft.colorSet }" @click="autoColor">按课程名自动配色</view>
        </view>

        <view class="hint">
          提示：同一门课在整张课表里会共用一种颜色（原工程踩过"高等数学在周二和周四不一样色"的坑）。
        </view>
        <view style="height: 24rpx"></view>
      </scroll-view>

      <!-- 底部按钮 -->
      <view class="sheet-foot">
        <button class="btn grow" @click="onSave">{{ isNew ? '添加' : '保存' }}</button>
        <button class="btn ghost grow" @click="onCancel">取消</button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  /* H5 预览时原生 tabBar 会盖住视口底部；小程序里 --window-bottom 为 0，不影响。 */
  bottom: var(--window-bottom, 0px);
  background: rgba(10, 15, 25, 0.45);
  z-index: 80;
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  height: 86vh;
  background: var(--bg);
  border-radius: 28rpx 28rpx 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx 16rpx;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.sh-title {
  font-size: 34rpx;
  font-weight: 600;
}
.sh-close {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  background: var(--soft);
  color: var(--muted);
  font-size: 26rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sheet-body {
  flex: 1;
  height: 0;
  padding: 20rpx 32rpx 0;
}
.sheet-foot {
  display: flex;
  gap: 16rpx;
  padding: 16rpx 32rpx calc(16rpx + env(safe-area-inset-bottom));
  border-top: 1px solid var(--line);
  background: var(--card);
  flex-shrink: 0;
}

.field {
  margin-bottom: 22rpx;
}
.lab {
  display: block;
  font-size: 24rpx;
  color: var(--muted);
  margin-bottom: 10rpx;
}
.lab-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.lab-hint {
  font-size: 22rpx;
  color: var(--muted);
}
.ipt,
.pick {
  width: 100%;
  height: 84rpx;
  padding: 0 22rpx;
  border-radius: 16rpx;
  background: var(--field);
  border: 1px solid transparent;
  font-size: 28rpx;
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-sizing: border-box;
}
.ph {
  color: #b3c0d4;
}
.caret {
  color: var(--muted);
  font-size: 24rpx;
}
.grid2 {
  display: flex;
  flex-wrap: wrap;
  gap: 0 20rpx;
}
.grid2 .field {
  width: calc(50% - 10rpx);
}

/* 周次 */
.quick {
  display: flex;
  gap: 12rpx;
  margin-bottom: 14rpx;
}
.qbtn {
  padding: 8rpx 20rpx;
  border-radius: 999rpx;
  background: var(--soft);
  color: var(--brand);
  font-size: 23rpx;
}
.qbtn:active {
  opacity: 0.7;
}
.weekchips {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}
.wchip {
  width: 72rpx;
  height: 60rpx;
  line-height: 58rpx;
  text-align: center;
  border-radius: 14rpx;
  background: var(--field);
  color: var(--ink);
  font-size: 26rpx;
  border: 1px solid transparent;
}
.wchip.on {
  background: var(--brand);
  color: #fff;
  font-weight: 600;
}

/* 颜色 */
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
}
.sw {
  width: 56rpx;
  height: 56rpx;
  border-radius: 16rpx;
  border: 4rpx solid transparent;
  box-sizing: border-box;
}
.sw.on {
  border-color: #16233a;
  transform: scale(1.06);
}
.autobtn {
  margin-top: 16rpx;
  display: inline-block;
  padding: 10rpx 22rpx;
  border-radius: 999rpx;
  background: var(--field);
  color: var(--muted);
  font-size: 23rpx;
}
.autobtn.on {
  background: var(--tint);
  color: var(--brand);
  font-weight: 500;
}
.hint {
  font-size: 22rpx;
  line-height: 34rpx;
  color: var(--muted);
  background: var(--soft);
  border-radius: 14rpx;
  padding: 16rpx 20rpx;
}
</style>
