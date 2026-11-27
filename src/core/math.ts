/**
 * Math formula detection and splitting (pure function, no KaTeX dependency).
 *
 * Lezer markdown doesn't recognize `$...$`; it leaves the whole thing inside a TextNode.
 * Rather than change the grammar, split the text once after parsing: turn `$...$` into
 * an inlineMath atom and `$$...$$` into a mathBlock. That way the `$` stays intact in the
 * source view and round-trips without loss.
 *
 * Boundary rules (following common Markdown math extensions):
 * - `$x$` is inline; `$$x$$` is block-level and may span lines.
 * - An opening `$` immediately followed by whitespace is not a formula (`price $ 5`).
 * - A backslash-escaped `\$` is not a formula boundary.
 * - A closer preceded by a backslash, or followed immediately by a digit (the `$` in `$20`),
 *   doesn't count.
 */

export interface MathSpan {
  start: number;
  end: number;
  /** Formula content, excluding the delimiters on both sides. */
  value: string;
  block: boolean;
}

/** Whether the `$` at this position is backslash-escaped. */
function escaped(source: string, at: number): boolean {
  let slashes = 0;
  for (let i = at - 1; i >= 0 && source[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}

/** Find the matching closing delimiter starting at `at`; return the end offset (exclusive) and content. */
function closing(
  source: string,
  at: number,
  delim: string,
): { end: number; value: string } | null {
  const contentStart = at + delim.length;
  for (let i = contentStart; i <= source.length - delim.length; i++) {
    if (source.slice(i, i + delim.length) !== delim) continue;
    if (escaped(source, i)) continue;
    const value = source.slice(contentStart, i);
    if (!value.trim()) return null;
    // A bare $ inside the content means this opening isn't the start of a formula
    // (e.g. `cost $5 and $x$`); give up and let the caller retry from the next $.
    if (/(^|[^\\])\$/.test(value)) return null;
    // Whitespace right before the closer → not a boundary, keep looking for the next one.
    if (/\s$/.test(value)) continue;
    // A digit right after the closer: more like a currency symbol than a formula (`cost $5`).
    if (/[0-9]/.test(source[i + delim.length] ?? "")) continue;
    return { end: i + delim.length, value };
  }
  return null;
}

/** Scan a piece of source and find all formula spans (non-overlapping, in ascending position order). */
export function findMath(source: string): MathSpan[] {
  const out: MathSpan[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "$" || escaped(source, i)) continue;
    const block = source.slice(i, i + 2) === "$$";
    const delim = block ? "$$" : "$";
    // Whitespace right after the opening → not a formula.
    if (/\s/.test(source[i + delim.length] ?? "")) continue;
    const found = closing(source, i, delim);
    if (!found) continue;
    out.push({ start: i, end: found.end, value: found.value, block });
    i = found.end - 1;
  }
  return out;
}

/**
 * Split a piece of plain text into text / formula chunks at formula boundaries.
 * The `text` spans are absolute offsets; the caller uses them to build TextNode / InlineMathNode.
 */
export type MathChunk =
  | { kind: "text"; start: number; end: number; value: string }
  | { kind: "math"; start: number; end: number; value: string; block: boolean };

export function splitMath(source: string, from: number, to: number): MathChunk[] {
  const slice = source.slice(from, to);
  const hits = findMath(slice).filter((h) => h.start + from >= from && h.end + from <= to);
  if (!hits.length) return [{ kind: "text", start: from, end: to, value: slice }];

  const chunks: MathChunk[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start > cursor) {
      chunks.push({
        kind: "text",
        start: from + cursor,
        end: from + hit.start,
        value: slice.slice(cursor, hit.start),
      });
    }
    chunks.push({
      kind: "math",
      start: from + hit.start,
      end: from + hit.end,
      value: hit.value,
      block: hit.block,
    });
    cursor = hit.end;
  }
  if (cursor < slice.length) {
    chunks.push({
      kind: "text",
      start: from + cursor,
      end: to,
      value: slice.slice(cursor),
    });
  }
  return chunks;
}

/**
 * A block formula occupies a whole paragraph: if a block, trimmed of surrounding whitespace,
 * is entirely covered by `$$...$$`, return the formula content; otherwise null.
 * The caller checks this first in mapBlock.
 */
export function standaloneMathBlock(source: string, from: number, to: number): MathSpan | null {
  const raw = source.slice(from, to);
  const lead = raw.length - raw.trimStart().length;
  const trail = raw.length - raw.trimEnd().length;
  const start = from + lead;
  const end = to - trail;
  if (!raw.trim().startsWith("$$")) return null;
  const found = closing(source, start, "$$");
  if (!found || found.end !== end) return null;
  return { start, end, value: found.value, block: true };
}
