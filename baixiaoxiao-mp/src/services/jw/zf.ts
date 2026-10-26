/**
 * 正方 jwglxt 直连导入（小程序版）
 *
 * 【和原工程的区别，一句话】原工程把「登录」交给 Android WebView 里的人来做，
 * 原生只负责用那个会话去调课表接口；小程序没有可共享会话的 WebView，
 * 所以这里**把登录也搬到前端**：自己取登录页 → 自己算 RSA 密文 → 自己 POST → 自己带 Cookie 调接口。
 *
 * 好消息：协议逻辑本来就是纯函数（`shared/zfClient.ts` 的 RSA + 字段判定 + kbList 解析），
 * 一行没改就能用；缺的只是"会话管理"，那部分由 `adapters/request.ts` 的 Cookie 罐补上。
 *
 * 四个请求，全部同域：
 *   1. GET  {base}/xtgl/login_slogin.html         取 csrftoken / mmsfjm / RSA 公钥
 *   2. POST {base}/xtgl/login_slogin.html         提交学号密码（密码按需 RSA 加密）
 *   3. GET  {base}/kbcx/xskbcx_cxXskbcxIndex.html 探活：会话还在不在 / 有没有权限
 *   4. POST {base}/kbcx/xskbcx_cxXsKb.html        拿 kbList JSON
 *
 * 【安全边界】密码只在内存里过一手：RSA 加密后立刻提交，不落 Storage、不进日志、不写错误信息。
 */

import { requestRaw, requestBinary, clearCookies, cookieCount } from '../../adapters/request';
import { bytesToB64 } from '../../adapters/crypto';
import {
  CAPTCHA_FIELD,
  decidePasswordMode,
  describeZfError,
  encryptPassword,
  parseKbList,
  xqmOf,
  ZfError,
  type ZfErrorKind
} from '../../shared/zfClient';
import { loginUrlFor, parseJwAddress } from './address';

/* ============================ 常量 ============================ */

export const GNMKDM = 'N2151';

/** 9 月之后算新学年（2026-09 → "2026"），8 月及以前仍是上一学年 */
export function currentXnm(now: Date = new Date()): string {
  const y = now.getFullYear();
  return String(now.getMonth() + 1 >= 9 ? y : y - 1);
}

/* ============================ 登录页解析 ============================ */

export interface LoginPageInfo {
  csrfToken: string;
  /** true = 密码必须 RSA 加密后提交 */
  needEncrypt: boolean;
  modulus: string;
  exponent: string;
  /** 是否出现验证码字段 */
  hasCaptcha: boolean;
  /** 验证码图片地址（绝对），没有就是空 */
  captchaUrl: string;
}

/**
 * 从登录页 HTML 里挖出表单要素。
 *
 * RSA 公钥没有统一写法，正方各版本见过这几种，按顺序试：
 *   var modulus = "AN…" / modulus:"AN…" / setPublic("AN…","AQAB")
 * 全都找不到但页面又要求加密 → 抛 PAGE_CHANGED，**绝不退化成明文提交**
 * （这条边界是原工程拿同行的真实事故换来的：拿明文去登录必然失败，还把密码明文发给了服务器）。
 */
export function parseLoginPage(html: string, pageUrl: string): LoginPageInfo {
  const csrf = /name=["']csrftoken["'][^>]*value=["']([^"']*)["']/i.exec(html)?.[1] ?? '';
  const mmsfjm = /name=["']mmsfjm["'][^>]*value=["']([^"']*)["']/i.exec(html)?.[1];

  let modulus = '';
  let exponent = '';

  const setPublic = /setPublic\(\s*["']([^"']{40,})["']\s*,\s*["']([^"']+)["']\s*\)/i.exec(html);
  if (setPublic) {
    modulus = setPublic[1];
    exponent = setPublic[2];
  }
  if (!modulus) {
    modulus =
      /(?:var\s+)?modulus\s*[:=]\s*["']([A-Za-z0-9+/=]{40,})["']/i.exec(html)?.[1] ?? '';
  }
  if (!exponent) {
    exponent =
      /(?:var\s+)?exponent\s*[:=]\s*["']([A-Za-z0-9+/=]{2,8})["']/i.exec(html)?.[1] ?? 'AQAB';
  }

  // 密码模式判定交给 shared/zfClient，保证与原生版同一套口径
  if (mmsfjm === undefined) {
    /*
     * 字段完全不存在时**不能**当"不需要加密"。
     * 新正方一定是加密的，缺失说明页面结构变了 —— 拿明文去登录必然失败，
     * 而且把密码明文发给了服务器。宁可报 PAGE_CHANGED 让用户重试。
     * （这条边界来自原工程，别为了让"能跑"而放宽。）
     */
    throw new ZfError('PAGE_CHANGED', '登录页缺少密码加密标记（mmsfjm），页面结构可能已变更');
  }
  let needEncrypt = false;
  try {
    needEncrypt =
      decidePasswordMode(
        `<input type="hidden" name="mmsfjm" value="${mmsfjm}">` +
          `<input type="hidden" name="csrftoken" value="${csrf}">`
      ).mode === 'required';
  } catch (e) {
    if (e instanceof ZfError) throw e;
    needEncrypt = String(mmsfjm).trim() === '1';
  }

  const hasCaptcha = new RegExp(`name=["']${CAPTCHA_FIELD}["']`, 'i').test(html);
  // 验证码图片：常见是 /jwglxt/kaptcha 或 /jwglxt/xtgl/kaptcha
  let captchaUrl = '';
  const capSrc = /<img[^>]+src=["']([^"']*kaptcha[^"']*)["']/i.exec(html)?.[1];
  if (capSrc) {
    const origin = /^https?:\/\/[^/]+/i.exec(pageUrl)?.[0] ?? '';
    captchaUrl = /^https?:/i.test(capSrc) ? capSrc : origin + (capSrc.startsWith('/') ? '' : '/') + capSrc;
  }

  return { csrfToken: csrf, needEncrypt, modulus, exponent, hasCaptcha, captchaUrl };
}

/**
 * 教务系统根路径（登录页所在那一层，通常带 /jwglxt）。
 *
 * 【为什么不能直接用 baseUrl】
 * 用户可能只填 `https://jwglxt.buct.edu.cn`（没有路径），此时 baseUrl 就是裸域名，
 * 而课表接口实际在 `https://jwglxt.buct.edu.cn/jwglxt/kbcx/...`。
 * 直接拼 `${baseUrl}/kbcx/...` 会打到 404 —— 表现为"登录成功但拿不到课表"，
 * 极难往"少了一段路径"上想。所以统一从登录页地址倒推出根路径。
 */
export function jwRootOf(baseUrl: string): string {
  const login = loginUrlFor(baseUrl);
  const cut = login.replace(/\/xtgl\/login_slogin\.html.*$/i, '');
  return cut && cut !== login ? cut : String(baseUrl || '').replace(/\/+$/, '');
}

/* ============================ 结果类型 ============================ */

export interface ZfLoginInput {
  /** 用户填的教务地址（可以是完整登录页 URL，也可以是域名） */
  address: string;
  username: string;
  password: string;
  /** 验证码（页面要求时） */
  captcha?: string;
  /** 学期序号 1/2/3 */
  semester?: number;
}

export interface ZfCourseRow {
  name: string;
  teacher: string;
  rooms: string;
  day: number;
  startPeriod: number;
  endPeriod: number;
  weeksText: string;
  weeks: number[];
}

export interface ZfImportResult {
  ok: boolean;
  errorKind: ZfErrorKind | 'CORS_OR_NETWORK' | '';
  error: string;
  courses: ZfCourseRow[];
  /** 去重后的课程门数 */
  distinct: number;
  semesterLabel: string;
  raw: string;
}

const fail = (kind: ZfImportResult['errorKind'], error: string): ZfImportResult => ({
  ok: false,
  errorKind: kind,
  error,
  courses: [],
  distinct: 0,
  semesterLabel: '',
  raw: ''
});

/* ============================ 登录 ============================ */

/** 拉登录页，返回 HTML 与解析结果。也用来在用户点「刷新验证码」时复用 */
export async function loadLoginPage(baseUrl: string): Promise<{ html: string; info: LoginPageInfo; url: string }> {
  const url = loginUrlFor(baseUrl);
  if (!url) throw new ZfError('VALIDATION_FAILED', '教务地址不完整');
  const r = await requestRaw({ url, method: 'GET' });
  if (r.statusCode >= 400) {
    throw new ZfError('NETWORK_RETRYABLE', `登录页返回 HTTP ${r.statusCode}`);
  }
  return { html: r.body, info: parseLoginPage(r.body, url), url };
}

/** 把验证码图片取成 data URL（小程序 <image> 直接拉远程图不会带 Cookie，码就对不上） */
export async function fetchCaptchaDataUrl(captchaUrl: string): Promise<string> {
  if (!captchaUrl) return '';
  try {
    const buf = await requestBinary(captchaUrl);
    const b64 = bytesToB64(new Uint8Array(buf));
    return 'data:image/png;base64,' + b64;
  } catch {
    return '';
  }
}

/**
 * 打开登录页并（如有）取验证码图。
 *
 * 【为什么要拆成 begin / submit 两步】
 * 验证码是**会话绑定**的：先 GET 登录页拿到 JSESSIONID，再带着同一个 Cookie 去取验证码图，
 * 用户看到的码才对得上服务器记的码。如果每次提交都重新开一个会话，
 * 用户输入的码永远对不上 —— 表现为"验证码一直错"，极难排查。
 */
export interface LoginSession {
  baseUrl: string;
  loginUrl: string;
  info: LoginPageInfo;
}

export interface BeginLoginResult {
  ok: boolean;
  error: string;
  session?: LoginSession;
  captchaDataUrl: string;
}

export async function beginLogin(address: string): Promise<BeginLoginResult> {
  const parsed = parseJwAddress(address);
  if (!parsed.ok) return { ok: false, error: parsed.error, captchaDataUrl: '' };
  try {
    // 换学校 / 换账号先清会话，避免串号
    clearCookies();
    const { info, url } = await loadLoginPage(parsed.parts.baseUrl);
    const captchaDataUrl = info.hasCaptcha ? await fetchCaptchaDataUrl(info.captchaUrl) : '';
    return {
      ok: true,
      error: '',
      session: { baseUrl: parsed.parts.baseUrl, loginUrl: url, info },
      captchaDataUrl
    };
  } catch (e) {
    const msg = e instanceof ZfError ? describeZfError(e.kind) : e instanceof Error ? e.message : String(e);
    return { ok: false, error: '打不开登录页：' + msg, captchaDataUrl: '' };
  }
}

/**
 * 提交登录 → 探活 → 拉 kbList → 解析。
 * 任何一步失败都返回**分类错误**，由 UI 映射成人话（话术唯一来源是 zfClient.describeZfError）。
 */
export async function submitLogin(
  session: LoginSession,
  input: { username: string; password: string; captcha?: string; semester?: number }
): Promise<ZfImportResult> {
  const base = session.baseUrl;
  const jwRoot = jwRootOf(base);
  const info = session.info;

  if (!input.username.trim()) return fail('VALIDATION_FAILED', '请填写学号');
  if (!input.password) return fail('VALIDATION_FAILED', '请填写密码');

  const semester = input.semester ?? 1;
  let xqm: string;
  try {
    xqm = xqmOf(semester);
  } catch {
    return fail('VALIDATION_FAILED', '学期选择不对');
  }

  try {
    if (info.needEncrypt && !info.modulus) {
      return fail('PAGE_CHANGED', '登录页要求加密密码，但没找到 RSA 公钥。为安全起见不会用明文提交。');
    }

    const mm = info.needEncrypt
      ? encryptPassword(input.password, info.modulus, info.exponent)
      : input.password;

    const form = [
      'csrftoken=' + encodeURIComponent(info.csrfToken),
      'language=' + encodeURIComponent('zh_CN'),
      'yhm=' + encodeURIComponent(input.username.trim()),
      'mm=' + encodeURIComponent(mm),
      CAPTCHA_FIELD + '=' + encodeURIComponent(input.captcha || '')
    ].join('&');

    const post = await requestRaw({
      url: session.loginUrl,
      method: 'POST',
      data: form,
      form: true,
      header: { Referer: session.loginUrl, Origin: base }
    });

    // 登录失败的判定：POST 之后拿回来的还是登录页（含账号输入框）
    const stillLogin = post.body.includes('login_slogin.html') || /name=["']yhm["']/.test(post.body);
    if (stillLogin) {
      const captchaWrong = /验证码|yzm/i.test(post.body) && /错误|不正确/.test(post.body);
      const pwdWrong = /用户名|密码/.test(post.body) && /错误|不正确|不存在/.test(post.body);
      if (captchaWrong) return fail('NEED_CAPTCHA', '验证码不对，请重新输入。');
      if (pwdWrong) return fail('INVALID_CREDENTIALS', describeZfError('INVALID_CREDENTIALS'));
      if (info.hasCaptcha && !input.captcha) return fail('NEED_CAPTCHA', '这次登录需要验证码，请填写后重试。');
      return fail('INVALID_CREDENTIALS', describeZfError('INVALID_CREDENTIALS'));
    }

    if (cookieCount(base) === 0) {
      return fail('SESSION_EXPIRED', '登录后没有拿到会话（Cookie），可能是学校关闭了网页登录。');
    }

    // 探活 + 拿数据
    const probe = await requestRaw({
      url: `${jwRoot}/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=${GNMKDM}&layout=default`,
      method: 'GET'
    });
    if (probe.body.includes('login_slogin.html') && /name=["']yhm["']/.test(probe.body)) {
      return fail('SESSION_EXPIRED', describeZfError('SESSION_EXPIRED'));
    }
    if (probe.body.includes('没有访问权限') || probe.body.includes('无访问权限')) {
      return fail('QUERY_DENIED', describeZfError('QUERY_DENIED'));
    }

    const xnm = currentXnm();
    const kb = await requestRaw({
      url: `${jwRoot}/kbcx/xskbcx_cxXsKb.html?gnmkdm=${GNMKDM}`,
      method: 'POST',
      form: true,
      data: `xnm=${xnm}&xqm=${xqm}&kzlx=ck&xsdm=&kclbdm=&kclxdm=`
    });

    if (!kb.body || kb.body.trim().length < 2) {
      return fail('QUERY_DENIED', '教务系统没有返回课表内容，可能这个学期还没排课。');
    }
    if (kb.body.trim().startsWith('<')) {
      // 返回 HTML 而不是 JSON：多半被重定向回登录页或权限页
      if (kb.body.includes('login_slogin.html')) return fail('SESSION_EXPIRED', describeZfError('SESSION_EXPIRED'));
      return fail('QUERY_DENIED', describeZfError('QUERY_DENIED'));
    }

    const rows = parseKbList(kb.body);
    const courses: ZfCourseRow[] = rows.map((r) => ({
      name: r.name,
      teacher: r.teacher,
      rooms: r.rooms,
      day: r.day,
      startPeriod: r.startPeriod,
      endPeriod: r.endPeriod,
      weeksText: r.weeksText,
      weeks: r.weeks
    }));

    const semesterLabel = `${xnm}-${Number(xnm) + 1} 学年第 ${semester} 学期`;
    if (!courses.length) {
      return {
        ...fail('QUERY_DENIED', '教务系统返回了数据，但没有解析到任何课程。可能是这个学期还没排课，或选错了学期。'),
        raw: kb.body,
        semesterLabel
      };
    }

    return {
      ok: true,
      errorKind: '',
      error: '',
      courses,
      distinct: new Set(courses.map((c) => c.name)).size,
      semesterLabel,
      raw: kb.body
    };
  } catch (e) {
    if (e instanceof ZfError) {
      return fail(e.kind, describeZfError(e.kind));
    }
    const msg = e instanceof Error ? e.message : String(e);
    // H5 预览下必然撞 CORS，小程序里则是域名没配白名单 —— 两种都归到网络类
    return fail('CORS_OR_NETWORK', '连不上教务系统：' + msg);
  }
}

/** 错误码 → 人话。UI 不许自己编理由（原工程硬规则） */
export function describeImportError(r: ZfImportResult): string {
  if (r.ok) return '';
  if (r.errorKind === 'CORS_OR_NETWORK') {
    return (
      r.error +
      '\n\n常见原因：\n' +
      '· 小程序后台还没把 ' +
      'jwglxt.buct.edu.cn' +
      ' 加进「request 合法域名」\n' +
      '· 开发者工具里勾选「不校验合法域名」后重试\n' +
      '· 网络环境访问不了校内系统（校外需连学校 VPN）'
    );
  }
  return r.error;
}
