/**
 * 删除文档后找出无人引用的图片资产（纯函数）。
 *
 * 只做精确匹配：源码里出现 `.vellink-assets/<name>` 就算被引用，
 * 不做语义解析——宁可多留一张图，也不能误删还在用的。
 */

import { ASSET_DIR } from "./asset";

/** 从 Markdown 源码里收集被引用的资产文件名。 */
export function referencedAssets(source: string): Set<string> {
  const out = new Set<string>();
  const re = new RegExp(`${ASSET_DIR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([^\s)"'>]+)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.add(m[1].trim().replace(/["')]+$/, ""));
  }
  return out;
}

/** 找出 assets 目录里没有任何文档引用的文件。 */
export function findOrphanAssets(
  sources: readonly string[],
  assetNames: readonly string[],
): string[] {
  const used = new Set<string>();
  for (const source of sources) {
    for (const name of referencedAssets(source)) used.add(name);
  }
  return assetNames.filter((name) => !used.has(name));
}
