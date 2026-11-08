/**
 * 吉祥物抠图：把生成图里「画上去的透明格子」换成真正的透明通道。
 *
 * 这批 AI 图带的不是 alpha，而是把灰白相间的格子直接画进了像素里
 * （角落像素 rgb(237,235,234)，alpha 全是 255）。看起来像透明，
 * 放到白卡片上就是一块灰格子。
 *
 * 做法：从四边向内做洪泛填充，把「浅色且几乎无彩度」的像素判为背景，
 * 置 alpha=0。从边界扩散而不是按颜色全局替换，是为了不把猫头鹰身上
 * 的白色（眼睛、肚皮）一起挖掉。
 *
 * 用法：node scripts/matte-owl.js assets/owl/*.png
 */

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function decode(buffer) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  const idat = [];

  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + length;
  }

  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`只处理 8bit 的 RGBA/RGB，遇到 colorType=${colorType} bitDepth=${bitDepth}`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let src = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    const line = raw.subarray(src, src + stride);
    src += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = value & 0xff;
    }
  }

  return { width, height, channels, data: out };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let c = index;
    for (let bit = 0; bit < 8; bit += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[index] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encode({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: None
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** 浅 + 无彩度 = 背景。格子两色是 (253,250,249) 和 (237,235,234) */
function isBackground(image, index) {
  const r = image.data[index];
  const g = image.data[index + 1];
  const b = image.data[index + 2];
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  return min >= 198 && (max - min) <= 16;
}

function matte(image) {
  const { width, height, channels } = image;
  const seen = new Uint8Array(width * height);
  const queue = [];
  const push = (x, y) => {
    const key = y * width + x;
    if (seen[key]) return;
    seen[key] = 1;
    if (!isBackground(image, key * channels)) return;
    queue.push(key);
  };

  for (let x = 0; x < width; x += 1) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y += 1) { push(0, y); push(width - 1, y); }

  let cleared = 0;
  while (queue.length) {
    const key = queue.pop();
    // alpha 置 0 之后把 RGB 也刷白：透明像素的颜色不可见，
    // 但留着格子纹理会把压缩率拖垮（一张图能差 30KB）
    image.data[key * channels] = 255;
    image.data[key * channels + 1] = 255;
    image.data[key * channels + 2] = 255;
    image.data[key * channels + 3] = 0;
    cleared += 1;
    const x = key % width;
    const y = (key - x) / width;
    if (x > 0) push(x - 1, y);
    if (x + 1 < width) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y + 1 < height) push(x, y + 1);
  }

  return cleared;
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('用法：node scripts/matte-owl.js assets/owl/*.png');
  process.exit(1);
}

files.forEach((file) => {
  const image = decode(fs.readFileSync(file));
  const cleared = matte(image);
  const output = encode(image);
  fs.writeFileSync(file, output);
  const ratio = (cleared / (image.width * image.height) * 100).toFixed(1);
  console.log(`${path.basename(file)}  去掉 ${ratio}% 的背景  ${(output.length / 1024).toFixed(0)} KB`);
});
