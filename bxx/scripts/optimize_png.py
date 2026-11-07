#!/usr/bin/env python3
"""PNG 无损重优化：对每行挑选绝对值和最小的 filter，并用 zlib level 9 重新压缩。

只使用 Python 标准库（zlib/struct），不改动像素数据，输出与原图逐像素一致。
用法: python3 scripts/optimize_png.py <in.png> <out.png>
     python3 scripts/optimize_png.py --dir <dir>
"""
import zlib, struct, sys, os

PNG_SIG = b'\x89PNG\r\n\x1a\n'


def read_png(path):
    data = open(path, 'rb').read()
    if data[:8] != PNG_SIG:
        raise ValueError('not a png: %s' % path)
    pos, idat, plte = 8, b'', None
    w = h = bd = ct = None
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if typ == b'IHDR':
            w, h, bd, ct, _, _, interlace = struct.unpack('>IIBBBBB', chunk)
            if interlace:
                raise ValueError('interlaced png not supported: %s' % path)
            if bd != 8:
                raise ValueError('bit depth %d not supported: %s' % (bd, path))
        elif typ == b'IDAT':
            idat += chunk
        elif typ == b'PLTE':
            plte = chunk
        elif typ == b'IEND':
            break
    raw = zlib.decompress(idat)
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    bpp = channels
    stride = w * bpp
    out = bytearray()
    prev = bytearray(stride)
    p = 0
    for _ in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                c = prev[i - bpp] if i >= bpp else 0
                b = prev[i]
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        elif f != 0:
            raise ValueError('bad filter %d' % f)
        out += line
        prev = line
    return w, h, ct, bytes(out), plte


def paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    return a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)


def write_png(path, w, h, ct, pixels, plte=None):
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    bpp = channels
    stride = w * bpp
    raw = bytearray()
    prev = bytearray(stride)
    for y in range(h):
        line = pixels[y * stride:(y + 1) * stride]
        best, best_score, best_line = 0, None, None
        for f in range(5):
            cand = bytearray(stride)
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                if f == 0:
                    v = line[i]
                elif f == 1:
                    v = line[i] - a
                elif f == 2:
                    v = line[i] - b
                elif f == 3:
                    v = line[i] - ((a + b) >> 1)
                else:
                    v = line[i] - paeth(a, b, c)
                cand[i] = v & 255
            score = sum(v if v < 128 else 256 - v for v in cand)
            if best_score is None or score < best_score:
                best, best_score, best_line = f, score, cand
        raw.append(best)
        raw += best_line
        prev = line

    def chunk(typ, payload):
        return (struct.pack('>I', len(payload)) + typ + payload +
                struct.pack('>I', zlib.crc32(typ + payload) & 0xffffffff))

    out = PNG_SIG
    out += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, ct, 0, 0, 0))
    if plte:
        out += chunk(b'PLTE', plte)
    out += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    out += chunk(b'IEND', b'')
    open(path, 'wb').write(out)


def optimize(src, dst):
    w, h, ct, pixels, plte = read_png(src)
    write_png(dst, w, h, ct, pixels, plte)
    a, b = os.path.getsize(src), os.path.getsize(dst)
    return a, b


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    if args[0] == '--dir':
        d = args[1]
        total_a = total_b = 0
        for name in sorted(os.listdir(d)):
            if not name.lower().endswith('.png'):
                continue
            src = os.path.join(d, name)
            tmp = src + '.tmp'
            a, b = optimize(src, tmp)
            os.replace(tmp, src)
            total_a += a; total_b += b
            print('%-22s %7d -> %7d  (-%.1f%%)' % (name, a, b, (1 - b / a) * 100))
        if total_a:
            print('-' * 52)
            print('%-22s %7d -> %7d  (-%.1f%%)' % ('TOTAL', total_a, total_b,
                                                    (1 - total_b / total_a) * 100))
    else:
        a, b = optimize(args[0], args[1])
        print('%d -> %d (-%.1f%%)' % (a, b, (1 - b / a) * 100))


if __name__ == '__main__':
    main()
