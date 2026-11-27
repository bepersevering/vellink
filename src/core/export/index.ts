/**
 * Export: turn "the current document / current selection" into a file you can take away directly.
 *
 * The three formats divide the work like this:
 * - `markdown`: copy the source verbatim (a selection is just a source slice), no
 *   re-serialization, zero information loss;
 * - `html`: go IR → standalone HTML with inlined styles, readable by anyone who double-clicks it;
 * - `pdf`: likewise generate IR → HTML, but hand it to the system print dialog for rendering
 *   (see ui/ExportDialog).
 *
 * This module only does pure computation — no DOM, no filesystem: file name, contents and MIME
 * are all computed at once. How the result is saved (system save dialog / browser download /
 * printing) is up to the caller.
 */

import type { DocumentIR } from "../ir/types";
import { parseMarkdown } from "../parser/markdown";
import { renderBody, renderHtmlDocument } from "./html";
import { renderDocx } from "./docx";
import { renderEpub } from "./epub";
import { renderOdt } from "./odt";
import { renderLatex, renderMediaWiki } from "./text-formats";

export type ExportFormat =
  | "markdown"
  | "html"
  | "pdf"
  | "docx"
  | "epub"
  | "odt"
  | "latex"
  | "mediawiki";

/** A source offset range (UTF-16), consistent with the editor's internal coordinates. */
export interface ExportRange {
  from: number;
  to: number;
}

export interface ExportRequest {
  format: ExportFormat;
  /** Document title (H1 or file name), used for the file name and the HTML <title>. */
  title: string;
  /** Markdown source of the current document. */
  source: string;
  /** Export only this range; omitted or empty means the whole document. */
  range?: ExportRange | null;
  /**
   * Appended to the file name for a selection export (e.g. " · Excerpt").
   *
   * Without this, a selection export and a full export would compute the same file name,
   * and the user could overwrite the full export just by hitting Enter in the save dialog.
   */
  selectionSuffix?: string;
  /**
   * Explicitly mark the export as an "excerpt" when the caller has already sliced the source.
   *
   * Inlining images changes source offsets, so in that case the source is sliced before
   * export, range is not passed in, but the user still needs a suffixed file name.
   */
  partial?: boolean;
  lang?: string;
  /** User-defined CSS, inlined when exporting HTML. */
  customCss?: string;
  /** Base directory for relative image paths. */
  imageBase?: string;
}

export interface ExportPayload {
  format: ExportFormat;
  /** Suggested file name, including the extension. */
  fileName: string;
  /**
   * Markdown / HTML are complete file contents; PDF is the body fragment to be printed
   * (the print dialog applies docCss itself and needs no <html> wrapper).
   */
  /** Binary formats (DOCX) produce a Uint8Array; the rest produce a string. */
  contents: string | Uint8Array;
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
  docx: {
    extension: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  epub: { extension: "epub", mime: "application/epub+zip" },
  odt: {
    extension: "odt",
    mime: "application/vnd.oasis.opendocument.text",
  },
  latex: { extension: "tex", mime: "application/x-tex;charset=utf-8" },
  mediawiki: { extension: "wiki", mime: "text/plain;charset=utf-8" },
};

/**
 * Characters not allowed in file names (the union across macOS / Windows / Linux).
 * Consecutive matches collapse to a single `-`, otherwise "a/b:c*?d" would yield a run of hyphens.
 */
const ILLEGAL_RUN = /[\\/:*?"<>|\u0000-\u001f]+/g;

/**
 * Title → file name.
 *
 * Use the title rather than a "current timestamp": after ten exports the user can still
 * find things by file name.
 */
export function fileNameFor(title: string, extension: string): string {
  const base = (title || "")
    .replace(ILLEGAL_RUN, "-")
    // Collapse runs of whitespace to a single space, strip leading/trailing whitespace and dots
    // (Windows doesn't allow file names ending in a dot)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 80)
    .trim();
  return `${base || "untitled"}.${extension}`;
}

/** Clamp an externally supplied range into the source bounds and ensure from <= to. */
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

/** A selection may contain only whitespace; exporting that is equivalent to exporting an empty file. */
function meaningful(text: string): boolean {
  return text.trim().length > 0;
}

/** Finish Markdown: strip trailing blank lines and add one newline (the POSIX text-file convention). */
function normalizeMarkdown(text: string): string {
  return `${text.replace(/[ \t]+$/gm, "").replace(/\n+$/, "")}\n`;
}

/** Get the source and corresponding IR for this export. */
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
 * Assemble one export.
 *
 * A selection export is not "render the whole document then cut a piece" — that would
 * sever the DOM and drop unclosed tags. Instead, re-parse the selected source into IR and
 * run it through the same rendering pipeline: the structure may be normalized (e.g. when
 * selecting from the middle of a paragraph), but the output is always a valid document.
 */
export async function buildExport(request: ExportRequest): Promise<ExportPayload> {
  const meta = FORMAT_META[request.format];
  const { source, ir, partial } = sourceOf(request.source, request.range);
  const title = request.title || "Untitled";
  const isPartial = request.partial ?? partial;
  const name = isPartial ? `${title}${request.selectionSuffix ?? ""}` : title;

  let contents: string | Uint8Array;
  if (request.format === "markdown") {
    contents = normalizeMarkdown(source);
  } else if (request.format === "html") {
    contents = renderHtmlDocument(ir, { title, lang: request.lang });
  } else if (request.format === "docx") {
    contents = await renderDocx(ir);
  } else if (request.format === "epub") {
    contents = await renderEpub(ir, { title, lang: request.lang });
  } else if (request.format === "odt") {
    contents = await renderOdt(ir);
  } else if (request.format === "latex") {
    contents = renderLatex(ir, title);
  } else if (request.format === "mediawiki") {
    contents = renderMediaWiki(ir);
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
