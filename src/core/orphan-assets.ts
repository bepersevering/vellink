/**
 * Find unreferenced image assets after a document is deleted (pure function).
 *
 * Exact matching only: if `.vellink-assets/<name>` appears in the source, the asset counts as used.
 * No semantic parsing — better to keep one extra image than to delete one still in use.
 */

import { ASSET_DIR } from "./asset";

/** Collect referenced asset filenames from Markdown source. */
export function referencedAssets(source: string): Set<string> {
  const out = new Set<string>();
  const re = new RegExp(`${ASSET_DIR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([^\s)"'>]+)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.add(m[1].trim().replace(/["')]+$/, ""));
  }
  return out;
}

/** Find files in the assets directory that no document references. */
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
