/**
 * 网络适配层
 *
 * 【原实现】业务代码直接 fetch(...)，靠 Android WebView 的**同源 Cookie** 维持教务会话
 * 【小程序】没有 fetch，只有 uni.request；而且有三条硬约束：
 *   1) 域名必须 HTTPS、已备案、且写进小程序后台「开发管理 → 服务器域名 → request 合法域名」
 *      （最多 20 个，不能填 IP、不能带端口）
 *   2) **不会自动带 Cookie，也不自动存 Set-Cookie** —— 要自己维护一个 Cookie 罐
 *   3) 没有"在目标域名的页面里执行 JS"这回事 —— 正方登录页的 jsbn 加密、隐藏字段
 *      只能自己用纯函数重算（好消息：src/services/zfClient.ts 本来就是纯函数，可直接搬）
 *
 * 这个文件把 (2) 补上了：一个按 host 分桶的最小 Cookie 罐。
 */

const TIMEOUT = 15000;

/** host → { cookieName: value } */
const jar = new Map<string, Map<string, string>>();

function hostOf(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1].toLowerCase() : url;
}

function cookieHeader(url: string): string {
  const bucket = jar.get(hostOf(url));
  if (!bucket || bucket.size === 0) return '';
  return [...bucket.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** 吃下 Set-Cookie。小程序里这个头可能是 string 或 string[] */
function eatCookies(url: string, setCookie?: string | string[]): void {
  if (!setCookie) return;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  const host = hostOf(url);
  let bucket = jar.get(host);
  if (!bucket) {
    bucket = new Map();
    jar.set(host, bucket);
  }
  for (const line of list) {
    const first = String(line).split(';')[0];
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name) continue;
    // 服务端删 Cookie 的写法：值为空或已过期
    if (value === '' || /max-age=0/i.test(String(line))) bucket.delete(name);
    else bucket.set(name, value);
  }
}

export function clearCookies(url?: string): void {
  if (url) jar.delete(hostOf(url));
  else jar.clear();
}

export function cookieCount(url: string): number {
  return jar.get(hostOf(url))?.size ?? 0;
}

export interface RawResponse {
  statusCode: number;
  header: Record<string, string>;
  /** 原样返回文本：正方返回的既有 JSON 也有 HTML，解析交给 zfClient */
  body: string;
  /** 最终 URL（重定向后），正方登录会 302 到 /jwglxt/xtgl/index_initMenu.html */
  finalUrl: string;
}

/**
 * 发一个请求并返回原始文本。
 * 教务系统这种"要自己读 HTML 里的隐藏字段"的场景必须用这个，不能用下面的 request()。
 */
export function requestRaw(options: {
  url: string;
  method?: 'GET' | 'POST';
  data?: Record<string, any> | string;
  header?: Record<string, string>;
  /** 表单提交：正方登录页是 application/x-www-form-urlencoded */
  form?: boolean;
  timeout?: number;
}): Promise<RawResponse> {
  const method = options.method ?? 'GET';
  const header: Record<string, string> = { ...(options.header ?? {}) };
  if (options.form) header['Content-Type'] = 'application/x-www-form-urlencoded';
  const cookie = cookieHeader(options.url);
  if (cookie) header['Cookie'] = cookie;

  return new Promise((resolve, reject) => {
    uni.request({
      url: options.url,
      method,
      data: options.data as any,
      header,
      timeout: options.timeout ?? TIMEOUT,
      dataType: 'text', // ⚠️ 关键：不要让框架自动 JSON.parse，HTML 会被转坏
      responseType: 'text',
      success: (res: any) => {
        eatCookies(options.url, res.header?.['Set-Cookie'] ?? res.header?.['set-cookie']);
        resolve({
          statusCode: res.statusCode,
          header: res.header ?? {},
          body: typeof res.data === 'string' ? res.data : JSON.stringify(res.data),
          finalUrl: options.url
        });
      },
      fail: (err: any) => reject(new Error('网络请求失败：' + (err?.errMsg || '未知错误')))
    });
  });
}

/** 常用封装：拿 JSON。失败抛错，由调用方决定重试还是提示 */
export async function requestJson<T>(options: Parameters<typeof requestRaw>[0]): Promise<T> {
  const res = await requestRaw(options);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`HTTP ${res.statusCode}`);
  }
  return JSON.parse(res.body) as T;
}

/**
 * 拉二进制（验证码图片这类）：返回 ArrayBuffer。
 * 必须和 requestRaw 共用同一个 Cookie 罐 —— 正方验证码是**会话绑定**的，
 * 换了 Cookie 去取图，拿到的码就对不上。
 */
export function requestBinary(url: string, timeout = 8000): Promise<ArrayBuffer> {
  const header: Record<string, string> = {};
  const cookie = cookieHeader(url);
  if (cookie) header['Cookie'] = cookie;

  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method: 'GET',
      header,
      responseType: 'arraybuffer',
      timeout,
      success: (res: any) => {
        eatCookies(url, res.header?.['Set-Cookie'] ?? res.header?.['set-cookie']);
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        resolve(res.data as ArrayBuffer);
      },
      fail: (err: any) => reject(new Error(err?.errMsg || '网络请求失败'))
    });
  });
}

/**
 * 天气：原工程用 open-meteo（免 key）。
 * 迁移时要先去小程序后台把这个域名加进 request 白名单，否则真机直接报
 * "request 合法域名校验出错"（开发者工具里勾了"不校验合法域名"是看不出来的）。
 */
export const WEATHER_HOST = 'https://api.open-meteo.com';
