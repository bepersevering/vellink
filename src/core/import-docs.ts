/**
 * Pure functions for importing Markdown files.
 *
 * Selecting multiple files at once is common, and both titles and disk paths can collide: the
 * planner resolves all conflicts up front so the UI just writes files and creates docs according
 * to the plan, rather than checking as it goes (which would miss later files in the same batch
 * that haven't been written yet).
 */

import { docTitle } from "./outline";

/** Extensions accepted by the import entry point; keep in sync with Rust's `is_markdown`. */
const MARKDOWN_EXT = /\.(?:md|markdown)$/i;

export interface ImportSource {
  /** Absolute path on disk (desktop) or display name in the browser. */
  name: string;
  /** Optional real path: used by the desktop backend to read content; absent in the browser. */
  path?: string;
  /** Raw text, possibly with a BOM / CRLF line endings. */
  text: string;
}

export interface ImportPlanItem {
  sourceName: string;
  path?: string;
  title: string;
  /** Normalized source: no BOM, LF line endings. */
  text: string;
  /** Target document id; an absolute path inside the workspace for the file backend, undefined in the browser to use the default generator. */
  id: string | undefined;
}

export interface ImportPlan {
  items: ImportPlanItem[];
  /** Files skipped (bad extension, read failure, etc.) and the reasons. */
  skipped: { name: string; reason: string }[];
}

/** Accepts only .md / .markdown, checking the extension after the last path separator, so `note.md.exe` is rejected. */
export function isMarkdownFileName(name: string): boolean {
  const base = name.split(/[\\/]/).pop() ?? name;
  if (!MARKDOWN_EXT.test(base)) return false;
  // `foo.md` passes; `foo.md.exe` / `foo.md ` do not
  return base.length === base.trimEnd().length;
}

/** Filename → document title: strip the extension and control characters, fall back if empty. */
export function titleFromFileName(name: string, fallback: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const title = base
    .replace(MARKDOWN_EXT, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title || fallback;
}

/** Matches Rust's `normalize_text`: strip the BOM and normalize CRLF / lone CR to LF. */
export function normalizeImportedText(text: string): string {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Build an import plan: titles and ids are deduplicated against "existing documents + earlier
 * documents in this batch".
 *
 * `idFor(title, index)` is provided by the caller: the file backend returns a non-conflicting
 * absolute path inside the workspace, the browser backend returns undefined (use the default id
 * generator).
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
    // Stay consistent with the workspace: the title comes from the first H1 in the body; the filename only decides the disk path.
    // Otherwise the title would suddenly jump from the filename to the H1 on the user's first edit.
    const base = docTitle(text, titleFromFileName(source.name, fallbackTitle));
    let title = base;
    let suffix = 2;
    while (takenTitles.has(title)) title = `${base} ${suffix++}`;
    takenTitles.add(title);

    // Paths from the file backend should already be unique, but two newPath calls in the same batch can still collide,
    // so we add one more guard; in the browser the id goes to the default generator and is not deduplicated.
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
