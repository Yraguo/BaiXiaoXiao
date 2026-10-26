<script setup lang="ts">
/**
 * 从教务系统导入课表
 *
 * 三步一条线：选学校 → 登录 → 预览入库。
 * 协议细节全在 services/jw/zf.ts，这页只管"问用户要什么、把结果说清楚"。
 */
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { SCHOOLS, findSchool, searchSchools, type School } from '../../services/jw/schools';
import {
  beginLogin,
  describeImportError,
  submitLogin,
  type LoginSession,
  type ZfImportResult
} from '../../services/jw/zf';
import { addressHint } from '../../services/jw/address';
import { activeTimetable, createTimetable, db, importCourses, type CourseSeed } from '../../stores/app';
import { statusBarHeight, toast } from '../../adapters/platform';
import { themeClass, initTheme } from '../../services/theme';

const statusBar = statusBarHeight();
initTheme();
const step = ref<'school' | 'login' | 'result'>('school');
const keyword = ref('');
const school = ref<School | null>(null);

const address = ref('');
const username = ref('');
const password = ref('');
const semester = ref(1);
const SEMESTERS = [
  { v: 1, label: '第一学期（秋）' },
  { v: 2, label: '第二学期（春）' },
  { v: 3, label: '短学期' }
];

const busy = ref(false);
const errMsg = ref('');

/** 登录会话（验证码与会话绑定，必须复用同一个） */
const session = ref<LoginSession | null>(null);
const needCaptcha = ref(false);
const captchaImg = ref('');
const captchaCode = ref('');

const result = ref<ZfImportResult | null>(null);
const importMode = ref<'new' | 'merge'>('new');
/** 从 toolox 进来时可能已经有一张课表 */
const hasTimetable = computed(() => !!activeTimetable.value);

const list = computed(() => searchSchools(keyword.value));

onLoad((q: any) => {
  if (q?.school) {
    const s = findSchool(String(q.school));
    if (s) pick(s);
  } else if (q?.mode === 'login') {
    // 从课表工具箱直接进登录，跳过选校：默认北化
    pick(SCHOOLS[0]);
  }
});

function pick(s: School): void {
  school.value = s;
  address.value = s.jwBaseUrl || '';
  step.value = 'login';
  errMsg.value = '';
}

function back(): void {
  if (step.value === 'result') {
    step.value = 'login';
    return;
  }
  if (step.value === 'login') {
    step.value = 'school';
    return;
  }
  uni.navigateBack();
}

/* ---------- 登录 ---------- */

async function startLogin(): Promise<void> {
  if (busy.value) return;
  if (!address.value.trim()) {
    toast('先填教务系统地址');
    return;
  }
  errMsg.value = '';
  busy.value = true;
  needCaptcha.value = false;
  captchaCode.value = '';

  const r = await beginLogin(address.value);
  if (!r.ok || !r.session) {
    busy.value = false;
    errMsg.value = r.error;
    return;
  }
  session.value = r.session;

  // 要验证码就先停下来让用户填，**不能**每次都重开会话（码会永远对不上）
  if (r.session.info.hasCaptcha) {
    needCaptcha.value = true;
    captchaImg.value = r.captchaDataUrl;
    busy.value = false;
    if (!r.captchaDataUrl) toast('验证码图片没取到，可稍后重试');
    return;
  }
  await doSubmit();
}

async function doSubmit(): Promise<void> {
  if (!session.value) return;
  busy.value = true;
  errMsg.value = '';
  const r = await submitLogin(session.value, {
    username: username.value,
    password: password.value,
    captcha: captchaCode.value,
    semester: semester.value
  });
  busy.value = false;

  if (!r.ok) {
    errMsg.value = describeImportError(r);
    if (r.errorKind === 'NEED_CAPTCHA') {
      needCaptcha.value = true;
      // 码错了就换一张，同时保留会话
      const again = await beginLogin(address.value);
      if (again.ok && again.session) {
        session.value = again.session;
        captchaImg.value = again.captchaDataUrl;
      }
    }
    return;
  }
  result.value = r;
  step.value = 'result';
  // 密码用完立刻清掉，不留在内存/状态里
  password.value = '';
}

async function refreshCaptcha(): Promise<void> {
  const r = await beginLogin(address.value);
  if (r.ok && r.session) {
    session.value = r.session;
    captchaImg.value = r.captchaDataUrl;
    captchaCode.value = '';
    toast('已刷新验证码');
  } else {
    toast(r.error || '刷新失败');
  }
}

/* ---------- 入库 ---------- */

const seeds = computed<CourseSeed[]>(() => {
  const rows = result.value?.courses || [];
  return rows.map((r) => {
    // 地点形如「东区 主教301」：第一段当校区，其余当教室（与原工程 toCourses 一致）
    const parts = String(r.rooms || '').trim().split(/\s+/);
    const hasCampus = parts.length > 1;
    return {
      name: r.name,
      teacher: r.teacher,
      room: hasCampus ? parts.slice(1).join(' ') : parts[0] || '',
      campus: hasCampus ? parts[0] : '',
      day: r.day,
      startPeriod: r.startPeriod,
      endPeriod: r.endPeriod,
      weeks: r.weeks,
      weeksRaw: r.weeksText
    };
  });
});

const noWeeks = computed(() => seeds.value.filter((s) => !s.weeks.length).length);

const conflicts = computed(() => {
  if (importMode.value !== 'merge') return 0;
  const ttId = activeTimetable.value?.id;
  if (!ttId) return 0;
  let n = 0;
  for (const s of seeds.value) {
    const hit = db.courses.some(
      (c) =>
        c.timetableId === ttId &&
        c.day === s.day &&
        c.startPeriod <= s.endPeriod &&
        s.startPeriod <= c.endPeriod &&
        c.name !== s.name &&
        c.weeks.some((w) => s.weeks.includes(w))
    );
    if (hit) n++;
  }
  return n;
});

function confirmImport(): void {
  const r = result.value;
  if (!r?.ok) return;
  let ttId = activeTimetable.value?.id;
  if (importMode.value === 'new' || !ttId) {
    const t = createTimetable(r.semesterLabel || '教务课表', { semesterLabel: r.semesterLabel });
    ttId = t.id;
  }
  const n = importCourses(ttId, seeds.value, importMode.value === 'new' ? 'overwrite' : 'merge');
  toast(`导入完成：${n} 条上课安排`);
  setTimeout(() => {
    uni.navigateBack();
  }, 600);
}

const addrHint = computed(() => (address.value ? addressHint(address.value) : ''));
</script>

<template>
  <view class="screen" :class="themeClass">
    <!-- 导航栏 -->
    <view class="nav" :style="{ paddingTop: statusBar + 6 + 'px' }">
      <view class="nav-back" @click="back">‹</view>
      <text class="nav-title">{{ step === 'school' ? '选择学校' : step === 'login' ? '从教务系统导入' : '确认导入' }}</text>
      <view class="nav-spacer"></view>
    </view>

    <!-- ============ ① 选学校 ============ -->
    <block v-if="step === 'school'">
      <view class="searchwrap">
        <view class="search">
          <text class="s-ico">⌕</text>
          <input v-model="keyword" class="s-ipt" placeholder="搜索学校，如「北化」" placeholder-class="ph" />
        </view>
      </view>
      <scroll-view class="scroll" scroll-y>
        <view class="section-title">已支持一键导入</view>
        <view class="list">
          <view v-for="s in list.filter((x) => x.status === 'live')" :key="s.id" class="li" @click="pick(s)">
            <view class="avatar live">{{ s.short.slice(0, 1) }}</view>
            <view class="grow">
              <text class="row-t">{{ s.name }}</text>
              <text class="row-d">{{ s.province }} · 正方教务</text>
            </view>
            <text class="pill ok">已支持</text>
            <text class="chev">›</text>
          </view>
        </view>

        <view class="section-title" style="margin-top: 40rpx">其它学校</view>
        <view class="list">
          <view v-for="s in list.filter((x) => x.status !== 'live')" :key="s.id" class="li" @click="pick(s)">
            <view class="avatar">{{ s.short.slice(0, 1) }}</view>
            <view class="grow">
              <text class="row-t">{{ s.name }}</text>
              <text class="row-d">{{ s.province }}</text>
            </view>
            <text class="pill">待适配</text>
            <text class="chev">›</text>
          </view>
        </view>
        <view class="tip">
          其它学校还没核实教务地址，点进去可以自己粘一个登录页地址试一下；正方的流程是通用的。
        </view>
      </scroll-view>
    </block>

    <!-- ============ ② 登录 ============ -->
    <block v-else-if="step === 'login'">
      <scroll-view class="scroll" scroll-y>
        <view class="hero">
          <view class="hero-t">登录 {{ school?.name }}</view>
          <view class="hero-d">用学校统一身份 / 教务账号登录，课表会直接拉下来。密码只在本次登录中使用。</view>
        </view>

        <view class="section-title">教务系统</view>
        <view class="group">
          <view class="grow">
            <input v-model="address" class="g-ipt" placeholder="https://jwglxt.buct.edu.cn" placeholder-class="ph" />
          </view>
        </view>
        <view v-if="addrHint" class="hint">{{ addrHint }}</view>

        <view class="section-title" style="margin-top: 36rpx">账号</view>
        <view class="group">
          <view class="g-row">
            <text class="g-lab">学号</text>
            <input v-model="username" class="g-ipt right" placeholder="如 2025040140" placeholder-class="ph" />
          </view>
          <view class="g-row">
            <text class="g-lab">密码</text>
            <input v-model="password" class="g-ipt right" password placeholder="教务系统密码" placeholder-class="ph" />
          </view>
          <view class="g-row">
            <text class="g-lab">学期</text>
            <picker mode="selector" :range="SEMESTERS.map((s) => s.label)" :value="SEMESTERS.findIndex((s) => s.v === semester)" @change="(e) => (semester = SEMESTERS[Number(e.detail.value)].v)">
              <view class="g-pick">{{ SEMESTERS.find((s) => s.v === semester)?.label }}<text class="chev">›</text></view>
            </picker>
          </view>
        </view>

        <!-- 验证码 -->
        <template v-if="needCaptcha">
          <view class="section-title" style="margin-top: 36rpx">验证码</view>
          <view class="group">
            <view class="g-row">
              <input v-model="captchaCode" class="g-ipt" placeholder="输入图中字符" placeholder-class="ph" maxlength="6" />
              <image v-if="captchaImg" class="captcha" :src="captchaImg" mode="aspectFit" @click="refreshCaptcha" />
              <view v-else class="captcha refresh" @click="refreshCaptcha">刷新</view>
            </view>
          </view>
          <view class="hint">点图片可以换一张。验证码和本次登录会话绑定，换图后请重新输入。</view>
        </template>

        <view v-if="errMsg" class="errbox">
          <text class="err-t">导入没成功</text>
          <text class="err-d">{{ errMsg }}</text>
        </view>

        <view class="actions">
          <button v-if="!needCaptcha" class="btn block" :disabled="busy" @click="startLogin">
            {{ busy ? '正在登录…' : '登录并导入' }}
          </button>
          <button v-else class="btn block" :disabled="busy" @click="doSubmit">
            {{ busy ? '正在导入…' : '确认导入' }}
          </button>
        </view>

        <view class="tip">
          校外访问不了教务系统的话，先连学校 VPN 或校园网再试。
        </view>
      </scroll-view>
    </block>

    <!-- ============ ③ 预览入库 ============ -->
    <block v-else-if="step === 'result' && result">
      <scroll-view class="scroll" scroll-y>
        <view class="hero">
          <view class="hero-t">识别到 {{ result.distinct }} 门课</view>
          <view class="hero-d">{{ result.semesterLabel }} · 共 {{ result.courses.length }} 条上课安排</view>
        </view>

        <view class="list">
          <view class="li"><text class="grow muted">学期</text><text>{{ result.semesterLabel }}</text></view>
          <view class="li"><text class="grow muted">上课安排</text><text>{{ result.courses.length }} 条</text></view>
          <view class="li"><text class="grow muted">周次未识别</text><text>{{ noWeeks }} 条</text></view>
          <view class="li"><text class="grow muted">与本课表冲突</text><text>{{ conflicts }} 条</text></view>
        </view>

        <view class="section-title" style="margin-top: 36rpx">导入到</view>
        <view class="list">
          <view class="li" @click="importMode = 'new'">
            <view class="grow">
              <text class="row-t">新建一张课表</text>
              <text class="row-d">{{ result.semesterLabel }}</text>
            </view>
            <text class="check" :class="{ on: importMode === 'new' }">✓</text>
          </view>
          <view v-if="hasTimetable" class="li" @click="importMode = 'merge'">
            <view class="grow">
              <text class="row-t">合并到「{{ activeTimetable?.name }}」</text>
              <text class="row-d">同名同时段的安排会被替换，其它手动修正保留</text>
            </view>
            <text class="check" :class="{ on: importMode === 'merge' }">✓</text>
          </view>
        </view>

        <view v-if="noWeeks" class="hint">有 {{ noWeeks }} 条安排的周次没认出来，导入后可以手动补。</view>

        <view class="actions">
          <button class="btn block" @click="confirmImport">确认导入</button>
          <button class="btn ghost block" style="margin-top: 20rpx" @click="step = 'login'">返回重来</button>
        </view>
        <view class="tip">导入只写入课表，不会改你的账号资料。</view>
      </scroll-view>
    </block>
  </view>
</template>

<style scoped>
/* ---------- 导航栏 ---------- */
.nav {
  display: flex;
  align-items: center;
  padding: 6rpx 24rpx 12rpx;
  background: var(--bg);
  flex-shrink: 0;
}
.nav-back {
  width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48rpx;
  line-height: 1;
  color: var(--brand);
}
.nav-back:active {
  opacity: 0.5;
}
.nav-title {
  flex: 1;
  text-align: center;
  font-size: 34rpx;
  font-weight: 600;
}
.nav-spacer {
  width: 64rpx;
}

/* ---------- 搜索 ---------- */
.searchwrap {
  padding: 8rpx var(--pad) 20rpx;
}
.search {
  display: flex;
  align-items: center;
  gap: 12rpx;
  height: 72rpx;
  padding: 0 20rpx;
  border-radius: 20rpx;
  background: rgba(120, 120, 128, 0.12);
}
.s-ico {
  font-size: 28rpx;
  color: var(--text-2);
}
.s-ipt {
  flex: 1;
  font-size: 32rpx;
  height: 72rpx;
}

/* ---------- 列表 ---------- */
.avatar {
  width: 76rpx;
  height: 76rpx;
  border-radius: 20rpx;
  background: rgba(120, 120, 128, 0.12);
  color: var(--text-2);
  font-size: 32rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.avatar.live {
  background: var(--brand);
  color: #fff;
}
.row-t {
  display: block;
  font-size: 34rpx;
  line-height: 44rpx;
  color: var(--text);
}
.row-d {
  display: block;
  font-size: 26rpx;
  line-height: 34rpx;
  color: var(--text-2);
  margin-top: 2rpx;
}
.chev {
  color: var(--text-3);
  font-size: 36rpx;
  line-height: 1;
  margin-left: 8rpx;
}

/* ---------- 登录表单 ---------- */
.hero {
  padding: 12rpx 8rpx 32rpx;
}
.hero-t {
  font-size: 52rpx;
  line-height: 64rpx;
  font-weight: 700;
  letter-spacing: -0.6rpx;
}
.hero-d {
  font-size: 28rpx;
  line-height: 40rpx;
  color: var(--text-2);
  margin-top: 8rpx;
}
.group {
  background: var(--card);
  border-radius: var(--r);
  overflow: hidden;
  padding: 8rpx 28rpx;
}
.g-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  min-height: 88rpx;
  position: relative;
}
.g-row + .g-row::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 1px;
  background: var(--line);
  transform: scaleY(0.5);
}
.g-lab {
  font-size: 32rpx;
  color: var(--text);
  width: 100rpx;
  flex-shrink: 0;
}
.g-ipt {
  flex: 1;
  min-height: 88rpx;
  font-size: 32rpx;
}
.g-ipt.right {
  text-align: right;
}
.g-pick {
  font-size: 32rpx;
  color: var(--brand);
  display: flex;
  align-items: center;
  gap: 6rpx;
  min-height: 88rpx;
  justify-content: flex-end;
}
.hint {
  font-size: 24rpx;
  line-height: 34rpx;
  color: var(--text-2);
  padding: 12rpx 8rpx 0;
}
.tip {
  font-size: 24rpx;
  line-height: 34rpx;
  color: var(--text-2);
  padding: 32rpx 8rpx 40rpx;
}
.captcha {
  width: 200rpx;
  height: 76rpx;
  border-radius: 12rpx;
  background: var(--soft);
  flex-shrink: 0;
}
.captcha.refresh {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
  color: var(--brand);
}

/* ---------- 错误块 ---------- */
.errbox {
  margin-top: 32rpx;
  background: rgba(255, 59, 48, 0.08);
  border-radius: var(--r);
  padding: 24rpx 28rpx;
}
.err-t {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--danger);
  margin-bottom: 8rpx;
}
.err-d {
  display: block;
  font-size: 26rpx;
  line-height: 38rpx;
  color: #7a2621;
  white-space: pre-wrap;
}

.actions {
  margin-top: 40rpx;
}

/* 勾选 */
.check {
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  border: 2rpx solid var(--line);
  color: transparent;
  font-size: 26rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.check.on {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}
</style>
