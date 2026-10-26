#!/usr/bin/env node
/**
 * 品牌改名脚本：Unimate → 百小鸮
 *
 * 为什么不是"全局 Ctrl+H 替换"？因为工程里有 4 处 «Unimate» 是**协议常量**，
 * 改了会让老用户的云端数据/备份直接读不出来：
 *
 *   1. src/services/syncCrypto.ts  AAD_PREFIX = 'Unimate/P3/v1/'
 *      → AES-GCM 的附加认证数据。改了 → 已同步的加密包全部认证失败，解不开。
 *   2/3/4. src/services/backup.ts  BackupManifest.app 的类型、写入值、校验值
 *      → 备份文件的**格式标识**，不是给人看的名字。
 *
 * 本脚本对这三处的处理是**全部跳过**：格式标识继续叫 'Unimate'，旧备份照样能恢复，
 * 用户看不到它。真要改，必须三处同时改 + 加 `app === 'Unimate' || app === '百小鸮'`
 * 的兼容分支，否则已导出的备份全部作废。
 *
 * 用法：
 *   node scripts/rename-brand.mjs            # 只预览，不改文件（默认）
 *   node scripts/rename-brand.mjs --apply    # 真改，改前自动备份到 .brand-backup-<时间>/
 *
 * 目标工程目录用 --root 指定，默认是你机器上那个 Android 工程。
 */
import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const DEFAULT_ROOT = 'E:/Gary/北京化工大学/北化app/BaiXiaoXiao/BaiXiaoXiao';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const rootIdx = args.indexOf('--root');
const ROOT = rootIdx >= 0 ? args[rootIdx + 1] : DEFAULT_ROOT;

const NEW_NAME = '百小鸮';

/** 只扫这些位置（android/ 里的 strings.xml 单独处理，见 PLAN_EXTRA） */
const SCAN_DIRS = ['src'];
const SCAN_FILES = ['index.html', 'capacitor.config.ts', 'package.json', 'README.md'];

/** 必须跳过的「协议常量」——每一处都写清原因，别删 */
const SKIP = [
  {
    file: 'src/services/syncCrypto.ts',
    pattern: /AAD_PREFIX/,
    why: 'AES-GCM 附加认证数据：改了已加密的云同步包全部解不开'
  },
  {
    file: 'src/services/backup.ts',
    pattern: /app:\s*'Unimate'/,
    why: '备份格式标识（写给文件看的，不是给人看的）'
  },
  {
    file: 'src/services/backup.ts',
    pattern: /manifest\.app\s*!==\s*'Unimate'/,
    why: '备份校验：改了就认不出旧备份'
  }
];

/** 只替换「独立单词」形态的 Unimate：前后不能紧邻字母/数字/_/./:/-//，
 *  这样 unimate:xxx 存储键、__unimateBack、com.unimate.app、unimate3.pages.dev 都天然不动 */
const TOKEN = /(?<![A-Za-z0-9_.:\/-])Unimate(?![A-Za-z0-9_.:\/-])/g;

const EXTS = new Set(['.ts', '.vue', '.js', '.mjs', '.css', '.html', '.json', '.md', '.xml', '.kt', '.java']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.has(name.slice(name.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

const files = [];
for (const d of SCAN_DIRS) {
  const p = join(ROOT, d);
  if (existsSync(p)) files.push(...walk(p));
}
for (const f of SCAN_FILES) {
  const p = join(ROOT, f);
  if (existsSync(p)) files.push(p);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupDir = join(ROOT, '.brand-backup-' + stamp);

const report = [];
let totalHits = 0;
let totalSkipped = 0;

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  let changed = 0;
  let skipped = 0;

  const out = lines.map((line) => {
    TOKEN.lastIndex = 0;
    if (!TOKEN.test(line)) return line;
    TOKEN.lastIndex = 0;

    const skipRule = SKIP.find((s) => rel.endsWith(s.file) && s.pattern.test(line));
    if (skipRule) {
      skipped++;
      return line;
    }
    const hits = line.match(TOKEN)?.length ?? 0;
    changed += hits;
    return line.replace(TOKEN, NEW_NAME);
  });

  if (changed > 0 || skipped > 0) {
    report.push({ rel, changed, skipped });
    totalHits += changed;
    totalSkipped += skipped;
    if (APPLY && changed > 0) {
      const dest = join(backupDir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(file, dest);
      writeFileSync(file, out.join(text.includes('\r\n') ? '\r\n' : '\n'), 'utf8');
    }
  }
}

report.sort((a, b) => b.changed - a.changed);
console.log(`\n工程目录：${ROOT}`);
console.log(`待替换 ${totalHits} 处 / 跳过 ${totalSkipped} 处协议常量\n`);
console.log('文件'.padEnd(46) + '替换  跳过');
console.log('-'.repeat(64));
for (const r of report) {
  console.log(r.rel.padEnd(46) + String(r.changed).padStart(4) + String(r.skipped).padStart(6));
}

console.log('\n被跳过的协议常量（这些**不能**改名，要改请成对改代码）：');
for (const s of SKIP) console.log(`  · ${s.file}  ${s.pattern}  — ${s.why}`);

if (APPLY) {
  console.log(`\n已改完。原文件备份在：${backupDir}`);
  console.log('建议立刻：1) 全局搜 Unimate 复核  2) 跑 npm test（30 个测试脚本）  3) 真机试一次备份恢复');
} else {
  console.log('\n这是预览模式，没有改动任何文件。确认无误后加 --apply 真正执行：');
  console.log(`  node scripts/rename-brand.mjs --apply`);
}
