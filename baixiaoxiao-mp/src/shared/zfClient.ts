/**
 * 正方 jwglxt 教务系统 —— 纯函数层（无网络、无状态、可单测）。
 *
 * 【来源与出处】
 *  1. 算法与字段口径移植自外部适配包 `zf-buct-adapter`（`ts/zfBuctClient.ts`，零依赖，
 *     附 `PROTOCOL.md` 协议档案与离线测试）。
 *  2. **两处关键修正**参照同类开源项目 `znjhahaha/zhengfang-apk`（教务助手，GPLv3）
 *     的公开协议文档 `docs/architecture-v3/CREDENTIAL-BINDINGS.md` 与 `PROTOCOLS.md`：
 *     - `mmsfjm` 加密标记**可能位于表单之外**，必须扫完整页面（`readHiddenFields`）；
 *     - 加密标记异常（空值/未知/冲突）**返回 PAGE_CHANGED，绝不降级为明文提交**（`decidePasswordMode`）。
 *     这两点是该项目在真实学校（河南财经政法大学）踩出来的，原适配包没有覆盖。
 *     百小鸮 只借用**协议事实**，不含其任何代码。
 *
 * 移植范围**仅限纯函数**：RSA 密码加密、登录页字段判定、周次展开、节次分段、kbList 解析、
 * 学期码换算、错误分类。**不移植**会话客户端（多步 fetch 链路）—— 那条需要"在教务域名下
 * 有可执行 JS 的常驻上下文"，由原生桥 `mode=zfimport` 负责，见 `src/services/jwwebview.ts`。
 *
 * 【为什么拆成纯函数】这些逻辑最容易出错（Base64 vs hex、单双周、多段节次、加密标记漏读），
 * 拆出来就能用 Golden Test 钉死，不用连网、不用真机。网络部分越薄越好。
 *
 * 【凭据边界】本文件只做**数学**（把密码明文变成 RSA 密文），不存储、不外发。
 * 调用方拿到密文后立刻提交给教务系统，不落盘（见 PRD 11.75）。
 */

/**
 * 【迁移说明 · 2026-10】本文件从 百小鸮 `src/services/zfClient.ts` **原样搬入**，
 * 只动了 3 处全局函数：`atob/btoa`、`crypto.getRandomValues`、`TextEncoder` ——
 * 小程序三个都没有，全部换成 adapters/crypto 里的纯 JS 实现。
 * 其余 280 行一行未改 —— 这就是"纯函数层可以 100% 复用"的证据。
 */
import { b64ToBytes, bytesToB64, randomBytes, utf8Encode } from '../adapters/crypto';

export const SCHOOL_CODE = '10010';
export const SCHEDULE_GNMKDM = 'N2151';
/** 验证码表单字段名：主流新正方为 yzm；若某校实测不同只改这一处 */
export const CAPTCHA_FIELD = 'yzm';

/**
 * 错误分类（六态）。把"连不上/密码错/要验证码/页面改版"分开，
 * 前端才能给不同的话术 —— 全都写成"导入失败"是最没用的提示。
 * 完整清单见适配包 `PROTOCOL.md`。
 */
export type ZfErrorKind =
  | 'NEED_CAPTCHA'
  | 'INVALID_CREDENTIALS'
  | 'SESSION_EXPIRED'
  | 'NETWORK_RETRYABLE'
  | 'PAGE_CHANGED'
  | 'QUERY_DENIED'
  | 'VALIDATION_FAILED';

export class ZfError extends Error {
  kind: ZfErrorKind;
  constructor(kind: ZfErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'ZfError';
  }
}

export interface ZfCourse {
  name: string;
  teacher: string;
  rooms: string;
  day: number;
  startPeriod: number;
  endPeriod: number;
  weeksText: string;
  weeks: number[];
}

export interface ZfLoginResult {
  username: string;
  displayName: string;
}

/** 学期序号 → 新正方学期码：1→3，2→12，3(小学期)→16 */
export function xqmOf(semester: number): string {
  if (semester === 1) return '3';
  if (semester === 2) return '12';
  if (semester === 3) return '16';
  throw new RangeError('学期序号应为 1/2/3');
}

/* ================= RSA（PKCS#1 v1.5 type-2，jsbn 等价自实现） ================= */

function bytesToBigInt(b: Uint8Array): bigint {
  let r = 0n;
  for (const x of b) r = (r << 8n) | BigInt(x);
  return r;
}

function bigIntToBytes(v: bigint, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function base64ToBytes(b64: string): Uint8Array {
  // ← 迁移改动点 1/2：小程序没有 atob/btoa，改走 adapters/crypto 里的纯 JS 实现
  return b64ToBytes(b64);
}

function bytesToBase64(b: Uint8Array): string {
  // ← 迁移改动点 2/2
  return bytesToB64(b);
}

/** PKCS#1 v1.5 type-2 填充（加密方向）：0x00 0x02 + ≥8 个随机非零字节 + 0x00 + 数据 */
function pkcs1PadType2(data: Uint8Array, k: number): Uint8Array {
  const padLen = k - data.length - 3;
  if (padLen < 8) throw new Error('数据过长，无法填充（模长不足）');
  const out = new Uint8Array(k);
  out[0] = 0x00;
  out[1] = 0x02;
  const rnd = randomBytes(padLen);
  for (let i = 0; i < padLen; i++) out[2 + i] = rnd[i] === 0 ? (i % 254) + 1 : rnd[i];
  out[2 + padLen] = 0x00;
  out.set(data, 3 + padLen);
  return out;
}

/**
 * 与正方登录页 jsbn 的 RSAKey.encrypt 等价：PKCS#1 v1.5 + Base64 输出。
 * **坑位（照抄 PROTOCOL.md）**：modulus / exponent 都是 **Base64** 编码，不是 hex。
 * 当年这里是最大的一个坑。
 */
export function encryptPassword(password: string, modulusB64: string, exponentB64: string): string {
  const n = bytesToBigInt(base64ToBytes(modulusB64));
  const e = bytesToBigInt(base64ToBytes(exponentB64));
  const k = base64ToBytes(modulusB64).length;   // 模长字节数（1024 位 → 128）
  const data = utf8Encode(password);
  const padded = pkcs1PadType2(data, k);
  const c = modPow(bytesToBigInt(padded), e, n);
  return bytesToBase64(bigIntToBytes(c, k));
}

/* ================= 登录页字段读取 ================= */

/**
 * 从**完整页面**读取隐藏/标记控件的值。
 *
 * 【重要修正，来自同类实现的血泪教训】不要只在 `<form>` 内查找 ——
 * 教务助手项目（znjhahaha/zhengfang-apk，GPLv3）在河南财经政法大学实测发现
 * 正方会把 `mmsfjm` 这类标记放在**表单之外**；只在表单内找会漏，
 * 漏了就会误判为"不需要加密"，然后拿明文密码去登录 —— 必然失败，且把密码明文发给了服务器。
 * 因此这里扫描整页所有 `<input>`（含不在 form 里的），而非某个表单容器内的。
 */
export function readHiddenFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of html.match(/<input[^>]*>/gi) ?? []) {
    if (!/type\s*=\s*["']?hidden/i.test(tag)) continue;
    const name = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (!name) continue;
    const value = /\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const key = name[1] ?? name[2] ?? name[3] ?? '';
    out[key] = value ? (value[1] ?? value[2] ?? value[3] ?? '') : '';
  }
  return out;
}

/**
 * 判定"这次登录要不要加密密码"。
 *
 * 返回值三态：`'required'` 要加密 / `'plain'` 确实不需要 / 抛 `PAGE_CHANGED`。
 *
 * **绝不因为读不到标记就当成"不需要加密"** —— 这是同类项目明确划出的边界：
 * 空值、未知值、或多个来源给出互相冲突的值，一律返回 `PAGE_CHANGED` 让用户重试，
 * 而不是拿明文去赌。宁可"识别不了"，也不能把密码明文发给服务器。
 *
 * @param pageHtml 登录页完整 HTML
 */
export function decidePasswordMode(pageHtml: string): { mode: 'required' | 'plain'; csrfToken: string } {
  const hidden = readHiddenFields(pageHtml);
  const csrfToken = hidden['csrftoken'] ?? '';
  const raw = hidden['mmsfjm'];
  if (raw === undefined) {
    // 字段完全不存在：新正方一定是加密的，缺失说明页面结构变了，不能猜
    throw new ZfError('PAGE_CHANGED', '登录页缺少密码加密标记（mmsfjm），页面结构可能已变更');
  }
  const v = String(raw).trim();
  if (v === '1') return { mode: 'required', csrfToken };
  if (v === '0') return { mode: 'plain', csrfToken };
  throw new ZfError('PAGE_CHANGED', '登录页的密码加密标记取值异常（' + v + '），不猜测明文兼容');
}

/* ================= 课表解析 ================= */

/** "1-2,5-6" / "3" → [[1,2],[5,6]] / [[3,3]] */
export function parsePeriods(jcs: string): Array<[number, number]> {
  return jcs
    .split(/[,，]/)
    .map((seg) => seg.trim())
    .map((seg): [number, number] | null => {
      const m = /(\d+)\s*-\s*(\d+)/.exec(seg);
      if (m) return [Number(m[1]), Number(m[2])];
      const n = Number(seg);
      return Number.isInteger(n) && n > 0 ? [n, n] : null;
    })
    .filter((x): x is [number, number] => x !== null);
}

/** "1-16周(单)"→奇数周；"(双)"→偶数周；"1-8周,10-16周" 分段展开；裸数字按单周 */
export function parseWeeks(zcd: string): number[] {
  const onlyOdd = zcd.includes('单');
  const onlyEven = zcd.includes('双');
  const cleaned = zcd.replace(/单|双|周/g, '');
  const weeks = new Set<number>();
  for (const m of cleaned.matchAll(/(\d+)\s*-\s*(\d+)/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    for (let w = a; w <= b; w++) {
      if (onlyOdd && w % 2 === 0) continue;
      if (onlyEven && w % 2 === 1) continue;
      weeks.add(w);
    }
  }
  for (const m of cleaned.matchAll(/(?<!\d)(\d+)(?!\d)(?!\s*-)/g)) {
    const w = Number(m[1]);
    if (w > 0 && (!onlyOdd || w % 2 === 1) && (!onlyEven || w % 2 === 0)) weeks.add(w);
  }
  return [...weeks].sort((a, b) => a - b);
}

/**
 * 新正方 kbList JSON → 结构化课表。
 * 兼容两种根键：`kbList`（标准）与 `data`（部分版本/错误包装）。
 * 坏行（缺课名、星期越界）一律跳过，不编造。
 */
export function parseKbList(body: string): ZfCourse[] {
  const root = JSON.parse(body.trim().replace(/^\uFEFF/, ''));
  // 迁移补充：真实接口回 {kbList:[…]}，但样例/某些版本直接回裸数组，两种都认
  const rows = Array.isArray(root) ? root : root.kbList ?? root.data ?? [];
  const result: ZfCourse[] = [];
  for (const row of rows) {
    const name = String(row.kcmc ?? '').trim();
    if (!name) continue;
    const day = Number(String(row.xqj ?? '').trim());
    if (!(day >= 1 && day <= 7)) continue;
    const rooms = ['xqmc', 'cdxqmc', 'cdmc', 'jxcdmc']
      .map((f) => String(row[f] ?? '').trim())
      .filter((s) => s !== '')
      .filter((s, i, arr) => arr.indexOf(s) === i)
      .join(' ');
    for (const [start, end] of parsePeriods(String(row.jcs ?? ''))) {
      result.push({
        name,
        teacher: String(row.xm ?? '').trim(),
        rooms,
        day,
        startPeriod: start,
        endPeriod: end,
        weeksText: String(row.zcd ?? '').trim(),
        weeks: parseWeeks(String(row.zcd ?? ''))
      });
    }
  }
  return result;
}

/**
 * 把错误分类翻译成给用户看的话。
 * 硬规则：UI 文案必须与实现一致 —— 说不出所以然的时候，宁可让用户"重试/上报"，
 * 也不要编一个看似专业的理由。
 */
export function describeZfError(kind: ZfErrorKind): string {
  switch (kind) {
    case 'NEED_CAPTCHA': return '这次登录需要验证码，请在页面上输入后重试。';
    case 'INVALID_CREDENTIALS': return '学号或密码不正确，请重新输入。';
    case 'SESSION_EXPIRED': return '登录状态已过期，请重新登录。';
    case 'NETWORK_RETRYABLE': return '教务系统暂时连不上，可能是网络问题，稍后再试。';
    case 'PAGE_CHANGED': return '教务系统的页面结构好像变了，暂时无法识别。我们会尽快适配。';
    case 'QUERY_DENIED': return '学校没有开放你这个账号的课表查询权限，请联系教务处。';
    default: return '导入没有完成，请稍后重试；若一直如此，可能是教务系统改版了。';
  }
}
