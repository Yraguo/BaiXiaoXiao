#!/usr/bin/env python3
"""
把 graphify 的图谱渲染成两张静态 SVG（亮色 / 暗色），供 README 嵌入。

为什么不用 graph.html 截图：
    graph.html 是 vis-network 的交互图，靠 CDN 加载 JS，本机没有可用的
    无头浏览器；而 GitHub 的 Markdown 也不能嵌交互式 HTML。
    直接从 graph.json 计算布局输出矢量图，清晰、可缩放、离线可复现。

用法（先跑 scripts/build-graph.py 生成 graph.json）：
    python3 scripts/render-graph.py

产物：
    docs/graph-light.svg   GitHub 亮色主题用
    docs/graph-dark.svg    GitHub 暗色主题用（README 用 <picture> 自动切换）
"""

import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
GRAPH = ROOT / "graphify-out" / "graph.json"
LABELS = ROOT / "scripts" / "graph-labels.json"
OUT = ROOT / "docs"

W, H = 1440, 1000
PAD = 70                  # 四周留白
SEED = 42                 # 固定随机种子，同一份图每次画出来是一样的
ITERATIONS = 90           # 力导向迭代次数
MIN_LABEL_COMMUNITY = 9   # 节点数少于这个的社区不标名字，避免糊成一片
MAX_LABELS = 20           # 最多标多少个社区名


def spring_layout(node_ids, edges, seed=SEED, iterations=ITERATIONS):
    """
    Fruchterman–Reingold 力导向布局，numpy 向量化。

    为什么不用 networkx 的 spring_layout：它依赖 scipy，为了画一张图
    多装 100MB 不值。这里斥力 O(n²) 全对算，引力只沿边算 O(E)，
    1062 个节点 90 轮迭代几秒钟跑完。
    """
    rng = np.random.default_rng(seed)
    index = {node_id: i for i, node_id in enumerate(node_ids)}
    n = len(node_ids)
    pos = rng.random((n, 2)) * 2 - 1

    edge_arr = np.array(
        [[index[e["source"]], index[e["target"]]]
         for e in edges if e["source"] in index and e["target"] in index],
        dtype=int,
    ).reshape(-1, 2)

    # 理想间距：面积 / 节点数 的平方根（FR 论文的定义）
    k = 0.55 * math.sqrt(4.0 / n)
    temperature = 0.12
    cool = temperature / (iterations + 1)

    for _ in range(iterations):
        # 斥力：所有节点对，距离越近推得越狠
        diff = pos[:, None, :] - pos[None, :, :]
        dist = np.sqrt((diff ** 2).sum(axis=2)) + 1e-9
        force = (k * k / dist)[:, :, None] * (diff / dist[:, :, None])
        np.fill_diagonal(force[:, :, 0], 0)
        np.fill_diagonal(force[:, :, 1], 0)
        total = force.sum(axis=1)

        # 引力：只沿边拉，拉力和距离成正比
        if len(edge_arr):
            src, dst = edge_arr[:, 0], edge_arr[:, 1]
            delta = pos[dst] - pos[src]
            length = np.sqrt((delta ** 2).sum(axis=1)) + 1e-9
            pull = (length / k)[:, None] * (delta / length[:, None])
            np.add.at(total, src, pull)
            np.add.at(total, dst, -pull)

        # 限制单步位移（模拟退火：先大后小），防止震荡不收敛
        step = np.sqrt((total ** 2).sum(axis=1)) + 1e-9
        limit = np.minimum(step, temperature) / step
        pos += total * limit[:, None]
        pos = np.clip(pos, -1.4, 1.4)
        temperature -= cool

    return dict(zip(node_ids, pos))


def palette(index, dark):
    """按黄金角散开色相，相邻社区的颜色不会挨着。"""
    hue = index * 137.508
    sat, light = (62, 64) if dark else (58, 42)
    return f"hsl({hue % 360:.0f},{sat}%,{light}%)"


def xml_escape(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def place_labels(centers, dark):
    """
    标签防碰撞：按社区大小从大到小放，跟已放的叠了就沿「画布中心 → 质心」
    方向往外找，最多试 24 个落点；实在放不下就放弃。
    返回 name -> (x, y, size)，字体大小在外面按 size 算。
    """
    # 先估每个标签的包围盒（中文 1 字 ≈ 1.05 字号，粗略但够用）
    def box(x, y, size, name):
        w = len(name) * size * 1.05
        h = size * 1.3
        return (x - w / 2, y - h / 2, x + w / 2, y + h / 2)

    def overlap(a, b):
        return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])

    # 字号由社区大小决定，先算好
    def font_of(size):
        return min(30, max(17, int(14 + math.sqrt(size) * 1.7)))

    # 画布中心：往外推的方向基准
    cx, cy = W / 2, H / 2

    placed = []
    result = {}
    for name, (x, y, size) in sorted(centers.items(), key=lambda kv: -kv[1][2]):
        font = font_of(size)
        candidates = [(x, y)]
        dx, dy = x - cx, y - cy
        norm = math.hypot(dx, dy) or 1.0
        dx, dy = dx / norm, dy / norm
        # 沿外推方向 8 步，每步再带一点垂直抖动，共 24 个候选
        for step in range(1, 9):
            d = step * 34
            for perp in (0.0, 0.55, -0.55):
                candidates.append((
                    x + dx * d - dy * perp * d,
                    y + dy * d + dx * perp * d,
                ))
        chosen = None
        for cand_x, cand_y in candidates:
            # 出了画布边缘就不要
            box_ = box(cand_x, cand_y, font, name)
            if box_[0] < 8 or box_[2] > W - 8 or box_[1] < 8 or box_[3] > H - 8:
                continue
            if any(overlap(box_, placed_box) for placed_box in placed):
                continue
            chosen = (cand_x, cand_y)
            placed.append(box_)
            break
        if chosen:
            result[name] = (chosen[0], chosen[1], size)
    return result


def build_svg(nodes, edges, labels_shown, stats, dark):
    """nodes: id -> (x, y, r, color)；labels_shown: name -> (x, y, size)"""
    bg = "#0d1117" if dark else "#ffffff"
    ink = "#e6edf3" if dark else "#24292f"
    soft = "#8b949e" if dark else "#57606a"
    halo = bg

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
        f'font-family="-apple-system,BlinkMacSystemFont,\'PingFang SC\',\'Microsoft YaHei\',sans-serif">',
        f'<rect width="{W}" height="{H}" fill="{bg}"/>',
    ]

    # 边分两档：簇内的亮、跨簇的淡 —— 簇结构才看得出来，
    # 否则 2161 条混在一起，要么糊成一团要么淡到看不见
    # 线宽与深浅是按「README 里缩到 830px 宽」调的：0.6px 的浅灰线
    # 缩放后低于一个物理像素，整张图就只剩点了
    if dark:
        inner_color, outer_color = "#8b98a8", "#39414d"
        inner_op, outer_op = "0.55", "0.45"
    else:
        inner_color, outer_color = "#7e93a8", "#b9c6d3"
        inner_op, outer_op = "0.65", "0.55"

    def seg(a, b):
        return f"M{a[0]:.1f} {a[1]:.1f}L{b[0]:.1f} {b[1]:.1f}"

    inner, outer = [], []
    for edge in edges:
        a = nodes.get(edge["source"])
        b = nodes.get(edge["target"])
        if not a or not b:
            continue
        # 第 5 位是社区 id，相同即簇内
        same = a[4] == b[4]
        (inner if same else outer).append(seg(a, b))

    for path_d, color, op in ((outer, outer_color, outer_op), (inner, inner_color, inner_op)):
        if path_d:
            parts.append(
                f'<path d="{"".join(path_d)}" stroke="{color}" stroke-width="1.1" '
                f'opacity="{op}" fill="none"/>'
            )

    # 节点：按社区分组合并成一条 path（每个社区一种颜色 = 一个元素），
    # 半径按度数走，中心枢纽一眼能认出来
    by_color = {}
    for node_id, (x, y, r, color, _comm) in nodes.items():
        by_color.setdefault(color, []).append((x, y, r))
    for color, circles in by_color.items():
        d = "".join(
            f"M{x - r:.1f} {y:.1f}a{r:.1f} {r:.1f} 0 1 0 {r * 2:.1f} 0"
            f"a{r:.1f} {r:.1f} 0 1 0 -{r * 2:.1f} 0"
            for x, y, r in circles
        )
        parts.append(f'<path d="{d}" fill="{color}"/>')

    # 社区名标在防碰撞后的落点上。
    # 兼容性说明：不用 paint-order / dominant-baseline —— sips 和一些
    # 渲染器不支持，会整个文字丢掉。用「双层文字」：先画一层背景色粗描边，
    # 再画一层正文，这是兼容性最好的描边方案。垂直居中用 dy 手动偏移。
    for name, (x, y, size) in labels_shown.items():
        font = min(30, max(17, int(14 + math.sqrt(size) * 1.7)))
        dy = font * 0.35
        common = (f'x="{x:.1f}" y="{y + dy:.1f}" text-anchor="middle" '
                  f'font-size="{font}" font-weight="700"')
        parts.append(
            f'<text {common} fill="none" stroke="{halo}" stroke-width="7" '
            f'stroke-linejoin="round">{xml_escape(name)}</text>'
        )
        parts.append(f'<text {common} fill="{ink}">{xml_escape(name)}</text>')

    parts.append(
        f'<text x="{W - PAD}" y="{H - 24}" text-anchor="end" font-size="15" fill="{soft}">'
        f'{stats}</text>'
    )
    parts.append("</svg>")
    return "\n".join(parts)


def main():
    data = json.loads(GRAPH.read_text(encoding="utf-8"))
    raw_nodes = data["nodes"]
    raw_edges = data["links"]

    node_ids = [n["id"] for n in raw_nodes]
    pos = spring_layout(node_ids, raw_edges)
    degree = {nid: 0 for nid in node_ids}
    for e in raw_edges:
        if e["source"] in degree:
            degree[e["source"]] += 1
        if e["target"] in degree:
            degree[e["target"]] += 1

    xs = [p[0] for p in pos.values()]
    ys = [p[1] for p in pos.values()]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    span_x = max(x1 - x0, 1e-9)
    span_y = max(y1 - y0, 1e-9)

    def scale(p):
        return (PAD + (p[0] - x0) / span_x * (W - PAD * 2),
                PAD + (p[1] - y0) / span_y * (H - PAD * 2))

    # 社区按大小排序拿颜色序号：颜色稳定，大社区拿到靠前的色相
    comm_members = {}
    for n in raw_nodes:
        comm_members.setdefault(n["community"], []).append(n)
    order = sorted(comm_members, key=lambda c: -len(comm_members[c]))
    comm_index = {c: i for i, c in enumerate(order)}

    labels = {}
    if LABELS.exists():
        labels = {int(k): v for k, v in json.loads(LABELS.read_text(encoding="utf-8")).items()}

    for dark in (False, True):
        nodes = {}
        for n in raw_nodes:
            x, y = scale(pos[n["id"]])
            r = min(6.5, 1.5 + math.sqrt(degree.get(n["id"], 1)) * 0.75)
            nodes[n["id"]] = (x, y, r, palette(comm_index[n["community"]], dark), n["community"])

        # 社区质心：名字放这里
        centers = {}
        for c, members in comm_members.items():
            cx = sum(nodes[m["id"]][0] for m in members) / len(members)
            cy = sum(nodes[m["id"]][1] for m in members) / len(members)
            name = labels.get(c) or f"Community {c}"
            centers[name] = (cx, cy, len(members))

        eligible = {name: (x, y, size) for name, (x, y, size) in centers.items()
                    if size >= MIN_LABEL_COMMUNITY}
        eligible = dict(sorted(eligible.items(), key=lambda kv: -kv[1][2])[:MAX_LABELS])
        shown = place_labels(eligible, dark)

        stats = (f"{len(raw_nodes)} nodes · {len(raw_edges)} edges · "
                 f"{len(centers)} communities · generated by scripts/render-graph.py")
        svg = build_svg(nodes, raw_edges, shown, stats, dark)

        suffix = "dark" if dark else "light"
        out = OUT / f"graph-{suffix}.svg"
        OUT.mkdir(parents=True, exist_ok=True)
        out.write_text(svg, encoding="utf-8")
        print(f"{out.relative_to(ROOT)}  {out.stat().st_size / 1024:.0f} KB  "
              f"({len(nodes)} 节点 / {len(raw_edges)} 边 / 标注 {len(shown)} 个社区名)")


if __name__ == "__main__":
    main()
