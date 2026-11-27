/**
 * Migrate relative-path images when importing Markdown (pure functions).
 *
 * Read references like `![alt](./img.png)` from the source file's directory, write them into the
 * workspace's `.vellink-assets/`, and rewrite the references to the new paths. Absolute URLs, data
 * URIs and protocol-qualified references are left as-is — they aren't local files we can migrate.
 */

import { imageExtension } from "./asset";

export interface ImageRef {
  from: number;
  to: number;
  /** Raw path from the reference (trimmed). */
  path: string;
  /** Original image filename (used to name the asset). */
  fileName: string;
  /** Title portion of the reference (including quotes), preserved when rewriting. */
  title: string;
}

/** Find image references and their relative paths in Markdown source. */
export function findRelativeImages(source: string): ImageRef[] {
  const out: ImageRef[] = [];
  // Match only ![alt](path) without a title (titled ones are handled by the next step)
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const raw = m[2].trim();
    const path = raw.replace(/\s+"[^"]*"$/, "").trim();
    if (!path || /^(?:[a-z][a-z0-9+.-]*:|\/|data:|#)/i.test(path)) continue;
    if (path.includes("..")) continue; // don't escape the source file's directory
    const ext = path.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
    const mime = `image/${ext === "jpg" ? "jpeg" : ext}`;
    if (!imageExtension(mime)) continue;
    out.push({
      from: m.index,
      to: m.index + m[0].length,
      path,
      fileName: path.split("/").pop() ?? path,
      title: /\s+"[^"]*"\)$/.exec(m[0])?.[0] ?? ")",
    });
  }
  return out;
}

/** Replace image paths in the source with new ones, in reference order. */
export function rewriteImagePaths(
  source: string,
  refs: readonly ImageRef[],
  targetFor: (ref: ImageRef) => string | null,
): string {
  let out = "";
  let cursor = 0;
  for (const ref of refs) {
    if (ref.from < cursor) continue;
    out += source.slice(cursor, ref.from);
    const target = targetFor(ref);
    // Unreadable image: keep the original reference, never silently drop content
    out += target ? `![${altOf(source, ref)}](${target}${ref.title}` : source.slice(ref.from, ref.to);
    cursor = ref.to;
  }
  return out + source.slice(cursor);
}

function altOf(source: string, ref: ImageRef): string {
  return /^!\[([^\]]*)\]/.exec(source.slice(ref.from, ref.to))?.[1] ?? "";
}
