/**
 * 教务系统地址解析（小程序版）
 *
 * 移植自原工程 `src/services/jwAddress.ts` —— **逻辑一致，实现换了**。
 * 唯一必须改的地方：原实现用 `new URL()`，而小程序没有 URL 构造函数
 * （基础库里既没有 window 也没有 WHATWG URL），所以这里改成手写正则解析。
 *
 * 规则照抄原工程，一条没改：
 *   https://jw.example.edu.cn:30443/jwglxt/xtgl/login_slogin.html
 *     → domain   jw.example.edu.cn:30443
 *       basePath /jwglxt
 *       baseUrl  https://jw.example.edu.cn:30443/jwglxt
 *       loginUrl https://jw.example.edu.cn:30443/jwglxt/xtgl/login_slogin.html
 *
 * 只做字符串处理：不发请求、不探测、不猜厂商。
 */

export type JwProtocol = 'https' | 'http';

export interface JwAddressParts {
  /** 协议 + 主机 + 端口 + 已截到教务目录，不带尾斜杠 */
  baseUrl: string;
  domain: string;
  basePath: string;
  protocol: JwProtocol | '';
  loginUrl: string;
}

export interface JwAddressParse {
  ok: boolean;
  parts: JwAddressParts;
  error: string;
}

const EMPTY: JwAddressParts = { baseUrl: '', domain: '', basePath: '', protocol: '', loginUrl: '' };

/** 只按路径段特征认教务目录名，用来决定"路径截到哪一段" */
export function isVendorDir(seg: string): boolean {
  const s = String(seg || '').toLowerCase();
  return (
    ['jwglxt', 'jwweb', 'jsxsd', 'jw', 'jwc', 'jwcnew', 'jwmis', 'qzdatasoft', 'urp'].indexOf(s) >= 0
  );
}

/**
 * 拼登录页地址。
 * baseUrl 已经带教务目录（…/jwglxt）时只补目录内部的相对路径，
 * 否则会拼出 /jwglxt/jwglxt/xtgl/login_slogin.html（原工程 v2.71 单测抓出来的真 bug）。
 */
export function loginUrlFor(baseUrl: string): string {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  if (/\.html(\?|$)/i.test(base)) return base;
  const last = base.split('/').pop() || '';
  if (isVendorDir(last)) return base + '/xtgl/login_slogin.html';
  return base + '/jwglxt/xtgl/login_slogin.html';
}

export function parseJwAddress(raw: string, fallbackProtocol: JwProtocol = 'https'): JwAddressParse {
  const text = String(raw || '').trim();
  if (!text) {
    return { ok: false, parts: EMPTY, error: '请先粘贴教务系统的登录页地址，或至少填一个域名。' };
  }
  // 从浏览器地址栏复制过来经常带零宽字符
  const cleaned = text.replace(/[\u200B-\u200D\uFEFF]/g, '');
  if (/\s/.test(cleaned)) {
    return { ok: false, parts: EMPTY, error: '地址里不能有空格，请检查是否多粘了一段文字。' };
  }

  /*
   * 不用 new URL()：小程序没有这个构造函数。
   * 手拆成 scheme / host:port / path 三段，够覆盖教务地址的所有真实形态。
   */
  const m = /^(?:([a-zA-Z][a-zA-Z0-9+.-]*):\/\/)?([^/?#]+)(\/[^?#]*)?/.exec(cleaned);
  if (!m) {
    return { ok: false, parts: EMPTY, error: '这不是一个能识别的网址，示例：jw.example.edu.cn:30443 或 https://jw.example.edu.cn/jwglxt' };
  }
  const schemeInInput = (m[1] || '').toLowerCase();
  if (schemeInInput && schemeInInput !== 'http' && schemeInInput !== 'https') {
    return { ok: false, parts: EMPTY, error: '只支持 http / https 开头的教务系统地址。' };
  }
  const scheme = (schemeInInput as JwProtocol) || fallbackProtocol;
  const domain = (m[2] || '').toLowerCase();
  const path = m[3] || '';

  // host:port，必须带点（edu.cn / .com），排除 localhost 之类的误填
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(domain) || !domain.replace(/:\d+$/, '').includes('.')) {
    return { ok: false, parts: EMPTY, error: '域名看起来不完整（例如少了 .edu.cn），请核对后重填。' };
  }

  const segments = path.split('/').filter(Boolean);
  const markerIdx = segments.findIndex((s) => isVendorDir(s));
  const keep = markerIdx >= 0 ? segments.slice(0, markerIdx + 1) : segments;
  const basePath = keep.length ? '/' + keep.join('/') : '';
  const baseUrl = `${scheme}://${domain}${basePath}`;

  return {
    ok: true,
    parts: { baseUrl, domain, basePath, protocol: scheme, loginUrl: loginUrlFor(baseUrl) },
    error: ''
  };
}

/** 面板上的即时提示（不联网） */
export function addressHint(raw: string): string {
  const p = parseJwAddress(raw);
  if (!p.ok) return p.error;
  const path = p.parts.basePath.toLowerCase();
  if (path.includes('jwglxt')) return '看起来是新版正方 jwglxt，可以直接试导入。';
  if (path.includes('jwweb') || path.includes('jsxsd')) return '像是正方老版，导入可能失败。';
  if (p.parts.protocol === 'http') return '这是 http 明文地址：能不能连通取决于小程序是否允许该域名。';
  return '地址可用。登录页会拼成 ' + p.parts.loginUrl;
}
