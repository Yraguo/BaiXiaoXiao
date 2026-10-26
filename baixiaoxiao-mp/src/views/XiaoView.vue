<script setup lang="ts">
/**
 * 小鸮（离线版）
 *
 * 【离线怎么做到的】不调任何网络：所有回答都在本机算 ——
 *   课表、记事、二课分数直接从 store 读，复习建议按课表生成。
 *   所以断网、没配域名、没开后台白名单都能用。
 *   命中不了的问题会如实说"还没学会"，不编答案。
 *
 * 对话逻辑全部在 services/xiao/engine.ts 里（规则 + 本机数据），
 * 这里只负责界面与消息列表。
 */
import { computed, nextTick, ref } from 'vue';
import { ask, QUICK_ASKS } from '../services/xiao/engine';
import { toast } from '../adapters/platform';
import AppIcon from '../components/AppIcon.vue';

interface Msg {
  role: 'user' | 'bot';
  text: string;
}

const msgs = ref<Msg[]>([]);
const draft = ref('');
const busy = ref(false);

const QUICK = QUICK_ASKS;

const hasChat = computed(() => msgs.value.length > 0);

async function send(text?: string): Promise<void> {
  const q = (text ?? draft.value).trim();
  if (!q || busy.value) return;
  msgs.value.push({ role: 'user', text: q });
  draft.value = '';
  busy.value = true;
  await nextTick();
  setTimeout(() => {
    msgs.value.push({ role: 'bot', text: ask(q).text });
    busy.value = false;
  }, 220);
}

function clearChat(): void {
  if (!msgs.value.length) {
    toast('还没有对话');
    return;
  }
  msgs.value = [];
  toast('已清空（仅本机）');
}
</script>

<template>
  <view class="wrap">
    <view class="hist" @click="clearChat">
      <AppIcon name="history" :size="14" class="h-ico" />
      <text class="h-t">历史对话 · {{ hasChat ? msgs.length + ' 条' : '暂无记录' }}</text>
      <text class="grow"></text>
      <text class="h-r">仅保存在本机 ›</text>
    </view>

    <scroll-view class="scroll" scroll-y :scroll-into-view="'m' + (msgs.length - 1)">
      <template v-if="!hasChat">
        <view class="landing">
          <AppIcon name="sparkles" :size="30" class="spark" />
          <text class="l-title">我是小鸮</text>
          <text class="l-sub">问课程安排、查记事、算二课分、找校园入口。全部在本机算，答不上来会直说。</text>
          <view class="offline">
            <AppIcon name="info" :size="11" tone="gray" />
            <text class="off-t">离线可用 · 不联网也能问</text>
          </view>
        </view>

        <view class="quick">
          <view v-for="q in QUICK" :key="q.text" class="qrow" @click="send(q.text)">
            <AppIcon :name="q.icon" :size="18" class="q-ico" />
            <text class="q-t">{{ q.text }}</text>
          </view>
        </view>

        <view class="tips">
          <text class="tip-t">也可以换个说法问我：</text>
          <text class="tip-l">今天下午有课吗 · 高数在哪上 · 谁教大物</text>
          <text class="tip-l">这周哪天没课 · 还有几周放假 · 哪个板块最缺</text>
        </view>
      </template>

      <template v-else>
        <view v-for="(m, i) in msgs" :id="'m' + i" :key="i" class="msg" :class="m.role">
          <view v-if="m.role === 'bot'" class="avatar">小</view>
          <view class="bubble" :class="m.role"><text>{{ m.text }}</text></view>
        </view>
        <view style="height: 160rpx"></view>
      </template>
    </scroll-view>

    <view class="composer">
      <input
        v-model="draft"
        class="ipt"
        placeholder="和小鸮说点什么…"
        placeholder-class="ph"
        confirm-type="send"
        @confirm="send()"
      />
      <view class="send" :class="{ off: !draft.trim() || busy }" @click="send()">发送</view>
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
.hist {
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 14rpx var(--pad);
  background: var(--brand-tint);
  flex-shrink: 0;
}
.h-ico {
  flex: none;
}
.h-t {
  font-size: 26rpx;
  color: var(--brand);
  font-weight: 500;
}
.h-r {
  font-size: 22rpx;
  color: var(--text-2);
}

.scroll {
  flex: 1;
  height: 0;
  padding: 0 var(--pad);
}

.landing {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 56rpx 24rpx 32rpx;
}
.spark {
  margin-bottom: 10rpx;
}
.l-title {
  font-size: 40rpx;
  line-height: 50rpx;
  font-weight: 700;
  color: var(--text);
}
.l-sub {
  font-size: 26rpx;
  line-height: 40rpx;
  color: var(--text-2);
  text-align: center;
  margin-top: 12rpx;
}
.offline {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-top: 20rpx;
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
  background: var(--soft);
}
.off-t {
  font-size: 21rpx;
  color: var(--text-2);
}

.quick {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}
.qrow {
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 28rpx 26rpx;
  border-radius: var(--r);
  background: var(--card);
}
.qrow:active {
  background: var(--soft);
}
.q-ico {
  flex: none;
}
.q-t {
  font-size: 30rpx;
  color: var(--text);
}

.tips {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  padding: 28rpx 8rpx 0;
}
.tip-t {
  font-size: 23rpx;
  color: var(--text-3);
}
.tip-l {
  font-size: 23rpx;
  line-height: 34rpx;
  color: var(--text-3);
}

.msg {
  display: flex;
  gap: 16rpx;
  margin-bottom: 24rpx;
  align-items: flex-start;
}
.msg.user {
  flex-direction: row-reverse;
}
.avatar {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  background: var(--brand);
  color: #fff;
  font-size: 28rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.bubble {
  max-width: 78%;
  padding: 20rpx 24rpx;
  border-radius: 20rpx;
  font-size: 28rpx;
  line-height: 42rpx;
  white-space: pre-wrap;
}
.bubble.bot {
  background: var(--card);
  color: var(--text);
  border-top-left-radius: 6rpx;
}
.bubble.user {
  background: var(--brand);
  color: #fff;
  border-top-right-radius: 6rpx;
}

.composer {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 16rpx var(--pad) calc(16rpx + env(safe-area-inset-bottom));
  background: var(--card);
  border-top: 1px solid var(--line);
  flex-shrink: 0;
}
.ipt {
  flex: 1;
  height: 84rpx;
  padding: 0 26rpx;
  border-radius: 20rpx;
  background: var(--field);
  font-size: 30rpx;
  color: var(--text);
}
.send {
  min-width: 128rpx;
  height: 84rpx;
  border-radius: 20rpx;
  background: var(--brand);
  color: #fff;
  font-size: 30rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}
.send.off {
  opacity: 0.45;
}
</style>
