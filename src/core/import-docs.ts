/**
 * 导入 Markdown 文件的纯函数部分。
 *
 * 一次选多个文件是常态，标题和磁盘路径都可能撞车：这里的计划器一次性把
 * 所有冲突算清，UI 只管照计划写盘和建文档，不边写边查（那会漏掉同批里
 * 尚未落盘的后一个文件）。
 */

import { docTitle } from "./outline";

/** 导入入口接受的扩展名，与 Rust `is_markdown` 保持一致。 */
const MARKDOWN_EXT = /\.(?:md|markdown)$/i;

export interface ImportSource {
  /** 磁盘绝对路径（桌面端）或浏览器里的展示名。 */
  name: string;
  /** 可选的真实路径：桌面端用它读内容；浏览器端没有。 */
  path?: string;
  /** 原始文本，可能带 BOM / CRLF。 */
  text: string;
}

export interface ImportPlanItem {
  sourceName: string;
  path?: string;
  title: string;
  /** 归一后的源码：无 BOM、LF 换行。 */
  text: string;
  /** 目标文档 id；文件后端是工作区内绝对路径，浏览器端 undefined 走默认生成器。 */
  id: string | undefined;
}

export interface ImportPlan {
  items: ImportPlanItem[];
  /** 被跳过的文件（扩展名不符、读失败等）与原因。 */
  skipped: { name: string; reason: string }[];
}

/** 只认 .md / .markdown，路径分隔符后再取扩展名，挡住 `note.md.exe`。 */
export function isMarkdownFileName(name: string): boolean {
  const base = name.split(/[\\/]/).pop() ?? name;
  if (!MARKDOWN_EXT.test(base)) return false;
  // `foo.md` 通过，`foo.md.exe` / `foo.md ` 不行
  return base.length === base.trimEnd().length;
}

/** 文件名 → 文档标题：去扩展名、去控制字符，空则回退。 */
export function titleFromFileName(name: string, fallback: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const title = base
    .replace(MARKDOWN_EXT, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title || fallback;
}

/** 与 Rust `normalize_text` 一致：去 BOM、CRLF / 孤立 CR 归一成 LF。 */
export function normalizeImportedText(text: string): string {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * 生成导入计划：标题、id 都在「已有文档 + 本批先前的文档」里去重。
 *
 * `idFor(title, index)` 由调用方提供：文件后端返回工作区内不冲突的
 * 绝对路径，浏览器后端返回 undefined（走默认 id 生成器）。
 */
export function planImports(
  sources: ImportSource[],
  existingTitles: string[],
  fallbackTitle: string,
  idFor?: (title: string, index: number) => string | undefined,
): ImportPlan {
  const takenTitles = new Set(existingTitles);
  const takenIds = new Set<string>();
  const items: ImportPlanItem[] = [];
  const skipped: ImportPlan["skipped"] = [];

  sources.forEach((source, index) => {
    if (!isMarkdownFileName(source.name)) {
      skipped.push({ name: source.name, reason: "extension" });
      return;
    }
    const text = normalizeImportedText(source.text);
    // 和工作区保持一致：标题由正文首个 H1 派生，文件名只决定磁盘路径。
    // 否则用户第一次编辑这篇文档时，标题会突然从文件名跳成 H1。
    const base = docTitle(text, titleFromFileName(source.name, fallbackTitle));
    let title = base;
    let suffix = 2;
    while (takenTitles.has(title)) title = `${base} ${suffix++}`;
    takenTitles.add(title);

    // 文件后端给的路径理论上已去重，但同批两次 newPath 之间仍可能撞车，
    // 这里再挡一道；浏览器端 id 交给默认生成器，不参与去重。
    let id = idFor?.(title, index);
    if (id !== undefined) {
      if (takenIds.has(id)) id = `${id}.${index}.md`;
      takenIds.add(id);
    }

    items.push({
      sourceName: source.name,
      path: source.path,
      title,
      text,
      id,
    });
  });

  return { items, skipped };
}
