/**
 * 平台能力适配层 · 总入口
 *
 * 【为什么要有这一层】
 * 百小鸮 里到处是 `Capacitor.isNativePlatform()`、`window`、`document`。
 * 小程序里这些全没有。与其在 20 多个 .vue 里各写一遍 if，不如把"平台差异"
 * 全部收进 adapters/ 目录：业务代码只调这里的函数，不再直接摸平台 API。
 *
 * 判定规则很简单：**业务层不许出现 window / document / Capacitor / wx.**
 * （唯一例外是本目录）
 */

/** 运行时平台。mp-weixin = 微信小程序；h5 = 浏览器预览 */
export type Platform = 'mp-weixin' | 'h5' | 'app';

export function platform(): Platform {
  // #ifdef MP-WEIXIN
  return 'mp-weixin';
  // #endif
  // #ifdef H5
  return 'h5';
  // #endif
  // #ifdef APP-PLUS
  return 'app';
  // #endif
  // eslint-disable-next-line no-unreachable
  return 'h5';
}

export const isMiniProgram = (): boolean => platform() === 'mp-weixin';

/**
 * 状态栏高度（px）。
 * 小程序自定义导航必须自己让出这一块，否则标题会被刘海/状态栏压住。
 * 原工程用 CSS 变量 --safe-t: env(safe-area-inset-top)，小程序拿不到，改成运行时读。
 */
export function statusBarHeight(): number {
  try {
    return uni.getSystemInfoSync().statusBarHeight ?? 20;
  } catch {
    return 20;
  }
}

/** 底部安全区（px）。iPhone 全面屏要给 tabBar 让位 */
export function safeBottom(): number {
  try {
    const info = uni.getSystemInfoSync() as any;
    const inset = info.safeAreaInsets?.bottom;
    if (typeof inset === 'number') return inset;
    const h = info.screenHeight ?? 0;
    const safe = info.safeArea?.bottom ?? h;
    return Math.max(0, h - safe);
  } catch {
    return 0;
  }
}

/** 启动链路打点：原工程有个 5 秒看门狗，小程序里同样需要，否则白屏无从排查 */
const trace: Array<{ at: number; tag: string }> = [];
export function bootTrace(tag: string): void {
  trace.push({ at: Date.now(), tag });
  if (trace.length > 40) trace.shift();
  // eslint-disable-next-line no-console
  console.log('[百小鸮]', tag, Date.now());
}
export function bootTraceList(): Array<{ at: number; tag: string }> {
  return trace.slice();
}

/** 轻提示。小程序没有 DOM，做不了自定义 toast 动画，用系统 API 最稳 */
export function toast(title: string, icon: 'none' | 'success' | 'error' = 'none'): void {
  uni.showToast({ title, icon, duration: 2000 });
}

/** 确认弹窗（对应原工程的 ConfirmDialog.vue，小程序用原生 modal 即可） */
export function confirm(title: string, content: string, confirmText = '确定'): Promise<boolean> {
  return new Promise((resolve) => {
    uni.showModal({
      title,
      content,
      confirmText,
      confirmColor: '#5587EC',
      success: (r) => resolve(!!r.confirm),
      fail: () => resolve(false)
    });
  });
}
