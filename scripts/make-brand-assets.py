"""
百小鸮 · 小程序图标资源生成器
输入：原始 logo（蓝色猫头鹰抱任务清单）
输出：src/static/ 下的 logo 多尺寸 + 5 组 tabBar 图标（常态灰 / 选中品牌蓝）

纯 PIL 绘制，无外部素材依赖，可重复执行。
"""
import os
from PIL import Image, ImageDraw

SRC = r"E:\Admin\Documents\xwechat_files\wxid_lzcj4g3awqn112_9d89\temp\RWTemp\2026-10\0b824b716283dde9ff9d133c13fcb17f.png"
OUT = r"C:\Users\Admin\WorkBuddy\BaiXiaoXiao\baixiaoxiao-mp\src\static"

BRAND = (85, 135, 236)      # #5587EC  logo 主蓝
GREY = (138, 148, 166)      # #8A94A6  未选中
BG = (234, 246, 254)        # #EAF6FE  logo 底色

os.makedirs(os.path.join(OUT, "tabbar"), exist_ok=True)


def trim_square(im: Image.Image, pad_ratio=0.0) -> Image.Image:
    """按非背景像素裁剪成正方形（保留 logo 完整外接框），四周补底色，不留黑边。"""
    im = im.convert("RGB")
    w, h = im.size
    bg = im.getpixel((3, 3))
    px = im.load()
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(0, h):
        for x in range(0, w):
            r, g, b = px[x, y]
            # 只认“有颜色或够深”的像素：logo 边缘的水印是近白色，靠这一条被排除
            if (max(r, g, b) - min(r, g, b) > 28 and r + g + b < 735) or r + g + b < 330:
                minx, miny = min(minx, x), min(miny, y)
                maxx, maxy = max(maxx, x), max(maxy, y)
    cx, cy = (minx + maxx) // 2, (miny + maxy) // 2
    side = int(max(maxx - minx, maxy - miny) * (1 + pad_ratio * 2))
    # 先把原图贴到一张按底色铺满的大画布中央，再裁 —— 这样越界区域是底色而非黑色
    big = Image.new("RGB", (w + side * 2, h + side * 2), bg)
    big.paste(im, (side, side))
    cx, cy = cx + side, cy + side
    return big.crop((cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2))


def make_logo():
    src = Image.open(SRC)
    sq = trim_square(src, 0.06)
    for size, name in [(512, "logo.png"), (128, "logo-128.png")]:
        im = sq.resize((size, size), Image.LANCZOS)
        im.save(os.path.join(OUT, name), optimize=True)
        print("logo ->", name, im.size)

    # 圆形头像版（“我的”页 / 关于页用）
    big = sq.resize((512, 512), Image.LANCZOS)
    mask = Image.new("L", (512, 512), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, 511, 511), fill=255)
    out = Image.new("RGB", (512, 512), BG)
    out.paste(big, (0, 0), mask)
    out.save(os.path.join(OUT, "logo-round.png"), optimize=True)
    print("logo -> logo-round.png")


# ---------------- tabBar 图标（81x81，线稿风格，与 logo 的圆润描边呼应） ----------------

S = 81
W = 5.5          # 线宽
PAD = 13


def canvas():
    im = Image.new("RGBA", (S * 4, S * 4), (0, 0, 0, 0))   # 4x 超采样，缩回 81 抗锯齿
    return im, ImageDraw.Draw(im)


def finish(im, color, name):
    im = im.resize((S, S), Image.LANCZOS)
    # 统一染成目标色（线稿是纯色画的，这里做保形替换）
    r, g, b = color
    px = im.load()
    for y in range(S):
        for x in range(S):
            _, _, _, a = px[x, y]
            if a:
                px[x, y] = (r, g, b, a)
    im.save(os.path.join(OUT, "tabbar", name), optimize=True)


def icon_calendar(d: ImageDraw.ImageDraw):
    k = 4
    l, t, r, b = PAD * k, PAD * k + 4 * k, (S - PAD) * k, (S - PAD) * k
    d.rounded_rectangle([l, t, r, b], radius=9 * k, outline=(0, 0, 0, 255), width=int(W * k))
    d.line([l, t + 12 * k, r, t + 12 * k], fill=(0, 0, 0, 255), width=int(W * k))
    for cx in (l + 12 * k, r - 12 * k):
        d.line([cx, t - 6 * k, cx, t + 4 * k], fill=(0, 0, 0, 255), width=int(W * k))
    for gy in (t + 24 * k, t + 35 * k):
        for gx in (l + 12 * k, l + 24 * k, r - 24 * k, r - 12 * k):
            d.ellipse([gx - 2.2 * k, gy - 2.2 * k, gx + 2.2 * k, gy + 2.2 * k], fill=(0, 0, 0, 255))


def icon_award(d: ImageDraw.ImageDraw):
    k = 4
    cx, cy = S * k // 2, (PAD + 14) * k
    rad = 13 * k
    d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], outline=(0, 0, 0, 255), width=int(W * k))
    # 两条绶带
    for sx in (-1, 1):
        d.line([cx + sx * 8 * k, cy + 10 * k, cx + sx * 12 * k, (S - PAD) * k],
               fill=(0, 0, 0, 255), width=int(W * k), joint="curve")
        d.line([cx + sx * 3 * k, cy + 12 * k, cx + sx * 7 * k, (S - PAD - 2) * k],
               fill=(0, 0, 0, 255), width=int(W * k), joint="curve")
    d.line([cx - 8 * k, cy + 10 * k, cx + 12 * k, (S - PAD) * k], fill=(0, 0, 0, 255), width=int(W * k))


def icon_star(d: ImageDraw.ImageDraw):
    import math
    k = 4
    cx = cy = S * k / 2
    R, r = 26 * k, 11 * k
    pts = []
    for i in range(10):
        ang = -math.pi / 2 + i * math.pi / 5
        rr = R if i % 2 == 0 else r
        pts.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang)))
    pts.append(pts[0])
    d.line(pts, fill=(0, 0, 0, 255), width=int(W * k), joint="curve")


def icon_book(d: ImageDraw.ImageDraw):
    """摊开的书：两页在中缝相接，比"两个方块"更好认"""
    k = 4
    cx = S * k / 2
    left, right = PAD * k, (S - PAD) * k
    top, bot = (PAD + 5) * k, (S - PAD) * k
    lw = int(W * k)
    # 左页（首尾闭合，否则外侧竖边画不出来，看起来像半个括号）
    d.line([(left, top + 9 * k), (cx - 3 * k, top), (cx - 3 * k, bot - 9 * k), (left, bot), (left, top + 9 * k)], fill=(0, 0, 0, 255), width=lw, joint="curve")
    # 右页
    d.line([(cx + 3 * k, top), (right, top + 9 * k), (right, bot), (cx + 3 * k, bot - 9 * k), (cx + 3 * k, top)], fill=(0, 0, 0, 255), width=lw, joint="curve")


def icon_user(d: ImageDraw.ImageDraw):
    k = 4
    cx = S * k / 2
    hr = 9 * k
    cy = (PAD + 9) * k
    d.ellipse([cx - hr, cy - hr, cx + hr, cy + hr], outline=(0, 0, 0, 255), width=int(W * k))
    # 肩线：只画上半圈，且必须留在画布内，否则底部会被裁掉
    top = cy + 10 * k
    d.arc([cx - 18 * k, top, cx + 18 * k, top + 34 * k],
          start=200, end=340, fill=(0, 0, 0, 255), width=int(W * k))


ICONS = {
    "calendar": icon_calendar,
    "award": icon_award,
    "star": icon_star,
    "book": icon_book,
    "user": icon_user,
}

if __name__ == "__main__":
    make_logo()
    for name, fn in ICONS.items():
        for suffix, color in (("", GREY), ("-on", BRAND)):
            im, d = canvas()
            fn(d)
            finish(im, color, name + suffix + ".png")
        print("tabbar ->", name, "+ active")
    print("done:", OUT)
