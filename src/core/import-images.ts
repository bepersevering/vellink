/**
 * 导入 Markdown 时搬运相对路径图片（纯函数部分）。
 *
 * 从源文件所在目录读 `![alt](./img.png)` 这类引用，写进工作区
 * `.vellink-assets/`，并把引用改写成新路径。绝对 URL / data URI /
 * 带协议的引用原样保留——那些不是能搬运的本地文件。
 */

import { imageExtension } from "./asset";

export interface ImageRef {
  from: number;
  to: number;
  /** 引用里的原始路径（已 trim）。 */
  path: string;
  /** 图片原始文件名（用于命名资产）。 */
  fileName: string;
  /** 引用里的 title 部分（含引号），改写时保留。 */
  title: string;
}

/** 找 Markdown 源码里的图片引用及其相对路径。 */
export function findRelativeImages(source: string): ImageRef[] {
  const out: ImageRef[] = [];
  // 只匹配 ![alt](path)，不含 title（带 title 的交给下一步）
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const raw = m[2].trim();
    const path = raw.replace(/\s+"[^"]*"$/, "").trim();
    if (!path || /^(?:[a-z][a-z0-9+.-]*:|\/|data:|#)/i.test(path)) continue;
    if (path.includes("..")) continue; // 不越出源文件目录
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

/** 按引用顺序把源码里的图片路径替换成新路径。 */
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
    // 读不到的图：保留原引用，不静默丢内容
    out += target ? `![${altOf(source, ref)}](${target}${ref.title}` : source.slice(ref.from, ref.to);
    cursor = ref.to;
  }
  return out + source.slice(cursor);
}

function altOf(source: string, ref: ImageRef): string {
  return /^!\[([^\]]*)\]/.exec(source.slice(ref.from, ref.to))?.[1] ?? "";
}
