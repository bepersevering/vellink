/**
 * 导出：把「当前文档 / 当前选区」变成一份可以直接拿走的文件。
 *
 * 三种格式的分工：
 * - `markdown`：原样搬运源码（选区就是源码切片），不重新序列化，零信息损失；
 * - `html`：走 IR → 独立 HTML，样式内联，发给别人双击就能读；
 * - `pdf`：同样生成 IR → HTML，但交给系统打印面板渲染（见 ui/ExportDialog）。
 *
 * 这里只做纯计算，不碰 DOM、不碰文件系统：文件名、内容、MIME 一次算清，
 * 落地方式（系统保存对话框 / 浏览器下载 / 打印）由调用方决定。
 */

import type { DocumentIR } from "../ir/types";
import { parseMarkdown } from "../parser/markdown";
import { renderBody, renderHtmlDocument } from "./html";

export type ExportFormat = "markdown" | "html" | "pdf";

/** 源码偏移区间（UTF-16），与编辑器内部坐标一致。 */
export interface ExportRange {
  from: number;
  to: number;
}

export interface ExportRequest {
  format: ExportFormat;
  /** 文档标题（H1 或文件名），用于文件名与 HTML 的 <title>。 */
  title: string;
  /** 当前文档的 Markdown 源码。 */
  source: string;
  /** 只导出这一段；不给或为空表示整篇。 */
  range?: ExportRange | null;
  /**
   * 选区导出时追加到文件名末尾（如「 · 摘录」）。
   *
   * 不加这一步，选区导出和整篇导出会算出同一个文件名，用户在保存对话框里
   * 一路回车就把整篇的导出覆盖掉了。
   */
  selectionSuffix?: string;
  /**
   * 调用方已经切好选区时显式标明是「摘录」。
   *
   * 图片内嵌会改变源码偏移，所以那种情况下先切后导，range 不再传进来，
   * 但仍然要让用户拿到带后缀的文件名。
   */
  partial?: boolean;
  lang?: string;
}

export interface ExportPayload {
  format: ExportFormat;
  /** 建议文件名，已含扩展名。 */
  fileName: string;
  /**
   * Markdown / HTML 是完整文件内容；PDF 是待打印的正文片段
   * （打印面板会自己套上 docCss，不需要 <html> 外壳）。
   */
  contents: string;
  mime: string;
  extension: string;
}

const FORMAT_META: Record<
  ExportFormat,
  { extension: string; mime: string }
> = {
  markdown: { extension: "md", mime: "text/markdown;charset=utf-8" },
  html: { extension: "html", mime: "text/html;charset=utf-8" },
  pdf: { extension: "pdf", mime: "application/pdf" },
};

/**
 * 文件名里不能出现的字符（跨 macOS / Windows / Linux 取并集）。
 * 连续命中压成一个 `-`，否则 "a/b:c*?d" 会得到一串连字符。
 */
const ILLEGAL_RUN = /[\\/:*?"<>|\u0000-\u001f]+/g;

/**
 * 标题 → 文件名。
 *
 * 用标题而不是「当前时间戳」：导出十次之后，用户靠文件名找得到东西。
 */
export function fileNameFor(title: string, extension: string): string {
  const base = (title || "")
    .replace(ILLEGAL_RUN, "-")
    // 连续空白压成一个空格，首尾空白与点去掉（Windows 不许文件名以点结尾）
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 80)
    .trim();
  return `${base || "untitled"}.${extension}`;
}

/** 把外部传来的区间夹进源码范围，并保证 from <= to。 */
export function clampRange(
  source: string,
  range: ExportRange | null | undefined,
): ExportRange | null {
  if (!range) return null;
  const max = source.length;
  const a = Math.max(0, Math.min(range.from, max));
  const b = Math.max(0, Math.min(range.to, max));
  const from = Math.min(a, b);
  const to = Math.max(a, b);
  return to > from ? { from, to } : null;
}

/** 选区有可能只选中空白，导出这种内容等于导出一个空文件。 */
function meaningful(text: string): boolean {
  return text.trim().length > 0;
}

/** Markdown 收尾：去掉尾部空行，补一个换行（POSIX 文本文件约定）。 */
function normalizeMarkdown(text: string): string {
  return `${text.replace(/[ \t]+$/gm, "").replace(/\n+$/, "")}\n`;
}

/** 取这次导出的源码与对应 IR。 */
function sourceOf(
  source: string,
  range: ExportRange | null | undefined,
): { source: string; ir: DocumentIR; partial: boolean } {
  const slice = clampRange(source, range);
  if (slice) {
    const text = source.slice(slice.from, slice.to);
    if (meaningful(text)) {
      const ir = parseMarkdown({ source: text }).ir;
      return { source: text, ir, partial: true };
    }
  }
  return { source, ir: parseMarkdown({ source }).ir, partial: false };
}

/**
 * 组装一次导出。
 *
 * 选区导出不是「把整篇渲染好再截一段」——那样会切断 DOM、丢掉未闭合的标签。
 * 做法是把选区那一段源码重新解析成 IR，再走同一条渲染链：结构可能被规范化
 * （比如从段落中间开始选），但产出的永远是一份合法的文档。
 */
export function buildExport(request: ExportRequest): ExportPayload {
  const meta = FORMAT_META[request.format];
  const { source, ir, partial } = sourceOf(request.source, request.range);
  const title = request.title || "Untitled";
  const isPartial = request.partial ?? partial;
  const name = isPartial ? `${title}${request.selectionSuffix ?? ""}` : title;

  let contents: string;
  if (request.format === "markdown") {
    contents = normalizeMarkdown(source);
  } else if (request.format === "html") {
    contents = renderHtmlDocument(ir, { title, lang: request.lang });
  } else {
    contents = renderBody(ir);
  }

  return {
    format: request.format,
    fileName: fileNameFor(name, meta.extension),
    contents,
    mime: meta.mime,
    extension: meta.extension,
  };
}
