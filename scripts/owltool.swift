import Foundation
import AppKit

// owltool: 处理百小鸮生成图 —— 探测/清除右下角模型水印，缩放，输出拼图预览
// 用法:
//   probe  <in...>                 打印右下角水印候选区域 alpha 包围盒
//   clean  <outDir> <size> <in...>  清除水印 + 缩放到 size + 存为同名 .png
//   grid   <out> <cols> <cell> <in...>

func bitmap(_ path: String) -> NSBitmapImageRep? {
    guard let img = NSImage(contentsOfFile: path),
          let rep = NSBitmapImageRep(data: img.tiffRepresentation!) else { return nil }
    return rep
}

let args = CommandLine.arguments
guard args.count >= 2 else { print("usage: owltool <probe|clean|grid> ..."); exit(1) }
let cmd = args[1]
let cs = CGColorSpaceCreateDeviceRGB()

// 在右下角候选区（x >= 0.70w, y <= 0.16h，AppKit 坐标 y 向上）中找不透明像素包围盒
func watermarkBox(_ rep: NSBitmapImageRep) -> (x0: Int, y0: Int, x1: Int, y1: Int)? {
    let w = rep.pixelsWide, h = rep.pixelsHigh
    let rx = Int(Double(w) * 0.70), rh = Int(Double(h) * 0.16)
    var minX = w, maxX = -1, minY = h, maxY = -1
    for y in 0..<min(rh, h) {
        for x in rx..<w {
            if let c = rep.colorAt(x: x, y: y), c.alphaComponent > 0.03 {
                if x < minX { minX = x }; if x > maxX { maxX = x }
                if y < minY { minY = y }; if y > maxY { maxY = y }
            }
        }
    }
    guard maxX >= minX, maxY >= minY else { return nil }
    return (minX, minY, maxX, maxY)
}

if cmd == "probe" {
    for path in args[2...] {
        guard let rep = bitmap(path) else { print("\(path): LOAD FAIL"); continue }
        let w = rep.pixelsWide, h = rep.pixelsHigh
        if let b = watermarkBox(rep) {
            print("\(path) \(w)x\(h)  watermark bbox= x[\(b.x0)...\(b.x1)] y[\(b.y0)...\(b.y1)]  (ratio x0=\(String(format: "%.2f", Double(b.x0)/Double(w))) y0=\(String(format: "%.2f", Double(b.y0)/Double(h))))")
        } else {
            print("\(path) \(w)x\(h)  no watermark in bottom-right zone")
        }
    }
} else if cmd == "clean" {
    // clean <outDir> <size> <in> <outName>
    // 清除右下角模型水印（固定比例矩形：x >= 0.855w，y <= 0.09h），再缩放到 size
    guard args.count >= 6 else { print("usage: owltool clean <outDir> <size> <in> <outName>"); exit(1) }
    let outDir = args[2], size = Int(args[3])!
    try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
    let path = args[4], outName = args[5]
    guard let rep = bitmap(path), let cg = rep.cgImage else { print("LOAD FAIL \(path)"); exit(1) }
    let w = rep.pixelsWide, h = rep.pixelsHigh
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                              space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(1) }
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
    let cx0 = Int(Double(w) * 0.855)
    let ch = Int(Double(h) * 0.09)
    ctx.clear(CGRect(x: cx0, y: 0, width: w - cx0, height: ch))
    guard let cleared = ctx.makeImage() else { exit(1) }
    let crep = NSBitmapImageRep(cgImage: cleared)
    guard let sctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                               space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(1) }
    sctx.interpolationQuality = .high
    sctx.draw(crep.cgImage!, in: CGRect(x: 0, y: 0, width: size, height: size))
    guard let small = sctx.makeImage() else { exit(1) }
    let srep = NSBitmapImageRep(cgImage: small)
    guard let data = srep.representation(using: .png, properties: [:]) else { exit(1) }
    let outPath = "\(outDir)/\(outName).png"
    try? data.write(to: URL(fileURLWithPath: outPath))
    print("OK \(outName).png  cleared x>=\(cx0) y<=\(ch)  -> \(size)px")
} else if cmd == "cropbr" {
    // cropbr <in> <out> <x> <y> <w> <h>   图像自然坐标（左上原点）裁剪并放大 2 倍
    guard args.count >= 7 else { print("usage: owltool cropbr <in> <out> <x> <y> <w> <h>"); exit(1) }
    guard let rep = bitmap(args[2]), let cg = rep.cgImage else { exit(1) }
    let x = Int(args[4])!, y = Int(args[5])!, cw = Int(args[6])!, ch = Int(args[7])!
    guard let sub = cg.cropping(to: CGRect(x: x, y: y, width: cw, height: ch)) else { exit(1) }
    let ow = cw * 2, oh = ch * 2
    guard let ctx = CGContext(data: nil, width: ow, height: oh, bitsPerComponent: 8, bytesPerRow: 0,
                              space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(1) }
    ctx.setFillColor(CGColor(red: 0.15, green: 0.15, blue: 0.18, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: ow, height: oh))
    ctx.interpolationQuality = .high
    ctx.draw(sub, in: CGRect(x: 0, y: 0, width: ow, height: oh))
    guard let out = ctx.makeImage() else { exit(1) }
    let orep = NSBitmapImageRep(cgImage: out)
    guard let data = orep.representation(using: .png, properties: [:]) else { exit(1) }
    try? data.write(to: URL(fileURLWithPath: args[3]))
    print("cropbr -> \(args[3])")
} else if cmd == "grid" {
    guard args.count >= 5 else { print("usage: owltool grid <out> <cols> <cell> <in...>"); exit(1) }
    let outPath = args[2], cols = Int(args[3])!, cell = Int(args[4])!
    let inputs = Array(args[5...])
    let rows = (inputs.count + cols - 1) / cols
    let W = cols * cell, H = rows * cell
    guard let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0,
                              space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(1) }
    ctx.setFillColor(CGColor(red: 0.11, green: 0.12, blue: 0.15, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
    for (i, p) in inputs.enumerated() {
        guard let rep = bitmap(p), let cg = rep.cgImage else { continue }
        let r = i / cols, c = i % cols
        let x = c * cell, y = H - (r + 1) * cell
        ctx.draw(cg, in: CGRect(x: x, y: y, width: cell, height: cell))
    }
    guard let out = ctx.makeImage() else { exit(1) }
    let rep = NSBitmapImageRep(cgImage: out)
    guard let data = rep.representation(using: .png, properties: [:]) else { exit(1) }
    try? data.write(to: URL(fileURLWithPath: outPath))
    print("grid -> \(outPath) (\(W)x\(H))")
}
