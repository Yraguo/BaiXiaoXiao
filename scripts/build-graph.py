#!/usr/bin/env python3
"""
重建本项目的架构知识图谱。

为什么不用 `graphify update`：
    那个命令在本机稳定报 "[graphify watch] Rebuild failed: [Errno 17] EEXIST"，
    是第三方包 watch.py 里并发建目录的竞态（graphifyy 0.9.104）。
    但它内部的各个步骤单独跑都是好的，所以这里直接调 Python API 走同一条流水线。

产物（都在 graphify-out/ 下，已 gitignore，不进小程序包）：
    graph.json         图谱本体（nodes / links / hyperedges）
    graph.html         交互式图谱，浏览器直接打开
    GRAPH_REPORT.md    审计报告：社区、枢纽、桥接节点、循环依赖

用法：
    pip install graphifyy networkx numpy pyyaml rapidfuzz tree-sitter
    python3 scripts/build-graph.py

可选：语义抽取（读 README 抽概念与关系）需要 LLM，
      产物放在 graphify-out/.graphify_semantic_new.json，本脚本会自动合并。
"""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "graphify-out"

# 社区人工命名。放在 scripts/ 下而不是 graphify-out/ —— 后者被 gitignore，
# 而社区名是人工产物，应该跟着仓库走，别人克隆下来不用重新起名。
LABELS_PATH = ROOT / "scripts" / "graph-labels.json"
LEGACY_LABELS_PATH = OUT / ".graphify_labels.json"
SEMANTIC_PATH = OUT / ".graphify_semantic_new.json"


def die(message):
    print("错误：" + message, file=sys.stderr)
    sys.exit(1)


def ensure_deps():
    try:
        import graphify  # noqa: F401
    except ImportError:
        die(
            "缺少 graphifyy。先装依赖：\n"
            "  pip install graphifyy networkx numpy pyyaml rapidfuzz tree-sitter"
        )


def main():
    ensure_deps()
    OUT.mkdir(parents=True, exist_ok=True)

    from graphify.analyze import god_nodes, suggest_questions, surprising_connections
    from graphify.build import build_from_json
    from graphify.cluster import cluster, score_all
    from graphify.detect import detect
    from graphify.export import to_json
    from graphify.extract import collect_files, extract
    from graphify.paths import out_path
    from graphify.report import generate
    from graphify.watch import _read_build_excludes, _read_build_gitignore

    root = str(ROOT)

    # ── 1. 扫描 ────────────────────────────────────────────────
    detection = detect(
        Path(root),
        extra_excludes=_read_build_excludes(out_path()),
        gitignore=_read_build_gitignore(out_path()),
    )
    code_files = []
    for item in detection.get("files", {}).get("code", []):
        path = Path(item)
        code_files.extend(collect_files(path) if path.is_dir() else [path])
    print(f"扫描到 {detection.get('total_files')} 个文件，其中 {len(code_files)} 个代码文件")

    # ── 2. AST 抽取 ─────────────────────────────────────────────
    extraction = extract(code_files, cache_root=Path(root), root=Path(root))
    print(f"AST 抽取：{len(extraction.get('nodes', []))} 节点 / {len(extraction.get('edges', []))} 边")

    # ── 3. 合并语义抽取 ───────────────────────────────────────
    # 语义节点（读 README 抽出来的概念）需要 LLM，跑不了就复用上一版图里的。
    # 不复用的话，新图会缺这些节点，graphify 的保护机制会拒绝覆盖旧图。
    semantic_nodes, semantic_edges, semantic_hyper = [], [], []
    if SEMANTIC_PATH.exists():
        semantic = json.loads(SEMANTIC_PATH.read_text(encoding="utf-8"))
        semantic_nodes = semantic.get("nodes", [])
        semantic_edges = semantic.get("edges", [])
        semantic_hyper = semantic.get("hyperedges", [])
        source = ".graphify_semantic_new.json"
    elif (OUT / "graph.json").exists():
        previous = json.loads((OUT / "graph.json").read_text(encoding="utf-8"))
        semantic_nodes = [n for n in previous.get("nodes", []) if n.get("_origin") == "semantic"]
        semantic_edges = [e for e in previous.get("links", previous.get("edges", []))
                          if e.get("_origin") == "semantic"]
        semantic_hyper = previous.get("hyperedges", [])
        source = "上一版 graph.json"

    if semantic_nodes:
        seen = {node["id"] for node in extraction.get("nodes", [])}
        extra = [n for n in semantic_nodes if n["id"] not in seen]
        extraction.setdefault("nodes", []).extend(extra)
        extraction.setdefault("edges", []).extend(semantic_edges)
        extraction.setdefault("hyperedges", []).extend(semantic_hyper)
        print(f"合并语义抽取（{source}）：+{len(extra)} 节点 / +{len(semantic_edges)} 边")
    else:
        extraction.setdefault("hyperedges", [])
        print("没有语义节点可用（需要 LLM 抽 README），本次只建代码图")

    # ── 4. 建图 + 聚类 ──────────────────────────────────────────
    graph = build_from_json(extraction, root=root, directed=False)
    if graph.number_of_nodes() == 0:
        die("图是空的，检查一下扫描范围")
    communities = cluster(graph)
    cohesion = score_all(graph, communities)

    labels = {}
    for source in (LABELS_PATH, LEGACY_LABELS_PATH):
        if source.exists():
            labels = {int(k): v for k, v in json.loads(source.read_text(encoding="utf-8")).items()}
            break
    if labels:
        LABELS_PATH.write_text(
            json.dumps({str(k): v for k, v in sorted(labels.items())}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    tokens = {
        "input": extraction.get("input_tokens", 0),
        "output": extraction.get("output_tokens", 0),
    }
    gods = god_nodes(graph)
    surprises = surprising_connections(graph, communities)
    questions = suggest_questions(graph, communities, labels)

    # ── 5. 导出 ────────────────────────────────────────────────
    # graphify 自带一个保护：新图少了已保存的节点就拒绝覆盖。
    # 那条保护对「代码事实」是对的（代码节点凭空消失说明抽取出了问题），
    # 但语义节点是我们从 README 抽的，改一次 README 就会换一批名字，
    # 属于正常更新。所以显式提供了语义结果时，放行覆盖。
    force = SEMANTIC_PATH.exists()
    if not to_json(graph, communities, str(OUT / "graph.json"),
                   force=force, community_labels=labels or None):
        die("拒绝覆盖已有 graph.json（节点数变少了？）")

    report = generate(
        graph, communities, cohesion, labels, gods, surprises,
        detection, tokens, root, suggested_questions=questions,
    )
    (OUT / "GRAPH_REPORT.md").write_text(report, encoding="utf-8")
    (OUT / ".graphify_analysis.json").write_text(
        json.dumps(
            {
                "communities": {str(k): v for k, v in communities.items()},
                "cohesion": {str(k): v for k, v in cohesion.items()},
                "gods": gods,
                "surprises": surprises,
                "questions": questions,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    # 交互式 HTML 走 CLI 的 export 子命令（它本身没有那个竞态）
    subprocess.run(
        [sys.executable, "-m", "graphify", "export", "html"],
        cwd=str(ROOT),
        check=False,
    )

    print(
        f"\n完成：{graph.number_of_nodes()} 节点 / {graph.number_of_edges()} 边 / "
        f"{len(communities)} 社区"
    )
    print("产物在 graphify-out/：graph.html（交互图）、GRAPH_REPORT.md（审计报告）")


if __name__ == "__main__":
    main()
