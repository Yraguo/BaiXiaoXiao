<script setup lang="ts">
/**
 * 课表工具箱 / 课表管理
 *
 * 对应原工程 TimetableView.vue 的「课表工具箱」弹层（第 796-830 行）：
 *   导入课表 → 更改课表信息 → 分享这张课表 → 手动添加课程 → 新建课表 → 切换课表
 * 小程序版先落地其中三件事：
 *   · 手动添加课程（emit 给父页面开 CourseEditor）
 *   · 更改课表信息（名称 / 总周数 / 学期第一周周一）
 *   · 新建课表 / 切换课表 / 删除课表
 * 导入与分享不在这一版（导入要等服务端代理或文件上传，见 adapters/jw.ts）。
 */
import { computed, ref } from 'vue';
import {
  activeTimetable,
  db,
  newTimetable,
  removeTimetable,
  switchTimetable,
  totalWeeks,
  updateTimetable,
  weekOfToday,
  type Timetable
} from '../stores/app';
import { confirm, toast } from '../adapters/platform';

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'add-course'): void;
  (e: 'import'): void;
}>();

type Mode = 'menu' | 'edit';
const mode = ref<Mode>('menu');
/** 正在编辑的课表；新建时是一份本地草稿，保存才落库 */
const form = ref<{ id: string; name: string; totalWeeks: number; semesterStartMonday: string; semesterLabel: string }>({
  id: '',
  name: '',
  totalWeeks: 18,
  semesterStartMonday: '',
  semesterLabel: ''
});
const isCreating = ref(false);

const WEEK_OPTIONS = Array.from({ length: 23 }, (_, i) => i + 8); // 8..30 周
const weekRange = computed(() => WEEK_OPTIONS.map((n) => `${n} 周`));

const current = computed(() => activeTimetable.value);
const courseCount = computed(() => db.courses.filter((c) => c.timetableId === current.value?.id).length);

function countOf(id: string): number {
  return db.courses.filter((c) => c.timetableId === id).length;
}

/* ---------- 编辑信息 ---------- */
function openEdit(t?: Timetable): void {
  isCreating.value = !t;
  const src = t || { id: '', name: '', totalWeeks: 18, semesterStartMonday: '', semesterLabel: '' };
  form.value = {
    id: src.id,
    name: src.name || '',
    totalWeeks: src.totalWeeks || 18,
    semesterStartMonday: src.semesterStartMonday || '',
    semesterLabel: src.semesterLabel || ''
  };
  mode.value = 'edit';
}

function onWeeks(e: any): void {
  form.value.totalWeeks = WEEK_OPTIONS[Number(e.detail.value)];
}
function onMonday(e: any): void {
  form.value.semesterStartMonday = String(e.detail.value);
}

function saveForm(): void {
  const name = form.value.name.trim();
  if (!name) {
    toast('请填写课表名称');
    return;
  }
  if (isCreating.value) {
    const t = newTimetable(name, form.value.totalWeeks);
    if (form.value.semesterStartMonday) updateTimetable(t.id, { semesterStartMonday: form.value.semesterStartMonday });
    db.currentWeek = Math.min(form.value.totalWeeks, weekOfToday(t.semesterStartMonday, form.value.totalWeeks));
    toast('课表已创建');
  } else {
    updateTimetable(form.value.id, {
      name,
      totalWeeks: form.value.totalWeeks,
      semesterStartMonday: form.value.semesterStartMonday || current.value?.semesterStartMonday
    });
    toast('已保存');
  }
  mode.value = 'menu';
}

/* ---------- 切换 / 删除 ---------- */
function pick(id: string): void {
  if (id === current.value?.id) return;
  switchTimetable(id);
  toast('已切换');
}

async function drop(t: Timetable): Promise<void> {
  const ok = await confirm(
    '删除这张课表？',
    `「${t.name}」和它里面的 ${countOf(t.id)} 门课程会一起删除，无法恢复。`,
    '删除'
  );
  if (!ok) return;
  const r = removeTimetable(t.id);
  toast(r.error || (r.ok ? '已删除' : '删除失败'));
}

function addCourse(): void {
  emit('add-course');
}
</script>

<template>
  <view class="mask" @click="emit('close')">
    <view class="sheet" @click.stop>
      <view class="grabber"></view>
      <view class="sheet-head">
        <text class="sh-title">{{ mode === 'menu' ? '课表工具箱' : isCreating ? '新建课表' : '更改课表信息' }}</text>
        <view class="sh-close" @click="mode === 'menu' ? emit('close') : (mode = 'menu')">✕</view>
      </view>

      <scroll-view class="sheet-body" scroll-y :show-scrollbar="false">
        <!-- ================= 菜单 ================= -->
        <template v-if="mode === 'menu'">
          <!-- 当前课表概览 -->
          <view class="now-card">
            <view class="nc-top">
              <text class="nc-name">{{ current?.name }}</text>
              <text class="pill brand">{{ courseCount }} 门课</text>
            </view>
            <text class="nc-sub">{{ current?.semesterLabel }} · 共 {{ totalWeeks }} 周 · 当前第 {{ db.currentWeek }} 周</text>
            <text class="nc-sub">学期第一周周一：{{ current?.semesterStartMonday }}</text>
          </view>

          <view class="acts">
            <view class="act" @click="emit('import')">
              <text class="act-ico">↓</text>
              <view class="grow">
                <text class="act-t">从教务系统导入</text>
                <text class="act-d">登录一次，课表自动拉下来</text>
              </view>
              <text class="chev">›</text>
            </view>
            <view class="act" @click="addCourse">
              <text class="act-ico">＋</text>
              <view class="grow">
                <text class="act-t">手动添加课程</text>
                <text class="act-d">自己填课程名、星期、节次、周次</text>
              </view>
              <text class="chev">›</text>
            </view>
            <view class="act" @click="openEdit(current)">
              <text class="act-ico">✏️</text>
              <view class="grow">
                <text class="act-t">更改课表信息</text>
                <text class="act-d">课表名称 / 总周数 / 第一周周一</text>
              </view>
              <text class="chev">›</text>
            </view>
            <view class="act" @click="openEdit()">
              <text class="act-ico">🗂</text>
              <view class="grow">
                <text class="act-t">新建课表</text>
                <text class="act-d">换个学期再建一份，两份互不覆盖</text>
              </view>
              <text class="chev">›</text>
            </view>
          </view>

          <view class="sec-title">切换课表</view>
          <view class="list">
            <view v-for="t in db.timetables" :key="t.id" class="li" @click="pick(t.id)">
              <view class="grow">
                <view class="tt-name">
                  <text>{{ t.name }}</text>
                  <text v-if="t.id === current?.id" class="pill brand now-pill">使用中</text>
                </view>
                <text class="tt-sub">{{ t.semesterLabel }} · {{ countOf(t.id) }} 门课 · {{ t.totalWeeks }} 周</text>
              </view>
              <view v-if="t.id !== current?.id" class="del" @click.stop="drop(t)">删除</view>
            </view>
          </view>

          <view class="foot-hint">
            导入课表 / 分享课表不在这一版：导入要等服务端代理（见 adapters/jw.ts），分享要改成 onShareAppMessage。
          </view>
        </template>

        <!-- ================= 编辑 / 新建 ================= -->
        <template v-else>
          <view class="field">
            <text class="lab">课表名称</text>
            <input v-model="form.name" class="ipt" placeholder="如：2025-2026 秋 / 我的课表" placeholder-class="ph" maxlength="24" />
          </view>

          <view class="field">
            <text class="lab">总周数</text>
            <picker mode="selector" :range="weekRange" :value="WEEK_OPTIONS.indexOf(form.totalWeeks)" @change="onWeeks">
              <view class="pick">
                <text>{{ form.totalWeeks }} 周</text>
                <text class="caret">⌄</text>
              </view>
            </picker>
          </view>

          <view class="field">
            <text class="lab">学期第一周的周一</text>
            <picker mode="date" :value="form.semesterStartMonday" @change="onMonday">
              <view class="pick">
                <text>{{ form.semesterStartMonday || '点击选择日期' }}</text>
                <text class="caret">⌄</text>
              </view>
            </picker>
            <text class="tip">用来推算「今天是第几周」。填错了周次会整体偏移。</text>
          </view>

          <view class="hint">
            {{ isCreating
              ? '新建后会立刻切到这张课表，里面是空的 —— 接着手动添加课程就行。'
              : '改总周数后，超出范围的周次不会丢，只是周次条不再显示。' }}
          </view>
        </template>
        <view style="height: 24rpx"></view>
      </scroll-view>

      <view v-if="mode === 'edit'" class="sheet-foot">
        <button class="btn grow" @click="saveForm">{{ isCreating ? '创建并切换' : '保存' }}</button>
        <button class="btn ghost grow" @click="mode = 'menu'">取消</button>
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
  /* 菜单态内容短，用 auto 让弹层贴合内容；内容超长时被 max-height 兜住 */
  height: auto;
  max-height: 86vh;
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
  flex: 1 1 auto;
  min-height: 0;
  padding: 22rpx 32rpx 0;
}
.sheet-foot {
  display: flex;
  gap: 20rpx;
  padding: 20rpx 32rpx calc(20rpx + env(safe-area-inset-bottom));
  flex-shrink: 0;
}

.now-card {
  background: linear-gradient(135deg, #5587ec, #446fd0);
  border-radius: 22rpx;
  padding: 24rpx 26rpx;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  margin-bottom: 24rpx;
}
.nc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.nc-name {
  color: #fff;
  font-size: 32rpx;
  font-weight: 600;
}
.nc-sub {
  color: rgba(255, 255, 255, 0.85);
  font-size: 22rpx;
}
.now-card .pill.brand {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}

.acts {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}
.act {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 24rpx;
  border-radius: var(--r);
  background: var(--card);
}
.act:active {
  opacity: 0.75;
}
.act-ico {
  width: 56rpx;
  height: 56rpx;
  border-radius: 16rpx;
  background: var(--soft);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  flex-shrink: 0;
}
.act:active {
  opacity: 0.75;
}
.act-t {
  display: block;
  font-size: 28rpx;
  font-weight: 500;
  color: var(--ink);
}
.act-d {
  display: block;
  font-size: 21rpx;
  color: var(--muted);
  margin-top: 2rpx;
}
.chev {
  color: #c8d4e6;
  font-size: 32rpx;
}

.sec-title {
  font-size: 23rpx;
  color: var(--muted);
  margin: 30rpx 0 12rpx;
}
.tt-name {
  display: flex;
  align-items: center;
  gap: 12rpx;
  font-size: 28rpx;
  color: var(--ink);
}
.now-pill {
  font-size: 20rpx;
  padding: 2rpx 12rpx;
}
.tt-sub {
  display: block;
  font-size: 21rpx;
  color: var(--muted);
  margin-top: 2rpx;
}
.del {
  font-size: 24rpx;
  color: var(--danger);
  padding: 10rpx 16rpx;
  border-radius: 12rpx;
  background: #fdecea;
  flex-shrink: 0;
}
.foot-hint {
  font-size: 21rpx;
  line-height: 32rpx;
  color: var(--muted);
  padding: 28rpx 4rpx 8rpx;
}

.field {
  margin-bottom: 24rpx;
}
.lab {
  display: block;
  font-size: 24rpx;
  color: var(--muted);
  margin-bottom: 10rpx;
}
.ipt,
.pick {
  width: 100%;
  height: 84rpx;
  padding: 0 22rpx;
  border-radius: 16rpx;
  background: var(--field);
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
.tip {
  display: block;
  font-size: 21rpx;
  color: var(--muted);
  margin-top: 8rpx;
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
