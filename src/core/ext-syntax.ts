/**
 * Pure helpers for extended syntax: frontmatter / TOC placeholders / heading anchors.
 *
 * Lezer doesn't recognize (or only half-recognizes) these constructs, but they can be detected
 * precisely at the source-text level, so we post-process slices instead of touching the syntax
 * tree — the same strategy as for math, leaving the incremental source map untouched.
 */

export interface Frontmatter {
  start: number;
  end: number;
  /** Raw YAML text (excluding the surrounding --- lines). */
  yaml: string;
}

/**
 * Detect YAML frontmatter at the start of a document: `---` must occupy the first line on its own
 * (a BOM is allowed), and it ends with another `---` or `...` line. Interior `---` only counts at
 * the start of a line.
 */
export function findFrontmatter(source: string): Frontmatter | null {
  let at = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (source.slice(at, at + 3) !== "---") return null;
  const firstEnd = source.indexOf("\n", at + 3);
  if (firstEnd === -1) return null;
  if (source.slice(at + 3, firstEnd).trim() !== "") return null;

  let cursor = firstEnd + 1;
  while (cursor < source.length) {
    const lineEnd = source.indexOf("\n", cursor);
    const stop = lineEnd === -1 ? source.length : lineEnd;
    const line = source.slice(cursor, stop).trim();
    if (line === "---" || line === "...") {
      return {
        start: at,
        end: stop,
        yaml: source.slice(firstEnd + 1, cursor),
      };
    }
    cursor = lineEnd === -1 ? source.length : lineEnd + 1;
  }
  return null;
}

/** Positions of lines containing only `[TOC]` (surrounding whitespace allowed). */
export function findTocPlaceholders(source: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const lineEnd = source.indexOf("\n", cursor);
    const stop = lineEnd === -1 ? source.length : lineEnd;
    if (/^\s*\[TOC\]\s*$/i.test(source.slice(cursor, stop))) {
      out.push({ start: cursor, end: stop });
    }
    cursor = lineEnd === -1 ? source.length : lineEnd + 1;
  }
  return out;
}

/** Convert heading text to an anchor id: lowercase, non-alphanumerics collapsed to `-`, CJK preserved. */
export function headingAnchor(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s`*_~[\]()#]+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff\-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Parse an in-app link of the form `[text](#anchor)`; return null if it isn't an anchor. */
export function anchorTarget(url: string): string | null {
  const m = /^#(.*)$/.exec(url.trim());
  return m ? decodeURIComponent(m[1]) : null;
}

/** Extract the heading list (with levels and anchors) from Markdown source for TOC expansion. */
export function tocEntries(source: string): { depth: number; text: string; anchor: string }[] {
  const out: { depth: number; text: string; anchor: string }[] = [];
  let cursor = 0;
  let inFence = false;
  while (cursor < source.length) {
    const lineEnd = source.indexOf("\n", cursor);
    const stop = lineEnd === -1 ? source.length : lineEnd;
    const line = source.slice(cursor, stop);
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence) {
      const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (m) {
        const text = m[2];
        out.push({ depth: m[1].length, text, anchor: headingAnchor(text) });
      }
    }
    cursor = lineEnd === -1 ? source.length : lineEnd + 1;
  }
  return out;
}
