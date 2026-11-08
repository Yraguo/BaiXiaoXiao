/**
 * 极简 ZIP 打包（store 模式，不压缩）。
 *
 * 为什么自己写：小程序的 JS 环境没有 zlib，也不能装 npm 包；
 * 而「把记录表和照片原图放一起」只有 zip 一个通用容器。
 * 不压缩是刻意的——照片本身已经是 JPEG，再压收益很小，
 * 省掉 deflate 还能让代码短到可以一眼看完。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** UTF-8 编码：小程序里没有 TextEncoder，手写一份 */
function utf8(text) {
  const source = String(text == null ? '' : text);
  const bytes = [];
  for (let i = 0; i < source.length; i += 1) {
    let code = source.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < source.length) {
      const next = source.charCodeAt(i + 1);
      const point = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
      bytes.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f)
      );
      i += 1;
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(bytes);
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(data);
  return utf8(data);
}

/** DOS 时间格式：zip 头里的时间字段只有这个精度 */
function dosStamp(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2)),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

/**
 * @param {Array<{name:string,data:Uint8Array|ArrayBuffer|string}>} files
 * @param {Date} when
 * @returns {Uint8Array} 完整的 zip 字节流
 */
function buildZip(files, when) {
  const stamp = dosStamp(when || new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = utf8(file.name);
    const data = toBytes(file.data);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true); // 文件名用 UTF-8
    localView.setUint16(8, 0, true); // 0 = store
    localView.setUint16(10, stamp.time, true);
    localView.setUint16(12, stamp.date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    locals.push(local, data);
    offset += local.length + data.length;

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, stamp.time, true);
    centralView.setUint16(14, stamp.date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset - local.length - data.length, true);
    central.set(nameBytes, 46);
    centrals.push(central);
  });

  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  const total = offset + centralSize + end.length;
  const output = new Uint8Array(total);
  let cursor = 0;
  locals.forEach((chunk) => { output.set(chunk, cursor); cursor += chunk.length; });
  centrals.forEach((chunk) => { output.set(chunk, cursor); cursor += chunk.length; });
  output.set(end, cursor);
  return output;
}

/** UTF-8 解码，和上面的 utf8() 配对，用于读文件名 */
function decodeUtf8(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte < 0x80) {
      text += String.fromCharCode(byte);
    } else if (byte < 0xe0) {
      text += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 1;
    } else if (byte < 0xf0) {
      text += String.fromCharCode(((byte & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 2;
    } else {
      const point = ((byte & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12)
        | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      const offset = point - 0x10000;
      text += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
      i += 3;
    }
  }
  return text;
}

/**
 * 读 zip（只支持 store 模式，也就是我们自己打出来的包）。
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {Array<{name:string,data:Uint8Array}>}
 */
function readZip(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // EOCD 在最末尾，最多往回头看 64KB + 22
  let eocd = -1;
  const start = Math.max(0, bytes.length - 65558);
  for (let i = bytes.length - 22; i >= start; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip');

  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const files = [];

  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('中央目录损坏');
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decodeUtf8(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    if (method === 0) {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      files.push({ name, data: bytes.subarray(dataStart, dataStart + compressedSize) });
    } else {
      files.push({ name, data: null, unsupported: true });
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

/** 按文件名后缀找条目，返回 UTF-8 文本或 null */
function readText(files, suffix) {
  const hit = (files || []).find((file) => file.name && file.name.slice(-suffix.length) === suffix && file.data);
  return hit ? decodeUtf8(hit.data) : null;
}

module.exports = { buildZip, crc32, decodeUtf8, readText, readZip, utf8 };
