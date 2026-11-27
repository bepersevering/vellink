/**
 * 图片资产：命名、Markdown 插入、导出内嵌。
 *
 * 这里全是纯函数：不碰 DOM、不碰 fs。文件的落地交给桌面桥，
 * 读取交给调用方给的 resolver，所以命名规则和内嵌规则都能在单测里跑。
 */

/** 只认这四种常见的位图格式，SVG 不收（它能带脚本）。 */
export const IMAGE_TYPES: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** 一张图最多 20MB：再大的截图会让 IPC 和 localStorage 都很难受。 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export const ASSET_DIR = ".vellink-assets";

export function imageExtension(mime: string): string | null {
  return IMAGE_TYPES[mime.trim().toLowerCase()] ?? null;
}

export function isImageType(mime: string): boolean {
  return imageExtension(mime) !== null;
}

export function mimeFromAssetPath(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  for (const [mime, value] of Object.entries(IMAGE_TYPES)) {
    if (value === ext) return mime;
  }
  return null;
}

/** 文件名 → ASCII slug。避免空格、括号、中文把 Markdown 的目标地址弄坏。 */
export function slugify(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").toLowerCase();
  return (
    base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "image"
  );
}

/** FNV-1a：给同一张图一个稳定的短后缀，重名也不会互相覆盖。 */
export function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * 用户看到的原文件名 + 内容哈希 → 实际落盘的名字。
 *
 * 内容哈希而不是时间戳：同一张图反复粘三次只存一份；不同来源的
 * `截图.png` 也不会互相覆盖。
 */
export function assetName(original: string, mime: string, bytes: Uint8Array): string | null {
  const ext = imageExtension(mime);
  if (!ext) return null;
  return `${slugify(original)}-${hashBytes(bytes)}.${ext}`;
}

/** Markdown 里的相对路径：相对当前笔记所在的工作区根目录。 */
export function assetRelativePath(name: string): string {
  return `${ASSET_DIR}/${name}`;
}

/** 是工作区资源目录里的本地图片吗？ */
export function isAssetPath(path: string): boolean {
  return path.startsWith(`${ASSET_DIR}/`) && !path.includes("..");
}

/** alt 文本里的方括号和反斜杠要转义，否则会提前结束 `![...]`。 */
export function imageMarkdown(alt: string, target: string): string {
  const safeAlt = alt.replace(/[\[\]\\]/g, (char) => `\\${char}`);
  return `![${safeAlt}](${target})`;
}

/**
 * 从图片目标里拆出 `=WxH` 尺寸后缀：
 * `![alt](shot.png =300x200)` → { url: "shot.png", width: 300, height: 200 }。
 * 不合法的后缀原样保留在 url 里，不吞内容。
 */
export function parseImageSize(target: string): {
  url: string;
  width?: number;
  height?: number;
} {
  const m = /^(.*?)\s+=(\d{1,5})x(\d{1,5})$/.exec(target);
  if (!m) return { url: target };
  const width = Number(m[2]);
  const height = Number(m[3]);
  if (!width || !height) return { url: target };
  return { url: m[1], width, height };
}

/** 字节 → data URI。分块 btoa，避免大图一次展开参数栈溢出。 */
export function dataUriOf(bytes: Uint8Array, mime: string): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

const LOCAL_IMAGE = /!\[([^\]]*)\]\((\.vellink-assets\/[^)\s]+)\)/g;

/**
 * 导出前把本地图片换成 data URI，让 HTML / PDF 自包含。
 *
 * 解析不了的图片保持原样（原路径还在磁盘上，不至于把图弄丢）。
 * 只处理资源目录里的路径——外部 http(s) 图片本来就能直接打开。
 */
export async function inlineLocalImages(
  source: string,
  resolve: (path: string) => Promise<string | null>,
): Promise<string> {
  const matches = [...source.matchAll(LOCAL_IMAGE)];
  if (matches.length === 0) return source;

  let out = source;
  let shift = 0;
  for (const match of matches) {
    const at = match.index ?? 0;
    const uri = await resolve(match[2]);
    if (!uri) continue;
    const replacement = `![${match[1]}](${uri})`;
    const start = at + shift;
    out = out.slice(0, start) + replacement + out.slice(start + match[0].length);
    shift += replacement.length - match[0].length;
  }
  return out;
}
