/**
 * 加密适配层
 *
 * 【原实现】直接调 crypto.subtle / crypto.getRandomValues（浏览器 / WebView 自带）
 * 【小程序】没有 WebCrypto。分三类处理：
 *
 *  1) getRandomValues → wx.getRandomValues 存在，兜到它；再不行退 Math.random（只用于盐值）
 *  2) SHA-256        → 纯 JS 实现（下面自带，80 行），或换 @noble/hashes
 *  3) RSA 加密密码   → 原工程 zfClient.ts 用的是 BigInt 手写模幂，本来就是纯 JS，
 *                       一行不用改就能用（见 src/shared/zfClient.ts）
 *
 * 另外 atob / btoa 小程序也没有，这里一起补上。zfClient 依赖它们。
 */

/* ---------------- Base64（小程序无 atob/btoa） ---------------- */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let p = 0;
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (buf >> bits) & 0xff;
    }
  }
  return out.subarray(0, p);
}

export function bytesToB64(bytes: Uint8Array): string {
  let out = '';
  let buf = 0;
  let bits = 0;
  for (const b of bytes) {
    buf = (buf << 8) | b;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += B64[(buf >> bits) & 0x3f];
    }
  }
  if (bits > 0) out += B64[(buf << (6 - bits)) & 0x3f];
  while (out.length % 4 !== 0) out += '=';
  return out;
}

/* ---------------- UTF-8 编码（小程序也没有 TextEncoder） ---------------- */
export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      // 代理对（emoji 等 4 字节字符），密码里也可能出现
      const c2 = s.charCodeAt(++i);
      const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(out);
}

/* ---------------- 随机数 ---------------- */
export function randomBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  try {
    // 小程序基础库 2.19+ 提供；比 Math.random 强得多
    // @ts-ignore
    if (typeof wx !== 'undefined' && typeof wx.getRandomValues === 'function') {
      // @ts-ignore
      wx.getRandomValues(out);
      return out;
    }
  } catch {
    /* 落到下面的兜底 */
  }
  for (let i = 0; i < len; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/* ---------------- SHA-256（纯 JS，无依赖） ---------------- */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

export function sha256Hex(input: Uint8Array | string): string {
  const data = typeof input === 'string' ? utf8Encode(input) : input;
  const bitLen = data.length * 8;
  const withPad = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  withPad.set(data);
  withPad[data.length] = 0x80;
  // 长度写成 64 位大端（这里只填低 32 位，够用到 512MB）
  new DataView(withPad.buffer).setUint32(withPad.length - 4, bitLen >>> 0, false);
  new DataView(withPad.buffer).setUint32(withPad.length - 8, Math.floor(bitLen / 4294967296), false);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  const w = new Uint32Array(64);

  for (let off = 0; off < withPad.length; off += 64) {
    const dv = new DataView(withPad.buffer, off, 64);
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  return [...H].map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** 对应原工程 crypto.ts 的 sha256Base64（水印存证用），签名保持一致 */
export function sha256Base64(b64: string): string {
  return sha256Hex(b64ToBytes(b64));
}
