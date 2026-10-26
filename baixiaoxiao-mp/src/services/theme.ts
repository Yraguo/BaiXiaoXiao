/**
 * 主题（浅色 / 深色 / 跟随系统）
 *
 * 【小程序怎么"跟随手机"】
 *   uni.onThemeChange 只在基础库 2.11+ 且宿主开启 darkmode 时才有回调，
 *   所以第一次进来必须自己读一次当前值：uni.getSystemInfoSync().theme。
 *   两者都没有时按浅色走 —— 宁可是浅色，也不要在浅色系统上突然黑屏。
 *
 * 【为什么不用 pages.json 的 darkmode + theme.json】
 *   那套只能改**原生导航栏和原生 tabBar**的颜色。我们这个 App 的页头是自定义的，
 *   tabBar 也是自己画的（要跟 百小鸮 一致），所以颜色全部走 CSS 变量更快更准。
 */
import { computed, ref } from 'vue';
import { readText, writeText } from '../adapters/storage';

export type ThemeMode = 'system' | 'light' | 'dark';

const KEY = 'settings/themeMode';

const mode = ref<ThemeMode>('system');
const systemDark = ref(false);

/** 当前是否深色 */
export const isDark = computed(() => mode.value === 'dark' || (mode.value === 'system' && systemDark.value));

/** 挂在页面根节点上的 class：`<view class="screen" :class="themeClass">` */
export const themeClass = computed(() => (isDark.value ? 'theme-dark' : ''));

export const themeMode = computed(() => mode.value);

function readSystemTheme(): boolean {
  try {
    const info = uni.getSystemInfoSync() as any;
    if (typeof info.theme === 'string') return info.theme === 'dark';
    // 老基础库没有 theme 字段：用背景亮度兜底（HarmonyOS / 部分安卓 ROM 走这里）
    if (typeof info.hostTheme === 'string') return info.hostTheme === 'dark';
  } catch {
    /* ignore */
  }
  return false;
}

/** 同步原生层（下拉回弹时露出的底色、状态栏文字颜色） */
function syncNative(): void {
  try {
    uni.setBackgroundColor?.({ backgroundColor: isDark.value ? '#000000' : '#F2F2F7' });
  } catch {
    /* 部分宿主不支持，忽略 */
  }
  try {
    uni.setNavigationBarColor?.({
      frontColor: isDark.value ? '#ffffff' : '#000000',
      backgroundColor: isDark.value ? '#000000' : '#F2F2F7'
    });
  } catch {
    /* 我们用的是自定义导航，失败也无所谓 */
  }
}

export function initTheme(): void {
  const saved = readText(KEY) as ThemeMode | null;
  if (saved === 'light' || saved === 'dark' || saved === 'system') mode.value = saved;
  systemDark.value = readSystemTheme();
  syncNative();

  try {
    // @ts-ignore 小程序专有，H5 没有
    uni.onThemeChange?.((res: any) => {
      systemDark.value = res.theme === 'dark';
      syncNative();
    });
  } catch {
    /* H5 预览：跟随不了系统，由用户手动切 */
  }
}

export function setThemeMode(next: ThemeMode): void {
  mode.value = next;
  writeText(KEY, next);
  syncNative();
}

export const THEME_OPTIONS: Array<{ v: ThemeMode; label: string; desc: string }> = [
  { v: 'system', label: '跟随系统', desc: '手机切深色就跟着变' },
  { v: 'light', label: '浅色', desc: '始终白底' },
  { v: 'dark', label: '深色', desc: '始终黑底' }
];
