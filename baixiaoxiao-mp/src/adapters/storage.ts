/**
 * 存储适配层
 *
 * 【原实现】src/services/io.ts
 *   原生：Capacitor Filesystem 写应用私有目录（getExternalFilesDir）
 *   预览：localStorage.setItem('unimate:' + path)
 *
 * 【小程序】没有 localStorage、没有跨端文件目录，只有两套东西：
 *   uni.setStorageSync / getStorageSync   —— 键值缓存，单 key 1MB、总量 10MB
 *   wx.getFileSystemManager()             —— 沙盒文件，USER_DATA_PATH 下，总量 200MB
 *
 * 策略：小数据（课表、设置、账号回执）走 Storage；备份 zip 之类的大文件走文件系统。
 * 键名保留原工程的 'unimate:' 前缀**不改** —— 改了等于把老用户的本地数据丢掉。
 * 品牌换了，存储键不该换（迁移铁律）。
 */

const NS = 'unimate:'; // ⚠️ 故意保留旧前缀，见上

export function readText(path: string): string | null {
  try {
    const v = uni.getStorageSync(NS + path);
    return v === '' || v === undefined ? null : (v as string);
  } catch {
    return null;
  }
}

export function writeText(path: string, text: string): void {
  uni.setStorageSync(NS + path, text);
}

export function remove(path: string): void {
  try {
    uni.removeStorageSync(NS + path);
  } catch {
    /* 不存在就算了 */
  }
}

export function exists(path: string): boolean {
  return readText(path) !== null;
}

/** JSON 便捷封装 */
export function readJson<T>(path: string, fallback: T): T {
  const raw = readText(path);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(path: string, data: unknown): void {
  writeText(path, JSON.stringify(data));
}

/** 剩余空间（KB）。小程序有 10MB 上限，写备份前先探一下，别写到一半失败 */
export function storageInfo(): { currentSize: number; limitSize: number } {
  try {
    const i = uni.getStorageInfoSync();
    return { currentSize: i.currentSize, limitSize: i.limitSize };
  } catch {
    return { currentSize: 0, limitSize: 10240 };
  }
}

export function clearAll(): void {
  try {
    uni.clearStorageSync();
  } catch {
    /* noop */
  }
}
