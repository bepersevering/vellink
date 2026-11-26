#!/usr/bin/env node
/**
 * 版本号单一来源：package.json。
 *
 * 三处必须一致，否则会出现「应用显示 0.2.0、安装包叫 0.1.0、更新器比较的是第三个
 * 数字」这种最难受的 bug：
 *   1. package.json              —— npm 侧（`npm version` 的入口）
 *   2. src-tauri/tauri.conf.json —— 打包产物与 updater 比较用的版本
 *   3. src-tauri/Cargo.toml      —— Rust 壳的 crate 版本（以及 Cargo.lock 里的锁定值）
 *
 * 用法：
 *   node scripts/sync-version.mjs           把 package.json 的版本写进另外两处
 *   node scripts/sync-version.mjs --check   只校验，不一致时退出码 1（CI 用）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");

const pkgPath = resolve(root, "package.json");
const confPath = resolve(root, "src-tauri/tauri.conf.json");
const cargoPath = resolve(root, "src-tauri/Cargo.toml");
const lockPath = resolve(root, "src-tauri/Cargo.lock");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const version = pkg.version;

if (typeof version !== "string" || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`package.json 里的版本号不合法：${String(version)}`);
  process.exit(1);
}

/** 返回 { path, before, after, changed }；--check 时不落盘。 */
function sync(path, transform, read) {
  let before = "";
  try {
    before = readFileSync(path, "utf8");
  } catch {
    return { path, skipped: true, changed: false };
  }
  const after = transform(before);
  const changed = after !== before;
  if (changed && !checkOnly) writeFileSync(path, after);
  return { path, before: read(before), after: read(after), changed };
}

const results = [
  sync(
    confPath,
    (text) => {
      const conf = JSON.parse(text);
      if (conf.version === version) return text;
      conf.version = version;
      return `${JSON.stringify(conf, null, 2)}\n`;
    },
    (text) => JSON.parse(text).version,
  ),
  sync(
    cargoPath,
    (text) => {
      // 只换 [package] 段里行首的 version，不碰依赖的内联 version
      return text.replace(/^version = "[^"]*"/m, `version = "${version}"`);
    },
    (text) => (text.match(/^version = "([^"]*)"/m) ?? [])[1],
  ),
  sync(
    lockPath,
    (text) => {
      // Cargo.lock 里本包那一段：name = "vellink" 紧跟着 version。
      // 换行写成 \r?\n：Windows runner 上 checkout 出来的是 CRLF，只认 \n
      // 会让版本校验在那里恒定失败（macOS / Linux 却全绿，很难查）。
      return text.replace(
        /(\[\[package\]\]\r?\nname = "vellink"\r?\nversion = ")[^"]*(")/,
        `$1${version}$2`,
      );
    },
    (text) =>
      (text.match(/\[\[package\]\]\r?\nname = "vellink"\r?\nversion = "([^"]*)"/) ?? [])[1],
  ),
];

let failed = false;
for (const result of results) {
  if (result.skipped) {
    console.warn(`跳过 ${result.path}（文件不存在）`);
    continue;
  }
  const rel = result.path.slice(root.length + 1);
  if (result.after === version) {
    console.log(`✓ ${rel} → ${version}`);
  } else {
    failed = true;
    console.error(`✗ ${rel} 仍是 ${result.after ?? "未找到"}（期望 ${version}）`);
  }
}

if (failed) {
  console.error(
    checkOnly
      ? "\n版本号不一致。本地跑 `npm run version:sync` 修好再提交。"
      : "\n有文件没能同步到目标版本，请手动检查。",
  );
  process.exit(1);
}
console.log(checkOnly ? "\n版本号三处一致。" : `\n版本号已统一为 ${version}。`);
