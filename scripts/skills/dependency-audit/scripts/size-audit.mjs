#!/usr/bin/env node
// dependency-audit — 安装体积 & 耗时归因（数据优先，不做推断）
//
// 用法：node size-audit.mjs [target-dir] [--json] [--top=N]
//
// 原则（按 review 要求）：先把三方数据对齐、输出**可复核**的事实，再给建议；
// 没有 install 结果时**不推断体积**。三方：
//   1) manifest：package.json 声明的 deps/devDeps
//   2) lockfile：最近 pnpm-lock.yaml 解析出的 name@version
//   3) install：实际 node_modules 落盘字节（pnpm 用 .pnpm store + 符号链接，
//      故按 store 真实目录测量，符号链接不跟随、不重复计）
//
// 耗时：本工具**不推断**安装耗时；只给出实测命令（见结尾），需实测后填入。

import fs from 'node:fs';
import path from 'node:path';
import {
  findInstallRoot,
  findLockfile,
  mb,
  measureInstalled,
} from './lib/size-kit.mjs';

function parseArgs(argv) {
  const rest = argv.slice(2);
  const json = rest.includes('--json');
  const topArg = rest.find(a => a.startsWith('--top='));
  const top = topArg ? Number(topArg.split('=')[1]) : 20;
  const dir = rest.find(a => !a.startsWith('--'));
  const rootArg = rest.find(a => a.startsWith('--install-root='));
  return {
    dir: path.resolve(dir || '.'),
    json,
    top,
    installRoot: rootArg ? path.resolve(rootArg.split('=')[1]) : null,
  };
}

function readLockNames(lockPath) {
  const text = fs.readFileSync(lockPath, 'utf-8');
  const names = new Set();
  const re = /^\s+'?((?:@[^@/\s]+\/)?[^@/\s']+)@\d+\.\d+\.\d+[^':\s(]*'?:/gm;
  let m;
  while ((m = re.exec(text))) names.add(m[1]);
  return names;
}

function main() {
  const {
    dir,
    json,
    top,
    installRoot: explicitInstallRoot,
  } = parseArgs(process.argv);
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error(`未找到 package.json: ${pkgPath}`);
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const declared = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {}),
  ]);

  const lockPath = findLockfile(dir);
  const lockNames = lockPath ? readLockNames(lockPath) : null;
  // install 根：显式 --install-root > 向上找含 node_modules 的目录 > target 自身
  const installRoot = explicitInstallRoot || findInstallRoot(dir) || dir;
  const installed = measureInstalled(installRoot);

  const report = {
    target: dir,
    package: pkg.name || '(unnamed)',
    declaredCount: declared.size,
    lockfile: lockPath ? path.relative(dir, lockPath) : null,
    installRoot: installed ? path.relative(dir, installRoot) || '.' : null,
    installPresent: !!installed,
    largest: [],
    declaredNotInstalled: [],
    totalBytes: null,
  };

  if (installed) {
    const entries = [...installed.entries()].sort((a, b) => b[1] - a[1]);
    report.totalBytes = entries.reduce((s, [, b]) => s + b, 0);
    report.largest = entries
      .slice(0, top)
      .map(([name, bytes]) => ({ name, bytes }));
    report.declaredNotInstalled = [...declared]
      .filter(d => !installed.has(d))
      .sort();
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  console.log(`📦 体积 & 耗时归因：${report.package}`);

  if (!installed) {
    console.log(
      '\nℹ️ 未发现 node_modules（已向上查找安装根）—— install 结果不可用，**不推断体积**。',
    );
    console.log(
      '   请先 `pnpm install`；或用 `--install-root=<装了依赖的目录>` 指定安装根。',
    );
  } else {
    console.log(
      `\n📊 已安装总体积：${mb(report.totalBytes)}（安装根：${report.installRoot}，按包累加真实落盘字节）`,
    );
    console.log(`\n体积最大的 ${report.largest.length} 个包：`);
    for (const { name, bytes } of report.largest) {
      console.log(`  - ${name.padEnd(36)} ${mb(bytes)}`);
    }
    if (report.declaredNotInstalled.length) {
      console.log(
        `\n⚠️ 声明但未安装（manifest 有、node_modules 无）${report.declaredNotInstalled.length} 个：`,
      );
      console.log(`  ${report.declaredNotInstalled.join(', ')}`);
    }
    console.log(
      '\n建议（仅基于上面实测体积）：对体积大头评估能否换轻量替代 / 按需引入 / 移到 optionalDependencies。',
    );
  }

  if (lockNames) {
    console.log(
      `\n（lockfile ${report.lockfile} 解析到 ${lockNames.size} 个包名，可与上面安装结果交叉核对版本/缺失）`,
    );
  }

  console.log(
    '\n⏱️ 安装耗时本工具不推断；实测：`/usr/bin/time -v pnpm install`（或 pnpm `--reporter=ndjson` 采时），把真实耗时填入归因结论。',
  );
}

main();
